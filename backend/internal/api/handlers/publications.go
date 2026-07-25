package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/drafts"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/lifecycle"
	postservice "github.com/openpost/backend/internal/services/posts"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

const (
	publicationsPath      = "/publications"
	publicationPathByID   = "/publications/{id}"
	publicationPathValid  = "/publications/{id}/validate"
	publicationEventsPath = "/publications/{id}/events"
)

var (
	errPublicationScheduleConflict  = errors.New("scheduled_at and clear_schedule cannot be used together")
	errPublicationScheduleFuture    = errors.New("scheduled_at must be in the future")
	errPublicationNotEditable       = errors.New("publication is no longer editable")
	errPublicationNotFound          = errors.New("publication not found")
	errPublicationAlreadyProcessing = errors.New("publication is already being processed")
	errPublicationValidationBlocked = errors.New("publication has blocking validation errors")
	errPublicationScheduleRequired  = errors.New("scheduled_at is required before scheduling")
)

type PublicationHandler struct {
	db          *bun.DB
	auth        middleware.Authenticator
	entitlement entitlements.Service
	providers   map[string]platform.Adapter
	tokenSource AccessTokenSource
}

func (h *PublicationHandler) SetCapabilityDependencies(providers map[string]platform.Adapter, tokenSource AccessTokenSource) {
	h.providers = providers
	h.tokenSource = tokenSource
}

func NewPublicationHandler(db *bun.DB, authenticator middleware.Authenticator, entitlement entitlements.Service) *PublicationHandler {
	if entitlement == nil {
		entitlement = entitlements.NewSelfHostedService()
	}
	return &PublicationHandler{db: db, auth: authenticator, entitlement: entitlement}
}

type PublicationMediaInput struct {
	MediaID              string                 `json:"media_id" doc:"Media attachment ID"`
	Role                 string                 `json:"role,omitempty" doc:"Media role: attachment, cover, thumbnail"`
	AltText              string                 `json:"alt_text,omitempty" doc:"Alt text override"`
	ThumbnailTimestampMS int                    `json:"thumbnail_timestamp_ms,omitempty" doc:"Video thumbnail timestamp"`
	Settings             map[string]interface{} `json:"settings,omitempty" doc:"Media-item settings"`
}

type PublicationSegmentInput struct {
	ID          string                  `json:"id,omitempty" doc:"Client segment reference on create, or an existing server segment ID on update"`
	Body        string                  `json:"body,omitempty" doc:"Canonical segment body"`
	Title       string                  `json:"title,omitempty" doc:"Canonical segment title"`
	Description string                  `json:"description,omitempty" doc:"Canonical segment description"`
	URL         string                  `json:"url,omitempty" doc:"Canonical segment URL"`
	Settings    map[string]interface{}  `json:"settings,omitempty" doc:"Canonical segment settings"`
	Media       []PublicationMediaInput `json:"media,omitempty" doc:"Ordered canonical segment media"`
}

type RenditionSegmentInput struct {
	ID                   string                  `json:"id,omitempty" doc:"Legacy client reference; replacement IDs are server-generated"`
	PublicationSegmentID string                  `json:"publication_segment_id,omitempty" doc:"Server canonical segment ID, or its matching client segment reference in the same request"`
	Body                 string                  `json:"body,omitempty" doc:"Destination segment body override"`
	Title                string                  `json:"title,omitempty" doc:"Destination segment title override"`
	Description          string                  `json:"description,omitempty" doc:"Destination segment description override"`
	URL                  string                  `json:"url,omitempty" doc:"Destination segment URL override"`
	Settings             map[string]interface{}  `json:"settings,omitempty" doc:"Segment-scoped destination settings"`
	Media                []PublicationMediaInput `json:"media,omitempty" doc:"Destination segment ordered media"`
}

type RenditionInput struct {
	ID              string                  `json:"id,omitempty" doc:"Legacy client reference; replacement IDs are server-generated"`
	SocialAccountID string                  `json:"social_account_id" doc:"Social account ID"`
	Profile         string                  `json:"profile,omitempty" doc:"Content profile override"`
	OutputProfile   string                  `json:"output_profile,omitempty" doc:"Resolved provider-qualified output profile"`
	Body            string                  `json:"body,omitempty" doc:"Platform-specific body"`
	Title           string                  `json:"title,omitempty" doc:"Platform-specific title"`
	Description     string                  `json:"description,omitempty" doc:"Platform-specific description"`
	Settings        map[string]interface{}  `json:"settings,omitempty" doc:"Provider-specific settings"`
	Media           []PublicationMediaInput `json:"media,omitempty" doc:"Rendition-specific ordered media"`
	Segments        []RenditionSegmentInput `json:"segments,omitempty" doc:"Ordered destination segments"`
}

type CreatePublicationInput struct {
	Body struct {
		WorkspaceID      string                    `json:"workspace_id" doc:"Workspace ID"`
		Title            string                    `json:"title" doc:"Internal publication title"`
		Intent           string                    `json:"intent,omitempty" enum:"post,thread,story,short_video,video" doc:"Publishing intent"`
		ContentProfile   string                    `json:"content_profile" doc:"Content profile"`
		SourceText       string                    `json:"source_text" doc:"Canonical source text"`
		SourceURL        string                    `json:"source_url,omitempty" doc:"Source URL for link shares"`
		Goal             string                    `json:"goal,omitempty" doc:"Publication goal"`
		Audience         string                    `json:"audience,omitempty" doc:"Target audience"`
		ScheduledAt      *time.Time                `json:"scheduled_at,omitempty" doc:"Optional schedule time"`
		Metadata         map[string]interface{}    `json:"metadata,omitempty" doc:"Publication metadata"`
		SocialAccountIDs []string                  `json:"social_account_ids,omitempty" doc:"Accounts to create default renditions for"`
		Media            []PublicationMediaInput   `json:"media,omitempty" doc:"Default ordered media"`
		Segments         []PublicationSegmentInput `json:"segments,omitempty" doc:"Ordered canonical publication segments"`
		Renditions       []RenditionInput          `json:"renditions,omitempty" doc:"Explicit platform/account renditions"`
	}
}

type PublicationUpdateBody struct {
	ExpectedRevision int                       `json:"expected_revision" minimum:"1" doc:"Revision loaded by the editor"`
	Force            bool                      `json:"force,omitempty" doc:"Confirms an explicit overwrite after reviewing the latest revision"`
	Title            *string                   `json:"title,omitempty" doc:"Internal publication title"`
	Intent           *string                   `json:"intent,omitempty" enum:"post,thread,story,short_video,video" doc:"Publishing intent"`
	ContentProfile   *string                   `json:"content_profile,omitempty" doc:"Content profile"`
	SourceText       *string                   `json:"source_text,omitempty" doc:"Canonical source text"`
	SourceURL        *string                   `json:"source_url,omitempty" doc:"Source URL"`
	Goal             *string                   `json:"goal,omitempty" doc:"Publication goal"`
	Audience         *string                   `json:"audience,omitempty" doc:"Target audience"`
	ScheduledAt      *time.Time                `json:"scheduled_at,omitempty" doc:"Optional schedule time"`
	ClearSchedule    bool                      `json:"clear_schedule,omitempty" doc:"Clear the saved schedule and cancel its pending publication job"`
	Metadata         map[string]interface{}    `json:"metadata,omitempty" doc:"Publication metadata"`
	Segments         []PublicationSegmentInput `json:"segments,omitempty" doc:"Replacement ordered canonical segments"`
	Renditions       []RenditionInput          `json:"renditions,omitempty" doc:"Replacement destination renditions saved in the same transaction"`
}

type UpdatePublicationInput struct {
	PathID string `path:"id" doc:"Publication ID"`
	Body   PublicationUpdateBody
}

type UpsertRenditionsInput struct {
	PathID string `path:"id" doc:"Publication ID"`
	Body   struct {
		ExpectedRevision int              `json:"expected_revision" minimum:"1" doc:"Revision loaded by the editor"`
		Renditions       []RenditionInput `json:"renditions" doc:"Renditions to replace or upsert"`
	}
}

type ListPublicationsInput struct {
	WorkspaceID    string `query:"workspace_id" required:"true" doc:"Workspace ID"`
	Status         string `query:"status" doc:"Optional status filter"`
	ContentProfile string `query:"content_profile" doc:"Optional content profile filter"`
	Limit          int    `query:"limit" doc:"Limit, default 50"`
	Offset         int    `query:"offset" doc:"Offset"`
}

type GetPublicationInput struct {
	PathID string `path:"id" doc:"Publication ID"`
}

type DeletePublicationInput struct {
	PathID           string `path:"id" doc:"Publication ID"`
	Confirm          bool   `query:"confirm" doc:"Explicit confirmation that the publication may be permanently deleted"`
	ExpectedRevision int    `query:"expected_revision" minimum:"1" doc:"Revision loaded by the editor"`
}

type ListPublicationEventsInput struct {
	PathID string `path:"id" doc:"Publication ID"`
	Limit  int    `query:"limit" doc:"Limit, default 100"`
}

type PublicationActionInput struct {
	PathID string `path:"id" doc:"Publication ID"`
}

type RetryRenditionInput struct {
	PathID    string `path:"id" doc:"Publication ID"`
	AccountID string `path:"account_id" doc:"Connected account ID"`
}

type PublicationMutationActionInput struct {
	PathID string `path:"id" doc:"Publication ID"`
	Body   struct {
		ExpectedRevision int `json:"expected_revision" minimum:"1" doc:"Revision saved immediately before this action"`
	}
}

type DeletePublicationRenditionInput struct {
	PathID           string `path:"id" doc:"Publication ID"`
	AccountID        string `path:"account_id" doc:"Connected account ID"`
	Confirm          bool   `query:"confirm" doc:"Explicit confirmation that saved destination settings may be deleted"`
	ExpectedRevision int    `query:"expected_revision" minimum:"1" doc:"Revision loaded by the editor"`
}

type ReplyInput struct {
	PathID string `path:"id" doc:"Rendition ID"`
	Body   struct {
		Body     string                  `json:"body" doc:"Reply body"`
		Settings map[string]interface{}  `json:"settings,omitempty" doc:"Provider-specific reply settings"`
		Media    []PublicationMediaInput `json:"media,omitempty" doc:"Reply media"`
		ParentID string                  `json:"parent_id,omitempty" doc:"External comment or post ID to reply to"`
		RunAt    *time.Time              `json:"run_at,omitempty" doc:"Optional scheduled reply time"`
	}
}

type PublicationOutput struct {
	Body PublicationResponse
}

type PublicationListOutput struct {
	TotalCount int  `header:"X-Total-Count"`
	Limit      int  `header:"X-Limit"`
	Offset     int  `header:"X-Offset"`
	NextOffset int  `header:"X-Next-Offset"`
	HasMore    bool `header:"X-Has-More"`
	Body       []PublicationResponse
}

type PublicationValidationOutput struct {
	Body struct {
		Valid  bool                           `json:"valid"`
		Issues []capabilities.ValidationIssue `json:"issues"`
	}
}

type PublicationEventsOutput struct {
	Body []PublicationLifecycleEventResponse
}

type ActionOutput struct {
	Body struct {
		Message  string `json:"message"`
		JobID    string `json:"job_id,omitempty"`
		Revision int    `json:"revision,omitempty"`
	}
}

type PublicationResponse struct {
	ID             string                       `json:"id"`
	TextPostID     string                       `json:"text_post_id,omitempty" doc:"Linked draft post ID used by the text-and-thread composer"`
	WorkspaceID    string                       `json:"workspace_id"`
	CreatedByID    string                       `json:"created_by"`
	Title          string                       `json:"title"`
	Intent         string                       `json:"intent"`
	ContentProfile string                       `json:"content_profile"`
	SourceText     string                       `json:"source_text"`
	SourceURL      string                       `json:"source_url,omitempty"`
	Goal           string                       `json:"goal,omitempty"`
	Audience       string                       `json:"audience,omitempty"`
	Status         string                       `json:"status"`
	Revision       int                          `json:"revision"`
	ScheduledAt    string                       `json:"scheduled_at,omitempty"`
	ActualRunAt    string                       `json:"actual_run_at,omitempty"`
	Metadata       map[string]any               `json:"metadata"`
	CreatedAt      string                       `json:"created_at"`
	UpdatedAt      string                       `json:"updated_at"`
	Renditions     []RenditionResponse          `json:"renditions"`
	Segments       []PublicationSegmentResponse `json:"segments"`
	Media          []MediaSummary               `json:"media"`
}

type PublicationSegmentResponse struct {
	ID          string                 `json:"id"`
	Position    int                    `json:"position"`
	Body        string                 `json:"body"`
	Title       string                 `json:"title"`
	Description string                 `json:"description"`
	URL         string                 `json:"url,omitempty"`
	Settings    map[string]interface{} `json:"settings"`
	Media       []MediaSummary         `json:"media"`
}

type RenditionResponse struct {
	ID              string                     `json:"id"`
	PublicationID   string                     `json:"publication_id"`
	SocialAccountID string                     `json:"social_account_id"`
	Platform        string                     `json:"platform"`
	Profile         string                     `json:"profile"`
	OutputProfile   string                     `json:"output_profile"`
	Body            string                     `json:"body"`
	Title           string                     `json:"title"`
	Description     string                     `json:"description"`
	Settings        map[string]interface{}     `json:"settings"`
	Status          string                     `json:"status"`
	ExternalID      string                     `json:"external_id,omitempty"`
	ExternalURL     string                     `json:"external_url,omitempty"`
	ErrorMessage    string                     `json:"error_message,omitempty"`
	ErrorKind       string                     `json:"error_kind,omitempty"`
	ErrorCode       string                     `json:"error_code,omitempty"`
	ErrorHTTPStatus int                        `json:"error_http_status,omitempty"`
	ErrorRetryable  bool                       `json:"error_retryable"`
	ErrorRetryAt    string                     `json:"error_retry_at,omitempty"`
	ErrorAction     string                     `json:"error_action,omitempty"`
	Segments        []RenditionSegmentResponse `json:"segments"`
	Media           []MediaSummary             `json:"media"`
}

type RenditionSegmentResponse struct {
	ID                   string                 `json:"id"`
	PublicationSegmentID string                 `json:"publication_segment_id"`
	Position             int                    `json:"position"`
	Body                 string                 `json:"body"`
	Title                string                 `json:"title"`
	Description          string                 `json:"description"`
	URL                  string                 `json:"url,omitempty"`
	Settings             map[string]interface{} `json:"settings"`
	Status               string                 `json:"status"`
	ExternalID           string                 `json:"external_id,omitempty"`
	ExternalURL          string                 `json:"external_url,omitempty"`
	ErrorMessage         string                 `json:"error_message,omitempty"`
	ErrorKind            string                 `json:"error_kind,omitempty"`
	ErrorCode            string                 `json:"error_code,omitempty"`
	ErrorHTTPStatus      int                    `json:"error_http_status,omitempty"`
	ErrorRetryable       bool                   `json:"error_retryable"`
	ErrorRetryAt         string                 `json:"error_retry_at,omitempty"`
	ErrorAction          string                 `json:"error_action,omitempty"`
	Media                []MediaSummary         `json:"media"`
}

