package platform

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// Threads threads are published as replies to the root post, so the account's
// own follow-up posts come back from the replies edge and must be reported as
// ours instead of as incoming engagement.
func TestThreadsListCommentsMarksOwnRepliesAsOurs(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, "/v1.0/root-1/replies", req.URL.Path)
		require.Contains(t, strings.Split(req.URL.Query().Get("fields"), ","), "is_reply_owned_by_me")
		return jsonResponse(req, `{
			"data": [
				{"id": "reply-fan", "text": "Nice launch", "username": "fan", "timestamp": "2026-09-14T10:00:00+0000", "hide_status": "NOT_HUSHED", "is_reply_owned_by_me": false},
				{"id": "reply-own", "text": "2/ More details", "username": "openpost", "timestamp": "2026-09-14T10:00:05+0000", "hide_status": "NOT_HUSHED", "is_reply_owned_by_me": true}
			]
		}`), nil
	})}

	adapter := NewThreadsAdapter("", "", "")
	comments, err := adapter.ListComments(context.Background(), "threads-token", "user-1", "root-1")

	require.NoError(t, err)
	require.Len(t, comments, 2)
	require.False(t, comments[0].IsOurs, "another user's reply is incoming engagement")
	require.True(t, comments[1].IsOurs, "the account's own thread reply is not incoming engagement")
}
