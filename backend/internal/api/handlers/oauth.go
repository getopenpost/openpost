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
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	account_saver "github.com/openpost/backend/internal/services/account_saver"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mastodonapps"
	"github.com/openpost/backend/internal/services/oauthstate"
	"github.com/uptrace/bun"
)

const mastodonProvider = "mastodon"

const pendingAccountSelectionTTL = 20 * time.Minute

type OAuthHandler struct {
	db                           *bun.DB
	crypto                       *crypto.TokenEncryptor
	providers                    map[string]platform.Adapter
	providerRegistrars           []func(string, platform.Adapter)
	auth                         middleware.Authenticator
	disableLinkedInThreadReplies bool
	accountSaver                 *account_saver.AccountSaver
	mastodonApps                 *mastodonapps.Service
	oauthStates                  *oauthstate.Store
	// frontendURL is the absolute base URL the SPA is served from
	// (e.g. "https://openpost.example.com"). OAuth callback redirects go
	// here so they work behind reverse proxies and subpath mounts.
	frontendURL string
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
			xAdapter.SetRequestStore(newXRequestStore(db))
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

func (h *OAuthHandler) SetEntitlement(entitlement entitlements.Service) {
	if h.accountSaver != nil {
		h.accountSaver.SetEntitlement(entitlement)
	}
}

func (h *OAuthHandler) SetMastodonAppService(service *mastodonapps.Service) {
	h.mastodonApps = service
}

func (h *OAuthHandler) SetProviderRegistrars(registrars ...func(string, platform.Adapter)) {
	h.providerRegistrars = registrars
}

type MastodonServerInfo struct {
	Name        string `json:"name" doc:"Server configuration name"`
	InstanceURL string `json:"instance_url" doc:"Mastodon instance URL"`
}

type ProviderInfo struct {
	Platform     string   `json:"platform" doc:"Provider key"`
	DisplayName  string   `json:"display_name" doc:"Human-readable provider name"`
	AuthMode     string   `json:"auth_mode" doc:"Connection method: oauth, app_password, or oauth_oob"`
	Configured   bool     `json:"configured" doc:"Whether this provider can currently be connected"`
	Status       string   `json:"status,omitempty" doc:"Provider launch status: available, needs_configuration, or planned"`
	Description  string   `json:"description,omitempty" doc:"Short connection or launch note for this provider"`
	Capabilities []string `json:"capabilities,omitempty" doc:"High-level OpenPost capabilities available or planned for this provider"`
	Name         string   `json:"name,omitempty" doc:"Provider app or server display name"`
	InstanceURL  string   `json:"instance_url,omitempty" doc:"Federated server URL, when applicable"`
}

type ListProvidersOutput struct {
	Body []ProviderInfo
}

type ListMastodonServersOutput struct {
	Body []MastodonServerInfo
}

type GetAuthURLInput struct {
	Platform    string `path:"platform" doc:"Social platform (x, mastodon, bluesky, linkedin, threads, instagram, facebook, tiktok, youtube)"`
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID to link account to"`
	ServerName  string `query:"server_name" doc:"Mastodon server name from config (required for mastodon)"`
	InstanceURL string `query:"instance_url" doc:"Mastodon instance URL to dynamically register"`
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
	}
}

type ListAccountsInput struct {
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Filter by workspace ID"`
}

type AccountResponse struct {
	ID                     string     `json:"id" doc:"Account ID"`
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
	MessagingSupported     bool       `json:"messaging_supported" doc:"Whether OpenPost has a messaging connector for this provider"`
	MessagesEnabled        bool       `json:"messages_enabled" doc:"Whether this account opted in to inbox synchronization"`
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
	Body AccountResponse
}

type UpdateAccountInput struct {
	AccountID string `path:"account_id"`
	Body      struct {
		Slug            string `json:"slug" doc:"New account slug. Use lowercase letters, numbers, and hyphens."`
		MessagesEnabled *bool  `json:"messages_enabled,omitempty" doc:"Opt this account in or out of inbox synchronization"`
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
		return adapter, serverName, nil
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
	}, func(_ context.Context, _ *struct{}) (*ListProvidersOutput, error) {
		return &ListProvidersOutput{Body: h.providerAvailability()}, nil
	})
}

