package handlers

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/connectors"
	"github.com/openpost/backend/internal/platform"
	account_saver "github.com/openpost/backend/internal/services/account_saver"
	"github.com/openpost/backend/internal/services/accountavatar"
	"github.com/openpost/backend/internal/services/accountfeatures"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mastodonapps"
	"github.com/openpost/backend/internal/services/oauthstate"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/uptrace/bun"
)

const mastodonProvider = "mastodon"

const pixelfedProvider = "pixelfed"

const oauthFailureReasonFacebookNoPages = "facebook_no_pages"

const oauthFailureReasonInstagramNoPageLinkedAccount = "instagram_no_page_linked_account"

// isCompatOAuthProvider reports providers that connect through the dynamic
// Fediverse instance OAuth flow (per-instance app registration plus
// authorization code exchange).
func isCompatOAuthProvider(provider string) bool {
	return provider == mastodonProvider || provider == pixelfedProvider
}

// normalizeFediverseInstanceURL trims a user-supplied instance URL for
// credential-based Fediverse connects. OAuth instance URLs keep flowing
// through the dynamic app service, which owns their validation.
func normalizeFediverseInstanceURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", fmt.Errorf("instance_url is required")
	}
	if !strings.Contains(trimmed, "://") {
		trimmed = "https://" + trimmed
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Hostname() == "" {
		return "", fmt.Errorf("instance_url must be a valid URL")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return "", fmt.Errorf("instance_url must use http or https")
	}
	parsed.User = nil
	parsed.Path = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/"), nil
}

const pendingAccountSelectionTTL = 20 * time.Minute

const pendingSelectionRefreshExpiresAtKey = "_openpost_refresh_token_expires_at"

const lastGrantDestinationMessage = "this is the last destination for this authorization; revoke the authorization to remove it and clear its credentials"

var errLastGrantDestination = errors.New("last active oauth grant destination")

type OAuthHandler struct {
	db                           *bun.DB
	crypto                       *crypto.TokenEncryptor
	providers                    map[string]platform.Adapter
	providersMu                  sync.RWMutex
	providerRegistrars           []func(string, platform.Adapter)
	auth                         middleware.Authenticator
	disableLinkedInThreadReplies bool
	accountSaver                 *account_saver.AccountSaver
	accountFeatures              *accountfeatures.Service
	mastodonApps                 *mastodonapps.Service
	oauthStates                  *oauthstate.Store
	readiness                    *providerreadiness.Service
	connectorRegistry            *connectors.Registry
	connectorStore               *connectors.Store
	tokenSource                  AccessTokenSource
	accountAvatars               accountavatar.Cache
	blueskyPDS                   func(context.Context, string) (string, string, error)
	blueskyAdapter               func(string) blueskyLoginProvider
	// frontendURL is the absolute base URL the SPA is served from
	// (e.g. "https://openpost.example.com"). OAuth callback redirects go
	// here so they work behind reverse proxies and subpath mounts.
	frontendURL string
	telemetry   telemetry.Recorder
}

func mastodonInstanceURL(adapter platform.Adapter) string {
	provider, ok := adapter.(interface{ InstanceURL() string })
	if !ok {
		return ""
	}
	return provider.InstanceURL()
}

func NewOAuthHandler(
	db *bun.DB,
	encryptor *crypto.TokenEncryptor,
	providers map[string]platform.Adapter,
	authenticator middleware.Authenticator,
	disableLinkedInThreadReplies bool,
	frontendURL string,
) *OAuthHandler {
	providers = cloneProviderAdapters(providers)
	if xProvider, ok := providers["x"]; ok {
		if xAdapter, castOk := xProvider.(*platform.XAdapter); castOk {
			xAdapter.SetRequestStore(newXRequestStore(db, encryptor))
		}
	}

	return &OAuthHandler{
		db:                           db,
		crypto:                       encryptor,
		providers:                    providers,
		auth:                         authenticator,
		disableLinkedInThreadReplies: disableLinkedInThreadReplies,
		accountSaver:                 account_saver.NewAccountSaver(db, encryptor),
		oauthStates:                  oauthstate.NewStore(db),
		frontendURL:                  strings.TrimRight(frontendURL, "/"),
		blueskyPDS:                   platform.ResolveBlueskyPDS,
		blueskyAdapter:               func(pds string) blueskyLoginProvider { return platform.NewResolvedBlueskyAdapter(pds) },
	}
}

