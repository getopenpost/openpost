package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/connectors"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	account_saver "github.com/openpost/backend/internal/services/account_saver"
	"github.com/openpost/backend/internal/services/accountavatar"
	"github.com/openpost/backend/internal/services/accountfeatures"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mastodonapps"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/oauthstate"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/uptrace/bun"
)

const mastodonProvider = "mastodon"
const pixelfedProvider = "pixelfed"
const oauthFailureReasonFacebookNoPages = "facebook_no_pages"

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
	accountAvatars               accountAvatarCache
	blueskyPDS                   func(context.Context, string) (string, string, error)
	blueskyAdapter               func(string) *platform.BlueskyAdapter
	// frontendURL is the absolute base URL the SPA is served from
	// (e.g. "https://openpost.example.com"). OAuth callback redirects go
	// here so they work behind reverse proxies and subpath mounts.
	frontendURL string
	telemetry   telemetry.Recorder
}

type accountAvatarCache interface {
	CacheLinkedIn(context.Context, string, string) (string, error)
	Delete(context.Context, string) error
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
		blueskyAdapter:               platform.NewResolvedBlueskyAdapter,
	}
}

// blueskyLoginAdapter targets the PDS named by the handle's DID document. It
// falls back to the configured PDS only when resolution succeeded and named
// none; a resolution failure fails the login rather than signing in against a
// server that may not hold the repository.
func (h *OAuthHandler) blueskyLoginAdapter(ctx context.Context, adapter platform.Adapter, handle string) (*platform.BlueskyAdapter, string, error) {
	configured, ok := adapter.(*platform.BlueskyAdapter)
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
		adapterFactory = platform.NewResolvedBlueskyAdapter
	}
	return adapterFactory(pdsURL), resolvedDID, nil
}

// setBlueskyPDSResolver keeps DID resolution off the network in tests.
func (h *OAuthHandler) setBlueskyPDSResolver(resolve func(context.Context, string) (string, string, error)) {
	h.blueskyPDS = resolve
	h.blueskyAdapter = platform.NewBlueskyAdapter
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
	Platform    string `path:"platform" doc:"Social platform (x, mastodon, bluesky, linkedin, threads, instagram, facebook, tiktok, youtube, pinterest)"`
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID to link account to"`
	ServerName  string `query:"server_name" doc:"Mastodon server name from config (required for mastodon)"`
	InstanceURL string `query:"instance_url" doc:"Mastodon instance URL to dynamically register"`
	Intent      string `query:"intent" enum:"production,certification_test" default:"production" doc:"Typed execution intent; certification_test requires an unscoped instance administrator"`
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
		Slug            string `json:"slug" doc:"New account slug. Use lowercase letters, numbers, and hyphens."`
		MessagesEnabled *bool  `json:"messages_enabled,omitempty" deprecated:"true" doc:"Deprecated shim. Use POST /account-features to change messaging preference."`
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

var providerCatalog = []ProviderInfo{
	{
		Platform:        "bluesky",
		DisplayName:     "Bluesky",
		AuthMode:        "app_password",
		ConnectionModes: []string{"app_password"},
		Description:     "Handle and app-password connection with no server app setup.",
		Capabilities:    coreProviderCapabilities,
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
		Platform:     "x",
		DisplayName:  "X (Twitter)",
		AuthMode:     "oauth",
		Description:  "OAuth app connection for X publishing and threads.",
		Capabilities: coreProviderCapabilities,
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
		Platform:     "linkedin",
		DisplayName:  "LinkedIn",
		AuthMode:     "oauth",
		Description:  "OAuth app connection for LinkedIn profile and organization publishing.",
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
		Platform:     "instagram",
		DisplayName:  "Instagram",
		AuthMode:     "oauth",
		Description:  "Meta OAuth connection for Instagram Business and Creator publishing.",
		Capabilities: []string{"Images", "Reels", "Scheduling", "Platform variants", "MCP workflows"},
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
}

func (h *OAuthHandler) getProvider(platform, serverName string) (platform.Adapter, error) {
	if isCompatOAuthProvider(platform) {
		if serverName == "" {
			return nil, fmt.Errorf("server_name required for %s", platform)
		}
		key := platform + ":" + serverName
		adapter, ok := h.provider(key)
		if !ok {
			return nil, fmt.Errorf("unknown %s server: %s", platform, serverName)
		}
		return adapter, nil
	}

	key := platform
	if platform == "discord" {
		key = "discord:bot"
	}
	adapter, ok := h.provider(key)
	if !ok {
		return nil, fmt.Errorf("unsupported platform: %s", platform)
	}
	return adapter, nil
}

func (h *OAuthHandler) getMastodonProvider(ctx context.Context, serverName, instanceURL string) (platform.Adapter, string, error) {
	return h.getCompatProvider(ctx, mastodonProvider, serverName, instanceURL)
}

func (h *OAuthHandler) getCompatProvider(ctx context.Context, provider, serverName, instanceURL string) (platform.Adapter, string, error) {
	if strings.TrimSpace(instanceURL) != "" {
		return h.getDynamicCompatProvider(ctx, provider, instanceURL)
	}
	adapter, err := h.getProvider(provider, serverName)
	if err == nil {
		return adapter, mastodonInstanceURL(adapter), nil
	}
	if strings.Contains(serverName, "://") {
		requestedInstanceURL := strings.TrimRight(strings.TrimSpace(serverName), "/")
		for key, candidate := range h.providerSnapshot() {
			if !strings.HasPrefix(key, provider+":") {
				continue
			}
			if configuredInstanceURL := strings.TrimRight(mastodonInstanceURL(candidate), "/"); configuredInstanceURL == requestedInstanceURL {
				return candidate, configuredInstanceURL, nil
			}
		}
	}
	if h.mastodonApps != nil && strings.Contains(serverName, "://") {
		return h.getDynamicCompatProvider(ctx, provider, serverName)
	}
	return nil, "", err
}

func (h *OAuthHandler) getDynamicCompatProvider(ctx context.Context, provider, instanceURL string) (platform.Adapter, string, error) {
	if h.mastodonApps == nil {
		return nil, "", fmt.Errorf("dynamic %s instance registration is not configured", provider)
	}
	adapter, canonicalURL, err := h.mastodonApps.AdapterForInstance(ctx, provider, instanceURL)
	if err != nil {
		return nil, "", err
	}
	h.registerProvider(provider+":"+canonicalURL, adapter)
	if h.readiness != nil {
		configs, listErr := h.mastodonApps.ListActiveAppConfigs(ctx)
		if listErr != nil {
			return nil, "", fmt.Errorf("load dynamic %s readiness configuration: %w", provider, listErr)
		}
		for _, config := range configs {
			if strings.TrimRight(config.InstanceURL, "/") != canonicalURL {
				continue
			}
			if registerErr := h.readiness.RegisterRuntimeApp(providerreadiness.RuntimeApp{
				Config:              config,
				Source:              providerreadiness.ConfigurationSourceDynamic,
				ProviderEnvironment: h.readiness.ProviderEnvironment(),
			}); registerErr != nil {
				return nil, "", fmt.Errorf("register dynamic %s readiness configuration: %w", provider, registerErr)
			}
			break
		}
	}
	return adapter, canonicalURL, nil
}

func (h *OAuthHandler) registerProvider(key string, adapter platform.Adapter) {
	h.providersMu.Lock()
	if h.providers == nil {
		h.providers = map[string]platform.Adapter{}
	}
	h.providers[key] = adapter
	h.providersMu.Unlock()
	for _, registrar := range h.providerRegistrars {
		if registrar != nil {
			registrar(key, adapter)
		}
	}
}

func (h *OAuthHandler) isDynamicMastodonConfigured() bool {
	return h.mastodonApps != nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func selectedAccountInstanceURL(provider string, values ...string) string {
	if provider == "discord" {
		return ""
	}
	return firstNonEmpty(values...)
}

// fediverseCapabilityState records the detected server software alongside a
// connected Fediverse account so the account picker can name the software
// the user actually uses. Detection is connect-time only and never gates
// publishing, which always validates against advertised configuration.
func (h *OAuthHandler) fediverseCapabilityState(ctx context.Context, platformName, instanceURL string, profile *platform.UserProfile) map[string]string {
	state := map[string]string{}
	if profile != nil {
		for key, value := range profile.CapabilityState {
			state[key] = value
		}
	}
	if platformName != mastodonProvider && platformName != pixelfedProvider {
		return state
	}
	if strings.TrimSpace(state["fediverse_software"]) != "" || strings.TrimSpace(instanceURL) == "" {
		return state
	}
	if software := platform.DetectFediverseSoftware(ctx, instanceURL); software != platform.FediverseSoftwareUnknown {
		state["fediverse_software"] = string(software)
	}
	return state
}

func (h *OAuthHandler) ListProviders(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-account-providers",
		Method:      http.MethodGet,
		Path:        "/accounts/providers",
		Summary:     "List configured account providers",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *ListProvidersInput) (*ListProvidersOutput, error) {
		infos := h.providerAvailability(ctx)
		if input.WorkspaceID != "" {
			if err := h.checkWorkspaceAccess(ctx, input.WorkspaceID, middleware.GetUserID(ctx)); err != nil {
				return nil, err
			}
			infos = append(infos, h.connectorProviderAvailability(input.WorkspaceID)...)
		}
		return &ListProvidersOutput{Body: infos}, nil
	})
}

func (h *OAuthHandler) providerAvailability(contexts ...context.Context) []ProviderInfo {
	infos := providerAvailability(h.providerSnapshot(), h.isDynamicMastodonConfigured())
	ctx := context.Background()
	if len(contexts) > 0 && contexts[0] != nil {
		ctx = contexts[0]
	}
	return applyProviderAvailabilityReadiness(ctx, h.readiness, infos)
}

func applyProviderAvailabilityReadiness(
	ctx context.Context,
	readiness *providerreadiness.Service,
	infos []ProviderInfo,
) []ProviderInfo {
	if readiness == nil {
		for index := range infos {
			infos[index].Readiness = providerreadiness.UnavailableDecision(providerreadiness.OperationConnect)
			infos[index].Configured = false
			if infos[index].Platform == "discord" {
				infos[index].ConnectionReadiness = map[string]providerreadiness.Decision{
					platform.ConnectionModeWebhook: providerreadiness.UnavailableDecision(providerreadiness.OperationConnect),
					platform.ConnectionModeBot:     providerreadiness.UnavailableDecision(providerreadiness.OperationConnect),
				}
			}
			if infos[index].Status != providerStatusPlanned {
				infos[index].Status = string(providerreadiness.EffectiveStateDegraded)
			}
		}
		return infos
	}
	for index := range infos {
		if infos[index].Status == providerStatusPlanned {
			infos[index].Readiness = providerreadiness.UnavailableDecision(providerreadiness.OperationConnect)
			infos[index].Configured = false
			continue
		}
		decision := readiness.DecideConnection(
			ctx,
			infos[index].Platform,
			infos[index].InstanceURL,
			providerreadiness.ExecutionIntentProduction,
		)
		if infos[index].Platform == "discord" {
			webhookDecision := decision
			botDecision := readiness.DecideConnection(ctx, "discord", platform.ConnectionModeBot, providerreadiness.ExecutionIntentProduction)
			infos[index].ConnectionReadiness = map[string]providerreadiness.Decision{
				platform.ConnectionModeWebhook: webhookDecision,
				platform.ConnectionModeBot:     botDecision,
			}
			infos[index].ConfiguredConnectionModes = nil
			if webhookDecision.Connectable {
				infos[index].ConfiguredConnectionModes = append(infos[index].ConfiguredConnectionModes, platform.ConnectionModeWebhook)
			}
			if botDecision.Connectable {
				infos[index].ConfiguredConnectionModes = append(infos[index].ConfiguredConnectionModes, platform.ConnectionModeBot)
			}
		}
		infos[index].Readiness = decision
		infos[index].Configured = decision.Connectable
		infos[index].Status = string(decision.State)
		if decision.Connectable {
			infos[index].Status = providerStatusAvailable
		}
	}
	return infos
}

func providerAvailability(providers map[string]platform.Adapter, dynamicMastodonConfigured bool) []ProviderInfo {
	infos := make([]ProviderInfo, 0, len(providerCatalog))
	for _, item := range providerCatalog {
		if isCompatOAuthProvider(item.Platform) {
			compatProviders := compatProviderAvailability(providers, item.Platform, dynamicMastodonConfigured)
			infos = append(infos, compatProviders...)
			continue
		}
		item = providerInfoWithStatus(providers, item)
		infos = append(infos, item)
	}
	return infos
}

func providerInfoWithStatus(providers map[string]platform.Adapter, item ProviderInfo) ProviderInfo {
	if item.Status == providerStatusPlanned {
		item.Configured = false
		return item
	}
	item.Configured = providers[item.Platform] != nil
	if item.Platform == "discord" {
		if providers["discord:"+platform.ConnectionModeWebhook] != nil || providers["discord"] != nil {
			item.ConfiguredConnectionModes = append(item.ConfiguredConnectionModes, platform.ConnectionModeWebhook)
		}
		if providers["discord:"+platform.ConnectionModeBot] != nil {
			item.ConfiguredConnectionModes = append(item.ConfiguredConnectionModes, platform.ConnectionModeBot)
		}
	}
	if item.Configured {
		item.Status = providerStatusAvailable
	} else {
		item.Status = providerStatusNeedsConfiguration
	}
	return item
}

func compatProviderDisplayName(provider string) string {
	if provider == pixelfedProvider {
		return "Pixelfed"
	}
	return "Mastodon"
}

func compatProviderAvailability(providers map[string]platform.Adapter, provider string, dynamicMastodonConfigured bool) []ProviderInfo {
	displayName := compatProviderDisplayName(provider)
	servers := configuredCompatServers(providers, provider)
	if len(servers) == 0 {
		if dynamicMastodonConfigured {
			return []ProviderInfo{dynamicCompatInfo(provider)}
		}
		return []ProviderInfo{{
			Platform:    provider,
			DisplayName: displayName,
			AuthMode:    "oauth_oob",
			Configured:  false,
			Status:      providerStatusNeedsConfiguration,
			Description: "Configure " + displayName + " servers or dynamic instance registration before connecting.",
		}}
	}

	infos := make([]ProviderInfo, 0, len(servers)+1)
	if dynamicMastodonConfigured {
		infos = append(infos, dynamicCompatInfo(provider))
	}
	for _, server := range servers {
		infos = append(infos, ProviderInfo{
			Platform:     provider,
			DisplayName:  displayName,
			AuthMode:     "oauth_oob",
			Configured:   true,
			Status:       providerStatusAvailable,
			Description:  "Connect this configured " + displayName + " instance.",
			Capabilities: coreProviderCapabilities,
			Name:         server.Name,
			InstanceURL:  server.InstanceURL,
		})
	}
	return infos
}

func dynamicCompatInfo(provider string) ProviderInfo {
	displayName := compatProviderDisplayName(provider)
	return ProviderInfo{
		Platform:     provider,
		DisplayName:  displayName,
		AuthMode:     "oauth_oob",
		Configured:   true,
		Status:       providerStatusAvailable,
		Description:  "Connect any public " + displayName + " instance.",
		Capabilities: coreProviderCapabilities,
		Name:         "Custom instance",
	}
}

func (h *OAuthHandler) configuredMastodonServers() []MastodonServerInfo {
	return configuredCompatServers(h.providerSnapshot(), mastodonProvider)
}

func configuredCompatServers(providers map[string]platform.Adapter, provider string) []MastodonServerInfo {
	var servers []MastodonServerInfo
	seen := make(map[string]struct{})
	for key, adapter := range providers {
		if !strings.HasPrefix(key, provider+":") {
			continue
		}
		instanceURL := mastodonInstanceURL(adapter)
		if instanceURL == "" {
			continue
		}
		name := strings.TrimPrefix(key, provider+":")
		if name == instanceURL {
			continue
		}
		if _, ok := seen[instanceURL]; ok {
			continue
		}
		seen[instanceURL] = struct{}{}
		servers = append(servers, MastodonServerInfo{
			Name:        name,
			InstanceURL: instanceURL,
		})
	}
	return servers
}

func (h *OAuthHandler) ListMastodonServers(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-mastodon-servers",
		Method:      http.MethodGet,
		Path:        "/accounts/mastodon/servers",
		Summary:     "List configured Mastodon servers",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(_ context.Context, _ *struct{}) (*ListMastodonServersOutput, error) {
		return &ListMastodonServersOutput{Body: h.configuredMastodonServers()}, nil
	})
}

