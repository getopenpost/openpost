package connectors

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLoadConfigRejectsInlineSecretsAndUnknownFields(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	configPath := filepath.Join(dir, "connectors.json")
	require.NoError(t, os.WriteFile(configPath, []byte(`{
  "version": 1,
  "installations": [{
    "id": "directus-main",
    "endpoint": {
      "mode": "public_https",
      "base_url": "https://connector.example.com"
    },
    "auth": {
      "bearer_token": "must-not-be-inline"
    }
  }]
}`), 0o600))

	_, err := LoadConfig(configPath)
	require.ErrorContains(t, err, "unknown field")
}

func TestLoadConfigRejectsRelativeSecretFiles(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	configPath := filepath.Join(dir, "connectors.json")
	require.NoError(t, os.WriteFile(configPath, []byte(`{
  "version": 1,
  "installations": [{
    "id": "directus-main",
    "endpoint": {"mode": "public_https", "base_url": "https://connector.example.com"},
    "auth": {"bearer_token_file": "relative-token"}
  }]
}`), 0o600))

	_, err := LoadConfig(configPath)
	require.ErrorContains(t, err, "must be an absolute path")
}
