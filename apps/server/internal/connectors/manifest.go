package connectors

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

const ProtocolVersion = "1.0"

var opaqueIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)

type Manifest struct {
	ProtocolVersion       string               `json:"protocol_version"`
	ImplementationVersion string               `json:"implementation_version"`
	Provider              ProviderDescriptor   `json:"provider"`
	CapabilityRevision    string               `json:"capability_revision"`
	Connection            ConnectionDescriptor `json:"connection"`
	Publishing            PublishingDescriptor `json:"publishing"`
	Operations            OperationDescriptor  `json:"operations"`
}

type ProviderDescriptor struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Description string `json:"description,omitempty"`
}

type ConnectionDescriptor struct {
	Modes []string `json:"modes"`
}

type PublishingDescriptor struct {
	OutputProfiles []OutputProfile `json:"output_profiles"`
}

type OutputProfile struct {
	ID          string              `json:"id"`
	DisplayName string              `json:"display_name"`
	Profile     string              `json:"profile"`
	Intents     []string            `json:"intents"`
	Content     TextConstraint      `json:"content"`
	Title       TextConstraint      `json:"title"`
	Description TextConstraint      `json:"description"`
	Media       MediaConstraint     `json:"media"`
	Settings    []SettingDefinition `json:"settings,omitempty"`
}

type TextConstraint struct {
	Required  bool `json:"required"`
	MinLength int  `json:"min_length,omitempty"`
	MaxLength int  `json:"max_length,omitempty"`
}

type MediaConstraint struct {
	MinItems     int      `json:"min_items"`
	MaxItems     int      `json:"max_items"`
	AllowedMIMEs []string `json:"allowed_mimes,omitempty"`
}

type SettingDefinition struct {
	Key      string   `json:"key"`
	Label    string   `json:"label"`
	Help     string   `json:"help,omitempty"`
	Control  string   `json:"control"`
	Required bool     `json:"required"`
	Default  any      `json:"default,omitempty"`
	Options  []string `json:"options,omitempty"`
}

type OperationDescriptor struct {
	Polling bool `json:"polling"`
}

func ValidateManifest(manifest *Manifest) error {
	if manifest == nil {
		return fmt.Errorf("connector manifest is required")
	}
	if manifest.ProtocolVersion != ProtocolVersion {
		return fmt.Errorf("unsupported connector protocol %q", manifest.ProtocolVersion)
	}
	if err := validateShortText("implementation_version", manifest.ImplementationVersion, 64); err != nil {
		return err
	}
	if !opaqueIDPattern.MatchString(manifest.Provider.ID) {
		return fmt.Errorf("provider id %q is invalid", manifest.Provider.ID)
	}
	if err := validateShortText("provider display_name", manifest.Provider.DisplayName, 80); err != nil {
		return err
	}
	if err := validateOptionalText("provider description", manifest.Provider.Description, 240); err != nil {
		return err
	}
	if !opaqueIDPattern.MatchString(manifest.CapabilityRevision) {
		return fmt.Errorf("capability_revision %q is invalid", manifest.CapabilityRevision)
	}
	if len(manifest.Connection.Modes) != 1 || manifest.Connection.Modes[0] != "preconfigured" {
		return fmt.Errorf("connector protocol 1.0 supports only preconfigured connections")
	}
	if len(manifest.Publishing.OutputProfiles) == 0 {
		return fmt.Errorf("connector manifest must declare an output profile")
	}
	if len(manifest.Publishing.OutputProfiles) > 32 {
		return fmt.Errorf("connector manifest declares too many output profiles")
	}
	seen := make(map[string]struct{}, len(manifest.Publishing.OutputProfiles))
	for index := range manifest.Publishing.OutputProfiles {
		profile := &manifest.Publishing.OutputProfiles[index]
		if _, ok := seen[profile.ID]; ok {
			return fmt.Errorf("duplicate output profile %q", profile.ID)
		}
		seen[profile.ID] = struct{}{}
		if err := validateOutputProfile(profile); err != nil {
			return fmt.Errorf("output profile %q: %w", profile.ID, err)
		}
	}
	return nil
}

