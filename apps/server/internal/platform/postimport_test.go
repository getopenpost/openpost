package platform

import (
	"context"

	"net/http"

	"testing"

	"github.com/stretchr/testify/require"
)

func TestBlueskyReaderContinuesPastRepostOnlyPage(t *testing.T) {
	server := newProviderTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if req.URL.Query().Get("cursor") == "next" {
			_, _ = w.Write([]byte(`{"feed":[{"post":{"uri":"at://did:plc:owner/app.bsky.feed.post/original","author":{"did":"did:plc:owner","handle":"owner.test"},"record":{"text":"original","createdAt":"2026-09-26T10:00:00Z"}}}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"cursor":"next","feed":[{"reason":{"$type":"app.bsky.feed.defs#reasonRepost"},"post":{"uri":"at://did:plc:owner/app.bsky.feed.post/repost","author":{"did":"did:plc:owner"}}}]}`))
	}))
	defer server.Close()
	adapter := NewBlueskyAdapter(server.URL)
	first, err := adapter.ListNativePosts(context.Background(), "token", NativePostRequest{AccountID: "did:plc:owner"})
	require.NoError(t, err)
	require.Empty(t, first.Items)
	require.Equal(t, "next", first.NextCursor)
	second, err := adapter.ListNativePosts(context.Background(), "token", NativePostRequest{AccountID: "did:plc:owner", Cursor: first.NextCursor})
	require.NoError(t, err)
	require.Len(t, second.Items, 1)
}

func TestMastodonReaderKeepsParagraphAndLineBreaks(t *testing.T) {
	server := newProviderTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
			{"id":"300","created_at":"2026-09-20T10:00:00Z","content":"<p>First line<br />second line</p><p>Tom &amp; Jerry <a href=\"https://mastodon.test/tags/cats\" class=\"mention hashtag\" rel=\"tag\">#<span>cats</span></a></p>","spoiler_text":"","url":"https://mastodon.test/@owner/300","reblog":null,"in_reply_to_id":null,"account":{"id":"42"}}
		]`))
	}))
	defer server.Close()

	adapter := NewMastodonAdapter("", "", "", server.URL)
	page, err := adapter.ListNativePosts(context.Background(), "token", NativePostRequest{
		AccountID:   "42",
		InstanceURL: server.URL,
		PageSize:    20,
	})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Equal(t, "First line\nsecond line\n\nTom & Jerry #cats", page.Items[0].Text)
}

func TestFacebookNativeReadsCarryPhotoIdentityAliases(t *testing.T) {
	original := httpClient
	defer func() { httpClient = original }()
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return jsonResponse(r, `{"data":[{"id":"page_feed","from":{"id":"page"},"created_time":"2026-10-10T10:00:00Z","attachments":{"data":[{"target":{"id":"photo"}}]}}]}`), nil
	})}
	page, err := NewFacebookAdapter("", "", "").ListNativePosts(t.Context(), "token", NativePostRequest{AccountID: "page"})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Contains(t, page.Items[0].IdentityAliases, "photo")
}
