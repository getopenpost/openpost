package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"slices"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/drafts"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/medialifecycle"
	postservice "github.com/openpost/backend/internal/services/posts"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/openpost/backend/internal/services/publicurl"
	renditionservice "github.com/openpost/backend/internal/services/renditions"
	repostservice "github.com/openpost/backend/internal/services/reposts"
	"github.com/openpost/backend/internal/telemetry"
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
	publicMedia *publicurl.MediaVerifier
	reposts     *repostservice.Service
	readiness   *providerreadiness.Service
	telemetry   telemetry.Recorder
	// beforeQueueTransaction is a deterministic concurrency seam for tests.
	// Production constructors leave it nil.
	beforeQueueTransaction func(context.Context) error
}

func (h *PublicationHandler) SetCapabilityDependencies(providers map[string]platform.Adapter, tokenSource AccessTokenSource) {
	h.providers = providers
	h.tokenSource = tokenSource
}

func (h *PublicationHandler) SetPublicMediaVerifier(verifier *publicurl.MediaVerifier) {
	h.publicMedia = verifier
}

func (h *PublicationHandler) SetRepostService(service *repostservice.Service) {
	h.reposts = service
}

func (h *PublicationHandler) SetProviderReadiness(service *providerreadiness.Service) {
	h.readiness = service
}

func (h *PublicationHandler) SetTelemetry(recorder telemetry.Recorder) {
	h.telemetry = recorder
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
	BodyOverride         *string                 `json:"body_override,omitempty" doc:"Explicit destination body; omit or null to inherit"`
	TitleOverride        *string                 `json:"title_override,omitempty" doc:"Explicit destination title; omit or null to inherit"`
	DescriptionOverride  *string                 `json:"description_override,omitempty" doc:"Explicit destination description; omit or null to inherit"`
	URLOverride          *string                 `json:"url_override,omitempty" doc:"Explicit destination URL; omit or null to inherit"`
	MediaInherited       *bool                   `json:"media_inherited,omitempty" doc:"Whether destination media follows the canonical segment"`
	Settings             map[string]interface{}  `json:"settings,omitempty" doc:"Segment-scoped destination settings"`
	Media                []PublicationMediaInput `json:"media,omitempty" doc:"Destination segment ordered media"`
}

type RenditionInput struct {
	ID               string                  `json:"id,omitempty" doc:"Legacy client reference; replacement IDs are server-generated"`
	SocialAccountID  string                  `json:"social_account_id" doc:"Social account ID"`
	TargetKey        string                  `json:"target_key,omitempty" doc:"Provider subdestination key; defaults to the account destination"`
	Profile          string                  `json:"profile,omitempty" doc:"Content profile override"`
	OutputProfile    string                  `json:"output_profile,omitempty" doc:"Resolved provider-qualified output profile"`
	FormatLocked     bool                    `json:"format_locked,omitempty" doc:"Preserve an explicitly selected format when source content changes"`
	ScheduleOverride *time.Time              `json:"schedule_override,omitempty" doc:"Optional destination-specific schedule"`
	Body             string                  `json:"body,omitempty" doc:"Platform-specific body"`
	Title            string                  `json:"title,omitempty" doc:"Platform-specific title"`
	Description      string                  `json:"description,omitempty" doc:"Platform-specific description"`
	Settings         map[string]interface{}  `json:"settings,omitempty" doc:"Provider-specific settings"`
	Media            []PublicationMediaInput `json:"media,omitempty" doc:"Rendition-specific ordered media"`
	Segments         []RenditionSegmentInput `json:"segments,omitempty" doc:"Ordered destination segments"`
}

type CreatePublicationBody struct {
	WorkspaceID      string                    `json:"workspace_id" doc:"Workspace ID"`
	Title            string                    `json:"title" doc:"Internal publication title"`
	Intent           string                    `json:"intent,omitempty" enum:"post,thread,story,short_video,video" doc:"Deprecated compatibility alias for creation_preset"`
	CreationPreset   string                    `json:"creation_preset,omitempty" enum:"post,thread,story,short_video,video" doc:"Starter preset; destination renditions own their formats"`
	SocialSetID      string                    `json:"social_set_id,omitempty" doc:"Social Set used to initialize the snapshotted destinations"`
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
	RepostOverride   *repostservice.Override   `json:"repost_override,omitempty" doc:"Optional per-publication repost override"`
}

type CreatePublicationInput struct {
	Body CreatePublicationBody
}

type PublicationUpdateBody struct {
	ExpectedRevision int                       `json:"expected_revision" minimum:"1" doc:"Revision loaded by the editor"`
	Title            *string                   `json:"title,omitempty" doc:"Internal publication title"`
	Intent           *string                   `json:"intent,omitempty" enum:"post,thread,story,short_video,video" doc:"Deprecated compatibility alias for creation_preset"`
	CreationPreset   *string                   `json:"creation_preset,omitempty" enum:"post,thread,story,short_video,video" doc:"Starter preset; destination renditions own their formats"`
	SocialSetID      *string                   `json:"social_set_id,omitempty" doc:"Social Set provenance; does not replace snapshotted destinations"`
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
	RepostOverride   *repostservice.Override   `json:"repost_override,omitempty" doc:"Replace the per-publication repost override"`
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
	ActivityBucket string `query:"activity_bucket" enum:"scheduled,published,failed,draft" doc:"Optional Posts activity bucket filter"`
	ContentProfile string `query:"content_profile" doc:"Optional content profile filter"`
	Search         string `query:"search" doc:"Case-insensitive title or source-text search"`
	Cursor         string `query:"cursor" doc:"Opaque cursor for stable newest-first pagination"`
	CreatedFrom    string `query:"created_from" doc:"Include publications created at or after this RFC3339 timestamp"`
	CreatedBefore  string `query:"created_before" doc:"Include publications created before this RFC3339 timestamp"`
	CalendarFrom   string `query:"calendar_from" doc:"Include calendar occurrences at or after this RFC3339 timestamp"`
	CalendarBefore string `query:"calendar_before" doc:"Include calendar occurrences before this RFC3339 timestamp"`
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
	Cursor string `query:"cursor" doc:"Opaque cursor for older lifecycle entries"`
}

type PublicationActionInput struct {
	PathID string `path:"id" doc:"Publication ID"`
}

type RetryRenditionInput struct {
	PathID    string `path:"id" doc:"Publication ID"`
	AccountID string `path:"account_id" doc:"Connected account ID"`
	TargetKey string `query:"target_key" doc:"Exact provider subdestination key; required when the account has multiple targets"`
}

type RetryFailedRenditionsInput struct {
	PathID string `path:"id" doc:"Publication ID"`
}

type PublicationMutationActionInput struct {
	PathID string `path:"id" doc:"Publication ID"`
	Body   struct {
		ExpectedRevision int    `json:"expected_revision" minimum:"1" doc:"Revision saved immediately before this action"`
		ExecutionIntent  string `json:"execution_intent,omitempty" enum:"production,certification_test" doc:"Typed readiness intent; certification_test requires an unscoped instance administrator"`
	}
}

type DeletePublicationRenditionInput struct {
	PathID           string `path:"id" doc:"Publication ID"`
	AccountID        string `path:"account_id" doc:"Connected account ID"`
	TargetKey        string `query:"target_key" doc:"Exact provider subdestination key; required when the account has multiple targets"`
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
	TotalCount int    `header:"X-Total-Count"`
	Limit      int    `header:"X-Limit"`
	Offset     int    `header:"X-Offset"`
	NextOffset int    `header:"X-Next-Offset"`
	NextCursor string `header:"X-Next-Cursor"`
	HasMore    bool   `header:"X-Has-More"`
	Body       []PublicationResponse
}

type PublicationValidationOutput struct {
	Body struct {
		Valid  bool                           `json:"valid"`
		Issues []capabilities.ValidationIssue `json:"issues"`
	}
}

type PublicationEventsOutput struct {
	NextCursor string `header:"X-Next-Cursor"`
	HasMore    bool   `header:"X-Has-More"`
	Body       []PublicationLifecycleEventResponse
}

type ActionOutput struct {
	Body struct {
		Message                 string                   `json:"message"`
		JobID                   string                   `json:"job_id,omitempty"`
		Revision                int                      `json:"revision,omitempty"`
		PublicationID           string                   `json:"publication_id,omitempty"`
		Renditions              []RenditionActionOutcome `json:"renditions,omitempty" doc:"Exact destination outcomes after this action"`
		WorkspaceActivated      bool                     `json:"workspace_activated,omitempty"`
		ActivationPublicationID string                   `json:"activation_publication_id,omitempty"`
	}
}

type PublicationResponse struct {
	ID             string                       `json:"id"`
	TextPostID     string                       `json:"text_post_id,omitempty" doc:"Linked draft post ID used by the text-and-thread composer"`
	WorkspaceID    string                       `json:"workspace_id"`
	CreatedByID    string                       `json:"created_by"`
	Title          string                       `json:"title"`
	Intent         string                       `json:"intent"`
	CreationPreset string                       `json:"creation_preset"`
	SocialSetID    string                       `json:"social_set_id,omitempty"`
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
	RepostOverride repostservice.Override       `json:"repost_override"`
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
	ID               string                     `json:"id"`
	PublicationID    string                     `json:"publication_id"`
	SocialAccountID  string                     `json:"social_account_id"`
	TargetKey        string                     `json:"target_key"`
	Platform         string                     `json:"platform"`
	Profile          string                     `json:"profile"`
	OutputProfile    string                     `json:"output_profile"`
	FormatLocked     bool                       `json:"format_locked"`
	ScheduleOverride string                     `json:"schedule_override,omitempty"`
	Body             string                     `json:"body"`
	Title            string                     `json:"title"`
	Description      string                     `json:"description"`
	Settings         map[string]interface{}     `json:"settings"`
	Status           string                     `json:"status"`
	ExternalID       string                     `json:"external_id,omitempty"`
	ExternalURL      string                     `json:"external_url,omitempty"`
	ErrorMessage     string                     `json:"error_message,omitempty"`
	ErrorKind        string                     `json:"error_kind,omitempty"`
	ErrorCode        string                     `json:"error_code,omitempty"`
	ErrorHTTPStatus  int                        `json:"error_http_status,omitempty"`
	ErrorRetryable   bool                       `json:"error_retryable"`
	ErrorRetryAt     string                     `json:"error_retry_at,omitempty"`
	ErrorAction      string                     `json:"error_action,omitempty"`
	Delivery         *ProviderDeliveryResponse  `json:"delivery,omitempty"`
	Segments         []RenditionSegmentResponse `json:"segments"`
	Media            []MediaSummary             `json:"media"`
}

