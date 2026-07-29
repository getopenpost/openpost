package platform

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMetaContentURLResolversReturnCanonicalPermalinks(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, "access-token", req.URL.Query().Get(oauthParamAccessToken))
		switch req.URL.Host {
		case "graph.facebook.com":
			switch req.URL.Query().Get("fields") {
			case "permalink_url":
				return jsonResponse(req, `{"permalink_url":"https://www.facebook.com/example/posts/123"}`), nil
			case "permalink":
				return jsonResponse(req, `{"permalink":"https://www.instagram.com/p/example/"}`), nil
			}
		case "graph.threads.net":
			require.Equal(t, "permalink", req.URL.Query().Get("fields"))
			return jsonResponse(req, `{"permalink":"https://www.threads.net/@openpost/post/example"}`), nil
		}
		t.Fatalf("unexpected content URL request %s", req.URL.String())
		return nil, nil
	})}

	facebookURL, err := NewFacebookAdapter("", "", "").ResolveContentURL(
		context.Background(), "access-token", "page-1", "page-1_post-1",
	)
	require.NoError(t, err)
	require.Equal(t, "https://www.facebook.com/example/posts/123", facebookURL)

	instagramURL, err := NewInstagramAdapter("", "", "").ResolveContentURL(
		context.Background(), "access-token", "ig-1", "media-1",
	)
	require.NoError(t, err)
	require.Equal(t, "https://www.instagram.com/p/example/", instagramURL)

	threadsURL, err := NewThreadsAdapter("", "", "").ResolveContentURL(
		context.Background(), "access-token", "threads-1", "post-1",
	)
	require.NoError(t, err)
	require.Equal(t, "https://www.threads.net/@openpost/post/example", threadsURL)
}
