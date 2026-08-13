package platform

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"time"
)

// PublishRequest contains everything needed to publish a single post.
type PublishRequest struct {
	Content          string // Post text content
	Profile          string // OpenPost content profile, e.g. short_text, carousel, story, short_video
	OutputProfile    string // Provider-qualified output profile, e.g. instagram.carousel
	Title            string // Provider-specific title for video/link surfaces
	Description      string // Provider-specific description for video/link surfaces
	SettingsJSON     string // Raw provider settings JSON
	Settings         map[string]interface{}
	PlatformMediaIDs []string                 // Platform-specific media IDs from UploadMedia
	MediaAltTexts    []string                 // Alt text for each media item (parallel to PlatformMediaIDs)
	MediaSettings    []map[string]interface{} // Per-media settings parallel to PlatformMediaIDs
	Media            []MediaItem
	ReplyToID        string // External ID of parent post (empty for first post in thread)

	// OperationID and IdempotencyKey identify one logical provider mutation.
	// They never contain content or credentials. Adapters may use the
	// idempotency key only when their provider documents an idempotency
	// contract for the exact endpoint being called.
	OperationID    string
	IdempotencyKey string

	// Resume* contains only provider-issued, non-secret identifiers persisted by
	// the durable provider-write fence. It lets an adapter reconcile an accepted
	// asynchronous submission without replaying the original mutation.
	ResumeProviderState     string
	ResumeProviderReference string
	ResumeExternalID        string

	writeBoundary   PublishWriteBoundary
	writeCheckpoint PublishWriteCheckpoint
}

type PublishSubmissionState string

const (
	PublishSubmissionNotSent  PublishSubmissionState = "not_sent"
	PublishSubmissionAccepted PublishSubmissionState = "accepted"
	PublishSubmissionPending  PublishSubmissionState = "pending"
	PublishSubmissionRejected PublishSubmissionState = "rejected"
	PublishSubmissionUnknown  PublishSubmissionState = "unknown"
)

type PublishRetrySafety string

const (
	PublishRetrySafe          PublishRetrySafety = "safe"
	PublishRetryIdempotent    PublishRetrySafety = "idempotent"
	PublishRetryReconcileOnly PublishRetrySafety = "reconcile_only"
	PublishRetryNever         PublishRetrySafety = "never"
)

// PublishResult is the durable, provider-neutral result of one logical
// publish. ProviderState and ProviderReference must contain only short,
// provider-issued identifiers or normalized state names; raw responses,
// request payloads, tokens, and credential-bearing URLs are forbidden.
type PublishResult struct {
	ExternalID        string
	ExternalURL       string
	SubmissionState   PublishSubmissionState
	ProviderState     string
	ProviderReference string
	RetrySafety       PublishRetrySafety
	ReconcileAfter    time.Duration
	IdempotencyTTL    time.Duration
}

type PublishWriteBoundary func(PublishResult) error
type PublishWriteCheckpoint func(PublishResult) error

func AcceptedPublishResult(externalID string) PublishResult {
	return PublishResult{
		ExternalID:      externalID,
		SubmissionState: PublishSubmissionAccepted,
		RetrySafety:     PublishRetryNever,
	}
}

// executePublishWrite wraps the externally visible mutation performed by an
// adapter. Keeping this boundary in the platform package makes every adapter
// participate in the same durable fence while still allowing provider-specific
// validation and preparation to remain in the adapter implementation.
func executePublishWrite(req *PublishRequest, providerState string, write func() (string, error)) (PublishResult, error) {
	prepared := PublishResult{
		ProviderState: providerState,
		RetrySafety:   PublishRetryNever,
	}
	return executePreparedPublishWrite(req, prepared, write)
}

