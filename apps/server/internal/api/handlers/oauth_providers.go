package handlers

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/textutil"
)

func (h *OAuthHandler) getProvider(platform, serverName string) (platform.Adapter, error) {
	if isCompatOAuthProvider(platform) {
		if serverName == "" {
			return nil, fmt.Errorf("server_name required for %s", platform)
		}
		key := platform + ":" + serverName
		adapter, ok := h.provider(key)
		if !ok && !strings.Contains(serverName, "://") {
			adapter, ok = h.provider(platform + ":https://" + strings.ToLower(serverName))
		}
		if !ok {
			return nil, fmt.Errorf("unknown %s server: %s", platform, serverName)
		}
		return adapter, nil
	}

	key := platform
	if platform == "instagram" && serverName == "instagram_login" {
		key = "instagram:instagram_login"
	}
	if platform == "discord" {
		key = "discord:bot"
	}
	adapter, ok := h.provider(key)
	if !ok {
		return nil, fmt.Errorf("unsupported platform: %s", platform)
	}
	return adapter, nil
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

func selectedAccountInstanceURL(provider string, values ...string) string {
	if provider == "discord" || provider == "instagram" {
		return ""
	}
	return textutil.FirstNonEmpty(values...)
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
		if infos[index].Platform == "instagram" {
			direct := readiness.DecideConnection(ctx, "instagram", platform.ConnectionModeInstagramLogin, providerreadiness.ExecutionIntentProduction)
			infos[index].ConnectionReadiness = map[string]providerreadiness.Decision{
				platform.ConnectionModeOAuth: decision, platform.ConnectionModeInstagramLogin: direct,
			}
			infos[index].ConfiguredConnectionModes = nil
			if decision.Connectable {
				infos[index].ConfiguredConnectionModes = append(infos[index].ConfiguredConnectionModes, platform.ConnectionModeOAuth)
			}
			if direct.Connectable {
				infos[index].ConfiguredConnectionModes = append(infos[index].ConfiguredConnectionModes, platform.ConnectionModeInstagramLogin)
				if !decision.Connectable {
					decision = direct
				}
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
	if item.Platform == "instagram" {
		if item.Configured {
			item.ConfiguredConnectionModes = append(item.ConfiguredConnectionModes, platform.ConnectionModeOAuth)
		}
		if providers["instagram:"+platform.ConnectionModeInstagramLogin] != nil {
			item.Configured = true
			item.ConfiguredConnectionModes = append(item.ConfiguredConnectionModes, platform.ConnectionModeInstagramLogin)
		}
	}
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
		return capabilities.ProviderDisplayName(pixelfedProvider)
	}
	return capabilities.ProviderDisplayName(capabilities.ProviderMastodon)
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
