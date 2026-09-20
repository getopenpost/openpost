package platform

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// GET /socialActions/{shareUrn}/comments returns top-level comments only.
// Nested replies live on GET /socialActions/{commentUrn}/comments. A follower
// answering the organization's own comment never reaches the inbox unless
// that second edge is read, and ParentID must be the comment the reply answers.
func TestLinkedInListCommentsCollectsNestedReplies(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	const (
		postURN         = "urn:li:share:100"
		firstCommentURN = "urn:li:comment:(urn:li:activity:900,200)"
		replyCommentURN = "urn:li:comment:(urn:li:activity:900,300)"
	)
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, http.MethodGet, req.Method)
		require.True(t, strings.HasSuffix(req.URL.Path, "/comments"), req.URL.Path)
		path := req.URL.EscapedPath()
		if strings.Contains(path, "urn:li:comment:") || strings.Contains(path, "urn%3Ali%3Acomment") {
			return jsonResponse(req, `{
				"elements": [{
					"id": "300",
					"commentUrn": "`+replyCommentURN+`",
					"actor": "urn:li:person:fan",
					"parentComment": "`+firstCommentURN+`",
					"created": {"time": 1694700600000},
					"message": {"text": "And carousels?"}
				}]
			}`), nil
		}
		return jsonResponse(req, `{
			"elements": [{
				"id": "200",
				"commentUrn": "`+firstCommentURN+`",
				"actor": "urn:li:organization:1",
				"created": {"time": 1694700000000},
				"message": {"text": "Does it support video?"},
				"commentsSummary": {"totalFirstLevelComments": 1, "aggregatedTotalComments": 1}
			}]
		}`), nil
	})}

	comments, err := NewLinkedInAdapter("", "", "", false).ListComments(context.Background(), "li-token", "urn:li:organization:1", postURN)

	require.NoError(t, err)
	byID := map[string]Comment{}
	for _, comment := range comments {
		byID[comment.ID] = comment
	}
	require.Len(t, byID, 2)
	require.Empty(t, byID[firstCommentURN].ParentID, "a top-level comment answers the post")
	require.Equal(t, firstCommentURN, byID[replyCommentURN].ParentID, "the follow-up must be threaded under the comment it answers")
	require.True(t, byID[firstCommentURN].IsOurs)
	require.False(t, byID[replyCommentURN].IsOurs)
	require.Equal(t, "And carousels?", byID[replyCommentURN].Text)
}
