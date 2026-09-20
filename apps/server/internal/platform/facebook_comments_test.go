package platform

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// A first comment is published by the Page itself on its own post, so the
// Page's comments must be reported as ours instead of as incoming engagement.
func TestFacebookListCommentsMarksPageCommentsAsOurs(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.True(t, strings.HasSuffix(req.URL.Path, "/page-1_post-1/comments"), req.URL.Path)
		return jsonResponse(req, `{
			"data": [
				{"id": "post-1_c1", "message": "Nice launch", "created_time": "2026-09-14T10:00:00+0000", "can_comment": true, "can_hide": true, "from": {"id": "fan-1", "name": "Fan"}},
				{"id": "post-1_c2", "message": "Read the full changelog.", "created_time": "2026-09-14T10:00:05+0000", "can_comment": true, "from": {"id": "page-1", "name": "OpenPost Page"}}
			]
		}`), nil
	})}

	adapter := NewFacebookAdapter("", "", "")
	comments, err := adapter.ListComments(context.Background(), "page-token", "page-1", "page-1_post-1")

	require.NoError(t, err)
	require.Len(t, comments, 2)
	require.False(t, comments[0].IsOurs, "a visitor's comment is incoming engagement")
	require.True(t, comments[1].IsOurs, "the Page's own comment is not incoming engagement")
}

// The comments edge returns one page at a time and, unless asked otherwise,
// lists top-level comments oldest first. A post with more comments than fit
// on a page must still bring its newest comments into the inbox.
func TestFacebookListCommentsReadsNewestCommentsFirst(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	const commentCount, pageSize = 30, 25
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.True(t, strings.HasSuffix(req.URL.Path, "/page-1_post-1/comments"), req.URL.Path)
		ids := make([]int, 0, commentCount)
		for id := 1; id <= commentCount; id++ {
			ids = append(ids, id)
		}
		if req.URL.Query().Get("order") == "reverse_chronological" {
			slices.Reverse(ids)
		}
		data := make([]string, 0, pageSize)
		for _, id := range ids[:pageSize] {
			data = append(data, fmt.Sprintf(`{"id":"post-1_c%d","message":"Comment %d","created_time":"2026-09-14T10:%02d:00+0000","from":{"id":"fan-%d","name":"Fan"}}`, id, id, id, id))
		}
		return jsonResponse(req, `{"data":[`+strings.Join(data, ",")+`],"paging":{"cursors":{"after":"next-page"},"next":"https://graph.facebook.com/next-page"}}`), nil
	})}

	comments, err := NewFacebookAdapter("", "", "").ListComments(context.Background(), "page-token", "page-1", "page-1_post-1")

	require.NoError(t, err)
	require.Len(t, comments, pageSize)
	ids := make([]string, 0, len(comments))
	for _, comment := range comments {
		ids = append(ids, comment.ID)
	}
	require.Contains(t, ids, "post-1_c30", "the newest comment must be collected")
}

// GET /{object-id}/comments defaults to filter=toplevel, so replies to a
// comment are omitted unless the comments field is expanded. Graph only
// returns a reply-to-a-reply when that expansion is nested; a single
// comments substring is not enough. ParentID must be the comment the
// reply answers.
func TestFacebookListCommentsCollectsNestedReplies(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.True(t, strings.HasSuffix(req.URL.Path, "/page-1_post-1/comments"), req.URL.Path)
		require.Equal(t, "reverse_chronological", req.URL.Query().Get("order"))
		fields := req.URL.Query().Get("fields")
		nestedComments := strings.Count(fields, "comments.order(reverse_chronological){") + strings.Count(fields, "comments{")
		if nestedComments < 2 {
			return jsonResponse(req, `{
				"data": [
					{"id":"post-1_c1","message":"Does it support video?","created_time":"2026-09-14T10:00:00+0000","can_comment":true,"from":{"id":"fan-1","name":"Fan"}}
				]
			}`), nil
		}
		return jsonResponse(req, `{
			"data": [{
				"id": "post-1_c1",
				"message": "Does it support video?",
				"created_time": "2026-09-14T10:00:00+0000",
				"can_comment": true,
				"from": {"id": "fan-1", "name": "Fan"},
				"comments": {
					"data": [{
						"id": "post-1_c2",
						"message": "Yes, up to five minutes.",
						"created_time": "2026-09-14T10:05:00+0000",
						"can_comment": true,
						"from": {"id": "page-1", "name": "OpenPost Page"},
						"parent": {"id": "post-1_c1"},
						"comments": {
							"data": [{
								"id": "post-1_c3",
								"message": "And carousels?",
								"created_time": "2026-09-14T10:10:00+0000",
								"can_comment": true,
								"from": {"id": "fan-1", "name": "Fan"},
								"parent": {"id": "post-1_c2"}
							}]
						}
					}]
				}
			}]
		}`), nil
	})}

	comments, err := NewFacebookAdapter("", "", "").ListComments(context.Background(), "page-token", "page-1", "page-1_post-1")

	require.NoError(t, err)
	byID := map[string]Comment{}
	for _, comment := range comments {
		byID[comment.ID] = comment
	}
	require.Len(t, byID, 3)
	require.Empty(t, byID["post-1_c1"].ParentID, "a top-level comment answers the post")
	require.Equal(t, "post-1_c1", byID["post-1_c2"].ParentID, "the Page reply must be threaded under the comment it answers")
	require.Equal(t, "post-1_c2", byID["post-1_c3"].ParentID, "the follow-up must be threaded under the reply it answers")
	require.False(t, byID["post-1_c1"].IsOurs)
	require.True(t, byID["post-1_c2"].IsOurs)
	require.False(t, byID["post-1_c3"].IsOurs)
}
