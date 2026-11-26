package platform

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// A link attachment has no image. Its own URL is the stable target.
func TestFacebookListCommentsKeepsLinkAttachments(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return jsonResponse(req, `{"data":[{"id":"comment-1","message":"Read this","created_time":"2026-09-14T10:00:00+0000","from":{"id":"fan","name":"Fan"},"attachment":{"type":"share","url":"https://example.com/article"}}]}`), nil
	})}

	comments, err := NewFacebookAdapter("", "", "").ListComments(context.Background(), "page-token", "page-1", "page-1_post-1")

	require.NoError(t, err)
	require.Equal(t, []CommentAttachment{{Type: "link", URL: "https://example.com/article"}}, comments[0].Attachments)
}