func validateOutputProfile(profile *OutputProfile) error {
	if !opaqueIDPattern.MatchString(profile.ID) {
		return fmt.Errorf("id is invalid")
	}
	if err := validateShortText("display_name", profile.DisplayName, 80); err != nil {
		return err
	}
	if profile.Profile != "short_text" {
		return fmt.Errorf("protocol 1.0 supports only the short_text profile")
	}
	if len(profile.Intents) != 1 || profile.Intents[0] != "post" {
		return fmt.Errorf("protocol 1.0 supports only the post intent")
	}
	if err := validateTextConstraints(map[string]TextConstraint{
		"content": profile.Content, "title": profile.Title, "description": profile.Description,
	}); err != nil {
		return err
	}
	if profile.Media.MinItems != 0 || profile.Media.MaxItems != 0 || len(profile.Media.AllowedMIMEs) != 0 {
		return fmt.Errorf("protocol 1.0 reference host supports text-only output profiles")
	}
	if len(profile.Settings) > 32 {
		return fmt.Errorf("too many settings")
	}
	settingKeys := make(map[string]struct{}, len(profile.Settings))
	for _, setting := range profile.Settings {
		if err := validateOutputSetting(setting, settingKeys); err != nil {
			return err
		}
	}
	return nil
}

func validateTextConstraints(constraints map[string]TextConstraint) error {
	for label, text := range constraints {
		if text.MinLength < 0 || text.MaxLength < 0 || text.MaxLength > 1_000_000 || (text.MaxLength > 0 && text.MinLength > text.MaxLength) {
			return fmt.Errorf("%s limits are invalid", label)
		}
	}
	return nil
}

func validateOutputSetting(setting SettingDefinition, seen map[string]struct{}) error {
	if !opaqueIDPattern.MatchString(setting.Key) {
		return fmt.Errorf("setting key %q is invalid", setting.Key)
	}
	if _, ok := seen[setting.Key]; ok {
		return fmt.Errorf("duplicate setting %q", setting.Key)
	}
	seen[setting.Key] = struct{}{}
	if err := validateShortText("setting label", setting.Label, 80); err != nil {
		return err
	}
	if err := validateOptionalText("setting help", setting.Help, 240); err != nil {
		return err
	}
	if !slices.Contains([]string{"text", "textarea", "number", "select", "radio", "checkbox"}, setting.Control) {
		return fmt.Errorf("setting %q uses unsupported control %q", setting.Key, setting.Control)
	}
	return validateSettingOptions(setting)
}

func validateSettingOptions(setting SettingDefinition) error {
	if (setting.Control == "select" || setting.Control == "radio") && len(setting.Options) == 0 {
		return fmt.Errorf("setting %q requires options", setting.Key)
	}
	if len(setting.Options) > 64 {
		return fmt.Errorf("setting %q has too many options", setting.Key)
	}
	for _, option := range setting.Options {
		if err := validateShortText("setting option", option, 80); err != nil {
			return err
		}
	}
	return nil
}

func validateShortText(label, value string, max int) error {
	if strings.TrimSpace(value) != value || value == "" {
		return fmt.Errorf("%s is required and cannot have surrounding whitespace", label)
	}
	return validateOptionalText(label, value, max)
}

func validateOptionalText(label, value string, max int) error {
	if !utf8.ValidString(value) {
		return fmt.Errorf("%s must be valid UTF-8", label)
	}
	if len(value) > max {
		return fmt.Errorf("%s exceeds %d bytes", label, max)
	}
	for _, char := range value {
		if char < 0x20 && char != '\n' && char != '\t' {
			return fmt.Errorf("%s contains a control character", label)
		}
	}
	return nil
}