type blueskyLoginProvider interface {
	platform.Adapter
	PDSURL() string
	CreateSession(context.Context, string, string) (string, string, string, string, int, error)
}

// blueskyLoginAdapter targets the PDS named by the handle's DID document. It
// falls back to the configured PDS only when resolution succeeded and named
// none; a resolution failure fails the login rather than signing in against a
// server that may not hold the repository.
func (h *OAuthHandler) blueskyLoginAdapter(ctx context.Context, adapter platform.Adapter, handle string) (blueskyLoginProvider, string, error) {
	configured, ok := adapter.(blueskyLoginProvider)
	if !ok {
		return nil, "", huma.Error500InternalServerError("bluesky adapter type mismatch")
	}
	resolve := h.blueskyPDS
	if resolve == nil {
		resolve = platform.ResolveBlueskyPDS
	}
	pdsURL, resolvedDID, err := resolve(ctx, handle)
	if err != nil {
		log.Printf("[BlueskyLogin] PDS resolution failed: %v", err)
		return nil, "", huma.Error502BadGateway("could not resolve the Bluesky account's personal data server")
	}
	if pdsURL == "" {
		return configured, resolvedDID, nil
	}
	adapterFactory := h.blueskyAdapter
	if adapterFactory == nil {
		adapterFactory = func(pds string) blueskyLoginProvider { return platform.NewResolvedBlueskyAdapter(pds) }
	}
	return adapterFactory(pdsURL), resolvedDID, nil
}

// setBlueskyPDSResolver keeps DID resolution off the network in tests.
func (h *OAuthHandler) setBlueskyPDSResolver(resolve func(context.Context, string) (string, string, error)) {
	h.blueskyPDS = resolve
	h.blueskyAdapter = func(pds string) blueskyLoginProvider { return platform.NewBlueskyAdapter(pds) }
}

// provider guards reads that can race dynamic PDS registration.
func (h *OAuthHandler) provider(key string) (platform.Adapter, bool) {
	h.providersMu.RLock()
	defer h.providersMu.RUnlock()
	adapter, ok := h.providers[key]
	return adapter, ok
}

func (h *OAuthHandler) providerSnapshot() map[string]platform.Adapter {
	h.providersMu.RLock()
	defer h.providersMu.RUnlock()
	return cloneProviderAdapters(h.providers)
}

func cloneProviderAdapters(providers map[string]platform.Adapter) map[string]platform.Adapter {
	cloned := make(map[string]platform.Adapter, len(providers))
	for key, adapter := range providers {
		cloned[key] = adapter
	}
	return cloned
}

func authorizationGrantInput(adapter platform.Adapter, subject string) account_saver.AuthorizationGrantInput {
	input := account_saver.AuthorizationGrantInput{ProviderSubject: strings.TrimSpace(subject)}
	describer, ok := adapter.(platform.AuthorizationGrantDescriber)
	if !ok {
		return input
	}
	descriptor := describer.AuthorizationGrantDescriptor()
	input.ProviderProjectID = descriptor.ProjectID
	input.ExecutionMode = descriptor.ExecutionMode
	input.Evidence = descriptor.Evidence
	return input
}

func firstNonEmptyTokenValue(token *platform.TokenResult, keys ...string) string {
	if token == nil {
		return ""
	}
	for _, key := range keys {
		if value := strings.TrimSpace(token.Extra[key]); value != "" {
			return value
		}
	}
	return ""
}

func (h *OAuthHandler) SetEntitlement(entitlement entitlements.Service) {
	if h.accountSaver != nil {
		h.accountSaver.SetEntitlement(entitlement)
	}
}

func (h *OAuthHandler) SetMastodonAppService(service *mastodonapps.Service) {
	h.mastodonApps = service
}

func (h *OAuthHandler) SetProviderReadiness(service *providerreadiness.Service) {
	h.readiness = service
}

