package platform

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

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

func TestExtractBlueskyRKey(t *testing.T) {
	// JSON with URI
	require.Equal(t, "3lb7v4d3t2c2f", extractBlueskyRKey(`{"uri":"at://did:plc:123/app.bsky.feed.repost/3lb7v4d3t2c2f","cid":"bafy123"}`))
	// Raw AT URI
	require.Equal(t, "3lb7v4d3t2c2f", extractBlueskyRKey("at://did:plc:123/app.bsky.feed.repost/3lb7v4d3t2c2f"))
	// Raw RKey
	require.Equal(t, "3lb7v4d3t2c2f", extractBlueskyRKey("3lb7v4d3t2c2f"))
	// Empty
	require.Equal(t, "", extractBlueskyRKey(""))
}

func TestBlueskyUnrepost(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	called := false
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodPost || req.URL.String() != "https://bsky.social/xrpc/com.atproto.repo.deleteRecord" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		if req.Header.Get(headerAuthorization) != "Bearer bsky-token" {
			t.Fatalf("unexpected auth header %q", req.Header.Get(headerAuthorization))
		}
		var payload map[string]string
		body, _ := io.ReadAll(req.Body)
		_ = json.Unmarshal(body, &payload)
		require.Equal(t, "did:plc:user1", payload["repo"])
		require.Equal(t, "app.bsky.feed.repost", payload["collection"])
		require.Equal(t, "3lb7v4d3t2c2f", payload["rkey"])
		called = true
		return jsonResponse(req, `{}`), nil
	})}

	adapter := NewBlueskyAdapter("https://bsky.social")
	err := adapter.Unrepost(context.Background(), "bsky-token", "did:plc:user1", UnrepostRequest{
		RepostExternalID: `{"uri":"at://did:plc:user1/app.bsky.feed.repost/3lb7v4d3t2c2f","cid":"bafy123"}`,
	})
	require.NoError(t, err)
	require.True(t, called)
}

func TestBlueskyUnrepostIdempotent400And404(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	for _, status := range []int{http.StatusBadRequest, http.StatusNotFound} {
		httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: status,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"error":"RecordNotFound"}`)),
				Request:    req,
			}, nil
		})}

		adapter := NewBlueskyAdapter("https://bsky.social")
		err := adapter.Unrepost(context.Background(), "bsky-token", "did:plc:user1", UnrepostRequest{
			RepostExternalID: "3lb7v4d3t2c2f",
		})
		require.NoError(t, err)
	}
}

func TestResolveBlueskyComposerReferencesMultiSegmentHandles(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	resolvedHandles := []string{}
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if strings.Contains(req.URL.Path, "com.atproto.identity.resolveHandle") {
			handle := req.URL.Query().Get("handle")
			resolvedHandles = append(resolvedHandles, handle)
			if handle == "mercurykitsune.bsky.social" {
				return jsonResponse(req, `{"did":"did:plc:mercury123"}`), nil
			}
			if handle == "anielde.bsky.social" {
				return jsonResponse(req, `{"did":"did:plc:anielde123"}`), nil
			}
			return &http.Response{
				StatusCode: http.StatusBadRequest,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"error":"InvalidRequest","message":"Unable to resolve handle"}`)),
				Request:    req,
			}, nil
		}
		return jsonResponse(req, `{}`), nil
	})}

	adapter := NewBlueskyAdapter("https://bsky.social")
	req := &PublishRequest{
		Content:  "👅💦 ... @mercurykitsune.bsky.social doing the work of gods with @anielde.bsky.social 👌",
		Settings: map[string]interface{}{},
	}

	err := adapter.resolveBlueskyComposerReferences(context.Background(), "test-token", req)
	require.NoError(t, err)

	require.Contains(t, resolvedHandles, "mercurykitsune.bsky.social")
	require.Contains(t, resolvedHandles, "anielde.bsky.social")
	require.NotContains(t, resolvedHandles, "bsky.")

	rawDIDs, ok := req.Settings["mention_dids"].(string)
	require.True(t, ok)
	var mentionMap map[string]string
	require.NoError(t, json.Unmarshal([]byte(rawDIDs), &mentionMap))
	require.Equal(t, "did:plc:mercury123", mentionMap["mercurykitsune.bsky.social"])
	require.Equal(t, "did:plc:anielde123", mentionMap["anielde.bsky.social"])

	// Test facet generation
	facets := buildBlueskyFacets(req.Content, req.Settings)
	require.Len(t, facets, 2)
}


