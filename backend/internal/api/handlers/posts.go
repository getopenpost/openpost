package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	databasemigrations "github.com/openpost/backend/internal/database/migrations"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/drafts"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/medialifecycle"
	postservice "github.com/openpost/backend/internal/services/posts"
	"github.com/openpost/backend/internal/services/publicationauth"
	repostservice "github.com/openpost/backend/internal/services/reposts"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

const (
	statusDraft     = "draft"
	statusScheduled = "scheduled"
)

var (
	errPostScheduleFuture = errors.New("scheduled_at must be in the future")
	errPostRunAtFuture    = errors.New("random delay must keep actual_run_at in the future")
)

type PostHandler struct {
	db          *bun.DB
	auth        middleware.Authenticator
	entitlement entitlements.Service
	usage       *usage.Service
	posts       *postservice.Service
	reposts     *repostservice.Service
	providers   map[string]platform.Adapter
	tokenSource AccessTokenSource
	// beforeLegacyMutationTransaction is a deterministic worker-completion
	// seam for compatibility endpoint tests. Production constructors leave it nil.
	beforeLegacyMutationTransaction func(context.Context) error
}

func (h *PostHandler) SetCapabilityDependencies(providers map[string]platform.Adapter, tokenSource AccessTokenSource) {
	h.providers = providers
	h.tokenSource = tokenSource
}

func NewPostHandler(db *bun.DB, authenticator middleware.Authenticator, entitlement ...entitlements.Service) *PostHandler {
	entitlementService := entitlements.Service(entitlements.NewSelfHostedService())
	if len(entitlement) > 0 && entitlement[0] != nil {
		entitlementService = entitlement[0]
	}
	return &PostHandler{
		db:          db,
		auth:        authenticator,
		entitlement: entitlementService,
		usage:       usage.NewService(db),
		posts:       postservice.NewService(db),
	}
}

func (h *PostHandler) SetUsage(usageService *usage.Service) {
	if usageService != nil {
		h.usage = usageService
	}
}

func (h *PostHandler) SetRepostService(service *repostservice.Service) {
	h.reposts = service
}

type CreatePostInput struct {
	Body struct {
		WorkspaceID        string     `json:"workspace_id" doc:"Target workspace ID"`
		Content            string     `json:"content" doc:"Post content"`
		ScheduledAt        *time.Time `json:"scheduled_at,omitempty" doc:"Schedule time (ISO 8601). Omit for draft."`
		SocialAccountIDs   []string   `json:"social_account_ids" doc:"Social account IDs to publish to"`
		MediaIDs           []string   `json:"media_ids,omitempty" doc:"Media attachment IDs to include"`
		RandomDelayMinutes int        `json:"random_delay_minutes,omitempty" doc:"Random delay in minutes (±N) to add for natural posting"`
		ThreadDraft        *string    `json:"thread_draft,omitempty" doc:"Optional thread draft JSON (encoded with __openpost_thread__: prefix) for a parent post that drafts a multi-post thread. Mutually exclusive with a thread blob in content: the new field is preferred."`
	}
}

type CreatePostOutput struct {
	Body *PostResponse
}

type PostDestinationResponse struct {
	SocialAccountID string `json:"social_account_id" doc:"Social account ID"`
	Platform        string `json:"platform" doc:"Platform name"`
	Status          string `json:"status" doc:"Destination status"`
	ErrorMessage    string `json:"error_message,omitempty" doc:"Error message if publishing failed"`
	ErrorKind       string `json:"error_kind,omitempty" doc:"Stable publishing failure kind"`
	ErrorCode       string `json:"error_code,omitempty" doc:"Safe provider error code"`
	ErrorHTTPStatus int    `json:"error_http_status,omitempty" doc:"Provider HTTP status"`
	ErrorRetryable  bool   `json:"error_retryable" doc:"Whether retry is safe"`
	ErrorRetryAt    string `json:"error_retry_at,omitempty" doc:"Next automatic retry time"`
	ErrorAction     string `json:"error_action,omitempty" doc:"Recommended recovery action"`
}

type PostResponse struct {
	ID                 string                    `json:"id" doc:"Post ID"`
	PublicationID      string                    `json:"publication_id,omitempty" doc:"Canonical publication ID for the text composer"`
	WorkspaceID        string                    `json:"workspace_id" doc:"Workspace ID"`
	CreatedByID        string                    `json:"created_by" doc:"Creator user ID"`
	ParentPostID       string                    `json:"parent_post_id,omitempty" doc:"Previous post ID when this is a thread reply"`
	ThreadSequence     int                       `json:"thread_sequence,omitempty" doc:"Zero-based position in a thread"`
	Content            string                    `json:"content" doc:"Post content"`
	Status             string                    `json:"status" doc:"Post status (draft, scheduled, publishing, published, failed)"`
	Revision           int                       `json:"revision" doc:"Current atomic draft revision"`
	ScheduledAt        string                    `json:"scheduled_at" doc:"Scheduled time (ISO 8601)"`
	RandomDelayMinutes int                       `json:"random_delay_minutes" doc:"Random delay in minutes (±N)"`
	ActualRunAt        string                    `json:"actual_run_at,omitempty" doc:"Actual run time after random delay (ISO 8601)"`
	CreatedAt          string                    `json:"created_at" doc:"Creation time (ISO 8601)"`
	UpdatedAt          string                    `json:"updated_at" doc:"Last atomic draft save time (ISO 8601)"`
	Destinations       []PostDestinationResponse `json:"destinations,omitempty" doc:"Post destinations"`
	MediaIDs           []string                  `json:"media_ids,omitempty" doc:"Attached media IDs"`
	ThreadDraft        *string                   `json:"thread_draft,omitempty" doc:"Set when this post is a thread-draft parent; contains the encoded thread JSON (with __openpost_thread__: prefix)."`
}

type TextPostPublicationInput struct {
	Title          *string                   `json:"title,omitempty" doc:"Publication title"`
	Intent         *string                   `json:"intent,omitempty" doc:"Publishing intent"`
	CreationPreset *string                   `json:"creation_preset,omitempty" doc:"Starter preset; destination renditions own their formats"`
	SocialSetID    *string                   `json:"social_set_id,omitempty" doc:"Social Set provenance for the snapshotted destinations"`
	ContentProfile *string                   `json:"content_profile,omitempty" doc:"Content profile"`
	SourceText     *string                   `json:"source_text,omitempty" doc:"Canonical source text"`
	SourceURL      *string                   `json:"source_url,omitempty" doc:"Canonical source URL"`
	Goal           *string                   `json:"goal,omitempty" doc:"Publishing goal"`
	Audience       *string                   `json:"audience,omitempty" doc:"Target audience"`
	ScheduledAt    *time.Time                `json:"scheduled_at,omitempty" doc:"Optional schedule time"`
	ClearSchedule  bool                      `json:"clear_schedule,omitempty" doc:"Clear the proposed schedule"`
	Metadata       map[string]any            `json:"metadata,omitempty" doc:"Safe publication metadata"`
	Segments       []PublicationSegmentInput `json:"segments,omitempty" doc:"Replacement canonical segments"`
	Renditions     []RenditionInput          `json:"renditions,omitempty" doc:"Replacement destination renditions"`
	RepostOverride *repostservice.Override   `json:"repost_override,omitempty" doc:"Per-publication repost override"`
}

type SaveTextPostDraftInput struct {
	PathID string `path:"id" doc:"Text post draft ID"`
	Body   struct {
		ExpectedRevision   int                      `json:"expected_revision" minimum:"1" doc:"Revision loaded by the editor"`
		Content            string                   `json:"content" doc:"First post content"`
		ScheduledAt        *string                  `json:"scheduled_at,omitempty" doc:"Proposed schedule time; empty clears it"`
		SocialAccountIDs   []string                 `json:"social_account_ids" doc:"Replacement destinations"`
		MediaIDs           []string                 `json:"media_ids" doc:"Replacement aggregate media"`
		RandomDelayMinutes int                      `json:"random_delay_minutes,omitempty" doc:"Random schedule delay"`
		ThreadDraft        *string                  `json:"thread_draft,omitempty" doc:"Encoded multi-post draft; empty clears it"`
		Variants           []VariantInput           `json:"variants" doc:"Replacement per-destination text variants"`
		Publication        TextPostPublicationInput `json:"publication" doc:"Canonical segments, media, settings, and destination renditions"`
	}
}

type CreateTextPostDraftInput struct {
	Body struct {
		WorkspaceID        string                   `json:"workspace_id" doc:"Target workspace ID"`
		Content            string                   `json:"content" doc:"First post content"`
		ScheduledAt        *string                  `json:"scheduled_at,omitempty" doc:"Proposed schedule time"`
		SocialAccountIDs   []string                 `json:"social_account_ids" doc:"Destinations"`
		MediaIDs           []string                 `json:"media_ids" doc:"Aggregate media"`
		RandomDelayMinutes int                      `json:"random_delay_minutes,omitempty" doc:"Random schedule delay"`
		ThreadDraft        *string                  `json:"thread_draft,omitempty" doc:"Encoded multi-post draft"`
		Variants           []VariantInput           `json:"variants" doc:"Per-destination text variants"`
		Publication        TextPostPublicationInput `json:"publication" doc:"Canonical segments, media, settings, and destination renditions"`
	}
}

type SaveTextPostDraftOutput struct {
	Body struct {
		PostID        string `json:"post_id"`
		PublicationID string `json:"publication_id"`
		Revision      int    `json:"revision"`
		UpdatedAt     string `json:"updated_at"`
	}
}

type CreateTextPostDraftOutput = SaveTextPostDraftOutput

func publicationUpdateFromTextPost(input TextPostPublicationInput) PublicationUpdateBody {
	return PublicationUpdateBody{
		Title:          input.Title,
		Intent:         input.Intent,
		CreationPreset: input.CreationPreset,
		SocialSetID:    input.SocialSetID,
		ContentProfile: input.ContentProfile,
		SourceText:     input.SourceText,
		SourceURL:      input.SourceURL,
		Goal:           input.Goal,
		Audience:       input.Audience,
		ScheduledAt:    input.ScheduledAt,
		ClearSchedule:  input.ClearSchedule,
		Metadata:       input.Metadata,
		Segments:       input.Segments,
		Renditions:     input.Renditions,
		RepostOverride: input.RepostOverride,
	}
}

type ListPostsInput struct {
	WorkspaceID string `query:"workspace_id" doc:"Filter by workspace ID"`
	Date        string `query:"date" doc:"Filter by date (YYYY-MM-DD)"`
	Status      string `query:"status" doc:"Filter by status (draft, scheduled, published, failed)"`
	Limit       int    `query:"limit" doc:"Limit number of results (default 50, max 200)"`
	Offset      int    `query:"offset" doc:"Offset for pagination"`
}

type ListPostsOutput struct {
	TotalCount int  `header:"X-Total-Count" doc:"Total number of matching posts"`
	Limit      int  `header:"X-Limit" doc:"Applied page limit"`
	Offset     int  `header:"X-Offset" doc:"Applied page offset"`
	NextOffset int  `header:"X-Next-Offset" doc:"Offset for the next page"`
	HasMore    bool `header:"X-Has-More" doc:"Whether another page is available"`
	Body       []PostResponse
}

type ScheduleDayPlatform struct {
	Platform string `json:"platform" doc:"Platform name"`
	Count    int    `json:"count" doc:"Count for this platform on this day"`
}

type ScheduleDayWorkspace struct {
	WorkspaceID string `json:"workspace_id" doc:"Workspace ID"`
	Count       int    `json:"count" doc:"Count for this workspace on this day"`
}

type ScheduleDay struct {
	Date       string                 `json:"date" doc:"Date in YYYY-MM-DD format"`
	Count      int                    `json:"count" doc:"Number of scheduled posts"`
	Platforms  []ScheduleDayPlatform  `json:"platforms" doc:"Per-platform breakdown"`
	Workspaces []ScheduleDayWorkspace `json:"workspaces" doc:"Per-workspace breakdown"`
}

type scheduleDayCounts struct {
	count      int
	platforms  map[string]int
	workspaces map[string]int
}

type scheduleOverviewPeriod struct {
	year  int
	month time.Month
	start time.Time
	end   time.Time
}

type scheduleOverviewPublication struct {
	ID          string    `bun:"id"`
	WorkspaceID string    `bun:"workspace_id"`
	OccursAt    time.Time `bun:"occurs_at"`
}

type ScheduleOverviewInput struct {
	WorkspaceID string `query:"workspace_id" doc:"Filter by workspace ID"`
	Platform    string `query:"platform" doc:"Filter by platform"`
	Month       string `query:"month" doc:"Month in YYYY-MM format (defaults to current month)"`
}

type ScheduleOverviewOutput struct {
	Body struct {
		Year                int             `json:"year" doc:"Year of the overview"`
		Month               int             `json:"month" doc:"Month of the overview (1-12)"`
		SelectedWorkspaceID string          `json:"selected_workspace_id" doc:"Currently selected workspace"`
		SelectedPlatform    string          `json:"selected_platform" doc:"Currently selected platform filter"`
		Workspaces          []WorkspaceResp `json:"workspaces" doc:"Available workspaces"`
		Platforms           []string        `json:"platforms" doc:"Available platforms"`
		Days                []ScheduleDay   `json:"days" doc:"Daily schedule data"`
	}
}

type WorkspaceResp struct {
	WorkspaceID        string `json:"id" doc:"Workspace ID"`
	WorkspaceName      string `json:"name" doc:"Workspace name"`
	WorkspaceCreatedAt string `json:"created_at" doc:"Creation time (ISO 8601)"`
}

func (h *PostHandler) validateAccountsBelongToWorkspace(ctx context.Context, workspaceID string, accountIDs []string) error {
	if len(accountIDs) == 0 {
		return nil
	}

	uniqueIDs := make([]string, 0, len(accountIDs))
	seen := make(map[string]struct{}, len(accountIDs))
	for _, accountID := range accountIDs {
		if _, ok := seen[accountID]; ok {
			continue
		}
		seen[accountID] = struct{}{}
		uniqueIDs = append(uniqueIDs, accountID)
	}

	count, err := h.db.NewSelect().
		Model((*models.SocialAccount)(nil)).
		Where("workspace_id = ?", workspaceID).
		Where("is_active = ?", true).
		Where("id IN (?)", bun.List(uniqueIDs)).
		Count(ctx)
	if err != nil {
		return huma.Error500InternalServerError("failed to validate social accounts")
	}
	if count != len(uniqueIDs) {
		return huma.Error400BadRequest("one or more social accounts are invalid, disconnected, or outside this workspace")
	}
	return nil
}

