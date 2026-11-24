package handlers

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/drafts"
	"github.com/openpost/backend/internal/services/providerreadiness"
	publicationservice "github.com/openpost/backend/internal/services/publications"
	"github.com/uptrace/bun"
)

type mcpCreatePublicationInput struct {
	Segments           []PublicationSegmentInput `json:"segments"`
	WorkspaceID        string                    `json:"workspace_id"`
	ContentProfile     string                    `json:"content_profile"`
	Title              string                    `json:"title"`
	SourceText         string                    `json:"source_text"`
	SourceURL          string                    `json:"source_url"`
	ScheduledAt        *time.Time                `json:"scheduled_at"`
	RandomDelayMinutes *int                      `json:"random_delay_minutes"`
	SocialAccountIDs   []string                  `json:"social_account_ids"`
	MediaIDs           []string                  `json:"media_ids"`
	Media              []PublicationMediaInput   `json:"media"`
	Renditions         []RenditionInput          `json:"variants"`
	IdempotencyKey     string                    `json:"idempotency_key"`
	Detail             string                    `json:"detail"`
}

type mcpPublicationStatus struct {
	ID                   string `json:"id"`
	WorkspaceID          string `json:"workspace_id"`
	Title                string `json:"title"`
	ContentProfile       string `json:"content_profile"`
	Status               string `json:"status"`
	Revision             int    `json:"revision"`
	SourceText           string `json:"source_text"`
	SourceURL            string `json:"source_url,omitempty"`
	ScheduledAt          string `json:"scheduled_at,omitempty"`
	RandomDelayMinutes   int    `json:"random_delay_minutes"`
	RandomDelayInherited bool   `json:"random_delay_inherited"`
	CreatedAt            string `json:"created_at"`
	UpdatedAt            string `json:"updated_at"`
	RenditionCount       int    `json:"rendition_count"`
	// FailedRenditionCount counts destination renditions in failed status.
	// ErrorKind, ErrorAction, and ErrorMessage summarize the first failed
	// rendition using the same curated taxonomy stored on the rendition
	// (never raw provider response bodies).
	FailedRenditionCount int    `json:"failed_variant_count"`
	ErrorKind            string `json:"error_kind,omitempty"`
	ErrorAction          string `json:"error_action,omitempty"`
	ErrorMessage         string `json:"error_message,omitempty"`
}

// mcpPublicationStatusFromResponse renders the list summary for one
// canonical Publication, including its safe failure summary.
func mcpPublicationStatusFromResponse(publication PublicationResponse) mcpPublicationStatus {
	status := mcpPublicationStatus{
		ID: publication.ID, WorkspaceID: publication.WorkspaceID, Title: publication.Title,
		ContentProfile: publication.ContentProfile, Status: publication.Status, Revision: publication.Revision,
		SourceText: publication.SourceText, SourceURL: publication.SourceURL, ScheduledAt: publication.ScheduledAt,
		RandomDelayMinutes: publication.RandomDelayMinutes, RandomDelayInherited: publication.RandomDelayInherited,
		CreatedAt: publication.CreatedAt,
		UpdatedAt: publication.UpdatedAt, RenditionCount: len(publication.Renditions),
	}
	for _, rendition := range publication.Renditions {
		if rendition.Status != models.RenditionStatusFailed {
			continue
		}
		status.FailedRenditionCount++
		if status.FailedRenditionCount == 1 {
			status.ErrorKind = rendition.ErrorKind
			status.ErrorAction = rendition.ErrorAction
			status.ErrorMessage = rendition.ErrorMessage
		}
	}
	return status
}

func (h *MCPHandler) createPublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input mcpCreatePublicationInput
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid create_post arguments"}
	}
	now := time.Now().UTC()
	if rpcErr := validateMCPCreatePublicationInput(input, now); rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}

	defaultMedia, rpcErr := mcpDefaultPublicationMedia(input)
	if rpcErr != nil {
		return nil, rpcErr
	}
	accountIDs, rpcErr := normalizeMCPIDs(input.SocialAccountIDs, "social_account_ids")
	if rpcErr != nil {
		return nil, rpcErr
	}
	body := CreatePublicationBody{
		Segments: input.Segments, WorkspaceID: input.WorkspaceID,
		Title:              input.Title,
		ContentProfile:     input.ContentProfile,
		SourceText:         input.SourceText,
		SourceURL:          input.SourceURL,
		ScheduledAt:        input.ScheduledAt,
		RandomDelayMinutes: input.RandomDelayMinutes,
		Metadata:           map[string]interface{}{"created_from": "mcp"},
		SocialAccountIDs:   accountIDs,
		Media:              defaultMedia,
		Renditions:         input.Renditions,
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		return h.createPublicationIdempotent(ctx, userID, body, args)
	}
	publication, err := h.publicationHandler().publicationApplication().Create(ctx, userID, body)
	if err != nil {
		return nil, mcpPublicationCreateError(err)
	}
	return h.mcpPostResult(ctx, userID, publication.ID, "Post created: "+publication.ID, "", args)
}

