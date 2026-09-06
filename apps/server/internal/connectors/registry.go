package connectors

import (
	"context"
	"fmt"
	"slices"
	"sort"
	"strings"

	"github.com/openpost/backend/internal/capabilities"
)

const (
	InstallationStatusAvailable       = "available"
	InstallationStatusInvalidConfig   = "invalid_config"
	InstallationStatusInvalidManifest = "invalid_manifest"
	InstallationStatusUnavailable     = "unavailable"
)

type RegistryOptions struct {
	Client ClientOptions
}

type Registry struct {
	entries map[string]RegistryEntry
	clients map[string]*Client
}

type RegistryEntry struct {
	InstallationID     string
	Required           bool
	WorkspaceAllowlist []string
	ConfigFingerprint  string
	Manifest           Manifest
	Available          bool
	Status             string
	StatusDetail       string
}

func NewRegistry(ctx context.Context, config Config, options RegistryOptions) (*Registry, error) {
	registry := &Registry{
		entries: make(map[string]RegistryEntry, len(config.Installations)),
		clients: make(map[string]*Client, len(config.Installations)),
	}
	for _, installation := range config.Installations {
		entry := RegistryEntry{
			InstallationID:     installation.ID,
			Required:           installation.Required,
			WorkspaceAllowlist: slices.Clone(installation.WorkspaceAllowlist),
			ConfigFingerprint:  installationFingerprint(installation),
		}
		client, err := NewClient(installation, options.Client)
		if err != nil {
			entry.Status = InstallationStatusInvalidConfig
			entry.StatusDetail = err.Error()
			if installation.Required {
				return nil, requiredInstallationError(installation.ID, err)
			}
			registry.entries[installation.ID] = entry
			continue
		}
		manifest, err := client.Manifest(ctx)
		if err != nil {
			entry.Status = InstallationStatusInvalidManifest
			entry.StatusDetail = err.Error()
			if installation.Required {
				return nil, requiredInstallationError(installation.ID, err)
			}
			registry.entries[installation.ID] = entry
			continue
		}
		if builtInProviderID(manifest.Provider.ID) {
			err = fmt.Errorf("connector provider id %q conflicts with a built-in provider", manifest.Provider.ID)
			entry.Status = InstallationStatusInvalidManifest
			entry.StatusDetail = err.Error()
			if installation.Required {
				return nil, requiredInstallationError(installation.ID, err)
			}
			registry.entries[installation.ID] = entry
			continue
		}
		entry.Manifest = manifest
		if err := client.Health(ctx); err != nil {
			entry.Status = InstallationStatusUnavailable
			entry.StatusDetail = err.Error()
			if installation.Required {
				return nil, requiredInstallationError(installation.ID, err)
			}
			registry.entries[installation.ID] = entry
			registry.clients[installation.ID] = client
			continue
		}
		entry.Available = true
		entry.Status = InstallationStatusAvailable
		registry.entries[installation.ID] = entry
		registry.clients[installation.ID] = client
	}
	return registry, nil
}

func builtInProviderID(providerID string) bool {
	for _, capability := range capabilities.All() {
		if capability.Provider == providerID {
			return true
		}
	}
	return false
}

func (r *Registry) All() []RegistryEntry {
	if r == nil {
		return nil
	}
	result := make([]RegistryEntry, 0, len(r.entries))
	for _, entry := range r.entries {
		result = append(result, cloneRegistryEntry(entry))
	}
	sort.Slice(result, func(i, j int) bool { return result[i].InstallationID < result[j].InstallationID })
	return result
}

func requiredInstallationError(installationID string, err error) error {
	return fmt.Errorf("required connector installation %q is unavailable: %w", installationID, err)
}

func (r *Registry) Installation(installationID string) (RegistryEntry, bool) {
	if r == nil {
		return RegistryEntry{}, false
	}
	entry, ok := r.entries[installationID]
	return cloneRegistryEntry(entry), ok
}

func (r *Registry) AvailableForWorkspace(workspaceID string) []RegistryEntry {
	entries := r.ForWorkspace(workspaceID)
	result := entries[:0]
	for _, entry := range entries {
		if entry.Available {
			result = append(result, entry)
		}
	}
	return result
}