func (h *OAuthHandler) ListPixelfedServers(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-pixelfed-servers",
		Method:      http.MethodGet,
		Path:        "/accounts/pixelfed/servers",
		Summary:     "List configured Pixelfed servers",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(_ context.Context, _ *struct{}) (*ListPixelfedServersOutput, error) {
		return &ListPixelfedServersOutput{Body: configuredCompatServers(h.providerSnapshot(), pixelfedProvider)}, nil
	})
}

type ListPixelfedServersOutput struct {
	Body []MastodonServerInfo
}

func (h *OAuthHandler) ensureCanStartAccountConnection(ctx context.Context, workspaceID, userID string) error {
	if err := h.checkWorkspaceEditAccess(ctx, workspaceID, userID); err != nil {
		return err
	}
	if err := h.accountSaver.CheckSocialAccountQuota(ctx, middleware.GetUserID(ctx), workspaceID); err != nil {
		return huma.Error403Forbidden(accountConnectionErrorMessage(err))
	}
	return nil
}

func (h *OAuthHandler) connectionIntent(ctx context.Context, raw string) (providerreadiness.ExecutionIntent, error) {
	switch providerreadiness.ExecutionIntent(strings.TrimSpace(raw)) {
	case "", providerreadiness.ExecutionIntentProduction:
		return providerreadiness.ExecutionIntentProduction, nil
	case providerreadiness.ExecutionIntentCertificationTest:
		if err := requireUnscopedInstanceAdmin(ctx, h.db); err != nil {
			return "", err
		}
		return providerreadiness.ExecutionIntentCertificationTest, nil
	default:
		return "", huma.Error400BadRequest("invalid provider readiness execution intent")
	}
}

func (h *OAuthHandler) persistedConnectionIntent(
	ctx context.Context,
	raw, userID string,
) (providerreadiness.ExecutionIntent, error) {
	intent := providerreadiness.ExecutionIntent(strings.TrimSpace(raw))
	switch intent {
	case providerreadiness.ExecutionIntentProduction:
		return intent, nil
	case providerreadiness.ExecutionIntentCertificationTest:
		if strings.TrimSpace(userID) == "" {
			return "", huma.Error403Forbidden("provider certification initiator is unavailable")
		}
		var isAdmin bool
		if err := h.db.NewSelect().
			Model((*models.User)(nil)).
			Column("is_admin").
			Where("id = ?", userID).
			Scan(ctx, &isAdmin); err != nil {
			return "", huma.Error403Forbidden("provider certification initiator is unavailable")
		}
		if !isAdmin {
			return "", huma.Error403Forbidden("provider certification requires a current instance administrator")
		}
		return intent, nil
	default:
		return "", huma.Error409Conflict("invalid or expired provider readiness execution intent")
	}
}

func (h *OAuthHandler) requireProviderConnectionCompletion(
	ctx context.Context,
	provider, instanceURL, rawIntent, userID string,
) error {
	intent, err := h.persistedConnectionIntent(ctx, rawIntent, userID)
	if err != nil {
		return err
	}
	return h.requireProviderConnection(ctx, provider, instanceURL, intent)
}

func (h *OAuthHandler) requireProviderConnection(
	ctx context.Context,
	provider, instanceURL string,
	intent providerreadiness.ExecutionIntent,
) error {
	if h.readiness == nil {
		return huma.Error409Conflict((&providerreadiness.NotReadyError{
			Decision: providerreadiness.UnavailableDecision(providerreadiness.OperationConnect),
		}).Error())
	}
	decision := h.readiness.DecideConnection(ctx, provider, instanceURL, intent)
	if decision.Connectable {
		return nil
	}
	return huma.Error409Conflict((&providerreadiness.NotReadyError{Decision: decision}).Error())
}

func (h *OAuthHandler) GetAuthURL(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-auth-url",
		Method:      http.MethodGet,
		Path:        "/accounts/{platform}/auth-url",
		Summary:     "Get OAuth authorization URL for a platform",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 409},
	}, func(ctx context.Context, input *GetAuthURLInput) (*GetAuthURLOutput, error) {
		if input.Platform == "bluesky" {
			return nil, huma.Error400BadRequest("bluesky uses app passwords, not OAuth redirect")
		}
		if input.WorkspaceID == "" {
			return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
		}

		userID := middleware.GetUserID(ctx)
		intent, err := h.connectionIntent(ctx, input.Intent)
		if err != nil {
			return nil, err
		}
		if err := h.ensureCanStartAccountConnection(ctx, input.WorkspaceID, userID); err != nil {
			return nil, err
		}

		adapter, serverNameForState, err := h.authURLProvider(ctx, input)
		if err != nil {
			return nil, err
		}
		if err := h.requireProviderConnection(ctx, input.Platform, serverNameForState, intent); err != nil {
			return nil, err
		}
		return h.generateProviderAuthURL(ctx, input, userID, adapter, serverNameForState, intent)
	})
}

func (h *OAuthHandler) authURLProvider(
	ctx context.Context,
	input *GetAuthURLInput,
) (platform.Adapter, string, error) {
	if isCompatOAuthProvider(input.Platform) {
		if input.ServerName == "" && input.InstanceURL == "" {
			return nil, "", huma.Error400BadRequest(fmt.Sprintf("server_name or instance_url required for %s", input.Platform))
		}
		adapter, instanceURL, err := h.getCompatProvider(ctx, input.Platform, input.ServerName, input.InstanceURL)
		if err != nil {
			return nil, "", huma.Error400BadRequest(err.Error())
		}
		return adapter, instanceURL, nil
	}
	adapter, err := h.getProvider(input.Platform, input.ServerName)
	if err != nil {
		return nil, "", huma.Error400BadRequest(err.Error())
	}
	if input.Platform == "discord" {
		return adapter, platform.ConnectionModeBot, nil
	}
	return adapter, "", nil
}

func (h *OAuthHandler) generateProviderAuthURL(
	ctx context.Context,
	input *GetAuthURLInput,
	userID string,
	adapter platform.Adapter,
	serverNameForState string,
	intent providerreadiness.ExecutionIntent,
) (*GetAuthURLOutput, error) {
	if input.Platform == "x" {
		return generateXAuthURL(input, userID, adapter, intent)
	}
	state, err := h.oauthStates.Create(ctx, oauthstate.Payload{
		UserID: userID, WorkspaceID: input.WorkspaceID, Platform: input.Platform,
		ServerName: firstNonEmpty(serverNameForState, input.ServerName), ExecutionIntent: string(intent),
	})
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to create oauth state")
	}
	authURL, _ := adapter.GenerateAuthURL(state)
	if authURL == "" {
		return nil, huma.Error400BadRequest(fmt.Sprintf("%s does not support OAuth redirect", input.Platform))
	}
	resp := &GetAuthURLOutput{}
	resp.Body.URL = authURL
	return resp, nil
}

func generateXAuthURL(
	input *GetAuthURLInput,
	userID string,
	adapter platform.Adapter,
	intent providerreadiness.ExecutionIntent,
) (*GetAuthURLOutput, error) {
	xAdapter, ok := adapter.(*platform.XAdapter)
	if !ok {
		return nil, huma.Error500InternalServerError("x adapter type mismatch")
	}
	authURL, err := xAdapter.GenerateAuthURLWithIntent(userID, input.WorkspaceID, string(intent))
	if err != nil {
		log.Printf("[X OAuth] auth url generation failed: %v", err)
		return nil, huma.Error400BadRequest(fmt.Sprintf("x auth url generation failed: %s", err.Error()))
	}
	resp := &GetAuthURLOutput{}
	resp.Body.URL = authURL
	return resp, nil
}

//nolint:gocyclo
func (h *OAuthHandler) Callback(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "oauth-callback",
		Method:      http.MethodGet,
		Path:        "/accounts/{platform}/callback",
		Summary:     "Handle OAuth callback from provider",
		Tags:        []string{tagAccounts},
		Errors:      []int{400},
		Hidden:      true,
	}, func(ctx context.Context, input *OAuthCallbackInput) (*huma.StreamResponse, error) {
		if resp, err := h.oauthCallbackDenialResponse(ctx, input); err != nil || resp != nil {
			return resp, err
		}
		session, resp, err := h.resolveOAuthCallbackSession(ctx, input)
		if err != nil || resp != nil {
			return resp, err
		}
		if resp, err := h.resolveOAuthCallbackAdapter(ctx, input, session); err != nil || resp != nil {
			return resp, err
		}
		return h.finishOAuthCallback(ctx, input, session)
	})
}