type ProviderDeliveryResponse struct {
	TargetKey               string `json:"target_key"`
	State                   string `json:"state"`
	TerminalReason          string `json:"terminal_reason,omitempty"`
	CurrentAttemptID        string `json:"current_attempt_id"`
	CurrentAttemptNumber    int    `json:"current_attempt_number"`
	CurrentAttemptCreatedAt string `json:"current_attempt_created_at"`
	ExternalID              string `json:"external_id,omitempty"`
	ExternalURL             string `json:"external_url,omitempty"`
	ErrorKind               string `json:"error_kind,omitempty" doc:"Safe normalized provider failure class"`
	ErrorCode               string `json:"error_code,omitempty" doc:"Safe normalized provider failure code"`
	ErrorHTTPStatus         int    `json:"error_http_status,omitempty"`
	RecoveryAction          string `json:"recovery_action" enum:"none,retry,reconcile,manual_resolution"`
	LastReconciledAt        string `json:"last_reconciled_at,omitempty"`
	NextReconciliationAt    string `json:"next_reconciliation_at,omitempty"`
}

type RenditionActionOutcome struct {
	ID              string                    `json:"id"`
	SocialAccountID string                    `json:"social_account_id"`
	TargetKey       string                    `json:"target_key"`
	Platform        string                    `json:"platform"`
	Status          string                    `json:"status"`
	Delivery        *ProviderDeliveryResponse `json:"delivery,omitempty"`
}

type RenditionSegmentResponse struct {
	ID                   string                 `json:"id"`
	PublicationSegmentID string                 `json:"publication_segment_id"`
	Position             int                    `json:"position"`
	Body                 string                 `json:"body"`
	Title                string                 `json:"title"`
	Description          string                 `json:"description"`
	URL                  string                 `json:"url,omitempty"`
	BodyOverride         *string                `json:"body_override,omitempty"`
	TitleOverride        *string                `json:"title_override,omitempty"`
	DescriptionOverride  *string                `json:"description_override,omitempty"`
	URLOverride          *string                `json:"url_override,omitempty"`
	MediaInherited       bool                   `json:"media_inherited"`
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
	ID               string                           `json:"id"`
	WorkspaceID      string                           `json:"workspace_id"`
	PublicationID    string                           `json:"publication_id"`
	RenditionID      string                           `json:"rendition_id,omitempty"`
	Type             string                           `json:"type"`
	Status           string                           `json:"status"`
	Summary          string                           `json:"summary"`
	Actor            PublicationLifecycleActor        `json:"actor"`
	Platform         string                           `json:"platform,omitempty"`
	ChangedDomains   []string                         `json:"changed_domains,omitempty"`
	Revision         int                              `json:"revision,omitempty"`
	ScheduledAt      string                           `json:"scheduled_at,omitempty"`
	DestinationCount int                              `json:"destination_count,omitempty"`
	Destination      *PublicationLifecycleDestination `json:"destination,omitempty"`
	Delivery         *ProviderDeliveryResponse        `json:"delivery,omitempty"`
	Superseded       bool                             `json:"superseded"`
	Error            *PublicationLifecycleError       `json:"error,omitempty"`
	CreatedAt        string                           `json:"created_at"`
}

type PublicationLifecycleDestination struct {
	RenditionID     string `json:"rendition_id"`
	SocialAccountID string `json:"social_account_id"`
	TargetKey       string `json:"target_key"`
	Platform        string `json:"platform"`
	Label           string `json:"label"`
	Status          string `json:"status"`
}

type PublicationLifecycleActor struct {
	Kind   string `json:"kind" enum:"user,automation,system"`
	Name   string `json:"name,omitempty"`
	Origin string `json:"origin,omitempty"`
}

type PublicationLifecycleError struct {
	Message    string `json:"message,omitempty"`
	Kind       string `json:"kind,omitempty"`
	Code       string `json:"code,omitempty"`
	HTTPStatus int    `json:"http_status,omitempty"`
	Retryable  bool   `json:"retryable"`
	Action     string `json:"action,omitempty"`
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
	h.retryFailedRenditions(api)
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
			var txErr error
			deleted, txErr = h.deleteRenditionTx(txCtx, tx, publication.ID, input, userID)
			return txErr
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

func (h *PublicationHandler) deleteRenditionTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	input *DeletePublicationRenditionInput,
	userID string,
) (bool, error) {
	current, err := h.loadEditablePublicationTx(ctx, tx, publicationID)
	if err != nil {
		return false, err
	}
	if current.Revision != input.ExpectedRevision {
		return false, h.publicationRevisionConflict(ctx, tx, current, input.ExpectedRevision)
	}
	editor, err := postservice.EnsurePublicationEditorTx(ctx, tx, current)
	if err != nil {
		return false, err
	}
	var renditions []models.Rendition
	query := tx.NewSelect().Model(&renditions).
		Where("publication_id = ? AND social_account_id = ?", publicationID, input.AccountID).
		Order("id ASC")
	if input.TargetKey != "" {
		query = query.Where("target_key = ?", strings.TrimSpace(input.TargetKey))
	}
	if err := query.Scan(ctx); err != nil {
		return false, err
	}
	if len(renditions) == 0 {
		return false, nil
	}
	if len(renditions) > 1 {
		return false, huma.Error409Conflict("target_key is required when an account has multiple publication destinations")
	}
	renditionIDs := []string{renditions[0].ID}
	if err := h.cancelPendingReplyJobsForDeletedTargetsTx(ctx, tx, publicationID, renditionIDs); err != nil {
		return false, err
	}
	result, err := tx.NewDelete().Model((*models.Rendition)(nil)).Where("id IN (?)", bun.List(renditionIDs)).Exec(ctx)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	if err != nil || count == 0 {
		return false, err
	}
	return true, h.recordRenditionDeletionTx(ctx, tx, current, editor, input.ExpectedRevision, userID)
}

func (h *PublicationHandler) recordRenditionDeletionTx(
	ctx context.Context,
	tx bun.Tx,
	current *models.Publication,
	editor *models.Post,
	expectedRevision int,
	userID string,
) error {
	now := time.Now().UTC()
	nextRevision := current.Revision + 1
	if _, err := tx.NewUpdate().Model((*models.Publication)(nil)).
		Set("revision = ?", nextRevision).Set("updated_at = ?", now).
		Where("id = ? AND revision = ?", current.ID, current.Revision).Exec(ctx); err != nil {
		return err
	}
	current.Revision = nextRevision
	current.UpdatedAt = now
	if err := postservice.SyncPublicationEditorTx(ctx, tx, current, editor); err != nil {
		return err
	}
	fields := []string{"destinations", "destination overrides", "media"}
	if err := h.syncTextPostRevisionsTx(ctx, tx, current.ID, expectedRevision, nextRevision, fields, userID, now); err != nil {
		return err
	}
	return drafts.RecordChange(ctx, tx, drafts.AggregatePublication, current.ID, nextRevision, fields, userID, now)
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
		publication, err := h.publicationApplication().Create(ctx, userID, input.Body)
		if err != nil {
			var statusErr huma.StatusError
			if errors.As(err, &statusErr) {
				return nil, statusErr
			}
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
		return h.listPublicationsPage(ctx, input)
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
			if err := h.cancelPendingReplyJobsForDeletedTargetsTx(txCtx, tx, current.ID, nil); err != nil {
				return err
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
		events, nextCursor, hasMore, err := h.listPublicationHistory(ctx, publication, input.Limit, input.Cursor)
		if err != nil {
			if errors.Is(err, errInvalidHistoryCursor) {
				return nil, huma.Error400BadRequest("invalid publication history cursor")
			}
			return nil, huma.Error500InternalServerError("failed to load publication events")
		}
		return &PublicationEventsOutput{Body: events, NextCursor: nextCursor, HasMore: hasMore}, nil
	})
}

