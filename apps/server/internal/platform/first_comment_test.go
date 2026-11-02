package platform

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDevNullPostFirstCommentUsesSignedReply(t *testing.T) {
	_, key := devNullTestSigner(t)
	const parent = "01a14c0f-6e52-4b1c-9a1d-2f4b5c6d7e8f"
	const reply = "01a14c0f-6e52-4b1c-9a1d-2f4b5c6d7e90"
	var calls int
	server := newProviderTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		require.Equal(t, "/api/cli/commits", r.URL.Path)
		require.Equal(t, http.MethodPost, r.Method)
		require.NotEmpty(t, r.Header.Get("X-SSH-Signature"))
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		parts := strings.SplitN(string(body), "\n", 4)
		require.Len(t, parts, 4)
		require.Equal(t, parent, parts[2])
		require.Equal(t, "Details about the launch", parts[3])
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, "Committed: https://dev-null.sh/@testuser/commits/"+reply+"\n")
	}))
	t.Cleanup(server.Close)
	adapter := NewDevNullAdapter(server.URL)
	id, err := adapter.PostFirstComment(t.Context(), devNullCredential("testuser", key), "account", parent, "Details about the launch")
	require.NoError(t, err)
	require.Contains(t, id, reply)
	for _, invalid := range []struct{ target, message string }{{"", "Valid reply"}, {parent, " "}, {"invalid", "Valid reply"}} {
		_, err := adapter.PostFirstComment(t.Context(), devNullCredential("testuser", key), "account", invalid.target, invalid.message)
		require.Error(t, err)
	}
	require.Equal(t, 1, calls, "invalid follow-ups must not publish top-level commits")
}

func TestSupportsFirstCommentIsCapabilityGated(t *testing.T) {
	for _, provider := range []string{"linkedin", "facebook", "instagram", "youtube", "devnull"} {
		require.True(t, SupportsFirstComment(provider), "%s must support first comments", provider)
	}
	for _, provider := range []string{"x", "threads", "tiktok", "bluesky"} {
		require.False(t, SupportsFirstComment(provider), "%s must not support first comments", provider)
	}
	require.Empty(t, FirstCommentMessage("x", map[string]interface{}{"first_comment": "hi"}))
	require.Equal(t, "hello", FirstCommentMessage("instagram", map[string]interface{}{"first_comment": "  hello  "}))
	require.Empty(t, FirstCommentMessage("youtube", map[string]interface{}{}))
}

func TestInstagramPostFirstCommentUsesMediaCommentsEdge(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var path, body string
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		path = req.URL.Path
		raw, _ := io.ReadAll(req.Body)
		body = string(raw)
		return jsonResponse(req, `{"id":"comment-1"}`), nil
	})}

	adapter := NewInstagramAdapter("", "", "")
	id, err := adapter.PostFirstComment(context.Background(), "token", "ig-1", "media-1", "First!")
	require.NoError(t, err)
	require.Equal(t, "comment-1", id)
	require.True(t, strings.HasSuffix(path, "/media-1/comments"), "first comment targets media, got %s", path)
	require.Contains(t, body, "First", "form body carries the message, got %s", body)

	_, err = adapter.PostFirstComment(context.Background(), "token", "ig-1", "", "First!")
	require.Error(t, err)
	_, err = adapter.PostFirstComment(context.Background(), "token", "ig-1", "media-1", "   ")
	require.Error(t, err)
}

func TestYouTubePostFirstCommentUsesCommentThreads(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	var path, videoID, text string
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		path = req.URL.Path
		raw, _ := io.ReadAll(req.Body)
		var payload struct {
			Snippet struct {
				VideoID         string `json:"videoId"`
				TopLevelComment struct {
					Snippet struct {
						TextOriginal string `json:"textOriginal"`
					} `json:"snippet"`
				} `json:"topLevelComment"`
			} `json:"snippet"`
		}
		_ = json.Unmarshal(raw, &payload)
		videoID = payload.Snippet.VideoID
		text = payload.Snippet.TopLevelComment.Snippet.TextOriginal
		return jsonResponse(req, `{"id":"thread-1","snippet":{"topLevelComment":{"id":"comment-1"}}}`), nil
	})}

	id, err := (&YouTubeAdapter{}).PostFirstComment(context.Background(), "token", "channel-1", "video-1", "First!")
	require.NoError(t, err)
	require.Equal(t, "comment-1", id)
	require.True(t, strings.HasSuffix(path, "/commentThreads"), "got %s", path)
	require.Equal(t, "video-1", videoID)
	require.Equal(t, "First!", text)
}

func TestFacebookAndLinkedInFirstCommentReuseCommentPath(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if strings.Contains(req.URL.Host, "linkedin") {
			return jsonResponse(req, `{"id":"1","commentUrn":"urn:li:comment:(urn:li:activity:1,2)"}`), nil
		}
		return jsonResponse(req, `{"id":"fb-comment-1"}`), nil
	})}

	fbID, err := (&FacebookAdapter{graphVersion: "v25.0"}).PostFirstComment(context.Background(), "token", "page-1", "post-1", "First!")
	require.NoError(t, err)
	require.Equal(t, "fb-comment-1", fbID)

	liID, err := (&LinkedInAdapter{}).PostFirstComment(context.Background(), "token", "urn:li:person:1", "urn:li:share:1", "First!")
	require.NoError(t, err)
	require.Equal(t, "urn:li:comment:(urn:li:activity:1,2)", liID)
}