func (h *OAuthHandler) finishOAuthCallback(ctx context.Context, input *OAuthCallbackInput, session *oauthCallbackSession) (*huma.StreamResponse, error) {
	if err := h.requireProviderConnectionCompletion(
		ctx, input.Platform, session.instanceRef, session.executionIntent, session.userID,
	); err != nil {
		return h.redirectWithError(err.Error(), session.workspaceID)
	}

	tokenResp, err := session.adapter.ExchangeCode(ctx, input.Code, session.extra)
	if err != nil {
		return h.redirectWithError(fmt.Sprintf("token exchange failed: %s", err.Error()), session.workspaceID)
	}

	if err := h.requireProviderConnectionCompletion(
		ctx, input.Platform, session.instanceRef, session.executionIntent, session.userID,
	); err != nil {
		return h.redirectWithError(err.Error(), session.workspaceID)
	}

	if selector, ok := session.adapter.(platform.AccountSelectionAdapter); ok {
		if profile, profileErr := session.adapter.GetProfile(ctx, tokenResp.AccessToken); profileErr == nil && profile != nil && profile.ID != "" {
			if tokenResp.Extra == nil {
				tokenResp.Extra = map[string]string{}
			}
			tokenResp.Extra["_grant_subject"] = profile.ID
		}
		return h.saveAccountSelectionAndRedirect(
			ctx, session.userID, input.Platform, session.workspaceID, session.instanceRef,
			session.executionIntent, tokenResp, selector,
		)
	}

	profile, err := session.adapter.GetProfile(ctx, tokenResp.AccessToken)
	if err != nil {
		if isCompatOAuthProvider(input.Platform) {
			profile = &platform.UserProfile{ID: input.Platform + "-user", Username: ""}
		} else {
			return h.redirectWithError(fmt.Sprintf("failed to get profile: %s", err.Error()), session.workspaceID)
		}
	}

	return h.saveAccountAndRedirect(
		ctx, session.userID, input.Platform, session.workspaceID, session.instanceRef, session.executionIntent,
		profile, tokenResp, session.adapter,
	)
}

func (h *OAuthHandler) oauthCallbackDenialResponse(ctx context.Context, input *OAuthCallbackInput) (*huma.StreamResponse, error) {
	if input.Platform == "x" && input.Denied != "" {
		input.OAuthToken = input.Denied
		workspaceID := h.callbackErrorWorkspace(ctx, input)
		return h.redirectWithError("access_denied", workspaceID)
	}
	if input.Error != "" {
		msg := input.Error
		if input.ErrorDescription != "" {
			msg = fmt.Sprintf("%s: %s", input.Error, input.ErrorDescription)
		}
		log.Printf("[OAuth Callback Error] %s", msg)
		workspaceID := h.callbackErrorWorkspace(ctx, input)
		return h.redirectWithError(input.Error, workspaceID)
	}

	if input.Code == "" && input.OAuthToken == "" {
		return h.redirectWithError("missing authorization code")
	}
	return nil, nil
}

type oauthCallbackSession struct {
	workspaceID     string
	userID          string
	executionIntent string
	instanceRef     string
	adapter         platform.Adapter
	extra           map[string]string
}

func (h *OAuthHandler) resolveOAuthCallbackSession(ctx context.Context, input *OAuthCallbackInput) (*oauthCallbackSession, *huma.StreamResponse, error) {
	workspaceID := ""
	userID := ""
	executionIntent := ""
	instanceRef := ""
	var adapter platform.Adapter

	extra := make(map[string]string)
	if input.Platform == "x" {
		var err error
		adapter, err = h.getProvider(input.Platform, input.ServerName)
		if err != nil {
			resp, err := h.redirectWithError(err.Error())
			return nil, resp, err
		}
		extra["oauth_token"] = input.OAuthToken
		extra["oauth_verifier"] = input.Verifier
	}

	if input.Platform == "x" {
		xAdapter, ok := adapter.(*platform.XAdapter)
		if !ok {
			resp, err := h.redirectWithError("x adapter type mismatch")
			return nil, resp, err
		}
		requestMeta, ok := xAdapter.GetRequestMetaForRequestToken(input.OAuthToken)
		if !ok {
			resp, err := h.redirectWithError("invalid or expired oauth request token")
			return nil, resp, err
		}
		workspaceID = requestMeta.WorkspaceID
		userID = requestMeta.UserID
		executionIntent = requestMeta.ExecutionIntent
	} else {
		statePayload, err := h.oauthStates.Consume(ctx, input.State)
		if err != nil {
			resp, err := h.redirectWithError("invalid or expired state")
			return nil, resp, err
		}
		if statePayload.Platform != input.Platform {
			resp, err := h.redirectWithError("oauth state platform mismatch")
			return nil, resp, err
		}
		userID = statePayload.UserID
		workspaceID = statePayload.WorkspaceID
		executionIntent = statePayload.ExecutionIntent
		switch input.Platform {
		case mastodonProvider, pixelfedProvider:
			input.ServerName = statePayload.ServerName
			instanceRef = statePayload.ServerName
		case "discord":
			instanceRef = platform.ConnectionModeBot
		}
	}

	if err := h.checkWorkspaceEditAccess(ctx, workspaceID, userID); err != nil {
		log.Printf("[Callback] Workspace access check failed: %v", err)
		resp, err := h.redirectWithError("workspace access denied", workspaceID)
		return nil, resp, err
	}
	if err := h.requireProviderConnectionCompletion(
		ctx, input.Platform, instanceRef, executionIntent, userID,
	); err != nil {
		resp, err := h.redirectWithError(err.Error(), workspaceID)
		return nil, resp, err
	}

	return &oauthCallbackSession{workspaceID: workspaceID, userID: userID, executionIntent: executionIntent, instanceRef: instanceRef, adapter: adapter, extra: extra}, nil, nil
}

func (h *OAuthHandler) resolveOAuthCallbackAdapter(ctx context.Context, input *OAuthCallbackInput, session *oauthCallbackSession) (*huma.StreamResponse, error) {
	if input.Platform != "x" {
		var err error
		if isCompatOAuthProvider(input.Platform) {
			session.adapter, _, err = h.getCompatProvider(ctx, input.Platform, input.ServerName, "")
			if err != nil {
				resp, err := h.redirectWithError(err.Error(), session.workspaceID)
				return resp, err
			}
			session.instanceRef = mastodonInstanceURL(session.adapter)
		} else {
			session.adapter, err = h.getProvider(input.Platform, input.ServerName)
			if err != nil {
				resp, err := h.redirectWithError(err.Error(), session.workspaceID)
				return resp, err
			}
		}
	}
	return nil, nil
}

func (h *OAuthHandler) callbackErrorWorkspace(ctx context.Context, input *OAuthCallbackInput) string {
	if input.Platform == "x" {
		adapter, err := h.getProvider(input.Platform, input.ServerName)
		if err != nil {
			return ""
		}
		xAdapter, ok := adapter.(*platform.XAdapter)
		if !ok {
			return ""
		}
		meta, ok := xAdapter.GetRequestMetaForRequestToken(input.OAuthToken)
		if ok {
			return meta.WorkspaceID
		}
		return ""
	}
	payload, err := h.oauthStates.Consume(ctx, input.State)
	if err != nil || payload.Platform != input.Platform {
		return ""
	}
	return payload.WorkspaceID
}

func (h *OAuthHandler) redirectWithError(msg string, workspaceIDs ...string) (*huma.StreamResponse, error) {
	msg = strings.TrimSpace(html.UnescapeString(msg))
	status := "failed"
	if strings.EqualFold(msg, "access_denied") || strings.EqualFold(msg, "cancelled") {
		status = "cancelled"
	}
	return h.redirectWithOAuthFeedback(status, "", workspaceIDs...)
}

func (h *OAuthHandler) redirectWithOAuthFeedback(status, reason string, workspaceIDs ...string) (*huma.StreamResponse, error) {
	query := url.Values{"tab": {"accounts"}, "oauth_status": {status}}
	if reason != "" {
		query.Set("oauth_reason", reason)
	}
	if len(workspaceIDs) > 0 && strings.TrimSpace(workspaceIDs[0]) != "" {
		query.Set("workspace_id", workspaceIDs[0])
	}
	location := h.frontendURL + "/settings?" + query.Encode()
	return &huma.StreamResponse{
		Body: func(ctx huma.Context) {
			ctx.SetHeader("Location", location)
			ctx.SetStatus(http.StatusTemporaryRedirect)
		},
	}, nil
}

func (h *OAuthHandler) redirectWithAccountSelection(platformName, connectionID string) (*huma.StreamResponse, error) {
	location := h.frontendURL + "/accounts/callback?status=selection_required&platform=" + url.QueryEscape(platformName) + "&connection_id=" + url.QueryEscape(connectionID)
	return &huma.StreamResponse{
		Body: func(ctx huma.Context) {
			ctx.SetHeader("Location", location)
			ctx.SetStatus(http.StatusTemporaryRedirect)
		},
	}, nil
}

func (h *OAuthHandler) saveAccountSelectionAndRedirect(
	ctx context.Context,
	userID, platformName, workspaceID, instanceURL, executionIntent string,
	tokenResp *platform.TokenResult,
	selector platform.AccountSelectionAdapter,
) (*huma.StreamResponse, error) {
	if err := h.checkWorkspaceEditAccess(ctx, workspaceID, userID); err != nil {
		log.Printf("[Callback] Workspace access check failed: %v", err)
		return h.redirectWithError("workspace access denied", workspaceID)
	}
	if err := h.requireProviderConnectionCompletion(
		ctx, platformName, instanceURL, executionIntent, userID,
	); err != nil {
		return h.redirectWithError(err.Error(), workspaceID)
	}

	options, err := selector.ListAccountSelections(ctx, tokenResp)
	if err != nil {
		log.Printf("[Callback] Failed to list selectable accounts: platform=%s error=%v", platformName, err)
		if errors.Is(err, platform.ErrNoFacebookPages) {
			return h.redirectWithOAuthFeedback("failed", oauthFailureReasonFacebookNoPages, workspaceID)
		}
		return h.redirectWithError(fmt.Sprintf("failed to list selectable accounts: %s", err.Error()), workspaceID)
	}
	if len(options) == 0 {
		log.Printf("[Callback] No selectable accounts found: platform=%s", platformName)
		return h.redirectWithError("no selectable accounts found for this provider", workspaceID)
	}
	if err := h.requireProviderConnectionCompletion(
		ctx, platformName, instanceURL, executionIntent, userID,
	); err != nil {
		return h.redirectWithError(err.Error(), workspaceID)
	}

	pending, err := h.createPendingAccountSelection(
		ctx, userID, platformName, workspaceID, instanceURL,
		executionIntent, tokenResp, options,
	)
	if err != nil {
		log.Printf("[Callback] Failed to save pending account selection: %v", err)
		return h.redirectWithError("failed to save pending account selection", workspaceID)
	}

	log.Printf("[Callback] Pending account selection created: ID=%s platform=%s", pending.ID, platformName)
	return h.redirectWithAccountSelection(platformName, pending.ID)
}

func (h *OAuthHandler) createPendingAccountSelection(
	ctx context.Context,
	userID, platformName, workspaceID, instanceURL, executionIntent string,
	tokenResp *platform.TokenResult,
	options []platform.AccountSelectionOption,
) (*models.OAuthAccountSelection, error) {
	if h.crypto == nil {
		return nil, fmt.Errorf("token encryptor is not configured")
	}
	if tokenResp == nil {
		return nil, fmt.Errorf("token response is required")
	}

	encAccess, err := h.crypto.Encrypt(tokenResp.AccessToken)
	if err != nil {
		return nil, err
	}

	var encRefresh []byte
	if tokenResp.RefreshToken != "" {
		encRefresh, err = h.crypto.Encrypt(tokenResp.RefreshToken)
		if err != nil {
			return nil, err
		}
	}

	optionsJSON, err := json.Marshal(options)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	extra := make(map[string]string, len(tokenResp.Extra)+1)
	for key, value := range tokenResp.Extra {
		extra[key] = value
	}
	if tokenResp.RefreshExpiresIn > 0 {
		extra[pendingSelectionRefreshExpiresAtKey] = now.Add(time.Duration(tokenResp.RefreshExpiresIn) * time.Second).Format(time.RFC3339Nano)
	}
	extraJSON, err := json.Marshal(extra)
	if err != nil {
		return nil, err
	}

	var tokenExpiresAt time.Time
	if tokenResp.ExpiresIn > 0 {
		tokenExpiresAt = now.Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	}

	pending := &models.OAuthAccountSelection{
		ID:              uuid.NewString(),
		UserID:          userID,
		WorkspaceID:     workspaceID,
		Platform:        platformName,
		InstanceURL:     instanceURL,
		ExecutionIntent: executionIntent,
		AccessTokenEnc:  encAccess,
		RefreshTokenEnc: encRefresh,
		TokenType:       tokenResp.TokenType,
		TokenExpiresAt:  tokenExpiresAt,
		TokenExtraJSON:  string(extraJSON),
		OptionsJSON:     string(optionsJSON),
		ExpiresAt:       now.Add(pendingAccountSelectionTTL),
		CreatedAt:       now,
	}
	if _, err := h.db.NewInsert().Model(pending).Exec(ctx); err != nil {
		return nil, err
	}
	return pending, nil
}

