package platform

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// GET /{ig-media-id}/comments returns only top-level comments. Replies are
// omitted unless the replies field is expanded. A follower answering the
// account's own reply never reaches the inbox without that expansion, and
// ParentID must be the comment the reply answers.
func TestInstagramListCommentsCollectsNestedReplies(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.True(t, strings.HasSuffix(req.URL.Path, "/media-1/comments"), req.URL.Path)
		if !strings.Contains(req.URL.Query().Get("fields"), "replies") {
			return jsonResponse(req, `{
				"data": [
					{"id":"c1","text":"Does it support video?","timestamp":"2026-09-14T10:00:00+0000","username":"fan"}
				]
			}`), nil
		}
		return jsonResponse(req, `{
			"data": [{
				"id": "c1",
				"text": "Does it support video?",
				"timestamp": "2026-09-14T10:00:00+0000",
				"username": "fan",
				"replies": {
					"data": [
						{"id":"c2","text":"Yes, up to five minutes.","timestamp":"2026-09-14T10:05:00+0000","username":"openpost","parent_id":"c1"},
						{"id":"c3","text":"And carousels?","timestamp":"2026-09-14T10:10:00+0000","username":"fan","parent_id":"c1"}
					]
				}
			}]
		}`), nil
	})}

	comments, err := NewInstagramAdapter("", "", "").ListComments(context.Background(), "ig-token", "ig-1", "media-1")

	require.NoError(t, err)
	byID := map[string]Comment{}
	for _, comment := range comments {
		byID[comment.ID] = comment
	}
	require.Len(t, byID, 3)
	require.Empty(t, byID["c1"].ParentID, "a top-level comment answers the media")
	require.Equal(t, "c1", byID["c2"].ParentID, "the account reply must be threaded under the comment it answers")
	require.Equal(t, "c1", byID["c3"].ParentID, "Instagram attaches a follow-up to the top-level comment")
	require.Equal(t, "openpost", byID["c2"].AuthorName)
	require.Equal(t, "fan", byID["c3"].AuthorName)
}

// A professional account's own comments come back on the comments edge
// next to visitors' comments. Graph's from.id is the IG User id, the same
// id ListComments already receives as accountID. Those comments must be
// reported as ours instead of as incoming engagement.
func TestInstagramListCommentsMarksOwnCommentsAsOurs(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.True(t, strings.HasSuffix(req.URL.Path, "/media-1/comments"), req.URL.Path)
		require.Contains(t, req.URL.Query().Get("fields"), "from", "Graph must return the comment author id")
		return jsonResponse(req, `{
			"data": [
				{
					"id": "c1",
					"text": "Nice launch",
					"timestamp": "2026-09-14T10:00:00+0000",
					"username": "fan",
					"from": {"id": "fan-1", "username": "fan"},
					"replies": {
						"data": [
							{"id": "c3", "text": "Thanks!", "timestamp": "2026-09-14T10:10:00+0000", "username": "openpost", "parent_id": "c1", "from": {"id": "ig-1", "username": "openpost"}}
						]
					}
				},
				{"id": "c2", "text": "Read the full changelog.", "timestamp": "2026-09-14T10:00:05+0000", "username": "openpost", "from": {"id": "ig-1", "username": "openpost"}}
			]
		}`), nil
	})}

	adapter := NewInstagramAdapter("", "", "")
	comments, err := adapter.ListComments(context.Background(), "ig-token", "ig-1", "media-1")

	require.NoError(t, err)
	byID := map[string]Comment{}
	for _, comment := range comments {
		byID[comment.ID] = comment
	}
	require.Len(t, byID, 3)
	require.False(t, byID["c1"].IsOurs, "a visitor's comment is incoming engagement")
	require.True(t, byID["c2"].IsOurs, "the account's own comment is not incoming engagement")
	require.True(t, byID["c3"].IsOurs, "the account's own reply is not incoming engagement")
	require.Equal(t, "ig-1", byID["c2"].AuthorID)
	require.Equal(t, "fan-1", byID["c1"].AuthorID)
}
