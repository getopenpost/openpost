package platform

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestNativePostSupportForKeepsXDisabled(t *testing.T) {
	t.Parallel()

	bluesky := NativePostSupportFor("bluesky")
	require.True(t, bluesky.Supported)

	mastodon := NativePostSupportFor("mastodon")
	require.True(t, mastodon.Supported)

	x := NativePostSupportFor("x")
	require.False(t, x.Supported)
	require.Contains(t, x.UnavailableReason, "read-cost policy")

	for _, provider := range []string{"threads", "instagram", "facebook", "linkedin", "tiktok", "youtube", "pinterest"} {
		support := NativePostSupportFor(provider)
		require.False(t, support.Supported, provider)
		require.NotEmpty(t, support.UnavailableReason, provider)
	}

	_, ok := NewNativePostReader("x", "")
	require.False(t, ok)
	_, ok = NewNativePostReader("threads", "")
	require.False(t, ok)
	reader, ok := NewNativePostReader("bluesky", "")
	require.True(t, ok)
	require.NotNil(t, reader)
}

func TestNormalizeNativePostItemRejectsNonExternalOrigin(t *testing.T) {
	t.Parallel()

	published := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	item, err := NormalizeNativePostItem(NativePostItem{
		ProviderPostID: "at://did:plc:test/app.bsky.feed.post/abc",
		Text:           "hello",
		ExternalURL:    "https://bsky.app/profile/test/post/abc",
		PublishedAt:    published,
		Origin:         "openpost",
	})
	require.Error(t, err)
	require.Empty(t, item.ProviderPostID)

	item, err = NormalizeNativePostItem(NativePostItem{
		ProviderPostID: "at://did:plc:test/app.bsky.feed.post/abc",
		Text:           "hello",
		ExternalURL:    "https://bsky.app/profile/test/post/abc",
		PublishedAt:    published,
		Origin:         ImportedPostOriginExternal,
	})
	require.NoError(t, err)
	require.Equal(t, ImportedPostOriginExternal, item.Origin)
	require.Equal(t, published, item.PublishedAt)
}

func TestBlueskyReaderImportsOriginalsOnly(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		require.Equal(t, "/xrpc/app.bsky.feed.getAuthorFeed", req.URL.Path)
		require.Equal(t, "did:plc:owner", req.URL.Query().Get("actor"))
		require.Equal(t, "posts_no_replies", req.URL.Query().Get("filter"))
		require.Equal(t, "Bearer token", req.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"cursor":"next-page","feed":[
			{"post":{"uri":"at://did:plc:owner/app.bsky.feed.post/aaa","author":{"did":"did:plc:owner","handle":"owner.test"},"record":{"text":"first","createdAt":"2026-09-20T10:00:00Z"},"indexedAt":"2026-09-20T10:00:01Z"}},
			{"post":{"uri":"at://did:plc:owner/app.bsky.feed.post/bbb","author":{"did":"did:plc:owner","handle":"owner.test"},"record":{"text":"boosted","createdAt":"2026-09-19T10:00:00Z"},"indexedAt":"2026-09-19T10:00:01Z"},"reason":{"$type":"app.bsky.feed.defs#reasonRepost"}},
			{"post":{"uri":"at://did:plc:owner/app.bsky.feed.post/ccc","author":{"did":"did:plc:owner","handle":"owner.test"},"record":{"text":"reply","createdAt":"2026-09-18T10:00:00Z"},"indexedAt":"2026-09-18T10:00:01Z"},"reply":{"root":{}}},
			{"post":{"uri":"at://did:plc:other/app.bsky.feed.post/ddd","author":{"did":"did:plc:other","handle":"other.test"},"record":{"text":"foreign","createdAt":"2026-09-17T10:00:00Z"},"indexedAt":"2026-09-17T10:00:01Z"}}
		]}`))
	}))
	defer server.Close()

	adapter := NewBlueskyAdapter(server.URL)
	page, err := adapter.ListNativePosts(context.Background(), "token", NativePostRequest{
		AccountID: "did:plc:owner",
		PageSize:  10,
	})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Equal(t, "at://did:plc:owner/app.bsky.feed.post/aaa", page.Items[0].ProviderPostID)
	require.Equal(t, "first", page.Items[0].Text)
	require.Equal(t, "https://bsky.app/profile/owner.test/post/aaa", page.Items[0].ExternalURL)
	require.Equal(t, ImportedPostOriginExternal, page.Items[0].Origin)
	require.Equal(t, "next-page", page.NextCursor)
	require.Equal(t, NativePostPartial, page.Coverage)
}

func TestBlueskyReaderStopsAtWatermark(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"cursor":"older","feed":[
			{"post":{"uri":"at://did:plc:owner/app.bsky.feed.post/new","author":{"did":"did:plc:owner","handle":"o.t"},"record":{"text":"new","createdAt":"2026-09-20T10:00:00Z"},"indexedAt":"2026-09-20T10:00:01Z"}},
			{"post":{"uri":"at://did:plc:owner/app.bsky.feed.post/old","author":{"did":"did:plc:owner","handle":"o.t"},"record":{"text":"old","createdAt":"2026-09-10T10:00:00Z"},"indexedAt":"2026-09-10T10:00:01Z"}}
		]}`))
	}))
	defer server.Close()

	adapter := NewBlueskyAdapter(server.URL)
	page, err := adapter.ListNativePosts(context.Background(), "token", NativePostRequest{
		AccountID:      "did:plc:owner",
		PublishedAfter: time.Date(2026, 9, 15, 0, 0, 0, 0, time.UTC),
	})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Empty(t, page.NextCursor)
	require.Equal(t, NativePostComplete, page.Coverage)
}