func (h *OAuthHandler) saveAccountAndRedirect(
	ctx context.Context,
	userID, platformName, workspaceID, instanceURL, executionIntent string,
	profile *platform.UserProfile,
	tokenResp *platform.TokenResult,
	adapter platform.Adapter,
) (*huma.StreamResponse, error) {
	accountID := profile.ID
	if platformName == "threads" && tokenResp.Extra != nil {
		if uid, ok := tokenResp.Extra["user_id"]; ok && uid != "" {
			if profile.ID != "" && uid != profile.ID {
				return h.redirectWithError("provider account identity mismatch", workspaceID)
			}
			accountID = uid
		}
	}
	if err := h.requireProviderConnectionCompletion(
		ctx, platformName, instanceURL, executionIntent, userID,
	); err != nil {
		return h.redirectWithError(err.Error(), workspaceID)
	}

	account, err := h.accountSaver.SaveAccountFromInput(ctx, account_saver.SaveAccountInput{
		Actor:            workspaceActor(ctx, userID),
		UserID:           userID,
		PlatformName:     platformName,
		WorkspaceID:      workspaceID,
		AccountID:        accountID,
		AccountUsername:  profile.Username,
		AccountAvatarURL: profile.AvatarURL,
		InstanceURL:      instanceURL,
		Token:            tokenResp,
		CapabilityState:  h.fediverseCapabilityState(ctx, platformName, instanceURL, profile),
		Grant:            authorizationGrantInput(adapter, accountID),
	})
	if err != nil {
		log.Printf("[Callback] Failed to save account: %v", err)
		return h.redirectWithError(accountConnectionErrorMessage(err), workspaceID)
	}
	firstConnection := account.ClaimedFirst
	h.captureDestinationConnected(ctx, userID, workspaceID, platformName, 1, firstConnection)

	log.Printf("[Callback] Account saved successfully: ID=%s", account.ID)
	if firstConnection {
		return redirectResponse(h.composerConnectionURL(workspaceID, []string{account.ID})), nil
	}
	return redirectResponse(h.accountManagementRedirectURL()), nil
}

func redirectResponse(location string) *huma.StreamResponse {
	return &huma.StreamResponse{
		Body: func(ctx huma.Context) {
			ctx.SetHeader("Location", location)
			ctx.SetStatus(http.StatusTemporaryRedirect)
		},
	}
}

func (h *OAuthHandler) composerConnectionURL(workspaceID string, accountIDs []string) string {
	query := url.Values{}
	query.Set("workspace_id", workspaceID)
	query.Set("account_ids", strings.Join(accountIDs, ","))
	return h.frontendURL + "/?" + query.Encode()
}

func (h *OAuthHandler) accountManagementRedirectURL() string {
	return h.frontendURL + "/settings?tab=accounts"
}

func (h *OAuthHandler) normalizedAccountConnectionResponse(workspaceID string, accounts []*models.SocialAccount, openFreshComposer bool) AccountConnectionResponse {
	accountIDs := make([]string, 0, len(accounts))
	for _, a := range accounts {
		accountIDs = append(accountIDs, a.ID)
	}
	firstID := ""
	if len(accounts) > 0 {
		firstID = accounts[0].ID
	}
	return AccountConnectionResponse{
		WorkspaceID:       workspaceID,
		AccountID:         firstID,
		AccountIDs:        accountIDs,
		OpenFreshComposer: openFreshComposer,
	}
}

func accountConnectionErrorMessage(err error) string {
	msg := strings.TrimSpace(err.Error())
	switch {
	case strings.EqualFold(msg, "active subscription required"):
		return "Active subscription required to connect social accounts. Choose a plan in Billing, then try connecting again."
	case strings.Contains(msg, "social_accounts limit exceeded"), strings.Contains(msg, "social account limit exceeded"):
		return "Social account limit reached for this workspace. Upgrade your plan or disconnect an account, then try again."
	case msg != "":
		return msg
	default:
		return "Failed to save account"
	}
}

func (h *OAuthHandler) ExchangeCode(api huma.API) {
	for _, provider := range []string{mastodonProvider, pixelfedProvider} {
		h.registerCompatExchangeCode(api, provider)
	}
}

func (h *OAuthHandler) registerCompatExchangeCode(api huma.API, provider string) {
	displayName := compatProviderDisplayName(provider)
	huma.Register(api, huma.Operation{
		OperationID: "exchange-" + provider + "-code",
		Method:      http.MethodPost,
		Path:        "/accounts/" + provider + "/exchange",
		Summary:     "Exchange " + displayName + " OOB authorization code",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400},
	}, func(ctx context.Context, input *ExchangeCodeInput) (*ExchangeCodeOutput, error) {
		return h.exchangeCompatCode(ctx, provider, input)
	})
}

func (h *OAuthHandler) exchangeCompatCode(ctx context.Context, provider string, input *ExchangeCodeInput) (*ExchangeCodeOutput, error) {
	userID := middleware.GetUserID(ctx)
	intent, err := h.connectionIntent(ctx, input.Body.Intent)
	if err != nil {
		return nil, err
	}
	if err := h.ensureCanStartAccountConnection(ctx, input.Body.WorkspaceID, userID); err != nil {
		return nil, err
	}
	requestedInstance := strings.TrimRight(strings.TrimSpace(firstNonEmpty(
		input.Body.InstanceURL, input.Body.ServerName,
	)), "/")
	if err := h.requireProviderConnection(ctx, provider, requestedInstance, intent); err != nil {
		return nil, err
	}

	adapter, _, err := h.getCompatProvider(ctx, provider, input.Body.ServerName, input.Body.InstanceURL)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	instanceURL := mastodonInstanceURL(adapter)
	if err := h.requireProviderConnectionCompletion(
		ctx, provider, instanceURL, string(intent), userID,
	); err != nil {
		return nil, err
	}

	tokenResp, err := adapter.ExchangeCode(ctx, input.Body.Code, nil)
	if err != nil {
		return nil, huma.Error500InternalServerError(fmt.Sprintf("%s exchange failed: %s", provider, err.Error()))
	}
	if err := h.requireProviderConnectionCompletion(
		ctx, provider, instanceURL, string(intent), userID,
	); err != nil {
		return nil, err
	}

	profile, err := adapter.GetProfile(ctx, tokenResp.AccessToken)
	if err != nil {
		profile = &platform.UserProfile{ID: provider + "-user", Username: ""}
	}

	if err := h.requireProviderConnectionCompletion(
		ctx, provider, instanceURL, string(intent), userID,
	); err != nil {
		return nil, err
	}

	account, err := h.accountSaver.SaveAccountFromInput(ctx, account_saver.SaveAccountInput{
		Actor:            workspaceActor(ctx, userID),
		UserID:           userID,
		PlatformName:     provider,
		WorkspaceID:      input.Body.WorkspaceID,
		AccountID:        profile.ID,
		AccountUsername:  profile.Username,
		AccountAvatarURL: profile.AvatarURL,
		InstanceURL:      instanceURL,
		Token:            tokenResp,
		CapabilityState:  h.fediverseCapabilityState(ctx, provider, instanceURL, profile),
		Grant:            authorizationGrantInput(adapter, profile.ID),
	})
	if err != nil {
		log.Printf("[ExchangeCode] Failed to save account: %v", err)
		return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
	}
	firstConnection := account.ClaimedFirst

	log.Printf("[ExchangeCode] Account saved successfully")
	resp := h.normalizedAccountConnectionResponse(input.Body.WorkspaceID, []*models.SocialAccount{account}, firstConnection)
	return &ExchangeCodeOutput{Body: resp}, nil
}

type BlueskyLoginInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" doc:"Workspace ID"`
		Handle      string `json:"handle" doc:"Bluesky handle (e.g. user.bsky.social)"`
		AppPassword string `json:"app_password" doc:"Bluesky app password (Settings > App Passwords)"`
		Intent      string `json:"intent,omitempty" enum:"production,certification_test" doc:"Typed execution intent; certification_test requires an unscoped instance administrator"`
	}
}

type BlueskyLoginOutput struct {
	Body AccountConnectionResponse
}

func (h *OAuthHandler) BlueskyLogin(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "bluesky-login",
		Method:      http.MethodPost,
		Path:        "/accounts/bluesky/login",
		Summary:     "Connect Bluesky account using app password",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 502},
	}, func(ctx context.Context, input *BlueskyLoginInput) (*BlueskyLoginOutput, error) {
		userID := middleware.GetUserID(ctx)
		intent, err := h.connectionIntent(ctx, input.Body.Intent)
		if err != nil {
			return nil, err
		}
		if err := h.ensureCanStartAccountConnection(ctx, input.Body.WorkspaceID, userID); err != nil {
			return nil, err
		}

		adapter, ok := h.provider("bluesky")
		if !ok {
			return nil, huma.Error400BadRequest("bluesky not configured")
		}
		if err := h.requireProviderConnection(ctx, "bluesky", "", intent); err != nil {
			return nil, err
		}

		loginAdapter, resolvedDID, err := h.blueskyLoginAdapter(ctx, adapter, input.Body.Handle)
		if err != nil {
			return nil, err
		}
		pdsURL := loginAdapter.PDSURL()

		did, handle, accessToken, refreshToken, expiresIn, err := loginAdapter.CreateSession(ctx, input.Body.Handle, input.Body.AppPassword)
		if err != nil {
			// Transport errors name internal hosts, so only the log carries the detail.
			log.Printf("[BlueskyLogin] Session creation failed: %v", err)
			return nil, huma.Error500InternalServerError("bluesky login failed")
		}
		if resolvedDID != "" && did != resolvedDID {
			log.Printf("[BlueskyLogin] PDS %s returned did %s for a handle resolving to %s", pdsURL, did, resolvedDID)
			return nil, huma.Error500InternalServerError("bluesky login failed")
		}
		if err := h.requireProviderConnectionCompletion(
			ctx, "bluesky", "", string(intent), userID,
		); err != nil {
			return nil, err
		}

		// Build a TokenResult for Bluesky and delegate saving to AccountSaver so encryption and DB insert are centralized
		tokenResp := &platform.TokenResult{
			AccessToken:  accessToken,
			RefreshToken: refreshToken,
			ExpiresIn:    expiresIn,
			Extra:        nil,
		}
		profile := &platform.UserProfile{
			ID:       did,
			Username: firstNonEmpty(handle, input.Body.Handle),
		}
		providerProfile, profileErr := loginAdapter.GetProfile(ctx, accessToken)
		if profileErr != nil {
			log.Printf("[BlueskyLogin] Profile unavailable after session creation: %v", profileErr)
		} else if providerProfile != nil {
			profile.ID = firstNonEmpty(providerProfile.ID, profile.ID)
			profile.Username = firstNonEmpty(providerProfile.Username, profile.Username)
			profile.DisplayName = providerProfile.DisplayName
			profile.AvatarURL = providerProfile.AvatarURL
			profile.CapabilityState = providerProfile.CapabilityState
		}
		if err := h.requireProviderConnectionCompletion(
			ctx, "bluesky", "", string(intent), userID,
		); err != nil {
			return nil, err
		}
		accountID := firstNonEmpty(profile.ID, did)
		if providerKey := platform.AccountProviderKey("bluesky", pdsURL, ""); providerKey != "bluesky" {
			h.registerProvider(providerKey, loginAdapter)
		}

		account, err := h.accountSaver.SaveAccountFromInput(ctx, account_saver.SaveAccountInput{
			Actor:            workspaceActor(ctx, userID),
			UserID:           userID,
			PlatformName:     "bluesky",
			WorkspaceID:      input.Body.WorkspaceID,
			AccountID:        accountID,
			AccountUsername:  firstNonEmpty(profile.Username, input.Body.Handle),
			AccountAvatarURL: profile.AvatarURL,
			InstanceURL:      pdsURL,
			Token:            tokenResp,
			Grant:            authorizationGrantInput(loginAdapter, accountID),
		})
		if err != nil {
			log.Printf("[BlueskyLogin] Failed to save account: %v", err)
			return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
		}

		resp := h.normalizedAccountConnectionResponse(input.Body.WorkspaceID, []*models.SocialAccount{account}, account.ClaimedFirst)
		return &BlueskyLoginOutput{Body: resp}, nil
	})
}

type FediverseLoginInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" doc:"Workspace ID"`
		InstanceURL string `json:"instance_url" doc:"Fediverse instance URL"`
		Username    string `json:"username" doc:"Instance username"`
		Password    string `json:"password" doc:"Instance password (exchanged once, never stored)"`
		Channel     string `json:"channel,omitempty" doc:"PeerTube channel to connect (required when the account owns several)"`
		Intent      string `json:"intent,omitempty" enum:"production,certification_test" doc:"Typed execution intent; certification_test requires an unscoped instance administrator"`
	}
}

type FediverseLoginOutput struct {
	Body FediverseLoginResponse
}

type FediverseLoginResponse struct {
	AccountConnectionResponse
	SelectionRequired bool                              `json:"selection_required,omitempty" doc:"True when the caller must complete channel selection"`
	ConnectionID      string                            `json:"connection_id,omitempty" doc:"Pending selection ID for the channel picker"`
	Options           []platform.AccountSelectionOption `json:"options,omitempty" doc:"Selectable channels when selection is required"`
}

// fediverseLogin connects a credential-based Fediverse account (PeerTube,
// Lemmy, PieFed) following the Bluesky app-password shape: the password is
// exchanged once for tokens and never stored.
func (h *OAuthHandler) fediverseLogin(ctx context.Context, provider string, body FediverseLoginInput) (*FediverseLoginOutput, error) {
	userID := middleware.GetUserID(ctx)
	intent, err := h.connectionIntent(ctx, body.Body.Intent)
	if err != nil {
		return nil, err
	}
	if err := h.ensureCanStartAccountConnection(ctx, body.Body.WorkspaceID, userID); err != nil {
		return nil, err
	}
	instanceURL, err := normalizeFediverseInstanceURL(body.Body.InstanceURL)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	if err := h.requireProviderConnection(ctx, provider, instanceURL, intent); err != nil {
		return nil, err
	}

	adapter, ok := platform.NewInstanceAdapter(provider, instanceURL)
	if !ok {
		return nil, huma.Error400BadRequest(fmt.Sprintf("%s does not support instance credentials", provider))
	}
	h.registerProvider(platform.AccountProviderKey(provider, instanceURL, ""), adapter)

	tokenResp, profile, err := fediverseInstanceLogin(ctx, adapter, strings.TrimSpace(body.Body.Username), body.Body.Password)
	if err != nil {
		log.Printf("[FediverseLogin] Login failed: provider=%s instance=%s error=%v", provider, instanceURL, err)
		return nil, huma.Error500InternalServerError(provider + " login failed")
	}
	if err := h.requireProviderConnectionCompletion(ctx, provider, instanceURL, string(intent), userID); err != nil {
		return nil, err
	}

	if provider == "peertube" {
		return h.savePeerTubeLogin(ctx, userID, provider, body.Body.WorkspaceID, instanceURL, string(intent), adapter, tokenResp, profile, strings.TrimSpace(body.Body.Channel))
	}

	account, err := h.accountSaver.SaveAccountFromInput(ctx, account_saver.SaveAccountInput{
		Actor:            workspaceActor(ctx, userID),
		UserID:           userID,
		PlatformName:     provider,
		WorkspaceID:      body.Body.WorkspaceID,
		AccountID:        profile.ID,
		AccountUsername:  firstNonEmpty(profile.Username, body.Body.Username),
		AccountAvatarURL: profile.AvatarURL,
		InstanceURL:      instanceURL,
		Token:            tokenResp,
		CapabilityState:  profile.CapabilityState,
		Grant:            authorizationGrantInput(adapter, profile.ID),
	})
	if err != nil {
		log.Printf("[FediverseLogin] Failed to save account: %v", err)
		return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
	}
	resp := h.normalizedAccountConnectionResponse(body.Body.WorkspaceID, []*models.SocialAccount{account}, account.ClaimedFirst)
	return &FediverseLoginOutput{Body: FediverseLoginResponse{AccountConnectionResponse: resp}}, nil
}

func fediverseInstanceLogin(ctx context.Context, adapter platform.Adapter, username, password string) (*platform.TokenResult, *platform.UserProfile, error) {
	type instanceLoginer interface {
		Login(ctx context.Context, username, password string) (*platform.TokenResult, *platform.UserProfile, error)
	}
	loginer, ok := adapter.(instanceLoginer)
	if !ok {
		return nil, nil, fmt.Errorf("provider does not support instance credentials")
	}
	return loginer.Login(ctx, username, password)
}

func (h *OAuthHandler) savePeerTubeLogin(
	ctx context.Context,
	userID, provider, workspaceID, instanceURL, executionIntent string,
	adapter platform.Adapter,
	tokenResp *platform.TokenResult,
	_ *platform.UserProfile,
	requestedChannel string,
) (*FediverseLoginOutput, error) {
	selector, ok := adapter.(platform.AccountSelectionAdapter)
	if !ok {
		return nil, huma.Error500InternalServerError("peertube channel selection is unavailable")
	}
	channels, err := selector.ListAccountSelections(ctx, tokenResp)
	if err != nil {
		return nil, huma.Error500InternalServerError("peertube channel listing failed")
	}
	if len(channels) == 0 {
		return nil, huma.Error400BadRequest("this PeerTube account owns no channels")
	}
	if requestedChannel != "" {
		for _, channel := range channels {
			if channel.ID == requestedChannel {
				return h.saveSelectedPeerTubeChannel(ctx, userID, provider, workspaceID, instanceURL, executionIntent, adapter, tokenResp, channel.ID)
			}
		}
		return nil, huma.Error400BadRequest("unknown peertube channel selection")
	}
	if len(channels) == 1 {
		return h.saveSelectedPeerTubeChannel(ctx, userID, provider, workspaceID, instanceURL, executionIntent, adapter, tokenResp, channels[0].ID)
	}
	if err := h.requireProviderConnectionCompletion(ctx, provider, instanceURL, executionIntent, userID); err != nil {
		return nil, err
	}
	pending, err := h.createPendingAccountSelection(ctx, userID, provider, workspaceID, instanceURL, executionIntent, tokenResp, channels)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to save pending channel selection")
	}
	return &FediverseLoginOutput{Body: FediverseLoginResponse{SelectionRequired: true, ConnectionID: pending.ID, Options: channels}}, nil
}

func (h *OAuthHandler) saveSelectedPeerTubeChannel(
	ctx context.Context,
	userID, provider, workspaceID, instanceURL, executionIntent string,
	adapter platform.Adapter,
	tokenResp *platform.TokenResult,
	channelID string,
) (*FediverseLoginOutput, error) {
	selector, ok := adapter.(platform.AccountSelectionAdapter)
	if !ok {
		return nil, huma.Error500InternalServerError("peertube channel selection is unavailable")
	}
	selected, err := selector.SelectAccount(ctx, tokenResp, channelID)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	if err := h.requireProviderConnectionCompletion(ctx, provider, instanceURL, executionIntent, userID); err != nil {
		return nil, err
	}
	account, err := h.accountSaver.SaveAccountFromInput(ctx, account_saver.SaveAccountInput{
		Actor:            workspaceActor(ctx, userID),
		UserID:           userID,
		PlatformName:     provider,
		WorkspaceID:      workspaceID,
		AccountID:        selected.AccountID,
		AccountUsername:  selected.AccountUsername,
		AccountAvatarURL: selected.AccountAvatarURL,
		InstanceURL:      instanceURL,
		Token:            selected.Token,
		CapabilityState:  selected.CapabilityState,
		Grant:            authorizationGrantInput(adapter, selected.AccountID),
	})
	if err != nil {
		log.Printf("[FediverseLogin] Failed to save account: %v", err)
		return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
	}
	resp := h.normalizedAccountConnectionResponse(workspaceID, []*models.SocialAccount{account}, account.ClaimedFirst)
	return &FediverseLoginOutput{Body: FediverseLoginResponse{AccountConnectionResponse: resp}}, nil
}

func (h *OAuthHandler) PeerTubeLogin(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "peertube-login",
		Method:      http.MethodPost,
		Path:        "/accounts/peertube/login",
		Summary:     "Connect a PeerTube account using instance credentials",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 500},
	}, func(ctx context.Context, input *FediverseLoginInput) (*FediverseLoginOutput, error) {
		return h.fediverseLogin(ctx, "peertube", *input)
	})
}

func (h *OAuthHandler) LemmyLogin(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "lemmy-login",
		Method:      http.MethodPost,
		Path:        "/accounts/lemmy/login",
		Summary:     "Connect a Lemmy account using instance credentials",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 500},
	}, func(ctx context.Context, input *FediverseLoginInput) (*FediverseLoginOutput, error) {
		return h.fediverseLogin(ctx, "lemmy", *input)
	})
}

func (h *OAuthHandler) PieFedLogin(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "piefed-login",
		Method:      http.MethodPost,
		Path:        "/accounts/piefed/login",
		Summary:     "Connect a PieFed account using instance credentials",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 500},
	}, func(ctx context.Context, input *FediverseLoginInput) (*FediverseLoginOutput, error) {
		return h.fediverseLogin(ctx, "piefed", *input)
	})
}

type DiscordWebhookLoginInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" doc:"Workspace ID"`
		WebhookURL  string `json:"webhook_url" doc:"Discord incoming webhook URL"`
		Intent      string `json:"intent,omitempty" enum:"production,certification_test" doc:"Typed execution intent; certification_test requires an unscoped instance administrator"`
	}
}

type DiscordWebhookLoginOutput struct {
	Body AccountConnectionResponse
}

func (h *OAuthHandler) DiscordWebhookLogin(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "discord-webhook-login",
		Method:      http.MethodPost,
		Path:        "/accounts/discord/webhook",
		Summary:     "Connect a Discord channel using an incoming webhook",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *DiscordWebhookLoginInput) (*DiscordWebhookLoginOutput, error) {
		userID := middleware.GetUserID(ctx)
		intent, err := h.connectionIntent(ctx, input.Body.Intent)
		if err != nil {
			return nil, err
		}
		if err := h.ensureCanStartAccountConnection(ctx, input.Body.WorkspaceID, userID); err != nil {
			return nil, err
		}
		webhookAdapter, _ := h.provider("discord:" + platform.ConnectionModeWebhook)
		adapter, ok := webhookAdapter.(*platform.DiscordAdapter)
		if !ok {
			legacyAdapter, _ := h.provider("discord")
			adapter, ok = legacyAdapter.(*platform.DiscordAdapter)
		}
		if !ok {
			return nil, huma.Error400BadRequest("discord webhooks are not configured")
		}
		if err := h.requireProviderConnection(ctx, "discord", "", intent); err != nil {
			return nil, err
		}
		webhookURL := strings.TrimSpace(input.Body.WebhookURL)
		profile, err := adapter.GetProfile(ctx, webhookURL)
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		if err := h.requireProviderConnectionCompletion(
			ctx, "discord", "", string(intent), userID,
		); err != nil {
			return nil, err
		}
		token := &platform.TokenResult{
			AccessToken: webhookURL,
			TokenType:   "Webhook",
		}
		account, err := h.accountSaver.SaveAccountFromInput(ctx, account_saver.SaveAccountInput{
			Actor:            workspaceActor(ctx, userID),
			UserID:           userID,
			PlatformName:     "discord",
			WorkspaceID:      input.Body.WorkspaceID,
			AccountID:        profile.ID,
			AccountUsername:  firstNonEmpty(profile.DisplayName, profile.Username),
			AccountAvatarURL: profile.AvatarURL,
			Token:            token,
			CapabilityState:  profile.CapabilityState,
			Grant:            authorizationGrantInput(adapter, profile.ID),
		})
		if err != nil {
			return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
		}
		resp := h.normalizedAccountConnectionResponse(input.Body.WorkspaceID, []*models.SocialAccount{account}, account.ClaimedFirst)
		return &DiscordWebhookLoginOutput{Body: resp}, nil
	})
}

func (h *OAuthHandler) GetAccountSelection(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-account-selection",
		Method:      http.MethodGet,
		Path:        "/accounts/selections/{connection_id}",
		Summary:     "Get pending OAuth account-selection options",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *GetAccountSelectionInput) (*GetAccountSelectionOutput, error) {
		pending, err := h.loadPendingAccountSelection(ctx, input.ConnectionID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}

		options, err := parseAccountSelectionOptions(pending.OptionsJSON)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to parse account selection options")
		}

		return &GetAccountSelectionOutput{Body: AccountSelectionResponse{
			ID:          pending.ID,
			Platform:    pending.Platform,
			WorkspaceID: pending.WorkspaceID,
			ExpiresAt:   pending.ExpiresAt,
			Options:     options,
		}}, nil
	})
}

