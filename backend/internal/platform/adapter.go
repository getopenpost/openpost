package platform

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
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
}

// DirectMediaPublisher is an optional publishing extension for providers, such
// as Discord webhooks, that accept message fields and file bodies in one
// request. Readers are owned by the caller and are valid only for this call.
type DirectMediaPublisher interface {
	PublishWithMedia(ctx context.Context, accessToken, accountID string, req *PublishRequest, media []UploadMediaRequest) (string, error)
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
	AccessToken  string            `json:"access_token"`
	RefreshToken string            `json:"refresh_token"`
	ExpiresIn    int               `json:"expires_in"`
	TokenType    string            `json:"token_type"`
	Extra        map[string]string `json:"extra"` // Platform-specific data (e.g., user ID for Threads)
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

	// Publishing — returns an external ID for the published post.
	// For Bluesky this is JSON {"uri":"...","cid":"..."} for threading support.
	// For LinkedIn this is the activity URN for the first post, or comment ID for replies.
	Publish(ctx context.Context, accessToken, accountID string, req *PublishRequest) (string, error)
}

type Comment struct {
	ID              string `json:"id"`
	ParentID        string `json:"parent_id,omitempty"`
	ConversationID  string `json:"conversation_id,omitempty"`
	AuthorID        string `json:"author_id,omitempty"`
	AuthorName      string `json:"author_name,omitempty"`
	AuthorHandle    string `json:"author_handle,omitempty"`
	AuthorAvatarURL string `json:"author_avatar_url,omitempty"`
	Text            string `json:"text"`
	CreatedAt       string `json:"created_at,omitempty"`
	IsOurs          bool   `json:"is_ours"`
	Hidden          bool   `json:"hidden"`
	CanReply        bool   `json:"can_reply"`
	CanHide         bool   `json:"can_hide"`
	CanDelete       bool   `json:"can_delete"`
}

type CommentAdapter interface {
	ListComments(ctx context.Context, accessToken, accountID, externalID string) ([]Comment, error)
	ReplyToComment(ctx context.Context, accessToken, accountID, commentID, message string) (string, error)
	HideComment(ctx context.Context, accessToken, accountID, commentID string) error
	DeleteComment(ctx context.Context, accessToken, accountID, commentID string) error
}

// MetadataMediaUploader is an optional extension for providers whose media
// upload endpoint also creates the published object and needs post metadata.
type MetadataMediaUploader interface {
	UploadMediaWithMetadata(ctx context.Context, accessToken, accountID string, req UploadMediaRequest) (string, error)
}

// AccountSelectionAdapter is implemented by OAuth providers that need a second
// account-selection step after authorization, such as Facebook Pages,
// Instagram Business accounts, and YouTube channels.
type AccountSelectionAdapter interface {
	ListAccountSelections(ctx context.Context, token *TokenResult) ([]AccountSelectionOption, error)
	SelectAccount(ctx context.Context, token *TokenResult, selectionID string) (*SelectedAccount, error)
}
