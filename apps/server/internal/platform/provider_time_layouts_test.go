package platform

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// X returns DM event timestamps with fractional seconds, which time.RFC3339
// rejects. The collected message must keep its sent time.
func TestNativePostAndMessageTimesSurviveProviderLayouts(t *testing.T) {
	t.Run("x direct message", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			require.Equal(t, "/2/dm_events", r.URL.Path)
			_, _ = io.WriteString(w, `{"data":[{"id":"event-1","text":"hello","created_at":"2026-10-20T09:00:00.000Z","sender_id":"222","dm_conversation_id":"111-222","event_type":"MessageCreate"}],"includes":{"users":[{"id":"222","username":"friend","name":"Friend"}]}}`)
		}))
		defer server.Close()
		adapter := NewXAdapter("consumer", "secret", "")
		defer close(adapter.cleanupDone)
		adapter.apiBaseURL = server.URL
		result, err := adapter.FetchMessages(t.Context(), "access|secret", FetchMessagesRequest{AccountID: "111"})
		require.NoError(t, err)
		require.Len(t, result.Conversations, 1)
		require.Len(t, result.Conversations[0].Messages, 1)
		require.True(t, result.Conversations[0].Messages[0].RemoteCreatedAt.Equal(time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)))
	})

	// Mastodon status timestamps include milliseconds too.
	t.Run("mastodon native post", func(t *testing.T) {
		original := httpClient
		t.Cleanup(func() { httpClient = original })
		httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			require.Contains(t, r.URL.Path, "/api/v1/accounts/me/statuses")
			return jsonResponse(r, `[{"id":"1","created_at":"2026-10-20T09:00:00.000Z","content":"<p>hello</p>","url":"https://social.example/@me/1","account":{"id":"me"}}]`), nil
		})}
		reader, ok := NewNativePostReader("mastodon", "https://social.example")
		require.True(t, ok)
		page, err := reader.ListNativePosts(t.Context(), "token", NativePostRequest{AccountID: "me", InstanceURL: "https://social.example", PageSize: 10})
		require.NoError(t, err)
		require.Len(t, page.Items, 1, "a fractional status timestamp must not skip the post")
		require.True(t, page.Items[0].PublishedAt.Equal(time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)))
	})
}

func TestProviderTimeAcceptsEveryProviderLayout(t *testing.T) {
	want := time.Date(2026, 10, 26, 21, 1, 0, 0, time.UTC)
	values := map[string]string{
		"graph colonless offset": "2026-10-26T21:01:00+0000",
		"rfc 3339":               "2026-10-26T21:01:00Z",
		"offset with colon":      "2026-10-26T23:01:00+02:00",
		"fractional seconds":     "2026-10-26T21:01:00.000Z",
		"fractional colonless":   "2026-10-26T21:01:00.000+0000",
		"missing zone":           "2026-10-26T21:01:00",
		"surrounding whitespace": " 2026-10-26T21:01:00+0000 ",
	}
	for name, value := range values {
		t.Run(name, func(t *testing.T) {
			require.True(t, ProviderTime(value).Equal(want), "ProviderTime(%q)", value)
		})
	}
	for _, value := range []string{"", "   ", "not a time", "2026-10-26"} {
		t.Run("unparsed "+value, func(t *testing.T) {
			require.True(t, ProviderTime(value).IsZero())
		})
	}
}

func TestGoogleOAuthReauthenticationSubtype(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusOK} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			stubGoogleBusinessClient(t, func(req *http.Request) (*http.Response, error) {
				resp := jsonResponse(req, `{"error":"invalid_grant","error_subtype":"invalid_rapt","error_description":"private provider detail"}`)
				resp.StatusCode = status
				return resp, nil
			})
			_, err := exchangeGoogleOAuthToken(t.Context(), map[string]string{"grant_type": "refresh_token"}, "refresh")
			var providerErr *HTTPError
			require.True(t, errors.As(err, &providerErr))
			require.Equal(t, "google:invalid_rapt", providerErr.Code)
			require.Equal(t, http.StatusUnauthorized, providerErr.StatusCode)
			require.NotContains(t, err.Error(), "private provider detail")
		})
	}
}

func TestDoRequestSanitizesTransportErrors(t *testing.T) {
	secretURL := "https://graph.example/resource?access_token=secret-token"
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return nil, &url.Error{Op: req.Method, URL: req.URL.String(), Err: context.DeadlineExceeded}
	})}

	_, err := doRequestWithClient(t.Context(), client, http.MethodGet, secretURL, nil, nil)
	if err == nil {
		t.Fatal("expected transport error")
	}
	if strings.Contains(err.Error(), "secret-token") || strings.Contains(err.Error(), "graph.example") {
		t.Fatalf("transport error disclosed the request URL: %v", err)
	}
	var transportErr *TransportError
	if !errors.As(err, &transportErr) {
		t.Fatalf("expected TransportError, got %T", err)
	}
	if transportErr.Kind != TransportFailureTimeout {
		t.Fatalf("expected timeout kind, got %q", transportErr.Kind)
	}
}

func TestMetaContentURLResolversReturnCanonicalPermalinks(t *testing.T) {
	t.Setenv("META_GRAPH_API_VERSION", "v25.0")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Empty(t, req.URL.Query().Get(oauthParamAccessToken))
		require.Equal(t, "Bearer access-token", req.Header.Get("Authorization"))
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