func (h *MCPHandler) createPublicationIdempotent(ctx context.Context, userID string, body CreatePublicationBody, args map[string]any) (any, *mcpError) {
	request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, body.WorkspaceID, "create-publication", args)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if !ok {
		publication, err := h.publicationHandler().publicationApplication().Create(ctx, userID, body)
		if err != nil {
			return nil, mcpPublicationCreateError(err)
		}
		return h.mcpPostResult(ctx, userID, publication.ID, "Post created: "+publication.ID, "", args)
	}
	publication, _, err := h.publicationHandler().publicationApplication().CreateIdempotent(ctx, userID, body, request)
	if err != nil {
		if errors.Is(err, idempotency.ErrConflict) {
			return nil, mcpIdempotencyError(err, "failed to create post")
		}
		return nil, mcpPublicationCreateError(err)
	}
	return h.mcpPostResult(ctx, userID, publication.ID, "Post created: "+publication.ID, "", args)
}

func mcpPublicationCreateError(err error) *mcpError {
	var statusErr huma.StatusError
	if errors.As(err, &statusErr) && statusErr.GetStatus() < http.StatusInternalServerError {
		return &mcpError{Code: -32602, Message: statusErr.Error()}
	}
	return &mcpError{Code: -32603, Message: "failed to create post"}
}

func validateMCPCreatePublicationInput(input mcpCreatePublicationInput, now time.Time) *mcpError {
	if strings.TrimSpace(input.ContentProfile) == "" {
		return &mcpError{Code: -32602, Message: "content_profile is required"}
	}
	if strings.TrimSpace(input.SourceText) == "" {
		return &mcpError{Code: -32602, Message: "source_text is required"}
	}
	if input.ScheduledAt != nil {
		if err := validateFuturePublicationSchedule(*input.ScheduledAt, now); err != nil {
			return &mcpError{Code: -32602, Message: err.Error()}
		}
	}
	return nil
}

func mcpDefaultPublicationMedia(input mcpCreatePublicationInput) ([]PublicationMediaInput, *mcpError) {
	mediaIDs, rpcErr := normalizeMCPIDs(input.MediaIDs, "media_ids")
	if rpcErr != nil {
		return nil, rpcErr
	}
	defaultMedia := append([]PublicationMediaInput{}, input.Media...)
	for _, mediaID := range mediaIDs {
		defaultMedia = append(defaultMedia, PublicationMediaInput{MediaID: mediaID, Role: "attachment"})
	}
	return defaultMedia, nil
}