func (h *OAuthHandler) providerAvailability() []ProviderInfo {
	return providerAvailability(h.providers, h.isDynamicMastodonConfigured())
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
	if err := h.accountSaver.CheckSocialAccountQuota(ctx, workspaceID); err != nil {
		return huma.Error403Forbidden(accountConnectionErrorMessage(err))
	}
	return nil
}

func (h *OAuthHandler) GetAuthURL(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-auth-url",
		Method:      http.MethodGet,
		Path:        "/accounts/{platform}/auth-url",
		Summary:     "Get OAuth authorization URL for a platform",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *GetAuthURLInput) (*GetAuthURLOutput, error) {
		if input.Platform == "bluesky" {
			return nil, huma.Error400BadRequest("bluesky uses app passwords, not OAuth redirect")
		}
		if input.WorkspaceID == "" {
			return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
		}

		userID := middleware.GetUserID(ctx)
		if err := h.ensureCanStartAccountConnection(ctx, input.WorkspaceID, userID); err != nil {
			return nil, err
		}

		if input.Platform == mastodonProvider && input.ServerName == "" && input.InstanceURL == "" {
			return nil, huma.Error400BadRequest("server_name or instance_url required for mastodon")
		}

		var (
			adapter            platform.Adapter
			serverNameForState string
			err                error
		)
		if input.Platform == mastodonProvider {
			adapter, serverNameForState, err = h.getMastodonProvider(ctx, input.ServerName, input.InstanceURL)
			if err != nil {
				return nil, huma.Error400BadRequest(err.Error())
			}
		} else {
			adapter, err = h.getProvider(input.Platform, input.ServerName)
			if err != nil {
				return nil, huma.Error400BadRequest(err.Error())
			}
		}

		if input.Platform == "x" {
			xAdapter, ok := adapter.(*platform.XAdapter)
			if !ok {
				return nil, huma.Error500InternalServerError("x adapter type mismatch")
			}
			authURL, err := xAdapter.GenerateAuthURLWithError(userID, input.WorkspaceID)
			if err != nil {
				log.Printf("[X OAuth] auth url generation failed: %v", err)
				return nil, huma.Error400BadRequest(fmt.Sprintf("x auth url generation failed: %s", err.Error()))
			}
			resp := &GetAuthURLOutput{}
			resp.Body.URL = authURL
			return resp, nil
		}

		state, err := h.oauthStates.Create(ctx, oauthstate.Payload{
			UserID:      userID,
			WorkspaceID: input.WorkspaceID,
			Platform:    input.Platform,
			ServerName:  firstNonEmpty(serverNameForState, input.ServerName),
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
	})
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
		if input.Error != "" {
			msg := input.Error
			if input.ErrorDescription != "" {
				msg = fmt.Sprintf("%s: %s", input.Error, input.ErrorDescription)
			}
			log.Printf("[OAuth Callback Error] %s", msg)
			return h.redirectWithError(msg)
		}

		if input.Code == "" && input.OAuthToken == "" {
			return h.redirectWithError("missing authorization code")
		}

		workspaceID := ""
		userID := ""
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
			ws, ok := xAdapter.GetWorkspaceIDForRequestToken(input.OAuthToken)
			if !ok {
				return h.redirectWithError("invalid or expired oauth request token")
			}
			workspaceID = ws
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
			if input.Platform == mastodonProvider {
				input.ServerName = statePayload.ServerName
			}

			if input.Platform == mastodonProvider {
				adapter, _, err = h.getMastodonProvider(ctx, input.ServerName, "")
				if err != nil {
					return h.redirectWithError(err.Error())
				}
			} else {
				adapter, err = h.getProvider(input.Platform, input.ServerName)
				if err != nil {
					return h.redirectWithError(err.Error())
				}
			}
		}

		tokenResp, err := adapter.ExchangeCode(ctx, input.Code, extra)
		if err != nil {
			return h.redirectWithError(fmt.Sprintf("token exchange failed: %s", err.Error()))
		}

		if ws, ok := extra["_workspace_id"]; ok {
			workspaceID = ws
		}
		if uid, ok := extra["_user_id"]; ok {
			userID = uid
		}
		if tokenResp.Extra != nil {
			if ws, ok := tokenResp.Extra["_workspace_id"]; ok && ws != "" {
				workspaceID = ws
			}
			if uid, ok := tokenResp.Extra["_user_id"]; ok && uid != "" {
				userID = uid
			}
		}

		if selector, ok := adapter.(platform.AccountSelectionAdapter); ok {
			return h.saveAccountSelectionAndRedirect(ctx, userID, input.Platform, workspaceID, mastodonInstanceURL(adapter), tokenResp, selector)
		}

		profile, err := adapter.GetProfile(ctx, tokenResp.AccessToken)
		if err != nil {
			if input.Platform == mastodonProvider {
				profile = &platform.UserProfile{ID: "mastodon-user", Username: ""}
			} else {
				return h.redirectWithError(fmt.Sprintf("failed to get profile: %s", err.Error()))
			}
		}

		instanceRef := ""
		if input.Platform == mastodonProvider {
			instanceRef = mastodonInstanceURL(adapter)
		}

		if err := h.checkWorkspaceEditAccess(ctx, workspaceID, userID); err != nil {
			log.Printf("[Callback] Workspace access check failed: %v", err)
			return h.redirectWithError("workspace access denied")
		}

		return h.saveAccountAndRedirect(ctx, userID, input.Platform, workspaceID, profile.ID, profile.Username, instanceRef, profile.CapabilityState, tokenResp)
	})
}

