package platform

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestBlueskyGetProfileLoadsActorAvatar(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/xrpc/com.atproto.server.getSession":
			return jsonResponse(req, `{"did":"did:plc:creator","handle":"creator.bsky.social"}`), nil
		case "/xrpc/app.bsky.actor.getProfile":
			if req.URL.Query().Get("actor") != "did:plc:creator" {
				t.Fatalf("unexpected actor query %q", req.URL.RawQuery)
			}
			return jsonResponse(req, `{"did":"did:plc:creator","handle":"creator.bsky.social","displayName":"Creator","avatar":"https://cdn.bsky.app/avatar.jpg"}`), nil
		default:
			t.Fatalf("unexpected request %s", req.URL.String())
			return nil, nil
		}
	})}

	profile, err := NewBlueskyAdapter("https://bsky.example").GetProfile(context.Background(), "access-token")
	require.NoError(t, err)
	require.Equal(t, "did:plc:creator", profile.ID)
	require.Equal(t, "creator.bsky.social", profile.Username)
	require.Equal(t, "Creator", profile.DisplayName)
	require.Equal(t, "https://cdn.bsky.app/avatar.jpg", profile.AvatarURL)
}

func TestBuildBlueskyPostRecordAddsFacetsExternalCardAndSelfLabels(t *testing.T) {
	adapter := NewBlueskyAdapter("")
	record, err := adapter.buildPostRecord("did:plc:openpost", &PublishRequest{
		Content: "Hello @atproto.com from #OpenPost https://example.com/path",
		Settings: map[string]interface{}{
			"mention_dids":     "atproto.com=did:plc:ewvi7nxzyoun6zhxrhs64oiz",
			"link_url":         "https://example.com/path",
			"link_title":       "Example",
			"link_description": "Example description",
			"self_labels":      "nudity, graphic-media",
		},
	}, fixedBlueskyTime())

	require.NoError(t, err)
	require.Equal(t, "app.bsky.feed.post", record["$type"])
	require.Equal(t, "2026-01-02T03:04:05Z", record["createdAt"])

	facets := record["facets"].([]map[string]interface{})
	require.Len(t, facets, 3)
	requireFacet(t, facets, 6, 18, "app.bsky.richtext.facet#mention", "did", "did:plc:ewvi7nxzyoun6zhxrhs64oiz")
	requireFacet(t, facets, 24, 33, "app.bsky.richtext.facet#tag", "tag", "OpenPost")
	requireFacet(t, facets, 34, 58, "app.bsky.richtext.facet#link", "uri", "https://example.com/path")

	embed := record["embed"].(map[string]interface{})
	require.Equal(t, "app.bsky.embed.external", embed["$type"])
	external := embed["external"].(map[string]interface{})
	require.Equal(t, "https://example.com/path", external["uri"])
	require.Equal(t, "Example", external["title"])
	require.Equal(t, "Example description", external["description"])

	labels := record["labels"].(map[string]interface{})
	require.Equal(t, "com.atproto.label.defs#selfLabels", labels["$type"])
	values := labels["values"].([]map[string]string)
	require.Equal(t, []map[string]string{{"val": "nudity"}, {"val": "graphic-media"}}, values)
}

func TestBuildBlueskyPostRecordAddsQuoteEmbed(t *testing.T) {
	adapter := NewBlueskyAdapter("")
	record, err := adapter.buildPostRecord("did:plc:openpost", &PublishRequest{
		Content: "quoting this",
		Settings: map[string]interface{}{
			"quote_uri": "at://did:plc:example/app.bsky.feed.post/3abc",
			"quote_cid": "bafyreibjifzpqj6o6wcq3hejh7y4z4z2vmiklkvykc57tw3pcbx3kxifpm",
		},
	}, fixedBlueskyTime())

	require.NoError(t, err)
	embed := record["embed"].(map[string]interface{})
	require.Equal(t, "app.bsky.embed.record", embed["$type"])
	ref := embed["record"].(map[string]interface{})
	require.Equal(t, "at://did:plc:example/app.bsky.feed.post/3abc", ref["uri"])
	require.Equal(t, "bafyreibjifzpqj6o6wcq3hejh7y4z4z2vmiklkvykc57tw3pcbx3kxifpm", ref["cid"])
}

func TestBuildBlueskyPostRecordCombinesQuoteWithMedia(t *testing.T) {
	adapter := NewBlueskyAdapter("")
	record, err := adapter.buildPostRecord("did:plc:openpost", &PublishRequest{
		Content:          "quote with image",
		PlatformMediaIDs: []string{`{"$type":"blob","mimeType":"image/jpeg","size":1000}`},
		MediaAltTexts:    []string{"image alt"},
		Settings: map[string]interface{}{
			"quote_uri": "at://did:plc:example/app.bsky.feed.post/3abc",
			"quote_cid": "bafyreibjifzpqj6o6wcq3hejh7y4z4z2vmiklkvykc57tw3pcbx3kxifpm",
		},
	}, fixedBlueskyTime())

	require.NoError(t, err)
	embed := record["embed"].(map[string]interface{})
	require.Equal(t, "app.bsky.embed.recordWithMedia", embed["$type"])
	require.Equal(t, "app.bsky.embed.record", embed["record"].(map[string]interface{})["$type"])
	require.Equal(t, "app.bsky.embed.images", embed["media"].(map[string]interface{})["$type"])
}

func TestBuildBlueskyPostRecordRejectsExternalCardWithMedia(t *testing.T) {
	adapter := NewBlueskyAdapter("")
	_, err := adapter.buildPostRecord("did:plc:openpost", &PublishRequest{
		Content:          "image and card",
		PlatformMediaIDs: []string{`{"$type":"blob","mimeType":"image/jpeg","size":1000}`},
		Settings: map[string]interface{}{
			"link_url": "https://example.com/path",
		},
	}, fixedBlueskyTime())

	require.ErrorContains(t, err, "bluesky external link cards cannot be combined with media")
}

func fixedBlueskyTime() time.Time {
	return time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
}

func requireFacet(t *testing.T, facets []map[string]interface{}, byteStart, byteEnd int, featureType, key, value string) {
	t.Helper()
	for _, facet := range facets {
		index := facet["index"].(map[string]int)
		if index["byteStart"] != byteStart || index["byteEnd"] != byteEnd {
			continue
		}
		features := facet["features"].([]map[string]string)
		require.Len(t, features, 1)
		require.Equal(t, featureType, features[0]["$type"])
		require.Equal(t, value, features[0][key])
		return
	}
	require.Failf(t, "facet not found", "missing facet %d-%d in %#v", byteStart, byteEnd, facets)
}