type MediaSummary struct {
	ID                   string                 `json:"id"`
	MimeType             string                 `json:"mime_type"`
	Size                 int64                  `json:"size"`
	OriginalFilename     string                 `json:"original_filename"`
	Width                int                    `json:"width"`
	Height               int                    `json:"height"`
	DurationMS           int64                  `json:"duration_ms"`
	FrameRate            float64                `json:"frame_rate"`
	AspectRatio          string                 `json:"aspect_ratio"`
	DominantType         string                 `json:"dominant_type"`
	PosterThumbnailURL   string                 `json:"poster_thumbnail_url,omitempty"`
	AnalysisStatus       string                 `json:"analysis_status"`
	AnalysisError        string                 `json:"analysis_error,omitempty"`
	PublicURLReady       bool                   `json:"public_url_ready"`
	PublicURLCheckedAt   string                 `json:"public_url_checked_at,omitempty"`
	PublicURLStatus      int                    `json:"public_url_status"`
	PublicURLError       string                 `json:"public_url_error,omitempty"`
	URL                  string                 `json:"url"`
	Role                 string                 `json:"role,omitempty"`
	DisplayOrder         int                    `json:"display_order,omitempty"`
	AltText              string                 `json:"alt_text,omitempty"`
	ThumbnailTimestampMS int                    `json:"thumbnail_timestamp_ms,omitempty"`
	Settings             map[string]interface{} `json:"settings,omitempty"`
}

type PublicationLifecycleEventResponse struct {
	ID             string         `json:"id"`
	WorkspaceID    string         `json:"workspace_id"`
	PublicationID  string         `json:"publication_id"`
	RenditionID    string         `json:"rendition_id,omitempty"`
	Type           string         `json:"type"`
	Status         string         `json:"status"`
	Message        string         `json:"message"`
	Metadata       map[string]any `json:"metadata"`
	IdempotencyKey string         `json:"idempotency_key,omitempty"`
	CreatedAt      string         `json:"created_at"`
}

func (h *PublicationHandler) RegisterRoutes(api huma.API) {
	h.createPublication(api)
	h.listPublications(api)
	h.getPublication(api)
	h.listPublicationEvents(api)
	h.updatePublication(api)
	h.deletePublication(api)
	h.upsertRenditions(api)
	h.deleteRendition(api)
	h.validatePublication(api)
	h.schedulePublication(api)
	h.publishNow(api)
	h.retryRendition(api)
	h.replyToRendition(api)
}

func (h *PublicationHandler) deleteRendition(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "delete-publication-rendition",
		Method:      http.MethodDelete,
		Path:        "/publications/{id}/renditions/{account_id}",
		Summary:     "Delete one saved publication destination",
		Description: "This permanently removes the destination and its segment and media overrides. Deselecting an account does not call this operation.",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, func(ctx context.Context, input *DeletePublicationRenditionInput) (*ActionOutput, error) {
		if !input.Confirm {
			return nil, huma.Error400BadRequest("confirm=true is required to delete a saved destination")
		}
		if err := drafts.RequireExpectedRevision(input.ExpectedRevision); err != nil {
			return nil, err
		}
		userID := middleware.GetUserID(ctx)
		publication, err := h.loadPublicationForEdit(ctx, input.PathID, userID)
		if err != nil {
			return nil, err
		}
		var deleted bool
		err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			current, err := h.loadEditablePublicationTx(txCtx, tx, publication.ID)
			if err != nil {
				return err
			}
			if current.Revision != input.ExpectedRevision {
				return h.publicationRevisionConflict(txCtx, tx, current, input.ExpectedRevision)
			}
			result, err := tx.NewDelete().
				Model((*models.Rendition)(nil)).
				Where("publication_id = ? AND social_account_id = ?", publication.ID, input.AccountID).
				Exec(txCtx)
			if err != nil {
				return err
			}
			count, err := result.RowsAffected()
			if err != nil {
				return err
			}
			deleted = count > 0
			if !deleted {
				return nil
			}
			now := time.Now().UTC()
			nextRevision := current.Revision + 1
			if _, err := tx.NewUpdate().
				Model((*models.Publication)(nil)).
				Set("revision = ?", nextRevision).
				Set("updated_at = ?", now).
				Where("id = ? AND revision = ?", current.ID, current.Revision).
				Exec(txCtx); err != nil {
				return err
			}
			if err := h.syncTextPostRevisionsTx(
				txCtx,
				tx,
				current.ID,
				current.Revision,
				nextRevision,
				[]string{"destinations", "destination overrides", "media"},
				userID,
				now,
			); err != nil {
				return err
			}
			return drafts.RecordChange(
				txCtx,
				tx,
				drafts.AggregatePublication,
				current.ID,
				nextRevision,
				[]string{"destinations", "destination overrides", "media"},
				userID,
				now,
			)
		})
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to delete publication destination")
		}
		if !deleted {
			return nil, huma.Error404NotFound("publication destination not found")
		}
		output := actionMessage("publication destination deleted", "")
		output.Body.Revision = publication.Revision + 1
		return output, nil
	})
}

//nolint:gocyclo
func (h *PublicationHandler) createPublication(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "create-publication",
		Method:      http.MethodPost,
		Path:        publicationsPath,
		Summary:     "Create a publication",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *CreatePublicationInput) (*PublicationOutput, error) {
		userID := middleware.GetUserID(ctx)
		if input.Body.WorkspaceID == "" {
			return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
		}
		if err := h.checkWorkspaceEditAccess(ctx, input.Body.WorkspaceID, userID); err != nil {
			return nil, err
		}
		if input.Body.ContentProfile == "" {
			input.Body.ContentProfile = compatibilityProfileForIntent(input.Body.Intent)
		}
		if input.Body.Intent == "" {
			input.Body.Intent = publishingIntentForProfile(input.Body.ContentProfile)
		}
		if len(input.Body.Segments) == 0 {
			input.Body.Segments = []PublicationSegmentInput{{
				Body:  input.Body.SourceText,
				Title: input.Body.Title,
				URL:   input.Body.SourceURL,
				Media: input.Body.Media,
			}}
		} else {
			firstSegment := input.Body.Segments[0]
			input.Body.SourceText = publicationFirstNonEmpty(input.Body.SourceText, firstSegment.Body)
			input.Body.SourceURL = publicationFirstNonEmpty(input.Body.SourceURL, firstSegment.URL)
			input.Body.Title = publicationFirstNonEmpty(input.Body.Title, firstSegment.Title)
		}
		if len(input.Body.Renditions) == 0 {
			input.Body.Renditions = h.defaultRenditionInputs(input.Body.SocialAccountIDs, input.Body.ContentProfile, input.Body.SourceText, input.Body.Title, input.Body.Media)
		}
		accountMap, err := h.loadAccounts(ctx, input.Body.WorkspaceID, renditionAccountIDs(input.Body.Renditions))
		if err != nil {
			return nil, err
		}
		if err := h.validateMediaBelongsToWorkspace(ctx, input.Body.WorkspaceID, allPublicationMediaIDs(input.Body.Media, input.Body.Segments, input.Body.Renditions)); err != nil {
			return nil, err
		}

		now := time.Now().UTC()
		if input.Body.ScheduledAt != nil {
			if err := validateFuturePublicationSchedule(*input.Body.ScheduledAt, now); err != nil {
				return nil, huma.Error400BadRequest(err.Error())
			}
		}
		metadataJSON := mustJSON(input.Body.Metadata)
		publication := &models.Publication{
			ID:              uuid.New().String(),
			WorkspaceID:     input.Body.WorkspaceID,
			CreatedByID:     userID,
			Title:           publicationFirstNonEmpty(input.Body.Title, firstContentLine(input.Body.SourceText), "Untitled publication"),
			Intent:          input.Body.Intent,
			ContentProfile:  input.Body.ContentProfile,
			SourceText:      input.Body.SourceText,
			SourceContent:   input.Body.SourceText,
			SourceURL:       input.Body.SourceURL,
			Goal:            input.Body.Goal,
			Audience:        input.Body.Audience,
			Status:          models.PublicationStatusDraft,
			MetadataJSON:    metadataJSON,
			ReleasePlanJSON: metadataJSON,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		if input.Body.ScheduledAt != nil {
			publication.ScheduledAt = *input.Body.ScheduledAt
		}

		err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			if _, err := tx.NewInsert().Model(publication).Exec(txCtx); err != nil {
				return err
			}
			segments, err := h.insertPublicationSegments(txCtx, tx, publication, input.Body.Segments)
			if err != nil {
				return err
			}
			return h.insertRenditions(txCtx, tx, publication, segments, input.Body.Segments, input.Body.Renditions, input.Body.Media, accountMap)
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to create publication")
		}

		resp, err := h.loadPublicationResponse(ctx, publication.ID, userID)
		if err != nil {
			return nil, err
		}
		return &PublicationOutput{Body: resp}, nil
	})
}

func (h *PublicationHandler) listPublications(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-publications",
		Method:      http.MethodGet,
		Path:        publicationsPath,
		Summary:     "List publications",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *ListPublicationsInput) (*PublicationListOutput, error) {
		userID := middleware.GetUserID(ctx)
		if err := h.checkWorkspaceAccess(ctx, input.WorkspaceID, userID); err != nil {
			return nil, err
		}
		limit := input.Limit
		if limit <= 0 || limit > 200 {
			limit = 50
		}
		query := h.db.NewSelect().Model((*models.Publication)(nil)).Where("workspace_id = ?", input.WorkspaceID)
		if input.Status != "" {
			query = query.Where("status = ?", input.Status)
		}
		if input.ContentProfile != "" {
			query = query.Where("content_profile = ?", input.ContentProfile)
		}
		total, err := query.Count(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to count publications")
		}
		var publications []models.Publication
		if err := query.Order("created_at DESC").Limit(limit).Offset(input.Offset).Scan(ctx, &publications); err != nil {
			return nil, huma.Error500InternalServerError("failed to list publications")
		}
		body := make([]PublicationResponse, 0, len(publications))
		for _, publication := range publications {
			resp, err := h.loadPublicationResponse(ctx, publication.ID, userID)
			if err != nil {
				return nil, err
			}
			body = append(body, resp)
		}
		next := input.Offset + len(body)
		return &PublicationListOutput{
			TotalCount: total,
			Limit:      limit,
			Offset:     input.Offset,
			NextOffset: next,
			HasMore:    next < total,
			Body:       body,
		}, nil
	})
}

func (h *PublicationHandler) getPublication(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-publication",
		Method:      http.MethodGet,
		Path:        publicationPathByID,
		Summary:     "Get a publication",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{404},
	}, func(ctx context.Context, input *GetPublicationInput) (*PublicationOutput, error) {
		resp, err := h.loadPublicationResponse(ctx, input.PathID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		return &PublicationOutput{Body: resp}, nil
	})
}

func (h *PublicationHandler) deletePublication(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "delete-publication",
		Method:      http.MethodDelete,
		Path:        publicationPathByID,
		Summary:     "Delete a publication",
		Description: "Permanently deletes an editable publication, its destinations, and any linked draft post.",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, func(ctx context.Context, input *DeletePublicationInput) (*ActionOutput, error) {
		if !input.Confirm {
			return nil, huma.Error400BadRequest("confirm=true is required to delete a publication")
		}
		if err := drafts.RequireExpectedRevision(input.ExpectedRevision); err != nil {
			return nil, err
		}
		publication, err := h.loadPublicationForEdit(ctx, input.PathID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			current, err := h.loadEditablePublicationTx(txCtx, tx, publication.ID)
			if err != nil {
				return err
			}
			if current.Revision != input.ExpectedRevision {
				return h.publicationRevisionConflict(txCtx, tx, current, input.ExpectedRevision)
			}
			if _, err := tx.NewDelete().
				Model((*models.Job)(nil)).
				Where(primaryPublishPublicationJobWhere(h.db), jobTypePublishPublication, current.ID).
				Exec(txCtx); err != nil {
				return fmt.Errorf("delete publication jobs: %w", err)
			}
			var linkedPostIDs []string
			if err := tx.NewSelect().
				Model((*models.Post)(nil)).
				Column("id").
				Where("publication_id = ?", current.ID).
				Scan(txCtx, &linkedPostIDs); err != nil && !isMissingLegacyPostsTable(err) {
				return fmt.Errorf("load linked draft posts: %w", err)
			}
			if err := postservice.DeletePostsCascadeTx(txCtx, tx, linkedPostIDs); err != nil {
				return err
			}
			result, err := tx.NewDelete().
				Model((*models.Publication)(nil)).
				Where("id = ? AND revision = ?", current.ID, current.Revision).
				Exec(txCtx)
			if err != nil {
				return fmt.Errorf("delete publication: %w", err)
			}
			if affected, _ := result.RowsAffected(); affected == 0 {
				latest, err := h.loadEditablePublicationTx(txCtx, tx, current.ID)
				if err != nil {
					return err
				}
				return h.publicationRevisionConflict(txCtx, tx, latest, input.ExpectedRevision)
			}
			return nil
		})
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to delete publication")
		}
		return actionMessage("publication deleted", ""), nil
	})
}

func (h *PublicationHandler) listPublicationEvents(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-publication-events",
		Method:      http.MethodGet,
		Path:        publicationEventsPath,
		Summary:     "List publication lifecycle events",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{404},
	}, func(ctx context.Context, input *ListPublicationEventsInput) (*PublicationEventsOutput, error) {
		publication, err := h.loadPublication(ctx, input.PathID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		events, err := lifecycle.NewService(h.db).ListForPublication(ctx, publication.WorkspaceID, publication.ID, input.Limit)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load publication events")
		}
		body := make([]PublicationLifecycleEventResponse, 0, len(events))
		for _, event := range events {
			body = append(body, publicationLifecycleEventResponse(event))
		}
		return &PublicationEventsOutput{Body: body}, nil
	})
}

