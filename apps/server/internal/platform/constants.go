package platform

const (
	headerAuthorization    = "Authorization"
	headerContentType      = "Content-Type"
	bearerPrefix           = "Bearer "
	tokenTypeBearer        = "Bearer"
	contentTypeJSON        = "application/json"
	contentTypeForm        = "application/x-www-form-urlencoded"
	contentTypeOctet       = "application/octet-stream"
	jsonFieldText          = "text"
	platformStatusFailed   = "FAILED"
	oauthResponseType      = "code"
	oauthGrantAuthCode     = "authorization_code"
	oauthGrantRefresh      = "refresh_token"
	oauthParamAccessToken  = "access_token"
	oauthParamClientID     = "client_id"
	oauthParamClientSecret = "client_secret"
	oauthParamCode         = "code"
	oauthParamRedirectURI  = "redirect_uri"
	grantType              = "grant_type"
	videoTypeMP4           = "video/mp4"

	// MediaValidationIssue.Severity values. These must match the JSON
	// schema consumed by the frontend.
	severityError   = "error"
	severityWarning = "warning"

	// MediaValidationIssue.Provider values. These must match the
	// canonical provider keys (see AGENTS.md "Provider Key Convention")
	// and the entries in RegisterAllMediaValidators().
	providerBluesky   = "bluesky"
	providerDiscord   = "discord"
	providerFacebook  = "facebook"
	providerInstagram = "instagram"
	providerLinkedIn  = "linkedin"
	providerMastodon  = "mastodon"
	providerPixelfed  = "pixelfed"
	providerPeerTube  = "peertube"
	providerLemmy     = "lemmy"
	providerPieFed    = "piefed"
	providerPinterest = "pinterest"
	providerTelegram  = "telegram"
	providerTikTok    = "tiktok"
	providerThreads   = "threads"
	providerX         = "x"
	providerYouTube   = "youtube"

	// JSON field names reused across adapters.
	bskyRecordTypeField = "$type"
	jsonFieldVideo      = "video"
)

// PublicProviders returns the canonical public-provider catalogue: every
// first-party provider key that product surfaces (including product
// telemetry) may carry. It mirrors the provider constants above without
// exposing private or operator-installed connector names.
func PublicProviders() []string {
	return []string{
		providerBluesky,
		providerDiscord,
		providerFacebook,
		providerInstagram,
		providerLemmy,
		providerLinkedIn,
		providerMastodon,
		providerPeerTube,
		providerPieFed,
		providerPinterest,
		providerPixelfed,
		providerTelegram,
		providerThreads,
		providerTikTok,
		providerX,
		providerYouTube,
	}
}
