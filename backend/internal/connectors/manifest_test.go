package connectors

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateManifestFailsClosedForUnknownProtocolAndControls(t *testing.T) {
	t.Parallel()

	manifest := validManifest()
	manifest.ProtocolVersion = "2.0"
	require.ErrorContains(t, ValidateManifest(&manifest), "unsupported connector protocol")

	manifest = validManifest()
	manifest.Publishing.OutputProfiles[0].Settings = []SettingDefinition{{
		Key: "status", Label: "Status", Control: "connector_html",
	}}
	require.ErrorContains(t, ValidateManifest(&manifest), "unsupported control")
}

func validManifest() Manifest {
	return Manifest{
		ProtocolVersion:       "1.0",
		ImplementationVersion: "0.1.0",
		Provider: ProviderDescriptor{
			ID:          "io.directus.items",
			DisplayName: "Directus",
		},
		CapabilityRevision: "directus-items-v1",
		Connection:         ConnectionDescriptor{Modes: []string{"preconfigured"}},
		Publishing: PublishingDescriptor{OutputProfiles: []OutputProfile{{
			ID:          "directus.item",
			DisplayName: "Create Directus item",
			Profile:     "short_text",
			Intents:     []string{"post"},
			Content:     TextConstraint{Required: true, MaxLength: 100_000},
			Media:       MediaConstraint{MinItems: 0, MaxItems: 0},
		}}},
		Operations: OperationDescriptor{Polling: true},
	}
}