//nolint:gocyclo // The transaction keeps revision checks, aggregate replacement, scheduling, and change tracking atomic.
func (h *PublicationHandler) updatePublication(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "update-publication",
		Method:      http.MethodPut,
		Path:        publicationPathByID,
		Summary:     "Update a publication",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *UpdatePublicationInput) (*PublicationOutput, error) {
		if err := drafts.RequireExpectedRevision(input.Body.ExpectedRevision); err != nil {
			return nil, err
		}
		userID := middleware.GetUserID(ctx)
		existing, err := h.loadPublicationForEdit(ctx, input.PathID, userID)
		if err != nil {
			return nil, err
		}
		if input.Body.Segments != nil {
			if err := h.validateMediaBelongsToWorkspace(ctx, existing.WorkspaceID, allPublicationMediaIDs(nil, input.Body.Segments, nil)); err != nil {
				return nil, err
			}
		}
		accountMap := map[string]models.SocialAccount{}
		if input.Body.Renditions != nil {
			accountMap, err = h.loadAccounts(ctx, existing.WorkspaceID, renditionAccountIDs(input.Body.Renditions))
			if err != nil {
				return nil, err
			}
			if err := h.validateMediaBelongsToWorkspace(ctx, existing.WorkspaceID, allPublicationMediaIDs(nil, nil, input.Body.Renditions)); err != nil {
				return nil, err
			}
		}
		if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			publication, err := h.loadEditablePublicationTx(txCtx, tx, input.PathID)
			if err != nil {
				return err
			}
			if publication.Revision != input.Body.ExpectedRevision {
				return h.publicationRevisionConflict(txCtx, tx, publication, input.Body.ExpectedRevision)
			}
			clearQueuedSchedule, rescheduleQueuedJob, err := applyPublicationScheduleUpdate(
				publication,
				input.Body.ScheduledAt,
				input.Body.ClearSchedule,
				time.Now().UTC(),
			)
			if err != nil {
				return err
			}
			changedDomains := publicationChangedDomains(input.Body)
			applyPublicationFieldUpdates(publication, input.Body)
			publication.UpdatedAt = time.Now().UTC()
			publication.Revision++
			if clearQueuedSchedule {
				if err := h.clearPublicationScheduleTx(txCtx, tx, publication.ID, publication.UpdatedAt); err != nil {
					return err
				}
			}
			result, err := tx.NewUpdate().
				Model(publication).
				Where("id = ? AND revision = ?", publication.ID, input.Body.ExpectedRevision).
				Exec(txCtx)
			if err != nil {
				return err
			}
			if affected, _ := result.RowsAffected(); affected == 0 {
				return h.publicationRevisionConflict(txCtx, tx, publication, input.Body.ExpectedRevision)
			}
			if input.Body.Segments != nil {
				if err := h.replacePublicationSegments(txCtx, tx, publication, input.Body.Segments); err != nil {
					return err
				}
			}
			if input.Body.Renditions != nil {
				if err := h.replaceAllPublicationRenditions(
					txCtx,
					tx,
					publication,
					input.Body.Segments,
					input.Body.Renditions,
					accountMap,
				); err != nil {
					return err
				}
			}
			if rescheduleQueuedJob {
				_, err := h.replacePublicationJobTx(txCtx, tx, publication.ID, publication.ScheduledAt)
				if err != nil {
					return err
				}
			}
			if err := h.syncTextPostRevisionsTx(
				txCtx,
				tx,
				publication.ID,
				input.Body.ExpectedRevision,
				publication.Revision,
				changedDomains,
				userID,
				publication.UpdatedAt,
			); err != nil {
				return err
			}
			return drafts.RecordChange(
				txCtx,
				tx,
				drafts.AggregatePublication,
				publication.ID,
				publication.Revision,
				changedDomains,
				userID,
				publication.UpdatedAt,
			)
		}); err != nil {
			return nil, publicationMutationHTTPError(err, "failed to update publication")
		}
		resp, err := h.loadPublicationResponse(ctx, input.PathID, userID)
		if err != nil {
			return nil, err
		}
		return &PublicationOutput{Body: resp}, nil
	})
}

func applyPublicationScheduleUpdate(
	publication *models.Publication,
	scheduledAtInput *time.Time,
	clearSchedule bool,
	now time.Time,
) (bool, bool, error) {
	if scheduledAtInput != nil && clearSchedule {
		return false, false, errPublicationScheduleConflict
	}
	if scheduledAtInput == nil && !clearSchedule {
		return false, false, nil
	}

	wasScheduled := publication.Status == models.PublicationStatusScheduled
	if clearSchedule {
		publication.ScheduledAt = time.Time{}
		if wasScheduled {
			publication.Status = models.PublicationStatusDraft
		}
		return true, false, nil
	}

	if err := validateFuturePublicationSchedule(*scheduledAtInput, now); err != nil {
		return false, false, err
	}
	publication.ScheduledAt = *scheduledAtInput
	return false, wasScheduled, nil
}

func applyPublicationFieldUpdates(publication *models.Publication, input PublicationUpdateBody) {
	if input.Title != nil {
		publication.Title = *input.Title
	}
	if input.Intent != nil {
		publication.Intent = *input.Intent
	}
	if input.ContentProfile != nil {
		publication.ContentProfile = *input.ContentProfile
	}
	if input.SourceText != nil {
		publication.SourceText = *input.SourceText
		publication.SourceContent = *input.SourceText
	}
	if input.SourceURL != nil {
		publication.SourceURL = *input.SourceURL
	}
	if input.Goal != nil {
		publication.Goal = *input.Goal
	}
	if input.Audience != nil {
		publication.Audience = *input.Audience
	}
	if input.Metadata != nil {
		publication.MetadataJSON = mustJSON(input.Metadata)
		publication.ReleasePlanJSON = publication.MetadataJSON
	}
}

func publicationChangedDomains(input PublicationUpdateBody) []string {
	var domains []string
	if input.Title != nil || input.Intent != nil || input.ContentProfile != nil ||
		input.SourceText != nil || input.SourceURL != nil || input.Goal != nil ||
		input.Audience != nil || input.Segments != nil {
		domains = append(domains, "content")
	}
	if input.Segments != nil {
		domains = append(domains, "segments", "media")
	}
	if input.Renditions != nil {
		domains = append(domains, "destinations", "destination overrides", "media")
	}
	if input.ScheduledAt != nil || input.ClearSchedule {
		domains = append(domains, "schedule")
	}
	if input.Metadata != nil {
		domains = append(domains, "settings")
	}
	if len(domains) == 0 {
		domains = append(domains, "draft")
	}
	return drafts.UniqueDomains(domains)
}

func (h *PublicationHandler) publicationRevisionConflict(
	ctx context.Context,
	db bun.IDB,
	publication *models.Publication,
	expectedRevision int,
) error {
	domains, err := drafts.ChangedDomainsSince(
		ctx,
		db,
		drafts.AggregatePublication,
		publication.ID,
		expectedRevision,
	)
	if err != nil {
		return err
	}
	if len(domains) == 0 {
		domains = []string{"draft"}
	}
	return drafts.NewConflictError(drafts.ConflictMetadata{
		AggregateType:    drafts.AggregatePublication,
		AggregateID:      publication.ID,
		ExpectedRevision: expectedRevision,
		CurrentRevision:  publication.Revision,
		Status:           publication.Status,
		Title:            publication.Title,
		UpdatedAt:        formatOptionalTime(publication.UpdatedAt),
		ChangedDomains:   domains,
	})
}

func (h *PublicationHandler) syncTextPostRevisionsTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	expectedRevision int,
	nextRevision int,
	domains []string,
	userID string,
	now time.Time,
) error {
	var posts []models.Post
	if err := tx.NewSelect().
		Model(&posts).
		Where("publication_id = ?", publicationID).
		Scan(ctx); err != nil {
		if isMissingLegacyPostsTable(err) {
			return nil
		}
		return err
	}
	for index := range posts {
		post := &posts[index]
		if post.Revision != expectedRevision {
			changed, err := drafts.ChangedDomainsSince(
				ctx,
				tx,
				drafts.AggregateTextPost,
				post.ID,
				expectedRevision,
			)
			if err != nil {
				return err
			}
			if len(changed) == 0 {
				changed = []string{"draft"}
			}
			return drafts.NewConflictError(drafts.ConflictMetadata{
				AggregateType:    drafts.AggregateTextPost,
				AggregateID:      post.ID,
				ExpectedRevision: expectedRevision,
				CurrentRevision:  post.Revision,
				Status:           post.Status,
				UpdatedAt:        formatOptionalTime(post.UpdatedAt),
				ChangedDomains:   changed,
			})
		}
		result, err := tx.NewUpdate().
			Model((*models.Post)(nil)).
			Set("revision = ?", nextRevision).
			Set("updated_at = ?", now).
			Where("id = ? AND revision = ?", post.ID, expectedRevision).
			Exec(ctx)
		if err != nil {
			return err
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			return drafts.ErrRevisionConflict
		}
		if err := drafts.RecordChange(
			ctx,
			tx,
			drafts.AggregateTextPost,
			post.ID,
			nextRevision,
			domains,
			userID,
			now,
		); err != nil {
			return err
		}
	}
	return nil
}

func validateFuturePublicationSchedule(scheduledAt, now time.Time) error {
	if !scheduledAt.After(now.UTC()) {
		return errPublicationScheduleFuture
	}
	return nil
}

func (h *PublicationHandler) replaceAllPublicationRenditions(
	ctx context.Context,
	tx bun.Tx,
	publication *models.Publication,
	segmentInputs []PublicationSegmentInput,
	renditionInputs []RenditionInput,
	accounts map[string]models.SocialAccount,
) error {
	var renditionIDs []string
	if err := tx.NewSelect().
		Model((*models.Rendition)(nil)).
		Column("id").
		Where("publication_id = ?", publication.ID).
		Scan(ctx, &renditionIDs); err != nil {
		return err
	}
	if len(renditionIDs) > 0 {
		if _, err := tx.NewDelete().
			Model((*models.RenditionMedia)(nil)).
			Where("rendition_id IN (?)", bun.List(renditionIDs)).
			Exec(ctx); err != nil {
			return err
		}
	}
	if _, err := tx.NewDelete().
		Model((*models.Rendition)(nil)).
		Where("publication_id = ?", publication.ID).
		Exec(ctx); err != nil {
		return err
	}
	segments, loadedInputs, err := h.loadCanonicalSegmentInputsWithDB(ctx, tx, publication.ID)
	if err != nil {
		return err
	}
	if segmentInputs == nil {
		segmentInputs = loadedInputs
	}
	return h.insertRenditions(ctx, tx, publication, segments, segmentInputs, renditionInputs, nil, accounts)
}

//nolint:gocyclo // The transaction preserves revision checks and both replacement and upsert semantics across renditions.
func (h *PublicationHandler) upsertRenditions(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "upsert-publication-renditions",
		Method:      http.MethodPut,
		Path:        "/publications/{id}/renditions",
		Summary:     "Replace or upsert publication renditions",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *UpsertRenditionsInput) (*PublicationOutput, error) {
		if err := drafts.RequireExpectedRevision(input.Body.ExpectedRevision); err != nil {
			return nil, err
		}
		userID := middleware.GetUserID(ctx)
		publication, err := h.loadPublicationForEdit(ctx, input.PathID, userID)
		if err != nil {
			return nil, err
		}
		accountMap, err := h.loadAccounts(ctx, publication.WorkspaceID, renditionAccountIDs(input.Body.Renditions))
		if err != nil {
			return nil, err
		}
		if err := h.validateMediaBelongsToWorkspace(ctx, publication.WorkspaceID, allPublicationMediaIDs(nil, nil, input.Body.Renditions)); err != nil {
			return nil, err
		}
		err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			currentPublication, err := h.loadEditablePublicationTx(txCtx, tx, publication.ID)
			if err != nil {
				return err
			}
			if currentPublication.Revision != input.Body.ExpectedRevision {
				return h.publicationRevisionConflict(txCtx, tx, currentPublication, input.Body.ExpectedRevision)
			}
			if len(input.Body.Renditions) == 0 {
				return nil
			}
			accountIDs := renditionAccountIDs(input.Body.Renditions)
			var existingIDs []string
			if err := tx.NewSelect().
				Model((*models.Rendition)(nil)).
				Column("id").
				Where("publication_id = ?", publication.ID).
				Where("social_account_id IN (?)", bun.List(uniqueNonEmpty(accountIDs))).
				Scan(txCtx, &existingIDs); err != nil {
				return err
			}
			if len(existingIDs) > 0 {
				if _, err := tx.NewDelete().
					Model((*models.RenditionMedia)(nil)).
					Where("rendition_id IN (?)", bun.List(existingIDs)).
					Exec(txCtx); err != nil {
					return err
				}
				if _, err := tx.NewDelete().
					Model((*models.Rendition)(nil)).
					Where("publication_id = ?", publication.ID).
					Where("social_account_id IN (?)", bun.List(uniqueNonEmpty(accountIDs))).
					Exec(txCtx); err != nil {
					return err
				}
			}
			segments, segmentInputs, err := h.loadCanonicalSegmentInputsWithDB(txCtx, tx, publication.ID)
			if err != nil {
				return err
			}
			if err := h.insertRenditions(txCtx, tx, currentPublication, segments, segmentInputs, input.Body.Renditions, nil, accountMap); err != nil {
				return err
			}
			now := time.Now().UTC()
			nextRevision := currentPublication.Revision + 1
			result, err := tx.NewUpdate().
				Model((*models.Publication)(nil)).
				Set("revision = ?", nextRevision).
				Set("updated_at = ?", now).
				Where("id = ? AND revision = ?", currentPublication.ID, currentPublication.Revision).
				Exec(txCtx)
			if err != nil {
				return err
			}
			if affected, _ := result.RowsAffected(); affected == 0 {
				return h.publicationRevisionConflict(txCtx, tx, currentPublication, input.Body.ExpectedRevision)
			}
			if err := h.syncTextPostRevisionsTx(
				txCtx,
				tx,
				currentPublication.ID,
				currentPublication.Revision,
				nextRevision,
				[]string{"destinations", "destination overrides", "media"},
				userID,
				now,
			); err != nil {
				return err
			}
			return drafts.RecordChange(
				txCtx,
				tx,
				drafts.AggregatePublication,
				currentPublication.ID,
				nextRevision,
				[]string{"destinations", "destination overrides", "media"},
				userID,
				now,
			)
		})
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to update publication renditions")
		}
		resp, err := h.loadPublicationResponse(ctx, publication.ID, userID)
		if err != nil {
			return nil, err
		}
		return &PublicationOutput{Body: resp}, nil
	})
}

func (h *PublicationHandler) validatePublication(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "validate-publication",
		Method:      http.MethodPost,
		Path:        publicationPathValid,
		Summary:     "Validate publication renditions",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *PublicationActionInput) (*PublicationValidationOutput, error) {
		publication, err := h.loadPublication(ctx, input.PathID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		issues, err := h.validatePublicationByID(ctx, publication.ID)
		if err != nil {
			return nil, err
		}
		resp := &PublicationValidationOutput{}
		resp.Body.Issues = issues
		resp.Body.Valid = !hasBlockingIssues(issues)
		return resp, nil
	})
}