func (h *PostHandler) validateMediaBelongsToWorkspace(ctx context.Context, workspaceID string, mediaIDs []string) error {
	if len(mediaIDs) == 0 {
		return nil
	}

	uniqueIDs := make([]string, 0, len(mediaIDs))
	seen := make(map[string]struct{}, len(mediaIDs))
	for _, mediaID := range mediaIDs {
		if _, ok := seen[mediaID]; ok {
			continue
		}
		seen[mediaID] = struct{}{}
		uniqueIDs = append(uniqueIDs, mediaID)
	}

	count, err := h.db.NewSelect().
		Model((*models.MediaAttachment)(nil)).
		Where("workspace_id = ?", workspaceID).
		Where("id IN (?)", bun.List(uniqueIDs)).
		Count(ctx)
	if err != nil {
		return huma.Error500InternalServerError("failed to validate media attachments")
	}
	if count != len(uniqueIDs) {
		return huma.Error400BadRequest("one or more media attachments are invalid or outside this workspace")
	}
	return nil
}

func (h *PostHandler) checkScheduledPostQuota(ctx context.Context, workspaceID string, amount int64, scheduledAt time.Time) error {
	current, err := h.usage.CurrentMonthly(ctx, workspaceID, entitlements.LimitScheduledPostsMonthly, scheduledAt)
	if err != nil {
		return huma.Error500InternalServerError("failed to load scheduled post usage")
	}

	decision, err := h.entitlement.Check(ctx, entitlements.Request{
		WorkspaceID: workspaceID,
		Limit:       entitlements.LimitScheduledPostsMonthly,
		Current:     current,
		Amount:      amount,
	})
	if err != nil {
		return huma.Error500InternalServerError("failed to check scheduled post limit")
	}
	if !decision.Allowed {
		reason := decision.Reason
		if reason == "" {
			reason = "scheduled post limit exceeded"
		}
		return huma.NewError(http.StatusPaymentRequired, reason)
	}
	return nil
}

func (h *PostHandler) recordScheduledPostUsage(ctx context.Context, workspaceID string, amount int64, scheduledAt time.Time) error {
	if _, err := h.usage.IncrementMonthly(ctx, workspaceID, entitlements.LimitScheduledPostsMonthly, amount, scheduledAt); err != nil {
		return huma.Error500InternalServerError("failed to record scheduled post usage")
	}
	return nil
}

func postServiceError(err error, fallback string) error {
	if err == nil {
		return nil
	}
	var userErr postservice.UserError
	if errors.As(err, &userErr) {
		return huma.Error400BadRequest(userErr.Message)
	}
	return huma.Error500InternalServerError(fallback)
}

func (h *PostHandler) prepareLegacyPostMutationTx(ctx context.Context, tx bun.Tx, postID string) error {
	return databasemigrations.MigrateLegacyPublicationAuthoringForActorTx(
		ctx,
		tx,
		postID,
		publicationAuthorizationActor(ctx, middleware.GetUserID(ctx)),
	)
}

func (h *PostHandler) prepareEditableLegacyPostMutationTx(
	ctx context.Context,
	tx bun.Tx,
	postID string,
) (*models.Post, error) {
	if err := h.prepareLegacyPostMutationTx(ctx, tx, postID); err != nil {
		return nil, err
	}
	post, err := h.lockTextPostTx(ctx, tx, postID)
	if err != nil {
		return nil, err
	}
	if !isTextPostEditable(post.Status) {
		return nil, errPublicationNotEditable
	}
	if strings.TrimSpace(post.PublicationID) == "" {
		return post, nil
	}
	var publication models.Publication
	if err := tx.NewSelect().Model(&publication).Where("id = ?", post.PublicationID).Scan(ctx); err != nil {
		return nil, err
	}
	if publication.Status == models.PublicationStatusPublishing ||
		publication.Status == models.PublicationStatusPublished {
		return nil, errPublicationNotEditable
	}
	return post, nil
}

func (h *PostHandler) finishLegacyPostMutationTx(ctx context.Context, tx bun.Tx, postID string) error {
	return databasemigrations.SyncTextPostAuthoringForActorTx(
		ctx,
		tx,
		postID,
		publicationAuthorizationActor(ctx, middleware.GetUserID(ctx)),
	)
}

//nolint:gocyclo
func (h *PostHandler) CreatePost(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "create-post",
		Method:      http.MethodPost,
		Path:        "/posts",
		Summary:     "Create a new post",
		Tags:        []string{tagPosts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 402},
	}, func(ctx context.Context, input *CreatePostInput) (*CreatePostOutput, error) {
		userID := middleware.GetUserID(ctx)
		if err := h.checkWorkspaceEditAccess(ctx, input.Body.WorkspaceID, userID); err != nil {
			return nil, err
		}
		if err := h.validateAccountsBelongToWorkspace(ctx, input.Body.WorkspaceID, input.Body.SocialAccountIDs); err != nil {
			return nil, err
		}
		if err := h.validateMediaBelongsToWorkspace(ctx, input.Body.WorkspaceID, input.Body.MediaIDs); err != nil {
			return nil, err
		}

		status := statusDraft
		var jobRunAt time.Time
		if input.Body.ScheduledAt != nil {
			status = statusScheduled
		}
		if status == statusScheduled {
			if err := h.posts.ValidateScheduledProviderMedia(ctx, input.Body.WorkspaceID, input.Body.SocialAccountIDs, input.Body.MediaIDs); err != nil {
				return nil, postServiceError(err, "failed to validate provider media")
			}
			if err := h.checkScheduledPostQuota(ctx, input.Body.WorkspaceID, 1, *input.Body.ScheduledAt); err != nil {
				return nil, err
			}
			var err error
			jobRunAt, err = resolveFuturePostRunAt(*input.Body.ScheduledAt, input.Body.RandomDelayMinutes, time.Now().UTC())
			if err != nil {
				return nil, huma.Error400BadRequest(err.Error())
			}
		}

		now := time.Now().UTC()
		post := &models.Post{
			ID:                 uuid.New().String(),
			WorkspaceID:        input.Body.WorkspaceID,
			CreatedByID:        userID,
			Content:            input.Body.Content,
			Status:             status,
			Revision:           1,
			RandomDelayMinutes: input.Body.RandomDelayMinutes,
			CreatedAt:          now,
			UpdatedAt:          now,
		}
		if input.Body.ScheduledAt != nil {
			post.ScheduledAt = *input.Body.ScheduledAt
		}

		// Normalise any thread-draft data: prefer the new explicit
		// `thread_draft` field, fall back to detecting the legacy blob
		// in `content`. The result is a clean `posts.content` and an
		// optional `thread_drafts.draft_json` to be written below.
		var draftJSON *string
		post.Content, draftJSON = postservice.ResolveThreadDraftInput(input.Body.Content, input.Body.ThreadDraft)

		destinations := make([]models.PostDestination, 0, len(input.Body.SocialAccountIDs))
		for _, accID := range input.Body.SocialAccountIDs {
			destinations = append(destinations, models.PostDestination{
				ID:              uuid.New().String(),
				PostID:          post.ID,
				SocialAccountID: accID,
				Status:          postStatusPending,
			})
		}

		postMedia := make([]models.PostMedia, 0, len(input.Body.MediaIDs))
		for i, mediaID := range input.Body.MediaIDs {
			postMedia = append(postMedia, models.PostMedia{
				PostID:       post.ID,
				MediaID:      mediaID,
				DisplayOrder: i,
			})
		}

		err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			if _, err := tx.NewInsert().Model(post).Exec(txCtx); err != nil {
				return err
			}
			if len(destinations) > 0 {
				if _, err := tx.NewInsert().Model(&destinations).Exec(txCtx); err != nil {
					return err
				}
			}
			if len(postMedia) > 0 {
				if _, err := tx.NewInsert().Model(&postMedia).Exec(txCtx); err != nil {
					return err
				}
			}
			if err := medialifecycle.TouchWithDB(txCtx, tx, input.Body.MediaIDs, now); err != nil {
				return err
			}
			if post.Status == statusScheduled {
				payload, err := json.Marshal(map[string]string{postIDKey: post.ID})
				if err != nil {
					return fmt.Errorf("failed to marshal job payload: %w", err)
				}
				post.ActualRunAt = jobRunAt
				job, err := newPublishPostJob(string(payload), jobRunAt, post.ID, "")
				if err != nil {
					return err
				}
				if _, err := tx.NewInsert().Model(job).Exec(txCtx); err != nil {
					return err
				}
				// Update post with actual_run_at
				if _, err := tx.NewUpdate().Model(post).Column("actual_run_at").Where("id = ?", post.ID).Exec(txCtx); err != nil {
					return err
				}
			}
			// Persist the thread_drafts row if the request carried a
			// thread draft. The migration has ensured the table exists.
			if err := postservice.UpsertThreadDraftTx(txCtx, tx, post.ID, draftJSON); err != nil {
				return err
			}
			return databasemigrations.MigrateLegacyPublicationAuthoringForActorTx(
				txCtx,
				tx,
				post.ID,
				publicationAuthorizationActor(txCtx, userID),
			)
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to create post")
		}
		if err := h.db.NewSelect().
			Model(post).
			Column("publication_id").
			Where("id = ?", post.ID).
			Scan(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to load translated publication")
		}
		if post.Status == statusScheduled {
			if err := h.recordScheduledPostUsage(ctx, input.Body.WorkspaceID, 1, post.ScheduledAt); err != nil {
				return nil, err
			}
		}

		resp := &CreatePostOutput{}
		resp.Body = &PostResponse{
			ID:                 post.ID,
			PublicationID:      post.PublicationID,
			WorkspaceID:        post.WorkspaceID,
			CreatedByID:        post.CreatedByID,
			ParentPostID:       post.ParentPostID,
			ThreadSequence:     post.ThreadSequence,
			Content:            post.Content,
			Status:             post.Status,
			Revision:           post.Revision,
			ScheduledAt:        post.ScheduledAt.Format(time.RFC3339),
			RandomDelayMinutes: post.RandomDelayMinutes,
			CreatedAt:          post.CreatedAt.Format(time.RFC3339),
			UpdatedAt:          post.UpdatedAt.Format(time.RFC3339),
			ThreadDraft:        draftJSON,
		}
		if !post.ActualRunAt.IsZero() {
			resp.Body.ActualRunAt = post.ActualRunAt.Format(time.RFC3339)
		}
		return resp, nil
	})
}

func (h *PostHandler) ListPosts(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-posts",
		Method:      http.MethodGet,
		Path:        "/posts",
		Summary:     "List posts for a workspace",
		Tags:        []string{tagPosts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.listPosts)
}

func (h *PostHandler) listPosts(ctx context.Context, input *ListPostsInput) (*ListPostsOutput, error) {
	limit, err := listPostsLimit(input)
	if err != nil {
		return nil, err
	}

	workspaceIDs, err := h.listPostWorkspaceIDs(ctx, input.WorkspaceID)
	if err != nil {
		return nil, err
	}
	if len(workspaceIDs) == 0 {
		return listPostsOutput([]PostResponse{}, 0, limit, input.Offset), nil
	}
	dateRange, err := h.listPostsDateRange(ctx, input)
	if err != nil {
		return nil, err
	}

	totalQuery := h.listPostsQuery((*models.Post)(nil), input, workspaceIDs, dateRange)
	total, err := totalQuery.Count(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to count posts")
	}

	var posts []models.Post
	query := h.listPostsQuery(&posts, input, workspaceIDs, dateRange)
	if err := applyListPostsOrder(query).Limit(limit).Offset(input.Offset).Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to list posts")
	}

	result, err := h.postResponsesForList(ctx, posts)
	if err != nil {
		return nil, err
	}
	return listPostsOutput(result, total, limit, input.Offset), nil
}

type listPostsDateRange struct {
	start time.Time
	end   time.Time
}

func (h *PostHandler) listPostsDateRange(ctx context.Context, input *ListPostsInput) (*listPostsDateRange, error) {
	if input.Date == "" {
		return nil, nil
	}

	parsed, err := time.Parse("2006-01-02", input.Date)
	if err != nil {
		return nil, huma.Error400BadRequest("date must be in YYYY-MM-DD format")
	}

	location := time.UTC
	workspaceID := strings.TrimSpace(input.WorkspaceID)
	if workspaceID == "" {
		workspaceID = strings.TrimSpace(middleware.GetWorkspaceID(ctx))
	}
	if workspaceID != "" {
		var workspace struct {
			Timezone string `bun:"timezone"`
		}
		if err := h.db.NewSelect().TableExpr("workspaces").Column("timezone").Where("id = ?", workspaceID).Scan(ctx, &workspace); err != nil {
			return nil, huma.Error500InternalServerError("failed to load workspace timezone")
		}
		if workspace.Timezone != "" {
			if workspaceLocation, err := time.LoadLocation(workspace.Timezone); err == nil {
				location = workspaceLocation
			}
		}
	}

	dayStart := time.Date(parsed.Year(), parsed.Month(), parsed.Day(), 0, 0, 0, 0, location)
	dayEnd := dayStart.AddDate(0, 0, 1)
	return &listPostsDateRange{start: dayStart.UTC(), end: dayEnd.UTC()}, nil
}

func resolveFuturePostRunAt(scheduledAt time.Time, randomDelayMinutes int, now time.Time) (time.Time, error) {
	now = now.UTC()
	if !scheduledAt.After(now) {
		return time.Time{}, errPostScheduleFuture
	}

	if randomDelayMinutes > 0 {
		const maxDurationMinutes = (1<<63 - 1) / int64(time.Minute)
		delayMinutes := int64(randomDelayMinutes)
		if delayMinutes > maxDurationMinutes {
			return time.Time{}, errPostRunAtFuture
		}
		earliestRunAt := scheduledAt.Add(-time.Duration(delayMinutes) * time.Minute)
		if !earliestRunAt.After(now) {
			return time.Time{}, errPostRunAtFuture
		}
	}

	actualRunAt := postservice.ApplyRandomDelay(scheduledAt, randomDelayMinutes)
	if !actualRunAt.After(now) {
		return time.Time{}, errPostRunAtFuture
	}
	return actualRunAt, nil
}

func listPostsLimit(input *ListPostsInput) (int, error) {
	if input.Offset < 0 {
		return 0, huma.Error400BadRequest("offset must be greater than or equal to 0")
	}
	if input.Limit <= 0 || input.Limit > 200 {
		return 50, nil
	}
	return input.Limit, nil
}

