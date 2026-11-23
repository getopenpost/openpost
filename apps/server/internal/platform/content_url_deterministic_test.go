package platform

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDeterministicContentURL(t *testing.T) {
	t.Parallel()
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
		{name: "mastodon full handle", provider: "mastodon", username: "rgo@mastodon.social", instance: "https://mastodon.social", externalID: "456", want: "https://mastodon.social/@rgo/456"},
		{name: "mastodon full handle with leading at", provider: "mastodon", username: "@rgo@mastodon.social", instance: "https://mastodon.social", externalID: "456", want: "https://mastodon.social/@rgo/456"},
		{name: "pixelfed", provider: "pixelfed", username: "rgo@pixelfed.social", instance: "https://pixelfed.social", externalID: "789", want: "https://pixelfed.social/@rgo/789"},
		{name: "bluesky", provider: "bluesky", externalID: `{"uri":"at://did:plc:rgo/app.bsky.feed.post/3abc","cid":"cid"}`, want: "https://bsky.app/profile/did:plc:rgo/post/3abc"},
		{name: "linkedin", provider: "linkedin", externalID: "urn:li:share:789", want: "https://www.linkedin.com/feed/update/urn:li:share:789"},
		{name: "pinterest", provider: "pinterest", externalID: "993607355001234567", want: "https://www.pinterest.com/pin/993607355001234567/"},
		{name: "tiktok", provider: "tiktok", username: "@rgo", externalID: "741234", want: "https://www.tiktok.com/@rgo/video/741234"},
		{name: "youtube", provider: "youtube", externalID: "video-1", want: "https://www.youtube.com/watch?v=video-1"},
		{name: "peertube", provider: "peertube", instance: "https://video.example", externalID: "uuid-1234", want: "https://video.example/videos/watch/uuid-1234"},
		{name: "lemmy", provider: "lemmy", instance: "https://lemmy.example", externalID: "12345", want: "https://lemmy.example/post/12345"},
		{name: "piefed", provider: "piefed", instance: "https://piefed.example", externalID: "67890", want: "https://piefed.example/post/67890"},
		{name: "facebook", provider: "facebook", externalID: "123456789_987654321", want: "https://www.facebook.com/123456789_987654321"},
		{name: "devnull", provider: "devnull", username: "testuser", externalID: "01a14c0f-6e52-4b1c-9a1d-2f4b5c6d7e8f", want: "https://dev-null.sh/@testuser/commits/01a14c0f-6e52-4b1c-9a1d-2f4b5c6d7e8f"},
		{name: "devnull link", provider: "devnull", username: "testuser", externalID: "https://dev-null.sh/@testuser/commits/01a14c0f", want: "https://dev-null.sh/@testuser/commits/01a14c0f"},
		{name: "unsafe id is rejected", provider: "x", externalID: "123/../../settings", want: ""},
		{name: "unsafe id with space is rejected", provider: "mastodon", username: "rgo", instance: "https://mastodon.social", externalID: "12 34", want: ""},
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
	t.Parallel()
	require.Empty(t, DeterministicContentURL("x", "", "", "", "123/../../settings"))
	require.Empty(t, DeterministicContentURL("threads", "", "", "", "javascript:alert(1)"))
	require.Empty(t, DeterministicContentURL("pinterest", "", "", "", "123/../../settings"))
	require.Empty(t, DeterministicContentURL("x", "", "", "", "https://user:secret@example.com/post"))
	require.False(t, IsSafeContentURL("https://user:secret@example.com/post"))
}

func TestTikTokPhotoContentURL(t *testing.T) {
	t.Parallel()
	require.Equal(t, "https://www.tiktok.com/@rgo/photo/741234", DeterministicContentURL("tiktok", "", "rgo", "", "741234", "tiktok.photo"))
	require.Empty(t, DeterministicContentURL("tiktok", "", "rgo", "", "p_pub_reference", "tiktok.photo"))
}
