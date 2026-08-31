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
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/connectors"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	account_saver "github.com/openpost/backend/internal/services/account_saver"
	"github.com/openpost/backend/internal/services/accountfeatures"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mastodonapps"
	"github.com/openpost/backend/internal/services/oauthstate"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/uptrace/bun"
)

const mastodonProvider = "mastodon"

const pendingAccountSelectionTTL = 20 * time.Minute

const pendingSelectionRefreshExpiresAtKey = "_openpost_refresh_token_expires_at"

const lastGrantDestinationMessage = "this is the last destination for this authorization; revoke the authorization to remove it and clear its credentials"

var errLastGrantDestination = errors.New("last active oauth grant destination")

type OAuthHandler struct {
	db                           *bun.DB
	crypto                       *crypto.TokenEncryptor
	providers                    map[string]platform.Adapter
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
	}
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

func (h *OAuthHandler) ProviderMap() map[string]platform.Adapter {
	return h.providers
}

type MastodonServerInfo struct {
	Name        string `json:"name" doc:"Server configuration name"`
	InstanceURL string `json:"instance_url" doc:"Mastodon instance URL"`
}

type ProviderInfo struct {
	Platform       string                     `json:"platform" doc:"Provider key"`
	InstallationID string                     `json:"installation_id,omitempty" doc:"Operator installation used for a custom connector"`
	DisplayName    string                     `json:"display_name" doc:"Human-readable provider name"`
	AuthMode       string                     `json:"auth_mode" doc:"Connection method: oauth, app_password, or oauth_oob"`
	Configured     bool                       `json:"configured" doc:"Whether this provider can currently be connected"`
	Status         string                     `json:"status,omitempty" doc:"Provider launch status: available, needs_configuration, or planned"`
	Description    string                     `json:"description,omitempty" doc:"Short connection or launch note for this provider"`
	Capabilities   []string                   `json:"capabilities,omitempty" doc:"High-level OpenPost capabilities available or planned for this provider"`
	Name           string                     `json:"name,omitempty" doc:"Provider app or server display name"`
	InstanceURL    string                     `json:"instance_url,omitempty" doc:"Federated server URL, when applicable"`
	Readiness      providerreadiness.Decision `json:"readiness"`
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
	Platform    string `path:"platform" doc:"Social platform (x, mastodon, bluesky, linkedin, threads, instagram, facebook, tiktok, youtube)"`
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

var accountSlugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

const (
	providerStatusAvailable          = "available"
	providerStatusNeedsConfiguration = "needs_configuration"
	providerStatusPlanned            = "planned"
)

var coreProviderCapabilities = []string{"Text posts", "Media posts", "Scheduling", "Platform variants", "MCP workflows"}

var providerCatalog = []ProviderInfo{
	{
		Platform:     "bluesky",
		DisplayName:  "Bluesky",
		AuthMode:     "app_password",
		Description:  "Handle and app-password connection with no server app setup.",
		Capabilities: coreProviderCapabilities,
	},
	{
		Platform:     "discord",
		DisplayName:  "Discord",
		AuthMode:     "webhook",
		Description:  "Connect a Discord channel with its incoming webhook URL.",
		Capabilities: []string{"Text posts", "Media attachments", "Scheduling", "Message deletion", "MCP workflows"},
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
	if platform == mastodonProvider {
		if serverName == "" {
			return nil, fmt.Errorf("server_name required for mastodon")
		}
		key := "mastodon:" + serverName
		adapter, ok := h.providers[key]
		if !ok {
			return nil, fmt.Errorf("unknown mastodon server: %s", serverName)
		}
		return adapter, nil
	}

	adapter, ok := h.providers[platform]
	if !ok {
		return nil, fmt.Errorf("unsupported platform: %s", platform)
	}
	return adapter, nil
}

func (h *OAuthHandler) getMastodonProvider(ctx context.Context, serverName, instanceURL string) (platform.Adapter, string, error) {
	if strings.TrimSpace(instanceURL) != "" {
		return h.getDynamicMastodonProvider(ctx, instanceURL)
	}
	adapter, err := h.getProvider(mastodonProvider, serverName)
	if err == nil {
		return adapter, mastodonInstanceURL(adapter), nil
	}
	if strings.Contains(serverName, "://") {
		requestedInstanceURL := strings.TrimRight(strings.TrimSpace(serverName), "/")
		for key, candidate := range h.providers {
			if !strings.HasPrefix(key, mastodonProvider+":") {
				continue
			}
			if configuredInstanceURL := strings.TrimRight(mastodonInstanceURL(candidate), "/"); configuredInstanceURL == requestedInstanceURL {
				return candidate, configuredInstanceURL, nil
			}
		}
	}
	if h.mastodonApps != nil && strings.Contains(serverName, "://") {
		return h.getDynamicMastodonProvider(ctx, serverName)
	}
	return nil, "", err
}

func (h *OAuthHandler) getDynamicMastodonProvider(ctx context.Context, instanceURL string) (platform.Adapter, string, error) {
	if h.mastodonApps == nil {
		return nil, "", fmt.Errorf("dynamic mastodon instance registration is not configured")
	}
	adapter, canonicalURL, err := h.mastodonApps.AdapterForInstance(ctx, instanceURL)
	if err != nil {
		return nil, "", err
	}
	if h.providers == nil {
		h.providers = map[string]platform.Adapter{}
	}
	h.registerProvider("mastodon:"+canonicalURL, adapter)
	if h.readiness != nil {
		configs, listErr := h.mastodonApps.ListActiveAppConfigs(ctx)
		if listErr != nil {
			return nil, "", fmt.Errorf("load dynamic mastodon readiness configuration: %w", listErr)
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
				return nil, "", fmt.Errorf("register dynamic mastodon readiness configuration: %w", registerErr)
			}
			break
		}
	}
	return adapter, canonicalURL, nil
}

func (h *OAuthHandler) registerProvider(key string, adapter platform.Adapter) {
	if h.providers == nil {
		h.providers = map[string]platform.Adapter{}
	}
	h.providers[key] = adapter
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
	infos := providerAvailability(h.providers, h.isDynamicMastodonConfigured())
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
			infos[index].Status = string(providerreadiness.EffectiveStateDegraded)
		}
		return infos
	}
	for index := range infos {
		decision := readiness.DecideConnection(
			ctx,
			infos[index].Platform,
			infos[index].InstanceURL,
			providerreadiness.ExecutionIntentProduction,
		)
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
		if item.Platform == mastodonProvider {
			mastodonProviders := mastodonProviderAvailability(providers, dynamicMastodonConfigured)
			infos = append(infos, mastodonProviders...)
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
	if item.Configured {
		item.Status = providerStatusAvailable
	} else {
		item.Status = providerStatusNeedsConfiguration
	}
	return item
}

func mastodonProviderAvailability(providers map[string]platform.Adapter, dynamicMastodonConfigured bool) []ProviderInfo {
	servers := configuredMastodonServers(providers)
	if len(servers) == 0 {
		if dynamicMastodonConfigured {
			return []ProviderInfo{dynamicMastodonInfo()}
		}
		return []ProviderInfo{{
			Platform:    mastodonProvider,
			DisplayName: "Mastodon",
			AuthMode:    "oauth_oob",
			Configured:  false,
			Status:      providerStatusNeedsConfiguration,
			Description: "Configure Mastodon servers or dynamic instance registration before connecting.",
		}}
	}

	infos := make([]ProviderInfo, 0, len(servers)+1)
	if dynamicMastodonConfigured {
		infos = append(infos, dynamicMastodonInfo())
	}
	for _, server := range servers {
		infos = append(infos, ProviderInfo{
			Platform:     mastodonProvider,
			DisplayName:  "Mastodon",
			AuthMode:     "oauth_oob",
			Configured:   true,
			Status:       providerStatusAvailable,
			Description:  "Connect this configured Mastodon instance.",
			Capabilities: coreProviderCapabilities,
			Name:         server.Name,
			InstanceURL:  server.InstanceURL,
		})
	}
	return infos
}

func dynamicMastodonInfo() ProviderInfo {
	return ProviderInfo{
		Platform:     mastodonProvider,
		DisplayName:  "Mastodon",
		AuthMode:     "oauth_oob",
		Configured:   true,
		Status:       providerStatusAvailable,
		Description:  "Connect any public Mastodon instance.",
		Capabilities: coreProviderCapabilities,
		Name:         "Custom instance",
	}
}

func (h *OAuthHandler) configuredMastodonServers() []MastodonServerInfo {
	return configuredMastodonServers(h.providers)
}

func configuredMastodonServers(providers map[string]platform.Adapter) []MastodonServerInfo {
	var servers []MastodonServerInfo
	seen := make(map[string]struct{})
	for key, adapter := range providers {
		if !strings.HasPrefix(key, "mastodon:") {
			continue
		}
		instanceURL := mastodonInstanceURL(adapter)
		if instanceURL == "" {
			continue
		}
		name := strings.TrimPrefix(key, "mastodon:")
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
	if input.Platform == mastodonProvider {
		if input.ServerName == "" && input.InstanceURL == "" {
			return nil, "", huma.Error400BadRequest("server_name or instance_url required for mastodon")
		}
		adapter, instanceURL, err := h.getMastodonProvider(ctx, input.ServerName, input.InstanceURL)
		if err != nil {
			return nil, "", huma.Error400BadRequest(err.Error())
		}
		return adapter, instanceURL, nil
	}
	adapter, err := h.getProvider(input.Platform, input.ServerName)
	if err != nil {
		return nil, "", huma.Error400BadRequest(err.Error())
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
				return h.redirectWithError(err.Error())
			}
			extra["oauth_token"] = input.OAuthToken
			extra["oauth_verifier"] = input.Verifier
		}

		if input.Platform == "x" {
			xAdapter, ok := adapter.(*platform.XAdapter)
			if !ok {
				return h.redirectWithError("x adapter type mismatch")
			}
			requestMeta, ok := xAdapter.GetRequestMetaForRequestToken(input.OAuthToken)
			if !ok {
				return h.redirectWithError("invalid or expired oauth request token")
			}
			workspaceID = requestMeta.WorkspaceID
			userID = requestMeta.UserID
			executionIntent = requestMeta.ExecutionIntent
		} else {
			statePayload, err := h.oauthStates.Consume(ctx, input.State)
			if err != nil {
				return h.redirectWithError("invalid or expired state")
			}
			if statePayload.Platform != input.Platform {
				return h.redirectWithError("oauth state platform mismatch")
			}
			userID = statePayload.UserID
			workspaceID = statePayload.WorkspaceID
			executionIntent = statePayload.ExecutionIntent
			if input.Platform == mastodonProvider {
				input.ServerName = statePayload.ServerName
				instanceRef = statePayload.ServerName
			}
		}

		if err := h.checkWorkspaceEditAccess(ctx, workspaceID, userID); err != nil {
			log.Printf("[Callback] Workspace access check failed: %v", err)
			return h.redirectWithError("workspace access denied", workspaceID)
		}
		if err := h.requireProviderConnectionCompletion(
			ctx, input.Platform, instanceRef, executionIntent, userID,
		); err != nil {
			return h.redirectWithError(err.Error(), workspaceID)
		}

		if input.Platform != "x" {
			var err error
			if input.Platform == mastodonProvider {
				adapter, _, err = h.getMastodonProvider(ctx, input.ServerName, "")
				if err != nil {
					return h.redirectWithError(err.Error(), workspaceID)
				}
				instanceRef = mastodonInstanceURL(adapter)
			} else {
				adapter, err = h.getProvider(input.Platform, input.ServerName)
				if err != nil {
					return h.redirectWithError(err.Error(), workspaceID)
				}
			}
		}
		if err := h.requireProviderConnectionCompletion(
			ctx, input.Platform, instanceRef, executionIntent, userID,
		); err != nil {
			return h.redirectWithError(err.Error(), workspaceID)
		}

		tokenResp, err := adapter.ExchangeCode(ctx, input.Code, extra)
		if err != nil {
			return h.redirectWithError(fmt.Sprintf("token exchange failed: %s", err.Error()), workspaceID)
		}

		if err := h.requireProviderConnectionCompletion(
			ctx, input.Platform, instanceRef, executionIntent, userID,
		); err != nil {
			return h.redirectWithError(err.Error(), workspaceID)
		}

		if selector, ok := adapter.(platform.AccountSelectionAdapter); ok {
			if profile, profileErr := adapter.GetProfile(ctx, tokenResp.AccessToken); profileErr == nil && profile != nil && profile.ID != "" {
				if tokenResp.Extra == nil {
					tokenResp.Extra = map[string]string{}
				}
				tokenResp.Extra["_grant_subject"] = profile.ID
			}
			return h.saveAccountSelectionAndRedirect(
				ctx, userID, input.Platform, workspaceID, instanceRef,
				executionIntent, tokenResp, selector,
			)
		}

		profile, err := adapter.GetProfile(ctx, tokenResp.AccessToken)
		if err != nil {
			if input.Platform == mastodonProvider {
				profile = &platform.UserProfile{ID: "mastodon-user", Username: ""}
			} else {
				return h.redirectWithError(fmt.Sprintf("failed to get profile: %s", err.Error()), workspaceID)
			}
		}

		return h.saveAccountAndRedirect(
			ctx, userID, input.Platform, workspaceID, instanceRef, executionIntent,
			profile, tokenResp, adapter,
		)
	})
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
	query := url.Values{"tab": {"accounts"}, "oauth_status": {status}}
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
		return h.redirectWithError(fmt.Sprintf("failed to list selectable accounts: %s", err.Error()), workspaceID)
	}
	if len(options) == 0 {
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
		CapabilityState:  profile.CapabilityState,
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
	huma.Register(api, huma.Operation{
		OperationID: "exchange-mastodon-code",
		Method:      http.MethodPost,
		Path:        "/accounts/mastodon/exchange",
		Summary:     "Exchange Mastodon OOB authorization code",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400},
	}, func(ctx context.Context, input *ExchangeCodeInput) (*ExchangeCodeOutput, error) {
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
		if err := h.requireProviderConnection(ctx, mastodonProvider, requestedInstance, intent); err != nil {
			return nil, err
		}

		adapter, _, err := h.getMastodonProvider(ctx, input.Body.ServerName, input.Body.InstanceURL)
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		instanceURL := mastodonInstanceURL(adapter)
		if err := h.requireProviderConnectionCompletion(
			ctx, mastodonProvider, instanceURL, string(intent), userID,
		); err != nil {
			return nil, err
		}

		tokenResp, err := adapter.ExchangeCode(ctx, input.Body.Code, nil)
		if err != nil {
			return nil, huma.Error500InternalServerError(fmt.Sprintf("mastodon exchange failed: %s", err.Error()))
		}
		if err := h.requireProviderConnectionCompletion(
			ctx, mastodonProvider, instanceURL, string(intent), userID,
		); err != nil {
			return nil, err
		}

		profile, err := adapter.GetProfile(ctx, tokenResp.AccessToken)
		if err != nil {
			profile = &platform.UserProfile{ID: "mastodon-user", Username: ""}
		}

		if err := h.requireProviderConnectionCompletion(
			ctx, mastodonProvider, instanceURL, string(intent), userID,
		); err != nil {
			return nil, err
		}

		account, err := h.accountSaver.SaveAccountFromInput(ctx, account_saver.SaveAccountInput{
			Actor:            workspaceActor(ctx, userID),
			UserID:           userID,
			PlatformName:     mastodonProvider,
			WorkspaceID:      input.Body.WorkspaceID,
			AccountID:        profile.ID,
			AccountUsername:  profile.Username,
			AccountAvatarURL: profile.AvatarURL,
			InstanceURL:      instanceURL,
			Token:            tokenResp,
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
	})
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
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *BlueskyLoginInput) (*BlueskyLoginOutput, error) {
		userID := middleware.GetUserID(ctx)
		intent, err := h.connectionIntent(ctx, input.Body.Intent)
		if err != nil {
			return nil, err
		}
		if err := h.ensureCanStartAccountConnection(ctx, input.Body.WorkspaceID, userID); err != nil {
			return nil, err
		}

		adapter, ok := h.providers["bluesky"]
		if !ok {
			return nil, huma.Error400BadRequest("bluesky not configured")
		}
		if err := h.requireProviderConnection(ctx, "bluesky", "", intent); err != nil {
			return nil, err
		}

		blueskyAdapter, ok := adapter.(*platform.BlueskyAdapter)
		if !ok {
			return nil, huma.Error500InternalServerError("bluesky adapter type mismatch")
		}

		did, handle, accessToken, refreshToken, expiresIn, err := blueskyAdapter.CreateSession(ctx, input.Body.Handle, input.Body.AppPassword)
		if err != nil {
			return nil, huma.Error500InternalServerError(fmt.Sprintf("bluesky login failed: %s", err.Error()))
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
		providerProfile, profileErr := blueskyAdapter.GetProfile(ctx, accessToken)
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

		account, err := h.accountSaver.SaveAccountFromInput(ctx, account_saver.SaveAccountInput{
			Actor:            workspaceActor(ctx, userID),
			UserID:           userID,
			PlatformName:     "bluesky",
			WorkspaceID:      input.Body.WorkspaceID,
			AccountID:        accountID,
			AccountUsername:  firstNonEmpty(profile.Username, input.Body.Handle),
			AccountAvatarURL: profile.AvatarURL,
			InstanceURL:      "https://bsky.social",
			Token:            tokenResp,
			Grant:            authorizationGrantInput(adapter, accountID),
		})
		if err != nil {
			log.Printf("[BlueskyLogin] Failed to save account: %v", err)
			return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
		}

		resp := h.normalizedAccountConnectionResponse(input.Body.WorkspaceID, []*models.SocialAccount{account}, account.ClaimedFirst)
		return &BlueskyLoginOutput{Body: resp}, nil
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
		adapter, ok := h.providers["discord"].(*platform.DiscordAdapter)
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
	}, func(ctx context.Context, input *CompleteAccountSelectionInput) (*CompleteAccountSelectionOutput, error) {
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

		adapter, err := h.getProvider(pending.Platform, "")
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error())
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
				InstanceURL:           firstNonEmpty(selected.InstanceURL, pending.InstanceURL),
				Token:                 selected.Token,
				CapabilityState:       selected.CapabilityState,
				Grant:                 authorizationGrantInput(adapter, firstNonEmptyTokenValue(tokenResp, "_grant_subject", "user_id", "open_id", "sub")),
				FirstConnectionOrigin: pending.ID,
			})
		}

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
		selectionCompleted = true

		return &CompleteAccountSelectionOutput{Body: AccountSelectionCompletionResponse{
			AccountResponse:   accountResponse(*accounts[0], h.disableLinkedInThreadReplies),
			WorkspaceID:       pending.WorkspaceID,
			AccountIDs:        accountIDs,
			OpenFreshComposer: firstConnection,
		}}, nil
	})
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
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *RevokeAccountGrantInput) (*struct{}, error) {
		userID := middleware.GetUserID(ctx)
		account, err := h.getEditableAccount(ctx, input.AccountID, userID)
		if err != nil {
			return nil, err
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