//nolint:gocyclo // Validation and the atomic multi-account handoff share one OAuth completion boundary.
func (h *OAuthHandler) CompleteAccountSelection(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "complete-account-selection",
		Method:      http.MethodPost,
		Path:        "/accounts/selections/{connection_id}/complete",
		Summary:     "Complete OAuth account selection and save the selected account",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, h.completeAccountSelection)
}

func (h *OAuthHandler) completeAccountSelection(ctx context.Context, input *CompleteAccountSelectionInput) (*CompleteAccountSelectionOutput, error) {
	normalizedSelections, err := normalizeAccountSelectionIDs(input)
	if err != nil {
		return nil, err
	}

	userID := middleware.GetUserID(ctx)
	pending, err := h.loadPendingAccountSelection(ctx, input.ConnectionID, userID)
	if err != nil {
		return nil, err
	}
	if err := h.reservePendingAccountSelection(ctx, pending.ID); err != nil {
		return nil, err
	}
	selectionCompleted := false
	defer func() {
		if selectionCompleted {
			return
		}
		if _, releaseErr := h.db.NewDelete().Model((*models.OAuthAccountSelectionReservation)(nil)).
			Where("selection_id = ?", pending.ID).Exec(context.WithoutCancel(ctx)); releaseErr != nil {
			log.Printf("[OAuth Selection] Failed to release selection reservation: %v", releaseErr)
		}
	}()
	if err := h.requireProviderConnectionCompletion(
		ctx, pending.Platform, pending.InstanceURL, pending.ExecutionIntent, userID,
	); err != nil {
		return nil, err
	}

	saveInputs, err := h.collectAccountSaveInputs(ctx, pending, userID, normalizedSelections)
	if err != nil {
		return nil, err
	}

	out, err := h.persistAccountSelection(ctx, userID, pending, saveInputs)
	if err != nil {
		return nil, err
	}
	selectionCompleted = true
	return out, nil
}

func normalizeAccountSelectionIDs(input *CompleteAccountSelectionInput) ([]string, error) {
	selectionIDs := append([]string(nil), input.Body.SelectionIDs...)
	if selectionID := strings.TrimSpace(input.Body.SelectionID); selectionID != "" {
		selectionIDs = append(selectionIDs, selectionID)
	}
	seenSelections := map[string]struct{}{}
	normalizedSelections := make([]string, 0, len(selectionIDs))
	for _, selectionID := range selectionIDs {
		selectionID = strings.TrimSpace(selectionID)
		if selectionID == "" {
			continue
		}
		if _, exists := seenSelections[selectionID]; exists {
			continue
		}
		seenSelections[selectionID] = struct{}{}
		normalizedSelections = append(normalizedSelections, selectionID)
	}
	if len(normalizedSelections) == 0 {
		return nil, huma.Error400BadRequest("selection_ids must include at least one account")
	}
	return normalizedSelections, nil
}

func (h *OAuthHandler) collectAccountSaveInputs(ctx context.Context, pending *models.OAuthAccountSelection, userID string, normalizedSelections []string) ([]account_saver.SaveAccountInput, error) {
	adapter, err := h.getProvider(pending.Platform, "")
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	if pending.InstanceURL != "" {
		if rebuilt, ok := platform.NewInstanceAdapter(pending.Platform, pending.InstanceURL); ok {
			adapter = rebuilt
		}
	}
	selector, ok := adapter.(platform.AccountSelectionAdapter)
	if !ok {
		return nil, huma.Error400BadRequest(fmt.Sprintf("%s does not support account selection", pending.Platform))
	}

	tokenResp, err := h.tokenResultFromPendingSelection(pending)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to decrypt pending account selection")
	}

	if pending.Platform != "linkedin" && len(normalizedSelections) > 1 {
		return nil, huma.Error400BadRequest("this provider supports one account per connection")
	}
	saveInputs := make([]account_saver.SaveAccountInput, 0, len(normalizedSelections))
	for _, selectionID := range normalizedSelections {
		if err := h.requireProviderConnectionCompletion(
			ctx, pending.Platform, pending.InstanceURL, pending.ExecutionIntent, userID,
		); err != nil {
			return nil, err
		}
		selected, err := selector.SelectAccount(ctx, tokenResp, selectionID)
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		if selected == nil {
			return nil, huma.Error400BadRequest("selected account was not found")
		}
		if selected.Token == nil {
			selected.Token = tokenResp
		}
		saveInputs = append(saveInputs, account_saver.SaveAccountInput{
			Actor:                 workspaceActor(ctx, userID),
			UserID:                userID,
			PlatformName:          pending.Platform,
			WorkspaceID:           pending.WorkspaceID,
			AccountID:             selected.AccountID,
			AccountUsername:       selected.AccountUsername,
			AccountAvatarURL:      selected.AccountAvatarURL,
			InstanceURL:           selectedAccountInstanceURL(pending.Platform, selected.InstanceURL, pending.InstanceURL),
			Token:                 selected.Token,
			CapabilityState:       selected.CapabilityState,
			Grant:                 authorizationGrantInput(adapter, firstNonEmptyTokenValue(tokenResp, "_grant_subject", "user_id", "open_id", "sub")),
			FirstConnectionOrigin: pending.ID,
		})
	}
	return saveInputs, nil
}

func (h *OAuthHandler) persistAccountSelection(ctx context.Context, userID string, pending *models.OAuthAccountSelection, saveInputs []account_saver.SaveAccountInput) (*CompleteAccountSelectionOutput, error) {
	saver := h.accountSaver
	if saver == nil {
		saver = account_saver.NewAccountSaver(h.db, h.crypto)
	}
	if err := h.requireProviderConnectionCompletion(
		ctx, pending.Platform, pending.InstanceURL, pending.ExecutionIntent, userID,
	); err != nil {
		return nil, err
	}
	accounts, err := saver.SaveAccountsFromInputs(ctx, saveInputs)
	if err != nil {
		log.Printf("[OAuth Selection] Failed to save selected accounts: %v", err)
		return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
	}
	accountIDs := make([]string, len(accounts))
	for index, account := range accounts {
		accountIDs[index] = account.ID
	}
	firstConnection := accounts[0].ClaimedFirst
	h.captureDestinationConnected(ctx, userID, pending.WorkspaceID, pending.Platform, len(accounts), firstConnection)
	if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewUpdate().Model((*models.OAuthAccountSelection)(nil)).
			Set("consumed_at = ?", time.Now().UTC()).Where("id = ?", pending.ID).Exec(txCtx); err != nil {
			return err
		}
		_, err := tx.NewDelete().Model((*models.OAuthAccountSelectionReservation)(nil)).
			Where("selection_id = ?", pending.ID).Exec(txCtx)
		return err
	}); err != nil {
		return nil, huma.Error500InternalServerError("failed to complete account selection")
	}
	return &CompleteAccountSelectionOutput{Body: AccountSelectionCompletionResponse{
		AccountResponse:   accountResponse(*accounts[0], h.disableLinkedInThreadReplies),
		WorkspaceID:       pending.WorkspaceID,
		AccountIDs:        accountIDs,
		OpenFreshComposer: firstConnection,
	}}, nil
}

func (h *OAuthHandler) captureDestinationConnected(
	ctx context.Context,
	userID, workspaceID, platformName string,
	accountCount int,
	firstConnection bool,
) {
	if !firstConnection || h.telemetry == nil {
		return
	}
	if err := h.telemetry.Capture(ctx, telemetry.Event{
		Name: telemetry.EventDestinationConnected, DistinctID: userID, WorkspaceID: workspaceID,
		Properties: map[string]any{"platform": platformName, "account_count": accountCount},
	}); err != nil {
		log.Printf("Failed to enqueue destination connection telemetry: %v", err)
	}
}

func (h *OAuthHandler) reservePendingAccountSelection(ctx context.Context, selectionID string) error {
	now := time.Now().UTC()
	if _, err := h.db.NewDelete().Model((*models.OAuthAccountSelectionReservation)(nil)).
		Where("selection_id = ?", selectionID).
		Where("reserved_at < ?", now.Add(-10*time.Minute)).Exec(ctx); err != nil {
		return huma.Error500InternalServerError("failed to reserve account selection")
	}
	result, err := h.db.NewInsert().Model(&models.OAuthAccountSelectionReservation{
		SelectionID: selectionID,
		ReservedAt:  now,
	}).On("CONFLICT (selection_id) DO NOTHING").Exec(ctx)
	if err != nil {
		return huma.Error500InternalServerError("failed to reserve account selection")
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return huma.Error500InternalServerError("failed to reserve account selection")
	}
	if rows != 1 {
		return huma.Error404NotFound("account selection not found or expired")
	}
	return nil
}

func (h *OAuthHandler) loadPendingAccountSelection(ctx context.Context, connectionID, userID string) (*models.OAuthAccountSelection, error) {
	var pending models.OAuthAccountSelection
	err := h.db.NewSelect().
		Model(&pending).
		Where("id = ?", connectionID).
		Where("user_id = ?", userID).
		Where("consumed_at IS NULL").
		Where("expires_at > ?", time.Now().UTC()).
		Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("account selection not found or expired")
		}
		return nil, huma.Error500InternalServerError("failed to fetch account selection")
	}
	if err := h.checkWorkspaceEditAccess(ctx, pending.WorkspaceID, userID); err != nil {
		return nil, err
	}
	return &pending, nil
}

func (h *OAuthHandler) tokenResultFromPendingSelection(pending *models.OAuthAccountSelection) (*platform.TokenResult, error) {
	if pending == nil {
		return nil, fmt.Errorf("pending selection is required")
	}
	if h.crypto == nil {
		return nil, fmt.Errorf("token encryptor is not configured")
	}

	accessToken, err := h.crypto.Decrypt(pending.AccessTokenEnc)
	if err != nil {
		return nil, err
	}

	refreshToken := ""
	if len(pending.RefreshTokenEnc) > 0 {
		refreshToken, err = h.crypto.Decrypt(pending.RefreshTokenEnc)
		if err != nil {
			return nil, err
		}
	}

	extra := map[string]string{}
	if strings.TrimSpace(pending.TokenExtraJSON) != "" {
		if err := json.Unmarshal([]byte(pending.TokenExtraJSON), &extra); err != nil {
			return nil, err
		}
	}
	refreshExpiresIn := 0
	if rawExpiry := strings.TrimSpace(extra[pendingSelectionRefreshExpiresAtKey]); rawExpiry != "" {
		delete(extra, pendingSelectionRefreshExpiresAtKey)
		refreshExpiresAt, err := time.Parse(time.RFC3339Nano, rawExpiry)
		if err != nil {
			return nil, fmt.Errorf("parse pending refresh token expiry: %w", err)
		}
		refreshExpiresIn = int(time.Until(refreshExpiresAt).Seconds())
		if refreshExpiresIn < 0 {
			refreshExpiresIn = 0
		}
	}

	expiresIn := 0
	if !pending.TokenExpiresAt.IsZero() {
		expiresIn = int(time.Until(pending.TokenExpiresAt).Seconds())
		if expiresIn < 0 {
			expiresIn = 0
		}
	}

	return &platform.TokenResult{
		AccessToken:      accessToken,
		RefreshToken:     refreshToken,
		ExpiresIn:        expiresIn,
		RefreshExpiresIn: refreshExpiresIn,
		TokenType:        pending.TokenType,
		Extra:            extra,
	}, nil
}

func parseAccountSelectionOptions(raw string) ([]platform.AccountSelectionOption, error) {
	var options []platform.AccountSelectionOption
	if strings.TrimSpace(raw) == "" {
		return options, nil
	}
	if err := json.Unmarshal([]byte(raw), &options); err != nil {
		return nil, err
	}
	return options, nil
}

func (h *OAuthHandler) checkWorkspaceAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := workspaceReadAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError("failed to check workspace access")
	}
	if !allowed {
		return huma.Error403Forbidden("workspace not accessible")
	}
	return nil
}

func (h *OAuthHandler) checkWorkspaceEditAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := workspaceEditAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError("failed to check workspace access")
	}
	if !allowed {
		return huma.Error403Forbidden("workspace editor role required")
	}
	return nil
}

