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

func TestResolveBlueskyPDS(t *testing.T) {
	const handleURL = "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=alice.example"
	const handleWellKnownURL = "https://alice.example/.well-known/atproto-did"
	const plcURL = "https://plc.directory/did:plc:selfhostedexample000000"
	const wellKnownURL = "https://pds.example/.well-known/did.json"

	cases := []struct {
		name       string
		identifier string
		responses  map[string]string
		wantPDS    string
		wantDID    string
		wantErr    string
		wantCalls  int
	}{
		{
			name:       "handle resolves through its plc document",
			identifier: "alice.example",
			responses: map[string]string{
				handleURL: `{"did":"did:plc:selfhostedexample000000"}`,
				plcURL:    blueskyDIDDocument("did:plc:selfhostedexample000000", "alice.example", "https://pds.example/"),
			},
			wantPDS:   "https://pds.example",
			wantDID:   "did:plc:selfhostedexample000000",
			wantCalls: 2,
		},
		{
			name:       "leading at sign is stripped from the handle",
			identifier: "@alice.example",
			responses: map[string]string{
				handleURL: `{"did":"did:plc:selfhostedexample000000"}`,
				plcURL:    blueskyDIDDocument("did:plc:selfhostedexample000000", "alice.example", "https://pds.example/"),
			},
			wantPDS:   "https://pds.example",
			wantDID:   "did:plc:selfhostedexample000000",
			wantCalls: 2,
		},
		{
			name:       "handle falls back to its well known did",
			identifier: "alice.example",
			responses: map[string]string{
				handleWellKnownURL: "did:plc:selfhostedexample000000\n",
				plcURL:             blueskyDIDDocument("did:plc:selfhostedexample000000", "alice.example", "https://pds.example"),
			},
			wantPDS:   "https://pds.example",
			wantDID:   "did:plc:selfhostedexample000000",
			wantCalls: 3,
		},
		{
			name:       "did:web identifier reads its well-known document",
			identifier: "did:web:pds.example",
			responses:  map[string]string{wellKnownURL: blueskyDIDDocument("did:web:pds.example", "", "https://pds.example")},
			wantPDS:    "https://pds.example",
			wantDID:    "did:web:pds.example",
			wantCalls:  1,
		},
		{
			name:       "endpoint userinfo query and path are rejected",
			identifier: "did:web:PDS.Example",
			responses:  map[string]string{wellKnownURL: blueskyDIDDocument("did:web:PDS.Example", "", "https://user:pw@PDS.Example/xrpc/?a=1#f")},
			wantErr:    "must be an origin url",
			wantCalls:  1,
		},
		{
			name:       "unresolvable handle is an error",
			identifier: "alice.example",
			wantErr:    "resolving bluesky handle",
			wantCalls:  2,
		},
		{
			name:       "document without a pds service fails closed",
			identifier: "did:web:pds.example",
			responses: map[string]string{
				wellKnownURL: `{"id":"did:web:pds.example","service":[{"id":"#atproto_labeler","type":"AtprotoLabeler","serviceEndpoint":"https://pds.example"}]}`,
			},
			wantErr:   "did document has no personal data server",
			wantCalls: 1,
		},
		{
			name:       "malformed did document fails closed",
			identifier: "did:web:pds.example",
			responses:  map[string]string{wellKnownURL: `{`},
			wantErr:    "decoding bluesky did document",
			wantCalls:  1,
		},
		{
			name:       "did document must assert the resolved did",
			identifier: "did:web:pds.example",
			responses:  map[string]string{wellKnownURL: blueskyDIDDocument("did:web:other.example", "", "https://pds.example")},
			wantErr:    "did document id does not match",
			wantCalls:  1,
		},
		{
			name:       "handle must be claimed by the did document",
			identifier: "alice.example",
			responses: map[string]string{
				handleURL: `{"did":"did:plc:selfhostedexample000000"}`,
				plcURL:    blueskyDIDDocument("did:plc:selfhostedexample000000", "former.example", "https://pds.example"),
			},
			wantErr:   "did document does not claim handle",
			wantCalls: 2,
		},
		{
			name:       "malformed service entries are skipped",
			identifier: "did:web:pds.example",
			responses: map[string]string{
				wellKnownURL: `{"id":"did:web:pds.example","service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":""},` +
					`{"id":"did:web:pds.example#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}`,
			},
			wantPDS:   "https://pds.example",
			wantDID:   "did:web:pds.example",
			wantCalls: 1,
		},
		{
			name:       "bluesky hosted endpoint is unresolved",
			identifier: "did:web:pds.example",
			responses:  map[string]string{wellKnownURL: blueskyDIDDocument("did:web:pds.example", "", "https://polypore.us-west.host.bsky.network")},
			wantDID:    "did:web:pds.example",
			wantCalls:  1,
		},
		{
			name:       "plain http endpoint is rejected",
			identifier: "did:web:pds.example",
			responses:  map[string]string{wellKnownURL: blueskyDIDDocument("did:web:pds.example", "", "http://pds.example")},
			wantErr:    "bluesky pds scheme must be https",
			wantCalls:  1,
		},
		{
			name:       "endpoint on a private address is rejected",
			identifier: "did:web:pds.example",
			responses:  map[string]string{wellKnownURL: blueskyDIDDocument("did:web:pds.example", "", "https://private.example")},
			wantErr:    "private or local address",
			wantCalls:  1,
		},
		{
			name:       "email sign-in resolves nothing",
			identifier: "founder@example.com",
			wantCalls:  0,
		},
		{
			name:       "did:web host with a port is rejected",
			identifier: "did:web:pds.example:3000",
			wantErr:    "unsupported did:web identifier",
		},
		{
			name:       "did:web host with a path is rejected",
			identifier: `did:web:pds.example\bad`,
			wantErr:    "unsupported did:web identifier",
		},
		{
			name:       "did:web host with a fragment is rejected",
			identifier: "did:web:pds.example#frag",
			wantErr:    "unsupported did:web identifier",
		},
		{
			name:       "did:web host with a query is rejected",
			identifier: "did:web:pds.example?a=1",
			wantErr:    "unsupported did:web identifier",
		},
		{
			name:       "unsupported did method is rejected",
			identifier: "did:key:z6Mk",
			wantErr:    "unsupported did method",
		},
	}

	// An "@" identifier never reaches DID handling: it is taken for an email.
	_, err := blueskyDIDDocumentURL("did:web:user@pds.example")
	require.ErrorContains(t, err, "unsupported did:web identifier")

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			calls := 0
			stubBlueskyResolution(t, testCase.responses, &calls)

			pdsURL, did, err := ResolveBlueskyPDS(context.Background(), testCase.identifier)
			if testCase.wantErr != "" {
				require.ErrorContains(t, err, testCase.wantErr)
			} else {
				require.NoError(t, err)
				require.Equal(t, testCase.wantPDS, pdsURL)
				require.Equal(t, testCase.wantDID, did)
			}
			require.Equal(t, testCase.wantCalls, calls)
		})
	}
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

