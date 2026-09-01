package platform

import (
	"fmt"
	"strings"
)

const (
	ConnectionModeAppPassword = "app_password"
	ConnectionModeBot         = "bot"
	ConnectionModeOAuth       = "oauth"
	ConnectionModeOAuthOOB    = "oauth_oob"
	ConnectionModeWebhook     = "webhook"
)

// ProviderAppContract defines the instance-owned application fields required
// before a provider configuration may enter the runtime registry. Secret
// values are validated here but must never be copied into workspace grants or
// API responses.
type ProviderAppContract struct {
	Provider       string
	ConnectionMode string
	RequiredFields []string
	AdapterBacked  bool
	BuiltIn        bool
}

func ApplicationContract(provider, connectionMode string) (ProviderAppContract, bool) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	connectionMode = normalizeConnectionMode(provider, connectionMode, AppConfig{})
	contracts := map[string]ProviderAppContract{
		providerBluesky + ":" + ConnectionModeAppPassword: {Provider: providerBluesky, ConnectionMode: ConnectionModeAppPassword, AdapterBacked: true, BuiltIn: true},
		providerDiscord + ":" + ConnectionModeWebhook:     {Provider: providerDiscord, ConnectionMode: ConnectionModeWebhook, AdapterBacked: true, BuiltIn: true},
		providerDiscord + ":" + ConnectionModeBot:         {Provider: providerDiscord, ConnectionMode: ConnectionModeBot, RequiredFields: []string{"client_id", "client_secret", "bot_token", "redirect_uri"}, AdapterBacked: true},
		providerPinterest + ":" + ConnectionModeOAuth:     {Provider: providerPinterest, ConnectionMode: ConnectionModeOAuth, RequiredFields: []string{"client_id", "client_secret", "redirect_uri"}, AdapterBacked: true},
		providerTelegram + ":" + ConnectionModeBot:        {Provider: providerTelegram, ConnectionMode: ConnectionModeBot, RequiredFields: []string{"bot_token", "bot_username", "webhook_secret"}},
		providerX + ":" + ConnectionModeOAuth:             {Provider: providerX, ConnectionMode: ConnectionModeOAuth, RequiredFields: []string{"client_id"}, AdapterBacked: true},
		providerMastodon + ":" + ConnectionModeOAuthOOB:   {Provider: providerMastodon, ConnectionMode: ConnectionModeOAuthOOB, RequiredFields: []string{"client_id", "client_secret", "instance_url"}, AdapterBacked: true},
		providerFacebook + ":" + ConnectionModeOAuth:      {Provider: providerFacebook, ConnectionMode: ConnectionModeOAuth, RequiredFields: []string{"client_id"}, AdapterBacked: true},
		providerInstagram + ":" + ConnectionModeOAuth:     {Provider: providerInstagram, ConnectionMode: ConnectionModeOAuth, RequiredFields: []string{"client_id"}, AdapterBacked: true},
		providerLinkedIn + ":" + ConnectionModeOAuth:      {Provider: providerLinkedIn, ConnectionMode: ConnectionModeOAuth, RequiredFields: []string{"client_id"}, AdapterBacked: true},
		providerThreads + ":" + ConnectionModeOAuth:       {Provider: providerThreads, ConnectionMode: ConnectionModeOAuth, RequiredFields: []string{"client_id"}, AdapterBacked: true},
		providerTikTok + ":" + ConnectionModeOAuth:        {Provider: providerTikTok, ConnectionMode: ConnectionModeOAuth, RequiredFields: []string{"client_id"}, AdapterBacked: true},
		providerYouTube + ":" + ConnectionModeOAuth:       {Provider: providerYouTube, ConnectionMode: ConnectionModeOAuth, RequiredFields: []string{"client_id"}, AdapterBacked: true},
	}
	contract, ok := contracts[provider+":"+connectionMode]
	return contract, ok
}

func ValidateAppConfig(app AppConfig) error {
	app = NormalizeAppConfig(app)
	contract, ok := ApplicationContract(app.Provider, app.ConnectionMode)
	if !ok {
		return fmt.Errorf("unsupported provider app: %s (%s)", app.Provider, app.ConnectionMode)
	}
	values := map[string]string{
		"client_id":      app.ClientID,
		"client_secret":  app.ClientSecret,
		"redirect_uri":   app.RedirectURI,
		"instance_url":   app.InstanceURL,
		"bot_token":      app.BotToken,
		"bot_username":   app.BotUsername,
		"webhook_secret": app.WebhookSecret,
	}
	missing := make([]string, 0, len(contract.RequiredFields))
	for _, field := range contract.RequiredFields {
		if strings.TrimSpace(values[field]) == "" {
			missing = append(missing, field)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("%s provider app requires %s", app.Provider, strings.Join(missing, ", "))
	}
	return nil
}

func IsBuiltInAppConfig(app AppConfig) bool {
	app = NormalizeAppConfig(app)
	contract, ok := ApplicationContract(app.Provider, app.ConnectionMode)
	return ok && contract.BuiltIn
}

func normalizeConnectionMode(provider, connectionMode string, app AppConfig) string {
	mode := strings.ToLower(strings.TrimSpace(connectionMode))
	if mode != "" {
		return mode
	}
	switch provider {
	case providerBluesky:
		return ConnectionModeAppPassword
	case providerDiscord:
		if strings.TrimSpace(app.ClientID) != "" || strings.TrimSpace(app.ClientSecret) != "" || strings.TrimSpace(app.BotToken) != "" {
			return ConnectionModeBot
		}
		return ConnectionModeWebhook
	case providerTelegram:
		return ConnectionModeBot
	case providerMastodon:
		return ConnectionModeOAuthOOB
	default:
		return ConnectionModeOAuth
	}
}