func (h *PublicationHandler) schedulePublication(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "schedule-publication",
		Method:      http.MethodPost,
		Path:        "/publications/{id}/schedule",
		Summary:     "Schedule a publication",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *PublicationMutationActionInput) (*ActionOutput, error) {
		if err := drafts.RequireExpectedRevision(input.Body.ExpectedRevision); err != nil {
			return nil, err
		}
		publication, err := h.loadPublicationForEdit(ctx, input.PathID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		if issues, err := h.validatePublicationByID(ctx, publication.ID); err != nil {
			return nil, err
		} else if hasBlockingIssues(issues) {
			return nil, publicationMutationHTTPError(errPublicationValidationBlocked, "publication capability validation failed")
		}
		jobID, err := h.queueScheduledPublicationExpected(
			ctx,
			publication.ID,
			input.Body.ExpectedRevision,
		)
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to enqueue publication")
		}
		return actionMessage("publication scheduled", jobID), nil
	})
}

func (h *PublicationHandler) publishNow(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "publish-publication-now",
		Method:      http.MethodPost,
		Path:        "/publications/{id}/publish-now",
		Summary:     "Publish a publication now",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *PublicationMutationActionInput) (*ActionOutput, error) {
		if err := drafts.RequireExpectedRevision(input.Body.ExpectedRevision); err != nil {
			return nil, err
		}
		publication, err := h.loadPublicationForEdit(ctx, input.PathID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		if issues, err := h.validatePublicationByID(ctx, publication.ID); err != nil {
			return nil, err
		} else if hasBlockingIssues(issues) {
			return nil, publicationMutationHTTPError(errPublicationValidationBlocked, "publication capability validation failed")
		}
		jobID, err := h.queuePublicationNowExpected(
			ctx,
			publication.ID,
			input.Body.ExpectedRevision,
		)
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to enqueue publication")
		}
		return actionMessage("publication queued", jobID), nil
	})
}

func (h *PublicationHandler) retryRendition(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "retry-publication-rendition",
		Method:      http.MethodPost,
		Path:        "/publications/{id}/renditions/{account_id}/retry",
		Summary:     "Retry one failed publication destination",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, func(ctx context.Context, input *RetryRenditionInput) (*ActionOutput, error) {
		publication, err := h.loadPublication(ctx, input.PathID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		if err := h.checkWorkspaceEditAccess(
			ctx,
			publication.WorkspaceID,
			middleware.GetUserID(ctx),
		); err != nil {
			return nil, err
		}
		var rendition models.Rendition
		if err := h.db.NewSelect().
			Model(&rendition).
			Where("publication_id = ?", publication.ID).
			Where("social_account_id = ?", input.AccountID).
			Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound("rendition not found")
			}
			return nil, huma.Error500InternalServerError("failed to load rendition")
		}
		if rendition.Status != models.RenditionStatusFailed {
			return nil, huma.Error409Conflict("only a failed destination can be retried")
		}
		if !rendition.ErrorRetryable {
			return nil, huma.Error409Conflict("this failure requires the recommended account or content action")
		}

		jobID := uuid.NewString()
		now := time.Now().UTC()
		payload := mustJSON(map[string]string{
			"publication_id": publication.ID,
			"rendition_id":   rendition.ID,
		})
		err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			result, err := tx.NewUpdate().
				Model((*models.Rendition)(nil)).
				Set("status = ?", models.RenditionStatusScheduled).
				Set("error_retry_at = NULL").
				Set("updated_at = ?", now).
				Where("id = ?", rendition.ID).
				Where("status = ?", models.RenditionStatusFailed).
				Where("error_retryable = ?", true).
				Exec(txCtx)
			if err != nil {
				return err
			}
			affected, _ := result.RowsAffected()
			if affected == 0 {
				return errPublicationAlreadyProcessing
			}
			if _, err := tx.NewUpdate().
				Model((*models.Publication)(nil)).
				Set("status = ?", models.PublicationStatusScheduled).
				Set("updated_at = ?", now).
				Where("id = ?", publication.ID).
				Where("status = ?", models.PublicationStatusFailed).
				Exec(txCtx); err != nil {
				return err
			}
			if _, err := tx.NewUpdate().
				Model((*models.Post)(nil)).
				Set("status = ?", models.PostStatusScheduled).
				Where("publication_id = ?", publication.ID).
				Where("status = ?", models.PostStatusFailed).
				Exec(txCtx); err != nil && !isMissingLegacyPostsTable(err) {
				return err
			}
			job := &models.Job{
				ID:          jobID,
				Type:        jobTypePublishPublication,
				Payload:     payload,
				Status:      jobStatusPending,
				RunAt:       now,
				MaxAttempts: 3,
			}
			_, err = tx.NewInsert().Model(job).Exec(txCtx)
			return err
		})
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to queue destination retry")
		}
		return actionMessage("destination retry queued", jobID), nil
	})
}

func (h *PublicationHandler) replyToRendition(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "reply-to-rendition",
		Method:      http.MethodPost,
		Path:        "/renditions/{id}/reply",
		Summary:     "Queue an explicit provider reply",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *ReplyInput) (*ActionOutput, error) {
		rendition, publication, err := h.loadRenditionWithPublicationForEdit(ctx, input.PathID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		payload := map[string]interface{}{
			"rendition_id":   rendition.ID,
			"publication_id": publication.ID,
			"body":           input.Body.Body,
			"parent_id":      input.Body.ParentID,
			"settings":       input.Body.Settings,
			"media":          input.Body.Media,
			"action":         "reply",
		}
		payloadJSON := mustJSON(payload)
		runAt := time.Now().UTC()
		if input.Body.RunAt != nil {
			runAt = *input.Body.RunAt
		}
		job := &models.Job{ID: uuid.New().String(), Type: jobTypePublishPublication, Payload: payloadJSON, Status: "pending", RunAt: runAt, MaxAttempts: 3}
		if _, err := h.db.NewInsert().Model(job).Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to enqueue reply")
		}
		return actionMessage("reply queued", job.ID), nil
	})
}

func (h *PublicationHandler) insertPublicationSegments(
	ctx context.Context,
	tx bun.Tx,
	publication *models.Publication,
	inputs []PublicationSegmentInput,
) ([]models.PublicationSegment, error) {
	now := time.Now().UTC()
	segments := make([]models.PublicationSegment, 0, len(inputs))
	for position, input := range inputs {
		segment := models.PublicationSegment{
			ID:            uuid.New().String(),
			PublicationID: publication.ID,
			Position:      position,
			Body:          input.Body,
			Title:         input.Title,
			Description:   input.Description,
			URL:           input.URL,
			SettingsJSON:  mustJSON(input.Settings),
			CreatedAt:     now,
			UpdatedAt:     now,
		}
		if _, err := tx.NewInsert().Model(&segment).Exec(ctx); err != nil {
			if isMissingPublicationSegmentTable(err) {
				segments = append(segments, segment)
				for remainingPosition := position + 1; remainingPosition < len(inputs); remainingPosition++ {
					remaining := inputs[remainingPosition]
					segments = append(segments, models.PublicationSegment{
						ID:            uuid.New().String(),
						PublicationID: publication.ID,
						Position:      remainingPosition,
						Body:          remaining.Body,
						Title:         remaining.Title,
						Description:   remaining.Description,
						URL:           remaining.URL,
						SettingsJSON:  mustJSON(remaining.Settings),
						CreatedAt:     now,
						UpdatedAt:     now,
					})
				}
				return segments, nil
			}
			return nil, err
		}
		for order, media := range input.Media {
			row := models.PublicationSegmentMedia{
				SegmentID:    segment.ID,
				MediaID:      media.MediaID,
				DisplayOrder: order,
				SettingsJSON: mustJSON(media.Settings),
			}
			if _, err := tx.NewInsert().Model(&row).Exec(ctx); err != nil {
				return nil, err
			}
		}
		segments = append(segments, segment)
	}
	return segments, nil
}