// The adapter reached through a bluesky:<pds> key must build content identities
// on the same base the account stores, or discovery cannot match its renditions.
func TestBlueskyProviderKeyAdapterSharesAccountContentIdentity(t *testing.T) {
	const instanceURL = "https://pds.example"
	const did = "did:plc:selfhostedexample000000"
	const uri = "at://" + did + "/app.bsky.feed.post/3kabcdefghi"

	providers := map[string]Adapter{
		providerBluesky: NewBlueskyAdapter(""),
		AccountProviderKey(providerBluesky, instanceURL, ""): NewBlueskyAdapter(instanceURL),
	}
	adapter, ok := providers[AccountProviderKey(providerBluesky, instanceURL, "")].(*BlueskyAdapter)
	require.True(t, ok)

	originalClient := httpClient
	t.Cleanup(func() { httpClient = originalClient })
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, "pds.example", req.URL.Host)
		body := `{"feed":[{"post":{"uri":"` + uri + `","author":{"did":"` + did + `"},` +
			`"record":{"text":"hello","createdAt":"2026-01-02T03:04:05Z"}}}]}`
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
	})}

	page, err := adapter.DiscoverAccountContent(context.Background(), "token", AccountContentDiscoveryRequest{AccountID: did, PageSize: 10})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)

	want, ok := CanonicalSocialAccountContentID(providerBluesky, instanceURL, did, uri)
	require.True(t, ok)
	require.Equal(t, want, page.Items[0].ProviderContentID)
}
