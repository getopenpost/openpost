package platform

import (
	"context"
	"net/http"
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