func (h *PostHandler) listPostWorkspaceIDs(ctx context.Context, requestedWorkspaceID string) ([]string, error) {
	userID := middleware.GetUserID(ctx)
	if requestedWorkspaceID != "" {
		if err := h.checkWorkspaceAccess(ctx, requestedWorkspaceID, userID); err != nil {
			return nil, err
		}
		return []string{requestedWorkspaceID}, nil
	}
	if scopedWorkspaceID := strings.TrimSpace(middleware.GetWorkspaceID(ctx)); scopedWorkspaceID != "" {
		if err := h.checkWorkspaceAccess(ctx, scopedWorkspaceID, userID); err != nil {
			return nil, err
		}
		return []string{scopedWorkspaceID}, nil
	}

	var workspaceMembers []models.WorkspaceMember
	err := h.db.NewSelect().
		Model(&workspaceMembers).
		Where("user_id = ? AND status = ?", userID, models.WorkspaceMemberStatusActive).
		Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error500InternalServerError("failed to fetch workspaces")
	}

	workspaceIDs := make([]string, 0, len(workspaceMembers))
	for _, wm := range workspaceMembers {
		allowed, accessErr := middleware.CheckWorkspaceAccess(ctx, h.db, wm.WorkspaceID, userID)
		if accessErr != nil {
			return nil, huma.Error500InternalServerError("failed to check workspace access")
		}
		if allowed {
			workspaceIDs = append(workspaceIDs, wm.WorkspaceID)
		}
	}
	return workspaceIDs, nil
}

func (h *PostHandler) listPostsQuery(model interface{}, input *ListPostsInput, workspaceIDs []string, dateRange *listPostsDateRange) *bun.SelectQuery {
	query := h.db.NewSelect().
		Model(model).
		Where("workspace_id IN (?)", bun.List(workspaceIDs))

	if input.Status != "" {
		query = query.Where("status = ?", input.Status)
	}
	if dateRange != nil {
		query = query.Where("scheduled_at >= ? AND scheduled_at < ?", dateRange.start, dateRange.end)
	}
	return query
}

func (h *PostHandler) postResponsesForList(ctx context.Context, posts []models.Post) ([]PostResponse, error) {
	postIDs := make([]string, len(posts))
	for i, p := range posts {
		postIDs[i] = p.ID
	}

	destByPost, err := h.listPostDestinations(ctx, postIDs)
	if err != nil {
		return nil, err
	}
	mediaByPost, err := h.listPostMediaIDs(ctx, postIDs)
	if err != nil {
		return nil, err
	}

	result := make([]PostResponse, len(posts))
	for i, p := range posts {
		result[i] = postResponseForList(p, destByPost[p.ID], mediaByPost[p.ID])
	}
	return result, nil
}

func (h *PostHandler) listPostDestinations(ctx context.Context, postIDs []string) (map[string][]PostDestinationResponse, error) {
	destByPost := make(map[string][]PostDestinationResponse)
	if len(postIDs) == 0 {
		return destByPost, nil
	}

	var destinations []struct {
		PostID          string    `bun:"post_id"`
		SocialAccountID string    `bun:"social_account_id"`
		Platform        string    `bun:"platform"`
		Status          string    `bun:"status"`
		ErrorMessage    string    `bun:"error_message"`
		ErrorKind       string    `bun:"error_kind"`
		ErrorCode       string    `bun:"error_code"`
		ErrorHTTPStatus int       `bun:"error_http_status"`
		ErrorRetryable  bool      `bun:"error_retryable"`
		ErrorRetryAt    time.Time `bun:"error_retry_at"`
		ErrorAction     string    `bun:"error_action"`
	}
	err := h.db.NewSelect().
		TableExpr("post_destinations AS pd").
		ColumnExpr("pd.post_id, pd.social_account_id, sa.platform, pd.status, pd.error_message, pd.error_kind, pd.error_code, pd.error_http_status, pd.error_retryable, pd.error_retry_at, pd.error_action").
		Join("JOIN social_accounts AS sa ON sa.id = pd.social_account_id").
		Where("pd.post_id IN (?)", bun.List(postIDs)).
		Scan(ctx, &destinations)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to fetch destinations")
	}

	for _, d := range destinations {
		destByPost[d.PostID] = append(destByPost[d.PostID], PostDestinationResponse{
			SocialAccountID: d.SocialAccountID,
			Platform:        d.Platform,
			Status:          d.Status,
			ErrorMessage:    d.ErrorMessage,
			ErrorKind:       d.ErrorKind,
			ErrorCode:       d.ErrorCode,
			ErrorHTTPStatus: d.ErrorHTTPStatus,
			ErrorRetryable:  d.ErrorRetryable,
			ErrorRetryAt:    formatOptionalTime(d.ErrorRetryAt),
			ErrorAction:     d.ErrorAction,
		})
	}
	return destByPost, nil
}

func (h *PostHandler) listPostMediaIDs(ctx context.Context, postIDs []string) (map[string][]string, error) {
	mediaByPost := make(map[string][]string)
	if len(postIDs) == 0 {
		return mediaByPost, nil
	}

	var postMediaRows []struct {
		PostID  string `bun:"post_id"`
		MediaID string `bun:"media_id"`
	}
	err := h.db.NewSelect().
		TableExpr("post_media AS pm").
		ColumnExpr("pm.post_id, pm.media_id").
		Where("pm.post_id IN (?)", bun.List(postIDs)).
		Order("pm.display_order ASC").
		Scan(ctx, &postMediaRows)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to fetch media")
	}

	for _, m := range postMediaRows {
		mediaByPost[m.PostID] = append(mediaByPost[m.PostID], m.MediaID)
	}
	return mediaByPost, nil
}

func postResponseForList(p models.Post, destinations []PostDestinationResponse, mediaIDs []string) PostResponse {
	resp := PostResponse{
		ID:                 p.ID,
		PublicationID:      p.PublicationID,
		WorkspaceID:        p.WorkspaceID,
		CreatedByID:        p.CreatedByID,
		ParentPostID:       p.ParentPostID,
		ThreadSequence:     p.ThreadSequence,
		Content:            p.Content,
		Status:             p.Status,
		Revision:           p.Revision,
		ScheduledAt:        p.ScheduledAt.Format(time.RFC3339),
		RandomDelayMinutes: p.RandomDelayMinutes,
		CreatedAt:          p.CreatedAt.Format(time.RFC3339),
		UpdatedAt:          p.UpdatedAt.Format(time.RFC3339),
		Destinations:       destinations,
		MediaIDs:           mediaIDs,
	}
	if !p.ActualRunAt.IsZero() {
		resp.ActualRunAt = p.ActualRunAt.Format(time.RFC3339)
	}
	return resp
}

func listPostsOutput(body []PostResponse, total, limit, offset int) *ListPostsOutput {
	return &ListPostsOutput{
		TotalCount: total,
		Limit:      limit,
		Offset:     offset,
		NextOffset: offset + len(body),
		HasMore:    offset+len(body) < total,
		Body:       body,
	}
}

func applyListPostsOrder(query *bun.SelectQuery) *bun.SelectQuery {
	return query.OrderExpr("COALESCE(scheduled_at, created_at) DESC")
}

//nolint:gocyclo
func (h *PostHandler) GetScheduleOverview(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-schedule-overview",
		Method:      http.MethodGet,
		Path:        "/posts/schedule-overview",
		Summary:     "Get canonical publication schedule overview",
		Description: "Compatibility path for a monthly summary sourced exclusively from canonical publications and renditions.",
		Tags:        []string{tagPosts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *ScheduleOverviewInput) (*ScheduleOverviewOutput, error) {
		userID := middleware.GetUserID(ctx)
		scopedWorkspaceID := strings.TrimSpace(middleware.GetWorkspaceID(ctx))
		if input.WorkspaceID != "" && !middleware.WorkspaceScopeAllows(ctx, input.WorkspaceID) {
			return nil, huma.Error403Forbidden("workspace not accessible")
		}

		var workspaces []models.Workspace
		workspaceQuery := h.db.NewSelect().
			Model(&workspaces).
			Join("JOIN workspace_members AS wm ON wm.workspace_id = workspace.id").
			Where("wm.user_id = ? AND wm.status = ?", userID, models.WorkspaceMemberStatusActive).
			Order("workspace.created_at DESC")
		if scopedWorkspaceID != "" {
			workspaceQuery = workspaceQuery.Where("workspace.id = ?", scopedWorkspaceID)
		}
		err := workspaceQuery.Scan(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch workspaces")
		}
		accessibleWorkspaces := make([]models.Workspace, 0, len(workspaces))
		for _, workspace := range workspaces {
			allowed, accessErr := middleware.CheckWorkspaceAccess(ctx, h.db, workspace.ID, userID)
			if accessErr != nil {
				return nil, huma.Error500InternalServerError("failed to check workspace access")
			}
			if allowed {
				accessibleWorkspaces = append(accessibleWorkspaces, workspace)
			}
		}
		workspaces = accessibleWorkspaces

		selectedWorkspaceID := input.WorkspaceID
		if selectedWorkspaceID == "" && len(workspaces) > 0 {
			selectedWorkspaceID = workspaces[0].ID
		}

		if selectedWorkspaceID != "" {
			isMember := false
			for _, ws := range workspaces {
				if ws.ID == selectedWorkspaceID {
					isMember = true
					break
				}
			}
			if !isMember {
				return nil, huma.Error403Forbidden("workspace not accessible")
			}
		}

		location := time.UTC
		if selectedWorkspaceID != "" {
			for _, workspace := range workspaces {
				if workspace.ID == selectedWorkspaceID && workspace.Timezone != "" {
					if workspaceLocation, loadErr := time.LoadLocation(workspace.Timezone); loadErr == nil {
						location = workspaceLocation
					}
					break
				}
			}
		}
		period, err := resolveScheduleOverviewPeriod(input.Month, location, time.Now())
		if err != nil {
			return nil, huma.Error400BadRequest("month must be in YYYY-MM format")
		}

		selectedPlatform := input.Platform

		var platformRows []struct {
			Platform string `bun:"platform"`
		}
		if selectedWorkspaceID != "" {
			if err = h.db.NewSelect().
				TableExpr("social_accounts AS sa").
				ColumnExpr("DISTINCT sa.platform AS platform").
				Join("JOIN workspace_members AS wm ON wm.workspace_id = sa.workspace_id").
				Where("wm.user_id = ? AND wm.status = ?", userID, models.WorkspaceMemberStatusActive).
				Where("sa.is_active = ?", true).
				Where("sa.workspace_id = ?", selectedWorkspaceID).
				Scan(ctx, &platformRows); err != nil {
				return nil, huma.Error500InternalServerError("failed to fetch platforms")
			}
		}

		platforms := make([]string, 0, len(platformRows))
		for _, row := range platformRows {
			if row.Platform != "" {
				platforms = append(platforms, row.Platform)
			}
		}
		sort.Strings(platforms)

		if selectedPlatform != "" {
			hasSelectedPlatform := false
			for _, p := range platforms {
				if p == selectedPlatform {
					hasSelectedPlatform = true
					break
				}
			}
			if !hasSelectedPlatform {
				return nil, huma.Error400BadRequest("invalid platform filter")
			}
		}

		var scheduledPublications []scheduleOverviewPublication
		if selectedWorkspaceID != "" {
			occurrenceSQL := `CASE
				WHEN publication.status = 'published' THEN COALESCE(publication.actual_run_at, publication.scheduled_at, publication.updated_at, publication.created_at)
				ELSE publication.scheduled_at
			END`
			var publicationRows []models.Publication
			if err = h.db.NewSelect().
				Model(&publicationRows).
				ModelTableExpr("publications AS publication").
				ColumnExpr("publication.*").
				Where("publication.workspace_id = ?", selectedWorkspaceID).
				Where("publication.status IN (?)", bun.List([]string{
					models.PublicationStatusScheduled,
					models.PublicationStatusPublishing,
					models.PublicationStatusPublished,
				})).
				Where(occurrenceSQL+" >= ?", period.start).
				Where(occurrenceSQL+" < ?", period.end).
				Scan(ctx); err != nil {
				return nil, huma.Error500InternalServerError("failed to fetch publication schedule days")
			}
			scheduledPublications = make([]scheduleOverviewPublication, 0, len(publicationRows))
			for _, publication := range publicationRows {
				occursAt := publication.ScheduledAt
				if publication.Status == models.PublicationStatusPublished {
					occursAt = firstNonZeroTime(
						publication.ActualRunAt,
						publication.ScheduledAt,
						publication.UpdatedAt,
						publication.CreatedAt,
					)
				}
				scheduledPublications = append(scheduledPublications, scheduleOverviewPublication{
					ID: publication.ID, WorkspaceID: publication.WorkspaceID, OccursAt: occursAt,
				})
			}
		}

		platformsByPublication := make(map[string][]string, len(scheduledPublications))
		if len(scheduledPublications) > 0 {
			publicationIDs := make([]string, 0, len(scheduledPublications))
			for _, publication := range scheduledPublications {
				publicationIDs = append(publicationIDs, publication.ID)
			}
			var destinationRows []struct {
				PublicationID string `bun:"publication_id"`
				Platform      string `bun:"platform"`
			}
			if err = h.db.NewSelect().
				TableExpr("renditions AS rendition").
				ColumnExpr("rendition.publication_id, rendition.platform").
				Where("rendition.publication_id IN (?)", bun.List(publicationIDs)).
				Scan(ctx, &destinationRows); err != nil {
				return nil, huma.Error500InternalServerError("failed to fetch publication schedule details")
			}
			for _, row := range destinationRows {
				platformsByPublication[row.PublicationID] = append(platformsByPublication[row.PublicationID], row.Platform)
			}
		}

		days := buildScheduleOverviewDays(scheduledPublications, platformsByPublication, location, selectedPlatform)

		resp := &ScheduleOverviewOutput{}
		resp.Body.Year = period.year
		resp.Body.Month = int(period.month)
		resp.Body.SelectedWorkspaceID = selectedWorkspaceID
		resp.Body.SelectedPlatform = selectedPlatform
		resp.Body.Workspaces = make([]WorkspaceResp, len(workspaces))
		for i, ws := range workspaces {
			resp.Body.Workspaces[i] = WorkspaceResp{
				WorkspaceID:        ws.ID,
				WorkspaceName:      ws.Name,
				WorkspaceCreatedAt: ws.CreatedAt.Format(time.RFC3339),
			}
		}
		resp.Body.Platforms = platforms
		resp.Body.Days = days
		return resp, nil
	})
}

func firstNonZeroTime(values ...time.Time) time.Time {
	for _, value := range values {
		if !value.IsZero() {
			return value
		}
	}
	return time.Time{}
}

