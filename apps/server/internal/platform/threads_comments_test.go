package platform

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

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
