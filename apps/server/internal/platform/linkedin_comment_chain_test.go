package platform

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// Engagement replies go through ReplyToComment instead of postComment, but
// the stored reply ID must use the same comment URN order: LinkedIn only
// accepts a comment URN for nested targets and comment management.
func TestLinkedInReplyToCommentReturnsCommentURN(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	const (
		parentCommentURN = "urn:li:comment:(urn:li:activity:900,200)"
		replyCommentURN  = "urn:li:comment:(urn:li:activity:900,300)"
	)
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, http.MethodPost, req.Method)
		require.Equal(t, "/rest/socialActions/"+parentCommentURN+"/comments", req.URL.Path)
		return jsonResponse(req, `{"id":"300","commentUrn":"`+replyCommentURN+`","object":"urn:li:activity:900"}`), nil
	})}

	adapter := NewLinkedInAdapter("", "", "", false)
	replyID, err := adapter.ReplyToComment(t.Context(), "li-token", "urn:li:organization:1", parentCommentURN, "Thanks for reading")
	require.NoError(t, err)
	require.Equal(t, replyCommentURN, replyID, "an engagement reply must be addressable as a comment URN")
}