func resolveScheduleOverviewPeriod(month string, location *time.Location, now time.Time) (scheduleOverviewPeriod, error) {
	if location == nil {
		location = time.UTC
	}

	localNow := now.In(location)
	year, resolvedMonth := localNow.Year(), localNow.Month()
	if month != "" {
		parsed, err := time.Parse("2006-01", month)
		if err != nil {
			return scheduleOverviewPeriod{}, err
		}
		year, resolvedMonth = parsed.Year(), parsed.Month()
	}

	localStart := time.Date(year, resolvedMonth, 1, 0, 0, 0, 0, location)
	return scheduleOverviewPeriod{
		year:  year,
		month: resolvedMonth,
		start: localStart.UTC(),
		end:   localStart.AddDate(0, 1, 0).UTC(),
	}, nil
}

func buildScheduleOverviewDays(
	publications []scheduleOverviewPublication,
	platformsByPublication map[string][]string,
	location *time.Location,
	selectedPlatform string,
) []ScheduleDay {
	if location == nil {
		location = time.UTC
	}
	countsByDate := make(map[string]*scheduleDayCounts)
	for _, publication := range publications {
		if publication.OccursAt.IsZero() {
			continue
		}
		platforms, matches := schedulePlatformsForPost(platformsByPublication[publication.ID], selectedPlatform)
		if !matches {
			continue
		}

		date := publication.OccursAt.In(location).Format("2006-01-02")
		counts := countsByDate[date]
		if counts == nil {
			counts = &scheduleDayCounts{
				platforms:  make(map[string]int),
				workspaces: make(map[string]int),
			}
			countsByDate[date] = counts
		}
		counts.count++
		counts.workspaces[publication.WorkspaceID]++
		for _, platform := range platforms {
			counts.platforms[platform]++
		}
	}

	dates := sortedCountKeys(countsByDate)
	days := make([]ScheduleDay, 0, len(dates))
	for _, date := range dates {
		days = append(days, scheduleDayFromCounts(date, countsByDate[date]))
	}
	return days
}

func schedulePlatformsForPost(platforms []string, selectedPlatform string) ([]string, bool) {
	platformSet := make(map[string]struct{})
	for _, platform := range platforms {
		if platform != "" {
			platformSet[platform] = struct{}{}
		}
	}
	if selectedPlatform != "" {
		if _, matches := platformSet[selectedPlatform]; !matches {
			return nil, false
		}
		return []string{selectedPlatform}, true
	}

	platformNames := make([]string, 0, len(platformSet))
	for platform := range platformSet {
		platformNames = append(platformNames, platform)
	}
	sort.Strings(platformNames)
	return platformNames, true
}

func sortedCountKeys[T any](counts map[string]T) []string {
	keys := make([]string, 0, len(counts))
	for key := range counts {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func scheduleDayFromCounts(date string, counts *scheduleDayCounts) ScheduleDay {
	day := ScheduleDay{
		Date:       date,
		Count:      counts.count,
		Platforms:  make([]ScheduleDayPlatform, 0, len(counts.platforms)),
		Workspaces: make([]ScheduleDayWorkspace, 0, len(counts.workspaces)),
	}
	for _, platform := range sortedCountKeys(counts.platforms) {
		day.Platforms = append(day.Platforms, ScheduleDayPlatform{
			Platform: platform,
			Count:    counts.platforms[platform],
		})
	}
	for _, workspaceID := range sortedCountKeys(counts.workspaces) {
		day.Workspaces = append(day.Workspaces, ScheduleDayWorkspace{
			WorkspaceID: workspaceID,
			Count:       counts.workspaces[workspaceID],
		})
	}
	return day
}

type ThreadPostInput struct {
	Content  string   `json:"content" doc:"Post content"`
	MediaIDs []string `json:"media_ids,omitempty" doc:"Media attachment IDs"`
}

type CreateThreadInput struct {
	Body struct {
		WorkspaceID        string            `json:"workspace_id" doc:"Target workspace ID"`
		ScheduledAt        *time.Time        `json:"scheduled_at,omitempty" doc:"Schedule time (ISO 8601). Omit for draft."`
		SocialAccountIDs   []string          `json:"social_account_ids" doc:"Social account IDs to publish to"`
		Posts              []ThreadPostInput `json:"posts" minItems:"2" doc:"Thread posts in order"`
		RandomDelayMinutes int               `json:"random_delay_minutes,omitempty" doc:"Random delay in minutes (±N) to add for natural posting"`
	}
}

type CreateThreadOutput struct {
	Body struct {
		PostIDs []string `json:"post_ids" doc:"Created post IDs in order"`
	}
}

//nolint:gocyclo
func (h *PostHandler) CreateThread(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "create-thread",
		Method:      http.MethodPost,
		Path:        "/posts/thread",
		Summary:     "Create a thread of posts",
		Tags:        []string{tagPosts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 402},
	}, func(ctx context.Context, input *CreateThreadInput) (*CreateThreadOutput, error) {
		userID := middleware.GetUserID(ctx)
		if err := h.checkWorkspaceEditAccess(ctx, input.Body.WorkspaceID, userID); err != nil {
			return nil, err
		}
		if err := h.validateAccountsBelongToWorkspace(ctx, input.Body.WorkspaceID, input.Body.SocialAccountIDs); err != nil {
			return nil, err
		}

		var allMediaIDs []string
		for _, threadPost := range input.Body.Posts {
			allMediaIDs = append(allMediaIDs, threadPost.MediaIDs...)
		}
		if err := h.validateMediaBelongsToWorkspace(ctx, input.Body.WorkspaceID, allMediaIDs); err != nil {
			return nil, err
		}
		if err := h.validateAccountsBelongToWorkspace(ctx, input.Body.WorkspaceID, input.Body.SocialAccountIDs); err != nil {
			return nil, err
		}

		if len(input.Body.Posts) < 2 {
			return nil, huma.Error400BadRequest("a thread must have at least 2 posts")
		}

		status := statusDraft
		var jobRunAt time.Time
		if input.Body.ScheduledAt != nil {
			status = statusScheduled
		}
		if status == statusScheduled {
			for _, threadPost := range input.Body.Posts {
				if err := h.posts.ValidateScheduledProviderMedia(ctx, input.Body.WorkspaceID, input.Body.SocialAccountIDs, threadPost.MediaIDs); err != nil {
					return nil, postServiceError(err, "failed to validate provider media")
				}
			}
			if err := h.checkScheduledPostQuota(ctx, input.Body.WorkspaceID, int64(len(input.Body.Posts)), *input.Body.ScheduledAt); err != nil {
				return nil, err
			}
			var err error
			jobRunAt, err = resolveFuturePostRunAt(*input.Body.ScheduledAt, input.Body.RandomDelayMinutes, time.Now().UTC())
			if err != nil {
				return nil, huma.Error400BadRequest(err.Error())
			}
		}

		posts := make([]*models.Post, 0, len(input.Body.Posts))
		var allDestinations []models.PostDestination
		var allPostMedia []models.PostMedia

		for i, threadPost := range input.Body.Posts {
			post := &models.Post{
				ID:                 uuid.New().String(),
				WorkspaceID:        input.Body.WorkspaceID,
				CreatedByID:        userID,
				Content:            threadPost.Content,
				Status:             status,
				ThreadSequence:     i,
				RandomDelayMinutes: input.Body.RandomDelayMinutes,
				CreatedAt:          time.Now().UTC(),
			}
			if input.Body.ScheduledAt != nil {
				post.ScheduledAt = *input.Body.ScheduledAt
			}
			if i > 0 {
				post.ParentPostID = posts[i-1].ID
			}
			posts = append(posts, post)

			for _, accID := range input.Body.SocialAccountIDs {
				allDestinations = append(allDestinations, models.PostDestination{
					ID:              uuid.New().String(),
					PostID:          post.ID,
					SocialAccountID: accID,
					Status:          postStatusPending,
				})
			}

			for j, mediaID := range threadPost.MediaIDs {
				allPostMedia = append(allPostMedia, models.PostMedia{
					PostID:       post.ID,
					MediaID:      mediaID,
					DisplayOrder: j,
				})
			}
		}

		err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			for _, post := range posts {
				if _, err := tx.NewInsert().Model(post).Exec(txCtx); err != nil {
					return err
				}
			}
			if len(allDestinations) > 0 {
				if _, err := tx.NewInsert().Model(&allDestinations).Exec(txCtx); err != nil {
					return err
				}
			}
			if len(allPostMedia) > 0 {
				if _, err := tx.NewInsert().Model(&allPostMedia).Exec(txCtx); err != nil {
					return err
				}
			}
			threadMediaIDs := make([]string, 0, len(allPostMedia))
			for _, media := range allPostMedia {
				threadMediaIDs = append(threadMediaIDs, media.MediaID)
			}
			if err := medialifecycle.TouchWithDB(txCtx, tx, threadMediaIDs, time.Now().UTC()); err != nil {
				return err
			}
			if status == statusScheduled {
				payload, _ := json.Marshal(map[string]string{postIDKey: posts[0].ID})
				// Update all posts with actual_run_at
				for _, post := range posts {
					post.ActualRunAt = jobRunAt
				}
				job, err := newPublishPostJob(string(payload), jobRunAt, posts[0].ID, "")
				if err != nil {
					return err
				}
				if _, err := tx.NewInsert().Model(job).Exec(txCtx); err != nil {
					return err
				}
				// Update all posts with actual_run_at
				for _, post := range posts {
					if _, err := tx.NewUpdate().Model(post).Column("actual_run_at").Where("id = ?", post.ID).Exec(txCtx); err != nil {
						return err
					}
				}
			}
			return databasemigrations.MigrateLegacyPublicationAuthoringForActorTx(
				txCtx,
				tx,
				posts[0].ID,
				publicationAuthorizationActor(txCtx, userID),
			)
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to create thread")
		}
		if status == statusScheduled {
			if err := h.recordScheduledPostUsage(ctx, input.Body.WorkspaceID, int64(len(posts)), *input.Body.ScheduledAt); err != nil {
				return nil, err
			}
		}

		postIDs := make([]string, len(posts))
		for i, post := range posts {
			postIDs[i] = post.ID
		}

		resp := &CreateThreadOutput{}
		resp.Body.PostIDs = postIDs
		return resp, nil
	})
}

type GetPostInput struct {
	PathID string `path:"id" doc:"Post ID"`
}

type GetPostOutput struct {
	Body *PostDetailResponse
}

type PostMediaResponse struct {
	MediaID      string `json:"media_id" doc:"Media ID"`
	DisplayOrder int    `json:"display_order" doc:"Display order"`
	FilePath     string `json:"file_path" doc:"File path for media URL"`
	MimeType     string `json:"mime_type" doc:"Media MIME type"`
	AltText      string `json:"alt_text" doc:"Alt text for accessibility"`
}

type PostDetailResponse struct {
	ID                 string                    `json:"id" doc:"Post ID"`
	PublicationID      string                    `json:"publication_id,omitempty" doc:"Canonical publication ID for the text composer"`
	WorkspaceID        string                    `json:"workspace_id" doc:"Workspace ID"`
	CreatedByID        string                    `json:"created_by" doc:"Creator user ID"`
	Content            string                    `json:"content" doc:"Post content"`
	Status             string                    `json:"status" doc:"Post status"`
	Revision           int                       `json:"revision" doc:"Current atomic draft revision"`
	ScheduledAt        string                    `json:"scheduled_at" doc:"Scheduled time (ISO 8601)"`
	RandomDelayMinutes int                       `json:"random_delay_minutes" doc:"Random delay in minutes (±N)"`
	ActualRunAt        string                    `json:"actual_run_at,omitempty" doc:"Actual run time after random delay (ISO 8601)"`
	CreatedAt          string                    `json:"created_at" doc:"Creation time (ISO 8601)"`
	UpdatedAt          string                    `json:"updated_at" doc:"Last atomic draft save time (ISO 8601)"`
	Media              []PostMediaResponse       `json:"media,omitempty" doc:"Attached media"`
	Destinations       []PostDestinationResponse `json:"destinations,omitempty" doc:"Post destinations"`
	ThreadDraft        *string                   `json:"thread_draft,omitempty" doc:"Set when this post is a thread-draft parent; contains the encoded thread JSON (with __openpost_thread__: prefix)."`
}

