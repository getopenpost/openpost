package themes

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
)

// builtins.v1.json is the code-owned contract consumed by both the backend and
// embedded web runtime. Keeping the complete manifests in one fixture prevents
// fallback behavior from changing when the network is unavailable.
//
//go:embed builtins.v1.json
var builtInFixture []byte

var builtInOrder = []string{
	"workshop",
	"studio",
	"notebook",
	"playroom",
	"cloud-garden",
	"study-hall",
	"corkboard",
	"midnight",
}

// BuiltIns returns fresh copies so callers cannot mutate the code-owned
// manifests used by later resolutions.
func BuiltIns() map[string]BuiltInFamily {
	decoder := json.NewDecoder(bytes.NewReader(builtInFixture))
	decoder.DisallowUnknownFields()
	var decoded []ThemeManifest
	if err := decoder.Decode(&decoded); err != nil {
		panic(fmt.Sprintf("decode built-in theme fixture: %v", err))
	}
	if decoder.Decode(&struct{}{}) == nil {
		panic("decode built-in theme fixture: multiple JSON values")
	}
	if len(decoded) != len(builtInOrder) {
		panic(fmt.Sprintf("decode built-in theme fixture: got %d themes, want %d", len(decoded), len(builtInOrder)))
	}
	result := make(map[string]BuiltInFamily, len(decoded))
	for index, candidate := range decoded {
		normalized, err := NormalizeManifest(candidate)
		if err != nil {
			panic(fmt.Sprintf("validate built-in theme %q: %v", candidate.ID, err))
		}
		if normalized.ID != builtInOrder[index] || normalized.Revision != "builtin-v1" {
			panic(fmt.Sprintf("decode built-in theme fixture: unexpected identity %q at index %d", normalized.ID, index))
		}
		if _, exists := result[normalized.ID]; exists {
			panic(fmt.Sprintf("decode built-in theme fixture: duplicate id %q", normalized.ID))
		}
		result[normalized.ID] = normalized
	}
	return result
}

func Workshop(scheme ColorScheme) ThemeSchemeManifest {
	family := BuiltIns()["workshop"]
	manifest := family.Schemes.For(scheme)
	if manifest == nil {
		panic(fmt.Sprintf("Workshop fixture does not support %q", scheme))
	}
	return *manifest
}

func protectedEditorTokens(scheme ColorScheme) ThemeProtectedEditorTokens {
	if scheme == SchemeDark {
		return ThemeProtectedEditorTokens{"oklch(0.12 0.006 55)", "oklch(0.18 0.008 55)", "oklch(0.22 0.01 55)", "oklch(0.27 0.012 55)", "oklch(0.29 0.01 55)", "oklch(0.7 0.01 75)", "oklch(0.94 0.004 85)", "oklch(0.72 0.16 45)", "oklch(0.52 0.09 45)", "oklch(0.16 0.008 55)", "oklch(0.3 0.04 250)", "oklch(0.76 0.04 245)", "oklch(0.72 0.16 45)", "oklch(0.38 0.08 45)", "oklch(0.1 0.005 55)", "oklch(0.25 0.01 55)", "oklch(0.98 0 0)", "oklch(0.72 0.16 45)", "oklch(0.8 0.03 245 / 0.72)", "oklch(0.94 0.004 85)"}
	}
	return ThemeProtectedEditorTokens{"oklch(0.15 0.006 55)", "oklch(0.2 0.008 55)", "oklch(0.24 0.01 55)", "oklch(0.29 0.012 55)", "oklch(0.32 0.01 55)", "oklch(0.7 0.01 75)", "oklch(0.94 0.004 85)", "oklch(0.65 0.15 45)", "oklch(0.5 0.09 45)", "oklch(0.18 0.008 55)", "oklch(0.31 0.04 250)", "oklch(0.74 0.04 245)", "oklch(0.65 0.15 45)", "oklch(0.36 0.07 45)", "oklch(0.12 0.006 55)", "oklch(0.28 0.01 55)", "oklch(0.98 0 0)", "oklch(0.65 0.15 45)", "oklch(0.78 0.03 245 / 0.72)", "oklch(0.94 0.004 85)"}
}

func family(id, name, description string, iconPack IconPack, schemes ThemeSchemes) ThemeManifest {
	return ThemeManifest{SchemaVersion: ManifestSchemaVersion, ID: id, Revision: "builtin-v1", Name: name, Description: description, IconPack: iconPack, SupportedSchemes: supportedSchemes(schemes), Schemes: schemes, Fonts: []ThemeFontFace{}, Assets: []ThemeAsset{}}
}