func (h *OAuthHandler) ListAccounts(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-accounts",
		Method:      http.MethodGet,
		Path:        "/accounts",
		Summary:     "List connected social accounts for a workspace",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *ListAccountsInput) (*ListAccountsOutput, error) {
		userID := middleware.GetUserID(ctx)
		if err := h.checkWorkspaceAccess(ctx, input.WorkspaceID, userID); err != nil {
			return nil, err
		}
		accounts, err := h.listWorkspaceAccounts(ctx, input.WorkspaceID)
		if err != nil {
			return nil, err
		}
		if installationID := middleware.GetInstallationID(ctx); installationID != "" {
			accounts, err = filterExternalAppAccounts(ctx, h.db, installationID, input.WorkspaceID, accounts)
			if err != nil {
				return nil, huma.Error500InternalServerError("failed to apply external application account grants")
			}
		}
		grantCounts := countGrantDestinations(accounts)
		supported, enabled := h.resolveListMessaging(ctx, input.WorkspaceID, userID, accounts)
		response := buildListResponses(accounts, grantCounts, supported, enabled, h.disableLinkedInThreadReplies)
		if h.connectorStore != nil {
			var bindings []models.ProviderAccountBinding
			if err := h.db.NewSelect().Model(&bindings).
				Where("workspace_id = ?", input.WorkspaceID).Scan(ctx); err != nil {
				return nil, huma.Error500InternalServerError("failed to list connector account bindings")
			}
			installationByAccount := make(map[string]string, len(bindings))
			for _, binding := range bindings {
				installationByAccount[binding.SocialAccountID] = binding.InstallationID
			}
			for index := range response {
				response[index].ProviderInstallationID = installationByAccount[response[index].ID]
			}
		}
		return &ListAccountsOutput{Body: response}, nil
	})
}

func filterExternalAppAccounts(ctx context.Context, db *bun.DB, installationID, workspaceID string, accounts []models.SocialAccount) ([]models.SocialAccount, error) {
	var grant models.ExternalAppWorkspaceGrant
	if err := db.NewSelect().Model(&grant).Where("installation_id = ? AND workspace_id = ? AND revoked_at IS NULL", installationID, workspaceID).Scan(ctx); err != nil {
		return nil, err
	}
	var rows []models.ExternalAppAccountGrant
	if err := db.NewSelect().Model(&rows).Where("installation_id = ? AND workspace_id = ?", installationID, workspaceID).Scan(ctx); err != nil {
		return nil, err
	}
	allowed := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		allowed[row.SocialAccountID] = struct{}{}
	}
	out := make([]models.SocialAccount, 0, len(accounts))
	for _, account := range accounts {
		if _, ok := allowed[account.ID]; ok {
			out = append(out, account)
		}
	}
	return out, nil
}

func (h *OAuthHandler) listWorkspaceAccounts(ctx context.Context, workspaceID string) ([]models.SocialAccount, error) {
	var accounts []models.SocialAccount
	err := h.db.NewSelect().Model(&accounts).Where("workspace_id = ?", workspaceID).Where("is_active = ?", true).Order("created_at DESC").Scan(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to list accounts")
	}
	return accounts, nil
}

func countGrantDestinations(accounts []models.SocialAccount) map[string]int {
	counts := make(map[string]int, len(accounts))
	for _, acc := range accounts {
		if acc.OAuthGrantID != "" {
			counts[acc.OAuthGrantID]++
		}
	}
	return counts
}

func (h *OAuthHandler) resolveListMessaging(ctx context.Context, workspaceID, userID string, accounts []models.SocialAccount) (map[string]bool, map[string]bool) {
	if h.accountFeatures == nil || len(accounts) == 0 {
		return map[string]bool{}, map[string]bool{}
	}
	ids := make([]string, len(accounts))
	for i, a := range accounts {
		ids[i] = a.ID
	}
	actor := workspaceActor(ctx, userID)
	features, err := h.accountFeatures.Read(ctx, workspaceID, actor, ids)
	if err != nil {
		return map[string]bool{}, map[string]bool{}
	}
	supported := make(map[string]bool, len(features))
	enabled := make(map[string]bool, len(features))
	for _, f := range features {
		if f.Feature == accountfeatures.FeatureMessaging {
			supported[f.SocialAccountID] = f.Supported
			enabled[f.SocialAccountID] = f.EffectiveEnabled
		}
	}
	return supported, enabled
}

func buildListResponses(accounts []models.SocialAccount, grantCounts map[string]int, supported, enabled map[string]bool, disableLinkedInReplies bool) []AccountResponse {
	response := make([]AccountResponse, len(accounts))
	for i, acc := range accounts {
		resp := accountResponse(acc, disableLinkedInReplies)
		if sup, ok := supported[acc.ID]; ok {
			resp.MessagingSupported = sup
		}
		if en, ok := enabled[acc.ID]; ok {
			resp.MessagesEnabled = en
		} else if _, ok := supported[acc.ID]; ok {
			resp.MessagesEnabled = false
		}
		resp.GrantDestinationCount = max(grantCounts[acc.OAuthGrantID], 1)
		resp.SharedGrant = resp.GrantDestinationCount > 1
		response[i] = resp
	}
	return response
}

func (h *OAuthHandler) UpdateAccount(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "update-account",
		Method:      http.MethodPatch,
		Path:        "/accounts/{account_id}",
		Summary:     "Update a social account",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, func(ctx context.Context, input *UpdateAccountInput) (*UpdateAccountOutput, error) {
		slug := strings.TrimSpace(input.Body.Slug)
		if err := validateAccountSlug(slug); err != nil {
			return nil, err
		}
		account, err := h.getEditableAccount(ctx, input.AccountID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		if err := h.handleUpdateMessaging(ctx, account, input.Body.MessagesEnabled); err != nil {
			return nil, err
		}
		if err := h.ensureSlugAvailable(ctx, account.WorkspaceID, account.ID, slug); err != nil {
			return nil, err
		}
		if err := h.updateAccountSlug(ctx, account.ID, slug); err != nil {
			return nil, err
		}
		updated, err := h.fetchUpdatedAccount(ctx, account.ID)
		if err != nil {
			return nil, err
		}
		resp := accountResponse(updated, h.disableLinkedInThreadReplies)
		resp = h.enrichResponseMessaging(ctx, updated, middleware.GetUserID(ctx), resp)
		return &UpdateAccountOutput{Body: resp}, nil
	})
}

func (h *OAuthHandler) RefreshAccountMetadata(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "refresh-account-metadata",
		Method:      http.MethodPost,
		Path:        "/accounts/{account_id}/refresh-metadata",
		Summary:     "Refresh a connected account's provider profile metadata",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404, 409, 501, 502},
	}, func(ctx context.Context, input *RefreshAccountMetadataInput) (*RefreshAccountMetadataOutput, error) {
		account, err := h.getEditableAccount(ctx, input.AccountID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		if h.tokenSource == nil {
			return nil, huma.Error501NotImplemented("account metadata refresh is unavailable")
		}
		if h.connectorStore != nil {
			_, bindingErr := h.connectorStore.BindingForAccount(ctx, account.WorkspaceID, account.ID)
			switch {
			case bindingErr == nil:
				return nil, huma.Error501NotImplemented("profile refresh is unavailable for connector accounts")
			case !errors.Is(bindingErr, sql.ErrNoRows):
				return nil, huma.Error500InternalServerError("failed to resolve the account provider")
			}
		}

		adapter, _ := h.provider(platform.AccountProviderKey(account.Platform, account.InstanceURL, account.CapabilityState))
		if adapter == nil {
			return nil, huma.Error501NotImplemented("profile refresh is unavailable for this account provider")
		}
		accessToken, err := h.tokenSource.GetValidAccessToken(ctx, account.ID)
		if err != nil {
			return nil, huma.Error502BadGateway("the provider access token could not be loaded")
		}
		updated, err := h.refreshAccountProfile(ctx, account, adapter, accessToken)
		if err != nil {
			return nil, err
		}
		resp := accountResponse(updated, h.disableLinkedInThreadReplies)
		resp = h.enrichResponseMessaging(ctx, updated, middleware.GetUserID(ctx), resp)
		return &RefreshAccountMetadataOutput{Body: resp}, nil
	})
}

func (h *OAuthHandler) refreshAccountProfile(ctx context.Context, account models.SocialAccount, adapter platform.Adapter, accessToken string) (models.SocialAccount, error) {
	profile, err := refreshProviderAccountMetadata(ctx, adapter, accessToken, account)
	if err != nil {
		if errors.Is(err, platform.ErrAccountMetadataRefreshUnsupported) {
			return models.SocialAccount{}, huma.Error501NotImplemented("profile refresh is unavailable for this account type")
		}
		return models.SocialAccount{}, huma.Error502BadGateway("the provider profile could not be refreshed")
	}
	if profile == nil || strings.TrimSpace(profile.ID) == "" {
		return models.SocialAccount{}, huma.Error502BadGateway("the provider returned an invalid account profile")
	}
	if strings.TrimSpace(profile.ID) != strings.TrimSpace(account.AccountID) {
		return models.SocialAccount{}, huma.Error409Conflict("the provider returned a different account identity; reconnect this account instead")
	}
	cachedAvatarURL := ""
	if account.Platform == "linkedin" && h.accountAvatars != nil && strings.TrimSpace(profile.AvatarURL) != "" {
		cachedAvatarURL, err = h.accountAvatars.CacheLinkedIn(ctx, account.ID, profile.AvatarURL)
		if err != nil {
			log.Printf("failed to cache LinkedIn avatar for account %s: %v", account.ID, err)
			return models.SocialAccount{}, huma.Error502BadGateway("the provider profile photo could not be saved")
		}
		cachedProfile := *profile
		cachedProfile.AvatarURL = cachedAvatarURL
		profile = &cachedProfile
	}

	if err := h.updateAccountProfileMetadata(ctx, account, profile); err != nil {
		if cachedAvatarURL != "" {
			_ = h.accountAvatars.Delete(ctx, cachedAvatarURL)
		}
		return models.SocialAccount{}, err
	}
	if cachedAvatarURL != "" && account.AccountAvatarURL != cachedAvatarURL {
		_ = h.accountAvatars.Delete(ctx, account.AccountAvatarURL)
	}
	return h.fetchUpdatedAccount(ctx, account.ID)
}

func (h *OAuthHandler) SetAccountAvatarStorage(storage mediastore.BlobStorage) {
	if storage == nil {
		h.accountAvatars = nil
		return
	}
	h.accountAvatars = accountavatar.New(storage)
}

func (h *OAuthHandler) updateAccountProfileMetadata(ctx context.Context, account models.SocialAccount, profile *platform.UserProfile) error {
	username := strings.TrimSpace(firstNonEmpty(profile.Username, profile.DisplayName))
	avatarURL := strings.TrimSpace(profile.AvatarURL)
	if username == "" && avatarURL == "" {
		return nil
	}

	query := h.db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Where("id = ? AND workspace_id = ? AND account_id = ? AND is_active = ?", account.ID, account.WorkspaceID, account.AccountID, true)
	if username != "" {
		query = query.Set("account_username = ?", username)
	}
	if avatarURL != "" {
		query = query.Set("account_avatar_url = ?", avatarURL)
	}
	result, err := query.Exec(ctx)
	if err != nil {
		return huma.Error500InternalServerError("failed to update account metadata")
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return huma.Error500InternalServerError("failed to verify account metadata update")
	}
	if updated != 1 {
		return huma.Error409Conflict("the account changed while its profile was refreshing; try again")
	}
	return nil
}

func refreshProviderAccountMetadata(ctx context.Context, adapter platform.Adapter, accessToken string, account models.SocialAccount) (*platform.UserProfile, error) {
	if refresher, ok := adapter.(platform.AccountMetadataRefresher); ok {
		capabilityState := map[string]string{}
		_ = json.Unmarshal([]byte(account.CapabilityState), &capabilityState)
		return refresher.RefreshAccountMetadata(ctx, accessToken, platform.AccountMetadataRequest{
			AccountID: account.AccountID, CapabilityState: capabilityState,
		})
	}
	return adapter.GetProfile(ctx, accessToken)
}

func validateAccountSlug(slug string) error {
	if !accountSlugPattern.MatchString(slug) || strings.Contains(slug, "--") {
		return huma.Error400BadRequest("slug must be 1-63 lowercase letters, numbers, and single hyphens")
	}
	return nil
}

func (h *OAuthHandler) handleUpdateMessaging(ctx context.Context, account models.SocialAccount, messagesEnabled *bool) error {
	if messagesEnabled == nil {
		return nil
	}
	if h.accountFeatures != nil {
		return h.handleFeatureMessagingUpdate(ctx, account, *messagesEnabled)
	}
	return h.handleLegacyMessagingUpdate(ctx, account, *messagesEnabled)
}