func (h *OAuthHandler) redirectWithError(msg string) (*huma.StreamResponse, error) {
	msg = strings.TrimSpace(html.UnescapeString(msg))
	if msg == "" {
		msg = "OAuth connection failed"
	}
	location := h.frontendURL + "/accounts?error=" + url.QueryEscape(msg)
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

func (h *OAuthHandler) saveAccountSelectionAndRedirect(ctx context.Context, userID, platformName, workspaceID, instanceURL string, tokenResp *platform.TokenResult, selector platform.AccountSelectionAdapter) (*huma.StreamResponse, error) {
	if err := h.checkWorkspaceEditAccess(ctx, workspaceID, userID); err != nil {
		log.Printf("[Callback] Workspace access check failed: %v", err)
		return h.redirectWithError("workspace access denied")
	}

	options, err := selector.ListAccountSelections(ctx, tokenResp)
	if err != nil {
		return h.redirectWithError(fmt.Sprintf("failed to list selectable accounts: %s", err.Error()))
	}
	if len(options) == 0 {
		return h.redirectWithError("no selectable accounts found for this provider")
	}

	pending, err := h.createPendingAccountSelection(ctx, userID, platformName, workspaceID, instanceURL, tokenResp, options)
	if err != nil {
		log.Printf("[Callback] Failed to save pending account selection: %v", err)
		return h.redirectWithError("failed to save pending account selection")
	}

	log.Printf("[Callback] Pending account selection created: ID=%s platform=%s", pending.ID, platformName)
	return h.redirectWithAccountSelection(platformName, pending.ID)
}

func (h *OAuthHandler) createPendingAccountSelection(ctx context.Context, userID, platformName, workspaceID, instanceURL string, tokenResp *platform.TokenResult, options []platform.AccountSelectionOption) (*models.OAuthAccountSelection, error) {
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

	extra := tokenResp.Extra
	if extra == nil {
		extra = map[string]string{}
	}
	extraJSON, err := json.Marshal(extra)
	if err != nil {
		return nil, err
	}

	var tokenExpiresAt time.Time
	if tokenResp.ExpiresIn > 0 {
		tokenExpiresAt = time.Now().UTC().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	}

	pending := &models.OAuthAccountSelection{
		ID:              uuid.NewString(),
		UserID:          userID,
		WorkspaceID:     workspaceID,
		Platform:        platformName,
		InstanceURL:     instanceURL,
		AccessTokenEnc:  encAccess,
		RefreshTokenEnc: encRefresh,
		TokenType:       tokenResp.TokenType,
		TokenExpiresAt:  tokenExpiresAt,
		TokenExtraJSON:  string(extraJSON),
		OptionsJSON:     string(optionsJSON),
		ExpiresAt:       time.Now().UTC().Add(pendingAccountSelectionTTL),
		CreatedAt:       time.Now().UTC(),
	}
	if _, err := h.db.NewInsert().Model(pending).Exec(ctx); err != nil {
		return nil, err
	}
	return pending, nil
}

func (h *OAuthHandler) saveAccountAndRedirect(ctx context.Context, userID, platformName, workspaceID, accountID, accountUsername, instanceURL string, capabilityState map[string]string, tokenResp *platform.TokenResult) (*huma.StreamResponse, error) {
	// For Threads, the account ID comes from the token response extra
	if tokenResp.Extra != nil {
		if uid, ok := tokenResp.Extra["user_id"]; ok && uid != "" {
			accountID = uid
		}
	}

	account, err := h.accountSaver.SaveAccountFromInput(ctx, account_saver.SaveAccountInput{
		UserID:          userID,
		PlatformName:    platformName,
		WorkspaceID:     workspaceID,
		AccountID:       accountID,
		AccountUsername: accountUsername,
		InstanceURL:     instanceURL,
		Token:           tokenResp,
		CapabilityState: capabilityState,
	})
	if err != nil {
		log.Printf("[Callback] Failed to save account: %v", err)
		return h.redirectWithError(accountConnectionErrorMessage(err))
	}

	accountsURL := h.frontendURL + "/accounts"
	log.Printf("[Callback] Account saved successfully: ID=%s, redirecting to %s", account.ID, accountsURL)

	return h.accountConnectionSuccessPage(platformName, accountsURL), nil
}

func (h *OAuthHandler) accountConnectionSuccessPage(platformName, redirectURL string) *huma.StreamResponse {
	platformLabel := strings.TrimSpace(platformName)
	if platformLabel == "" {
		platformLabel = "account"
	}

	return &huma.StreamResponse{
		Body: func(ctx huma.Context) {
			ctx.SetStatus(http.StatusOK)
			ctx.SetHeader("Content-Type", "text/html; charset=utf-8")
			_, _ = fmt.Fprintf(ctx.BodyWriter(), `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta http-equiv="refresh" content="5; url=%s">
	<title>Account connected - OpenPost</title>
	<style>
		:root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
		body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: Canvas; color: CanvasText; }
		main { width: min(92vw, 28rem); text-align: center; padding: 2rem; border: 1px solid color-mix(in srgb, CanvasText 14%%, transparent); border-radius: .75rem; }
		.mark { width: 4rem; height: 4rem; margin: 0 auto 1rem; display: grid; place-items: center; border-radius: 999px; background: color-mix(in srgb, #10b981 16%%, transparent); color: #059669; font-size: 2rem; }
		h1 { margin: 0; font-size: 1.5rem; }
		p { color: color-mix(in srgb, CanvasText 68%%, transparent); line-height: 1.5; }
		a { display: inline-flex; align-items: center; justify-content: center; min-height: 2.5rem; padding: 0 .9rem; border-radius: .5rem; background: CanvasText; color: Canvas; text-decoration: none; font-weight: 600; }
	</style>
</head>
<body>
	<main>
		<div class="mark">✓</div>
		<h1>Account connected</h1>
		<p>Your %s connection was saved. You will be sent back to Accounts in 5 seconds.</p>
		<a href="%s">Go to Accounts</a>
	</main>
	<script>setTimeout(function () { window.location.assign(%q); }, 5000);</script>
</body>
</html>`,
				html.EscapeString(redirectURL),
				html.EscapeString(platformLabel),
				html.EscapeString(redirectURL),
				redirectURL,
			)
		},
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
	}, func(ctx context.Context, input *ExchangeCodeInput) (*struct{}, error) {
		userID := middleware.GetUserID(ctx)
		if err := h.ensureCanStartAccountConnection(ctx, input.Body.WorkspaceID, userID); err != nil {
			return nil, err
		}

		adapter, _, err := h.getMastodonProvider(ctx, input.Body.ServerName, input.Body.InstanceURL)
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}

		tokenResp, err := adapter.ExchangeCode(ctx, input.Body.Code, nil)
		if err != nil {
			return nil, huma.Error500InternalServerError(fmt.Sprintf("mastodon exchange failed: %s", err.Error()))
		}

		profile, err := adapter.GetProfile(ctx, tokenResp.AccessToken)
		if err != nil {
			profile = &platform.UserProfile{ID: "mastodon-user", Username: ""}
		}

		instanceURL := mastodonInstanceURL(adapter)

		// Delegate saving the account (encrypting tokens and inserting) to AccountSaver
		if _, err := h.accountSaver.SaveAccount(ctx, userID, mastodonProvider, input.Body.WorkspaceID, profile.ID, profile.Username, instanceURL, tokenResp); err != nil {
			log.Printf("[ExchangeCode] Failed to save account: %v", err)
			return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
		}

		log.Printf("[ExchangeCode] Account saved successfully")

		return nil, nil
	})
}

type BlueskyLoginInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" doc:"Workspace ID"`
		Handle      string `json:"handle" doc:"Bluesky handle (e.g. user.bsky.social)"`
		AppPassword string `json:"app_password" doc:"Bluesky app password (Settings > App Passwords)"`
	}
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
	}, func(ctx context.Context, input *BlueskyLoginInput) (*struct{}, error) {
		userID := middleware.GetUserID(ctx)
		if err := h.ensureCanStartAccountConnection(ctx, input.Body.WorkspaceID, userID); err != nil {
			return nil, err
		}

		adapter, ok := h.providers["bluesky"]
		if !ok {
			return nil, huma.Error400BadRequest("bluesky not configured")
		}

		blueskyAdapter, ok := adapter.(*platform.BlueskyAdapter)
		if !ok {
			return nil, huma.Error500InternalServerError("bluesky adapter type mismatch")
		}

		did, accessToken, refreshToken, expiresIn, err := blueskyAdapter.CreateSession(ctx, input.Body.Handle, input.Body.AppPassword)
		if err != nil {
			return nil, huma.Error500InternalServerError(fmt.Sprintf("bluesky login failed: %s", err.Error()))
		}

		// Build a TokenResult for Bluesky and delegate saving to AccountSaver so encryption and DB insert are centralized
		tokenResp := &platform.TokenResult{
			AccessToken:  accessToken,
			RefreshToken: refreshToken,
			ExpiresIn:    expiresIn,
			Extra:        nil,
		}

		if _, err := h.accountSaver.SaveAccount(ctx, userID, "bluesky", input.Body.WorkspaceID, did, input.Body.Handle, "https://bsky.social", tokenResp); err != nil {
			log.Printf("[BlueskyLogin] Failed to save account: %v", err)
			return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
		}

		return nil, nil
	})
}

type DiscordWebhookLoginInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" doc:"Workspace ID"`
		WebhookURL  string `json:"webhook_url" doc:"Discord incoming webhook URL"`
	}
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
	}, func(ctx context.Context, input *DiscordWebhookLoginInput) (*struct{}, error) {
		userID := middleware.GetUserID(ctx)
		if err := h.ensureCanStartAccountConnection(ctx, input.Body.WorkspaceID, userID); err != nil {
			return nil, err
		}
		adapter, ok := h.providers["discord"].(*platform.DiscordAdapter)
		if !ok {
			return nil, huma.Error400BadRequest("discord webhooks are not configured")
		}
		webhookURL := strings.TrimSpace(input.Body.WebhookURL)
		profile, err := adapter.GetProfile(ctx, webhookURL)
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		token := &platform.TokenResult{
			AccessToken: webhookURL,
			TokenType:   "Webhook",
		}
		_, err = h.accountSaver.SaveAccountFromInput(ctx, account_saver.SaveAccountInput{
			UserID:          userID,
			PlatformName:    "discord",
			WorkspaceID:     input.Body.WorkspaceID,
			AccountID:       profile.ID,
			AccountUsername: firstNonEmpty(profile.DisplayName, profile.Username),
			Token:           token,
			CapabilityState: profile.CapabilityState,
		})
		if err != nil {
			return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
		}
		return nil, nil
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
				UserID:           userID,
				PlatformName:     pending.Platform,
				WorkspaceID:      pending.WorkspaceID,
				AccountID:        selected.AccountID,
				AccountUsername:  selected.AccountUsername,
				AccountAvatarURL: selected.AccountAvatarURL,
				InstanceURL:      firstNonEmpty(selected.InstanceURL, pending.InstanceURL),
				Token:            selected.Token,
				CapabilityState:  selected.CapabilityState,
			})
		}

		saver := h.accountSaver
		if saver == nil {
			saver = account_saver.NewAccountSaver(h.db, h.crypto)
		}
		accounts, err := saver.SaveAccountsFromInputs(ctx, saveInputs)
		if err != nil {
			log.Printf("[OAuth Selection] Failed to save selected accounts: %v", err)
			return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
		}

		if _, err := h.db.NewUpdate().
			Model((*models.OAuthAccountSelection)(nil)).
			Set("consumed_at = ?", time.Now().UTC()).
			Where("id = ?", pending.ID).
			Exec(ctx); err != nil {
			log.Printf("[OAuth Selection] Failed to mark selection consumed: %v", err)
			return nil, huma.Error500InternalServerError("failed to complete account selection")
		}

		return &CompleteAccountSelectionOutput{Body: accountResponse(*accounts[0], h.disableLinkedInThreadReplies)}, nil
	})
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

	expiresIn := 0
	if !pending.TokenExpiresAt.IsZero() {
		expiresIn = int(time.Until(pending.TokenExpiresAt).Seconds())
		if expiresIn < 0 {
			expiresIn = 0
		}
	}

	return &platform.TokenResult{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    expiresIn,
		TokenType:    pending.TokenType,
		Extra:        extra,
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
	allowed, err := middleware.CheckWorkspaceAccess(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError("failed to check workspace access")
	}
	if !allowed {
		return huma.Error403Forbidden("workspace not accessible")
	}
	return nil
}

