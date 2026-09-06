// Package publications defines the transport-neutral Publication application contract.
package publications

import (
	"context"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/services/providerreadiness"
	repostservice "github.com/openpost/backend/internal/services/reposts"
)

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
	WorkspaceID        string                    `json:"workspace_id" doc:"Workspace ID"`
	Title              string                    `json:"title" doc:"Internal publication title"`
	Intent             string                    `json:"intent,omitempty" enum:"post,thread,story,short_video,video" doc:"Deprecated compatibility alias for creation_preset"`
	CreationPreset     string                    `json:"creation_preset,omitempty" enum:"post,thread,story,short_video,video" doc:"Starter preset; destination renditions own their formats"`
	SocialSetID        string                    `json:"social_set_id,omitempty" doc:"Social Set used to initialize the snapshotted destinations"`
	ContentProfile     string                    `json:"content_profile" doc:"Content profile"`
	SourceText         string                    `json:"source_text" doc:"Canonical source text"`
	SourceURL          string                    `json:"source_url,omitempty" doc:"Source URL for link shares"`
	Goal               string                    `json:"goal,omitempty" doc:"Publication goal"`
	Audience           string                    `json:"audience,omitempty" doc:"Target audience"`
	ScheduledAt        *time.Time                `json:"scheduled_at,omitempty" doc:"Optional schedule time"`
	RandomDelayMinutes *int                      `json:"random_delay_minutes,omitempty" minimum:"0" maximum:"60" doc:"Optional random schedule delay in minutes (±N); omit to inherit the Workspace setting when scheduled"`
	Metadata           map[string]interface{}    `json:"metadata,omitempty" doc:"Publication metadata"`
	SocialAccountIDs   []string                  `json:"social_account_ids,omitempty" doc:"Accounts to create default renditions for"`
	Media              []PublicationMediaInput   `json:"media,omitempty" doc:"Default ordered media"`
	Segments           []PublicationSegmentInput `json:"segments,omitempty" doc:"Ordered canonical publication segments"`
	Renditions         []RenditionInput          `json:"renditions,omitempty" doc:"Explicit platform/account renditions"`
	RepostOverride     *repostservice.Override   `json:"repost_override,omitempty" doc:"Optional per-publication repost override"`
}

type PublicationUpdateBody struct {
	ExpectedRevision   int                       `json:"expected_revision" minimum:"1" doc:"Revision loaded by the editor"`
	Title              *string                   `json:"title,omitempty" doc:"Internal publication title"`
	Intent             *string                   `json:"intent,omitempty" enum:"post,thread,story,short_video,video" doc:"Deprecated compatibility alias for creation_preset"`
	CreationPreset     *string                   `json:"creation_preset,omitempty" enum:"post,thread,story,short_video,video" doc:"Starter preset; destination renditions own their formats"`
	SocialSetID        *string                   `json:"social_set_id,omitempty" doc:"Social Set provenance; does not replace snapshotted destinations"`
	ContentProfile     *string                   `json:"content_profile,omitempty" doc:"Content profile"`
	SourceText         *string                   `json:"source_text,omitempty" doc:"Canonical source text"`
	SourceURL          *string                   `json:"source_url,omitempty" doc:"Source URL"`
	Goal               *string                   `json:"goal,omitempty" doc:"Publication goal"`
	Audience           *string                   `json:"audience,omitempty" doc:"Target audience"`
	ScheduledAt        *time.Time                `json:"scheduled_at,omitempty" doc:"Optional schedule time"`
	ClearSchedule      bool                      `json:"clear_schedule,omitempty" doc:"Clear the saved schedule and cancel its pending publication job"`
	RandomDelayMinutes *int                      `json:"random_delay_minutes,omitempty" minimum:"0" maximum:"60" doc:"Replace the random schedule delay in minutes (±N)"`
	InheritRandomDelay bool                      `json:"inherit_random_delay,omitempty" doc:"Use the Workspace random-delay setting the next time this Publication is scheduled"`
	Metadata           map[string]interface{}    `json:"metadata,omitempty" doc:"Publication metadata"`
	Segments           []PublicationSegmentInput `json:"segments,omitempty" doc:"Replacement ordered canonical segments"`
	Renditions         []RenditionInput          `json:"renditions,omitempty" doc:"Replacement destination renditions saved in the same transaction"`
	RepostOverride     *repostservice.Override   `json:"repost_override,omitempty" doc:"Replace the per-publication repost override"`
}

