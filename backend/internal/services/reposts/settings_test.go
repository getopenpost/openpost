package reposts

import (
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRepostProviderKeyIsolatesNonDefaultBlueskyPDS(t *testing.T) {
	t.Parallel()

	require.Equal(t, "bluesky:https://pds.example",
		repostProviderKey(models.SocialAccount{Platform: "bluesky", InstanceURL: "https://pds.example"}))
	require.Equal(t, "bluesky",
		repostProviderKey(models.SocialAccount{Platform: "bluesky", InstanceURL: "https://bsky.social"}))
}
