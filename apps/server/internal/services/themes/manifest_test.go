package themes

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDecodeManifestRejectsUnknownAndFutureSchemas(t *testing.T) {
	raw, err := json.Marshal(BuiltIns()["workshop"])
	require.NoError(t, err)
	unknown := []byte(strings.Replace(string(raw), `"name":"Workshop"`, `"name":"Workshop","unexpected":true`, 1))
	_, err = DecodeManifest(unknown)
	require.ErrorIs(t, err, ErrInvalidManifest)

	for _, schemaVersion := range []int{2, 99} {
		manifest := BuiltIns()["workshop"]
		manifest.SchemaVersion = schemaVersion
		_, err = NormalizeManifest(manifest)
		require.ErrorIs(t, err, ErrInvalidManifest)
		require.ErrorContains(t, err, "schemaVersion")
	}
}

func TestDitherRecipeRejectsUnreadableCustomActionTexture(t *testing.T) {
	manifest := *BuiltIns()["workshop"].Schemes.Light
	_, err := NormalizeSchemeManifest(SchemeLight, manifest)
	require.NoError(t, err)
	manifest.Components.Button = "dither"
	_, err = NormalizeSchemeManifest(SchemeLight, manifest)
	require.ErrorIs(t, err, ErrInvalidManifest)
	require.ErrorContains(t, err, "dither")
}

func TestDitherRecipeRejectsIndistinguishableCustomTexture(t *testing.T) {
	manifest := *BuiltIns()["dither"].Schemes.Light
	manifest.Colors.ActionFocal = "#7309cb"
	manifest.Colors.ActionFocalHover = "#6b08b5"
	manifest.Colors.ActionFocalActive = "#6007a5"
	manifest.Colors.ActionFocalInk = "#6bdd0a"
	manifest.Components.Button = "solid"
	_, err := NormalizeSchemeManifest(SchemeLight, manifest)
	require.NoError(t, err, "the palette is safe without the dither texture")
	manifest.Components.Button = "dither"
	_, err = NormalizeSchemeManifest(SchemeLight, manifest)
	require.ErrorContains(t, err, "dither texture")
}

func TestDecodeStoredManifestRejectsClientSuppliedNativeDerivative(t *testing.T) {
	manifest := BuiltIns()["workshop"]
	manifest.Fonts = []ThemeFontFace{{
		ID: "font-1", Family: "Custom Sans", SourceURL: "asset:font-1",
		Format: "woff2", Weight: 400, Style: "normal", Display: "swap",
	}}
	raw, err := json.Marshal(manifest)
	require.NoError(t, err)
	withDerivative := strings.Replace(
		string(raw),
		`"display":"swap"`,
		`"display":"swap","nativeDerivative":{"sourceUrl":"/private","format":"ttf","identity":"forged"}`,
		1,
	)
	_, err = DecodeManifest([]byte(withDerivative))
	require.ErrorIs(t, err, ErrInvalidManifest)
	require.ErrorContains(t, err, "unknown field")
}