func (h *MCPHandler) listPublications(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID    string `json:"workspace_id"`
		Status         string `json:"status"`
		ActivityBucket string `json:"activity_bucket"`
		ContentProfile string `json:"content_profile"`
		Platform       string `json:"platform"`
		CalendarFrom   string `json:"calendar_from"`
		CalendarBefore string `json:"calendar_before"`
		Limit          int    `json:"limit"`
		Cursor         string `json:"cursor"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid list_posts arguments"}
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	page, err := h.publicationHandler().publicationApplication().List(ctx, userID, ListPublicationsInput{
		WorkspaceID: input.WorkspaceID, Status: input.Status, ActivityBucket: input.ActivityBucket,
		ContentProfile: input.ContentProfile, Platform: input.Platform,
		CalendarFrom: input.CalendarFrom, CalendarBefore: input.CalendarBefore,
		Limit: limit, Cursor: strings.TrimSpace(input.Cursor),
	})
	if err != nil {
		return nil, publicationMutationMCPError(err, "failed to list posts")
	}
	publications := make([]mcpPublicationStatus, 0, len(page.Publications))
	for _, publication := range page.Publications {
		publications = append(publications, mcpPublicationStatusFromResponse(publication))
	}
	text := fmt.Sprintf("Found %d posts.", len(publications))
	if page.HasMore {
		text = fmt.Sprintf("Found %d posts; more are available. Repeat the request with cursor %q while has_more is true.", len(publications), page.NextCursor)
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: text}},
		"structuredContent": map[string]any{
			"publications": publications,
			"has_more":     page.HasMore,
			"next_cursor":  page.NextCursor,
			"total_count":  page.TotalCount,
		},
	}, nil
}

func (h *MCPHandler) getPublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	publicationID, rpcErr := decodeMCPPublicationID(args, "invalid get_post arguments")
	if rpcErr != nil {
		return nil, rpcErr
	}
	publication, err := h.publicationHandler().publicationApplication().Get(ctx, userID, publicationID)
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: "post not found or unavailable"}
	}
	if mcpPostDetail(args) == "summary" {
		status := mcpPublicationStatusFromResponse(publication)
		return map[string]any{
			"content":           []mcpContent{{Type: "text", Text: "Post loaded: " + publication.ID}},
			"structuredContent": map[string]any{"publication": status, "job_id": ""},
		}, nil
	}
	return map[string]any{
		"content":           []mcpContent{{Type: "text", Text: "Post loaded: " + publication.ID}},
		"structuredContent": map[string]any{"publication": publication, "job_id": ""},
	}, nil
}

type mcpPublicationUpdateInput struct {
	Segments           []PublicationSegmentInput `json:"segments"`
	PublicationID      string                    `json:"post_id"`
	ExpectedRevision   int                       `json:"expected_revision"`
	Title              *string                   `json:"title"`
	ContentProfile     *string                   `json:"content_profile"`
	SourceText         *string                   `json:"source_text"`
	SourceURL          *string                   `json:"source_url"`
	Goal               *string                   `json:"goal"`
	Audience           *string                   `json:"audience"`
	ScheduledAt        *time.Time                `json:"scheduled_at"`
	ClearSchedule      bool                      `json:"clear_schedule"`
	RandomDelayMinutes *int                      `json:"random_delay_minutes"`
	InheritRandomDelay bool                      `json:"inherit_random_delay"`
	Metadata           *map[string]interface{}   `json:"metadata"`
	IdempotencyKey     string                    `json:"idempotency_key"`
	Detail             string                    `json:"detail"`
}

func (h *MCPHandler) updatePublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input mcpPublicationUpdateInput
	if err := decodeMCPArguments(args, &input); err != nil ||
		strings.TrimSpace(input.PublicationID) == "" ||
		input.ExpectedRevision < 1 {
		return nil, &mcpError{Code: -32602, Message: "invalid update_post arguments"}
	}
	body := PublicationUpdateBody{
		Segments: input.Segments, ExpectedRevision: input.ExpectedRevision,
		Title:              input.Title,
		ContentProfile:     input.ContentProfile,
		SourceText:         input.SourceText,
		SourceURL:          input.SourceURL,
		Goal:               input.Goal,
		Audience:           input.Audience,
		ScheduledAt:        input.ScheduledAt,
		ClearSchedule:      input.ClearSchedule,
		RandomDelayMinutes: input.RandomDelayMinutes,
		InheritRandomDelay: input.InheritRandomDelay,
		Metadata:           mcpMetadataValue(input.Metadata),
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, "", "update-publication", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			publication, _, err := h.publicationHandler().publicationApplication().UpdateIdempotent(ctx, userID, input.PublicationID, body, request)
			if err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to update post")
				}
				return nil, publicationMutationMCPError(err, "failed to update post")
			}
			return h.mcpPostResult(ctx, userID, publication.ID, "Post updated: "+publication.ID, "", args)
		}
	}
	if err := h.publicationHandler().publicationApplication().Update(ctx, userID, input.PublicationID, body); err != nil {
		return nil, publicationMutationMCPError(err, "failed to update post")
	}
	return h.mcpPostResult(ctx, userID, input.PublicationID, "Post updated: "+input.PublicationID, "", args)
}

func mcpMetadataValue(metadata *map[string]interface{}) map[string]interface{} {
	if metadata == nil {
		return nil
	}
	return *metadata
}

func publicationMutationMCPError(err error, fallback string) *mcpError {
	if category, ok := publicationservice.CategoryOf(err); ok {
		switch category {
		case publicationservice.ErrorInvalidInput, publicationservice.ErrorAccessDenied,
			publicationservice.ErrorNotFound, publicationservice.ErrorRevisionConflict,
			publicationservice.ErrorInvalidLifecycleState, publicationservice.ErrorProviderReadiness:
			return &mcpError{Code: -32602, Message: err.Error()}
		case publicationservice.ErrorTemporaryUnavailable:
			return &mcpError{Code: -32603, Message: fallback}
		}
	}
	var notReady *providerreadiness.NotReadyError
	var statusErr huma.StatusError
	switch {
	case isDraftRevisionConflict(err):
		return &mcpError{Code: -32602, Message: err.Error()}
	case errors.As(err, &statusErr) && statusErr.GetStatus() < http.StatusInternalServerError:
		return &mcpError{Code: -32602, Message: statusErr.Error()}
	case errors.Is(err, errPublicationNotFound),
		errors.Is(err, errPublicationAlreadyProcessing),
		errors.Is(err, errPublicationNotEditable),
		errors.Is(err, errPublicationNotScheduled),
		errors.Is(err, errPublicationScheduleConflict),
		errors.Is(err, errPublicationScheduleFuture),
		errors.Is(err, errPublicationValidationBlocked),
		errors.Is(err, errPublicationScheduleRequired):
		return &mcpError{Code: -32602, Message: err.Error()}
	case errors.As(err, &notReady):
		return &mcpError{Code: -32602, Message: err.Error()}
	default:
		return &mcpError{Code: -32603, Message: fallback}
	}
}

func isDraftRevisionConflict(err error) bool {
	if errors.Is(err, drafts.ErrRevisionConflict) {
		return true
	}
	var conflict *drafts.ConflictError
	return errors.As(err, &conflict)
}

func (h *MCPHandler) setPublicationRenditions(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	handler := h.publicationHandler()
	ctx, cleanupTextCards := handler.textCards.Mutation(ctx)
	defer cleanupTextCards()
	var input struct {
		PublicationID    string           `json:"post_id"`
		ExpectedRevision int              `json:"expected_revision"`
		Renditions       []RenditionInput `json:"variants"`
		IdempotencyKey   string           `json:"idempotency_key"`
		Detail           string           `json:"detail"`
	}
	if err := decodeMCPArguments(args, &input); err != nil ||
		strings.TrimSpace(input.PublicationID) == "" ||
		input.ExpectedRevision < 1 ||
		len(input.Renditions) == 0 {
		return nil, &mcpError{Code: -32602, Message: "invalid set_post_variants arguments"}
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		publication, err := handler.publicationApplication().Get(ctx, userID, strings.TrimSpace(input.PublicationID))
		if err != nil {
			return nil, &mcpError{Code: -32602, Message: "post not found or unavailable"}
		}
		accountMap, err := handler.loadAccounts(ctx, publication.WorkspaceID, renditionAccountIDs(input.Renditions))
		if err != nil {
			return nil, publicationMutationMCPError(err, "failed to update post variants")
		}
		if err := handler.validateMediaBelongsToWorkspace(ctx, publication.WorkspaceID, allPublicationMediaIDs(nil, nil, input.Renditions)); err != nil {
			return nil, publicationMutationMCPError(err, "failed to update post variants")
		}
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, publication.WorkspaceID, "upsert-publication-renditions", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			request.ResourceID = publication.ID
			request.RequestHash, err = idempotency.Hash(struct {
				PublicationID    string           `json:"publication_id"`
				ExpectedRevision int              `json:"expected_revision"`
				Renditions       []RenditionInput `json:"renditions"`
			}{publication.ID, input.ExpectedRevision, input.Renditions})
			if err != nil {
				return nil, &mcpError{Code: -32603, Message: "failed to normalize variant update"}
			}
			if _, err := idempotency.Execute(ctx, h.db, request, func(txCtx context.Context, tx bun.Tx) (PublicationResponse, error) {
				return handler.upsertRenditionsTx(txCtx, tx, userID, publication.ID, input.ExpectedRevision, input.Renditions, accountMap)
			}); err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to update post variants")
				}
				return nil, publicationMutationMCPError(err, "failed to update post variants")
			}
			return h.mcpPostResult(ctx, userID, publication.ID, "Post variants updated: "+publication.ID, "", args)
		}
	}
	if err := handler.publicationApplication().ReplaceRenditions(
		ctx, userID, input.PublicationID, input.ExpectedRevision, input.Renditions,
	); err != nil {
		return nil, publicationMutationMCPError(err, "failed to update post variants")
	}
	return h.mcpPostResult(ctx, userID, strings.TrimSpace(input.PublicationID), "Post variants updated: "+strings.TrimSpace(input.PublicationID), "", args)
}

func (h *MCPHandler) replyToRendition(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		RenditionID    string                  `json:"variant_id"`
		Body           string                  `json:"body"`
		ParentID       string                  `json:"parent_id"`
		Settings       map[string]interface{}  `json:"settings"`
		Media          []PublicationMediaInput `json:"media"`
		RunAt          *time.Time              `json:"run_at"`
		IdempotencyKey string                  `json:"idempotency_key"`
		Detail         string                  `json:"detail"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.RenditionID) == "" || strings.TrimSpace(input.Body) == "" {
		return nil, &mcpError{Code: -32602, Message: "invalid reply_to_variant arguments"}
	}
	rendition, publication, _, rpcErr := h.loadMCPCommentContext(ctx, userID, input.RenditionID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, publication.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	runAt := time.Now().UTC()
	if input.RunAt != nil {
		runAt = input.RunAt.UTC()
	}
	queue := func() (string, error) {
		return (&PublicationHandler{db: h.db}).queueRenditionReply(
			ctx, rendition, publication, input.Body, input.ParentID, input.Settings, input.Media, runAt,
		)
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, publication.WorkspaceID, "reply-to-publication-rendition", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			request.ResourceID = publication.ID
			request.RequestHash, _ = idempotency.Hash(struct {
				RenditionID string                 `json:"variant_id"`
				Body        string                 `json:"body"`
				ParentID    string                 `json:"parent_id"`
				Settings    map[string]interface{} `json:"settings"`
				RunAt       string                 `json:"run_at"`
			}{rendition.ID, input.Body, input.ParentID, input.Settings, runAt.Format(time.RFC3339Nano)})
			result, err := idempotency.ExecuteWithIdentity(ctx, h.db, request, func(_ context.Context, tx bun.Tx) (string, error) {
				// queueRenditionReply manages its own transaction; the
				// idempotency claim commits atomically around it.
				_ = tx
				return queue()
			}, func(jobID string) (string, string) { return publication.ID, jobID })
			if err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to enqueue reply")
				}
				return nil, &mcpError{Code: -32603, Message: "failed to enqueue reply"}
			}
			return h.mcpPostResult(ctx, userID, publication.ID, "Reply queued: "+rendition.ID, result.Value, args)
		}
	}
	jobID, err := queue()
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to enqueue reply"}
	}
	return h.mcpPostResult(ctx, userID, publication.ID, "Reply queued: "+rendition.ID, jobID, args)
}