func (h *OAuthHandler) SetConnectorRegistry(registry *connectors.Registry, store *connectors.Store) {
	h.connectorRegistry = registry
	h.connectorStore = store
}

func (h *OAuthHandler) SetProviderRegistrars(registrars ...func(string, platform.Adapter)) {
	h.providerRegistrars = registrars
}

func (h *OAuthHandler) SetTelemetry(recorder telemetry.Recorder) {
	h.telemetry = recorder
}

func (h *OAuthHandler) SetAccountFeaturesService(svc *accountfeatures.Service) {
	h.accountFeatures = svc
}

func (h *OAuthHandler) SetTokenSource(source AccessTokenSource) {
	h.tokenSource = source
}

func (h *OAuthHandler) ProviderMap() map[string]platform.Adapter {
	return h.providerSnapshot()
}

type MastodonServerInfo struct {
	Name        string `json:"name" doc:"Server configuration name"`
	InstanceURL string `json:"instance_url" doc:"Mastodon instance URL"`
}

type ProviderInfo struct {
	Platform                  string                                `json:"platform" doc:"Provider key"`
	InstallationID            string                                `json:"installation_id,omitempty" doc:"Operator installation used for a custom connector"`
	DisplayName               string                                `json:"display_name" doc:"Human-readable provider name"`
	AuthMode                  string                                `json:"auth_mode" doc:"Primary connection method retained for compatibility"`
	ConnectionModes           []string                              `json:"connection_modes,omitempty" doc:"Supported distinct connection methods: oauth, app_password, oauth_oob, webhook, or bot"`
	ConfiguredConnectionModes []string                              `json:"configured_connection_modes,omitempty" doc:"Connection methods configured and ready on this instance"`
	ConnectionReadiness       map[string]providerreadiness.Decision `json:"connection_readiness,omitempty" doc:"Mode-specific readiness for providers with distinct connection methods"`
	Configured                bool                                  `json:"configured" doc:"Whether this provider can currently be connected"`
	Status                    string                                `json:"status,omitempty" doc:"Provider launch status: available, needs_configuration, or planned"`
	Description               string                                `json:"description,omitempty" doc:"Short connection or launch note for this provider"`
	Capabilities              []string                              `json:"capabilities,omitempty" doc:"High-level OpenPost capabilities available or planned for this provider"`
	Name                      string                                `json:"name,omitempty" doc:"Provider app or server display name"`
	InstanceURL               string                                `json:"instance_url,omitempty" doc:"Federated server URL, when applicable"`
	Readiness                 providerreadiness.Decision            `json:"readiness"`
}

type ListProvidersOutput struct {
	Body []ProviderInfo
}

type ListProvidersInput struct {
	WorkspaceID string `query:"workspace_id" required:"false" doc:"Workspace ID used to scope operator-installed connectors"`
}

type ListMastodonServersOutput struct {
	Body []MastodonServerInfo
}

type GetAuthURLInput struct {
	ConnectionMode string `query:"connection_mode" enum:"oauth,instagram_login" doc:"Instagram login method. Omitted or oauth uses Facebook Login; instagram_login signs in directly with Instagram."`
	Platform       string `path:"platform" doc:"Social platform (x, mastodon, bluesky, linkedin, threads, instagram, facebook, tiktok, youtube, pinterest)"`
	WorkspaceID    string `query:"workspace_id" required:"true" doc:"Workspace ID to link account to"`
	ServerName     string `query:"server_name" doc:"Mastodon server name from config (required for mastodon)"`
	InstanceURL    string `query:"instance_url" doc:"Mastodon instance URL to dynamically register"`
	Intent         string `query:"intent" enum:"production,certification_test" default:"production" doc:"Typed execution intent; certification_test requires an unscoped instance administrator"`
}

type GetAuthURLOutput struct {
	Body struct {
		URL string `json:"url" doc:"OAuth authorization URL"`
	}
}

