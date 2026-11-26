package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBlueskyReaderMapsPermissionFailureWithoutDisconnect(t *testing.T) {
	server := newProviderTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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

func TestBlueskyReaderLinksThroughDIDWhenHandleIsInvalid(t *testing.T) {
	var response blueskyAuthorFeedResponse
	require.NoError(t, json.Unmarshal([]byte(`{"feed":[
		{"post":{"uri":"at://did:plc:owner/app.bsky.feed.post/aaa","author":{"did":"did:plc:owner","handle":"handle.invalid"},"record":{"text":"hello","createdAt":"2026-09-20T10:00:00Z"},"indexedAt":"2026-09-20T10:00:00Z"}},
		{"post":{"uri":"at://did:plc:owner/app.bsky.feed.post/bbb","author":{"did":"did:plc:owner","handle":"owner.test"},"record":{"text":"again","createdAt":"2026-09-19T10:00:00Z"},"indexedAt":"2026-09-19T10:00:00Z"}}
	]}`), &response))

	page := nativePostBlueskyPage(response, NativePostRequest{AccountID: "did:plc:owner"})
	require.Len(t, page.Items, 2)
	require.Equal(t, "https://bsky.app/profile/did:plc:owner/post/aaa", page.Items[0].ExternalURL)
	require.Equal(t, "https://bsky.app/profile/owner.test/post/bbb", page.Items[1].ExternalURL)
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