type ListPublicationsInput struct {
	WorkspaceID    string `query:"workspace_id" required:"true" doc:"Workspace ID"`
	Status         string `query:"status" doc:"Optional status filter"`
	ActivityBucket string `query:"activity_bucket" enum:"scheduled,published,failed,draft" doc:"Optional Publication activity bucket filter"`
	ContentProfile string `query:"content_profile" doc:"Optional content profile filter"`
	Platform       string `query:"platform" doc:"Optional destination platform filter"`
	Search         string `query:"search" doc:"Case-insensitive title or source-text search"`
	Cursor         string `query:"cursor" doc:"Opaque cursor for stable newest-first pagination"`
	CreatedFrom    string `query:"created_from" doc:"Include publications created at or after this RFC3339 timestamp"`
	CreatedBefore  string `query:"created_before" doc:"Include publications created before this RFC3339 timestamp"`
	CalendarFrom   string `query:"calendar_from" doc:"Include calendar occurrences at or after this RFC3339 timestamp"`
	CalendarBefore string `query:"calendar_before" doc:"Include calendar occurrences before this RFC3339 timestamp"`
	Limit          int    `query:"limit" doc:"Limit, default 50"`
	Offset         int    `query:"offset" doc:"Offset"`
}

type PublicationResponse struct {
	ID                   string                       `json:"id"`
	WorkspaceID          string                       `json:"workspace_id"`
	CreatedByID          string                       `json:"created_by"`
	Title                string                       `json:"title"`
	Intent               string                       `json:"intent"`
	CreationPreset       string                       `json:"creation_preset"`
	SocialSetID          string                       `json:"social_set_id,omitempty"`
	ContentProfile       string                       `json:"content_profile"`
	SourceText           string                       `json:"source_text"`
	SourceURL            string                       `json:"source_url,omitempty"`
	Goal                 string                       `json:"goal,omitempty"`
	Audience             string                       `json:"audience,omitempty"`
	Status               string                       `json:"status"`
	Revision             int                          `json:"revision"`
	ScheduledAt          string                       `json:"scheduled_at,omitempty"`
	ActualRunAt          string                       `json:"actual_run_at,omitempty"`
	FailureDismissedAt   string                       `json:"failure_dismissed_at,omitempty"`
	RandomDelayMinutes   int                          `json:"random_delay_minutes"`
	RandomDelayInherited bool                         `json:"random_delay_inherited"`
	Metadata             map[string]any               `json:"metadata"`
	CreatedAt            string                       `json:"created_at"`
	UpdatedAt            string                       `json:"updated_at"`
	Renditions           []RenditionResponse          `json:"renditions"`
	Segments             []PublicationSegmentResponse `json:"segments"`
	Media                []MediaSummary               `json:"media"`
	RepostOverride       repostservice.Override       `json:"repost_override"`
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

// Transport-neutral names keep adapters from defining the application vocabulary.
type CreateCommand = CreatePublicationBody
type UpdateCommand = PublicationUpdateBody
type ListQuery = ListPublicationsInput
type Publication = PublicationResponse
type Rendition = RenditionInput

// ListPage is one stable page of canonical Publications.
type ListPage struct {
	TotalCount   int
	Limit        int
	Offset       int
	NextOffset   int
	NextCursor   string
	HasMore      bool
	Publications []PublicationResponse
}

// EnqueueResult identifies the exact durable work and destination state accepted by a delivery command.
type EnqueueResult struct {
	JobID                   string
	Renditions              []RenditionActionOutcome
	ActivationID            string
	ActivationPublicationID string
	NewlyActivated          bool
}

// HistoryPage is one stable page of lifecycle evidence.
type HistoryPage struct {
	Events     []PublicationLifecycleEventResponse
	NextCursor string
	HasMore    bool
}

// Application is the cohesive Publication command and query boundary used by every canonical transport.
type Application interface {
	Create(context.Context, string, CreateCommand) (Publication, error)
	Get(context.Context, string, string) (Publication, error)
	List(context.Context, string, ListQuery) (ListPage, error)
	Update(context.Context, string, string, UpdateCommand) error
	Delete(context.Context, string, string, int) error
	ReplaceRenditions(context.Context, string, string, int, []Rendition) error
	Validate(context.Context, string, string) ([]capabilities.ValidationIssue, error)
	Schedule(context.Context, string, string, int, providerreadiness.ExecutionIntent) (EnqueueResult, error)
	PublishNow(context.Context, string, string, int, providerreadiness.ExecutionIntent) (EnqueueResult, error)
	Cancel(context.Context, string, string, int) error
	RetryRendition(context.Context, string, string, string, string) (string, error)
	RetryFailedRenditions(context.Context, string, string) (string, error)
	History(context.Context, string, string, int, string) (HistoryPage, error)
}
