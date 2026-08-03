package publisher

import (
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRequiresPublicMediaUsesProfileCapability(t *testing.T) {
	require.True(t, requiresPublicMedia("threads", models.ContentProfileCarousel))
	require.False(t, requiresPublicMedia("threads", models.ContentProfileShortText))
	require.True(t, requiresPublicMedia("tiktok", models.ContentProfileShortVideo))
	require.False(t, requiresPublicMedia("mastodon", models.ContentProfileImagePost))
}

func TestRequiresPublicMediaFallsBackForLegacyProfiles(t *testing.T) {
	require.True(t, requiresPublicMedia("threads", "legacy-profile"))
	require.False(t, requiresPublicMedia("mastodon", "legacy-profile"))
}
