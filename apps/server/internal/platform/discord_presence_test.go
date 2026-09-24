package platform

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNormalizeDiscordPresenceStreamURL(t *testing.T) {
	url, err := NormalizeDiscordPresenceStreamURL(" https://www.youtube.com/watch?v=openpost ")

	require.NoError(t, err)
	require.Equal(t, "https://www.youtube.com/watch?v=openpost", url)
}