func (h *PublicationHandler) updatePublication(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "update-publication",
		Method:      http.MethodPut,
		Path:        publicationPathByID,
		Summary:     "Update a publication",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *UpdatePublicationInput) (*PublicationOutput, error) {
		if err := drafts.RequireExpectedRevision(input.Body.ExpectedRevision); err != nil {
			return nil, err
		}
		userID := middleware.GetUserID(ctx)
		if err := h.publicationApplication().Update(ctx, userID, input.PathID, input.Body); err != nil {
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
		// Any edit increments the publication revision. A queued publication
		// therefore needs a new job and receipt even when its time is unchanged.
		return false, publication.Status == models.PublicationStatusScheduled, nil
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
	if input.CreationPreset != nil {
		publication.CreationPreset = *input.CreationPreset
		publication.Intent = *input.CreationPreset
	}
	if input.SocialSetID != nil {
		publication.SocialSetID = *input.SocialSetID
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
	if input.RepostOverride != nil {
		publication.RepostOverride, _ = repostservice.EncodeOverride(*input.RepostOverride)
	}
}

//nolint:gocyclo
func publicationChangedDomains(input PublicationUpdateBody) []string {
	var domains []string
	if input.Title != nil || input.Intent != nil || input.CreationPreset != nil || input.ContentProfile != nil ||
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
	if input.SocialSetID != nil {
		domains = append(domains, "destinations")
	}
	if input.ScheduledAt != nil || input.ClearSchedule {
		domains = append(domains, "schedule")
	}
	if input.Metadata != nil {
		domains = append(domains, "settings")
	}
	if input.RepostOverride != nil {
		domains = append(domains, "repost automation")
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
	editorName, err := drafts.LatestEditorName(ctx, db, drafts.AggregatePublication, publication.ID, expectedRevision)
	if err != nil {
		return err
	}
	return drafts.NewConflictError(drafts.ConflictMetadata{
		AggregateType:    drafts.AggregatePublication,
		AggregateID:      publication.ID,
		ExpectedRevision: expectedRevision,
		CurrentRevision:  publication.Revision,
		Status:           publication.Status,
		Title:            publication.Title,
		UpdatedAt:        formatOptionalTime(publication.UpdatedAt),
		ChangedByName:    editorName,
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
			editorName, err := drafts.LatestEditorName(ctx, tx, drafts.AggregateTextPost, post.ID, expectedRevision)
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
	if err := h.rejectReplyJobsForReplacedTargetsTx(ctx, tx, publication.ID, renditionIDs); err != nil {
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
			editor, err := postservice.EnsurePublicationEditorTx(txCtx, tx, currentPublication)
			if err != nil {
				return err
			}
			if len(input.Body.Renditions) == 0 {
				return nil
			}
			targets := make(map[renditionservice.TargetIdentity]struct{}, len(input.Body.Renditions))
			for _, renditionInput := range input.Body.Renditions {
				account := accountMap[renditionInput.SocialAccountID]
				targetKey, targetErr := normalizeRenditionTargetKey(account, renditionInput.TargetKey)
				if targetErr != nil {
					return huma.Error400BadRequest(targetErr.Error())
				}
				targets[renditionservice.NewTargetIdentity(renditionInput.SocialAccountID, targetKey)] = struct{}{}
			}
			existingIDs, err := renditionservice.MatchingIDsTx(
				txCtx,
				tx,
				publication.ID,
				targets,
				accountMap,
			)
			if err != nil {
				return err
			}
			if err := h.rejectReplyJobsForReplacedTargetsTx(txCtx, tx, publication.ID, existingIDs); err != nil {
				return err
			}
			if err := renditionservice.DeleteRowsTx(txCtx, tx, existingIDs); err != nil {
				return err
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
			currentPublication.Revision = nextRevision
			currentPublication.UpdatedAt = now
			if err := postservice.SyncPublicationEditorTx(
				txCtx,
				tx,
				currentPublication,
				editor,
			); err != nil {
				return err
			}
			if err := h.syncTextPostRevisionsTx(
				txCtx,
				tx,
				currentPublication.ID,
				input.Body.ExpectedRevision,
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
		issues, err := h.publicationApplication().Validate(ctx, middleware.GetUserID(ctx), input.PathID)
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
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *PublicationMutationActionInput) (*ActionOutput, error) {
		if err := drafts.RequireExpectedRevision(input.Body.ExpectedRevision); err != nil {
			return nil, err
		}
		userID := middleware.GetUserID(ctx)
		intent, err := providerReadinessExecutionIntent(ctx, h.db, input.Body.ExecutionIntent)
		if err != nil {
			return nil, err
		}
		result, err := h.publicationApplication().Schedule(
			ctx, userID, input.PathID, input.Body.ExpectedRevision, intent,
		)
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to enqueue publication")
		}
		h.capturePublicationEvent(ctx, telemetry.EventPublicationScheduled, userID, input.PathID, result.JobID)
		return enqueueActionMessage("publication scheduled", input.PathID, result), nil
	})
}

func (h *PublicationHandler) publishNow(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "publish-publication-now",
		Method:      http.MethodPost,
		Path:        "/publications/{id}/publish-now",
		Summary:     "Publish a publication now",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *PublicationMutationActionInput) (*ActionOutput, error) {
		if err := drafts.RequireExpectedRevision(input.Body.ExpectedRevision); err != nil {
			return nil, err
		}
		userID := middleware.GetUserID(ctx)
		intent, err := providerReadinessExecutionIntent(ctx, h.db, input.Body.ExecutionIntent)
		if err != nil {
			return nil, err
		}
		result, err := h.publicationApplication().PublishNow(
			ctx, userID, input.PathID, input.Body.ExpectedRevision, intent,
		)
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to enqueue publication")
		}
		h.capturePublicationEvent(ctx, telemetry.EventPublicationQueued, userID, input.PathID, result.JobID)
		return enqueueActionMessage("publication queued", input.PathID, result), nil
	})
}

func (h *PublicationHandler) captureActivationEvent(ctx context.Context, userID, workspaceID string, result publicationEnqueueResult) {
	if !result.NewlyActivated || h.telemetry == nil {
		return
	}
	if err := h.telemetry.Capture(ctx, telemetry.Event{
		Name:        telemetry.EventWorkspaceActivated,
		DistinctID:  userID,
		WorkspaceID: workspaceID,
		UUID:        result.ActivationID,
	}); err != nil {
		log.Printf("Failed to enqueue Workspace Activation telemetry: %v", err)
	}
}

func (h *PublicationHandler) capturePublicationEvent(
	ctx context.Context,
	eventName string,
	userID string,
	publicationID string,
	jobID string,
) {
	if h.telemetry == nil {
		return
	}
	publication := new(models.Publication)
	if err := h.db.NewSelect().Model(publication).
		Column("workspace_id", "intent", "content_profile").
		Where("id = ?", publicationID).
		Scan(ctx); err != nil {
		log.Printf("Failed to load publication telemetry context: %v", err)
		return
	}
	destinationCount, err := h.db.NewSelect().Model((*models.Rendition)(nil)).
		Where("publication_id = ?", publicationID).
		Count(ctx)
	if err != nil {
		log.Printf("Failed to count publication telemetry destinations: %v", err)
		return
	}
	if err := h.telemetry.Capture(ctx, telemetry.Event{
		Name:        eventName,
		DistinctID:  userID,
		WorkspaceID: publication.WorkspaceID,
		UUID:        jobID,
		Properties: map[string]any{
			"publication_id":    publicationID,
			"job_id":            jobID,
			"intent":            publication.Intent,
			"content_profile":   publication.ContentProfile,
			"destination_count": destinationCount,
		},
	}); err != nil {
		log.Printf("Failed to enqueue publication telemetry: %v", err)
	}
}

func (h *PublicationHandler) retryRendition(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "retry-publication-rendition",
		Method:      http.MethodPost,
		Path:        "/publications/{id}/renditions/{account_id}/retry",
		Summary:     "Retry one failed publication destination",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, func(ctx context.Context, input *RetryRenditionInput) (*ActionOutput, error) {
		jobID, err := h.publicationApplication().RetryRendition(ctx, middleware.GetUserID(ctx), input.PathID, input.AccountID, input.TargetKey)
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to queue destination retry")
		}
		return actionMessage("destination retry queued", jobID), nil
	})
}

func (h *PublicationHandler) retryFailedRenditions(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "retry-failed-publication-renditions",
		Method:      http.MethodPost,
		Path:        "/publications/{id}/retry-failed",
		Summary:     "Retry every retryable failed publication destination",
		Description: "Queues one publication job. Destinations that already succeeded and failures that require editing or reconnection are left unchanged.",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, func(ctx context.Context, input *RetryFailedRenditionsInput) (*ActionOutput, error) {
		jobID, err := h.publicationApplication().RetryFailedRenditions(ctx, middleware.GetUserID(ctx), input.PathID)
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to queue destination retries")
		}
		return actionMessage("failed destination retries queued", jobID), nil
	})
}

func (h *PublicationHandler) replyToRendition(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "reply-to-rendition",
		Method:      http.MethodPost,
		Path:        "/renditions/{id}/reply",
		Summary:     "Queue an explicit provider reply",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404, 409},
	}, func(ctx context.Context, input *ReplyInput) (*ActionOutput, error) {
		rendition, publication, err := h.loadRenditionWithPublicationForEdit(ctx, input.PathID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		runAt := time.Now().UTC()
		if input.Body.RunAt != nil {
			runAt = input.Body.RunAt.UTC()
		}
		jobID, err := h.queueRenditionReply(
			ctx, rendition, publication, input.Body.Body, input.Body.ParentID,
			input.Body.Settings, input.Body.Media, runAt,
		)
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to enqueue reply")
		}
		return actionMessage("reply queued", jobID), nil
	})
}