func decodeMCPPublicationID(args map[string]any, invalid string) (string, *mcpError) {
	var input struct {
		PublicationID string `json:"post_id"`
		Detail        string `json:"detail"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.PublicationID) == "" {
		return "", &mcpError{Code: -32602, Message: invalid}
	}
	return strings.TrimSpace(input.PublicationID), nil
}

func (h *MCPHandler) validatePublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		PublicationID string `json:"post_id"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid validate_post arguments"}
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	if input.PublicationID == "" {
		return nil, &mcpError{Code: -32602, Message: "post_id is required"}
	}
	issues, err := h.publicationHandler().publicationApplication().Validate(ctx, userID, input.PublicationID)
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to validate post"}
	}
	valid := !hasBlockingIssues(issues)
	text := fmt.Sprintf("Post validation found %d issue(s).", len(issues))
	if !valid {
		text = fmt.Sprintf("Post validation failed with %d issue(s); call get_post for the current delivery state and retry_failed_variants once the issues are fixed.", len(issues))
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: text}},
		"structuredContent": map[string]any{
			"valid":  valid,
			"issues": issues,
		},
	}, nil
}

func (h *MCPHandler) schedulePublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	publicationID, expectedRevision, intent, rpcErr := h.loadMCPPublicationAction(ctx, args, "invalid schedule_post arguments")
	if rpcErr != nil {
		return nil, rpcErr
	}
	if mcpDryRunFromArgs(args) {
		if _, err := h.publicationHandler().publicationApplication().Validate(ctx, userID, publicationID); err != nil {
			return nil, publicationMutationMCPError(err, "failed to validate post")
		}
		return h.mcpPostResult(ctx, userID, publicationID, "Post schedule validated: "+publicationID, "", args)
	}
	handler := h.publicationHandler()
	if strings.TrimSpace(mcpIdempotencyKeyFromArgs(args)) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, "", "schedule-publication", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			result, _, err := handler.publicationApplication().ScheduleIdempotent(ctx, userID, publicationID, expectedRevision, intent, request)
			if err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to schedule post")
				}
				return nil, publicationMutationMCPError(err, "failed to schedule post")
			}
			return h.mcpPostResult(ctx, userID, publicationID, "Post scheduled: "+publicationID, result.JobID, args)
		}
	}
	result, err := handler.publicationApplication().Schedule(ctx, userID, publicationID, expectedRevision, intent)
	if err != nil {
		return nil, publicationMutationMCPError(err, "failed to schedule post")
	}
	return h.mcpPostResult(ctx, userID, publicationID, "Post scheduled: "+publicationID, result.JobID, args)
}