//nolint:gocyclo
func (h *PublicationHandler) replacePublicationSegments(
	ctx context.Context,
	tx bun.Tx,
	publication *models.Publication,
	inputs []PublicationSegmentInput,
) error {
	if len(inputs) == 0 {
		inputs = []PublicationSegmentInput{{Body: publication.SourceText, Title: publication.Title, URL: publication.SourceURL}}
	}
	var existing []models.PublicationSegment
	if err := tx.NewSelect().
		Model(&existing).
		Where("publication_id = ?", publication.ID).
		Scan(ctx); err != nil {
		if isMissingPublicationSegmentTable(err) {
			return nil
		}
		return err
	}
	existingByID := make(map[string]models.PublicationSegment, len(existing))
	for _, segment := range existing {
		existingByID[segment.ID] = segment
	}
	keptIDs := make([]string, 0, len(inputs))
	now := time.Now().UTC()
	for position, input := range inputs {
		segmentID := strings.TrimSpace(input.ID)
		existingSegment, exists := existingByID[segmentID]
		if segmentID == "" || !exists {
			segmentID = uuid.New().String()
			row := &models.PublicationSegment{
				ID:            segmentID,
				PublicationID: publication.ID,
				Position:      position,
				Body:          input.Body,
				Title:         input.Title,
				Description:   input.Description,
				URL:           input.URL,
				SettingsJSON:  mustJSON(input.Settings),
				CreatedAt:     now,
				UpdatedAt:     now,
			}
			if _, err := tx.NewInsert().Model(row).Exec(ctx); err != nil {
				return err
			}
		} else {
			existingSegment.Position = position
			existingSegment.Body = input.Body
			existingSegment.Title = input.Title
			existingSegment.Description = input.Description
			existingSegment.URL = input.URL
			existingSegment.SettingsJSON = mustJSON(input.Settings)
			existingSegment.UpdatedAt = now
			if _, err := tx.NewUpdate().
				Model(&existingSegment).
				Column("position", "body", "title", "description", "url", "settings_json", "updated_at").
				Where("id = ? AND publication_id = ?", existingSegment.ID, publication.ID).
				Exec(ctx); err != nil {
				return err
			}
			if _, err := tx.NewDelete().
				Model((*models.PublicationSegmentMedia)(nil)).
				Where("segment_id = ?", segmentID).
				Exec(ctx); err != nil {
				return err
			}
		}
		for order, media := range input.Media {
			row := &models.PublicationSegmentMedia{
				SegmentID:    segmentID,
				MediaID:      media.MediaID,
				DisplayOrder: order,
				SettingsJSON: mustJSON(media.Settings),
			}
			if _, err := tx.NewInsert().Model(row).Exec(ctx); err != nil {
				return err
			}
		}
		keptIDs = append(keptIDs, segmentID)
	}
	removedIDs := make([]string, 0, len(existing))
	for _, segment := range existing {
		if !slices.Contains(keptIDs, segment.ID) {
			removedIDs = append(removedIDs, segment.ID)
		}
	}
	if len(removedIDs) > 0 {
		if _, err := tx.NewDelete().
			Model((*models.PublicationSegment)(nil)).
			Where("publication_id = ?", publication.ID).
			Where("id IN (?)", bun.List(removedIDs)).
			Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

//nolint:gocyclo
func (h *PublicationHandler) insertRenditions(
	ctx context.Context,
	tx bun.Tx,
	publication *models.Publication,
	canonicalSegments []models.PublicationSegment,
	canonicalInputs []PublicationSegmentInput,
	inputs []RenditionInput,
	defaultMedia []PublicationMediaInput,
	accounts map[string]models.SocialAccount,
) error {
	now := time.Now().UTC()
	if len(canonicalSegments) == 0 {
		canonicalSegments = []models.PublicationSegment{{
			ID:            "legacy:" + publication.ID,
			PublicationID: publication.ID,
			Position:      0,
			Body:          publication.SourceText,
			Title:         publication.Title,
			URL:           publication.SourceURL,
		}}
	}
	if len(canonicalInputs) == 0 {
		canonicalInputs = []PublicationSegmentInput{{
			ID:    canonicalSegments[0].ID,
			Body:  canonicalSegments[0].Body,
			Title: canonicalSegments[0].Title,
			URL:   canonicalSegments[0].URL,
			Media: defaultMedia,
		}}
	}
	for _, input := range inputs {
		account, ok := accounts[input.SocialAccountID]
		if !ok {
			return huma.Error400BadRequest("one or more social accounts are invalid, disconnected, or outside this workspace")
		}
		resolved := h.resolveRenditionCapability(ctx, tx, publication, account, input, canonicalInputs)
		profile := publicationFirstNonEmpty(input.Profile, resolved.Profile, publication.ContentProfile)
		outputProfile := publicationFirstNonEmpty(input.OutputProfile, resolved.OutputProfile, account.Platform+".post")
		status := models.RenditionStatusDraft
		if publication.Status == models.PublicationStatusScheduled {
			status = models.RenditionStatusScheduled
		}
		firstCanonical := models.PublicationSegment{}
		if len(canonicalSegments) > 0 {
			firstCanonical = canonicalSegments[0]
		}
		rendition := &models.Rendition{
			ID:              uuid.New().String(),
			PublicationID:   publication.ID,
			SocialAccountID: input.SocialAccountID,
			Platform:        account.Platform,
			Profile:         profile,
			OutputProfile:   outputProfile,
			Body:            publicationFirstNonEmpty(input.Body, firstCanonical.Body, publication.SourceText),
			Title:           publicationFirstNonEmpty(input.Title, firstCanonical.Title, publication.Title),
			Description:     publicationFirstNonEmpty(input.Description, firstCanonical.Description),
			SettingsJSON:    mustJSON(input.Settings),
			Status:          status,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		if _, err := tx.NewInsert().Model(rendition).Exec(ctx); err != nil {
			return err
		}

		segmentInputs := input.Segments
		if len(segmentInputs) == 0 {
			segmentInputs = make([]RenditionSegmentInput, 0, len(canonicalSegments))
			for position, canonical := range canonicalSegments {
				segmentInput := RenditionSegmentInput{
					PublicationSegmentID: canonical.ID,
					Body:                 canonical.Body,
					Title:                canonical.Title,
					Description:          canonical.Description,
					URL:                  canonical.URL,
				}
				if position == 0 {
					segmentInput.Body = publicationFirstNonEmpty(input.Body, segmentInput.Body)
					segmentInput.Title = publicationFirstNonEmpty(input.Title, segmentInput.Title)
					segmentInput.Description = publicationFirstNonEmpty(input.Description, segmentInput.Description)
					if len(input.Media) > 0 {
						segmentInput.Media = input.Media
					} else if len(defaultMedia) > 0 {
						segmentInput.Media = defaultMedia
					}
				}
				if len(segmentInput.Media) == 0 && position < len(canonicalInputs) {
					segmentInput.Media = canonicalInputs[position].Media
				}
				segmentInputs = append(segmentInputs, segmentInput)
			}
		}
		if err := h.insertRenditionSegments(ctx, tx, rendition, canonicalSegments, canonicalInputs, segmentInputs); err != nil {
			return err
		}
	}
	return nil
}

func (h *PublicationHandler) insertRenditionSegments(
	ctx context.Context,
	tx bun.Tx,
	rendition *models.Rendition,
	canonicalSegments []models.PublicationSegment,
	canonicalInputs []PublicationSegmentInput,
	inputs []RenditionSegmentInput,
) error {
	now := time.Now().UTC()
	legacyMediaSeen := map[string]struct{}{}
	for position, input := range inputs {
		canonical := canonicalPublicationSegment(
			position,
			input.PublicationSegmentID,
			canonicalSegments,
			canonicalInputs,
		)
		segment := &models.RenditionSegment{
			ID:                   uuid.New().String(),
			RenditionID:          rendition.ID,
			PublicationSegmentID: canonical.ID,
			Position:             position,
			Body:                 publicationFirstNonEmpty(input.Body, canonical.Body),
			Title:                publicationFirstNonEmpty(input.Title, canonical.Title),
			Description:          publicationFirstNonEmpty(input.Description, canonical.Description),
			URL:                  publicationFirstNonEmpty(input.URL, canonical.URL),
			SettingsJSON:         mustJSON(input.Settings),
			Status:               rendition.Status,
			CreatedAt:            now,
			UpdatedAt:            now,
		}
		if segment.PublicationSegmentID == "" {
			return huma.Error400BadRequest("rendition segment does not match a canonical publication segment")
		}
		if _, err := tx.NewInsert().Model(segment).Exec(ctx); err != nil {
			if isMissingPublicationSegmentTable(err) {
				return h.insertLegacyRenditionMedia(ctx, tx, rendition.ID, inputs, canonicalInputs)
			}
			return err
		}
		mediaInputs := input.Media
		if len(mediaInputs) == 0 && position < len(canonicalInputs) {
			mediaInputs = canonicalInputs[position].Media
		}
		for order, media := range mediaInputs {
			role := publicationFirstNonEmpty(media.Role, "attachment")
			row := models.RenditionSegmentMedia{
				RenditionSegmentID:   segment.ID,
				MediaID:              media.MediaID,
				Role:                 role,
				DisplayOrder:         order,
				AltText:              media.AltText,
				ThumbnailTimestampMS: media.ThumbnailTimestampMS,
				SettingsJSON:         mustJSON(media.Settings),
			}
			if _, err := tx.NewInsert().Model(&row).Exec(ctx); err != nil {
				return err
			}
			if _, seen := legacyMediaSeen[media.MediaID]; seen {
				continue
			}
			legacyMediaSeen[media.MediaID] = struct{}{}
			legacy := models.RenditionMedia{
				RenditionID:          rendition.ID,
				MediaID:              media.MediaID,
				Role:                 role,
				DisplayOrder:         len(legacyMediaSeen) - 1,
				AltText:              media.AltText,
				ThumbnailTimestampMS: media.ThumbnailTimestampMS,
			}
			if _, err := tx.NewInsert().Model(&legacy).Exec(ctx); err != nil {
				return err
			}
		}
	}
	return nil
}

func canonicalPublicationSegment(
	position int,
	requestedID string,
	segments []models.PublicationSegment,
	inputs []PublicationSegmentInput,
) models.PublicationSegment {
	canonical := models.PublicationSegment{}
	if position < len(segments) {
		canonical = segments[position]
	}
	if requestedID == "" {
		return canonical
	}
	for candidatePosition, candidate := range segments {
		inputID := ""
		if candidatePosition < len(inputs) {
			inputID = inputs[candidatePosition].ID
		}
		if candidate.ID == requestedID || inputID == requestedID {
			return candidate
		}
	}
	return canonical
}

func (h *PublicationHandler) insertLegacyRenditionMedia(
	ctx context.Context,
	tx bun.Tx,
	renditionID string,
	segments []RenditionSegmentInput,
	canonicalInputs []PublicationSegmentInput,
) error {
	seen := map[string]struct{}{}
	displayOrder := 0
	for position, segment := range segments {
		mediaInputs := segment.Media
		if len(mediaInputs) == 0 && position < len(canonicalInputs) {
			mediaInputs = canonicalInputs[position].Media
		}
		for _, media := range mediaInputs {
			if _, ok := seen[media.MediaID]; ok {
				continue
			}
			seen[media.MediaID] = struct{}{}
			row := models.RenditionMedia{
				RenditionID:          renditionID,
				MediaID:              media.MediaID,
				Role:                 publicationFirstNonEmpty(media.Role, "attachment"),
				DisplayOrder:         displayOrder,
				AltText:              media.AltText,
				ThumbnailTimestampMS: media.ThumbnailTimestampMS,
			}
			if _, err := tx.NewInsert().Model(&row).Exec(ctx); err != nil {
				return err
			}
			displayOrder++
		}
	}
	return nil
}

func (h *PublicationHandler) resolveRenditionCapability(
	ctx context.Context,
	db bun.IDB,
	publication *models.Publication,
	account models.SocialAccount,
	input RenditionInput,
	segments []PublicationSegmentInput,
) capabilities.ResolvedCapability {
	resolveSegments := make([]capabilities.ResolveSegment, 0, len(segments))
	for position, segment := range segments {
		renditionSegment := RenditionSegmentInput{}
		if position < len(input.Segments) {
			renditionSegment = input.Segments[position]
		}
		mediaInputs := renditionSegment.Media
		if len(mediaInputs) == 0 {
			mediaInputs = segment.Media
		}
		if position == 0 && len(input.Media) > 0 {
			mediaInputs = input.Media
		}
		resolveSegment := capabilities.ResolveSegment{
			ID:    publicationFirstNonEmpty(segment.ID, fmt.Sprintf("segment-%d", position+1)),
			Body:  publicationFirstNonEmpty(renditionSegment.Body, segment.Body),
			Title: publicationFirstNonEmpty(renditionSegment.Title, segment.Title),
			URL:   publicationFirstNonEmpty(renditionSegment.URL, segment.URL),
			Media: h.capabilityMediaItems(ctx, db, mediaInputs),
		}
		resolveSegments = append(resolveSegments, resolveSegment)
	}
	intent := publication.Intent
	if input.Profile != "" && input.OutputProfile == "" {
		intent = publishingIntentForProfile(input.Profile)
	}
	return capabilities.Resolve(account.Platform, capabilities.ResolveInput{
		Intent:    intent,
		SourceURL: publication.SourceURL,
		Segments:  resolveSegments,
	})
}

func (h *PublicationHandler) capabilityMediaItems(ctx context.Context, db bun.IDB, inputs []PublicationMediaInput) []capabilities.MediaItem {
	ids := make([]string, 0, len(inputs))
	for _, input := range inputs {
		ids = append(ids, input.MediaID)
	}
	ids = uniqueNonEmpty(ids)
	if len(ids) == 0 {
		return nil
	}
	var rows []models.MediaAttachment
	if err := db.NewSelect().Model(&rows).Where("id IN (?)", bun.List(ids)).Scan(ctx); err != nil {
		return nil
	}
	byID := make(map[string]models.MediaAttachment, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}
	out := make([]capabilities.MediaItem, 0, len(ids))
	for _, id := range ids {
		row := byID[id]
		out = append(out, capabilities.MediaItem{
			ID:              row.ID,
			MimeType:        row.MimeType,
			Size:            row.Size,
			Width:           row.Width,
			Height:          row.Height,
			DurationMS:      row.DurationMS,
			AnalysisStatus:  row.AnalysisStatus,
			AnalysisError:   row.AnalysisError,
			PublicURLReady:  row.PublicURLReady,
			PublicURLStatus: row.PublicURLStatus,
			PublicURLError:  row.PublicURLError,
		})
	}
	return out
}

func (h *PublicationHandler) loadPublicationResponse(ctx context.Context, publicationID, userID string) (PublicationResponse, error) {
	publication, err := h.loadPublication(ctx, publicationID, userID)
	if err != nil {
		return PublicationResponse{}, err
	}
	segments, segmentInputs, err := h.loadCanonicalSegmentInputsWithDB(ctx, h.db, publication.ID)
	if err != nil {
		return PublicationResponse{}, err
	}
	segmentMedia, err := h.loadPublicationSegmentMediaResponsesWithDB(ctx, h.db, publication.ID)
	if err != nil {
		return PublicationResponse{}, err
	}
	var renditions []models.Rendition
	if err := h.db.NewSelect().Model(&renditions).Where("publication_id = ?", publication.ID).Order("created_at ASC").Scan(ctx); err != nil {
		return PublicationResponse{}, huma.Error500InternalServerError("failed to load renditions")
	}
	mediaByRendition, publicationMedia, err := h.loadRenditionMedia(ctx, renditionIDs(renditions))
	if err != nil {
		return PublicationResponse{}, err
	}
	response := publicationResponse(publication, publicationMedia)
	response.TextPostID, err = linkedTextPostID(ctx, h.db, publication.ID)
	if err != nil {
		return PublicationResponse{}, huma.Error500InternalServerError("failed to load linked text post")
	}
	response.Segments = make([]PublicationSegmentResponse, 0, len(segments))
	for index, segment := range segments {
		settings := map[string]interface{}{}
		_ = json.Unmarshal([]byte(segment.SettingsJSON), &settings)
		response.Segments = append(response.Segments, PublicationSegmentResponse{
			ID:          segment.ID,
			Position:    segment.Position,
			Body:        segment.Body,
			Title:       segment.Title,
			Description: segment.Description,
			URL:         segment.URL,
			Settings:    settings,
			Media:       segmentMedia[segment.ID],
		})
		if index == 0 && len(response.Media) == 0 {
			response.Media = segmentMedia[segment.ID]
		}
	}
	if len(response.Segments) == 0 {
		response.Segments = []PublicationSegmentResponse{{
			ID:       "legacy:" + publication.ID,
			Position: 0,
			Body:     publication.SourceText,
			Title:    publication.Title,
			URL:      publication.SourceURL,
			Settings: map[string]interface{}{},
			Media:    response.Media,
		}}
	}
	_ = segmentInputs
	response.Renditions = make([]RenditionResponse, 0, len(renditions))
	for _, rendition := range renditions {
		renditionOutput := renditionResponse(rendition, mediaByRendition[rendition.ID])
		renditionOutput.Segments, err = h.loadRenditionSegmentResponsesWithDB(ctx, h.db, rendition)
		if err != nil {
			return PublicationResponse{}, err
		}
		response.Renditions = append(response.Renditions, renditionOutput)
	}
	return response, nil
}

func linkedTextPostID(ctx context.Context, db bun.IDB, publicationID string) (string, error) {
	var post models.Post
	err := db.NewSelect().
		Model(&post).
		Column("id").
		Where("publication_id = ?", publicationID).
		Order("thread_sequence ASC", "created_at ASC").
		Limit(1).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) || isMissingLegacyPostsTable(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return post.ID, nil
}

func (h *PublicationHandler) loadCanonicalSegmentInputsWithDB(
	ctx context.Context,
	db bun.IDB,
	publicationID string,
) ([]models.PublicationSegment, []PublicationSegmentInput, error) {
	var segments []models.PublicationSegment
	if err := db.NewSelect().
		Model(&segments).
		Where("publication_id = ?", publicationID).
		Order("position ASC").
		Scan(ctx); err != nil {
		if isMissingPublicationSegmentTable(err) {
			return nil, nil, nil
		}
		return nil, nil, huma.Error500InternalServerError("failed to load publication segments")
	}
	inputs := make([]PublicationSegmentInput, 0, len(segments))
	for _, segment := range segments {
		settings := map[string]interface{}{}
		_ = json.Unmarshal([]byte(segment.SettingsJSON), &settings)
		inputs = append(inputs, PublicationSegmentInput{
			ID:          segment.ID,
			Body:        segment.Body,
			Title:       segment.Title,
			Description: segment.Description,
			URL:         segment.URL,
			Settings:    settings,
		})
	}
	if len(segments) == 0 {
		return segments, inputs, nil
	}
	var mediaRows []models.PublicationSegmentMedia
	segmentIDs := make([]string, 0, len(segments))
	for _, segment := range segments {
		segmentIDs = append(segmentIDs, segment.ID)
	}
	if err := db.NewSelect().
		Model(&mediaRows).
		Where("segment_id IN (?)", bun.List(segmentIDs)).
		Order("segment_id ASC", "display_order ASC").
		Scan(ctx); err != nil {
		return nil, nil, huma.Error500InternalServerError("failed to load publication segment media")
	}
	positionByID := make(map[string]int, len(segments))
	for position, segment := range segments {
		positionByID[segment.ID] = position
	}
	for _, row := range mediaRows {
		settings := map[string]interface{}{}
		_ = json.Unmarshal([]byte(row.SettingsJSON), &settings)
		position := positionByID[row.SegmentID]
		inputs[position].Media = append(inputs[position].Media, PublicationMediaInput{
			MediaID:  row.MediaID,
			Settings: settings,
		})
	}
	return segments, inputs, nil
}

func (h *PublicationHandler) loadPublicationSegmentMediaResponsesWithDB(
	ctx context.Context,
	db bun.IDB,
	publicationID string,
) (map[string][]MediaSummary, error) {
	var rows []struct {
		SegmentID    string `bun:"segment_id"`
		DisplayOrder int    `bun:"display_order"`
		SettingsJSON string `bun:"settings_json"`
		models.MediaAttachment
	}
	if err := db.NewSelect().
		TableExpr("publication_segment_media AS psm").
		ColumnExpr("psm.segment_id, psm.display_order, psm.settings_json").
		ColumnExpr("m.*").
		Join("JOIN publication_segments AS ps ON ps.id = psm.segment_id").
		Join("JOIN media_attachments AS m ON m.id = psm.media_id").
		Where("ps.publication_id = ?", publicationID).
		Order("ps.position ASC", "psm.display_order ASC").
		Scan(ctx, &rows); err != nil {
		if isMissingPublicationSegmentTable(err) {
			return map[string][]MediaSummary{}, nil
		}
		return nil, huma.Error500InternalServerError("failed to load publication segment media")
	}
	out := map[string][]MediaSummary{}
	for _, row := range rows {
		item := mediaSummary(row.MediaAttachment, "attachment", row.DisplayOrder, "", 0)
		_ = json.Unmarshal([]byte(row.SettingsJSON), &item.Settings)
		out[row.SegmentID] = append(out[row.SegmentID], item)
	}
	return out, nil
}

func (h *PublicationHandler) loadRenditionSegmentResponsesWithDB(
	ctx context.Context,
	db bun.IDB,
	rendition models.Rendition,
) ([]RenditionSegmentResponse, error) {
	var segments []models.RenditionSegment
	if err := db.NewSelect().
		Model(&segments).
		Where("rendition_id = ?", rendition.ID).
		Order("position ASC").
		Scan(ctx); err != nil {
		if isMissingPublicationSegmentTable(err) {
			return []RenditionSegmentResponse{{
				ID:                   "legacy:" + rendition.ID,
				PublicationSegmentID: "legacy:" + rendition.PublicationID,
				Position:             0,
				Body:                 rendition.Body,
				Title:                rendition.Title,
				Description:          rendition.Description,
				Settings:             map[string]interface{}{},
				Status:               rendition.Status,
				ExternalID:           rendition.ExternalID,
				ExternalURL:          rendition.ExternalURL,
				ErrorMessage:         rendition.ErrorMessage,
				ErrorKind:            rendition.ErrorKind,
				ErrorCode:            rendition.ErrorCode,
				ErrorHTTPStatus:      rendition.ErrorHTTPStatus,
				ErrorRetryable:       rendition.ErrorRetryable,
				ErrorRetryAt:         formatOptionalTime(rendition.ErrorRetryAt),
				ErrorAction:          rendition.ErrorAction,
			}}, nil
		}
		return nil, huma.Error500InternalServerError("failed to load rendition segments")
	}
	if len(segments) == 0 {
		return []RenditionSegmentResponse{{
			ID:                   "legacy:" + rendition.ID,
			PublicationSegmentID: "legacy:" + rendition.PublicationID,
			Position:             0,
			Body:                 rendition.Body,
			Title:                rendition.Title,
			Description:          rendition.Description,
			Settings:             map[string]interface{}{},
			Status:               rendition.Status,
			ExternalID:           rendition.ExternalID,
			ExternalURL:          rendition.ExternalURL,
			ErrorMessage:         rendition.ErrorMessage,
			ErrorKind:            rendition.ErrorKind,
			ErrorCode:            rendition.ErrorCode,
			ErrorHTTPStatus:      rendition.ErrorHTTPStatus,
			ErrorRetryable:       rendition.ErrorRetryable,
			ErrorRetryAt:         formatOptionalTime(rendition.ErrorRetryAt),
			ErrorAction:          rendition.ErrorAction,
		}}, nil
	}
	segmentIDs := make([]string, 0, len(segments))
	for _, segment := range segments {
		segmentIDs = append(segmentIDs, segment.ID)
	}
	mediaBySegment, err := h.loadRenditionSegmentMediaWithDB(ctx, db, segmentIDs)
	if err != nil {
		return nil, err
	}
	out := make([]RenditionSegmentResponse, 0, len(segments))
	for _, segment := range segments {
		settings := map[string]interface{}{}
		_ = json.Unmarshal([]byte(segment.SettingsJSON), &settings)
		out = append(out, RenditionSegmentResponse{
			ID:                   segment.ID,
			PublicationSegmentID: segment.PublicationSegmentID,
			Position:             segment.Position,
			Body:                 segment.Body,
			Title:                segment.Title,
			Description:          segment.Description,
			URL:                  segment.URL,
			Settings:             settings,
			Status:               segment.Status,
			ExternalID:           segment.ExternalID,
			ExternalURL:          segment.ExternalURL,
			ErrorMessage:         segment.ErrorMessage,
			ErrorKind:            segment.ErrorKind,
			ErrorCode:            segment.ErrorCode,
			ErrorHTTPStatus:      segment.ErrorHTTPStatus,
			ErrorRetryable:       segment.ErrorRetryable,
			ErrorRetryAt:         formatOptionalTime(segment.ErrorRetryAt),
			ErrorAction:          segment.ErrorAction,
			Media:                mediaBySegment[segment.ID],
		})
	}
	return out, nil
}

func (h *PublicationHandler) loadRenditionSegmentMediaWithDB(
	ctx context.Context,
	db bun.IDB,
	segmentIDs []string,
) (map[string][]MediaSummary, error) {
	out := map[string][]MediaSummary{}
	if len(segmentIDs) == 0 {
		return out, nil
	}
	var rows []struct {
		RenditionSegmentID   string `bun:"rendition_segment_id"`
		Role                 string `bun:"role"`
		DisplayOrder         int    `bun:"display_order"`
		AltText              string `bun:"alt_text"`
		ThumbnailTimestampMS int    `bun:"thumbnail_timestamp_ms"`
		SettingsJSON         string `bun:"settings_json"`
		models.MediaAttachment
	}
	if err := db.NewSelect().
		TableExpr("rendition_segment_media AS rsm").
		ColumnExpr("rsm.rendition_segment_id, rsm.role, rsm.display_order, rsm.alt_text, rsm.thumbnail_timestamp_ms, rsm.settings_json").
		ColumnExpr("m.*").
		Join("JOIN media_attachments AS m ON m.id = rsm.media_id").
		Where("rsm.rendition_segment_id IN (?)", bun.List(segmentIDs)).
		Order("rsm.rendition_segment_id ASC", "rsm.display_order ASC").
		Scan(ctx, &rows); err != nil {
		return nil, huma.Error500InternalServerError("failed to load rendition segment media")
	}
	for _, row := range rows {
		item := mediaSummary(
			row.MediaAttachment,
			row.Role,
			row.DisplayOrder,
			row.AltText,
			row.ThumbnailTimestampMS,
		)
		_ = json.Unmarshal([]byte(row.SettingsJSON), &item.Settings)
		out[row.RenditionSegmentID] = append(out[row.RenditionSegmentID], item)
	}
	return out, nil
}

func (h *PublicationHandler) loadPublication(ctx context.Context, publicationID, userID string) (*models.Publication, error) {
	publicationID = publicationPathID(publicationID)
	var publication models.Publication
	if err := h.db.NewSelect().Model(&publication).Where("id = ?", publicationID).Scan(ctx); err != nil {
		return nil, huma.Error404NotFound("publication not found")
	}
	if err := h.checkWorkspaceAccess(ctx, publication.WorkspaceID, userID); err != nil {
		return nil, err
	}
	return &publication, nil
}

func (h *PublicationHandler) loadPublicationForEdit(ctx context.Context, publicationID, userID string) (*models.Publication, error) {
	publication, err := h.loadPublication(ctx, publicationID, userID)
	if err != nil {
		return nil, err
	}
	if err := h.checkWorkspaceEditAccess(ctx, publication.WorkspaceID, userID); err != nil {
		return nil, err
	}
	if !isPublicationEditable(publication.Status) {
		return nil, huma.Error400BadRequest(errPublicationNotEditable.Error())
	}
	return publication, nil
}

func (h *PublicationHandler) loadEditablePublicationTx(ctx context.Context, tx bun.Tx, publicationID string) (*models.Publication, error) {
	publicationID = publicationPathID(publicationID)
	if err := lockPublicationMutationTx(ctx, tx, publicationID); err != nil {
		return nil, err
	}
	var publication models.Publication
	if err := tx.NewSelect().Model(&publication).Where("id = ?", publicationID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errPublicationNotFound
		}
		return nil, err
	}
	if !isPublicationEditable(publication.Status) {
		return nil, errPublicationNotEditable
	}
	if err := h.lockActivePrimaryPublicationJobsTx(ctx, tx, publicationID); err != nil {
		return nil, err
	}
	if err := h.rejectProcessingPrimaryPublicationJobTx(ctx, tx, publicationID); err != nil {
		return nil, err
	}
	return &publication, nil
}

func publicationPathID(value string) string {
	decoded, err := url.PathUnescape(value)
	if err != nil {
		return value
	}
	return decoded
}

func lockPublicationMutationTx(ctx context.Context, tx bun.Tx, publicationID string) error {
	if primaryPublicationQueueUsesRowLock(tx.Dialect().Name()) {
		if err := lockPrimaryPublicationQueueTx(ctx, tx, publicationID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return errPublicationNotFound
			}
			return err
		}
		return nil
	}

	result, err := tx.NewUpdate().
		Model((*models.Publication)(nil)).
		Set("id = id").
		Where("id = ?", publicationID).
		Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return errPublicationNotFound
	}
	return nil
}