func (h *PostHandler) GetPost(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-post",
		Method:      http.MethodGet,
		Path:        postPathByID,
		Summary:     "Get a single post",
		Tags:        []string{tagPosts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{404},
	}, func(ctx context.Context, input *GetPostInput) (*GetPostOutput, error) {
		userID := middleware.GetUserID(ctx)

		var post models.Post
		err := h.db.NewSelect().
			Model(&post).
			Where("id = ?", input.PathID).
			Scan(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound("post not found")
			}
			return nil, huma.Error500InternalServerError("failed to fetch post")
		}

		if err := h.checkWorkspaceAccess(ctx, post.WorkspaceID, userID); err != nil {
			return nil, err
		}

		var destinations []struct {
			PostID          string    `bun:"post_id"`
			SocialAccountID string    `bun:"social_account_id"`
			Platform        string    `bun:"platform"`
			Status          string    `bun:"status"`
			ErrorMessage    string    `bun:"error_message"`
			ErrorKind       string    `bun:"error_kind"`
			ErrorCode       string    `bun:"error_code"`
			ErrorHTTPStatus int       `bun:"error_http_status"`
			ErrorRetryable  bool      `bun:"error_retryable"`
			ErrorRetryAt    time.Time `bun:"error_retry_at"`
			ErrorAction     string    `bun:"error_action"`
		}
		err = h.db.NewSelect().
			TableExpr("post_destinations AS pd").
			ColumnExpr("pd.post_id, pd.social_account_id, sa.platform, pd.status, pd.error_message, pd.error_kind, pd.error_code, pd.error_http_status, pd.error_retryable, pd.error_retry_at, pd.error_action").
			Join("JOIN social_accounts AS sa ON sa.id = pd.social_account_id").
			Where("pd.post_id = ?", input.PathID).
			Scan(ctx, &destinations)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch destinations")
		}

		var mediaAttachments []struct {
			MediaID      string `bun:"media_id"`
			DisplayOrder int    `bun:"display_order"`
			FilePath     string `bun:"file_path"`
			MimeType     string `bun:"mime_type"`
			AltText      string `bun:"alt_text"`
		}
		err = h.db.NewSelect().
			TableExpr("post_media AS pm").
			ColumnExpr("pm.media_id, pm.display_order, ma.file_path, ma.mime_type, ma.alt_text").
			Join("JOIN media_attachments AS ma ON ma.id = pm.media_id").
			Where("pm.post_id = ?", input.PathID).
			Order("pm.display_order ASC").
			Scan(ctx, &mediaAttachments)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error500InternalServerError("failed to fetch media")
		}

		destResp := make([]PostDestinationResponse, len(destinations))
		for i, d := range destinations {
			destResp[i] = PostDestinationResponse{
				SocialAccountID: d.SocialAccountID,
				Platform:        d.Platform,
				Status:          d.Status,
				ErrorMessage:    d.ErrorMessage,
				ErrorKind:       d.ErrorKind,
				ErrorCode:       d.ErrorCode,
				ErrorHTTPStatus: d.ErrorHTTPStatus,
				ErrorRetryable:  d.ErrorRetryable,
				ErrorRetryAt:    formatOptionalTime(d.ErrorRetryAt),
				ErrorAction:     d.ErrorAction,
			}
		}

		mediaResp := make([]PostMediaResponse, len(mediaAttachments))
		for i, m := range mediaAttachments {
			mediaResp[i] = PostMediaResponse{
				MediaID:      m.MediaID,
				DisplayOrder: m.DisplayOrder,
				FilePath:     m.FilePath,
				MimeType:     m.MimeType,
				AltText:      m.AltText,
			}
		}

		resp := &GetPostOutput{Body: &PostDetailResponse{
			ID:                 post.ID,
			PublicationID:      post.PublicationID,
			WorkspaceID:        post.WorkspaceID,
			CreatedByID:        post.CreatedByID,
			Content:            post.Content,
			Status:             post.Status,
			Revision:           post.Revision,
			ScheduledAt:        post.ScheduledAt.Format(time.RFC3339),
			RandomDelayMinutes: post.RandomDelayMinutes,
			CreatedAt:          post.CreatedAt.Format(time.RFC3339),
			UpdatedAt:          post.UpdatedAt.Format(time.RFC3339),
			Media:              mediaResp,
			Destinations:       destResp,
		}}
		if !post.ActualRunAt.IsZero() {
			resp.Body.ActualRunAt = post.ActualRunAt.Format(time.RFC3339)
		}
		// Surface the thread draft so the composer can hydrate from
		// the dedicated field. `loadThreadDraft` returns nil for plain
		// posts, so non-thread parents get no extra field.
		// Fall back to the legacy in-content blob for any rows that
		// somehow escaped the migration (shouldn't happen on a clean
		// upgrade, but the fallback is cheap and self-healing).
		threadDraft, err := h.posts.LoadThreadDraft(ctx, input.PathID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load thread draft")
		}
		if threadDraft == nil && postservice.IsThreadDraft(post.Content) {
			blob := post.Content
			threadDraft = &blob
		}
		resp.Body.ThreadDraft = threadDraft
		return resp, nil
	})
}

// CreateTextPostDraft creates the text-composer row and canonical publication
// in the same transaction.
//
//nolint:gocyclo
func (h *PostHandler) CreateTextPostDraft(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "create-text-post-draft",
		Method:      http.MethodPost,
		Path:        "/posts/draft",
		Summary:     "Atomically create a text or thread draft",
		Tags:        []string{tagPosts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *CreateTextPostDraftInput) (*CreateTextPostDraftOutput, error) {
		userID := middleware.GetUserID(ctx)
		if strings.TrimSpace(input.Body.WorkspaceID) == "" {
			return nil, huma.Error400BadRequest("workspace_id is required")
		}
		if err := h.checkWorkspaceEditAccess(ctx, input.Body.WorkspaceID, userID); err != nil {
			return nil, err
		}
		if err := h.validateAccountsBelongToWorkspace(
			ctx,
			input.Body.WorkspaceID,
			input.Body.SocialAccountIDs,
		); err != nil {
			return nil, err
		}
		mediaIDs := append([]string{}, input.Body.MediaIDs...)
		for _, variant := range input.Body.Variants {
			if variant.MediaIDs == nil || strings.TrimSpace(*variant.MediaIDs) == "" {
				continue
			}
			var variantMedia []string
			if err := json.Unmarshal([]byte(*variant.MediaIDs), &variantMedia); err != nil {
				return nil, huma.Error400BadRequest("variant media_ids must be a JSON array of media IDs")
			}
			mediaIDs = append(mediaIDs, variantMedia...)
		}
		if input.Body.ThreadDraft != nil && *input.Body.ThreadDraft != "" {
			mediaIDs = append(mediaIDs, postservice.ThreadDraftMediaIDs(*input.Body.ThreadDraft)...)
		}
		mediaIDs = append(mediaIDs, allPublicationMediaIDs(
			nil,
			input.Body.Publication.Segments,
			input.Body.Publication.Renditions,
		)...)
		if err := h.validateMediaBelongsToWorkspace(ctx, input.Body.WorkspaceID, mediaIDs); err != nil {
			return nil, err
		}

		publicationHandler := NewPublicationHandler(h.db, h.auth, h.entitlement)
		publicationHandler.SetCapabilityDependencies(h.providers, h.tokenSource)
		if input.Body.Publication.SocialSetID != nil && *input.Body.Publication.SocialSetID != "" {
			if _, err := loadSocialSetSnapshot(
				ctx,
				h.db,
				input.Body.WorkspaceID,
				*input.Body.Publication.SocialSetID,
			); err != nil {
				return nil, err
			}
		}
		accountMap, err := publicationHandler.loadAccounts(
			ctx,
			input.Body.WorkspaceID,
			renditionAccountIDs(input.Body.Publication.Renditions),
		)
		if err != nil {
			return nil, err
		}
		repostOverride, err := h.validateTextPostRepostOverride(
			ctx,
			input.Body.WorkspaceID,
			userID,
			input.Body.Publication.RepostOverride,
		)
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}

		var scheduledAt time.Time
		if input.Body.ScheduledAt != nil && strings.TrimSpace(*input.Body.ScheduledAt) != "" {
			scheduledAt, err = time.Parse(time.RFC3339, strings.TrimSpace(*input.Body.ScheduledAt))
			if err != nil {
				return nil, huma.Error400BadRequest("scheduled_at must be an RFC3339 timestamp")
			}
			if err := validateFuturePublicationSchedule(scheduledAt, time.Now().UTC()); err != nil {
				return nil, huma.Error400BadRequest(err.Error())
			}
		}

		now := time.Now().UTC()
		postID := uuid.New().String()
		publicationID := uuid.New().String()
		content, threadDraft := postservice.ResolveThreadDraftInput(
			input.Body.Content,
			input.Body.ThreadDraft,
		)
		post := &models.Post{
			ID:                 postID,
			WorkspaceID:        input.Body.WorkspaceID,
			CreatedByID:        userID,
			PublicationID:      publicationID,
			Content:            content,
			Status:             models.PostStatusDraft,
			Revision:           1,
			ScheduledAt:        scheduledAt,
			RandomDelayMinutes: input.Body.RandomDelayMinutes,
			CreatedAt:          now,
			UpdatedAt:          now,
		}
		publicationInput := input.Body.Publication
		intent := publicationFirstNonEmpty(
			valueOrEmpty(publicationInput.Intent),
			publishingIntentForProfile(valueOrEmpty(publicationInput.ContentProfile)),
			models.PublishingIntentPost,
		)
		creationPreset := publicationFirstNonEmpty(
			valueOrEmpty(publicationInput.CreationPreset),
			intent,
		)
		profile := publicationFirstNonEmpty(
			valueOrEmpty(publicationInput.ContentProfile),
			compatibilityProfileForIntent(intent),
		)
		sourceText := publicationFirstNonEmpty(valueOrEmpty(publicationInput.SourceText), content)
		title := publicationFirstNonEmpty(
			valueOrEmpty(publicationInput.Title),
			firstContentLine(sourceText),
			"Untitled publication",
		)
		publication := &models.Publication{
			ID:              publicationID,
			WorkspaceID:     input.Body.WorkspaceID,
			CreatedByID:     userID,
			Title:           title,
			Intent:          intent,
			CreationPreset:  creationPreset,
			SocialSetID:     valueOrEmpty(publicationInput.SocialSetID),
			ContentProfile:  profile,
			SourceText:      sourceText,
			SourceContent:   sourceText,
			SourceURL:       valueOrEmpty(publicationInput.SourceURL),
			Goal:            valueOrEmpty(publicationInput.Goal),
			Audience:        valueOrEmpty(publicationInput.Audience),
			Status:          models.PublicationStatusDraft,
			Revision:        1,
			ScheduledAt:     scheduledAt,
			MetadataJSON:    mustJSON(publicationInput.Metadata),
			ReleasePlanJSON: mustJSON(publicationInput.Metadata),
			RepostOverride:  repostOverride,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		segments := publicationInput.Segments
		if len(segments) == 0 {
			segments = []PublicationSegmentInput{{Body: sourceText, Title: title}}
		}

		err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			if _, err := tx.NewInsert().Model(publication).Exec(txCtx); err != nil {
				return err
			}
			if _, err := tx.NewInsert().Model(post).Exec(txCtx); err != nil {
				return err
			}
			if err := postservice.UpsertThreadDraftTx(txCtx, tx, post.ID, threadDraft); err != nil {
				return err
			}
			if err := replaceTextPostDestinationsTx(
				txCtx,
				tx,
				post.ID,
				input.Body.SocialAccountIDs,
			); err != nil {
				return err
			}
			if err := replaceTextPostMediaTx(txCtx, tx, post.ID, input.Body.MediaIDs); err != nil {
				return err
			}
			if err := replaceTextPostVariantsTx(
				txCtx,
				tx,
				post,
				input.Body.Variants,
				now,
			); err != nil {
				return err
			}
			canonical, err := publicationHandler.insertPublicationSegments(
				txCtx,
				tx,
				publication,
				segments,
			)
			if err != nil {
				return err
			}
			if err := publicationHandler.insertRenditions(
				txCtx,
				tx,
				publication,
				canonical,
				segments,
				publicationInput.Renditions,
				nil,
				accountMap,
			); err != nil {
				return err
			}
			domains := []string{
				"content",
				"destinations",
				"destination overrides",
				"media",
				"segments",
				"settings",
			}
			if !scheduledAt.IsZero() {
				domains = append(domains, "schedule")
			}
			if err := drafts.RecordChange(
				txCtx,
				tx,
				drafts.AggregateTextPost,
				post.ID,
				1,
				domains,
				userID,
				now,
			); err != nil {
				return err
			}
			return drafts.RecordChange(
				txCtx,
				tx,
				drafts.AggregatePublication,
				publication.ID,
				1,
				domains,
				userID,
				now,
			)
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to create text post draft")
		}

		output := &CreateTextPostDraftOutput{}
		output.Body.PostID = post.ID
		output.Body.PublicationID = publication.ID
		output.Body.Revision = 1
		output.Body.UpdatedAt = now.Format(time.RFC3339)
		return output, nil
	})
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// SaveTextPostDraft persists every editable part of the text-and-thread
// composer as one revision. A failed write rolls back the post, thread,
// variants, destinations, media, canonical segments, and renditions together.
//
//nolint:gocyclo
func (h *PostHandler) SaveTextPostDraft(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "save-text-post-draft",
		Method:      http.MethodPut,
		Path:        "/posts/{id}/draft",
		Summary:     "Atomically save a text or thread draft",
		Tags:        []string{tagPosts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, func(ctx context.Context, input *SaveTextPostDraftInput) (*SaveTextPostDraftOutput, error) {
		if err := drafts.RequireExpectedRevision(input.Body.ExpectedRevision); err != nil {
			return nil, err
		}
		userID := middleware.GetUserID(ctx)
		var post models.Post
		if err := h.db.NewSelect().Model(&post).Where("id = ?", input.PathID).Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound("post not found")
			}
			return nil, huma.Error500InternalServerError("failed to load post")
		}
		if err := h.checkWorkspaceEditAccess(ctx, post.WorkspaceID, userID); err != nil {
			return nil, err
		}
		if !isTextPostEditable(post.Status) {
			return nil, huma.Error400BadRequest("published or publishing posts cannot be edited")
		}
		if err := databasemigrations.MigrateLegacyPublicationAuthoringForActor(
			ctx,
			h.db,
			post.ID,
			publicationAuthorizationActor(ctx, userID),
		); err != nil {
			return nil, huma.Error500InternalServerError("failed to prepare text post authoring")
		}
		var publicationID string
		if err := h.db.NewSelect().
			Model((*models.Post)(nil)).
			Column("publication_id").
			Where("id = ?", post.ID).
			Scan(ctx, &publicationID); err != nil {
			return nil, huma.Error500InternalServerError("failed to load canonical text post authoring")
		}
		post.PublicationID = publicationID
		if err := h.validateAccountsBelongToWorkspace(ctx, post.WorkspaceID, input.Body.SocialAccountIDs); err != nil {
			return nil, err
		}
		mediaIDs := append([]string{}, input.Body.MediaIDs...)
		for _, variant := range input.Body.Variants {
			if variant.MediaIDs == nil || strings.TrimSpace(*variant.MediaIDs) == "" {
				continue
			}
			var variantMedia []string
			if err := json.Unmarshal([]byte(*variant.MediaIDs), &variantMedia); err != nil {
				return nil, huma.Error400BadRequest("variant media_ids must be a JSON array of media IDs")
			}
			mediaIDs = append(mediaIDs, variantMedia...)
		}
		if input.Body.ThreadDraft != nil && *input.Body.ThreadDraft != "" {
			mediaIDs = append(mediaIDs, postservice.ThreadDraftMediaIDs(*input.Body.ThreadDraft)...)
		}
		mediaIDs = append(mediaIDs, allPublicationMediaIDs(
			nil,
			input.Body.Publication.Segments,
			input.Body.Publication.Renditions,
		)...)
		if err := h.validateMediaBelongsToWorkspace(ctx, post.WorkspaceID, mediaIDs); err != nil {
			return nil, err
		}

		publicationHandler := NewPublicationHandler(h.db, h.auth, h.entitlement)
		publicationHandler.SetCapabilityDependencies(h.providers, h.tokenSource)
		if input.Body.Publication.SocialSetID != nil {
			var currentSocialSetID string
			if err := h.db.NewSelect().
				TableExpr("publications").
				Column("social_set_id").
				Where("id = ?", post.PublicationID).
				Scan(ctx, &currentSocialSetID); err != nil {
				return nil, huma.Error500InternalServerError("failed to load publication provenance")
			}
			if *input.Body.Publication.SocialSetID != "" && *input.Body.Publication.SocialSetID != currentSocialSetID {
				if _, err := loadSocialSetSnapshot(
					ctx,
					h.db,
					post.WorkspaceID,
					*input.Body.Publication.SocialSetID,
				); err != nil {
					return nil, err
				}
			}
		}
		accountMap, err := publicationHandler.loadAccounts(
			ctx,
			post.WorkspaceID,
			renditionAccountIDs(input.Body.Publication.Renditions),
		)
		if err != nil {
			return nil, err
		}
		repostOverride, err := h.validateTextPostRepostOverride(
			ctx,
			post.WorkspaceID,
			userID,
			input.Body.Publication.RepostOverride,
		)
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		normalizedOverride := repostservice.DecodeOverride(repostOverride)
		input.Body.Publication.RepostOverride = &normalizedOverride

		var scheduledAt time.Time
		if input.Body.ScheduledAt != nil && strings.TrimSpace(*input.Body.ScheduledAt) != "" {
			scheduledAt, err = time.Parse(time.RFC3339, strings.TrimSpace(*input.Body.ScheduledAt))
			if err != nil {
				return nil, huma.Error400BadRequest("scheduled_at must be an RFC3339 timestamp")
			}
			if err := validateFuturePublicationSchedule(scheduledAt, time.Now().UTC()); err != nil {
				return nil, huma.Error400BadRequest(err.Error())
			}
		}

		now := time.Now().UTC()
		nextRevision := input.Body.ExpectedRevision + 1
		err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			if err := h.prepareLegacyPostMutationTx(txCtx, tx, post.ID); err != nil {
				return err
			}
			current, err := h.lockTextPostTx(txCtx, tx, input.PathID)
			if err != nil {
				return err
			}
			if current.Revision != input.Body.ExpectedRevision {
				return h.textPostRevisionConflict(txCtx, tx, current, input.Body.ExpectedRevision)
			}
			if current.PublicationID == "" {
				return errors.New("text post has no canonical publication")
			}
			publication, err := publicationHandler.loadEditablePublicationTx(txCtx, tx, current.PublicationID)
			if err != nil {
				return err
			}
			if publication.Revision != input.Body.ExpectedRevision {
				return publicationHandler.publicationRevisionConflict(
					txCtx,
					tx,
					publication,
					input.Body.ExpectedRevision,
				)
			}

			content, threadDraft := postservice.ResolveThreadDraftInput(
				input.Body.Content,
				input.Body.ThreadDraft,
			)
			current.Content = content
			current.RandomDelayMinutes = input.Body.RandomDelayMinutes
			current.Revision = nextRevision
			current.UpdatedAt = now
			if input.Body.ScheduledAt != nil {
				current.ScheduledAt = scheduledAt
				if scheduledAt.IsZero() && current.Status == models.PostStatusScheduled {
					current.Status = models.PostStatusDraft
					current.ActualRunAt = time.Time{}
				}
			}
			result, err := tx.NewUpdate().
				Model(current).
				Column(
					"content",
					"status",
					"scheduled_at",
					"actual_run_at",
					"random_delay_minutes",
					"revision",
					"updated_at",
				).
				Where("id = ? AND revision = ?", current.ID, input.Body.ExpectedRevision).
				Exec(txCtx)
			if err != nil {
				return err
			}
			if affected, _ := result.RowsAffected(); affected == 0 {
				return h.textPostRevisionConflict(txCtx, tx, current, input.Body.ExpectedRevision)
			}
			if err := postservice.UpsertThreadDraftTx(txCtx, tx, current.ID, threadDraft); err != nil {
				return err
			}
			if err := replaceTextPostDestinationsTx(
				txCtx,
				tx,
				current.ID,
				input.Body.SocialAccountIDs,
			); err != nil {
				return err
			}
			if err := replaceTextPostMediaTx(txCtx, tx, current.ID, input.Body.MediaIDs); err != nil {
				return err
			}
			if err := replaceTextPostVariantsTx(
				txCtx,
				tx,
				current,
				input.Body.Variants,
				now,
			); err != nil {
				return err
			}

			// Rebuild the compatibility projection inside this transaction, then
			// apply the composer's richer canonical settings and segments.
			if err := databasemigrations.SyncTextPostAuthoringTx(txCtx, tx, current.ID); err != nil {
				return err
			}
			clearQueuedSchedule, rescheduleQueuedJob, err := applyPublicationScheduleUpdate(
				publication,
				input.Body.Publication.ScheduledAt,
				input.Body.Publication.ClearSchedule,
				now,
			)
			if err != nil {
				return err
			}
			applyPublicationFieldUpdates(
				publication,
				publicationUpdateFromTextPost(input.Body.Publication),
			)
			publication.Revision = nextRevision
			publication.UpdatedAt = now
			if clearQueuedSchedule {
				if err := publicationHandler.clearPublicationScheduleTx(
					txCtx,
					tx,
					publication.ID,
					now,
				); err != nil {
					return err
				}
			}
			pubResult, err := tx.NewUpdate().
				Model(publication).
				Where("id = ? AND revision = ?", publication.ID, input.Body.ExpectedRevision).
				Exec(txCtx)
			if err != nil {
				return err
			}
			if affected, _ := pubResult.RowsAffected(); affected == 0 {
				return publicationHandler.publicationRevisionConflict(
					txCtx,
					tx,
					publication,
					input.Body.ExpectedRevision,
				)
			}
			if input.Body.Publication.Segments != nil {
				if err := publicationHandler.replacePublicationSegments(
					txCtx,
					tx,
					publication,
					input.Body.Publication.Segments,
				); err != nil {
					return err
				}
			}
			if input.Body.Publication.Renditions != nil {
				if err := publicationHandler.replaceAllPublicationRenditions(
					txCtx,
					tx,
					publication,
					input.Body.Publication.Segments,
					input.Body.Publication.Renditions,
					accountMap,
				); err != nil {
					return err
				}
			}
			if rescheduleQueuedJob {
				if _, err := publicationHandler.replacePublicationJobTx(
					txCtx,
					tx,
					publication.ID,
					publication.ScheduledAt,
				); err != nil {
					return err
				}
			}
			if !rescheduleQueuedJob {
				if err := publicationauth.AuthorizeLegacyJobs(txCtx, tx, publicationauth.LegacyJobsInput{
					PublicationID: publication.ID,
					Actor:         publicationAuthorizationActor(txCtx, userID),
					Force:         true,
				}); err != nil {
					return err
				}
			}
			domains := []string{
				"content",
				"destinations",
				"destination overrides",
				"media",
				"segments",
				"settings",
			}
			if input.Body.ScheduledAt != nil {
				domains = append(domains, "schedule")
			}
			if err := drafts.RecordChange(
				txCtx,
				tx,
				drafts.AggregateTextPost,
				current.ID,
				nextRevision,
				domains,
				userID,
				now,
			); err != nil {
				return err
			}
			return drafts.RecordChange(
				txCtx,
				tx,
				drafts.AggregatePublication,
				publication.ID,
				nextRevision,
				domains,
				userID,
				now,
			)
		})
		if err != nil {
			return nil, textPostMutationHTTPError(err)
		}

		output := &SaveTextPostDraftOutput{}
		output.Body.PostID = post.ID
		output.Body.PublicationID = post.PublicationID
		output.Body.Revision = nextRevision
		output.Body.UpdatedAt = now.Format(time.RFC3339)
		return output, nil
	})
}