func (h *MCPHandler) cancelPublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		PublicationID    string `json:"post_id"`
		ExpectedRevision int    `json:"expected_revision"`
		IdempotencyKey   string `json:"idempotency_key"`
		Detail           string `json:"detail"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.PublicationID) == "" || input.ExpectedRevision < 1 {
		return nil, &mcpError{Code: -32602, Message: "invalid cancel_post arguments"}
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, "", "cancel-publication", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			publication, _, err := h.publicationHandler().publicationApplication().CancelIdempotent(ctx, userID, input.PublicationID, input.ExpectedRevision, request)
			if err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to cancel post")
				}
				return nil, publicationMutationMCPError(err, "failed to cancel post")
			}
			return h.mcpPostResult(ctx, userID, publication.ID, "Post cancelled: "+publication.ID, "", args)
		}
	}
	if err := h.publicationHandler().publicationApplication().Cancel(
		ctx, userID, input.PublicationID, input.ExpectedRevision,
	); err != nil {
		return nil, publicationMutationMCPError(err, "failed to cancel post")
	}
	return h.mcpPostResult(ctx, userID, input.PublicationID, "Post cancelled: "+input.PublicationID, "", args)
}

func (h *MCPHandler) publishPublicationNow(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	publicationID, expectedRevision, intent, rpcErr := h.loadMCPPublicationAction(ctx, args, "invalid publish_post_now arguments")
	if rpcErr != nil {
		return nil, rpcErr
	}
	// Authorization precedes the irreversible-action gate so viewers always
	// see the workspace role error first.
	publication, err := h.publicationHandler().publicationApplication().Get(ctx, userID, publicationID)
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: "post not found or unavailable"}
	}
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, publication.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := mcpRequireConfirm(args, "publish_post_now"); rpcErr != nil {
		return nil, rpcErr
	}
	if mcpDryRunFromArgs(args) {
		if _, err := h.publicationHandler().publicationApplication().Validate(ctx, userID, publicationID); err != nil {
			return nil, publicationMutationMCPError(err, "failed to validate post")
		}
		return h.mcpPostResult(ctx, userID, publicationID, "Post publish validated: "+publicationID, "", args)
	}
	handler := h.publicationHandler()
	if strings.TrimSpace(mcpIdempotencyKeyFromArgs(args)) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, "", "publish-publication-now", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			result, _, err := handler.publicationApplication().PublishNowIdempotent(ctx, userID, publicationID, expectedRevision, intent, request)
			if err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to queue post")
				}
				return nil, publicationMutationMCPError(err, "failed to queue post")
			}
			return h.mcpPostResult(ctx, userID, publicationID, "Post queued: "+publicationID, result.JobID, args)
		}
	}
	result, err := handler.publicationApplication().PublishNow(ctx, userID, publicationID, expectedRevision, intent)
	if err != nil {
		return nil, publicationMutationMCPError(err, "failed to queue post")
	}
	return h.mcpPostResult(ctx, userID, publicationID, "Post queued: "+publicationID, result.JobID, args)
}

func (h *MCPHandler) deletePublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		PublicationID    string `json:"post_id"`
		ExpectedRevision int    `json:"expected_revision"`
		Confirm          bool   `json:"confirm"`
		IdempotencyKey   string `json:"idempotency_key"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.PublicationID) == "" || input.ExpectedRevision < 1 {
		return nil, &mcpError{Code: -32602, Message: "invalid delete_post arguments"}
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	// Authorization precedes the irreversible-action gate so viewers always
	// see the workspace role error first.
	publication, err := h.publicationHandler().publicationApplication().Get(ctx, userID, input.PublicationID)
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: "post not found or unavailable"}
	}
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, publication.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := mcpRequireConfirm(args, "delete_post"); rpcErr != nil {
		return nil, rpcErr
	}
	deleteOp := func() *mcpError {
		if err := h.publicationHandler().publicationApplication().Delete(ctx, userID, input.PublicationID, input.ExpectedRevision); err != nil {
			return publicationMutationMCPError(err, "failed to delete post")
		}
		return nil
	}
	request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, publication.WorkspaceID, "delete-publication", args)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if ok {
		request.ResourceID = input.PublicationID
		request.RequestHash, _ = idempotency.Hash(struct {
			PublicationID    string `json:"publication_id"`
			ExpectedRevision int    `json:"expected_revision"`
		}{input.PublicationID, input.ExpectedRevision})
		var opErr *mcpError
		result, err := idempotency.Execute(ctx, h.db, request, func(_ context.Context, tx bun.Tx) (string, error) {
			_ = tx
			if rpcErr := deleteOp(); rpcErr != nil {
				opErr = rpcErr
				return "", errors.New(rpcErr.Message)
			}
			return input.PublicationID, nil
		})
		if err != nil {
			if errors.Is(err, idempotency.ErrConflict) {
				return nil, mcpIdempotencyError(err, "failed to delete post")
			}
			if opErr != nil {
				return nil, opErr
			}
			return nil, &mcpError{Code: -32603, Message: "failed to delete post"}
		}
		return h.mcpDeletedPostResult(result.Value), nil
	}
	if rpcErr := deleteOp(); rpcErr != nil {
		return nil, rpcErr
	}
	return h.mcpDeletedPostResult(input.PublicationID), nil
}