func (h *PublicationHandler) queueRenditionReply(
	ctx context.Context,
	rendition *models.Rendition,
	publication *models.Publication,
	body, parentID string,
	settings map[string]interface{},
	media any,
	runAt time.Time,
) (string, error) {
	confirmedAt := time.Now().UTC()
	runAt = runAt.UTC()
	if runAt.IsZero() {
		runAt = confirmedAt
	}
	jobID := uuid.NewString()
	batchID := uuid.NewString()
	payloadJSON := mustJSON(map[string]interface{}{
		"rendition_id": rendition.ID, "publication_id": publication.ID,
		"body": body, "parent_id": parentID, "settings": settings, "media": media,
		"action": "reply", "authorization_batch_id": batchID,
		"authorization_scheduled_at": runAt.Format(time.RFC3339Nano),
	})
	policyMode := publicationauth.PolicyReplyImmediate
	if runAt.After(confirmedAt) {
		policyMode = publicationauth.PolicyReplyScheduled
	}
	job, err := jobregistry.NewJob(jobTypePublishPublication, payloadJSON, runAt)
	if err != nil {
		return "", err
	}
	job.ID = jobID
	job.ScopeID = publication.ID
	if h.beforeQueueTransaction != nil {
		if err := h.beforeQueueTransaction(ctx); err != nil {
			return "", err
		}
	}
	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := lockPublicationMutationTx(txCtx, tx, publication.ID); err != nil {
			return err
		}
		var currentRendition models.Rendition
		query := tx.NewSelect().Model(&currentRendition).
			Where("id = ? AND publication_id = ?", rendition.ID, publication.ID)
		if primaryPublicationQueueUsesRowLock(tx.Dialect().Name()) {
			query = query.For("UPDATE")
		}
		if err := query.Scan(txCtx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return huma.Error404NotFound("rendition not found")
			}
			return err
		}
		if _, err := tx.NewInsert().Model(job).Exec(txCtx); err != nil {
			return err
		}
		_, _, err := publicationauth.CreateExplicit(txCtx, tx, publicationauth.ExplicitInput{
			BatchInput: publicationauth.BatchInput{
				BatchID: batchID, PublicationID: publication.ID,
				Actor:  publicationAuthorizationActor(txCtx, publication.CreatedByID),
				Action: publicationauth.ActionReply, PolicyMode: policyMode, ConfirmedAt: confirmedAt,
			},
			RenditionID: rendition.ID, JobID: jobID, RunAt: runAt,
			Content: body, Media: media,
			Settings: map[string]any{"parent_id": parentID, "settings": settings},
		})
		return err
	})
	return jobID, err
}

func (h *PublicationHandler) activePublicationReplyJobsTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	renditionIDs []string,
) ([]models.Job, error) {
	if renditionIDs != nil && len(renditionIDs) == 0 {
		return nil, nil
	}
	var jobs []models.Job
	query := tx.NewSelect().Model(&jobs).
		Where(replyPublishPublicationJobWhere(h.db), jobTypePublishPublication, publicationID).
		Where("status IN (?)", bun.List([]string{jobStatusPending, jobStatusProcessing, "failed"})).
		Order("id ASC")
	if renditionIDs != nil {
		query = query.Where(jobPayloadTextExpr(h.db, "rendition_id")+" IN (?)", bun.List(renditionIDs))
	}
	if primaryPublicationQueueUsesRowLock(tx.Dialect().Name()) {
		query = query.For("UPDATE")
	}
	if err := query.Scan(ctx); err != nil {
		return nil, err
	}
	return jobs, nil
}

func protectedPublicationReplyJobIDs(jobs []models.Job) []string {
	jobIDs := make([]string, 0, len(jobs))
	for _, job := range jobs {
		if job.Status == jobStatusPending || job.Status == "failed" {
			jobIDs = append(jobIDs, job.ID)
		}
	}
	return jobIDs
}

func (h *PublicationHandler) rejectUnsafePublicationReplyJobsTx(
	ctx context.Context,
	tx bun.Tx,
	jobs []models.Job,
	rejectPending bool,
) error {
	for _, job := range jobs {
		if job.Status == jobStatusProcessing || (rejectPending && job.Status == jobStatusPending) {
			return errPublicationAlreadyProcessing
		}
	}
	jobIDs := protectedPublicationReplyJobIDs(jobs)
	if len(jobIDs) == 0 {
		return nil
	}
	count, err := tx.NewSelect().Model((*models.ProviderWriteAttempt)(nil)).
		Where("job_id IN (?)", bun.List(jobIDs)).
		Where("status IN (?)", bun.List([]string{
			providerwrite.StatusSending,
			providerwrite.StatusAmbiguous,
			providerwrite.StatusAccepted,
		})).
		Count(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return errPublicationAlreadyProcessing
	}
	return nil
}

// cancelPendingReplyJobsForDeletedTargetsTx makes explicit target deletion
// also cancel replies that have not started. Processing work and uncertain or
// accepted provider attempts retain their operation identity and block delete.
func (h *PublicationHandler) cancelPendingReplyJobsForDeletedTargetsTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	renditionIDs []string,
) error {
	jobs, err := h.activePublicationReplyJobsTx(ctx, tx, publicationID, renditionIDs)
	if err != nil {
		return err
	}
	if err := h.rejectUnsafePublicationReplyJobsTx(ctx, tx, jobs, false); err != nil {
		return err
	}
	pendingIDs := make([]string, 0, len(jobs))
	for _, job := range jobs {
		if job.Status == jobStatusPending {
			pendingIDs = append(pendingIDs, job.ID)
		}
	}
	if len(pendingIDs) == 0 {
		return nil
	}
	_, err = tx.NewDelete().Model((*models.Job)(nil)).
		Where("id IN (?)", bun.List(pendingIDs)).
		Where("status = ?", jobStatusPending).
		Exec(ctx)
	return err
}

