package platform

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDeterministicContentURL(t *testing.T) {
	tests := []struct {
		name       string
		provider   string
		accountID  string
		username   string
		instance   string
		externalID string
		want       string
	}{
		{name: "x", provider: "x", externalID: "123", want: "https://x.com/i/web/status/123"},
		{name: "mastodon", provider: "mastodon", username: "@rgo", instance: "https://mastodon.social", externalID: "456", want: "https://mastodon.social/@rgo/456"},
		{name: "bluesky", provider: "bluesky", externalID: `{"uri":"at://did:plc:rgo/app.bsky.feed.post/3abc","cid":"cid"}`, want: "https://bsky.app/profile/did:plc:rgo/post/3abc"},
		{name: "linkedin", provider: "linkedin", externalID: "urn:li:share:789", want: "https://www.linkedin.com/feed/update/urn:li:share:789"},
		{name: "tiktok", provider: "tiktok", username: "@rgo", externalID: "741234", want: "https://www.tiktok.com/@rgo/video/741234"},
		{name: "youtube", provider: "youtube", externalID: "video-1", want: "https://www.youtube.com/watch?v=video-1"},
		{name: "existing url", provider: "threads", externalID: "https://www.threads.net/@rgo/post/example", want: "https://www.threads.net/@rgo/post/example"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Equal(t, test.want, DeterministicContentURL(
				test.provider,
				test.accountID,
				test.username,
				test.instance,
				test.externalID,
			))
		})
	}
}

func TestDeterministicContentURLRejectsUnsafeValues(t *testing.T) {
	require.Empty(t, DeterministicContentURL("x", "", "", "", "123/../../settings"))
	require.Empty(t, DeterministicContentURL("threads", "", "", "", "javascript:alert(1)"))
	require.False(t, IsSafeContentURL("https://user:secret@example.com/post"))
}
