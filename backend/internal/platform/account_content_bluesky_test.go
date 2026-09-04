package platform

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestBlueskyAccountContentDiscoveryIsRepositoryBoundCappedAndPaginated(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	pdsURL := "https://pds.example"
	repo := "did:plc:founder"
	now := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)
	calls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		require.Equal(t, pdsURL, req.URL.Scheme+"://"+req.URL.Host)
		require.Equal(t, repo, req.URL.Query().Get("actor"))
		require.Equal(t, "posts_with_replies", req.URL.Query().Get("filter"))
		require.Equal(t, "false", req.URL.Query().Get("includePins"))
		require.Equal(t, "Bearer token", req.Header.Get("Authorization"))
		if calls == 1 {
			require.Empty(t, req.URL.Query().Get("cursor"))
			return jsonResponse(req, `{
				"cursor":"provider-page-2",
				"feed":[
					{"post":{"uri":"at://did:plc:founder/app.bsky.feed.post/3abc","author":{"did":"did:plc:founder"},"record":{"$type":"app.bsky.feed.post","text":"Launch day","createdAt":"2026-09-05T11:00:00Z","embed":{"$type":"app.bsky.embed.external"}}}},
					{"post":{"uri":"at://did:plc:founder/app.bsky.feed.post/3abc","author":{"did":"did:plc:founder"},"record":{"$type":"app.bsky.feed.post","text":"duplicate","createdAt":"2026-09-05T11:00:00Z"}}},
					{"post":{"uri":"at://did:plc:other/app.bsky.feed.post/3abc","author":{"did":"did:plc:other"},"record":{"$type":"app.bsky.feed.post","text":"other repository","createdAt":"2026-09-05T10:00:00Z"}}}
				]
			}`), nil
		}
		require.Equal(t, "provider-page-2", req.URL.Query().Get("cursor"))
		return jsonResponse(req, `{
			"feed":[{"post":{"uri":"at://did:plc:founder/app.bsky.feed.post/3abb","author":{"did":"did:plc:founder"},"record":{"$type":"app.bsky.feed.post","text":"Earlier","createdAt":"2026-09-05T09:00:00Z","embed":{"$type":"app.bsky.embed.video"}}}}]
		}`), nil
	})}

	adapter := NewBlueskyAdapter(pdsURL)
	support := adapter.AccountContentDiscoverySupport(AnalyticsAccountContext{AccountID: repo})
	require.True(t, support.Supported)
	require.Equal(t, blueskyAccountContentPageSize, support.MaxPageSize)

	first, err := adapter.DiscoverAccountContent(context.Background(), "token", AccountContentDiscoveryRequest{
		AccountID: repo, PageSize: 3, PublishedAfter: now.Add(-24 * time.Hour),
	})
	require.NoError(t, err)
	require.Len(t, first.Items, 1, "duplicate URIs and foreign repositories must be excluded exactly")
	require.NotEmpty(t, first.NextCursor)
	require.Equal(t, AccountContentDiscoveryPartial, first.Coverage.Status)
	coverage := strings.ToLower(first.Coverage.Description)
	require.Contains(t, coverage, "authenticated")
	require.Contains(t, coverage, "public")
	require.Contains(t, coverage, "caps")
	require.Equal(t, "link_share", first.Items[0].ContentProfile)
	require.Equal(t, "https://bsky.app/profile/did:plc:founder/post/3abc", first.Items[0].ExternalURL)
	require.Contains(t, first.Items[0].ProviderContentID, "pds.example")
	require.Contains(t, first.Items[0].ProviderContentID, "repo=did%3Aplc%3Afounder")

	second, err := adapter.DiscoverAccountContent(context.Background(), "token", AccountContentDiscoveryRequest{
		AccountID: repo, Cursor: first.NextCursor, PageSize: 3, PublishedAfter: now.Add(-24 * time.Hour),
	})
	require.NoError(t, err)
	require.Len(t, second.Items, 1)
	require.Equal(t, "short_video", second.Items[0].ContentProfile)
	require.Empty(t, second.NextCursor)
	require.Equal(t, 2, calls)
}

func TestBlueskyAccountContentIdentityPreventsRepositoryAndPDSCollisions(t *testing.T) {
	one, ok := CanonicalSocialAccountContentID(providerBluesky, "https://one.pds", "did:plc:one", "at://did:plc:one/app.bsky.feed.post/key")
	require.True(t, ok)
	otherRepo, ok := CanonicalSocialAccountContentID(providerBluesky, "https://one.pds", "did:plc:two", "at://did:plc:two/app.bsky.feed.post/key")
	require.True(t, ok)
	otherPDS, ok := CanonicalSocialAccountContentID(providerBluesky, "https://two.pds", "did:plc:one", "at://did:plc:one/app.bsky.feed.post/key")
	require.True(t, ok)
	require.NotEqual(t, one, otherRepo)
	require.NotEqual(t, one, otherPDS)

	cursor, err := encodeBlueskyAccountContentCursor(blueskyAccountContentCursor{PDSURL: "https://one.pds", Repo: "did:plc:one", Cursor: "next"})
	require.NoError(t, err)
	_, err = decodeBlueskyAccountContentCursor(cursor, "https://two.pds", "did:plc:one")
	require.Error(t, err)
	_, err = decodeBlueskyAccountContentCursor(cursor, "https://one.pds", "did:plc:two")
	require.Error(t, err)
}