func (h *MCPHandler) mcpDeletedPostResult(publicationID string) map[string]any {
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: "Post deleted: " + publicationID}},
		"structuredContent": map[string]any{
			"message": "Post deleted: " + publicationID,
			"post_id": publicationID,
			"job_id":  "",
		},
	}
}

func (h *MCPHandler) retryFailedVariants(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	publicationID, expectedRevision, intent, rpcErr := h.loadMCPPublicationAction(ctx, args, "invalid retry_failed_variants arguments")
	if rpcErr != nil {
		return nil, rpcErr
	}
	_ = intent
	if rpcErr := h.mcpCheckExpectedRevision(ctx, userID, publicationID, expectedRevision); rpcErr != nil {
		return nil, rpcErr
	}
	handler := h.publicationHandler()
	if strings.TrimSpace(mcpIdempotencyKeyFromArgs(args)) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, "", "retry-failed-publication-renditions", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			jobID, _, err := handler.publicationApplication().RetryFailedRenditionsIdempotent(ctx, userID, publicationID, request)
			if err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to queue variant retry")
				}
				return nil, publicationMutationMCPError(err, "failed to queue variant retry")
			}
			return h.mcpPostResult(ctx, userID, publicationID, "Variant retry queued: "+publicationID, jobID, args)
		}
	}
	jobID, err := handler.publicationApplication().RetryFailedRenditions(ctx, userID, publicationID)
	if err != nil {
		return nil, publicationMutationMCPError(err, "failed to queue variant retry")
	}
	return h.mcpPostResult(ctx, userID, publicationID, "Variant retry queued: "+publicationID, jobID, args)
}