func executePreparedPublishWrite(req *PublishRequest, prepared PublishResult, write func() (string, error)) (PublishResult, error) {
	if err := req.BeginWrite(prepared); err != nil {
		return PublishResult{}, err
	}
	externalID, err := write()
	if err != nil {
		return prepared, err
	}
	result := AcceptedPublishResult(externalID)
	result.ProviderState = prepared.ProviderState
	result.ProviderReference = prepared.ProviderReference
	if err := req.Checkpoint(result); err != nil {
		return result, err
	}
	return result, nil
}

// SetWriteFence is called by the application execution primitive. Provider
// adapters must call BeginWrite immediately before their first externally
// visible mutation and Checkpoint as soon as they receive a durable provider
// reference or accepted external ID.
func (r *PublishRequest) SetWriteFence(boundary PublishWriteBoundary, checkpoint PublishWriteCheckpoint) {
	if r == nil {
		return
	}
	r.writeBoundary = boundary
	r.writeCheckpoint = checkpoint
}

func (r *PublishRequest) BeginWrite(result PublishResult) error {
	if r == nil || r.writeBoundary == nil {
		return nil
	}
	return r.writeBoundary(result)
}

func (r *PublishRequest) Checkpoint(result PublishResult) error {
	if r == nil || r.writeCheckpoint == nil {
		return nil
	}
	return r.writeCheckpoint(result)
}

type MediaItem struct {
	ID               string
	MimeType         string
	Size             int64
	DurationMS       int64
	OriginalFilename string
}

type UploadMediaRequest struct {
	MimeType          string
	Filename          string
	Size              int64
	Title             string
	Description       string
	Settings          map[string]interface{}
	Reader            io.Reader
	ThumbnailMimeType string
	ThumbnailFilename string
	ThumbnailSize     int64
	ThumbnailReader   io.Reader
	CaptionMimeType   string
	CaptionFilename   string
	CaptionSize       int64
	CaptionReader     io.Reader
	// OpenReaderAt returns a fresh reader positioned at an exact byte offset.
	// Resumable adapters use it after a worker restart or an ambiguous network
	// response; ordinary upload adapters can keep using Reader.
	OpenReaderAt func(offset int64) (io.ReadCloser, error)
}

// DirectMediaPublisher is an optional publishing extension for providers, such
// as Discord webhooks, that accept message fields and file bodies in one
// request. Readers are owned by the caller and are valid only for this call.
type DirectMediaPublisher interface {
	PublishWithMedia(ctx context.Context, accessToken, accountID string, req *PublishRequest, media []UploadMediaRequest) (PublishResult, error)
}

// PublishReconciler performs a read-only lookup for a previously submitted
// provider operation. It must never recreate the write.
type PublishReconciler interface {
	ReconcilePublish(ctx context.Context, accessToken, accountID, providerReference string) (PublishResult, error)
}

type MediaValidationIssue struct {
	Provider string
	MediaID  string
	Severity string
	Message  string
}

type MediaValidator func([]MediaItem) []MediaValidationIssue

var MediaValidators = map[string]MediaValidator{}
var registerMediaValidatorsOnce sync.Once

var ErrUnsupportedCommentAction = errors.New("comment action unsupported")

func RegisterAllMediaValidators() {
	registerMediaValidatorsOnce.Do(func() {
		MediaValidators[providerBluesky] = validateBlueskyMedia
		MediaValidators[providerDiscord] = validateDiscordMedia
		MediaValidators[providerFacebook] = validateFacebookMedia
		MediaValidators[providerInstagram] = validateInstagramMedia
		MediaValidators[providerLinkedIn] = validateLinkedInMedia
		MediaValidators[providerMastodon] = validateMastodonMedia
		MediaValidators[providerTikTok] = validateTikTokMedia
		MediaValidators[providerThreads] = validateThreadsMedia
		MediaValidators[providerX] = validateXMedia
		MediaValidators[providerYouTube] = validateYouTubeMedia
	})
}

func ValidateMedia(platformName string, media []MediaItem) []MediaValidationIssue {
	if validator, ok := MediaValidators[platformName]; ok {
		return validator(media)
	}
	return nil
}

