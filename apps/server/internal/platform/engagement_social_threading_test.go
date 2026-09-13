package platform

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// The engagement inbox nests a comment under the collected comment whose ID
// equals its ParentID, so nested replies must point at their parent's ID.

func TestBlueskyListCommentsLinksNestedRepliesToParentComment(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, "/xrpc/app.bsky.feed.getPostThread", req.URL.Path)
		return jsonResponse(req, `{
			"thread": {
				"post": {"uri": "at://did:plc:founder/app.bsky.feed.post/3root", "cid": "root-cid", "author": {"did": "did:plc:founder"}, "record": {"text": "Launch"}},
				"replies": [{
					"post": {"uri": "at://did:plc:fan/app.bsky.feed.post/3fan", "cid": "fan-cid", "author": {"did": "did:plc:fan"}, "record": {"text": "Congrats", "reply": {"parent": {"uri": "at://did:plc:founder/app.bsky.feed.post/3root"}}}},
					"replies": [{
						"post": {"uri": "at://did:plc:friend/app.bsky.feed.post/3friend", "cid": "friend-cid", "author": {"did": "did:plc:friend"}, "record": {"text": "Agreed", "reply": {"parent": {"uri": "at://did:plc:fan/app.bsky.feed.post/3fan"}}}}
					}]
				}]
			}
		}`), nil
	})}

	adapter := NewBlueskyAdapter("https://pds.example")
	comments, err := adapter.ListComments(context.Background(), "token", "did:plc:founder", `{"uri":"at://did:plc:founder/app.bsky.feed.post/3root","cid":"root-cid"}`)

	require.NoError(t, err)
	require.Len(t, comments, 2)
	require.Equal(t, "Congrats", comments[0].Text)
	require.Equal(t, "Agreed", comments[1].Text)
	require.Equal(t, comments[0].ID, comments[1].ParentID)
	require.NotEqual(t, comments[0].ID, comments[0].ParentID)
}

func TestMastodonListCommentsLinksNestedRepliesToParentComment(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, "/api/v1/statuses/100/context", req.URL.Path)
		return jsonResponse(req, `{
			"ancestors": [],
			"descendants": [
				{"id": "201", "in_reply_to_id": "100", "content": "<p>Congrats</p>", "account": {"id": "fan"}},
				{"id": "202", "in_reply_to_id": "201", "content": "<p>Agreed</p>", "account": {"id": "friend"}}
			]
		}`), nil
	})}

	adapter := NewMastodonAdapter("client", "secret", "https://app.example/callback", "https://mastodon.example")
	comments, err := adapter.ListComments(context.Background(), "token", "founder", "100")

	require.NoError(t, err)
	require.Len(t, comments, 2)
	require.Equal(t, "100", comments[0].ParentID)
	require.Equal(t, comments[0].ID, comments[1].ParentID)
}