func (h *OAuthHandler) handleFeatureMessagingUpdate(ctx context.Context, account models.SocialAccount, enabled bool) error {
	actor := workspaceActor(ctx, middleware.GetUserID(ctx))
	features, err := h.accountFeatures.Read(ctx, account.WorkspaceID, actor, []string{account.ID})
	if err != nil {
		return huma.Error500InternalServerError("failed to resolve feature support")
	}
	supported := false
	for _, f := range features {
		if f.Feature == accountfeatures.FeatureMessaging {
			supported = f.Supported
		}
	}
	if enabled && !supported {
		return huma.Error400BadRequest("messages are not supported for this provider")
	}
	if _, err := h.accountFeatures.BatchSave(ctx, account.WorkspaceID, actor, []accountfeatures.ChoiceInput{{
		AccountID: account.ID,
		Feature:   accountfeatures.FeatureMessaging,
		Enabled:   enabled,
		Source:    "legacy_patch",
	}}); err != nil {
		return huma.Error400BadRequest(err.Error())
	}
	return nil
}

func (h *OAuthHandler) handleLegacyMessagingUpdate(ctx context.Context, account models.SocialAccount, enabled bool) error {
	capabilityState := map[string]string{}
	_ = json.Unmarshal([]byte(account.CapabilityState), &capabilityState)
	if enabled && !accountMessagingSupported(account.Platform) {
		return huma.Error400BadRequest("messages are not supported for this provider")
	}
	capabilityState["messages_enabled"] = strings.TrimSpace(fmt.Sprintf("%t", enabled))
	encoded, _ := json.Marshal(capabilityState)
	if _, err := h.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("capability_state_json = ?", string(encoded)).Where("id = ?", account.ID).Exec(ctx); err != nil {
		return huma.Error500InternalServerError("failed to update account")
	}
	return nil
}

func (h *OAuthHandler) ensureSlugAvailable(ctx context.Context, workspaceID, accountID, slug string) error {
	var existing models.SocialAccount
	err := h.db.NewSelect().Model(&existing).Where("workspace_id = ?", workspaceID).Where("slug = ?", slug).Where("id != ?", accountID).Where("is_active = ?", true).Scan(ctx)
	if err == nil {
		return huma.Error409Conflict("slug is already used by another active account in this workspace")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return huma.Error500InternalServerError("failed to check slug uniqueness")
	}
	return nil
}

func (h *OAuthHandler) updateAccountSlug(ctx context.Context, accountID, slug string) error {
	if _, err := h.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("slug = ?", slug).Where("id = ?", accountID).Exec(ctx); err != nil {
		return huma.Error500InternalServerError("failed to update account")
	}
	return nil
}

func (h *OAuthHandler) fetchUpdatedAccount(ctx context.Context, accountID string) (models.SocialAccount, error) {
	var account models.SocialAccount
	if err := h.db.NewSelect().Model(&account).Where("id = ?", accountID).Scan(ctx); err != nil {
		return account, huma.Error500InternalServerError("failed to fetch account")
	}
	return account, nil
}

func (h *OAuthHandler) enrichResponseMessaging(ctx context.Context, account models.SocialAccount, userID string, resp AccountResponse) AccountResponse {
	if h.accountFeatures == nil {
		return resp
	}
	actor := workspaceActor(ctx, userID)
	features, err := h.accountFeatures.Read(ctx, account.WorkspaceID, actor, []string{account.ID})
	if err != nil {
		return resp
	}
	for _, f := range features {
		if f.Feature == accountfeatures.FeatureMessaging {
			resp.MessagingSupported = f.Supported
			resp.MessagesEnabled = f.EffectiveEnabled
		}
	}
	return resp
}

type DisconnectAccountInput struct {
	AccountID string `path:"account_id"`
}

type RevokeAccountGrantInput struct {
	AccountID string `path:"account_id"`
}

func (h *OAuthHandler) DisconnectAccount(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "disconnect-account",
		Method:      http.MethodDelete,
		Path:        "/accounts/{account_id}",
		Summary:     "Disconnect one social destination without revoking its provider grant",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{404, 409},
	}, func(ctx context.Context, input *DisconnectAccountInput) (*struct{}, error) {
		account, err := h.getEditableAccount(ctx, input.AccountID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		if account.OAuthGrantID == "" {
			return nil, huma.Error409Conflict(lastGrantDestinationMessage)
		}

		err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			lockResult, err := tx.NewUpdate().Model((*models.OAuthGrant)(nil)).
				Set("updated_at = updated_at").
				Where("id = ? AND workspace_id = ? AND revoked_at IS NULL", account.OAuthGrantID, account.WorkspaceID).
				Exec(txCtx)
			if err != nil {
				return err
			}
			locked, err := lockResult.RowsAffected()
			if err != nil {
				return err
			}
			if locked != 1 {
				return sql.ErrNoRows
			}

			activeDestinations, err := tx.NewSelect().Model((*models.SocialAccount)(nil)).
				Where("oauth_grant_id = ? AND workspace_id = ? AND is_active = ?", account.OAuthGrantID, account.WorkspaceID, true).
				Count(txCtx)
			if err != nil {
				return err
			}
			if activeDestinations <= 1 {
				return errLastGrantDestination
			}

			result, err := tx.NewUpdate().Model((*models.SocialAccount)(nil)).
				Set("is_active = ?", false).
				Where("id = ? AND workspace_id = ? AND oauth_grant_id = ? AND is_active = ?", account.ID, account.WorkspaceID, account.OAuthGrantID, true).
				Exec(txCtx)
			if err != nil {
				return err
			}
			updated, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if updated != 1 {
				return sql.ErrNoRows
			}
			return nil
		})
		if errors.Is(err, errLastGrantDestination) {
			return nil, huma.Error409Conflict(lastGrantDestinationMessage)
		}
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("active provider grant not found")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to disconnect account")
		}

		return nil, nil
	})
}

func (h *OAuthHandler) RevokeAccountGrant(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "revoke-account-grant",
		Method:      http.MethodDelete,
		Path:        "/accounts/{account_id}/grant",
		Summary:     "Revoke a provider grant and disconnect every destination that uses it",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404, 502},
	}, func(ctx context.Context, input *RevokeAccountGrantInput) (*struct{}, error) {
		userID := middleware.GetUserID(ctx)
		account, err := h.getEditableAccount(ctx, input.AccountID, userID)
		if err != nil {
			return nil, err
		}
		if err := h.revokeProviderAuthorization(ctx, account); err != nil {
			log.Printf("failed to revoke provider authorization account=%s provider=%s: %v", account.ID, account.Platform, err)
			return nil, huma.Error502BadGateway("failed to revoke provider authorization")
		}
		now := time.Now().UTC()
		if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			if account.OAuthGrantID == "" {
				_, err := tx.NewUpdate().Model((*models.SocialAccount)(nil)).
					Set("is_active = ?", false).
					Set("access_token_encrypted = ?", []byte{}).
					Set("refresh_token_encrypted = ?", []byte{}).
					Set("token_expires_at = NULL").
					Set("error_message = ?", "Provider authorization revoked").
					Where("id = ?", account.ID).
					Exec(txCtx)
				return err
			}

			result, err := tx.NewUpdate().Model((*models.OAuthGrant)(nil)).
				Set("access_token_encrypted = ?", []byte{}).
				Set("refresh_token_encrypted = ?", []byte{}).
				Set("access_token_expires_at = NULL").
				Set("refresh_token_expires_at = NULL").
				Set("token_version = token_version + 1").
				Set("refresh_lease_owner = ''").
				Set("refresh_lease_expires_at = NULL").
				Set("revoked_by_id = ?", userID).
				Set("revocation_reason = ?", "user_revoked").
				Set("revoked_at = ?", now).
				Set("validation_status = ?", "revoked").
				Set("updated_at = ?", now).
				Where("id = ? AND workspace_id = ? AND revoked_at IS NULL", account.OAuthGrantID, account.WorkspaceID).
				Exec(txCtx)
			if err != nil {
				return err
			}
			rows, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if rows == 0 {
				var exists int
				if err := tx.NewSelect().Model((*models.OAuthGrant)(nil)).
					ColumnExpr("COUNT(*)").
					Where("id = ? AND workspace_id = ?", account.OAuthGrantID, account.WorkspaceID).
					Scan(txCtx, &exists); err != nil {
					return err
				}
				if exists == 0 {
					return sql.ErrNoRows
				}
			}
			if _, err := tx.NewUpdate().Model((*models.SocialAccount)(nil)).
				Set("is_active = ?", false).
				Set("error_message = ?", "Provider authorization revoked").
				Where("oauth_grant_id = ? AND workspace_id = ?", account.OAuthGrantID, account.WorkspaceID).
				Exec(txCtx); err != nil {
				return err
			}
			return tokenmanager.CancelGrantRefreshJobs(txCtx, tx, account.OAuthGrantID)
		}); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound("provider grant not found")
			}
			return nil, huma.Error500InternalServerError("failed to revoke provider grant")
		}
		return nil, nil
	})
}

func (h *OAuthHandler) revokeProviderAuthorization(ctx context.Context, account models.SocialAccount) error {
	key := account.Platform
	if account.Platform == mastodonProvider || account.Platform == "bluesky" {
		key = platform.AccountProviderKey(account.Platform, account.InstanceURL, "")
	}
	adapter, _ := h.provider(key)
	revoker, ok := adapter.(platform.AuthorizationRevoker)
	if !ok {
		return nil
	}

	var encrypted []byte
	if account.OAuthGrantID == "" {
		encrypted = account.AccessTokenEnc
	} else {
		var grant models.OAuthGrant
		if err := h.db.NewSelect().Model(&grant).
			Column("access_token_encrypted").
			Where("id = ? AND workspace_id = ? AND revoked_at IS NULL", account.OAuthGrantID, account.WorkspaceID).
			Scan(ctx); err != nil {
			return err
		}
		encrypted = grant.AccessTokenEnc
	}
	if len(encrypted) == 0 {
		return errors.New("provider authorization credential is unavailable")
	}
	accessToken, err := h.crypto.Decrypt(encrypted)
	if err != nil {
		return fmt.Errorf("decrypt provider authorization: %w", err)
	}
	return revoker.RevokeAuthorization(ctx, accessToken)
}

func (h *OAuthHandler) getAccessibleAccount(ctx context.Context, accountID, userID string) (models.SocialAccount, error) {
	var account models.SocialAccount
	err := h.db.NewSelect().
		Model(&account).
		Where("id = ?", accountID).
		Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return account, huma.Error404NotFound("account not found")
		}
		return account, huma.Error500InternalServerError("failed to fetch account")
	}

	if err := h.checkWorkspaceAccess(ctx, account.WorkspaceID, userID); err != nil {
		return account, err
	}
	return account, nil
}

func (h *OAuthHandler) getEditableAccount(ctx context.Context, accountID, userID string) (models.SocialAccount, error) {
	account, err := h.getAccessibleAccount(ctx, accountID, userID)
	if err != nil {
		return account, err
	}
	if err := h.checkWorkspaceEditAccess(ctx, account.WorkspaceID, userID); err != nil {
		return account, err
	}
	return account, nil
}

func accountResponse(acc models.SocialAccount, disableLinkedInThreadReplies bool) AccountResponse {
	threadRepliesSupported := !disableLinkedInThreadReplies || acc.Platform != "linkedin"
	var capabilityCheckedAt *time.Time
	if !acc.CapabilityCheckedAt.IsZero() {
		checkedAt := acc.CapabilityCheckedAt
		capabilityCheckedAt = &checkedAt
	}
	capabilityState := map[string]string{}
	_ = json.Unmarshal([]byte(acc.CapabilityState), &capabilityState)
	fediverseSoftware := capabilityState["fediverse_software"]
	if fediverseSoftware == "" {
		switch acc.Platform {
		case mastodonProvider, pixelfedProvider, "peertube", "lemmy", "piefed":
			fediverseSoftware = acc.Platform
		}
	}
	accountKind := firstNonEmpty(
		capabilityState["linkedin_account_type"],
		capabilityState["instagram_account_type"],
		capabilityState["connection_type"],
	)

	return AccountResponse{
		ID:                     acc.ID,
		Slug:                   acc.Slug,
		Platform:               acc.Platform,
		AccountID:              acc.AccountID,
		AccountUsername:        acc.AccountUsername,
		AccountAvatarURL:       acc.AccountAvatarURL,
		InstanceURL:            acc.InstanceURL,
		IsActive:               acc.IsActive,
		LimitProfile:           accountLimitProfile(acc),
		CapabilityCheckedAt:    capabilityCheckedAt,
		ThreadRepliesSupported: threadRepliesSupported,
		AccountKind:            accountKind,
		FediverseSoftware:      fediverseSoftware,
		MessagingSupported:     accountMessagingSupported(acc.Platform),
		MessagesEnabled:        capabilityState["messages_enabled"] == "true",
		GrantDestinationCount:  1,
	}
}

func accountMessagingSupported(provider string) bool {
	switch provider {
	case "x", "bluesky", "mastodon", "facebook", "instagram":
		return true
	default:
		return false
	}
}