func (h *PostHandler) validateTextPostRepostOverride(
	ctx context.Context,
	workspaceID, userID string,
	input *repostservice.Override,
) (string, error) {
	override := repostservice.Override{Mode: repostservice.ModeInherit}
	if input != nil {
		override = *input
	}
	var err error
	if h.reposts != nil {
		override, err = h.reposts.ValidateOverride(ctx, workspaceID, userID, override)
	} else {
		override, err = repostservice.NormalizeOverride(override)
	}
	if err != nil {
		return "", err
	}
	return repostservice.EncodeOverride(override)
}

func isTextPostEditable(status string) bool {
	return status == models.PostStatusDraft || status == models.PostStatusScheduled ||
		status == models.PostStatusFailed
}

func (h *PostHandler) lockTextPostTx(
	ctx context.Context,
	tx bun.Tx,
	postID string,
) (*models.Post, error) {
	if tx.Dialect().Name() == dialect.PG {
		var post models.Post
		if err := tx.NewSelect().
			Model(&post).
			Where("id = ?", postID).
			For("UPDATE").
			Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, errPublicationNotFound
			}
			return nil, err
		}
		return &post, nil
	}
	result, err := tx.NewUpdate().
		Model((*models.Post)(nil)).
		Set("id = id").
		Where("id = ?", postID).
		Exec(ctx)
	if err != nil {
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return nil, errPublicationNotFound
	}
	var post models.Post
	if err := tx.NewSelect().Model(&post).Where("id = ?", postID).Scan(ctx); err != nil {
		return nil, err
	}
	return &post, nil
}

func (h *PostHandler) textPostRevisionConflict(
	ctx context.Context,
	db bun.IDB,
	post *models.Post,
	expectedRevision int,
) error {
	domains, err := drafts.ChangedDomainsSince(
		ctx,
		db,
		drafts.AggregateTextPost,
		post.ID,
		expectedRevision,
	)
	if err != nil {
		return err
	}
	if len(domains) == 0 {
		domains = []string{"draft"}
	}
	editorName, err := drafts.LatestEditorName(ctx, db, drafts.AggregateTextPost, post.ID, expectedRevision)
	if err != nil {
		return err
	}
	return drafts.NewConflictError(drafts.ConflictMetadata{
		AggregateType:    drafts.AggregateTextPost,
		AggregateID:      post.ID,
		ExpectedRevision: expectedRevision,
		CurrentRevision:  post.Revision,
		Status:           post.Status,
		UpdatedAt:        formatOptionalTime(post.UpdatedAt),
		ChangedByName:    editorName,
		ChangedDomains:   domains,
	})
}

