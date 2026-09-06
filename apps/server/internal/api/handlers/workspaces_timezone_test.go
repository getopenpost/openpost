package handlers

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNormalizedWorkspaceTimezone(t *testing.T) {
	t.Parallel()

	timezone, valid := normalizedWorkspaceTimezone(" America/New_York ")
	require.True(t, valid)
	require.Equal(t, "America/New_York", timezone)

	for _, value := range []string{"", "Bad/Zone", "Local"} {
		value := value
		t.Run(value, func(t *testing.T) {
			t.Parallel()
			_, valid := normalizedWorkspaceTimezone(value)
			require.False(t, valid)
		})
	}
}