type OAuthCallbackInput struct {
	Platform         string `path:"platform" doc:"Social platform"`
	Code             string `query:"code" doc:"OAuth authorization code" required:"false"`
	State            string `query:"state" doc:"OAuth state"`
	OAuthToken       string `query:"oauth_token" doc:"OAuth 1.0a request token (X)" required:"false"`
	Verifier         string `query:"oauth_verifier" doc:"OAuth 1.0a verifier (X)" required:"false"`
	Denied           string `query:"denied" doc:"Denied OAuth 1.0a request token (X)" required:"false"`
	ServerName       string `query:"server_name" doc:"Mastodon server name (required for mastodon)" required:"false"`
	Error            string `query:"error" doc:"OAuth error" required:"false"`
	ErrorDescription string `query:"error_description" doc:"OAuth error description" required:"false"`
}

type ExchangeCodeInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" doc:"Workspace ID"`
		ServerName  string `json:"server_name" doc:"Mastodon server name from config"`
		InstanceURL string `json:"instance_url" doc:"Mastodon instance URL to dynamically register"`
		Code        string `json:"code" doc:"Authorization code from OAuth flow"`
		Intent      string `json:"intent,omitempty" enum:"production,certification_test" doc:"Typed execution intent; certification_test requires an unscoped instance administrator"`
	}
}

type ExchangeCodeOutput struct {
	Body AccountConnectionResponse
}

type AccountConnectionResponse struct {
	WorkspaceID       string   `json:"workspace_id" doc:"Workspace receiving the connected destination"`
	AccountID         string   `json:"account_id" doc:"OpenPost destination account ID"`
	AccountIDs        []string `json:"account_ids" doc:"All connected OpenPost account IDs"`
	OpenFreshComposer bool     `json:"open_fresh_composer" doc:"Whether this is the Workspace's first connected destination"`
}

type ListAccountsInput struct {
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Filter by workspace ID"`
}

type AccountResponse struct {
	ID                     string     `json:"id" doc:"Account ID"`
	ProviderInstallationID string     `json:"provider_installation_id,omitempty" doc:"Operator connector installation used by this account"`
	Alias                  string     `json:"alias,omitempty" doc:"Internal account label. Does not change the provider identity."`
	Slug                   string     `json:"slug" doc:"User-editable account slug for CLI selectors"`
	Platform               string     `json:"platform" doc:"Platform name"`
	AccountID              string     `json:"account_id" doc:"Platform-specific account ID"`
	AccountUsername        string     `json:"account_username" doc:"Account username"`
	AccountAvatarURL       string     `json:"account_avatar_url" doc:"Account avatar URL"`
	InstanceURL            string     `json:"instance_url" doc:"Instance URL (Mastodon/Bluesky)"`
	IsActive               bool       `json:"is_active" doc:"Whether the account is active"`
	LimitProfile           string     `json:"limit_profile,omitempty" enum:"standard,x-premium" doc:"Account-specific publishing limit profile"`
	CapabilityCheckedAt    *time.Time `json:"capability_checked_at,omitempty" doc:"When account-specific publishing limits were last verified"`
	ThreadRepliesSupported bool       `json:"thread_replies_supported" doc:"Whether this account supports thread replies in current server config"`
	AccountKind            string     `json:"account_kind,omitempty" doc:"Normalized identity kind, such as person, organization, creator, or business"`
	MessagingSupported     bool       `json:"messaging_supported" deprecated:"true" doc:"Deprecated compatibility shim. Use GET /account-features for messaging availability and enabled state."`
	MessagesEnabled        bool       `json:"messages_enabled" deprecated:"true" doc:"Deprecated compatibility shim. Use GET /account-features for messaging enabled state."`
	GrantDestinationCount  int        `json:"grant_destination_count" doc:"Number of active destinations using this provider authorization"`
	SharedGrant            bool       `json:"shared_grant" doc:"Whether revoking this authorization disconnects other destinations"`
	FediverseSoftware      string     `json:"fediverse_software,omitempty" doc:"Detected Fediverse server software (mastodon, pixelfed, peertube, lemmy, piefed, or a compatible implementation)"`
}

type ListAccountsOutput struct {
	Body []AccountResponse
}

type GetAccountSelectionInput struct {
	ConnectionID string `path:"connection_id" doc:"Pending OAuth account-selection ID"`
}