func publicationMutationHTTPError(err error, fallback string) error {
	var statusErr huma.StatusError
	if errors.As(err, &statusErr) {
		return statusErr
	}
	switch {
	case errors.Is(err, errPublicationNotFound):
		return huma.Error404NotFound(errPublicationNotFound.Error())
	case errors.Is(err, errPublicationAlreadyProcessing):
		return huma.Error409Conflict(errPublicationAlreadyProcessing.Error())
	case errors.Is(err, errPublicationNotEditable),
		errors.Is(err, errPublicationScheduleConflict),
		errors.Is(err, errPublicationScheduleFuture),
		errors.Is(err, errPublicationValidationBlocked),
		errors.Is(err, errPublicationScheduleRequired):
		return huma.Error400BadRequest(err.Error())
	default:
		return huma.Error500InternalServerError(fallback)
	}
}

func isPublicationEditable(status string) bool {
	return status == models.PublicationStatusDraft || status == models.PublicationStatusScheduled
}

func (h *PublicationHandler) loadRenditionWithPublication(ctx context.Context, renditionID, userID string) (*models.Rendition, *models.Publication, error) {
	var rendition models.Rendition
	if err := h.db.NewSelect().Model(&rendition).Where("id = ?", renditionID).Scan(ctx); err != nil {
		return nil, nil, huma.Error404NotFound("rendition not found")
	}
	publication, err := h.loadPublication(ctx, rendition.PublicationID, userID)
	if err != nil {
		return nil, nil, err
	}
	return &rendition, publication, nil
}

func (h *PublicationHandler) loadRenditionWithPublicationForEdit(ctx context.Context, renditionID, userID string) (*models.Rendition, *models.Publication, error) {
	rendition, publication, err := h.loadRenditionWithPublication(ctx, renditionID, userID)
	if err != nil {
		return nil, nil, err
	}
	if err := h.checkWorkspaceEditAccess(ctx, publication.WorkspaceID, userID); err != nil {
		return nil, nil, err
	}
	return rendition, publication, nil
}

func (h *PublicationHandler) loadRenditionMedia(ctx context.Context, ids []string) (map[string][]MediaSummary, []MediaSummary, error) {
	return h.loadRenditionMediaWithDB(ctx, h.db, ids)
}

func (h *PublicationHandler) loadRenditionMediaWithDB(ctx context.Context, db bun.IDB, ids []string) (map[string][]MediaSummary, []MediaSummary, error) {
	out := map[string][]MediaSummary{}
	publicationMedia := []MediaSummary{}
	if len(ids) == 0 {
		return out, publicationMedia, nil
	}
	var rows []struct {
		RenditionID          string `bun:"rendition_id"`
		Role                 string `bun:"role"`
		DisplayOrder         int    `bun:"display_order"`
		AltText              string `bun:"alt_text"`
		ThumbnailTimestampMS int    `bun:"thumbnail_timestamp_ms"`
		models.MediaAttachment
	}
	if err := db.NewSelect().
		TableExpr("rendition_media AS rm").
		ColumnExpr("rm.rendition_id, rm.role, rm.display_order, rm.alt_text, rm.thumbnail_timestamp_ms").
		ColumnExpr("m.*").
		Join("JOIN media_attachments AS m ON m.id = rm.media_id").
		Where("rm.rendition_id IN (?)", bun.List(ids)).
		Order("rm.rendition_id ASC", "rm.display_order ASC").
		Scan(ctx, &rows); err != nil {
		if isMissingPublicationSegmentTable(err) {
			return out, publicationMedia, nil
		}
		return nil, nil, huma.Error500InternalServerError("failed to load rendition media")
	}
	seenPublicationMedia := map[string]struct{}{}
	for _, row := range rows {
		item := mediaSummary(row.MediaAttachment, row.Role, row.DisplayOrder, row.AltText, row.ThumbnailTimestampMS)
		out[row.RenditionID] = append(out[row.RenditionID], item)
		if _, ok := seenPublicationMedia[item.ID]; !ok {
			seenPublicationMedia[item.ID] = struct{}{}
			publicationMedia = append(publicationMedia, item)
		}
	}
	sort.Slice(publicationMedia, func(i, j int) bool { return publicationMedia[i].DisplayOrder < publicationMedia[j].DisplayOrder })
	return out, publicationMedia, nil
}

func (h *PublicationHandler) validatePublicationByID(ctx context.Context, publicationID string) ([]capabilities.ValidationIssue, error) {
	issues, err := h.validatePublicationByIDWithDB(ctx, h.db, publicationID)
	if err != nil {
		return nil, err
	}
	dynamicIssues, err := h.validateDynamicPublicationCapabilities(ctx, publicationID)
	if err != nil {
		return nil, err
	}
	return append(issues, dynamicIssues...), nil
}

//nolint:gocyclo
func (h *PublicationHandler) validateDynamicPublicationCapabilities(ctx context.Context, publicationID string) ([]capabilities.ValidationIssue, error) {
	if len(h.providers) == 0 || h.tokenSource == nil {
		return nil, nil
	}
	var publication models.Publication
	if err := h.db.NewSelect().Model(&publication).Where("id = ?", publicationID).Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to load publication capabilities")
	}
	var renditions []models.Rendition
	if err := h.db.NewSelect().Model(&renditions).Where("publication_id = ?", publicationID).Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to load rendition capabilities")
	}
	accounts, err := h.loadValidationAccountsWithDB(ctx, h.db, renditionAccountIDsFromModels(renditions))
	if err != nil {
		return nil, err
	}
	issues := []capabilities.ValidationIssue{}
	for _, rendition := range renditions {
		account, ok := accounts[rendition.SocialAccountID]
		if !ok {
			continue
		}
		adapter := h.providers[account.Platform]
		if account.Platform == capabilities.ProviderMastodon {
			adapter = h.providers[capabilities.ProviderMastodon+":"+account.InstanceURL]
		}
		provider, ok := adapter.(platform.AccountCapabilityProvider)
		if !ok {
			continue
		}
		token, tokenErr := h.tokenSource.GetValidAccessToken(ctx, account.ID)
		if tokenErr != nil {
			issues = append(issues, dynamicPublicationIssue(
				rendition,
				"account_capability_authorization_failed",
				"Account authorization could not be refreshed.",
				"authorization",
			))
			continue
		}
		destinationSettings := map[string]interface{}{}
		_ = json.Unmarshal([]byte(rendition.SettingsJSON), &destinationSettings)
		result, resolveErr := provider.ResolveAccountPublishingCapabilities(ctx, token, platform.AccountCapabilityInput{
			Intent:        publication.Intent,
			OutputProfile: rendition.OutputProfile,
			Settings:      destinationSettings,
		})
		if resolveErr != nil {
			issues = append(issues, dynamicPublicationIssue(
				rendition,
				"account_capability_refresh_failed",
				resolveErr.Error(),
				"capabilities",
			))
			continue
		}
		segments, loadErr := h.loadRenditionSegmentResponsesWithDB(ctx, h.db, rendition)
		if loadErr != nil {
			return nil, loadErr
		}
		for segmentIndex, segment := range segments {
			settings := mergePublicationSettings(destinationSettings, segment.Settings)
			for key, available := range result.AvailableFeatures {
				if available || !publicationSettingEnabled(settings[key]) {
					continue
				}
				issue := dynamicPublicationIssue(
					rendition,
					"account_capability_removed",
					fmt.Sprintf("%s is no longer available for this account.", key),
					key,
				)
				issue.SegmentID = segment.ID
				issue.Scope = capabilities.SettingScopeSegment
				issue.ScopeID = segment.ID
				issues = append(issues, issue)
			}
			for source, options := range result.Options {
				key := dynamicOptionSettingKey(source)
				if key == "" {
					continue
				}
				selected := strings.TrimSpace(fmt.Sprint(settings[key]))
				if selected == "" {
					continue
				}
				found := false
				for _, option := range options {
					found = found || option.Value == selected
				}
				if !found {
					issue := dynamicPublicationIssue(
						rendition,
						"dynamic_option_removed",
						fmt.Sprintf("%s is no longer available for this account.", key),
						key,
					)
					issue.SegmentID = segment.ID
					issue.Scope = capabilities.SettingScopeSegment
					issue.ScopeID = segment.ID
					issues = append(issues, issue)
				}
			}
			issues = append(issues, validateDynamicConstraints(rendition, segment, segmentIndex, settings, result.Constraints)...)
		}
	}
	return issues, nil
}

