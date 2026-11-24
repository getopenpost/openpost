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
