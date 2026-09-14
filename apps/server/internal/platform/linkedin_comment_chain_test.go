package platform

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// A "LinkedIn root plus comments" publication publishes every segment after
// the first as a reply to the previous segment's external ID. The second
// comment is therefore published against the first comment's ID, which must be
// a comment URN that LinkedIn accepts as a nested-comment target.
func TestLinkedInPublishChainsCommentsUnderThePreviousComment(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	const (
		postURN         = "urn:li:share:100"
		firstCommentURN = "urn:li:comment:(urn:li:activity:900,200)"
	)
	var payloads []map[string]any
	var paths []string
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, http.MethodPost, req.Method)
		body, err := io.ReadAll(req.Body)
		require.NoError(t, err)
		var payload map[string]any
		require.NoError(t, json.Unmarshal(body, &payload))
		payloads = append(payloads, payload)
		paths = append(paths, req.URL.Path)
		if len(payloads) == 1 {
			return jsonResponse(req, `{"id":"200","commentUrn":"`+firstCommentURN+`","object":"urn:li:activity:900"}`), nil
		}
		return jsonResponse(req, `{"id":"300","commentUrn":"urn:li:comment:(urn:li:activity:900,300)","object":"urn:li:activity:900"}`), nil
	})}

	adapter := NewLinkedInAdapter("", "", "", false)
	first, err := adapter.Publish(t.Context(), "li-token", "urn:li:organization:1", &PublishRequest{Content: "Details in the thread", ReplyToID: postURN})
	require.NoError(t, err)
	require.Equal(t, firstCommentURN, first.ExternalID, "a published comment must be addressable as a comment URN")

	_, err = adapter.Publish(t.Context(), "li-token", "urn:li:organization:1", &PublishRequest{Content: "And one more thing", ReplyToID: first.ExternalID})
	require.NoError(t, err)

	require.Len(t, payloads, 2)
	require.Equal(t, "/rest/socialActions/"+postURN+"/comments", paths[0])
	require.Equal(t, postURN, payloads[0]["object"])
	require.NotContains(t, payloads[0], "parentComment")

	require.Equal(t, "/rest/socialActions/"+firstCommentURN+"/comments", paths[1])
	require.Equal(t, "urn:li:activity:900", payloads[1]["object"])
	require.Equal(t, firstCommentURN, payloads[1]["parentComment"])
}

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
