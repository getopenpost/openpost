package messaging

import (
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestProviderKeyIsolatesNonDefaultBlueskyPDS(t *testing.T) {
	t.Parallel()

	require.Equal(t, "bluesky:https://pds.example",
		providerKey(models.SocialAccount{Platform: "bluesky", InstanceURL: "https://pds.example"}))
	require.Equal(t, "bluesky",
		providerKey(models.SocialAccount{Platform: "bluesky", InstanceURL: "https://bsky.social"}))
}
