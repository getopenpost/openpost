package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	engagementservice "github.com/openpost/backend/internal/services/engagement"
	"github.com/uptrace/bun"
)

func (h *MCPHandler) listRenditionComments(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		RenditionID string `json:"variant_id"`
		Limit       int    `json:"limit"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid list_variant_comments arguments"}
	}
	input.RenditionID = strings.TrimSpace(input.RenditionID)
	if input.RenditionID == "" {
		return nil, &mcpError{Code: -32602, Message: "variant_id is required"}
	}
	limit := input.Limit
	if limit == 0 {
		limit = 50
	}
	if limit < 1 || limit > 100 {
		return nil, &mcpError{Code: -32602, Message: "limit must be between 1 and 100"}
	}
	rendition, publication, account, rpcErr := h.loadMCPCommentContext(ctx, userID, input.RenditionID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	commenter, accessToken, rpcErr := h.commentAdapter(ctx, account)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if strings.TrimSpace(rendition.ExternalID) == "" {
		return nil, &mcpError{Code: -32602, Message: "variant has no provider post ID"}
	}
	comments, err := commenter.ListComments(ctx, accessToken, account.AccountID, rendition.ExternalID)
	if err != nil {
		if errors.Is(err, platform.ErrUnsupportedCommentAction) {
			return nil, &mcpError{Code: -32603, Message: "provider does not support list provider comments"}
		}
		return nil, &mcpError{Code: -32603, Message: "failed to list provider comments"}
	}
	out := make([]CommentResponse, 0, len(comments))
	for _, comment := range comments {
		ref, err := encodeCommentReference(commentReference{RenditionID: rendition.ID, ProviderCommentID: comment.ID})
		if err != nil {
			return nil, &mcpError{Code: -32603, Message: "failed to encode comment ID"}
		}
		out = append(out, commentResponse(rendition.ID, ref, comment))
	}
	text := fmt.Sprintf("Found %d comments for %s.", len(out), publication.Title)
	if len(out) > limit {
		out = out[:limit]
		text = fmt.Sprintf("Found %d comments for %s; showing the first %d (limit %d).", len(comments), publication.Title, limit, limit)
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: text}},
		"structuredContent": map[string]any{
			"comments": out,
		},
	}, nil
}

//nolint:gocyclo // Comment actions share access checks but retain separate replay and queue outcomes.
func (h *MCPHandler) moderateComment(ctx context.Context, userID, operation string, args map[string]any) (any, *mcpError) {
	var input struct {
		CommentID      string `json:"comment_id"`
		Body           string `json:"body"`
		Confirm        bool   `json:"confirm"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.CommentID) == "" {
		return nil, &mcpError{Code: -32602, Message: "invalid comment action arguments"}
	}
	ref, err := decodeCommentReference(input.CommentID)
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid comment ID"}
	}
	rendition, publication, account, rpcErr := h.loadMCPCommentContext(ctx, userID, ref.RenditionID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, publication.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	if operation == mcpToolDeleteComment {
		if rpcErr := mcpRequireConfirm(args, "delete_comment"); rpcErr != nil {
			return nil, rpcErr
		}
	}
	if _, rpcErr := h.commentProvider(account); rpcErr != nil {
		return nil, rpcErr
	}
	message, action := "", ""
	switch operation {
	case mcpToolReplyComment:
		if strings.TrimSpace(input.Body) == "" {
			return nil, &mcpError{Code: -32602, Message: "reply body is required"}
		}
		action = "reply"
		message = "comment reply queued"
	case mcpToolHideComment:
		action = "hide"
		message = "comment hide queued"
	case mcpToolDeleteComment:
		action = "delete"
		message = "comment deletion queued"
	default:
		return nil, &mcpError{Code: -32602, Message: "unknown comment action"}
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		// Replay check before queueing so a retried call returns the stored
		// job instead of queueing a duplicate provider action.
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, publication.WorkspaceID, "provider-comment-"+action, args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			request.ResourceID = publication.ID
			request.RequestHash, _ = idempotency.Hash(struct {
				CommentID string `json:"comment_id"`
				Body      string `json:"body"`
				Action    string `json:"action"`
			}{strings.TrimSpace(input.CommentID), input.Body, action})
			if replay, found, err := idempotency.Replay[string](ctx, h.db, request); found || err != nil {
				if err != nil {
					return nil, mcpIdempotencyError(err, "failed to queue provider comment action")
				}
				return map[string]any{
					"content":           []mcpContent{{Type: "text", Text: message}},
					"structuredContent": map[string]any{"message": message, "job_id": replay.Value},
				}, nil
			}
			queuedID, err := engagementservice.QueueProviderCommentAction(ctx, h.db, h.featureGate, engagementservice.ProviderCommentActionInput{
				Actor:       workspaceActor(ctx, userID),
				WorkspaceID: publication.WorkspaceID, PublicationID: publication.ID,
				RenditionID: rendition.ID, SocialAccountID: account.ID,
				ProviderCommentID: ref.ProviderCommentID, Action: action,
				Message: input.Body,
			})
			if err != nil {
				return nil, &mcpError{Code: -32603, Message: "failed to queue provider comment action"}
			}
			request.JobID = queuedID
			if result, err := idempotency.Execute(ctx, h.db, request, func(txCtx context.Context, tx bun.Tx) (string, error) {
				_ = txCtx
				_ = tx
				return queuedID, nil
			}); err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to queue provider comment action")
				}
				// The job is queued; only the replay record failed.
				return nil, &mcpError{Code: -32603, Message: "comment action queued but the replay record failed"}
			} else if result.Replayed && result.Value != "" {
				queuedID = result.Value
			}
			return map[string]any{
				"content":           []mcpContent{{Type: "text", Text: message}},
				"structuredContent": map[string]any{"message": message, "job_id": queuedID},
			}, nil
		}
	}
	jobID, err := engagementservice.QueueProviderCommentAction(ctx, h.db, h.featureGate, engagementservice.ProviderCommentActionInput{
		Actor:       workspaceActor(ctx, userID),
		WorkspaceID: publication.WorkspaceID, PublicationID: publication.ID,
		RenditionID: rendition.ID, SocialAccountID: account.ID,
		ProviderCommentID: ref.ProviderCommentID, Action: action,
		Message: input.Body,
	})
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to queue provider comment action"}
	}
	return map[string]any{
		"content":           []mcpContent{{Type: "text", Text: message}},
		"structuredContent": map[string]any{"message": message, "job_id": jobID},
	}, nil
}

