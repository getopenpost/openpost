package engagement

import (
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestEngagementProviderKeyIsolatesNonDefaultBlueskyPDS(t *testing.T) {
	t.Parallel()

	require.Equal(t, "bluesky:https://pds.example",
		engagementProviderKey(models.SocialAccount{Platform: "bluesky", InstanceURL: "https://pds.example"}))
	require.Equal(t, "bluesky",
		engagementProviderKey(models.SocialAccount{Platform: "bluesky", InstanceURL: "https://bsky.social"}))
}
