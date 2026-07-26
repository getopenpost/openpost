package platform

import (
	"fmt"
	"strings"
)

// AppConfig describes one configured provider application. Self-hosted installs
// usually populate these from legacy env vars; hosted deployments can build the
// same registry from structured config.
type AppConfig struct {
	Provider     string `json:"provider"`
	Name         string `json:"name,omitempty"`
	ClientID     string `json:"client_id,omitempty"`
	ClientSecret string `json:"client_secret,omitempty"`
	RedirectURI  string `json:"redirect_uri,omitempty"`
	InstanceURL  string `json:"instance_url,omitempty"`
}

type RegistryOptions struct {
	DisableLinkedInThreadReplies bool
}

type RegistryEntry struct {
	Key         string
	Provider    string
	Name        string
	InstanceURL string
	Adapter     Adapter
}

type appBuilder func(AppConfig, RegistryOptions) (Adapter, error)

var appBuilders = map[string]appBuilder{
	providerX: func(app AppConfig, _ RegistryOptions) (Adapter, error) {
		if strings.TrimSpace(app.ClientID) == "" {
			return nil, fmt.Errorf("x provider app requires client_id")
		}
		return NewXAdapter(app.ClientID, app.ClientSecret, app.RedirectURI), nil
	},
	providerMastodon: func(app AppConfig, _ RegistryOptions) (Adapter, error) {
		if strings.TrimSpace(app.ClientID) == "" || strings.TrimSpace(app.ClientSecret) == "" || strings.TrimSpace(app.InstanceURL) == "" {
			return nil, fmt.Errorf("mastodon provider app requires client_id, client_secret, and instance_url")
		}
		return NewMastodonAdapter(app.ClientID, app.ClientSecret, app.RedirectURI, app.InstanceURL), nil
	},
	providerBluesky: func(_ AppConfig, _ RegistryOptions) (Adapter, error) {
		return NewBlueskyAdapter(""), nil
	},
	providerFacebook: func(app AppConfig, _ RegistryOptions) (Adapter, error) {
		if strings.TrimSpace(app.ClientID) == "" {
			return nil, fmt.Errorf("facebook provider app requires client_id")
		}
		return NewFacebookAdapter(app.ClientID, app.ClientSecret, app.RedirectURI), nil
	},
	providerInstagram: func(app AppConfig, _ RegistryOptions) (Adapter, error) {
		if strings.TrimSpace(app.ClientID) == "" {
			return nil, fmt.Errorf("instagram provider app requires client_id")
		}
		return NewInstagramAdapter(app.ClientID, app.ClientSecret, app.RedirectURI), nil
	},
	providerLinkedIn: func(app AppConfig, opts RegistryOptions) (Adapter, error) {
		if strings.TrimSpace(app.ClientID) == "" {
			return nil, fmt.Errorf("linkedin provider app requires client_id")
		}
		return NewLinkedInAdapter(app.ClientID, app.ClientSecret, app.RedirectURI, opts.DisableLinkedInThreadReplies), nil
	},
	providerThreads: func(app AppConfig, _ RegistryOptions) (Adapter, error) {
		if strings.TrimSpace(app.ClientID) == "" {
			return nil, fmt.Errorf("threads provider app requires client_id")
		}
		return NewThreadsAdapter(app.ClientID, app.ClientSecret, app.RedirectURI), nil
	},
	providerTikTok: func(app AppConfig, _ RegistryOptions) (Adapter, error) {
		if strings.TrimSpace(app.ClientID) == "" {
			return nil, fmt.Errorf("tiktok provider app requires client_id")
		}
		return NewTikTokAdapter(app.ClientID, app.ClientSecret, app.RedirectURI), nil
	},
	providerYouTube: func(app AppConfig, _ RegistryOptions) (Adapter, error) {
		if strings.TrimSpace(app.ClientID) == "" {
			return nil, fmt.Errorf("youtube provider app requires client_id")
		}
		return NewYouTubeAdapter(app.ClientID, app.ClientSecret, app.RedirectURI), nil
	},
}

func BuildAdapterRegistry(apps []AppConfig, opts RegistryOptions) (map[string]Adapter, []RegistryEntry, error) {
	adapters := make(map[string]Adapter)
	entries := make([]RegistryEntry, 0, len(apps))

	for _, app := range apps {
		app = NormalizeAppConfig(app)
		builder, ok := appBuilders[app.Provider]
		if !ok {
			return nil, nil, fmt.Errorf("unsupported provider app: %s", app.Provider)
		}

		adapter, err := builder(app, opts)
		if err != nil {
			return nil, nil, err
		}

		for _, key := range adapterKeys(app) {
			adapters[key] = adapter
			entries = append(entries, RegistryEntry{
				Key:         key,
				Provider:    app.Provider,
				Name:        app.Name,
				InstanceURL: app.InstanceURL,
				Adapter:     adapter,
			})
		}
	}

	return adapters, entries, nil
}

func MergeAppConfigs(base []AppConfig, overrides ...AppConfig) []AppConfig {
	merged := make([]AppConfig, 0, len(base)+len(overrides))
	indexByKey := make(map[string]int, len(base)+len(overrides))

	for _, app := range base {
		app = NormalizeAppConfig(app)
		key := AppConfigMergeKey(app)
		indexByKey[key] = len(merged)
		merged = append(merged, app)
	}
	for _, app := range overrides {
		app = NormalizeAppConfig(app)
		key := AppConfigMergeKey(app)
		if i, ok := indexByKey[key]; ok {
			merged[i] = app
			continue
		}
		indexByKey[key] = len(merged)
		merged = append(merged, app)
	}
	return merged
}

func AppConfigMergeKey(app AppConfig) string {
	app = NormalizeAppConfig(app)
	if app.Provider == providerMastodon {
		return app.Provider + ":" + app.InstanceURL
	}
	return app.Provider
}

func IsAppProviderSupported(provider string) bool {
	provider = strings.ToLower(strings.TrimSpace(provider))
	_, ok := appBuilders[provider]
	return ok
}

func NormalizeAppConfig(app AppConfig) AppConfig {
	app.Provider = strings.ToLower(strings.TrimSpace(app.Provider))
	app.Name = strings.TrimSpace(app.Name)
	app.ClientID = strings.TrimSpace(app.ClientID)
	app.ClientSecret = strings.TrimSpace(app.ClientSecret)
	app.RedirectURI = strings.TrimSpace(app.RedirectURI)
	app.InstanceURL = strings.TrimRight(strings.TrimSpace(app.InstanceURL), "/")
	return app
}

func adapterKeys(app AppConfig) []string {
	if app.Provider != providerMastodon {
		return []string{app.Provider}
	}

	keys := []string{}
	if app.InstanceURL != "" {
		keys = append(keys, providerMastodon+":"+app.InstanceURL)
	}
	if app.Name != "" {
		keys = append(keys, providerMastodon+":"+app.Name)
	}
	return keys
}
