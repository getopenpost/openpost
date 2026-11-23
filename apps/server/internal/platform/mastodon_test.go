package platform

import (
	"context"

	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMastodonPublishRejectsPollWithMedia(t *testing.T) {
	adapter := NewMastodonAdapter("client-id", "client-secret", "https://app.example/callback", "https://mastodon.example")
	_, err := adapter.Publish(context.Background(), "access-token", "acct-1", &PublishRequest{
		Content:          "Launch post",
		PlatformMediaIDs: []string{"media-1"},
		Settings: map[string]interface{}{
			"poll_options": "One\nTwo",
		},
	})
	if err == nil || !strings.Contains(err.Error(), "polls cannot be combined with media") {
		t.Fatalf("expected poll/media conflict, got %v", err)
	}
}

func assertFormValue(t *testing.T, values url.Values, key, want string) {
	t.Helper()
	if got := values.Get(key); got != want {
		t.Fatalf("expected %s=%q, got %q in %#v", key, want, got, values)
	}
}

func TestMastodonRepostKeepsTargetLocalSourceIDForUnrepost(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	requests := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests++
		switch requests {
		case 1:
			require.Equal(t, "/api/v2/search", req.URL.Path)
			return jsonResponse(req, `{"statuses":[{"id":"target-local-source"}]}`), nil
		case 2:
			require.Equal(t, "/api/v1/statuses/target-local-source/reblog", req.URL.Path)
			return jsonResponse(req, `{"id":"reblog-wrapper","reblog":{"id":"target-local-source"}}`), nil
		case 3:
			require.Equal(t, "/api/v1/statuses/target-local-source/unreblog", req.URL.Path)
			return jsonResponse(req, `{"id":"target-local-source","reblogged":false}`), nil
		default:
			t.Fatalf("unexpected request %d", requests)
		}
		return nil, nil
	})}

	adapter := NewMastodonAdapter("", "", "", "https://target.example")
	result, err := adapter.Repost(t.Context(), "token", "target", RepostRequest{
		SourceInstanceURL: "https://source.example", ExternalID: "source-instance-id", ExternalURL: "https://source.example/@author/1",
	})
	require.NoError(t, err)
	require.Equal(t, "target-local-source", result.ExternalID)
	require.NoError(t, adapter.Unrepost(t.Context(), "token", "target", UnrepostRequest{RepostExternalID: result.ExternalID}))
	require.Equal(t, 3, requests)
}
