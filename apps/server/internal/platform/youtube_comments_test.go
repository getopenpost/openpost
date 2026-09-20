package platform

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// Engagement sync treats 401 and 403 provider errors as "reconnect this
// account", so YouTube's non-authorization 403 reasons must not surface as 403.
func TestYouTubeListCommentsClassifiesForbiddenReasons(t *testing.T) {
	tests := []struct {
		name       string
		reason     string
		wantStatus int
	}{
		{name: "comments disabled on the video", reason: "commentsDisabled", wantStatus: http.StatusNotFound},
		{name: "daily quota exhausted", reason: "quotaExceeded", wantStatus: http.StatusTooManyRequests},
		{name: "missing permission still asks for reconnect", reason: "insufficientPermissions", wantStatus: http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			originalClient := httpClient
			defer func() { httpClient = originalClient }()

			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				require.Equal(t, "/youtube/v3/commentThreads", req.URL.Path)
				return jsonResponseWithStatus(req, http.StatusForbidden, `{"error":{"code":403,"message":"forbidden","errors":[{"domain":"youtube.commentThread","reason":"`+tt.reason+`"}]}}`), nil
			})}

			_, err := (&YouTubeAdapter{}).ListComments(context.Background(), "token", "channel-1", "video-1")

			var providerErr *HTTPError
			require.True(t, errors.As(err, &providerErr), "expected a provider HTTP error, got %v", err)
			require.Equal(t, tt.wantStatus, providerErr.StatusCode)
			if tt.wantStatus != http.StatusForbidden {
				require.Equal(t, tt.reason, providerErr.Code)
			}
		})
	}
}

func youtubeCommentJSON(id, parentID, author, text, publishedAt string) string {
	parent := ""
	if parentID != "" {
		parent = `"parentId":"` + parentID + `",`
	}
	return `{"id":"` + id + `","snippet":{"authorDisplayName":"` + author + `","authorChannelId":{"value":"` + author + `"},"textDisplay":"` + text + `","publishedAt":"` + publishedAt + `",` + parent + `"moderationStatus":"published"}}`
}

// commentThreads.list includes only a subset of replies. Unless
// replies.comments length equals snippet.totalReplyCount, later replies must
// be read from comments.list with parentId.
func TestYouTubeListCommentsCollectsEveryThreadReply(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	top := youtubeCommentJSON("thread-1", "", "fan", "Does it support 4K?", "2026-09-14T10:00:00Z")
	embedded := make([]string, 0, 5)
	all := make([]string, 0, 7)
	for i := 1; i <= 7; i++ {
		n := strconv.Itoa(i)
		reply := youtubeCommentJSON("reply-"+n, "thread-1", "viewer", "Reply "+n, "2026-09-14T10:0"+n+":00Z")
		all = append(all, reply)
		if i <= 5 {
			embedded = append(embedded, reply)
		}
	}
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case strings.HasSuffix(req.URL.Path, "/commentThreads"):
			return jsonResponse(req, `{"items":[{"id":"thread-1","snippet":{"topLevelComment":`+top+`,"totalReplyCount":7},"replies":{"comments":[`+strings.Join(embedded, ",")+`]}}]}`), nil
		case strings.HasSuffix(req.URL.Path, "/comments"):
			require.Equal(t, "thread-1", req.URL.Query().Get("parentId"))
			return jsonResponse(req, `{"items":[`+strings.Join(all, ",")+`]}`), nil
		}
		return jsonResponseWithStatus(req, http.StatusNotFound, `{"error":{"message":"unexpected path"}}`), nil
	})}

	comments, err := (&YouTubeAdapter{}).ListComments(context.Background(), "token", "channel-1", "video-1")

	require.NoError(t, err)
	byID := map[string]Comment{}
	for _, comment := range comments {
		byID[comment.ID] = comment
	}
	require.Len(t, byID, 8, "the top-level comment and every reply must be collected")
	require.Equal(t, "thread-1", byID["reply-7"].ParentID)
	require.Equal(t, "Reply 7", byID["reply-7"].Text)
}

// comments.list maxResults is 100. A thread with more replies returns
// nextPageToken; later pages must be read with pageToken.
func TestYouTubeListCommentsFollowsCommentReplyPages(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	top := youtubeCommentJSON("thread-1", "", "fan", "Does it support 4K?", "2026-09-14T10:00:00Z")
	page1 := []string{
		youtubeCommentJSON("reply-1", "thread-1", "viewer", "Reply 1", "2026-09-14T10:01:00Z"),
		youtubeCommentJSON("reply-2", "thread-1", "viewer", "Reply 2", "2026-09-14T10:02:00Z"),
	}
	page2 := []string{
		youtubeCommentJSON("reply-3", "thread-1", "viewer", "Reply 3", "2026-09-14T10:03:00Z"),
	}
	var commentListCalls int
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case strings.HasSuffix(req.URL.Path, "/commentThreads"):
			return jsonResponse(req, `{"items":[{"id":"thread-1","snippet":{"topLevelComment":`+top+`,"totalReplyCount":3},"replies":{"comments":[`+page1[0]+`]}}]}`), nil
		case strings.HasSuffix(req.URL.Path, "/comments"):
			require.Equal(t, "thread-1", req.URL.Query().Get("parentId"))
			require.Equal(t, "100", req.URL.Query().Get("maxResults"))
			commentListCalls++
			switch req.URL.Query().Get("pageToken") {
			case "":
				return jsonResponse(req, `{"nextPageToken":"replies-page-2","items":[`+strings.Join(page1, ",")+`]}`), nil
			case "replies-page-2":
				return jsonResponse(req, `{"items":[`+strings.Join(page2, ",")+`]}`), nil
			default:
				return jsonResponseWithStatus(req, http.StatusNotFound, `{"error":{"message":"unexpected pageToken"}}`), nil
			}
		}
		return jsonResponseWithStatus(req, http.StatusNotFound, `{"error":{"message":"unexpected path"}}`), nil
	})}

	comments, err := (&YouTubeAdapter{}).ListComments(context.Background(), "token", "channel-1", "video-1")

	require.NoError(t, err)
	require.Equal(t, 2, commentListCalls)
	byID := map[string]Comment{}
	for _, comment := range comments {
		byID[comment.ID] = comment
	}
	require.Len(t, byID, 4, "the top-level comment and every paged reply must be collected")
	require.Equal(t, "thread-1", byID["reply-3"].ParentID)
	require.Equal(t, "Reply 3", byID["reply-3"].Text)
}
