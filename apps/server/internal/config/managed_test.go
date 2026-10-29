package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLinkedInAuthModeDefaultsAndManagedSelection(t *testing.T) {
	t.Setenv("OPENPOST_LINKEDIN_AUTH_MODE", "")
	cfg := Load()
	value, err := cfg.ManagedValue("OPENPOST_LINKEDIN_AUTH_MODE")
	require.NoError(t, err)
	require.Equal(t, "openid", value)
	require.NoError(t, cfg.ApplyManagedValue("OPENPOST_LINKEDIN_AUTH_MODE", "community_management"))
	value, err = cfg.ManagedValue("OPENPOST_LINKEDIN_AUTH_MODE")
	require.NoError(t, err)
	require.Equal(t, "community_management", value)
	require.Error(t, cfg.ApplyManagedValue("OPENPOST_LINKEDIN_AUTH_MODE", "unavailable"))
	t.Setenv("OPENPOST_LINKEDIN_AUTH_MODE", "community_management")
	value, err = Load().ManagedValue("OPENPOST_LINKEDIN_AUTH_MODE")
	require.NoError(t, err)
	require.Equal(t, "community_management", value)
}

func TestManagedSettingRegistryBindingsRoundTrip(t *testing.T) {
	cfg := Load()
	definitions := ManagedSettingDefinitions()
	require.Len(t, managedSettingBindings, len(definitions))

	for _, definition := range definitions {
		value, err := cfg.ManagedValue(definition.Key)
		require.NoError(t, err, definition.Key)

		copy := *cfg
		require.NoError(t, copy.ApplyManagedValue(definition.Key, value), definition.Key)
		roundTripped, err := copy.ManagedValue(definition.Key)
		require.NoError(t, err, definition.Key)
		require.Equal(t, value, roundTripped, definition.Key)
	}

	independent := Config{SupportEmail: "old@example.test", FeedbackRecipient: "untouched"}
	require.NoError(t, independent.ApplyManagedValue("OPENPOST_DISABLE_REGISTRATIONS", "true"))
	require.True(t, independent.DisableRegistrations)
	require.False(t, independent.OAuthDCR, "registration settings must bind to their own fields")
	require.NoError(t, independent.ApplyManagedValue("OPENPOST_SUPPORT_EMAIL", "ops@example.test"))
	require.Equal(t, "ops@example.test", independent.SupportEmail)
	require.Equal(t, "untouched", independent.FeedbackRecipient)
}