func (h *OAuthHandler) checkWorkspaceEditAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := middleware.CheckWorkspaceEditAccess(ctx, h.db, workspaceID, userID)
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

		var accounts []models.SocialAccount
		err := h.db.NewSelect().
			Model(&accounts).
			Where("workspace_id = ?", input.WorkspaceID).
			Where("is_active = ?", true).
			Order("created_at DESC").
			Scan(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to list accounts")
		}

		response := make([]AccountResponse, len(accounts))
		for i, acc := range accounts {
			response[i] = accountResponse(acc, h.disableLinkedInThreadReplies)
		}

		return &ListAccountsOutput{Body: response}, nil
	})
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
		if !accountSlugPattern.MatchString(slug) || strings.Contains(slug, "--") {
			return nil, huma.Error400BadRequest("slug must be 1-63 lowercase letters, numbers, and single hyphens")
		}

		account, err := h.getEditableAccount(ctx, input.AccountID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		capabilityState := map[string]string{}
		_ = json.Unmarshal([]byte(account.CapabilityState), &capabilityState)
		if input.Body.MessagesEnabled != nil {
			if *input.Body.MessagesEnabled && !accountMessagingSupported(account.Platform) {
				return nil, huma.Error400BadRequest("messages are not supported for this provider")
			}
			capabilityState["messages_enabled"] = strconv.FormatBool(*input.Body.MessagesEnabled)
		}
		encodedCapabilityState, err := json.Marshal(capabilityState)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to encode account capabilities")
		}

		var existing models.SocialAccount
		err = h.db.NewSelect().
			Model(&existing).
			Where("workspace_id = ?", account.WorkspaceID).
			Where("slug = ?", slug).
			Where("id != ?", account.ID).
			Where("is_active = ?", true).
			Scan(ctx)
		if err == nil {
			return nil, huma.Error409Conflict("slug is already used by another active account in this workspace")
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error500InternalServerError("failed to check slug uniqueness")
		}

		if _, err := h.db.NewUpdate().
			Model((*models.SocialAccount)(nil)).
			Set("slug = ?", slug).
			Set("capability_state_json = ?", string(encodedCapabilityState)).
			Where("id = ?", account.ID).
			Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to update account")
		}

		account.Slug = slug
		account.CapabilityState = string(encodedCapabilityState)
		return &UpdateAccountOutput{Body: accountResponse(account, h.disableLinkedInThreadReplies)}, nil
	})
}

type DisconnectAccountInput struct {
	AccountID string `path:"account_id"`
}

func (h *OAuthHandler) DisconnectAccount(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "disconnect-account",
		Method:      http.MethodDelete,
		Path:        "/accounts/{account_id}",
		Summary:     "Disconnect a social account",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{404},
	}, func(ctx context.Context, input *DisconnectAccountInput) (*struct{}, error) {
		account, err := h.getEditableAccount(ctx, input.AccountID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}

		if _, err := h.db.NewUpdate().
			Model((*models.SocialAccount)(nil)).
			Set("is_active = ?", false).
			Where("id = ?", account.ID).
			Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to disconnect account")
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