func TestBlueskyReaderMapsPermissionFailureWithoutDisconnect(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"AuthRequired"}`))
	}))
	defer server.Close()

	adapter := NewBlueskyAdapter(server.URL)
	_, err := adapter.ListNativePosts(context.Background(), "stale", NativePostRequest{AccountID: "did:plc:owner"})
	require.Error(t, err)
	var nativeErr *NativePostError
	require.ErrorAs(t, err, &nativeErr)
	require.Equal(t, NativePostPermissionRequired, nativeErr.Status)
}

func TestMastodonReaderImportsOriginalsWithMaxIDCursor(t *testing.T) {
	t.Parallel()

	var gotQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		require.Equal(t, "/api/v1/accounts/42/statuses", req.URL.Path)
		gotQuery = req.URL.RawQuery
		require.Equal(t, "Bearer token", req.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
			{"id":"300","created_at":"2026-09-20T10:00:00Z","content":"<p>third</p>","spoiler_text":"","url":"https://mastodon.test/@owner/300","reblog":null,"in_reply_to_id":null,"account":{"id":"42"}},
			{"id":"200","created_at":"2026-09-19T10:00:00Z","content":"<p>boost</p>","spoiler_text":"","url":"https://mastodon.test/@owner/200","reblog":{"id":"999"},"in_reply_to_id":null,"account":{"id":"42"}},
			{"id":"100","created_at":"2026-09-18T10:00:00Z","content":"<p>reply</p>","spoiler_text":"","url":"https://mastodon.test/@owner/100","reblog":null,"in_reply_to_id":"50","account":{"id":"42"}}
		]`))
	}))
	defer server.Close()

	adapter := NewMastodonAdapter("", "", "", server.URL)
	page, err := adapter.ListNativePosts(context.Background(), "token", NativePostRequest{
		AccountID:   "42",
		InstanceURL: server.URL,
		PageSize:    3,
	})
	require.NoError(t, err)
	require.Contains(t, gotQuery, "exclude_replies=true")
	require.Contains(t, gotQuery, "exclude_reblogs=true")
	require.Len(t, page.Items, 1)
	require.Equal(t, "300", page.Items[0].ProviderPostID)
	require.Equal(t, "third", page.Items[0].Text)
	require.Equal(t, "100", page.NextCursor)
	require.Equal(t, NativePostPartial, page.Coverage)
}

func TestMastodonReaderCompletesOnShortPage(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
			{"id":"300","created_at":"2026-09-20T10:00:00Z","content":"<p>only</p>","spoiler_text":"cw","url":"https://mastodon.test/@owner/300","reblog":null,"in_reply_to_id":null,"account":{"id":"42"}}
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
	require.True(t, strings.HasPrefix(page.Items[0].Text, "cw"))
	require.Empty(t, page.NextCursor)
	require.Equal(t, NativePostComplete, page.Coverage)
}