func isVideoMime(mimeType string) bool {
	return strings.HasPrefix(strings.ToLower(mimeType), "video/")
}

// UserProfile is a platform-agnostic user identity returned by GetProfile.
type UserProfile struct {
	ID              string
	Username        string
	DisplayName     string
	CapabilityState map[string]string
}

// AccountSelectionOption is a user-visible account, page, or channel that can
// be selected after a provider OAuth flow. It must not contain access tokens or
// other secrets because options are stored as pending OAuth metadata.
type AccountSelectionOption struct {
	ID          string            `json:"id"`
	Username    string            `json:"username,omitempty"`
	DisplayName string            `json:"display_name,omitempty"`
	AvatarURL   string            `json:"avatar_url,omitempty"`
	Description string            `json:"description,omitempty"`
	Kind        string            `json:"kind,omitempty"`
	Extra       map[string]string `json:"extra,omitempty"`
}

type SelectedAccount struct {
	AccountID        string
	AccountUsername  string
	AccountAvatarURL string
	InstanceURL      string
	Token            *TokenResult
	CapabilityState  map[string]string
}

type DestinationOptionsInput struct {
	RegionCode string
	Language   string
}

type DestinationOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// DestinationOptionsProvider exposes account-specific choices used by a
// provider's composer settings, such as playlists and publishing categories.
type DestinationOptionsProvider interface {
	ListDestinationOptions(ctx context.Context, accessToken string, input DestinationOptionsInput) (map[string][]DestinationOption, error)
}

type PublishingOptionsInput struct {
	Source     string
	Search     string
	Locale     string
	RegionCode string
	Cursor     string
	Context    map[string]string
	Limit      int
}

type PublishingOptionsPage struct {
	Options    []DestinationOption
	NextCursor string
}

// PublishingOptionsProvider searches one account collection at a time. The
// broad DestinationOptionsProvider remains a compatibility interface.
type PublishingOptionsProvider interface {
	SearchPublishingOptions(ctx context.Context, accessToken string, input PublishingOptionsInput) (PublishingOptionsPage, error)
}

type AccountCapabilityInput struct {
	Intent        string
	OutputProfile string
	MediaShape    string
	Locale        string
	RegionCode    string
	Settings      map[string]interface{}
}

type AccountCapabilityResult struct {
	Revision          string
	Options           map[string][]DestinationOption
	Constraints       map[string]interface{}
	AvailableFeatures map[string]bool
	UnavailableReason string
	State             map[string]string
}

// AccountCapabilityProvider resolves provider state that varies per connected
// account, permission set, or instance.
type AccountCapabilityProvider interface {
	ResolveAccountPublishingCapabilities(ctx context.Context, accessToken string, input AccountCapabilityInput) (AccountCapabilityResult, error)
}

// TokenResult is a platform-agnostic token response.
type TokenResult struct {
	AccessToken      string            `json:"access_token"`
	RefreshToken     string            `json:"refresh_token"`
	ExpiresIn        int               `json:"expires_in"`
	RefreshExpiresIn int               `json:"refresh_expires_in"`
	TokenType        string            `json:"token_type"`
	Extra            map[string]string `json:"extra"` // Platform-specific data (e.g., user ID for Threads)
}

// AuthorizationGrantDescriptor identifies the non-secret provider project and
// authorization mechanism that issued a credential. It is persisted as grant
// evidence, never used as a substitute for provider-side validation.
type AuthorizationGrantDescriptor struct {
	ProjectID     string
	ExecutionMode string
	Evidence      map[string]string
}

type AuthorizationGrantDescriber interface {
	AuthorizationGrantDescriptor() AuthorizationGrantDescriptor
}

type RefreshCredentialSource string

const (
	RefreshCredentialNone         RefreshCredentialSource = "none"
	RefreshCredentialAccessToken  RefreshCredentialSource = "access_token"
	RefreshCredentialRefreshToken RefreshCredentialSource = "refresh_token"
)

