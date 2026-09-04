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
