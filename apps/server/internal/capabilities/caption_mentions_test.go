package capabilities

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestUnsupportedSettingNullIsAbsent(t *testing.T) {
	capability := Capability{Provider: ProviderDiscord, Label: "Discord attachment"}
	require.Empty(t, validateUnsupportedSettings(capability, map[string]any{"unknown_option": nil}))
	for _, value := range []any{false, 0, "value", map[string]any{}} {
		requireIssueCode(t, validateUnsupportedSettings(capability, map[string]any{"unknown_option": value}), "unsupported_setting")
	}
}
