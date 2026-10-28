package platform

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// The replies edge returns only top-level replies. A reply to a reply, such
// as a follower answering the account's own reply, is only returned by the
// conversation edge, where replied_to names the reply it answers.
func TestThreadsListCommentsCollectsNestedReplies(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	const (
		topLevel = `{"id": "reply-fan", "text": "Does it support video?", "username": "fan", "timestamp": "2026-09-14T10:00:00+0000", "is_reply_owned_by_me": false, "replied_to": {"id": "root-1"}}`
		ownReply = `{"id": "reply-own", "text": "Yes, up to five minutes.", "username": "openpost", "timestamp": "2026-09-14T10:05:00+0000", "is_reply_owned_by_me": true, "replied_to": {"id": "reply-fan"}}`
		followUp = `{"id": "reply-fan-2", "text": "And carousels?", "username": "fan", "timestamp": "2026-09-14T10:10:00+0000", "is_reply_owned_by_me": false, "replied_to": {"id": "reply-own"}}`
	)
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/v1.0/root-1/replies":
			return jsonResponse(req, `{"data": [`+topLevel+`]}`), nil
		case "/v1.0/root-1/conversation":
			return jsonResponse(req, `{"data": [`+followUp+`, `+ownReply+`, `+topLevel+`]}`), nil
		}
		return jsonResponseWithStatus(req, http.StatusNotFound, `{"error": {"message": "unexpected path"}}`), nil
	})}

	comments, err := NewThreadsAdapter("", "", "").ListComments(context.Background(), "threads-token", "user-1", "root-1")

	require.NoError(t, err)
	byID := map[string]Comment{}
	for _, comment := range comments {
		byID[comment.ID] = comment
	}
	require.Len(t, byID, 3)
	require.Equal(t, "root-1", byID["reply-fan"].ParentID, "a top-level reply answers the post")
	require.Equal(t, "reply-own", byID["reply-fan-2"].ParentID, "the follow-up must be threaded under the reply it answers")
	require.False(t, byID["reply-fan-2"].IsOurs)
	require.True(t, byID["reply-own"].IsOurs)
}

// Threads returns a reply's own media in media_url, separate from the post the
// reply answers. Without the field an image or video reply reads as text only.
func TestThreadsListCommentsKeepsReplyMedia(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Contains(t, strings.Split(req.URL.Query().Get("fields"), ","), "media_url")
		return jsonResponse(req, `{"data":[{"id":"reply-media","text":"","username":"fan","timestamp":"2026-09-14T10:00:00+0000","is_reply_owned_by_me":false,"replied_to":{"id":"root-1"},"media_url":"https://cdn.example/reply.mp4","media_type":"VIDEO","thumbnail_url":"https://cdn.example/reply.jpg"}]}`), nil
	})}

	comments, err := NewThreadsAdapter("", "", "").ListComments(context.Background(), "threads-token", "user-1", "root-1")

	require.NoError(t, err)
	require.Len(t, comments, 1)
	require.Equal(t, []CommentAttachment{{
		Type: "video", URL: "https://cdn.example/reply.mp4", Thumbnail: "https://cdn.example/reply.jpg",
	}}, comments[0].Attachments)
}

// A voice reply is audio, not an image.
func TestThreadsListCommentsMapsAudioReplies(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return jsonResponse(req, `{"data":[{"id":"reply-audio","text":"","username":"fan","timestamp":"2026-09-14T10:00:00+0000","replied_to":{"id":"root-1"},"media_url":"https://cdn.example/reply.m4a","media_type":"AUDIO"}]}`), nil
	})}

	comments, err := NewThreadsAdapter("", "", "").ListComments(context.Background(), "threads-token", "user-1", "root-1")

	require.NoError(t, err)
	require.Equal(t, []CommentAttachment{{Type: "audio", URL: "https://cdn.example/reply.m4a"}}, comments[0].Attachments)
}
