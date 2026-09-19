package main

import (
	"testing"

	"github.com/openpost/backend/internal/config"
	"github.com/stretchr/testify/require"
)

type recordingMCPToolModeSetter struct {
	mode string
}

func (s *recordingMCPToolModeSetter) SetToolMode(mode string) {
	s.mode = mode
}

func TestConfigureMCPToolModeUsesLoadedServerConfig(t *testing.T) {
	t.Parallel()

	for _, mode := range []string{config.MCPModeDirect, config.MCPModeSearch, config.MCPModeBoth} {
		mode := mode
		t.Run(mode, func(t *testing.T) {
			t.Parallel()
			setter := &recordingMCPToolModeSetter{}

			configureMCPToolMode(setter, &config.Config{MCPMode: mode})

			require.Equal(t, mode, setter.mode)
		})
	}
}