type RefreshCapability struct {
	Supported        bool
	CredentialSource RefreshCredentialSource
}

type RefreshTokenInput struct {
	AccessToken  string
	RefreshToken string
}

// Adapter is the single interface every social platform must implement.
// This eliminates switch statements across publisher, token manager, and OAuth handlers.
//
// Each platform implementation lives in its own file (x.go, mastodon.go, etc.)
// and is registered in main.go via a map[string]Adapter.
type Adapter interface {
	// Auth flow
	// GenerateAuthURL returns the OAuth authorization URL.
	// extra contains platform-specific params.
	GenerateAuthURL(state string) (authURL string, extra map[string]string)

	// ExchangeCode exchanges an authorization code for tokens.
	// extra contains platform-specific params (for example OAuth 1.0a verifier data for X or server_name for Mastodon).
	ExchangeCode(ctx context.Context, code string, extra map[string]string) (*TokenResult, error)

	// RefreshCapability declares whether a platform supports token refresh and
	// which stored credential it needs for the refresh request.
	RefreshCapability() RefreshCapability

	// RefreshToken refreshes an access token using the credential(s) declared by
	// RefreshCapability.
	RefreshToken(ctx context.Context, input RefreshTokenInput) (*TokenResult, error)

	// GetProfile fetches the authenticated user's profile.
	GetProfile(ctx context.Context, accessToken string) (*UserProfile, error)

	// Media upload — returns a platform-specific media ID (or URL for Threads).
	// The reader is consumed and should contain the raw file bytes.
	UploadMedia(ctx context.Context, accessToken, accountID, mimeType string, reader io.Reader) (string, error)

	// Publishing returns a structured acceptance result. For Bluesky,
	// ExternalID is JSON {"uri":"...","cid":"..."} for threading support.
	// For LinkedIn it is the activity URN for the first post, or comment ID for
	// replies.
	Publish(ctx context.Context, accessToken, accountID string, req *PublishRequest) (PublishResult, error)
}

type CommentAttachment struct {
	Type      string `json:"type"`
	URL       string `json:"url"`
	Name      string `json:"name,omitempty"`
	MimeType  string `json:"mime_type,omitempty"`
	Thumbnail string `json:"thumbnail,omitempty"`
	AltText   string `json:"alt_text,omitempty"`
}

type Comment struct {
	ID              string              `json:"id"`
	ParentID        string              `json:"parent_id,omitempty"`
	ConversationID  string              `json:"conversation_id,omitempty"`
	AuthorID        string              `json:"author_id,omitempty"`
	AuthorName      string              `json:"author_name,omitempty"`
	AuthorHandle    string              `json:"author_handle,omitempty"`
	AuthorAvatarURL string              `json:"author_avatar_url,omitempty"`
	Text            string              `json:"text"`
	CreatedAt       string              `json:"created_at,omitempty"`
	UpdatedAt       string              `json:"updated_at,omitempty"`
	Attachments     []CommentAttachment `json:"attachments,omitempty"`
	Deleted         bool                `json:"deleted"`
	IsOurs          bool                `json:"is_ours"`
	Hidden          bool                `json:"hidden"`
	CanReply        bool                `json:"can_reply"`
	CanHide         bool                `json:"can_hide"`
	CanDelete       bool                `json:"can_delete"`
	CanLike         bool                `json:"can_like"`
	CanUnlike       bool                `json:"can_unlike"`
	Liked           bool                `json:"liked"`
	LikeStateKnown  bool                `json:"-"`
}

type CommentAdapter interface {
	ListComments(ctx context.Context, accessToken, accountID, externalID string) ([]Comment, error)
	ReplyToComment(ctx context.Context, accessToken, accountID, commentID, message string) (string, error)
	HideComment(ctx context.Context, accessToken, accountID, commentID string) error
	DeleteComment(ctx context.Context, accessToken, accountID, commentID string) error
}