func replaceTextPostDestinationsTx(
	ctx context.Context,
	tx bun.Tx,
	postID string,
	accountIDs []string,
) error {
	if _, err := tx.NewDelete().
		Model((*models.PostDestination)(nil)).
		Where("post_id = ?", postID).
		Exec(ctx); err != nil {
		return err
	}
	for _, accountID := range uniqueNonEmpty(accountIDs) {
		row := &models.PostDestination{
			ID:              uuid.New().String(),
			PostID:          postID,
			SocialAccountID: accountID,
			Status:          postStatusPending,
		}
		if _, err := tx.NewInsert().Model(row).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func replaceTextPostMediaTx(
	ctx context.Context,
	tx bun.Tx,
	postID string,
	mediaIDs []string,
) error {
	previousMediaIDs := make([]string, 0, len(mediaIDs))
	if err := tx.NewSelect().
		Model((*models.PostMedia)(nil)).
		Column("media_id").
		Where("post_id = ?", postID).
		Scan(ctx, &previousMediaIDs); err != nil {
		return err
	}
	if _, err := tx.NewDelete().
		Model((*models.PostMedia)(nil)).
		Where("post_id = ?", postID).
		Exec(ctx); err != nil {
		return err
	}
	mediaIDs = uniqueNonEmpty(mediaIDs)
	for displayOrder, mediaID := range mediaIDs {
		row := &models.PostMedia{
			PostID:       postID,
			MediaID:      mediaID,
			DisplayOrder: displayOrder,
		}
		if _, err := tx.NewInsert().Model(row).Exec(ctx); err != nil {
			return err
		}
	}
	return medialifecycle.TouchWithDB(ctx, tx, append(previousMediaIDs, mediaIDs...), time.Now().UTC())
}

func replaceTextPostVariantsTx(
	ctx context.Context,
	tx bun.Tx,
	post *models.Post,
	variants []VariantInput,
	now time.Time,
) error {
	if _, err := tx.NewDelete().
		Model((*models.PostVariant)(nil)).
		Where("post_id = ?", post.ID).
		Exec(ctx); err != nil {
		return err
	}
	for _, input := range variants {
		content := post.Content
		if input.Content != nil {
			content = *input.Content
		}
		mediaIDs := "[]"
		if input.MediaIDs != nil && strings.TrimSpace(*input.MediaIDs) != "" {
			mediaIDs = *input.MediaIDs
		}
		row := &models.PostVariant{
			ID:              uuid.New().String(),
			PostID:          post.ID,
			SocialAccountID: input.SocialAccountID,
			Content:         content,
			MediaIDs:        mediaIDs,
			IsUnsynced:      input.IsUnsynced || input.Content != nil || input.MediaIDs != nil,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		if _, err := tx.NewInsert().Model(row).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func textPostMutationHTTPError(err error) error {
	var statusErr huma.StatusError
	if errors.As(err, &statusErr) {
		return statusErr
	}
	if errors.Is(err, errPublicationNotFound) {
		return huma.Error404NotFound("post or publication not found")
	}
	if errors.Is(err, errPublicationNotEditable) ||
		errors.Is(err, errPublicationAlreadyProcessing) {
		return publicationMutationHTTPError(err, "failed to save text post draft")
	}
	return huma.Error500InternalServerError("failed to save text post draft")
}

type UpdatePostInput struct {
	PathID string `path:"id" doc:"Post ID"`
	Body   struct {
		Content            *string  `json:"content,omitempty" doc:"Post content"`
		ScheduledAt        *string  `json:"scheduled_at,omitempty" doc:"Schedule time (ISO 8601). Set to empty string to unschedule (make draft)."`
		SocialAccountIDs   []string `json:"social_account_ids,omitempty" doc:"Social account IDs to publish to (replace all)"`
		MediaIDs           []string `json:"media_ids,omitempty" doc:"Media attachment IDs to include (replace all)"`
		RandomDelayMinutes *int     `json:"random_delay_minutes,omitempty" doc:"Random delay in minutes (±N) to add for natural posting"`
		ThreadDraft        *string  `json:"thread_draft,omitempty" doc:"Thread draft JSON (encoded with __openpost_thread__: prefix). Send a non-null value to set or replace the draft; send an empty string to clear it and revert to a single post. Send null (or omit) to leave the existing draft unchanged."`
	}
}

type UpdatePostOutput struct {
	Body *PostDetailResponse
}

//nolint:gocyclo
func (h *PostHandler) UpdatePost(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "update-post",
		Method:      http.MethodPatch,
		Path:        postPathByID,
		Summary:     "Update a post",
		Tags:        []string{tagPosts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, func(ctx context.Context, input *UpdatePostInput) (*UpdatePostOutput, error) {
		userID := middleware.GetUserID(ctx)

		var post models.Post
		err := h.db.NewSelect().
			Model(&post).
			Where("id = ?", input.PathID).
			Scan(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound("post not found")
			}
			return nil, huma.Error500InternalServerError("failed to fetch post")
		}

		if err := h.checkWorkspaceEditAccess(ctx, post.WorkspaceID, userID); err != nil {
			return nil, err
		}

		if post.Status == models.PostStatusPublished {
			return nil, huma.Error400BadRequest("cannot edit a published post")
		}
		if input.Body.SocialAccountIDs != nil {
			if err := h.validateAccountsBelongToWorkspace(ctx, post.WorkspaceID, input.Body.SocialAccountIDs); err != nil {
				return nil, err
			}
		}
		if input.Body.MediaIDs != nil {
			if err := h.validateMediaBelongsToWorkspace(ctx, post.WorkspaceID, input.Body.MediaIDs); err != nil {
				return nil, err
			}
		}
		if input.Body.Content != nil && postservice.IsThreadDraft(*input.Body.Content) {
			// Legacy fallback: a client that still packs the thread into
			// `content` instead of using the explicit `thread_draft`
			// field. We accept it and route it to the same path below
			// by mirroring the value into ThreadDraft. The CreatePost /
			// UpdatePost handlers then store the blob in
			// `thread_drafts.draft_json` and clear `posts.content` so
			// the parent row no longer carries a magic prefix.
			draftMediaIDs := postservice.ThreadDraftMediaIDs(*input.Body.Content)
			if err := h.validateMediaBelongsToWorkspace(ctx, post.WorkspaceID, draftMediaIDs); err != nil {
				return nil, err
			}
		} else if input.Body.ThreadDraft != nil && *input.Body.ThreadDraft != "" && postservice.IsThreadDraft(*input.Body.ThreadDraft) {
			// New explicit path: validate the media IDs inside the
			// thread draft up front. Invalid media is a 400, not a 500.
			draftMediaIDs := postservice.ThreadDraftMediaIDs(*input.Body.ThreadDraft)
			if err := h.validateMediaBelongsToWorkspace(ctx, post.WorkspaceID, draftMediaIDs); err != nil {
				return nil, err
			}
		}

		scheduledAtText := ""
		if input.Body.ScheduledAt != nil {
			scheduledAtText = strings.TrimSpace(*input.Body.ScheduledAt)
		}

		var nextScheduledAt time.Time
		var nextJobRunAt time.Time

		if h.beforeLegacyMutationTransaction != nil {
			if err := h.beforeLegacyMutationTransaction(ctx); err != nil {
				return nil, huma.Error500InternalServerError("failed to begin post update")
			}
		}
		err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			current, err := h.prepareEditableLegacyPostMutationTx(txCtx, tx, post.ID)
			if err != nil {
				return err
			}
			post = *current

			willBeScheduled := post.Status == statusScheduled
			if input.Body.ScheduledAt != nil {
				willBeScheduled = scheduledAtText != ""
			}
			if willBeScheduled {
				accountIDs := input.Body.SocialAccountIDs
				if accountIDs == nil {
					if err := tx.NewSelect().Model((*models.PostDestination)(nil)).
						Column("social_account_id").Where("post_id = ?", post.ID).
						Scan(txCtx, &accountIDs); err != nil {
						return postServiceError(err, "failed to load post destinations")
					}
				}
				mediaIDs := input.Body.MediaIDs
				if mediaIDs == nil {
					if err := tx.NewSelect().Model((*models.PostMedia)(nil)).
						Column("media_id").Where("post_id = ?", post.ID).
						Order("display_order ASC").Scan(txCtx, &mediaIDs); err != nil {
						return postServiceError(err, "failed to load post media")
					}
				}
				if err := h.posts.ValidateScheduledProviderMediaTx(txCtx, tx, post.WorkspaceID, accountIDs, mediaIDs); err != nil {
					return postServiceError(err, "failed to validate provider media")
				}
			}
			if input.Body.ScheduledAt != nil && scheduledAtText != "" {
				parsed, parseErr := time.Parse(time.RFC3339, scheduledAtText)
				if parseErr != nil {
					return huma.Error400BadRequest("scheduled_at must be an RFC3339 timestamp")
				}
				randomDelayMinutes := post.RandomDelayMinutes
				if input.Body.RandomDelayMinutes != nil {
					randomDelayMinutes = *input.Body.RandomDelayMinutes
				}
				var scheduleErr error
				nextJobRunAt, scheduleErr = resolveFuturePostRunAt(parsed, randomDelayMinutes, time.Now().UTC())
				if scheduleErr != nil {
					return huma.Error400BadRequest(scheduleErr.Error())
				}
				nextScheduledAt = parsed
			} else if input.Body.ScheduledAt == nil && input.Body.RandomDelayMinutes != nil && post.Status == statusScheduled {
				var scheduleErr error
				nextJobRunAt, scheduleErr = resolveFuturePostRunAt(post.ScheduledAt, *input.Body.RandomDelayMinutes, time.Now().UTC())
				if scheduleErr != nil {
					return huma.Error400BadRequest(scheduleErr.Error())
				}
			}
			// Compute the new content and the thread_drafts row, if any.
			// resolveThreadDraftInput prefers the explicit field and
			// falls back to detecting the legacy blob in `content`.
			if input.Body.Content != nil || input.Body.ThreadDraft != nil {
				var requestedContent string
				if input.Body.Content != nil {
					requestedContent = *input.Body.Content
				}
				newContent, draftJSON := postservice.ResolveThreadDraftInput(requestedContent, input.Body.ThreadDraft)
				post.Content = newContent

				// Persist the cleaned content on the post row first, so
				// the new value is visible to subsequent reads inside
				// the same transaction.
				if _, err := tx.NewUpdate().Model(&post).Column("content").Where("id = ?", post.ID).Exec(txCtx); err != nil {
					return fmt.Errorf("failed to update post content: %w", err)
				}
				// Then sync the thread_drafts row (or clear it).
				if err := postservice.UpsertThreadDraftTx(txCtx, tx, post.ID, draftJSON); err != nil {
					return err
				}
			}

			// ------------------------------------------------------------------
			// 1. Handle scheduling changes
			// ------------------------------------------------------------------
			if input.Body.ScheduledAt != nil {
				if scheduledAtText == "" {
					// Unschedule (make draft)
					post.Status = statusDraft
					post.ScheduledAt = time.Time{}
					post.RandomDelayMinutes = 0
					post.ActualRunAt = time.Time{}
					if _, err := tx.NewUpdate().Model(&post).Column("content", "status", "scheduled_at", "random_delay_minutes", "actual_run_at").Where("id = ?", post.ID).Exec(txCtx); err != nil {
						return fmt.Errorf("failed to unschedule post: %w", err)
					}
					// Cancel only the indexed publish_post scope for this aggregate;
					// unrelated jobs cannot be removed by matching payload text.
					if _, err := tx.NewDelete().Model(&models.Job{}).
						Where(publishPostJobPostIDWhere(h.db), jobTypePublishPost, post.ID).
						Where("status = ?", jobStatusPending).
						Exec(txCtx); err != nil {
						return fmt.Errorf("failed to cancel job: %w", err)
					}
				} else {
					// Reschedule
					oldScheduledAt := post.ScheduledAt
					post.ScheduledAt = nextScheduledAt
					post.Status = statusScheduled
					if input.Body.RandomDelayMinutes != nil {
						post.RandomDelayMinutes = *input.Body.RandomDelayMinutes
					}
					post.ActualRunAt = nextJobRunAt
					if _, err := tx.NewUpdate().Model(&post).Column("content", "status", "scheduled_at", "random_delay_minutes", "actual_run_at").Where("id = ?", post.ID).Exec(txCtx); err != nil {
						return fmt.Errorf("failed to update post: %w", err)
					}
					if !oldScheduledAt.IsZero() {
						if _, err := tx.NewDelete().Model(&models.Job{}).
							Where(publishPostJobPostIDWhere(h.db), jobTypePublishPost, post.ID).
							Where("status = ?", jobStatusPending).
							Exec(txCtx); err != nil {
							return fmt.Errorf("failed to cancel old job: %w", err)
						}
					}
					payload, _ := json.Marshal(map[string]string{postIDKey: post.ID})
					job, err := newPublishPostJob(string(payload), nextJobRunAt, post.ID, "")
					if err != nil {
						return err
					}
					if _, err := tx.NewInsert().Model(job).Exec(txCtx); err != nil {
						return fmt.Errorf("failed to create job: %w", err)
					}
				}
			} else {
				// No scheduling change — content and the thread_drafts
				// row have already been synced by the block above, so
				// only the random delay can change here.
				if input.Body.RandomDelayMinutes != nil && post.Status == statusScheduled {
					post.RandomDelayMinutes = *input.Body.RandomDelayMinutes
					post.ActualRunAt = nextJobRunAt
					if _, err := tx.NewUpdate().Model(&post).Column("random_delay_minutes", "actual_run_at").Where("id = ?", post.ID).Exec(txCtx); err != nil {
						return fmt.Errorf("failed to update random delay: %w", err)
					}
					if _, err := tx.NewDelete().Model(&models.Job{}).
						Where(publishPostJobPostIDWhere(h.db), jobTypePublishPost, post.ID).
						Where("status = ?", jobStatusPending).
						Exec(txCtx); err != nil {
						return fmt.Errorf("failed to cancel old job: %w", err)
					}
					payload, _ := json.Marshal(map[string]string{postIDKey: post.ID})
					job, err := newPublishPostJob(string(payload), nextJobRunAt, post.ID, "")
					if err != nil {
						return err
					}
					if _, err := tx.NewInsert().Model(job).Exec(txCtx); err != nil {
						return fmt.Errorf("failed to create job: %w", err)
					}
				}
			}

			descendantIDs, err := postservice.GetThreadPostIDsTx(txCtx, tx, post.ID, false)
			if err != nil {
				return err
			}
			if len(descendantIDs) > 0 {
				if _, err := tx.NewUpdate().
					Model((*models.Post)(nil)).
					Set("status = ?", post.Status).
					Set("scheduled_at = ?", post.ScheduledAt).
					Set("random_delay_minutes = ?", post.RandomDelayMinutes).
					Set("actual_run_at = ?", post.ActualRunAt).
					Where("id IN (?)", bun.List(descendantIDs)).
					Exec(txCtx); err != nil {
					return fmt.Errorf("failed to sync thread descendants: %w", err)
				}
			}

			// ------------------------------------------------------------------
			// 2. Update destinations (always processed)
			// ------------------------------------------------------------------
			if input.Body.SocialAccountIDs != nil {
				if _, err := tx.NewDelete().Model(&models.PostDestination{}).Where("post_id = ?", post.ID).Exec(txCtx); err != nil {
					return fmt.Errorf("failed to remove old destinations: %w", err)
				}
				for _, accID := range input.Body.SocialAccountIDs {
					dest := models.PostDestination{
						ID:              uuid.New().String(),
						PostID:          post.ID,
						SocialAccountID: accID,
						Status:          postStatusPending,
					}
					if _, err := tx.NewInsert().Model(&dest).Exec(txCtx); err != nil {
						return fmt.Errorf("failed to add destination: %w", err)
					}
				}

				descendantIDs, err := postservice.GetThreadPostIDsTx(txCtx, tx, post.ID, false)
				if err != nil {
					return err
				}
				if len(descendantIDs) > 0 {
					if _, err := tx.NewDelete().Model(&models.PostDestination{}).Where("post_id IN (?)", bun.List(descendantIDs)).Exec(txCtx); err != nil {
						return fmt.Errorf("failed to remove old thread destinations: %w", err)
					}
					for _, childID := range descendantIDs {
						for _, accID := range input.Body.SocialAccountIDs {
							dest := models.PostDestination{
								ID:              uuid.New().String(),
								PostID:          childID,
								SocialAccountID: accID,
								Status:          postStatusPending,
							}
							if _, err := tx.NewInsert().Model(&dest).Exec(txCtx); err != nil {
								return fmt.Errorf("failed to add thread destination: %w", err)
							}
						}
					}
				}
			}

			// ------------------------------------------------------------------
			// 3. Update media (always processed)
			// ------------------------------------------------------------------
			if input.Body.MediaIDs != nil {
				if err := replaceTextPostMediaTx(txCtx, tx, post.ID, input.Body.MediaIDs); err != nil {
					return fmt.Errorf("failed to replace media: %w", err)
				}
			}

			return h.finishLegacyPostMutationTx(txCtx, tx, post.ID)
		})
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to update post")
		}

		var respPost models.Post
		if err := h.db.NewSelect().Model(&respPost).Where("id = ?", post.ID).Scan(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to refetch post")
		}

		var destinations []struct {
			PostID          string    `bun:"post_id"`
			SocialAccountID string    `bun:"social_account_id"`
			Platform        string    `bun:"platform"`
			Status          string    `bun:"status"`
			ErrorMessage    string    `bun:"error_message"`
			ErrorKind       string    `bun:"error_kind"`
			ErrorCode       string    `bun:"error_code"`
			ErrorHTTPStatus int       `bun:"error_http_status"`
			ErrorRetryable  bool      `bun:"error_retryable"`
			ErrorRetryAt    time.Time `bun:"error_retry_at"`
			ErrorAction     string    `bun:"error_action"`
		}
		if err := h.db.NewSelect().
			TableExpr("post_destinations AS pd").
			ColumnExpr("pd.post_id, pd.social_account_id, sa.platform, pd.status, pd.error_message, pd.error_kind, pd.error_code, pd.error_http_status, pd.error_retryable, pd.error_retry_at, pd.error_action").
			Join("JOIN social_accounts AS sa ON sa.id = pd.social_account_id").
			Where("pd.post_id = ?", post.ID).
			Scan(ctx, &destinations); err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch destinations")
		}

		var mediaAttachments []struct {
			MediaID      string `bun:"media_id"`
			DisplayOrder int    `bun:"display_order"`
			FilePath     string `bun:"file_path"`
			MimeType     string `bun:"mime_type"`
			AltText      string `bun:"alt_text"`
		}
		if err := h.db.NewSelect().
			TableExpr("post_media AS pm").
			ColumnExpr("pm.media_id, pm.display_order, ma.file_path, ma.mime_type, ma.alt_text").
			Join("JOIN media_attachments AS ma ON ma.id = pm.media_id").
			Where("pm.post_id = ?", post.ID).
			Order("pm.display_order ASC").
			Scan(ctx, &mediaAttachments); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error500InternalServerError("failed to fetch media")
		}

		destResp := make([]PostDestinationResponse, len(destinations))
		for i, d := range destinations {
			destResp[i] = PostDestinationResponse{
				SocialAccountID: d.SocialAccountID,
				Platform:        d.Platform,
				Status:          d.Status,
				ErrorMessage:    d.ErrorMessage,
				ErrorKind:       d.ErrorKind,
				ErrorCode:       d.ErrorCode,
				ErrorHTTPStatus: d.ErrorHTTPStatus,
				ErrorRetryable:  d.ErrorRetryable,
				ErrorRetryAt:    formatOptionalTime(d.ErrorRetryAt),
				ErrorAction:     d.ErrorAction,
			}
		}

		mediaResp := make([]PostMediaResponse, len(mediaAttachments))
		for i, m := range mediaAttachments {
			mediaResp[i] = PostMediaResponse{
				MediaID:      m.MediaID,
				DisplayOrder: m.DisplayOrder,
				FilePath:     m.FilePath,
				MimeType:     m.MimeType,
				AltText:      m.AltText,
			}
		}

		resp := &UpdatePostOutput{Body: &PostDetailResponse{
			ID:                 respPost.ID,
			PublicationID:      respPost.PublicationID,
			WorkspaceID:        respPost.WorkspaceID,
			CreatedByID:        respPost.CreatedByID,
			Content:            respPost.Content,
			Status:             respPost.Status,
			Revision:           respPost.Revision,
			ScheduledAt:        respPost.ScheduledAt.Format(time.RFC3339),
			RandomDelayMinutes: respPost.RandomDelayMinutes,
			CreatedAt:          respPost.CreatedAt.Format(time.RFC3339),
			UpdatedAt:          respPost.UpdatedAt.Format(time.RFC3339),
			Media:              mediaResp,
			Destinations:       destResp,
		}}
		if !respPost.ActualRunAt.IsZero() {
			resp.Body.ActualRunAt = respPost.ActualRunAt.Format(time.RFC3339)
		}
		return resp, nil
	})
}