//nolint:gocyclo // Validation, authorization, and replay each have distinct client errors.
func (h *MCPHandler) retryVariant(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		PublicationID    string `json:"post_id"`
		RenditionID      string `json:"variant_id"`
		ExpectedRevision int    `json:"expected_revision"`
		ExecutionIntent  string `json:"execution_intent"`
		IdempotencyKey   string `json:"idempotency_key"`
		Detail           string `json:"detail"`
	}
	if err := decodeMCPArguments(args, &input); err != nil ||
		strings.TrimSpace(input.PublicationID) == "" ||
		strings.TrimSpace(input.RenditionID) == "" ||
		input.ExpectedRevision < 1 {
		return nil, &mcpError{Code: -32602, Message: "invalid retry_variant arguments"}
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	input.RenditionID = strings.TrimSpace(input.RenditionID)
	if _, err := providerReadinessExecutionIntent(ctx, h.db, input.ExecutionIntent); err != nil {
		return nil, &mcpError{Code: -32602, Message: err.Error()}
	}
	if rpcErr := h.mcpCheckExpectedRevision(ctx, userID, input.PublicationID, input.ExpectedRevision); rpcErr != nil {
		return nil, rpcErr
	}
	var rendition models.Rendition
	if err := h.db.NewSelect().Model(&rendition).
		Where("id = ? AND publication_id = ?", input.RenditionID, input.PublicationID).
		Scan(ctx); err != nil {
		return nil, &mcpError{Code: -32602, Message: "variant not found for this post"}
	}
	retry := func() (string, *mcpError) {
		jobID, err := h.publicationHandler().publicationApplication().RetryRendition(ctx, userID, input.PublicationID, rendition.SocialAccountID, rendition.TargetKey)
		if err != nil {
			return "", publicationMutationMCPError(err, "failed to queue variant retry")
		}
		return jobID, nil
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		publication, err := h.publicationHandler().publicationApplication().Get(ctx, userID, input.PublicationID)
		if err != nil {
			return nil, &mcpError{Code: -32602, Message: "post not found or unavailable"}
		}
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, publication.WorkspaceID, "retry-publication-rendition", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			request.ResourceID = publication.ID
			request.RequestHash, _ = idempotency.Hash(struct {
				PublicationID string `json:"publication_id"`
				RenditionID   string `json:"variant_id"`
			}{publication.ID, rendition.ID})
			var opErr *mcpError
			result, err := idempotency.ExecuteWithIdentity(ctx, h.db, request, func(_ context.Context, tx bun.Tx) (string, error) {
				_ = tx
				jobID, rpcErr := retry()
				if rpcErr != nil {
					opErr = rpcErr
					return "", errors.New(rpcErr.Message)
				}
				return jobID, nil
			}, func(jobID string) (string, string) { return publication.ID, jobID })
			if err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to queue variant retry")
				}
				if opErr != nil {
					return nil, opErr
				}
				return nil, &mcpError{Code: -32603, Message: "failed to queue variant retry"}
			}
			return h.mcpPostResult(ctx, userID, publication.ID, "Variant retry queued: "+rendition.ID, result.Value, args)
		}
	}
	jobID, rpcErr := retry()
	if rpcErr != nil {
		return nil, rpcErr
	}
	return h.mcpPostResult(ctx, userID, input.PublicationID, "Variant retry queued: "+rendition.ID, jobID, args)
}

// mcpCheckExpectedRevision rejects stale writes with the same conflict shape
// as the REST revision guard before dispatching to retry flows that do not
// take a revision themselves. The canonical read also enforces workspace
// access before the revision is compared.
func (h *MCPHandler) mcpCheckExpectedRevision(ctx context.Context, userID, publicationID string, expectedRevision int) *mcpError {
	publication, err := h.publicationHandler().publicationApplication().Get(ctx, userID, publicationID)
	if err != nil {
		return &mcpError{Code: -32602, Message: "post not found or unavailable"}
	}
	if publication.Revision != expectedRevision {
		return &mcpError{Code: -32602, Message: fmt.Sprintf("revision conflict: expected %d but post is at revision %d; reload the post before retrying", expectedRevision, publication.Revision)}
	}
	return nil
}