type AccountSelectionResponse struct {
	ID          string                            `json:"id" doc:"Pending OAuth account-selection ID"`
	Platform    string                            `json:"platform" doc:"Social platform key"`
	WorkspaceID string                            `json:"workspace_id" doc:"Workspace ID this connection belongs to"`
	ExpiresAt   time.Time                         `json:"expires_at" doc:"When this pending selection expires"`
	Options     []platform.AccountSelectionOption `json:"options" doc:"Selectable accounts, pages, or channels"`
}

type GetAccountSelectionOutput struct {
	Body AccountSelectionResponse
}

type CompleteAccountSelectionInput struct {
	ConnectionID string `path:"connection_id" doc:"Pending OAuth account-selection ID"`
	Body         struct {
		SelectionID  string   `json:"selection_id,omitempty" doc:"Selected account, page, or channel ID. Retained for single-selection clients."`
		SelectionIDs []string `json:"selection_ids,omitempty" doc:"Selected account, Page, or organization IDs. LinkedIn supports connecting several identities from one grant."`
	}
}

type CompleteAccountSelectionOutput struct {
	Body AccountSelectionCompletionResponse
}

type AccountSelectionCompletionResponse struct {
	AccountResponse
	WorkspaceID       string   `json:"workspace_id" doc:"Workspace receiving the connected destinations"`
	AccountIDs        []string `json:"account_ids" doc:"OpenPost destination account IDs created by this selection"`
	OpenFreshComposer bool     `json:"open_fresh_composer" doc:"Whether these are the Workspace's first connected destinations"`
}

type UpdateAccountInput struct {
	AccountID string `path:"account_id"`
	Body      struct {
		Alias           *string `json:"alias,omitempty" maxLength:"100" doc:"Internal account label. An empty value clears it; omission preserves it."`
		Slug            string  `json:"slug" doc:"New account slug. Use lowercase letters, numbers, and hyphens."`
		MessagesEnabled *bool   `json:"messages_enabled,omitempty" deprecated:"true" doc:"Deprecated shim. Use POST /account-features to change messaging preference."`
	}
}

type UpdateAccountOutput struct {
	Body AccountResponse
}

type RefreshAccountMetadataInput struct {
	AccountID string `path:"account_id" doc:"OpenPost account ID"`
}

type RefreshAccountMetadataOutput struct {
	Body AccountResponse
}

var accountSlugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

const (
	providerStatusAvailable          = "available"
	providerStatusNeedsConfiguration = "needs_configuration"
	providerStatusPlanned            = "planned"
)

var coreProviderCapabilities = []string{"Text posts", "Media posts", "Scheduling", "Platform variants", "MCP workflows"}