// CommentReactionAdapter is an optional provider write capability. It stays
// separate because many providers do not support reactions through their API.
type CommentReactionAdapter interface {
	LikeComment(ctx context.Context, accessToken, accountID, commentID string) error
	UnlikeComment(ctx context.Context, accessToken, accountID, commentID string) error
}

// ContentURLResolver is an optional read capability for providers whose
// opaque published IDs cannot be converted to a public URL locally. Workers
// persist the normalized URL so API page reads never call the provider.
type ContentURLResolver interface {
	ResolveContentURL(ctx context.Context, accessToken, accountID, externalID string) (string, error)
}

// MetadataMediaUploader is an optional extension for providers whose media
// upload endpoint also creates the published object and needs post metadata.
type MetadataMediaUploader interface {
	UploadMediaWithMetadata(ctx context.Context, accessToken, accountID string, req UploadMediaRequest) (string, error)
}

type MediaUploadStatus string

const (
	MediaUploadPending   MediaUploadStatus = "pending"
	MediaUploadUploading MediaUploadStatus = "uploading"
	MediaUploadUploaded  MediaUploadStatus = "uploaded"
	MediaUploadReady     MediaUploadStatus = "ready"
	MediaUploadFailed    MediaUploadStatus = "failed"
)

type MediaRetryClassification string

const (
	MediaRetryNone       MediaRetryClassification = "none"
	MediaRetrySafeResume MediaRetryClassification = "safe_resume"
	MediaRetryReconcile  MediaRetryClassification = "reconcile"
	MediaRetryTerminal   MediaRetryClassification = "terminal"
)

// MediaUploadError lets an adapter distinguish a safely resumable or
// reconcile-only outcome from a definite terminal failure without exposing
// provider response bodies or session credentials.
type MediaUploadError struct {
	RetryClassification MediaRetryClassification
	Err                 error
}

func (e *MediaUploadError) Error() string {
	if e == nil || e.Err == nil {
		return "provider media upload failed"
	}
	return e.Err.Error()
}

func (e *MediaUploadError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func MediaRetryClassificationForError(err error) (MediaRetryClassification, bool) {
	var uploadErr *MediaUploadError
	if !errors.As(err, &uploadErr) || uploadErr.RetryClassification == "" {
		return "", false
	}
	return uploadErr.RetryClassification, true
}

// ResumableMediaUploadState is the provider-neutral durable checkpoint for an
// upload. OpaqueState is decrypted only while the adapter is running and may
// contain a bearer-style session URL; callers must encrypt it at rest.
type ResumableMediaUploadState struct {
	ProviderMediaID     string
	OpaqueState         string
	UploadedBytes       int64
	TotalBytes          int64
	SessionExpiresAt    time.Time
	LastCheckedAt       time.Time
	Status              MediaUploadStatus
	RetryClassification MediaRetryClassification
}

type MediaUploadCheckpoint func(state ResumableMediaUploadState) error

// ResumableMetadataMediaUploader persists progress through checkpoint before
// returning control. On every retry it must reconcile the provider session
// before sending bytes, because the previous request may have succeeded after
// the worker lost its response.
type ResumableMetadataMediaUploader interface {
	UploadMediaResumable(
		ctx context.Context,
		accessToken, accountID string,
		req UploadMediaRequest,
		state ResumableMediaUploadState,
		checkpoint MediaUploadCheckpoint,
	) (string, error)
}

// AccountSelectionAdapter is implemented by OAuth providers that need a second
// account-selection step after authorization, such as Facebook Pages,
// Instagram Business accounts, and YouTube channels.
type AccountSelectionAdapter interface {
	ListAccountSelections(ctx context.Context, token *TokenResult) ([]AccountSelectionOption, error)
	SelectAccount(ctx context.Context, token *TokenResult, selectionID string) (*SelectedAccount, error)
}
