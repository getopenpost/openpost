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
	providerFacebook  = "facebook"
	providerInstagram = "instagram"
	providerLinkedIn  = "linkedin"
	providerMastodon  = "mastodon"
	providerTikTok    = "tiktok"
	providerThreads   = "threads"
	providerX         = "x"
	providerYouTube   = "youtube"

	// JSON field names reused across adapters.
	bskyRecordTypeField = "$type"
	jsonFieldVideo      = "video"
)