func (h *MCPHandler) loadMCPPublicationAction(ctx context.Context, args map[string]any, invalidMessage string) (string, int, providerreadiness.ExecutionIntent, *mcpError) {
	var input struct {
		PublicationID    string `json:"post_id"`
		ExpectedRevision int    `json:"expected_revision"`
		ExecutionIntent  string `json:"execution_intent"`
		Confirm          bool   `json:"confirm"`
		IdempotencyKey   string `json:"idempotency_key"`
		Detail           string `json:"detail"`
		DryRun           bool   `json:"dry_run"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return "", 0, "", &mcpError{Code: -32602, Message: invalidMessage}
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	if input.PublicationID == "" || input.ExpectedRevision < 1 {
		return "", 0, "", &mcpError{Code: -32602, Message: "post_id and expected_revision are required"}
	}
	intent, err := providerReadinessExecutionIntent(ctx, h.db, input.ExecutionIntent)
	if err != nil {
		return "", 0, "", &mcpError{Code: -32602, Message: err.Error()}
	}
	return input.PublicationID, input.ExpectedRevision, intent, nil
}

func mcpPublicationActionResult(message, jobID string, status mcpPublicationStatus) map[string]any {
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: message}},
		"structuredContent": map[string]any{
			"publication": status,
			"job_id":      jobID,
		},
	}
}

// mcpPostResult returns the unified post result shape: a summary status plus
// job ID by default, or the full post with ordered media and variants when
// detail=full. jobID is empty when the operation enqueues no durable work.
func (h *MCPHandler) mcpPostResult(ctx context.Context, userID, publicationID, message, jobID string, args map[string]any) (any, *mcpError) {
	publication, err := h.publicationHandler().publicationApplication().Get(ctx, userID, publicationID)
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: "post not found or unavailable"}
	}
	if mcpPostDetail(args) == "full" {
		return map[string]any{
			"content": []mcpContent{{Type: "text", Text: message}},
			"structuredContent": map[string]any{
				"publication": publication,
				"job_id":      jobID,
			},
		}, nil
	}
	return mcpPublicationActionResult(message, jobID, mcpPublicationStatusFromResponse(publication)), nil
}

func (h *MCPHandler) listPublicationEvents(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		PublicationID string `json:"post_id"`
		Limit         int    `json:"limit"`
		Cursor        string `json:"cursor"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid list_post_events arguments"}
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	if input.PublicationID == "" {
		return nil, &mcpError{Code: -32602, Message: "post_id is required"}
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 200 {
		limit = 200
	}
	page, err := h.publicationHandler().publicationApplication().History(
		ctx, userID, input.PublicationID, limit, strings.TrimSpace(input.Cursor),
	)
	if err != nil {
		return nil, publicationMutationMCPError(err, "failed to list post events")
	}
	out := page.Events
	if out == nil {
		out = []PublicationLifecycleEventResponse{}
	}
	total := h.countPublicationHistoryEvents(ctx, input.PublicationID)
	text := fmt.Sprintf("Found %d of %d post events.", len(out), total)
	if page.HasMore {
		text = fmt.Sprintf("Found %d of %d post events; more are available. Repeat the request with cursor %q while has_more is true.", len(out), total, page.NextCursor)
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: text}},
		"structuredContent": map[string]any{
			"events":      out,
			"has_more":    page.HasMore,
			"next_cursor": page.NextCursor,
			"total_count": total,
		},
	}, nil
}

// countPublicationHistoryEvents totals the same merged history that
// listPublicationHistory serves: lifecycle events, draft revision changes,
// and the creation item. Missing history tables read as zero so workspaces
// provisioned before a migration keep working.
func (h *MCPHandler) countPublicationHistoryEvents(ctx context.Context, publicationID string) int {
	total := 1
	if lifecycleCount, err := h.db.NewSelect().Model((*models.PublicationLifecycleEvent)(nil)).
		Where("publication_id = ?", publicationID).
		Count(ctx); err == nil {
		total += int(lifecycleCount)
	} else if !isMissingPublicationHistoryTable(err) {
		return total
	}
	if editCount, err := h.db.NewSelect().Model((*models.DraftRevisionChange)(nil)).
		Where("aggregate_type = ?", drafts.AggregatePublication).
		Where("aggregate_id = ?", publicationID).
		Count(ctx); err == nil {
		total += int(editCount)
	}
	return total
}

func normalizeMCPIDs(ids []string, field string) ([]string, *mcpError) {
	unique := make([]string, 0, len(ids))
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			return nil, &mcpError{Code: -32602, Message: field + " cannot contain empty values"}
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	return unique, nil
}