func (r *Registry) ForWorkspace(workspaceID string) []RegistryEntry {
	if r == nil {
		return nil
	}
	result := make([]RegistryEntry, 0, len(r.entries))
	for _, entry := range r.entries {
		if workspaceAllowed(entry.WorkspaceAllowlist, workspaceID) {
			result = append(result, cloneRegistryEntry(entry))
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].InstallationID < result[j].InstallationID })
	return result
}

func (r *Registry) ClientForWorkspace(installationID, workspaceID string) (*Client, RegistryEntry, error) {
	entry, ok := r.Installation(installationID)
	if !ok {
		return nil, RegistryEntry{}, fmt.Errorf("connector installation %q does not exist", installationID)
	}
	if !workspaceAllowed(entry.WorkspaceAllowlist, workspaceID) {
		return nil, RegistryEntry{}, fmt.Errorf("connector installation %q is not available to this Workspace", installationID)
	}
	if !entry.Available {
		return nil, entry, fmt.Errorf("connector installation %q is %s", installationID, entry.Status)
	}
	client := r.clients[installationID]
	if client == nil {
		return nil, entry, fmt.Errorf("connector installation %q has no client", installationID)
	}
	return client, entry, nil
}

func (e RegistryEntry) Capabilities() []capabilities.Capability {
	result := make([]capabilities.Capability, 0, len(e.Manifest.Publishing.OutputProfiles))
	for _, profile := range e.Manifest.Publishing.OutputProfiles {
		settings := make([]capabilities.SettingDefinition, 0, len(profile.Settings))
		for _, setting := range profile.Settings {
			settings = append(settings, capabilities.SettingDefinition{
				Key: setting.Key, Label: setting.Label, Help: setting.Help,
				Group: "content", Control: setting.Control,
				Type: settingType(setting.Control), Scope: capabilities.SettingScopeDestination,
				Required: setting.Required, Default: setting.Default, Options: slices.Clone(setting.Options),
			})
		}
		result = append(result, capabilities.Capability{
			Provider: e.Manifest.Provider.ID, Profile: profile.Profile, OutputProfile: profile.ID,
			Intents: slices.Clone(profile.Intents), MediaShapes: []string{capabilities.MediaShapeText},
			Label: profile.DisplayName, ValidationCategories: []string{"text"},
			TextLimit:     profile.Content.MaxLength,
			TitleRequired: profile.Title.Required, DescriptionRequired: profile.Description.Required,
			OpenPostQueued: true,
			Media: capabilities.MediaConstraint{
				MinCount: profile.Media.MinItems, MaxCount: profile.Media.MaxItems,
				AllowedMIMEs: slices.Clone(profile.Media.AllowedMIMEs),
			},
			Content: capabilities.ContentConstraint{
				Body: capabilities.TextConstraint{
					Required: profile.Content.Required, MinLength: profile.Content.MinLength, MaxLength: profile.Content.MaxLength,
				},
				Title: capabilities.TextConstraint{
					Required: profile.Title.Required, MinLength: profile.Title.MinLength, MaxLength: profile.Title.MaxLength,
				},
				Description: capabilities.TextConstraint{
					Required: profile.Description.Required, MinLength: profile.Description.MinLength, MaxLength: profile.Description.MaxLength,
				},
			},
			Settings: settings, CapabilityRevision: e.Manifest.CapabilityRevision,
			Metadata: map[string]string{
				"connector_installation_id": e.InstallationID,
			},
		})
	}
	return result
}

func workspaceAllowed(allowlist []string, workspaceID string) bool {
	return len(allowlist) == 0 || slices.Contains(allowlist, workspaceID)
}

func cloneRegistryEntry(entry RegistryEntry) RegistryEntry {
	entry.WorkspaceAllowlist = slices.Clone(entry.WorkspaceAllowlist)
	return entry
}

func settingType(control string) string {
	switch strings.TrimSpace(control) {
	case "checkbox":
		return "boolean"
	case "number":
		return "number"
	default:
		return "string"
	}
}