// Curated connection-picker order: mainstream networks first, niche providers last.
var providerCatalog = []ProviderInfo{
	{
		Platform:        "instagram",
		DisplayName:     "Instagram",
		AuthMode:        "oauth",
		ConnectionModes: []string{platform.ConnectionModeInstagramLogin, platform.ConnectionModeOAuth},
		Description:     "Connect a Business or Creator account directly with Instagram or through a linked Facebook Page.",
		Capabilities:    []string{"Images", "Reels", "Scheduling", "Platform variants", "MCP workflows"},
	},
	{
		Platform:     "facebook",
		DisplayName:  "Facebook",
		AuthMode:     "oauth",
		Description:  "Meta OAuth connection for Facebook Pages publishing.",
		Capabilities: []string{"Page posts", "Media posts", "Scheduling", "Platform variants", "MCP workflows"},
	},
	{
		Platform:     "youtube",
		DisplayName:  "YouTube",
		AuthMode:     "oauth",
		Description:  "Google OAuth connection for YouTube video and Shorts uploads.",
		Capabilities: []string{"Shorts", "Video uploads", "Scheduling", "Platform variants", "MCP workflows"},
	},
	{
		Platform:     "tiktok",
		DisplayName:  "TikTok",
		AuthMode:     "oauth",
		Description:  "OAuth app connection for TikTok videos and photo posts.",
		Capabilities: []string{"Short videos", "Photo posts", "Scheduling", "Platform variants", "MCP workflows"},
	},
	{
		Platform:     "linkedin",
		DisplayName:  "LinkedIn",
		AuthMode:     "oauth",
		Description:  "OAuth app connection for LinkedIn profile and organization publishing.",
		Capabilities: coreProviderCapabilities,
	},
	{
		Platform:     "x",
		DisplayName:  "X (Twitter)",
		AuthMode:     "oauth",
		Description:  "OAuth app connection for X publishing and threads.",
		Capabilities: coreProviderCapabilities,
	},
	{
		Platform:     "threads",
		DisplayName:  "Threads",
		AuthMode:     "oauth",
		Description:  "Meta OAuth connection with public media URL requirements.",
		Capabilities: coreProviderCapabilities,
	},
	{
		Platform:        "bluesky",
		DisplayName:     "Bluesky",
		AuthMode:        "app_password",
		ConnectionModes: []string{"app_password"},
		Description:     "Handle and app-password connection with no server app setup.",
		Capabilities:    coreProviderCapabilities,
	},
	{
		Platform:        "pinterest",
		DisplayName:     "Pinterest",
		AuthMode:        "oauth",
		ConnectionModes: []string{"oauth"},
		Description:     "Trial access supports development and certification; production requires current Standard access and live certification.",
		Capabilities:    []string{"Board targeting", "Optional board sections"},
	},
	{
		Platform:        "telegram",
		DisplayName:     "Telegram",
		AuthMode:        "bot",
		ConnectionModes: []string{"bot"},
		Description:     "Connect a bot to post in Telegram channels and groups.",
	},
	{
		Platform:        "discord",
		DisplayName:     "Discord",
		AuthMode:        "webhook",
		ConnectionModes: []string{"webhook", "bot"},
		Description:     "Post to a channel with a bot, or connect a webhook for a fixed destination.",
		Capabilities:    []string{"Text posts", "Media attachments", "Scheduling", "Message deletion", "MCP workflows"},
	},
	{
		Platform:     "googlebusiness",
		DisplayName:  "Google Business",
		AuthMode:     "oauth",
		Description:  "Google OAuth connection for Business Profile local posts; location selection and publishing require Google API access and current live certification.",
		Capabilities: []string{"Location selection", "Local posts", "Scheduling", "Platform variants", "MCP workflows"},
	},
	{
		Platform:     mastodonProvider,
		DisplayName:  "Mastodon",
		AuthMode:     "oauth_oob",
		Description:  "Per-instance OAuth connection, including custom public instances.",
		Capabilities: coreProviderCapabilities,
	},
	{
		Platform:     pixelfedProvider,
		DisplayName:  "Pixelfed",
		AuthMode:     "oauth_oob",
		Description:  "Per-instance OAuth connection for photo publishing, including custom instances.",
		Capabilities: []string{"Photo posts", "Albums", "Scheduling", "Platform variants", "MCP workflows"},
	},
	{
		Platform:        "peertube",
		DisplayName:     "PeerTube",
		AuthMode:        "app_password",
		ConnectionModes: []string{"app_password"},
		Description:     "Instance username and password with channel selection for video publishing.",
		Capabilities:    []string{"Video uploads", "Channels", "Scheduling", "Platform variants", "MCP workflows"},
	},
	{
		Platform:        "lemmy",
		DisplayName:     "Lemmy",
		AuthMode:        "app_password",
		ConnectionModes: []string{"app_password"},
		Description:     "Instance username and password for community discussions and links.",
		Capabilities:    []string{"Community posts", "Comments", "Scheduling", "Platform variants", "MCP workflows"},
	},
	{
		Platform:        "piefed",
		DisplayName:     "PieFed",
		AuthMode:        "app_password",
		ConnectionModes: []string{"app_password"},
		Description:     "Instance username and password for community discussions and links.",
		Capabilities:    []string{"Community posts", "Comments", "Scheduling", "Platform variants", "MCP workflows"},
	},
	{
		Platform:        "devnull",
		DisplayName:     "dev/null",
		AuthMode:        "ssh_signature",
		ConnectionModes: []string{"ssh_signature"},
		Description:     "Username and SSH key connection; commits are signed with the key on your GitHub account.",
		Capabilities:    []string{"Text posts", "Image posts", "Replies", "Scheduling", "MCP workflows"},
	},
}
