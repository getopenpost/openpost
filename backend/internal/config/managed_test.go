package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

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
}
