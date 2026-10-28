package platform

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/openpost/backend/internal/posttext"
	"github.com/stretchr/testify/require"
)

func TestSelectedBlueskyMentionPublishesStableDIDWithoutResolvingItsLabel(t *testing.T) {
	original := httpClient
	t.Cleanup(func() { httpClient = original })
	requests := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests++
		require.Equal(t, "/xrpc/com.atproto.repo.createRecord", req.URL.Path, "selected identities require no mutable-handle lookup")
		require.Equal(t, "Bearer secret", req.Header.Get("Authorization"))
		var payload struct {
			Record struct {
				Text   string                   `json:"text"`
				Facets []map[string]interface{} `json:"facets"`
			} `json:"record"`
		}
		require.NoError(t, json.NewDecoder(req.Body).Decode(&payload))
		require.Equal(t, "🚀 @old.handle and @unselected.example", payload.Record.Text)
		require.Len(t, payload.Record.Facets, 1)
		facet := payload.Record.Facets[0]
		require.Equal(t, float64(5), facet["index"].(map[string]interface{})["byteStart"])
		require.Equal(t, float64(16), facet["index"].(map[string]interface{})["byteEnd"])
		require.Equal(t, "did:plc:ewvi7nxzyoun6zhxrhs64oiz", facet["features"].([]interface{})[0].(map[string]interface{})["did"])
		return jsonResponse(req, `{"uri":"at://did:plc:author/app.bsky.feed.post/123","cid":"bafypost"}`), nil
	})}
	projection := &posttext.Projection{Mentions: posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{{Start: 5, End: 16, Text: "@old.handle", Target: posttext.MentionTarget{Provider: "bluesky", Kind: "person", ID: "did:plc:ewvi7nxzyoun6zhxrhs64oiz", Handle: "new.handle"}}}}}
	result, err := NewBlueskyAdapter("").Publish(t.Context(), "secret", "did:plc:author", &PublishRequest{Content: "🚀 @old.handle and @unselected.example", Settings: map[string]any{posttext.NativeSettingsKey: projection, "mention_dids": "old.handle=did:plc:wrong"}})
	require.NoError(t, err)
	require.Equal(t, 1, requests)
	require.NotEmpty(t, result.ExternalID)
}

func TestLinkedInSelectedPageMentionsEscapeLabelsAndSurroundingMarkup(t *testing.T) {
	text := `Hi Acme [R&D] #Launch @[Fake](urn:li:person:42)`
	projection := &posttext.Projection{Mentions: posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{{Start: 3, End: 13, Text: "Acme [R&D]", Target: posttext.MentionTarget{Provider: "linkedin", Kind: "page", ID: "urn:li:organization:123"}}}}}
	payload := captureLinkedInCreatePostPayload(t, &PublishRequest{Content: text, Settings: map[string]any{posttext.NativeSettingsKey: projection}})
	require.Equal(t, `Hi @[Acme \[R&D\]](urn:li:organization:123) {hashtag|\#|Launch} \@\[Fake\]\(urn:li:person:42\)`, payload["commentary"])
	adjacentProjection := &posttext.Projection{Mentions: posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{{Start: 3, End: 7, Text: "Acme", Target: projection.Spans[0].Target}}}}
	adjacent := captureLinkedInCreatePostPayload(t, &PublishRequest{Content: "Hi Acme#Launch", Settings: map[string]any{posttext.NativeSettingsKey: adjacentProjection}})
	require.Equal(t, `Hi @[Acme](urn:li:organization:123)\#Launch`, adjacent["commentary"], "mention boundaries must not turn an adjacent hash into a hashtag")
}

func TestMastodonChangedAddressRejectsBeforeProviderWrite(t *testing.T) {
	original := httpClient
	t.Cleanup(func() { httpClient = original })
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, http.MethodGet, req.Method)
		require.Equal(t, "/api/v1/accounts/42", req.URL.Path)
		return jsonResponse(req, `{"id":"42","acct":"new@example.org"}`), nil
	})}
	projection := &posttext.Projection{Mentions: posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{{Start: 0, End: 16, Text: "@old@example.org", Target: posttext.MentionTarget{Provider: "mastodon", Kind: "person", ID: "42", Authority: "https://social.example", Handle: "old@example.org"}}}}}
	_, err := NewMastodonAdapter("", "", "", "https://social.example").Publish(t.Context(), "token", "author", &PublishRequest{Content: "@old@example.org", Settings: map[string]any{posttext.NativeSettingsKey: projection}})
	require.ErrorContains(t, err, "selected mention changed")
}

func TestMastodonRepeatedIdentityVerifiesEverySelectedAddress(t *testing.T) {
	original := httpClient
	t.Cleanup(func() { httpClient = original })
	writes := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method == http.MethodGet {
			return jsonResponse(req, `{"id":"42","acct":"old@example.org"}`), nil
		}
		writes++
		return jsonResponse(req, `{"id":"posted"}`), nil
	})}
	body := "@old@example.org @new@example.org"
	target := posttext.MentionTarget{Provider: "mastodon", Kind: "person", ID: "42", Authority: "https://social.example", Handle: "old@example.org"}
	other := target
	other.Handle = "new@example.org"
	projection := &posttext.Projection{Mentions: posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{{Start: 0, End: 16, Text: "@old@example.org", Target: target}, {Start: 17, End: 33, Text: "@new@example.org", Target: other}}}}
	_, err := NewMastodonAdapter("", "", "", "https://social.example").Publish(t.Context(), "token", "author", &PublishRequest{Content: body, Settings: map[string]any{posttext.NativeSettingsKey: projection}})
	require.ErrorContains(t, err, "selected mention changed")
	require.Zero(t, writes)
}
