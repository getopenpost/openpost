package growth

import (
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestProviderKeyForAccountIsolatesNonDefaultBlueskyPDS(t *testing.T) {
	t.Parallel()

	require.Equal(t, "bluesky:https://pds.example",
		providerKeyForAccount(models.SocialAccount{Platform: "bluesky", InstanceURL: "https://pds.example"}))
	require.Equal(t, "bluesky",
		providerKeyForAccount(models.SocialAccount{Platform: "bluesky", InstanceURL: "https://bsky.social"}))
}
