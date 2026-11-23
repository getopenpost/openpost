package platform

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestBuildBlueskyFacetsTrimsTrailingPunctuation(t *testing.T) {
	facets := buildBlueskyFacets("see https://example.com/path.", nil)
	require.Len(t, facets, 1)
	requireFacet(t, facets, 4, 28, "app.bsky.richtext.facet#link", "uri", "https://example.com/path")
}

func TestBuildBlueskyFacetsSkipsMalformedMentionDIDs(t *testing.T) {
	facets := buildBlueskyFacets("hi @user.bsky.social", map[string]interface{}{
		"mention_dids": "user.bsky.social=not-a-did",
	})
	require.Empty(t, facets)
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

type resolverFunc func(context.Context, string) ([]net.IPAddr, error)

func (fn resolverFunc) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return fn(ctx, host)
}

func stubBlueskyResolution(t *testing.T, responses map[string]string, calls *int) {
	t.Helper()

	originalClient := httpClient
	originalOverride := blueskyPDSClientOverride
	originalResolver := blueskyPDSDNSResolver
	t.Cleanup(func() {
		httpClient = originalClient
		blueskyPDSClientOverride = originalOverride
		blueskyPDSDNSResolver = originalResolver
	})

	blueskyPDSDNSResolver = resolverFunc(func(_ context.Context, host string) ([]net.IPAddr, error) {
		if host == "private.example" {
			return []net.IPAddr{{IP: net.ParseIP("10.0.0.5")}}, nil
		}
		return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
	})
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if calls != nil {
			*calls++
		}
		body, ok := responses[req.URL.String()]
		if !ok {
			return &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(strings.NewReader("{}")), Request: req}, nil
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
	})}
	blueskyPDSClientOverride = httpClient
}

func blueskyDIDDocument(did, handle, endpoint string) string {
	alsoKnownAs := ""
	if handle != "" {
		alsoKnownAs = `,"alsoKnownAs":["at://` + handle + `"]`
	}
	return `{"id":"` + did + `"` + alsoKnownAs + `,"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"` + endpoint + `"}]}`
}

func TestResolvedBlueskyAdapterRevalidatesPDSBeforeSendingCredentials(t *testing.T) {
	stubBlueskyResolution(t, nil, nil)
	blueskyPDSDNSResolver = resolverFunc(func(_ context.Context, _ string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("10.0.0.5")}}, nil
	})
	adapter := NewResolvedBlueskyAdapter("https://private.example")

	did, handle, accessToken, refreshToken, expiresIn, err := adapter.CreateSession(t.Context(), "alice.example", "app-password")
	require.ErrorContains(t, err, "private or local address")
	require.Empty(t, did)
	require.Empty(t, handle)
	require.Empty(t, accessToken)
	require.Empty(t, refreshToken)
	require.Zero(t, expiresIn)
}

func TestResolveBlueskyComposerReferencesUsesCompleteHandlesAndByteFacets(t *testing.T) {
	originalClient := httpClient
	t.Cleanup(func() { httpClient = originalClient })

	resolvedHandles := []string{}
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		handle := req.URL.Query().Get("handle")
		resolvedHandles = append(resolvedHandles, handle)
		return jsonResponse(req, `{"did":"did:plc:`+strings.ReplaceAll(handle, ".", "-")+`"}`), nil
	})}

	adapter := NewBlueskyAdapter("")
	request := &PublishRequest{
		Content:  "👅💦 @mercurykitsune.bsky.social and @anielde.bsky.social",
		Settings: map[string]interface{}{},
	}
	require.NoError(t, adapter.resolveBlueskyComposerReferences(t.Context(), "token", request))
	require.Equal(t, []string{"mercurykitsune.bsky.social", "anielde.bsky.social"}, resolvedHandles)

	encoded, ok := request.Settings["mention_dids"].(string)
	require.True(t, ok)
	var mentions map[string]string
	require.NoError(t, json.Unmarshal([]byte(encoded), &mentions))
	require.Contains(t, mentions, "mercurykitsune.bsky.social")
	require.Contains(t, mentions, "anielde.bsky.social")

	facets := buildBlueskyFacets(request.Content, request.Settings)
	requireFacet(t, facets, 9, 36, "app.bsky.richtext.facet#mention", "did", mentions["mercurykitsune.bsky.social"])
	requireFacet(t, facets, 41, 61, "app.bsky.richtext.facet#mention", "did", mentions["anielde.bsky.social"])
}