// rejectReplyJobsForReplacedTargetsTx keeps a pending reply bound to the
// rendition identity the user authorized instead of silently orphaning it
// when a destination is deleted and recreated.
func (h *PublicationHandler) rejectReplyJobsForReplacedTargetsTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	renditionIDs []string,
) error {
	jobs, err := h.activePublicationReplyJobsTx(ctx, tx, publicationID, renditionIDs)
	if err != nil {
		return err
	}
	return h.rejectUnsafePublicationReplyJobsTx(ctx, tx, jobs, true)
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
	if err := medialifecycle.TouchWithDB(ctx, tx, allPublicationMediaIDs(nil, inputs, nil), now); err != nil {
		return nil, err
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
	previousMediaIDs := make([]string, 0, len(inputs))
	if err := tx.NewSelect().
		TableExpr("publication_segment_media AS media").
		ColumnExpr("media.media_id").
		Join("JOIN publication_segments AS segment ON segment.id = media.segment_id").
		Where("segment.publication_id = ?", publication.ID).
		Scan(ctx, &previousMediaIDs); err != nil && !isMissingPublicationSegmentTable(err) {
		return err
	}
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
	previousMediaIDs = append(previousMediaIDs, allPublicationMediaIDs(nil, inputs, nil)...)
	return medialifecycle.TouchWithDB(ctx, tx, previousMediaIDs, now)
}

func syncPublicationFirstSegmentBodyTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	body string,
	updatedAt time.Time,
) error {
	var segment models.PublicationSegment
	if err := tx.NewSelect().
		Model(&segment).
		Where("publication_id = ?", publicationID).
		Order("position ASC", "id ASC").
		Limit(1).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) || isMissingPublicationSegmentTable(err) {
			return nil
		}
		return err
	}
	segment.Body = body
	segment.UpdatedAt = updatedAt
	_, err := tx.NewUpdate().
		Model(&segment).
		Column("body", "updated_at").
		Where("id = ?", segment.ID).
		Exec(ctx)
	return err
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
	seenTargets := make(map[renditionservice.TargetIdentity]struct{}, len(inputs))
	for _, input := range inputs {
		account, ok := accounts[input.SocialAccountID]
		if !ok {
			return huma.Error400BadRequest("one or more social accounts are invalid, disconnected, or outside this workspace")
		}
		targetKey, err := normalizeRenditionTargetKey(account, input.TargetKey)
		if err != nil {
			return huma.Error400BadRequest(err.Error())
		}
		identity := renditionservice.NewTargetIdentity(input.SocialAccountID, targetKey)
		if _, duplicate := seenTargets[identity]; duplicate {
			return huma.Error400BadRequest("each social account target may appear only once")
		}
		seenTargets[identity] = struct{}{}
		resolved := h.resolveRenditionCapability(ctx, tx, publication, account, input, canonicalInputs)
		// Unlocked formats follow the current source shape. Requested output profiles
		// are preserved by the resolver, including when their source becomes invalid.
		profile := publicationFirstNonEmpty(resolved.Profile, input.Profile, publication.ContentProfile)
		outputProfile := publicationFirstNonEmpty(input.OutputProfile, resolved.OutputProfile, account.Platform+".post")
		status := models.RenditionStatusDraft
		if publication.Status == models.PublicationStatusScheduled {
			status = models.RenditionStatusScheduled
		}
		firstCanonical := models.PublicationSegment{}
		if len(canonicalSegments) > 0 {
			firstCanonical = canonicalSegments[0]
		}
		_, effectiveBody := renditionTextOverride(nil, input.Body, firstCanonical.Body)
		_, effectiveTitle := renditionTextOverride(nil, input.Title, firstCanonical.Title)
		_, effectiveDescription := renditionTextOverride(nil, input.Description, firstCanonical.Description)
		if input.ScheduleOverride != nil && input.ScheduleOverride.Before(time.Now().UTC()) {
			return huma.Error400BadRequest("schedule_override must be in the future")
		}
		rendition := &models.Rendition{
			ID:              uuid.New().String(),
			PublicationID:   publication.ID,
			SocialAccountID: input.SocialAccountID,
			TargetKey:       targetKey,
			Platform:        account.Platform,
			Profile:         profile,
			OutputProfile:   outputProfile,
			FormatLocked:    input.FormatLocked,
			Body:            publicationFirstNonEmpty(effectiveBody, publication.SourceText),
			Title:           publicationFirstNonEmpty(effectiveTitle, publication.Title),
			Description:     effectiveDescription,
			SettingsJSON:    mustJSON(input.Settings),
			Status:          status,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		if input.ScheduleOverride != nil {
			rendition.ScheduleOverride = input.ScheduleOverride.UTC()
		}
		if _, err := tx.NewInsert().Model(rendition).Exec(ctx); err != nil {
			return err
		}

		segmentInputs := input.Segments
		if len(segmentInputs) == 0 {
			if resolved.SegmentStrategy == "join" && len(canonicalSegments) > 1 {
				segmentInputs = []RenditionSegmentInput{joinedRenditionSegmentInput(canonicalSegments, canonicalInputs, input)}
			} else {
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
		}
		if err := h.insertRenditionSegments(ctx, tx, rendition, canonicalSegments, canonicalInputs, segmentInputs); err != nil {
			return err
		}
	}
	return medialifecycle.TouchWithDB(
		ctx,
		tx,
		allPublicationMediaIDs(defaultMedia, canonicalInputs, inputs),
		now,
	)
}

//nolint:gocyclo // This keeps canonical inheritance and legacy-media fallback in one transactional write.
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
		bodyOverride, effectiveBody := renditionTextOverride(input.BodyOverride, input.Body, canonical.Body)
		titleOverride, effectiveTitle := renditionTextOverride(input.TitleOverride, input.Title, canonical.Title)
		descriptionOverride, effectiveDescription := renditionTextOverride(input.DescriptionOverride, input.Description, canonical.Description)
		urlOverride, effectiveURL := renditionTextOverride(input.URLOverride, input.URL, canonical.URL)
		segment := &models.RenditionSegment{
			ID:                   uuid.New().String(),
			RenditionID:          rendition.ID,
			PublicationSegmentID: canonical.ID,
			Position:             position,
			Body:                 effectiveBody,
			Title:                effectiveTitle,
			Description:          effectiveDescription,
			URL:                  effectiveURL,
			BodyOverride:         bodyOverride,
			TitleOverride:        titleOverride,
			DescriptionOverride:  descriptionOverride,
			URLOverride:          urlOverride,
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
		canonicalMedia := []PublicationMediaInput{}
		if position < len(canonicalInputs) {
			canonicalMedia = canonicalInputs[position].Media
		}
		mediaInherited := input.MediaInherited == nil && (len(mediaInputs) == 0 || publicationMediaInputsEqual(mediaInputs, canonicalMedia))
		if input.MediaInherited != nil {
			mediaInherited = *input.MediaInherited
		}
		segment.MediaInherited = mediaInherited
		if _, err := tx.NewUpdate().Model(segment).Column("media_inherited").Where("id = ?", segment.ID).Exec(ctx); err != nil {
			return err
		}
		if mediaInherited {
			mediaInputs = canonicalMedia
		} else if len(mediaInputs) == 0 && input.MediaInherited == nil && position < len(canonicalInputs) {
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
	return capabilities.Resolve(account.Platform, capabilities.ResolveInput{
		Intent:                 publication.Intent,
		CreationPreset:         publicationFirstNonEmpty(publication.CreationPreset, publication.Intent),
		RequestedOutputProfile: input.OutputProfile,
		SourceURL:              publication.SourceURL,
		Segments:               resolveSegments,
	})
}

func renditionTextOverride(explicit *string, legacyValue, canonicalValue string) (*string, string) {
	if explicit != nil {
		value := *explicit
		return &value, value
	}
	if legacyValue != "" && legacyValue != canonicalValue {
		value := legacyValue
		return &value, value
	}
	return nil, canonicalValue
}

func joinedRenditionSegmentInput(
	canonicalSegments []models.PublicationSegment,
	canonicalInputs []PublicationSegmentInput,
	input RenditionInput,
) RenditionSegmentInput {
	bodies := make([]string, 0, len(canonicalSegments))
	media := make([]PublicationMediaInput, 0)
	for position, segment := range canonicalSegments {
		if body := strings.TrimSpace(segment.Body); body != "" {
			bodies = append(bodies, body)
		}
		if position < len(canonicalInputs) {
			media = append(media, canonicalInputs[position].Media...)
		}
	}
	joinedBody := strings.Join(bodies, "\n\n")
	segment := RenditionSegmentInput{
		PublicationSegmentID: canonicalSegments[0].ID,
		Body:                 joinedBody,
		Title:                canonicalSegments[0].Title,
		Description:          canonicalSegments[0].Description,
		URL:                  canonicalSegments[0].URL,
		Media:                media,
	}
	if input.Body != "" {
		segment.Body = input.Body
	}
	if input.Title != "" {
		segment.Title = input.Title
	}
	if input.Description != "" {
		segment.Description = input.Description
	}
	if len(input.Media) > 0 {
		segment.Media = input.Media
	}
	return segment
}

func publicationMediaInputsEqual(left, right []PublicationMediaInput) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index].MediaID != right[index].MediaID {
			return false
		}
	}
	return true
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
	responses, err := h.loadPublicationResponses(ctx, []models.Publication{*publication})
	if err != nil {
		return PublicationResponse{}, err
	}
	if len(responses) != 1 {
		return PublicationResponse{}, huma.Error500InternalServerError("failed to load publication")
	}
	return responses[0], nil
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
				MediaInherited:       true,
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
			MediaInherited:       true,
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
			BodyOverride:         segment.BodyOverride,
			TitleOverride:        segment.TitleOverride,
			DescriptionOverride:  segment.DescriptionOverride,
			URLOverride:          segment.URLOverride,
			MediaInherited:       segment.MediaInherited,
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
	if err := h.rejectProtectedPrimaryPublicationJobTx(ctx, tx, publicationID); err != nil {
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
	case errors.As(err, new(*providerreadiness.NotReadyError)):
		return huma.Error409Conflict(err.Error())
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

func providerReadinessExecutionIntent(
	ctx context.Context,
	db *bun.DB,
	raw string,
) (providerreadiness.ExecutionIntent, error) {
	switch providerreadiness.ExecutionIntent(strings.TrimSpace(raw)) {
	case "", providerreadiness.ExecutionIntentProduction:
		return providerreadiness.ExecutionIntentProduction, nil
	case providerreadiness.ExecutionIntentCertificationTest:
		if err := requireUnscopedInstanceAdmin(ctx, db); err != nil {
			return "", err
		}
		return providerreadiness.ExecutionIntentCertificationTest, nil
	default:
		return "", huma.Error400BadRequest("invalid provider readiness execution intent")
	}
}

func normalizedReadinessIntent(intents []providerreadiness.ExecutionIntent) providerreadiness.ExecutionIntent {
	if len(intents) > 0 && intents[0] == providerreadiness.ExecutionIntentCertificationTest {
		return providerreadiness.ExecutionIntentCertificationTest
	}
	return providerreadiness.ExecutionIntentProduction
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
	if err := h.refreshPublicationPublicMedia(ctx, publicationID); err != nil {
		return nil, err
	}
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

func (h *PublicationHandler) refreshPublicationPublicMedia(ctx context.Context, publicationID string) error {
	if h.publicMedia == nil {
		return nil
	}
	var media []models.MediaAttachment
	if err := h.db.NewSelect().
		TableExpr("media_attachments AS m").
		ColumnExpr("DISTINCT m.*").
		Join("JOIN rendition_media AS rm ON rm.media_id = m.id").
		Join("JOIN renditions AS r ON r.id = rm.rendition_id").
		Where("r.publication_id = ?", publicationID).
		Scan(ctx, &media); err != nil {
		return huma.Error500InternalServerError("failed to load public media status")
	}
	for index := range media {
		if err := refreshPublicMediaState(ctx, h.db, h.publicMedia, &media[index]); err != nil {
			return huma.Error500InternalServerError("failed to refresh public media status")
		}
	}
	return nil
}

//nolint:gocyclo
func (h *PublicationHandler) validateDynamicPublicationCapabilities(ctx context.Context, publicationID string) ([]capabilities.ValidationIssue, error) {
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
		result := platform.AccountCapabilityResult{}
		hasResult := false
		if account.Platform == capabilities.ProviderX {
			result = standardXPublishingCapabilities()
			hasResult = true
		}
		provider, ok := adapter.(platform.AccountCapabilityProvider)
		destinationSettings := map[string]interface{}{}
		_ = json.Unmarshal([]byte(rendition.SettingsJSON), &destinationSettings)
		switch {
		case ok && h.tokenSource != nil:
			token, tokenErr := h.tokenSource.GetValidAccessToken(ctx, account.ID)
			if tokenErr != nil {
				issue := dynamicPublicationIssue(
					rendition,
					"account_capability_authorization_failed",
					"Account authorization could not be refreshed.",
					"authorization",
				)
				if account.Platform == capabilities.ProviderX {
					issue.Severity = "warning"
					issues = append(issues, issue)
				} else {
					issues = append(issues, issue)
					continue
				}
			} else {
				resolved, resolveErr := provider.ResolveAccountPublishingCapabilities(ctx, token, platform.AccountCapabilityInput{
					Intent:        publishingIntentForProfile(rendition.Profile),
					OutputProfile: rendition.OutputProfile,
					Settings:      destinationSettings,
				})
				if resolveErr != nil {
					issue := dynamicPublicationIssue(
						rendition,
						"account_capability_refresh_failed",
						resolveErr.Error(),
						"capabilities",
					)
					if account.Platform == capabilities.ProviderX {
						issue.Severity = "warning"
						issues = append(issues, issue)
					} else {
						issues = append(issues, issue)
						continue
					}
				} else {
					result = resolved
					hasResult = true
					if persistErr := persistAccountCapabilityState(ctx, h.db, account.ID, result); persistErr != nil {
						issue := dynamicPublicationIssue(
							rendition,
							"account_capability_cache_failed",
							"Account limits were verified but could not be cached.",
							"capabilities",
						)
						issue.Severity = "warning"
						issues = append(issues, issue)
					}
				}
			}
		case !hasResult:
			continue
		default:
			issue := dynamicPublicationIssue(
				rendition,
				"account_capability_refresh_failed",
				"Account limits could not be refreshed; standard X limits were applied.",
				"capabilities",
			)
			issue.Severity = "warning"
			issues = append(issues, issue)
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
	if limit, ok := dynamicInt(constraints["text_limit"]); ok && limit > 0 && capabilities.TextLength(rendition.Platform, segment.Body) > limit {
		appendIssue("dynamic_text_limit", fmt.Sprintf("Text is over the current %d character limit.", limit), "body")
	}
	if limit, ok := dynamicInt(constraints["media_max_count"]); ok && limit > 0 && len(segment.Media) > limit {
		appendIssue("dynamic_media_limit", fmt.Sprintf("This account currently supports at most %d media items.", limit), "media")
	}
	issues = append(issues, validateDynamicVideoConstraints(rendition, segment, position, constraints)...)
	if limit, ok := dynamicInt(constraints["poll_max_options"]); ok && limit > 0 {
		if count := len(separatedCapabilityValues(strings.TrimSpace(fmt.Sprint(settings["poll_options"])))); count > limit {
			appendIssue("dynamic_poll_limit", fmt.Sprintf("This account currently supports at most %d poll options.", limit), "poll_options")
		}
	}
	return issues
}

func validateDynamicVideoConstraints(rendition models.Rendition, segment RenditionSegmentResponse, position int, constraints map[string]interface{}) []capabilities.ValidationIssue {
	issues := []capabilities.ValidationIssue{}
	appendIssue := func(code, message string) {
		issue := dynamicPublicationIssue(rendition, code, message, "media")
		issue.SegmentID = segment.ID
		issue.Scope = capabilities.SettingScopeSegment
		issue.ScopeID = segment.ID
		issue.Parameters = map[string]any{"segment_position": position}
		issues = append(issues, issue)
	}
	if limit, ok := dynamicInt(constraints["max_video_duration_seconds"]); ok && limit > 0 {
		for _, media := range segment.Media {
			if strings.HasPrefix(strings.ToLower(media.MimeType), "video/") && media.DurationMS > int64(limit)*1000 {
				appendIssue("dynamic_video_duration", fmt.Sprintf("Video must be %d seconds or less for this account.", limit))
				break
			}
		}
	}
	if limit, ok := dynamicInt64(constraints["max_video_size_bytes"]); ok && limit > 0 {
		for _, media := range segment.Media {
			if strings.HasPrefix(strings.ToLower(media.MimeType), "video/") && media.Size > limit {
				appendIssue("dynamic_video_size", "Video file is too large for this account.")
				break
			}
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
	capability, found := capabilities.FindOutput(account.Platform, rendition.OutputProfile)
	if !found {
		capability, found = capabilities.Find(account.Platform, rendition.Profile)
	}
	if !found {
		return nil
	}
	settings := map[string]any{}
	if err := json.Unmarshal([]byte(rendition.SettingsJSON), &settings); err != nil {
		return []capabilities.ValidationIssue{{
			Severity: "error", Code: "provider_policy_invalid",
			Message:  "Destination provider policy settings are invalid.",
			Provider: rendition.Platform, Profile: rendition.Profile, Field: "settings",
		}}
	}
	policyMode := providerreadiness.PublicationPolicyMode(account, capability, settings)
	missing := missingScopes(providerreadiness.RequiredScopesForSubject(providerreadiness.Subject{
		Provider: account.Platform, AccountKind: providerreadiness.AccountKind(account),
		OutputProfile: capability.OutputProfile, Operation: providerreadiness.OperationPublishImmediate,
		PolicyMode: policyMode,
	}), granted)
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
	allowed, err := middleware.CheckWorkspaceAccess(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
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

func (h *PublicationHandler) queuePublication(ctx context.Context, publicationID string, runAt time.Time) (string, error) {
	result, err := h.queuePublicationWithRunAt(ctx, publicationID, 0, publicationauth.PolicyScheduled, providerreadiness.ExecutionIntentProduction, func(_ *models.Publication, _ time.Time) (time.Time, error) {
		return runAt, nil
	})
	return result.JobID, err
}

func (h *PublicationHandler) queueScheduledPublication(ctx context.Context, publicationID string) (string, error) {
	result, err := h.queueScheduledPublicationExpected(ctx, publicationID, 0)
	return result.JobID, err
}

func (h *PublicationHandler) queueScheduledPublicationExpected(
	ctx context.Context,
	publicationID string,
	expectedRevision int,
	intents ...providerreadiness.ExecutionIntent,
) (publicationEnqueueResult, error) {
	return h.queuePublicationWithRunAt(ctx, publicationID, expectedRevision, publicationauth.PolicyScheduled, normalizedReadinessIntent(intents), func(publication *models.Publication, now time.Time) (time.Time, error) {
		if publication.ScheduledAt.IsZero() {
			return time.Time{}, errPublicationScheduleRequired
		}
		if err := validateFuturePublicationSchedule(publication.ScheduledAt, now); err != nil {
			return time.Time{}, err
		}
		return publication.ScheduledAt, nil
	})
}

func (h *PublicationHandler) queuePublicationNow(ctx context.Context, publicationID string) error {
	_, err := h.queuePublicationNowExpected(ctx, publicationID, 0)
	return err
}

func (h *PublicationHandler) queuePublicationNowExpected(
	ctx context.Context,
	publicationID string,
	expectedRevision int,
	intents ...providerreadiness.ExecutionIntent,
) (publicationEnqueueResult, error) {
	return h.queuePublicationWithRunAt(ctx, publicationID, expectedRevision, publicationauth.PolicyImmediate, normalizedReadinessIntent(intents), func(_ *models.Publication, now time.Time) (time.Time, error) {
		return now, nil
	})
}

//nolint:gocyclo // Queue creation, revision checks, schedule state, and rendition state must commit as one transition.
func (h *PublicationHandler) queuePublicationWithRunAt(
	ctx context.Context,
	publicationID string,
	expectedRevision int,
	policyMode string,
	intent providerreadiness.ExecutionIntent,
	resolveRunAt func(*models.Publication, time.Time) (time.Time, error),
) (publicationEnqueueResult, error) {
	operation := providerreadiness.OperationPublishImmediate
	if policyMode == publicationauth.PolicyScheduled {
		operation = providerreadiness.OperationPublishScheduled
	}
	if h.beforeQueueTransaction != nil {
		if err := h.beforeQueueTransaction(ctx); err != nil {
			return publicationEnqueueResult{}, err
		}
	}
	var result publicationEnqueueResult
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
		if err := h.requirePublicationReadinessWithDB(
			txCtx, tx, publication, operation, intent, true,
		); err != nil {
			return err
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
		if policyMode == publicationauth.PolicyScheduled {
			result.JobID, err = h.replacePublicationJobWithIntentTx(txCtx, tx, publicationID, runAt, intent)
		} else {
			result.JobID, err = h.replaceImmediatePublicationJobWithIntentTx(txCtx, tx, publicationID, runAt, intent)
		}
		if err != nil {
			return err
		}
		if err := h.markPublicationQueuedTx(txCtx, tx, publication, runAt, now); err != nil {
			return err
		}
		result.Renditions, err = h.loadRenditionActionOutcomes(txCtx, tx, publicationID)
		if err != nil {
			return err
		}
		activation := &models.WorkspaceActivation{
			ID: "activation:" + publication.WorkspaceID, WorkspaceID: publication.WorkspaceID,
			PublicationID: publication.ID, CreatedAt: now,
		}
		insert, err := tx.NewInsert().Model(activation).On("CONFLICT (workspace_id) DO NOTHING").Exec(txCtx)
		if err != nil {
			return err
		}
		affected, err := insert.RowsAffected()
		if err != nil {
			return err
		}
		result.NewlyActivated = affected == 1
		if !result.NewlyActivated {
			if err := tx.NewSelect().Model(activation).Where("workspace_id = ?", publication.WorkspaceID).Scan(txCtx); err != nil {
				return err
			}
		}
		result.ActivationID = activation.ID
		result.ActivationPublicationID = activation.PublicationID
		if result.NewlyActivated {
			event := &models.ProductAnalyticsEvent{
				ID: activation.ID, WorkspaceID: publication.WorkspaceID,
				Name: telemetry.EventWorkspaceActivated, CreatedAt: now,
			}
			if _, err := tx.NewInsert().Model(event).Exec(txCtx); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return publicationEnqueueResult{}, err
	}
	return result, nil
}

func (h *PublicationHandler) loadRenditionActionOutcomes(
	ctx context.Context,
	db bun.IDB,
	publicationID string,
) ([]RenditionActionOutcome, error) {
	var renditions []models.Rendition
	if err := db.NewSelect().Model(&renditions).
		Where("publication_id = ?", publicationID).
		Order("created_at ASC", "id ASC").
		Scan(ctx); err != nil {
		return nil, err
	}
	deliveries, err := providerwrite.LoadCurrentDeliveries(ctx, db, []string{publicationID})
	if err != nil {
		return nil, err
	}
	outcomes := make([]RenditionActionOutcome, 0, len(renditions))
	for _, rendition := range renditions {
		outcome := RenditionActionOutcome{
			ID: rendition.ID, SocialAccountID: rendition.SocialAccountID,
			TargetKey: rendition.TargetKey, Platform: rendition.Platform, Status: rendition.Status,
		}
		if delivery, ok := deliveries[rendition.ID]; ok {
			outcome.Delivery = providerDeliveryResponse(delivery)
			if outcome.Delivery.RecoveryAction == providerwrite.RecoveryRetry &&
				rendition.Status != models.RenditionStatusFailed {
				outcome.Delivery.RecoveryAction = providerwrite.RecoveryNone
			}
		}
		outcomes = append(outcomes, outcome)
	}
	return outcomes, nil
}

func (h *PublicationHandler) requirePublicationReadiness(
	ctx context.Context,
	publicationID string,
	operation providerreadiness.Operation,
	intent providerreadiness.ExecutionIntent,
) error {
	if h == nil || h.readiness == nil {
		return &providerreadiness.NotReadyError{Decision: providerreadiness.UnavailableDecision(operation)}
	}
	var publication models.Publication
	if err := h.db.NewSelect().Model(&publication).Where("id = ?", publicationID).Scan(ctx); err != nil {
		return err
	}
	return h.requirePublicationReadinessWithDB(ctx, h.db, &publication, operation, intent, false)
}

func (h *PublicationHandler) requirePublicationReadinessWithDB(
	ctx context.Context,
	db bun.IDB,
	publication *models.Publication,
	operation providerreadiness.Operation,
	intent providerreadiness.ExecutionIntent,
	lock bool,
) error {
	if h == nil || h.readiness == nil || db == nil || publication == nil {
		return &providerreadiness.NotReadyError{Decision: providerreadiness.UnavailableDecision(operation)}
	}
	var renditions []models.Rendition
	renditionsQuery := db.NewSelect().Model(&renditions).
		Where("publication_id = ?", publication.ID).
		OrderExpr("id ASC")
	if lock && primaryPublicationQueueUsesRowLock(db.Dialect().Name()) {
		renditionsQuery = renditionsQuery.For("UPDATE")
	}
	if err := renditionsQuery.Scan(ctx); err != nil {
		return err
	}
	accountIDs := make([]string, 0, len(renditions))
	for _, rendition := range renditions {
		accountIDs = append(accountIDs, rendition.SocialAccountID)
	}
	accounts, err := loadReadinessAccountsWithDB(ctx, db, publication.WorkspaceID, accountIDs, lock)
	if err != nil {
		return err
	}
	readiness := h.readiness.WithLedger(providerreadiness.NewRepository(db))
	for _, rendition := range renditions {
		account := accounts[rendition.SocialAccountID]
		capability, found := capabilities.FindOutput(account.Platform, rendition.OutputProfile)
		if !found {
			capability, found = capabilities.Find(account.Platform, rendition.Profile)
		}
		if !found {
			capability = capabilities.Capability{
				Provider: account.Platform, Profile: rendition.Profile, OutputProfile: rendition.OutputProfile,
			}
		}
		settings := map[string]any{}
		if err := json.Unmarshal([]byte(rendition.SettingsJSON), &settings); err != nil {
			return fmt.Errorf("decode rendition provider policy settings: %w", err)
		}
		decision := readiness.DecideAccountPublication(
			ctx,
			account,
			capability,
			operation,
			intent,
			providerreadiness.PublicationPolicyMode(account, capability, settings),
		)
		if !decision.Publishable {
			return &providerreadiness.NotReadyError{Decision: decision}
		}
	}
	return nil
}

func loadReadinessAccountsWithDB(
	ctx context.Context,
	db bun.IDB,
	workspaceID string,
	accountIDs []string,
	lock bool,
) (map[string]models.SocialAccount, error) {
	uniqueIDs := uniqueNonEmpty(accountIDs)
	if len(uniqueIDs) == 0 {
		return map[string]models.SocialAccount{}, nil
	}
	var accounts []models.SocialAccount
	query := db.NewSelect().Model(&accounts).
		Where("workspace_id = ?", workspaceID).
		Where("is_active = ?", true).
		Where("id IN (?)", bun.List(uniqueIDs))
	if lock && primaryPublicationQueueUsesRowLock(db.Dialect().Name()) {
		query = query.For("UPDATE")
	}
	if err := query.Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to validate social accounts")
	}
	if len(accounts) != len(uniqueIDs) {
		return nil, huma.Error400BadRequest("one or more social accounts are invalid, disconnected, or outside this workspace")
	}
	result := make(map[string]models.SocialAccount, len(accounts))
	for _, account := range accounts {
		result[account.ID] = account
	}
	return result, nil
}

func (h *PublicationHandler) replacePublicationJobTx(ctx context.Context, tx bun.Tx, publicationID string, runAt time.Time) (string, error) {
	return h.replacePublicationJobWithIntentTx(ctx, tx, publicationID, runAt, providerreadiness.ExecutionIntentProduction)
}

func (h *PublicationHandler) replacePublicationJobWithIntentTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	runAt time.Time,
	intent providerreadiness.ExecutionIntent,
) (string, error) {
	return h.replacePublicationJobsTx(ctx, tx, publicationID, runAt, true, publicationauth.PolicyScheduled, intent)
}

func (h *PublicationHandler) replaceImmediatePublicationJobWithIntentTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	runAt time.Time,
	intent providerreadiness.ExecutionIntent,
) (string, error) {
	return h.replacePublicationJobsTx(ctx, tx, publicationID, runAt, false, publicationauth.PolicyImmediate, intent)
}

//nolint:gocyclo // Queue replacement, overrides, jobs, receipts, and publication state must commit atomically.
func (h *PublicationHandler) replacePublicationJobsTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	runAt time.Time,
	useScheduleOverrides bool,
	policyMode string,
	intent providerreadiness.ExecutionIntent,
) (string, error) {
	if err := lockPublicationMutationTx(ctx, tx, publicationID); err != nil {
		return "", err
	}
	if err := h.lockActivePrimaryPublicationJobsTx(ctx, tx, publicationID); err != nil {
		return "", err
	}
	if err := h.rejectProcessingPrimaryPublicationJobTx(ctx, tx, publicationID); err != nil {
		return "", err
	}
	if err := h.rejectProtectedPrimaryPublicationJobTx(ctx, tx, publicationID); err != nil {
		return "", err
	}
	if err := h.deletePendingPrimaryPublicationJobsTx(ctx, tx, publicationID); err != nil {
		return "", err
	}
	var publication models.Publication
	if err := tx.NewSelect().Model(&publication).Where("id = ?", publicationID).Scan(ctx); err != nil {
		return "", err
	}
	actor := publicationAuthorizationActor(ctx, publication.CreatedByID)
	batchID := uuid.NewString()
	targets := make([]publicationauth.JobTarget, 0, 1)
	if useScheduleOverrides {
		var renditions []models.Rendition
		if err := tx.NewSelect().Model(&renditions).
			Where("publication_id = ?", publicationID).
			Order("created_at ASC").Scan(ctx); err != nil {
			return "", err
		}
		hasOverride := false
		for _, rendition := range renditions {
			hasOverride = hasOverride || !rendition.ScheduleOverride.IsZero()
		}
		if hasOverride {
			firstJobID := ""
			for _, rendition := range renditions {
				renditionRunAt := runAt
				if !rendition.ScheduleOverride.IsZero() {
					renditionRunAt = rendition.ScheduleOverride
				}
				if !renditionRunAt.After(time.Now().UTC()) {
					return "", errPublicationScheduleFuture
				}
				jobID, err := insertPublicationJobTx(ctx, tx, publicationID, rendition.ID, batchID, renditionRunAt, intent)
				if err != nil {
					return "", err
				}
				targets = append(targets, publicationauth.JobTarget{JobID: jobID, RenditionID: rendition.ID, RunAt: renditionRunAt})
				if firstJobID == "" {
					firstJobID = jobID
				}
			}
			if _, _, err := publicationauth.CreateBatch(ctx, tx, publicationauth.BatchInput{
				BatchID: batchID, PublicationID: publicationID, Actor: actor,
				Action: publicationauth.ActionPublish, PolicyMode: policyMode,
				ExecutionIntent: string(intent), ConfirmedAt: time.Now().UTC(), Targets: targets,
			}); err != nil {
				return "", err
			}
			return firstJobID, nil
		}
	}
	jobID, err := insertPublicationJobTx(ctx, tx, publicationID, "", batchID, runAt, intent)
	if err != nil {
		return "", err
	}
	if _, _, err := publicationauth.CreateBatch(ctx, tx, publicationauth.BatchInput{
		BatchID: batchID, PublicationID: publicationID, Actor: actor,
		Action: publicationauth.ActionPublish, PolicyMode: policyMode,
		ExecutionIntent: string(intent), ConfirmedAt: time.Now().UTC(),
		Targets: []publicationauth.JobTarget{{JobID: jobID, RunAt: runAt}},
	}); err != nil {
		return "", err
	}
	return jobID, nil
}

func insertPublicationJobTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID, renditionID, authorizationBatchID string,
	runAt time.Time,
	intent providerreadiness.ExecutionIntent,
) (string, error) {
	payload := map[string]string{
		"publication_id":             publicationID,
		"authorization_batch_id":     authorizationBatchID,
		"authorization_scheduled_at": runAt.UTC().Format(time.RFC3339Nano),
		"readiness_intent":           string(normalizedReadinessIntent([]providerreadiness.ExecutionIntent{intent})),
	}
	if renditionID != "" {
		payload["rendition_id"] = renditionID
	}
	job, err := jobregistry.NewJob(jobTypePublishPublication, mustJSON(payload), runAt)
	if err != nil {
		return "", err
	}
	job.ScopeID = publicationID
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
		Where("status IN (?)", bun.List([]string{jobStatusPending, jobStatusProcessing, "failed"})).
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

func (h *PublicationHandler) rejectPendingPrimaryPublicationJobTx(ctx context.Context, tx bun.Tx, publicationID string) error {
	count, err := tx.NewSelect().
		Model((*models.Job)(nil)).
		Where(primaryPublishPublicationJobWhere(h.db), jobTypePublishPublication, publicationID).
		Where("status = ?", jobStatusPending).
		Count(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return errPublicationAlreadyProcessing
	}
	return nil
}

func (h *PublicationHandler) rejectUnresolvedPublicationTargetsTx(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
	renditionIDs []string,
) error {
	if len(renditionIDs) == 0 {
		return nil
	}
	count, err := tx.NewSelect().Model((*models.ProviderWriteAttempt)(nil)).
		Where("publication_id = ?", publicationID).
		Where("rendition_id IN (?)", bun.List(renditionIDs)).
		Where("status IN (?)", bun.List([]string{
			providerwrite.StatusSending,
			providerwrite.StatusAmbiguous,
		})).
		Count(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return errPublicationAlreadyProcessing
	}

	// Provider acceptance is durable before the local published status. A
	// failed local status can therefore describe an external write that already
	// succeeded. Block a new operation only when that exact accepted subject is
	// still unpublished; accepted earlier segments in a partially published
	// thread are expected and must not prevent retrying a later failed segment.
	var acceptedAttempts []models.ProviderWriteAttempt
	if err := tx.NewSelect().Model(&acceptedAttempts).
		Where("publication_id = ?", publicationID).
		Where("rendition_id IN (?)", bun.List(renditionIDs)).
		Where("status = ?", providerwrite.StatusAccepted).
		Where("operation = ?", "publish").
		Scan(ctx); err != nil {
		return err
	}
	if len(acceptedAttempts) == 0 {
		return nil
	}

	var renditions []models.Rendition
	if err := tx.NewSelect().Model(&renditions).Column("id", "status").
		Where("id IN (?)", bun.List(renditionIDs)).
		Scan(ctx); err != nil {
		return err
	}
	renditionStatus := make(map[string]string, len(renditions))
	for _, rendition := range renditions {
		renditionStatus[rendition.ID] = rendition.Status
	}
	var segments []models.RenditionSegment
	if err := tx.NewSelect().Model(&segments).Column("id", "rendition_id", "status").
		Where("rendition_id IN (?)", bun.List(renditionIDs)).
		Scan(ctx); err != nil {
		return err
	}
	segmentsByRendition := make(map[string][]models.RenditionSegment, len(renditionIDs))
	for _, segment := range segments {
		segmentsByRendition[segment.RenditionID] = append(segmentsByRendition[segment.RenditionID], segment)
	}
	for _, attempt := range acceptedAttempts {
		if acceptedPublicationAttemptSubjectPublished(attempt, renditionStatus, segmentsByRendition) {
			continue
		}
		return errPublicationAlreadyProcessing
	}
	return nil
}

func acceptedPublicationAttemptSubjectPublished(
	attempt models.ProviderWriteAttempt,
	renditionStatus map[string]string,
	segmentsByRendition map[string][]models.RenditionSegment,
) bool {
	status, renditionExists := renditionStatus[attempt.RenditionID]
	authorizationID := strings.TrimSpace(attempt.AuthorizationID)
	if authorizationID == "" {
		// Pre-receipt attempts do not encode a target we can safely distinguish.
		// Only a fully persisted rendition proves that replay is unnecessary.
		return renditionExists && status == models.RenditionStatusPublished
	}
	if attempt.OperationID == strings.Join([]string{
		"authorization", authorizationID, attempt.RenditionID, "publish",
	}, ":") {
		return renditionExists && status == models.RenditionStatusPublished
	}
	for _, segment := range segmentsByRendition[attempt.RenditionID] {
		if attempt.OperationID != strings.Join([]string{
			"authorization", authorizationID, segment.ID, "publish",
		}, ":") {
			continue
		}
		return segment.Status == models.RenditionStatusPublished
	}
	// A canonical accepted publish with an unknown subject cannot safely mint a
	// new authorization identity.
	return false
}

func (h *PublicationHandler) rejectProtectedPrimaryPublicationJobTx(ctx context.Context, tx bun.Tx, publicationID string) error {
	count, err := tx.NewSelect().TableExpr("jobs AS protected_job").
		Join("JOIN provider_write_attempts AS protected_attempt ON protected_attempt.job_id = protected_job.id").
		Where(primaryPublishPublicationJobWhere(h.db), jobTypePublishPublication, publicationID).
		Where("protected_job.status IN (?)", bun.List([]string{jobStatusPending, "failed"})).
		Where("protected_attempt.status IN (?)", bun.List([]string{
			providerwrite.StatusSending,
			providerwrite.StatusAmbiguous,
			providerwrite.StatusAccepted,
		})).
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
	if err := h.rejectProtectedPrimaryPublicationJobTx(ctx, tx, publicationID); err != nil {
		return err
	}
	if err := h.deletePendingPrimaryPublicationJobsTx(ctx, tx, publicationID); err != nil {
		return err
	}
	if _, err := tx.NewUpdate().
		Model((*models.Rendition)(nil)).
		Set("status = ?", models.RenditionStatusDraft).
		Set("schedule_override = NULL").
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
		CreationPreset: publicationFirstNonEmpty(publication.CreationPreset, publication.Intent, publishingIntentForProfile(publication.ContentProfile)),
		SocialSetID:    publication.SocialSetID,
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
		RepostOverride: repostservice.DecodeOverride(publication.RepostOverride),
		CreatedAt:      publication.CreatedAt.Format(time.RFC3339),
		UpdatedAt:      publication.UpdatedAt.Format(time.RFC3339),
		Media:          media,
	}
}

func (h *PublicationHandler) validateRepostOverride(ctx context.Context, workspaceID, userID string, input repostservice.Override) (repostservice.Override, error) {
	if h.reposts == nil {
		return repostservice.NormalizeOverride(input)
	}
	return h.reposts.ValidateOverride(ctx, workspaceID, userID, input)
}

func renditionResponse(rendition models.Rendition, media []MediaSummary) RenditionResponse {
	settings := map[string]interface{}{}
	_ = json.Unmarshal([]byte(rendition.SettingsJSON), &settings)
	return RenditionResponse{
		ID:               rendition.ID,
		PublicationID:    rendition.PublicationID,
		SocialAccountID:  rendition.SocialAccountID,
		TargetKey:        rendition.TargetKey,
		Platform:         rendition.Platform,
		Profile:          rendition.Profile,
		OutputProfile:    publicationFirstNonEmpty(rendition.OutputProfile, rendition.Platform+".post"),
		FormatLocked:     rendition.FormatLocked,
		ScheduleOverride: formatOptionalTime(rendition.ScheduleOverride),
		Body:             rendition.Body,
		Title:            rendition.Title,
		Description:      rendition.Description,
		Settings:         settings,
		Status:           rendition.Status,
		ExternalID:       rendition.ExternalID,
		ExternalURL:      rendition.ExternalURL,
		ErrorMessage:     rendition.ErrorMessage,
		ErrorKind:        rendition.ErrorKind,
		ErrorCode:        rendition.ErrorCode,
		ErrorHTTPStatus:  rendition.ErrorHTTPStatus,
		ErrorRetryable:   rendition.ErrorRetryable,
		ErrorRetryAt:     formatOptionalTime(rendition.ErrorRetryAt),
		ErrorAction:      rendition.ErrorAction,
		Media:            media,
	}
}

func providerDeliveryResponse(delivery models.ProviderDelivery) *ProviderDeliveryResponse {
	return &ProviderDeliveryResponse{
		TargetKey:               delivery.TargetKey,
		State:                   delivery.State,
		TerminalReason:          delivery.TerminalReason,
		CurrentAttemptID:        delivery.CurrentAttemptID,
		CurrentAttemptNumber:    delivery.CurrentAttemptNumber,
		CurrentAttemptCreatedAt: delivery.CurrentAttemptCreatedAt.UTC().Format(time.RFC3339Nano),
		ExternalID:              delivery.ExternalID,
		ExternalURL:             delivery.ExternalURL,
		ErrorKind:               delivery.SafeErrorClass,
		ErrorCode:               delivery.SafeErrorCode,
		ErrorHTTPStatus:         delivery.ErrorHTTPStatus,
		RecoveryAction:          providerwrite.DeliveryRecoveryAction(delivery),
		LastReconciledAt:        formatOptionalTime(delivery.LastReconciledAt),
		NextReconciliationAt:    formatOptionalTime(delivery.NextReconciliationAt),
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

func renditionAccountIDs(renditions []RenditionInput) []string {
	out := make([]string, 0, len(renditions))
	for _, rendition := range renditions {
		out = append(out, rendition.SocialAccountID)
	}
	return out
}

func normalizeRenditionTargetKey(account models.SocialAccount, requested string) (string, error) {
	base := publicationauth.TargetKey(account)
	target := strings.TrimSpace(requested)
	if target == "" {
		return base, nil
	}
	if len(target) > 255 {
		return "", errors.New("target_key must be at most 255 bytes")
	}
	for _, char := range target {
		if unicode.IsControl(char) || unicode.IsSpace(char) {
			return "", errors.New("target_key cannot contain whitespace or control characters")
		}
	}
	if target != base && !strings.HasPrefix(target, base+":") {
		return "", errors.New("target_key must belong to the selected social account provider")
	}
	return target, nil
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

func enqueueActionMessage(
	message,
	publicationID string,
	result publicationEnqueueResult,
) *ActionOutput {
	resp := actionMessage(message, result.JobID)
	resp.Body.PublicationID = publicationID
	resp.Body.Renditions = result.Renditions
	resp.Body.WorkspaceActivated = result.NewlyActivated
	if result.NewlyActivated {
		resp.Body.ActivationPublicationID = result.ActivationPublicationID
	}
	return resp
}
