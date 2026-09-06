package themes

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

const maxManifestBytes = 256 * 1024

const previousManifestSchemaVersion = 0

var (
	fontFamilyPattern = regexp.MustCompile(`^[a-zA-Z0-9 _.,:'-]+$`)
	identifierPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$`)
	keywordPattern    = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9 _.-]*$`)
)

var themeAssetSlots = []string{
	"background-texture",
	"sidebar-decoration",
	"header-decoration",
	"empty-state-illustration",
	"loading-illustration",
}

func DecodeManifest(raw []byte) (ThemeManifest, error) {
	if len(raw) == 0 || len(raw) > maxManifestBytes {
		return ThemeManifest{}, fmt.Errorf("%w: manifest must contain at most %d bytes", ErrInvalidManifest, maxManifestBytes)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var manifest ThemeManifest
	if err := decoder.Decode(&manifest); err != nil {
		return ThemeManifest{}, fmt.Errorf("%w: %v", ErrInvalidManifest, err)
	}
	if decoder.Decode(&struct{}{}) == nil {
		return ThemeManifest{}, fmt.Errorf("%w: multiple JSON values", ErrInvalidManifest)
	}
	return NormalizeManifest(manifest)
}

//nolint:gocyclo // The versioned manifest has independent required fields that remain explicit for schema review.
func NormalizeManifest(input ThemeManifest) (ThemeManifest, error) {
	var err error
	input, err = migrateManifest(input)
	if err != nil {
		return ThemeManifest{}, err
	}
	input.ID = strings.TrimSpace(input.ID)
	input.Revision = strings.TrimSpace(input.Revision)
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	if !identifierPattern.MatchString(input.ID) {
		return ThemeManifest{}, invalidManifest("id", "must be a stable identifier")
	}
	if !validKeyword(input.Revision) {
		return ThemeManifest{}, invalidManifest("revision", "must be a stable revision identifier")
	}
	if input.Name == "" || len([]rune(input.Name)) > 80 {
		return ThemeManifest{}, invalidManifest("name", "must contain 1 to 80 characters")
	}
	if len([]rune(input.Description)) > 240 {
		return ThemeManifest{}, invalidManifest("description", "must contain at most 240 characters")
	}
	if !validIconPack(input.IconPack) {
		return ThemeManifest{}, invalidManifest("iconPack", "unsupported icon pack")
	}
	expectedSchemes := supportedSchemes(input.Schemes)
	if len(expectedSchemes) == 0 || !slices.Equal(input.SupportedSchemes, expectedSchemes) {
		return ThemeManifest{}, invalidManifest("supportedSchemes", "must exactly match the complete scheme objects")
	}
	for _, item := range []struct {
		scheme   ColorScheme
		manifest *ThemeSchemeManifest
	}{{SchemeLight, input.Schemes.Light}, {SchemeDark, input.Schemes.Dark}} {
		if item.manifest == nil {
			continue
		}
		normalized, err := NormalizeSchemeManifest(item.scheme, *item.manifest)
		if err != nil {
			return ThemeManifest{}, err
		}
		if item.scheme == SchemeLight {
			input.Schemes.Light = &normalized
		} else {
			input.Schemes.Dark = &normalized
		}
	}
	if err := normalizeManifestResources(&input); err != nil {
		return ThemeManifest{}, err
	}
	encoded, err := json.Marshal(input)
	if err != nil || len(encoded) > maxManifestBytes {
		return ThemeManifest{}, invalidManifest("manifest", "exceeds encoded size limit")
	}
	return input, nil
}

func migrateManifest(input ThemeManifest) (ThemeManifest, error) {
	switch input.SchemaVersion {
	case ManifestSchemaVersion:
		return input, nil
	case previousManifestSchemaVersion:
		input.SchemaVersion = ManifestSchemaVersion
		input.SupportedSchemes = supportedSchemes(input.Schemes)
		return input, nil
	default:
		return ThemeManifest{}, invalidManifest("schemaVersion", "unsupported schema version")
	}
}

//nolint:gocyclo // Resource normalization enforces finite font and single-slot asset contracts in one pass.
func normalizeManifestResources(input *ThemeManifest) error {
	if len(input.Fonts) > 16 || len(input.Assets) > len(themeAssetSlots) {
		return invalidManifest("resources", "too many fonts or decorative assets")
	}
	resourceIDs := map[string]struct{}{}
	for index := range input.Fonts {
		font := &input.Fonts[index]
		font.ID = strings.TrimSpace(font.ID)
		font.Family = strings.TrimSpace(font.Family)
		font.SourceURL = strings.TrimSpace(font.SourceURL)
		if !identifierPattern.MatchString(font.ID) || !fontFamilyPattern.MatchString(font.Family) || font.SourceURL != "asset:"+font.ID || font.Format != "woff2" || font.Weight < 100 || font.Weight > 900 || font.Weight%100 != 0 || (font.Style != "normal" && font.Style != "italic") || (font.Display != "swap" && font.Display != "fallback" && font.Display != "optional") {
			return invalidManifest(fmt.Sprintf("fonts[%d]", index), "contains an invalid font face or resource reference")
		}
		if _, exists := resourceIDs[font.ID]; exists {
			return invalidManifest("resources", "contains duplicate IDs")
		}
		resourceIDs[font.ID] = struct{}{}
	}
	usedSlots := map[string]struct{}{}
	for index := range input.Assets {
		asset := &input.Assets[index]
		asset.ID = strings.TrimSpace(asset.ID)
		asset.SourceURL = strings.TrimSpace(asset.SourceURL)
		asset.MimeType = strings.ToLower(strings.TrimSpace(asset.MimeType))
		asset.Alt = strings.TrimSpace(asset.Alt)
		if !identifierPattern.MatchString(asset.ID) || asset.SourceURL != "asset:"+asset.ID || !slices.Contains(themeAssetSlots, asset.Slot) || !slices.Contains([]string{"image/png", "image/jpeg", "image/webp", "image/avif"}, asset.MimeType) || len([]rune(asset.Alt)) > 240 {
			return invalidManifest(fmt.Sprintf("assets[%d]", index), "contains an invalid decorative asset or resource reference")
		}
		if (asset.Slot == "empty-state-illustration" || asset.Slot == "loading-illustration") && asset.Alt == "" {
			return invalidManifest(fmt.Sprintf("assets[%d].alt", index), "is required for state illustrations")
		}
		if _, exists := resourceIDs[asset.ID]; exists {
			return invalidManifest("resources", "contains duplicate IDs")
		}
		if _, exists := usedSlots[asset.Slot]; exists {
			return invalidManifest("assets", "contains a duplicate single-value slot")
		}
		resourceIDs[asset.ID] = struct{}{}
		usedSlots[asset.Slot] = struct{}{}
	}
	if input.Fonts == nil {
		input.Fonts = []ThemeFontFace{}
	}
	if input.Assets == nil {
		input.Assets = []ThemeAsset{}
	}
	return nil
}

func validScheme(scheme ColorScheme) bool { return scheme == SchemeLight || scheme == SchemeDark }

func validIconPack(pack IconPack) bool {
	return slices.Contains([]IconPack{IconLucide, IconHeroiconsOutline, IconHeroiconsSolid, IconPhosphor, IconTabler}, pack)
}

func validKeyword(value string) bool {
	return value != "" && len(value) <= 128 && keywordPattern.MatchString(value)
}

func invalidManifest(path, reason string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalidManifest, path, reason)
}