func (h *MCPHandler) loadMCPCommentContext(ctx context.Context, userID, renditionID string) (*models.Rendition, *models.Publication, *models.SocialAccount, *mcpError) {
	var rendition models.Rendition
	if err := h.db.NewSelect().Model(&rendition).Where("id = ?", renditionID).Scan(ctx); err != nil {
		return nil, nil, nil, &mcpError{Code: -32602, Message: "variant not found"}
	}
	var publication models.Publication
	if err := h.db.NewSelect().Model(&publication).Where("id = ?", rendition.PublicationID).Scan(ctx); err != nil {
		return nil, nil, nil, &mcpError{Code: -32602, Message: "post not found"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, publication.WorkspaceID); rpcErr != nil {
		return nil, nil, nil, rpcErr
	}
	var account models.SocialAccount
	if err := h.db.NewSelect().
		Model(&account).
		Where("id = ? AND workspace_id = ? AND is_active = ?", rendition.SocialAccountID, publication.WorkspaceID, true).
		Scan(ctx); err != nil {
		return nil, nil, nil, &mcpError{Code: -32602, Message: "social account not found"}
	}
	return &rendition, &publication, &account, nil
}

func (h *MCPHandler) commentAdapter(ctx context.Context, account *models.SocialAccount) (platform.CommentAdapter, string, *mcpError) {
	commenter, rpcErr := h.commentProvider(account)
	if rpcErr != nil {
		return nil, "", rpcErr
	}
	if h.tokenSource != nil {
		token, err := h.tokenSource.GetValidAccessToken(ctx, account.ID)
		if err != nil {
			return nil, "", &mcpError{Code: -32603, Message: "failed to load account token"}
		}
		return commenter, token, nil
	}
	if h.tokenEncryptor == nil {
		return nil, "", &mcpError{Code: -32603, Message: "comment provider tokens are unavailable"}
	}
	token, err := h.tokenEncryptor.Decrypt(account.AccessTokenEnc)
	if err != nil {
		return nil, "", &mcpError{Code: -32603, Message: "failed to decrypt account token"}
	}
	return commenter, token, nil
}

func (h *MCPHandler) commentProvider(account *models.SocialAccount) (platform.CommentAdapter, *mcpError) {
	key := platform.AccountProviderKey(account.Platform, account.InstanceURL, account.CapabilityState)
	h.providersMu.RLock()
	provider := h.providers[key]
	h.providersMu.RUnlock()
	commenter, ok := provider.(platform.CommentAdapter)
	if !ok || commenter == nil {
		return nil, &mcpError{Code: -32603, Message: fmt.Sprintf("comments are not supported for %s", account.Platform)}
	}
	return commenter, nil
}

type mcpVariantMetrics struct {
	VariantID       string   `json:"variant_id"`
	Platform        string   `json:"platform"`
	SocialAccountID string   `json:"social_account_id"`
	Views           int64    `json:"views"`
	Reactions       int64    `json:"reactions"`
	Engagements     int64    `json:"engagements"`
	Impressions     int64    `json:"impressions"`
	Reach           int64    `json:"reach"`
	Measured        []string `json:"measured"`
	CollectedAt     string   `json:"collected_at,omitempty"`
}

// getPostMetrics reads stored analytics snapshots for a post's variants. It
// never calls providers: collection stays in the analytics service, and this
// operation only normalizes what is already stored.
//
//nolint:gocyclo // Snapshot measurement keys must stay distinct from unmeasured zero values.
func (h *MCPHandler) getPostMetrics(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	postID, rpcErr := decodeMCPPublicationID(args, "invalid get_post_metrics arguments")
	if rpcErr != nil {
		return nil, rpcErr
	}
	post, err := h.publicationHandler().publicationApplication().Get(ctx, userID, postID)
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: "post not found or unavailable"}
	}
	var renditions []models.Rendition
	if err := h.db.NewSelect().Model(&renditions).
		Where("publication_id = ?", post.ID).
		Order("created_at ASC", "id ASC").
		Scan(ctx); err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to load post variants"}
	}
	var snapshots []models.AnalyticsRenditionSnapshot
	if err := h.db.NewSelect().Model(&snapshots).
		Where("publication_id = ?", post.ID).
		Scan(ctx); err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to load post metrics"}
	}
	latest := make(map[string]models.AnalyticsRenditionSnapshot, len(snapshots))
	for _, snapshot := range snapshots {
		current, ok := latest[snapshot.RenditionID]
		if !ok || snapshot.CapturedAt.After(current.CapturedAt) {
			latest[snapshot.RenditionID] = snapshot
		}
	}
	variants := make([]mcpVariantMetrics, 0, len(renditions))
	totals := map[string]int64{"views": 0, "reactions": 0, "engagements": 0, "impressions": 0, "reach": 0}
	measuredAny := false
	for _, rendition := range renditions {
		metrics := mcpVariantMetrics{
			VariantID: rendition.ID, Platform: rendition.Platform,
			SocialAccountID: rendition.SocialAccountID, Measured: []string{},
		}
		if snapshot, ok := latest[rendition.ID]; ok {
			values := decodeMCPStoredAnalyticsValues(snapshot.MetricsJSON)
			metrics.Views = values[platform.MetricViews]
			metrics.Reactions = values[platform.MetricReactions]
			metrics.Engagements = platform.EngagementTotal(values)
			metrics.Impressions = values[platform.MetricImpressions]
			metrics.Reach = values[platform.MetricReach]
			for _, name := range []string{
				platform.MetricViews, platform.MetricReactions,
				platform.MetricImpressions, platform.MetricReach,
			} {
				if _, ok := values[name]; ok {
					metrics.Measured = append(metrics.Measured, name)
				}
			}
			if platform.HasEngagementMetric(values) {
				metrics.Measured = append(metrics.Measured, platform.MetricEngagements)
			}
			if !snapshot.CapturedAt.IsZero() {
				metrics.CollectedAt = snapshot.CapturedAt.UTC().Format(time.RFC3339)
			}
			totals["views"] += metrics.Views
			totals["reactions"] += metrics.Reactions
			totals["engagements"] += metrics.Engagements
			totals["impressions"] += metrics.Impressions
			totals["reach"] += metrics.Reach
			measuredAny = true
		}
		variants = append(variants, metrics)
	}
	text := fmt.Sprintf("Post metrics loaded for %d variant(s).", len(variants))
	if !measuredAny {
		text = fmt.Sprintf("No stored analytics for post %s yet; variants report zeros until the analytics service collects provider measurements.", post.ID)
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: text}},
		"structuredContent": map[string]any{
			"post_id":  post.ID,
			"variants": variants,
			"totals":   totals,
		},
	}, nil
}

// decodeMCPStoredAnalyticsValues keeps every stored snapshot value readable.
// A missing key is distinct from a measured zero; malformed rows read as
// empty rather than failing the whole call.
func decodeMCPStoredAnalyticsValues(raw string) platform.AnalyticsValues {
	values := platform.AnalyticsValues{}
	if strings.TrimSpace(raw) == "" {
		return values
	}
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return platform.AnalyticsValues{}
	}
	return values
}