func validateDynamicConstraints(rendition models.Rendition, segment RenditionSegmentResponse, position int, settings map[string]interface{}, constraints map[string]interface{}) []capabilities.ValidationIssue {
	issues := []capabilities.ValidationIssue{}
	appendIssue := func(code, message, field string) {
		issue := dynamicPublicationIssue(rendition, code, message, field)
		issue.SegmentID = segment.ID
		issue.Scope = capabilities.SettingScopeSegment
		issue.ScopeID = segment.ID
		issue.Parameters = map[string]any{"segment_position": position}
		issues = append(issues, issue)
	}
	if limit, ok := dynamicInt(constraints["text_limit"]); ok && limit > 0 && len([]rune(segment.Body)) > limit {
		appendIssue("dynamic_text_limit", fmt.Sprintf("Text is over the current %d character limit.", limit), "body")
	}
	if limit, ok := dynamicInt(constraints["media_max_count"]); ok && limit > 0 && len(segment.Media) > limit {
		appendIssue("dynamic_media_limit", fmt.Sprintf("This account currently supports at most %d media items.", limit), "media")
	}
	if limit, ok := dynamicInt(constraints["max_video_duration_seconds"]); ok && limit > 0 {
		for _, media := range segment.Media {
			if media.DurationMS > int64(limit)*1000 {
				appendIssue("dynamic_video_duration", fmt.Sprintf("Video must be %d seconds or less for this account.", limit), "media")
				break
			}
		}
	}
	if limit, ok := dynamicInt(constraints["poll_max_options"]); ok && limit > 0 {
		if count := len(separatedCapabilityValues(strings.TrimSpace(fmt.Sprint(settings["poll_options"])))); count > limit {
			appendIssue("dynamic_poll_limit", fmt.Sprintf("This account currently supports at most %d poll options.", limit), "poll_options")
		}
	}
	return issues
}

func dynamicPublicationIssue(rendition models.Rendition, code, message, field string) capabilities.ValidationIssue {
	return capabilities.ValidationIssue{
		Severity:        "error",
		Code:            code,
		Message:         message,
		FallbackMessage: message,
		Provider:        rendition.Platform,
		Profile:         rendition.Profile,
		OutputProfile:   rendition.OutputProfile,
		Scope:           capabilities.SettingScopeDestination,
		ScopeID:         rendition.ID,
		Field:           field,
	}
}

func publicationSettingEnabled(value interface{}) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return strings.TrimSpace(typed) != "" && !strings.EqualFold(strings.TrimSpace(typed), "false")
	default:
		return true
	}
}

func dynamicOptionSettingKey(source string) string {
	switch source {
	case "tiktok_privacy_levels":
		return "privacy_level"
	case "youtube_categories":
		return "category_id"
	case "youtube_playlists":
		return "playlist_id"
	default:
		return ""
	}
}

func separatedCapabilityValues(raw string) []string {
	values := strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == '\n' })
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			result = append(result, value)
		}
	}
	return result
}

func (h *PublicationHandler) validatePublicationByIDWithDB(ctx context.Context, db bun.IDB, publicationID string) ([]capabilities.ValidationIssue, error) {
	var renditions []models.Rendition
	if err := db.NewSelect().Model(&renditions).Where("publication_id = ?", publicationID).Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to load renditions")
	}
	mediaByRendition, _, err := h.loadRenditionMediaWithDB(ctx, db, renditionIDs(renditions))
	if err != nil {
		return nil, err
	}
	accountsByID, err := h.loadValidationAccountsWithDB(ctx, db, renditionAccountIDsFromModels(renditions))
	if err != nil {
		return nil, err
	}
	issues := []capabilities.ValidationIssue{}
	for _, rendition := range renditions {
		destinationSettings := map[string]interface{}{}
		_ = json.Unmarshal([]byte(rendition.SettingsJSON), &destinationSettings)
		segments, loadErr := h.loadRenditionSegmentResponsesWithDB(ctx, db, rendition)
		if loadErr != nil {
			return nil, loadErr
		}
		for segmentIndex, segment := range segments {
			segmentSettings := mergePublicationSettings(destinationSettings, segment.Settings)
			segmentMedia := segment.Media
			if strings.HasPrefix(segment.ID, "legacy:") {
				segmentMedia = mediaByRendition[rendition.ID]
			}
			mediaItems := capabilityMediaFromSummaries(segmentMedia)
			segmentIssues := capabilities.ValidateOutput(
				rendition.Platform,
				rendition.OutputProfile,
				rendition.Profile,
				segment.Body,
				publicationFirstNonEmpty(segment.Title, rendition.Title),
				publicationFirstNonEmpty(segment.Description, rendition.Description),
				mediaItems,
				segmentSettings,
			)
			for index := range segmentIssues {
				segmentIssues[index].SegmentID = segment.ID
				segmentIssues[index].Scope = capabilities.SettingScopeSegment
				segmentIssues[index].ScopeID = segment.ID
				if segmentIssues[index].OutputProfile == "" {
					segmentIssues[index].OutputProfile = rendition.OutputProfile
				}
				segmentIssues[index].Parameters = mergeIssueParameters(segmentIssues[index].Parameters, map[string]any{
					"segment_position": segmentIndex,
				})
			}
			issues = append(issues, segmentIssues...)
			for _, media := range segment.Media {
				mediaIssues := capabilities.ValidateMediaSettings(
					rendition.Platform,
					rendition.OutputProfile,
					rendition.Profile,
					capabilityMediaFromSummary(media),
					media.Settings,
				)
				for index := range mediaIssues {
					mediaIssues[index].SegmentID = segment.ID
					mediaIssues[index].Parameters = mergeIssueParameters(mediaIssues[index].Parameters, map[string]any{
						"segment_position": segmentIndex,
					})
				}
				issues = append(issues, mediaIssues...)
			}
		}
		if account, ok := accountsByID[rendition.SocialAccountID]; ok {
			issues = append(issues, renditionScopeIssues(rendition, account)...)
		}
		issues = append(issues, renditionProcessingIssues(rendition)...)
	}
	return issues, nil
}

func capabilityMediaFromSummary(item MediaSummary) capabilities.MediaItem {
	return capabilities.MediaItem{
		ID:              item.ID,
		MimeType:        item.MimeType,
		Size:            item.Size,
		Width:           item.Width,
		Height:          item.Height,
		DurationMS:      item.DurationMS,
		AnalysisStatus:  item.AnalysisStatus,
		AnalysisError:   item.AnalysisError,
		PublicURLReady:  item.PublicURLReady,
		PublicURLStatus: item.PublicURLStatus,
		PublicURLError:  item.PublicURLError,
		URL:             item.URL,
	}
}

func capabilityMediaFromSummaries(items []MediaSummary) []capabilities.MediaItem {
	out := make([]capabilities.MediaItem, 0, len(items))
	for _, item := range items {
		out = append(out, capabilityMediaFromSummary(item))
	}
	return out
}

func mergePublicationSettings(base, overrides map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(base)+len(overrides))
	for key, value := range base {
		out[key] = value
	}
	for key, value := range overrides {
		out[key] = value
	}
	return out
}

func mergeIssueParameters(base, extra map[string]any) map[string]any {
	out := make(map[string]any, len(base)+len(extra))
	for key, value := range base {
		out[key] = value
	}
	for key, value := range extra {
		out[key] = value
	}
	return out
}

func (h *PublicationHandler) loadValidationAccountsWithDB(ctx context.Context, db bun.IDB, accountIDs []string) (map[string]models.SocialAccount, error) {
	uniqueIDs := uniqueNonEmpty(accountIDs)
	if len(uniqueIDs) == 0 {
		return map[string]models.SocialAccount{}, nil
	}
	var accounts []models.SocialAccount
	if err := db.NewSelect().
		Model(&accounts).
		Where("id IN (?)", bun.List(uniqueIDs)).
		Where("is_active = ?", true).
		Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to load social account scopes")
	}
	out := make(map[string]models.SocialAccount, len(accounts))
	for _, account := range accounts {
		out[account.ID] = account
	}
	return out, nil
}

func renditionScopeIssues(rendition models.Rendition, account models.SocialAccount) []capabilities.ValidationIssue {
	granted := splitScopes(account.GrantedScopes)
	if len(granted) == 0 {
		return nil
	}
	missing := missingScopes(requiredScopes(rendition.Platform), granted)
	if len(missing) == 0 {
		return nil
	}
	return []capabilities.ValidationIssue{{
		Severity: "error",
		Code:     "missing_scope",
		Message:  "Connected account is missing required publishing scopes: " + strings.Join(missing, ", "),
		Provider: rendition.Platform,
		Profile:  rendition.Profile,
		Field:    "granted_scopes",
	}}
}

func renditionProcessingIssues(rendition models.Rendition) []capabilities.ValidationIssue {
	if rendition.Status != models.RenditionStatusFailed || strings.TrimSpace(rendition.ErrorMessage) == "" {
		return nil
	}
	return []capabilities.ValidationIssue{{
		Severity: "error",
		Code:     "native_processing_failed",
		Message:  rendition.ErrorMessage,
		Provider: rendition.Platform,
		Profile:  rendition.Profile,
		Field:    "status",
	}}
}