type DeletePostInput struct {
	PathID string `path:"id" doc:"Post ID"`
}

type DeletePostOutput struct {
	Body struct {
		Message string `json:"message" doc:"Success message"`
	}
}

func (h *PostHandler) DeletePost(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "delete-post",
		Method:      http.MethodDelete,
		Path:        postPathByID,
		Summary:     "Delete a post",
		Tags:        []string{tagPosts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, h.deletePost)
}

func (h *PostHandler) deletePost(ctx context.Context, input *DeletePostInput) (*DeletePostOutput, error) {
	userID := middleware.GetUserID(ctx)
	var post models.Post
	err := h.db.NewSelect().Model(&post).Where("id = ?", input.PathID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("post not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to fetch post")
	}
	if err := h.checkWorkspaceEditAccess(ctx, post.WorkspaceID, userID); err != nil {
		return nil, err
	}
	if post.Status == models.PostStatusPublished || post.Status == models.PostStatusPublishing {
		return nil, huma.Error400BadRequest("cannot delete a post that is published or being published")
	}
	if h.beforeLegacyMutationTransaction != nil {
		if err := h.beforeLegacyMutationTransaction(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to begin post deletion")
		}
	}
	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return h.deletePostTx(txCtx, tx, post.ID)
	})
	if err != nil {
		return nil, publicationMutationHTTPError(err, "failed to delete post")
	}
	return &DeletePostOutput{Body: struct {
		Message string `json:"message" doc:"Success message"`
	}{Message: "post deleted successfully"}}, nil
}

func (h *PostHandler) deletePostTx(ctx context.Context, tx bun.Tx, postID string) error {
	current, err := h.prepareEditableLegacyPostMutationTx(ctx, tx, postID)
	if err != nil {
		return err
	}
	allIDs, err := postservice.GetThreadPostIDsTx(ctx, tx, current.ID, true)
	if err != nil {
		return err
	}
	if _, err := tx.NewDelete().Model(&models.Job{}).
		Where(publishPostJobPostIDWhere(h.db), jobTypePublishPost, current.ID).
		Where("status = ?", "pending").Exec(ctx); err != nil {
		return fmt.Errorf("failed to delete jobs: %w", err)
	}
	if err := h.deletePendingPublicationJobTx(ctx, tx, current.PublicationID); err != nil {
		return err
	}
	if err := postservice.DeletePostsCascadeTx(ctx, tx, allIDs); err != nil {
		return err
	}
	if current.PublicationID == "" {
		return nil
	}
	_, err = tx.NewDelete().Model((*models.Publication)(nil)).
		Where("id = ?", current.PublicationID).Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to delete translated publication: %w", err)
	}
	return nil
}

func (h *PostHandler) deletePendingPublicationJobTx(ctx context.Context, tx bun.Tx, publicationID string) error {
	if publicationID == "" {
		return nil
	}
	_, err := tx.NewDelete().Model(&models.Job{}).
		Where(publishPublicationJobPublicationIDWhere(h.db), jobTypePublishPublication, publicationID).
		Where("status = ?", "pending").Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to delete publication jobs: %w", err)
	}
	return nil
}

func (h *PostHandler) checkWorkspaceAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := middleware.CheckWorkspaceAccess(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError("failed to check workspace access")
	}
	if !allowed {
		return huma.Error403Forbidden("workspace not accessible")
	}
	return nil
}

func (h *PostHandler) checkWorkspaceEditAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := middleware.CheckWorkspaceEditAccess(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError("failed to check workspace access")
	}
	if !allowed {
		return huma.Error403Forbidden("workspace editor role required")
	}
	return nil
}

type VariantInput struct {
	SocialAccountID string  `json:"social_account_id" doc:"Social account ID"`
	Content         *string `json:"content,omitempty" doc:"Custom content for this platform (empty = use parent content)"`
	MediaIDs        *string `json:"media_ids,omitempty" doc:"JSON array of media IDs override"`
	IsUnsynced      bool    `json:"is_unsynced" doc:"Whether this variant has diverged from parent"`
}

type UpsertVariantsInput struct {
	PathID string `path:"id" doc:"Post ID"`
	Body   struct {
		Variants []VariantInput `json:"variants" doc:"Variant overrides per social account"`
	}
}

type VariantResponse struct {
	ID              string `json:"id" doc:"Variant ID"`
	PostID          string `json:"post_id" doc:"Post ID"`
	SocialAccountID string `json:"social_account_id" doc:"Social account ID"`
	Content         string `json:"content" doc:"Variant content (empty = use parent)"`
	MediaIDs        string `json:"media_ids" doc:"JSON array of media IDs override"`
	IsUnsynced      bool   `json:"is_unsynced" doc:"Whether this variant has diverged from parent"`
	CreatedAt       string `json:"created_at" doc:"Creation time"`
	UpdatedAt       string `json:"updated_at" doc:"Last update time"`
}

type UpsertVariantsOutput struct {
	Body struct {
		Variants []VariantResponse `json:"variants" doc:"Updated variants"`
	}
}

//nolint:gocyclo
func (h *PostHandler) UpsertVariants(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "upsert-post-variants",
		Method:      http.MethodPut,
		Path:        postPathVariants,
		Summary:     "Upsert per-platform content variants for a post",
		Tags:        []string{tagPosts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, func(ctx context.Context, input *UpsertVariantsInput) (*UpsertVariantsOutput, error) {
		userID := middleware.GetUserID(ctx)

		var post models.Post
		err := h.db.NewSelect().
			Model(&post).
			Where("id = ?", input.PathID).
			Scan(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound("post not found")
			}
			return nil, huma.Error500InternalServerError("failed to fetch post")
		}

		if err := h.checkWorkspaceEditAccess(ctx, post.WorkspaceID, userID); err != nil {
			return nil, err
		}
		accountIDs := make([]string, 0, len(input.Body.Variants))
		var variantMediaIDs []string
		for _, v := range input.Body.Variants {
			accountIDs = append(accountIDs, v.SocialAccountID)
			if v.MediaIDs != nil && *v.MediaIDs != "" {
				var mediaIDs []string
				if err := json.Unmarshal([]byte(*v.MediaIDs), &mediaIDs); err != nil || mediaIDs == nil {
					return nil, huma.Error400BadRequest("variant media_ids must be a JSON array of media IDs")
				}
				variantMediaIDs = append(variantMediaIDs, mediaIDs...)
			}
		}
		if err := h.validateAccountsBelongToWorkspace(ctx, post.WorkspaceID, accountIDs); err != nil {
			return nil, err
		}
		if err := h.validateMediaBelongsToWorkspace(ctx, post.WorkspaceID, variantMediaIDs); err != nil {
			return nil, err
		}

		if h.beforeLegacyMutationTransaction != nil {
			if err := h.beforeLegacyMutationTransaction(ctx); err != nil {
				return nil, huma.Error500InternalServerError("failed to begin variant update")
			}
		}
		err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			current, err := h.prepareEditableLegacyPostMutationTx(txCtx, tx, post.ID)
			if err != nil {
				return err
			}
			post = *current
			for _, v := range input.Body.Variants {
				var existing models.PostVariant
				err := tx.NewSelect().
					Model(&existing).
					Where("post_id = ? AND social_account_id = ?", input.PathID, v.SocialAccountID).
					Scan(txCtx)

				now := time.Now().UTC()
				if errors.Is(err, sql.ErrNoRows) {
					content := post.Content
					if v.Content != nil {
						content = *v.Content
					}
					mediaIDs := ""
					if v.MediaIDs != nil {
						mediaIDs = *v.MediaIDs
					}
					variant := models.PostVariant{
						ID:              uuid.New().String(),
						PostID:          input.PathID,
						SocialAccountID: v.SocialAccountID,
						Content:         content,
						MediaIDs:        mediaIDs,
						IsUnsynced:      v.IsUnsynced || (v.Content != nil),
						CreatedAt:       now,
						UpdatedAt:       now,
					}
					if _, err := tx.NewInsert().Model(&variant).Exec(txCtx); err != nil {
						return err
					}
				} else {
					if v.Content != nil {
						existing.Content = *v.Content
						existing.IsUnsynced = true
					}
					if v.MediaIDs != nil {
						existing.MediaIDs = *v.MediaIDs
						existing.IsUnsynced = true
					}
					if v.IsUnsynced {
						existing.IsUnsynced = true
					}
					existing.UpdatedAt = now
					if _, err := tx.NewUpdate().Model(&existing).Where("post_id = ? AND social_account_id = ?", input.PathID, v.SocialAccountID).Exec(txCtx); err != nil {
						return err
					}
				}
			}
			return h.finishLegacyPostMutationTx(txCtx, tx, post.ID)
		})
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to upsert variants")
		}

		var variants []models.PostVariant
		if err := h.db.NewSelect().
			Model(&variants).
			Where("post_id = ?", input.PathID).
			Scan(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch variants")
		}

		resp := make([]VariantResponse, len(variants))
		for i, v := range variants {
			resp[i] = VariantResponse{
				ID:              v.ID,
				PostID:          v.PostID,
				SocialAccountID: v.SocialAccountID,
				Content:         v.Content,
				MediaIDs:        v.MediaIDs,
				IsUnsynced:      v.IsUnsynced,
				CreatedAt:       v.CreatedAt.Format(time.RFC3339),
				UpdatedAt:       v.UpdatedAt.Format(time.RFC3339),
			}
		}

		return &UpsertVariantsOutput{Body: struct {
			Variants []VariantResponse `json:"variants" doc:"Updated variants"`
		}{Variants: resp}}, nil
	})
}

type GetVariantsInput struct {
	PathID string `path:"id" doc:"Post ID"`
}

type GetVariantsOutput struct {
	Body struct {
		Variants []VariantResponse `json:"variants" doc:"Post variants"`
	}
}

func (h *PostHandler) GetVariants(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-post-variants",
		Method:      http.MethodGet,
		Path:        postPathVariants,
		Summary:     "Get per-platform content variants for a post",
		Tags:        []string{tagPosts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *GetVariantsInput) (*GetVariantsOutput, error) {
		userID := middleware.GetUserID(ctx)

		var post models.Post
		err := h.db.NewSelect().
			Model(&post).
			Where("id = ?", input.PathID).
			Scan(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound("post not found")
			}
			return nil, huma.Error500InternalServerError("failed to fetch post")
		}

		if err := h.checkWorkspaceAccess(ctx, post.WorkspaceID, userID); err != nil {
			return nil, err
		}

		var variants []models.PostVariant
		if err := h.db.NewSelect().
			Model(&variants).
			Where("post_id = ?", input.PathID).
			Scan(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch variants")
		}

		resp := make([]VariantResponse, len(variants))
		for i, v := range variants {
			resp[i] = VariantResponse{
				ID:              v.ID,
				PostID:          v.PostID,
				SocialAccountID: v.SocialAccountID,
				Content:         v.Content,
				MediaIDs:        v.MediaIDs,
				IsUnsynced:      v.IsUnsynced,
				CreatedAt:       v.CreatedAt.Format(time.RFC3339),
				UpdatedAt:       v.UpdatedAt.Format(time.RFC3339),
			}
		}

		return &GetVariantsOutput{Body: struct {
			Variants []VariantResponse `json:"variants" doc:"Post variants"`
		}{Variants: resp}}, nil
	})
}

type DeleteVariantsInput struct {
	PathID string `path:"id" doc:"Post ID"`
}

type DeleteVariantsOutput struct {
	Body struct {
		Message string `json:"message" doc:"Success message"`
	}
}

func (h *PostHandler) DeleteVariants(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "delete-post-variants",
		Method:      http.MethodDelete,
		Path:        postPathVariants,
		Summary:     "Delete all variants for a post (reset to unified content)",
		Tags:        []string{tagPosts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, func(ctx context.Context, input *DeleteVariantsInput) (*DeleteVariantsOutput, error) {
		userID := middleware.GetUserID(ctx)

		var post models.Post
		err := h.db.NewSelect().
			Model(&post).
			Where("id = ?", input.PathID).
			Scan(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound("post not found")
			}
			return nil, huma.Error500InternalServerError("failed to fetch post")
		}

		if err := h.checkWorkspaceEditAccess(ctx, post.WorkspaceID, userID); err != nil {
			return nil, err
		}

		if h.beforeLegacyMutationTransaction != nil {
			if err := h.beforeLegacyMutationTransaction(ctx); err != nil {
				return nil, huma.Error500InternalServerError("failed to begin variant deletion")
			}
		}
		err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			current, err := h.prepareEditableLegacyPostMutationTx(txCtx, tx, post.ID)
			if err != nil {
				return err
			}
			post = *current
			if _, err := tx.NewDelete().
				Model(&models.PostVariant{}).
				Where("post_id = ?", input.PathID).
				Exec(txCtx); err != nil {
				return err
			}
			return h.finishLegacyPostMutationTx(txCtx, tx, post.ID)
		})
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to delete variants")
		}

		return &DeleteVariantsOutput{Body: struct {
			Message string `json:"message" doc:"Success message"`
		}{Message: "variants deleted successfully"}}, nil
	})
}
