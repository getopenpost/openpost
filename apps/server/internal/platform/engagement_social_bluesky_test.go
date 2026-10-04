package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBlueskyListCommentsSkipsUnavailableReplies(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	pdsURL := "https://pds.example"
	rootURI := "at://did:plc:founder/app.bsky.feed.post/3root"
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, "/xrpc/app.bsky.feed.getPostThread", req.URL.Path)
		require.Equal(t, rootURI, req.URL.Query().Get("uri"))
		return jsonResponse(req, `{
			"thread": {
				"$type": "app.bsky.feed.defs#threadViewPost",
				"post": {"uri": "at://did:plc:founder/app.bsky.feed.post/3root", "cid": "root-cid", "author": {"did": "did:plc:founder"}, "record": {"text": "Launch"}},
				"replies": [
					{
						"$type": "app.bsky.feed.defs#threadViewPost",
						"post": {"uri": "at://did:plc:fan/app.bsky.feed.post/3fan", "cid": "fan-cid", "author": {"did": "did:plc:fan", "handle": "fan.example"}, "record": {"text": "Congrats", "reply": {"parent": {"uri": "at://did:plc:founder/app.bsky.feed.post/3root"}}}},
						"replies": [
							{"$type": "app.bsky.feed.defs#notFoundPost", "uri": "at://did:plc:gone/app.bsky.feed.post/3gone", "notFound": true}
						]
					},
					{"$type": "app.bsky.feed.defs#blockedPost", "uri": "at://did:plc:blocked/app.bsky.feed.post/3blocked", "blocked": true, "author": {"did": "did:plc:blocked", "viewer": {"blockedBy": true}}},
					{"$type": "app.bsky.feed.defs#notFoundPost", "uri": "at://did:plc:deleted/app.bsky.feed.post/3deleted", "notFound": true}
				]
			}
		}`), nil
	})}

	adapter := NewBlueskyAdapter(pdsURL)
	comments, err := adapter.ListComments(context.Background(), "token", "did:plc:founder", `{"uri":"at://did:plc:founder/app.bsky.feed.post/3root","cid":"root-cid"}`)

	require.NoError(t, err)
	require.Len(t, comments, 1, "blocked and not-found thread entries have no post to show or reply to")
	var reference struct {
		URI string `json:"uri"`
		CID string `json:"cid"`
	}
	require.NoError(t, json.Unmarshal([]byte(comments[0].ID), &reference))
	require.Equal(t, "at://did:plc:fan/app.bsky.feed.post/3fan", reference.URI)
	require.Equal(t, "fan-cid", reference.CID)
	require.Equal(t, "did:plc:fan", comments[0].AuthorID)
	require.Equal(t, "Congrats", comments[0].Text)
}

func TestBlueskyListCommentsReportsUnavailableRoot(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"missing error", http.StatusBadRequest, `{"error":"NotFound","message":"Post not found"}`},
		{"missing node", http.StatusOK, `{"thread":{"$type":"app.bsky.feed.defs#notFoundPost","uri":"at://did:plc:founder/app.bsky.feed.post/3root","notFound":true}}`},
		{"blocked node", http.StatusOK, `{"thread":{"$type":"app.bsky.feed.defs#blockedPost","uri":"at://did:plc:founder/app.bsky.feed.post/3root","blocked":true}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			originalClient := httpClient
			t.Cleanup(func() { httpClient = originalClient })
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				response := jsonResponse(req, tc.body)
				response.StatusCode = tc.status
				return response, nil
			})}
			comments, err := NewBlueskyAdapter("https://pds.example").ListComments(t.Context(), "token", "did:plc:founder", `{"uri":"at://did:plc:founder/app.bsky.feed.post/3root","cid":"root-cid"}`)
			require.Error(t, err)
			require.Empty(t, comments)
			var providerErr *HTTPError
			require.ErrorAs(t, err, &providerErr)
			require.Equal(t, http.StatusNotFound, providerErr.StatusCode, "unavailable roots must not be retried as hourly generic failures or reported as successful empty reads")
		})
	}
}