func (h *PublicationHandler) checkWorkspaceAccess(ctx context.Context, workspaceID, userID string) error {
	if workspaceID == "" {
		return huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	if !middleware.WorkspaceScopeAllows(ctx, workspaceID) {
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	var members []models.WorkspaceMember
	if err := h.db.NewSelect().Model(&members).Where("workspace_id = ? AND user_id = ?", workspaceID, userID).Scan(ctx); err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if len(members) == 0 {
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	return nil
}

func (h *PublicationHandler) checkWorkspaceEditAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := middleware.CheckWorkspaceEditAccess(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden("workspace editor role required")
	}
	return nil
}

func (h *PublicationHandler) loadAccounts(ctx context.Context, workspaceID string, accountIDs []string) (map[string]models.SocialAccount, error) {
	uniqueIDs := uniqueNonEmpty(accountIDs)
	if len(uniqueIDs) == 0 {
		return map[string]models.SocialAccount{}, nil
	}
	var accounts []models.SocialAccount
	if err := h.db.NewSelect().Model(&accounts).
		Where("workspace_id = ?", workspaceID).
		Where("is_active = ?", true).
		Where("id IN (?)", bun.List(uniqueIDs)).
		Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to validate social accounts")
	}
	if len(accounts) != len(uniqueIDs) {
		return nil, huma.Error400BadRequest("one or more social accounts are invalid, disconnected, or outside this workspace")
	}
	out := make(map[string]models.SocialAccount, len(accounts))
	for _, account := range accounts {
		out[account.ID] = account
	}
	return out, nil
}

func (h *PublicationHandler) validateMediaBelongsToWorkspace(ctx context.Context, workspaceID string, mediaIDs []string) error {
	uniqueIDs := uniqueNonEmpty(mediaIDs)
	if len(uniqueIDs) == 0 {
		return nil
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

func (h *PublicationHandler) defaultRenditionInputs(accountIDs []string, profile, body, title string, media []PublicationMediaInput) []RenditionInput {
	out := make([]RenditionInput, 0, len(accountIDs))
	for _, accountID := range uniqueNonEmpty(accountIDs) {
		out = append(out, RenditionInput{SocialAccountID: accountID, Profile: profile, Body: body, Title: title, Media: media})
	}
	return out
}

func (h *PublicationHandler) queuePublication(ctx context.Context, publicationID string, runAt time.Time) (string, error) {
	return h.queuePublicationWithRunAt(ctx, publicationID, 0, func(_ *models.Publication, _ time.Time) (time.Time, error) {
		return runAt, nil
	})
}

func (h *PublicationHandler) queueScheduledPublication(ctx context.Context, publicationID string) (string, error) {
	return h.queueScheduledPublicationExpected(ctx, publicationID, 0)
}

func (h *PublicationHandler) queueScheduledPublicationExpected(
	ctx context.Context,
	publicationID string,
	expectedRevision int,
) (string, error) {
	return h.queuePublicationWithRunAt(ctx, publicationID, expectedRevision, func(publication *models.Publication, now time.Time) (time.Time, error) {
		if publication.ScheduledAt.IsZero() {
			return time.Time{}, errPublicationScheduleRequired
		}
		if err := validateFuturePublicationSchedule(publication.ScheduledAt, now); err != nil {
			return time.Time{}, err
		}
		return publication.ScheduledAt, nil
	})
}

func (h *PublicationHandler) queuePublicationNow(ctx context.Context, publicationID string) (string, error) {
	return h.queuePublicationNowExpected(ctx, publicationID, 0)
}

func (h *PublicationHandler) queuePublicationNowExpected(
	ctx context.Context,
	publicationID string,
	expectedRevision int,
) (string, error) {
	return h.queuePublicationWithRunAt(ctx, publicationID, expectedRevision, func(_ *models.Publication, now time.Time) (time.Time, error) {
		return now, nil
	})
}

//nolint:gocyclo // Queue creation, revision checks, schedule state, and rendition state must commit as one transition.
func (h *PublicationHandler) queuePublicationWithRunAt(
	ctx context.Context,
	publicationID string,
	expectedRevision int,
	resolveRunAt func(*models.Publication, time.Time) (time.Time, error),
) (string, error) {
	var jobID string
	err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		publication, err := h.loadEditablePublicationTx(txCtx, tx, publicationID)
		if err != nil {
			return err
		}
		if expectedRevision > 0 && publication.Revision != expectedRevision {
			return h.publicationRevisionConflict(txCtx, tx, publication, expectedRevision)
		}
		issues, err := h.validatePublicationByIDWithDB(txCtx, tx, publicationID)
		if err != nil {
			return err
		}
		if hasBlockingIssues(issues) {
			return errPublicationValidationBlocked
		}
		now := time.Now().UTC()
		runAt, err := resolveRunAt(publication, now)
		if err != nil {
			return err
		}
		if !publication.ScheduledAt.IsZero() && runAt.Equal(publication.ScheduledAt) {
			var linkedPost models.Post
			err := tx.NewSelect().
				Model(&linkedPost).
				Where("publication_id = ?", publicationID).
				Order("thread_sequence ASC", "created_at ASC").
				Limit(1).
				Scan(txCtx)
			if err != nil && !errors.Is(err, sql.ErrNoRows) && !isMissingLegacyPostsTable(err) {
				return err
			}
			if err == nil && linkedPost.RandomDelayMinutes > 0 {
				runAt, err = resolveFuturePostRunAt(
					publication.ScheduledAt,
					linkedPost.RandomDelayMinutes,
					now,
				)
				if err != nil {
					return err
				}
			}
		}
		jobID, err = h.replacePublicationJobTx(txCtx, tx, publicationID, runAt)
		if err != nil {
			return err
		}
		return h.markPublicationQueuedTx(txCtx, tx, publication, runAt, now)
	})
	if err != nil {
		return "", err
	}
	return jobID, nil
}

func (h *PublicationHandler) replacePublicationJobTx(ctx context.Context, tx bun.Tx, publicationID string, runAt time.Time) (string, error) {
	if err := lockPrimaryPublicationQueueTx(ctx, tx, publicationID); err != nil {
		return "", err
	}
	if err := h.lockActivePrimaryPublicationJobsTx(ctx, tx, publicationID); err != nil {
		return "", err
	}
	if err := h.rejectProcessingPrimaryPublicationJobTx(ctx, tx, publicationID); err != nil {
		return "", err
	}
	if err := h.deletePendingPrimaryPublicationJobsTx(ctx, tx, publicationID); err != nil {
		return "", err
	}
	payload := mustJSON(map[string]string{"publication_id": publicationID})
	job := &models.Job{ID: uuid.New().String(), Type: jobTypePublishPublication, Payload: payload, Status: jobStatusPending, RunAt: runAt, MaxAttempts: 3}
	if _, err := tx.NewInsert().Model(job).Exec(ctx); err != nil {
		return "", err
	}
	return job.ID, nil
}

func lockPrimaryPublicationQueueTx(ctx context.Context, tx bun.Tx, publicationID string) error {
	if !primaryPublicationQueueUsesRowLock(tx.Dialect().Name()) {
		return nil
	}
	var lockedID string
	return primaryPublicationQueueLockQuery(tx, publicationID).Scan(ctx, &lockedID)
}

func primaryPublicationQueueUsesRowLock(name dialect.Name) bool {
	return name == dialect.PG
}

func primaryPublicationQueueLockQuery(db bun.IDB, publicationID string) *bun.SelectQuery {
	return db.NewSelect().
		TableExpr("publications").
		Column("id").
		Where("id = ?", publicationID).
		For("UPDATE")
}

func (h *PublicationHandler) lockActivePrimaryPublicationJobsTx(ctx context.Context, tx bun.Tx, publicationID string) error {
	if !primaryPublicationQueueUsesRowLock(tx.Dialect().Name()) {
		return nil
	}
	var jobIDs []string
	return tx.NewSelect().
		Model((*models.Job)(nil)).
		Column("id").
		Where(primaryPublishPublicationJobWhere(h.db), jobTypePublishPublication, publicationID).
		Where("status IN (?)", bun.List([]string{jobStatusPending, jobStatusProcessing})).
		For("UPDATE").
		Scan(ctx, &jobIDs)
}

func (h *PublicationHandler) deletePendingPrimaryPublicationJobsTx(ctx context.Context, tx bun.Tx, publicationID string) error {
	_, err := tx.NewDelete().
		Model((*models.Job)(nil)).
		Where(primaryPublishPublicationJobWhere(h.db), jobTypePublishPublication, publicationID).
		Where("status = ?", jobStatusPending).
		Exec(ctx)
	return err
}

func (h *PublicationHandler) rejectProcessingPrimaryPublicationJobTx(ctx context.Context, tx bun.Tx, publicationID string) error {
	count, err := tx.NewSelect().
		Model((*models.Job)(nil)).
		Where(primaryPublishPublicationJobWhere(h.db), jobTypePublishPublication, publicationID).
		Where("status = ?", jobStatusProcessing).
		Count(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return errPublicationAlreadyProcessing
	}
	return nil
}

func (h *PublicationHandler) clearPublicationScheduleTx(ctx context.Context, tx bun.Tx, publicationID string, updatedAt time.Time) error {
	if err := lockPublicationMutationTx(ctx, tx, publicationID); err != nil {
		return err
	}
	if err := h.lockActivePrimaryPublicationJobsTx(ctx, tx, publicationID); err != nil {
		return err
	}
	if err := h.rejectProcessingPrimaryPublicationJobTx(ctx, tx, publicationID); err != nil {
		return err
	}
	if err := h.deletePendingPrimaryPublicationJobsTx(ctx, tx, publicationID); err != nil {
		return err
	}
	if _, err := tx.NewUpdate().
		Model((*models.Rendition)(nil)).
		Set("status = ?", models.RenditionStatusDraft).
		Set("updated_at = ?", updatedAt).
		Where("publication_id = ?", publicationID).
		Where("status = ?", models.RenditionStatusScheduled).
		Exec(ctx); err != nil {
		return err
	}
	_, err := tx.NewUpdate().
		Model((*models.Post)(nil)).
		Set("status = ?", models.PostStatusDraft).
		Set("scheduled_at = ?", time.Time{}).
		Set("actual_run_at = ?", time.Time{}).
		Where("publication_id = ?", publicationID).
		Where("status = ?", models.PostStatusScheduled).
		Exec(ctx)
	if isMissingLegacyPostsTable(err) {
		return nil
	}
	return err
}

func (h *PublicationHandler) markPublicationQueuedTx(
	ctx context.Context,
	tx bun.Tx,
	publication *models.Publication,
	runAt time.Time,
	updatedAt time.Time,
) error {
	publicationID := publication.ID
	if _, err := tx.NewUpdate().Model((*models.Publication)(nil)).
		Set("status = ?", models.PublicationStatusScheduled).
		Set("updated_at = ?", updatedAt).
		Where("id = ?", publicationID).
		Exec(ctx); err != nil {
		return err
	}
	if _, err := tx.NewUpdate().Model((*models.Rendition)(nil)).
		Set("status = ?", models.RenditionStatusScheduled).
		Set("updated_at = ?", updatedAt).
		Where("publication_id = ?", publicationID).
		Where("status NOT IN (?)", bun.List([]string{models.RenditionStatusPublished, models.RenditionStatusPublishing})).
		Exec(ctx); err != nil {
		return err
	}
	scheduledAt := publication.ScheduledAt
	if scheduledAt.IsZero() {
		scheduledAt = runAt
	}
	_, err := tx.NewUpdate().
		Model((*models.Post)(nil)).
		Set("status = ?", models.PostStatusScheduled).
		Set("scheduled_at = ?", scheduledAt).
		Set("actual_run_at = ?", runAt).
		Where("publication_id = ?", publicationID).
		Where("status NOT IN (?)", bun.List([]string{
			models.PostStatusPublished,
			models.PostStatusPublishing,
		})).
		Exec(ctx)
	if isMissingLegacyPostsTable(err) {
		return nil
	}
	return err
}

func publicationResponse(publication *models.Publication, media []MediaSummary) PublicationResponse {
	metadata := map[string]any{}
	_ = json.Unmarshal([]byte(publication.MetadataJSON), &metadata)
	return PublicationResponse{
		ID:             publication.ID,
		WorkspaceID:    publication.WorkspaceID,
		CreatedByID:    publication.CreatedByID,
		Title:          publication.Title,
		Intent:         publicationFirstNonEmpty(publication.Intent, publishingIntentForProfile(publication.ContentProfile)),
		ContentProfile: publication.ContentProfile,
		SourceText:     publication.SourceText,
		SourceURL:      publication.SourceURL,
		Goal:           publication.Goal,
		Audience:       publication.Audience,
		Status:         publication.Status,
		Revision:       publication.Revision,
		ScheduledAt:    formatOptionalTime(publication.ScheduledAt),
		ActualRunAt:    formatOptionalTime(publication.ActualRunAt),
		Metadata:       metadata,
		CreatedAt:      publication.CreatedAt.Format(time.RFC3339),
		UpdatedAt:      publication.UpdatedAt.Format(time.RFC3339),
		Media:          media,
	}
}

func renditionResponse(rendition models.Rendition, media []MediaSummary) RenditionResponse {
	settings := map[string]interface{}{}
	_ = json.Unmarshal([]byte(rendition.SettingsJSON), &settings)
	return RenditionResponse{
		ID:              rendition.ID,
		PublicationID:   rendition.PublicationID,
		SocialAccountID: rendition.SocialAccountID,
		Platform:        rendition.Platform,
		Profile:         rendition.Profile,
		OutputProfile:   publicationFirstNonEmpty(rendition.OutputProfile, rendition.Platform+".post"),
		Body:            rendition.Body,
		Title:           rendition.Title,
		Description:     rendition.Description,
		Settings:        settings,
		Status:          rendition.Status,
		ExternalID:      rendition.ExternalID,
		ExternalURL:     rendition.ExternalURL,
		ErrorMessage:    rendition.ErrorMessage,
		ErrorKind:       rendition.ErrorKind,
		ErrorCode:       rendition.ErrorCode,
		ErrorHTTPStatus: rendition.ErrorHTTPStatus,
		ErrorRetryable:  rendition.ErrorRetryable,
		ErrorRetryAt:    formatOptionalTime(rendition.ErrorRetryAt),
		ErrorAction:     rendition.ErrorAction,
		Media:           media,
	}
}

func mediaSummary(media models.MediaAttachment, role string, order int, altText string, thumbnailTimestampMS int) MediaSummary {
	if altText == "" {
		altText = media.AltText
	}
	return MediaSummary{
		ID:                   media.ID,
		MimeType:             media.MimeType,
		Size:                 media.Size,
		OriginalFilename:     media.OriginalFilename,
		Width:                media.Width,
		Height:               media.Height,
		DurationMS:           media.DurationMS,
		FrameRate:            media.FrameRate,
		AspectRatio:          media.AspectRatio,
		DominantType:         media.DominantType,
		PosterThumbnailURL:   mediaPublicationPosterURL(media),
		AnalysisStatus:       media.AnalysisStatus,
		AnalysisError:        media.AnalysisError,
		PublicURLReady:       media.PublicURLReady,
		PublicURLCheckedAt:   formatOptionalTime(media.PublicURLCheckedAt),
		PublicURLStatus:      media.PublicURLStatus,
		PublicURLError:       media.PublicURLError,
		URL:                  "/media/" + media.ID,
		Role:                 role,
		DisplayOrder:         order,
		AltText:              altText,
		ThumbnailTimestampMS: thumbnailTimestampMS,
	}
}

func mediaPublicationPosterURL(media models.MediaAttachment) string {
	if media.ThumbnailObjectKey == "" {
		return ""
	}
	return "/media/" + media.ID + "/poster"
}

func publicationLifecycleEventResponse(event models.PublicationLifecycleEvent) PublicationLifecycleEventResponse {
	metadata := map[string]any{}
	_ = json.Unmarshal([]byte(event.MetadataJSON), &metadata)
	return PublicationLifecycleEventResponse{
		ID:             event.ID,
		WorkspaceID:    event.WorkspaceID,
		PublicationID:  event.PublicationID,
		RenditionID:    event.RenditionID,
		Type:           event.Type,
		Status:         event.Status,
		Message:        event.Message,
		Metadata:       metadata,
		IdempotencyKey: event.IdempotencyKey,
		CreatedAt:      event.CreatedAt.Format(time.RFC3339),
	}
}

func renditionAccountIDs(renditions []RenditionInput) []string {
	out := make([]string, 0, len(renditions))
	for _, rendition := range renditions {
		out = append(out, rendition.SocialAccountID)
	}
	return out
}

func allPublicationMediaIDs(
	defaultMedia []PublicationMediaInput,
	segments []PublicationSegmentInput,
	renditions []RenditionInput,
) []string {
	out := make([]string, 0, len(defaultMedia))
	for _, item := range defaultMedia {
		out = append(out, item.MediaID)
	}
	for _, segment := range segments {
		for _, item := range segment.Media {
			out = append(out, item.MediaID)
		}
	}
	for _, rendition := range renditions {
		for _, item := range rendition.Media {
			out = append(out, item.MediaID)
		}
		for _, segment := range rendition.Segments {
			for _, item := range segment.Media {
				out = append(out, item.MediaID)
			}
		}
	}
	return out
}

func publishingIntentForProfile(profile string) string {
	switch strings.TrimSpace(profile) {
	case models.ContentProfileThread:
		return models.PublishingIntentThread
	case models.ContentProfileStory:
		return models.PublishingIntentStory
	case models.ContentProfileShortVideo:
		return models.PublishingIntentShortVideo
	case models.ContentProfileLongVideo:
		return models.PublishingIntentVideo
	default:
		return models.PublishingIntentPost
	}
}

func compatibilityProfileForIntent(intent string) string {
	switch strings.TrimSpace(intent) {
	case models.PublishingIntentThread:
		return models.ContentProfileThread
	case models.PublishingIntentStory:
		return models.ContentProfileStory
	case models.PublishingIntentShortVideo:
		return models.ContentProfileShortVideo
	case models.PublishingIntentVideo:
		return models.ContentProfileLongVideo
	default:
		return models.ContentProfileShortText
	}
}

func renditionIDs(renditions []models.Rendition) []string {
	out := make([]string, 0, len(renditions))
	for _, rendition := range renditions {
		out = append(out, rendition.ID)
	}
	return out
}

func renditionAccountIDsFromModels(renditions []models.Rendition) []string {
	out := make([]string, 0, len(renditions))
	for _, rendition := range renditions {
		out = append(out, rendition.SocialAccountID)
	}
	return out
}

func uniqueNonEmpty(values []string) []string {
	seen := map[string]struct{}{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func isMissingPublicationSegmentTable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table") ||
		(strings.Contains(message, "relation") && strings.Contains(message, "does not exist"))
}

func isMissingLegacyPostsTable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table: posts") ||
		(strings.Contains(message, `relation "posts"`) && strings.Contains(message, "does not exist"))
}

func mustJSON(value interface{}) string {
	if value == nil {
		return "{}"
	}
	data, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func publicationFirstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func firstContentLine(content string) string {
	for _, line := range strings.Split(content, "\n") {
		if strings.TrimSpace(line) != "" {
			return strings.TrimSpace(line)
		}
	}
	return ""
}

func formatOptionalTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}

func hasBlockingIssues(issues []capabilities.ValidationIssue) bool {
	for _, issue := range issues {
		if issue.Severity == "error" {
			return true
		}
	}
	return false
}

func actionMessage(message, jobID string) *ActionOutput {
	resp := &ActionOutput{}
	resp.Body.Message = message
	resp.Body.JobID = jobID
	return resp
}
