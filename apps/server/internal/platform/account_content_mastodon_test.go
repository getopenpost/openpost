package platform

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/netguard"
	"github.com/stretchr/testify/require"
)

func TestMastodonAccountContentDiscoveryIsInstanceAwarePublicOnlyAndPaginated(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	instanceURL := "https://social.example"
	now := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)
	calls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		require.Equal(t, instanceURL, req.URL.Scheme+"://"+req.URL.Host)
		require.Equal(t, "Bearer token", req.Header.Get("Authorization"))
		require.Equal(t, "true", req.URL.Query().Get("exclude_reblogs"))
		require.Equal(t, "2", req.URL.Query().Get("limit"))
		if calls == 1 {
			require.Empty(t, req.URL.Query().Get("max_id"))
			return jsonResponse(req, `[
				{"id":"42","url":"https://evil.example/@founder/42","content":"<p>Launch <strong>day</strong></p>","created_at":"2026-09-05T11:00:00Z","visibility":"public","account":{"username":"founder"},"media_attachments":[{"type":"image"}]},
				{"id":"42","url":"https://social.example/@founder/42","content":"duplicate","created_at":"2026-09-05T11:00:00Z","visibility":"public","account":{"username":"founder"}}
			]`), nil
		}
		if calls == 2 {
			require.Equal(t, "42", req.URL.Query().Get("max_id"))
			return jsonResponse(req, `[
				{"id":"41","url":"https://social.example/@founder/41","content":"followers only","created_at":"2026-09-05T10:00:00Z","visibility":"private","account":{"username":"founder"}},
				{"id":"40","url":"https://social.example/@founder/40","content":"<p>Earlier</p>","created_at":"2026-09-05T09:00:00Z","visibility":"public","account":{"username":"founder"}}
			]`), nil
		}
		require.Equal(t, "40", req.URL.Query().Get("max_id"))
		return jsonResponse(req, `[]`), nil
	})}

	adapter := NewMastodonAdapter("", "", "", instanceURL)
	support := adapter.AccountContentDiscoverySupport(AnalyticsAccountContext{AccountID: "account-1"})
	require.True(t, support.Supported)
	require.Equal(t, mastodonAccountContentPageSize, support.MaxPageSize)

	first, err := adapter.DiscoverAccountContent(context.Background(), "token", AccountContentDiscoveryRequest{
		AccountID: "account-1", PageSize: 2, PublishedAfter: now.Add(-24 * time.Hour),
	})
	require.NoError(t, err)
	require.Len(t, first.Items, 1, "duplicate provider identities must collapse exactly")
	require.NotEmpty(t, first.NextCursor)
	require.Equal(t, AccountContentDiscoveryPartial, first.Coverage.Status)
	require.Contains(t, strings.ToLower(first.Coverage.Description), "public")
	require.Contains(t, strings.ToLower(first.Coverage.Description), "authenticated")
	require.Equal(t, "Launch day", first.Items[0].Text)
	require.Equal(t, "image_post", first.Items[0].ContentProfile)
	require.Equal(t, "https://social.example/@founder/42", first.Items[0].ExternalURL, "foreign status URLs must not cross the safe instance boundary")
	require.NotContains(t, first.Items[0].ProviderContentID, "evil.example")

	second, err := adapter.DiscoverAccountContent(context.Background(), "token", AccountContentDiscoveryRequest{
		AccountID: "account-1", Cursor: first.NextCursor, PageSize: 2, PublishedAfter: now.Add(-24 * time.Hour),
	})
	require.NoError(t, err)
	require.Len(t, second.Items, 1, "non-public statuses must not be persisted")
	require.Contains(t, second.Items[0].ProviderContentID, "social.example")
	require.NotEmpty(t, second.NextCursor)

	last, err := adapter.DiscoverAccountContent(context.Background(), "token", AccountContentDiscoveryRequest{
		AccountID: "account-1", Cursor: second.NextCursor, PageSize: 2, PublishedAfter: now.Add(-24 * time.Hour),
	})
	require.NoError(t, err)
	require.Empty(t, last.Items)
	require.Empty(t, last.NextCursor)
}

type mastodonTestResolver struct{}

func (mastodonTestResolver) LookupIPAddr(context.Context, string) ([]net.IPAddr, error) {
	return []net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}, nil
}

func TestMastodonDiscoveryHTTPClientRejectsCrossOriginRedirect(t *testing.T) {
	client := mastodonDiscoveryHTTPClientWithPolicy("https://social.example", netguard.URLPolicy{
		Label: "mastodon instance", AllowedSchemes: []string{"https"}, Resolver: mastodonTestResolver{},
	})
	err := client.CheckRedirect(&http.Request{URL: mustParseMastodonTestURL(t, "https://other.example/api/v1/statuses")}, nil)
	require.ErrorContains(t, err, "changed origin")
}

func mustParseMastodonTestURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	require.NoError(t, err)
	return parsed
}

func TestMastodonAccountContentIdentityPreventsCrossInstanceCollision(t *testing.T) {
	first, ok := CanonicalSocialAccountContentID(providerMastodon, "https://one.example/", "", "123")
	require.True(t, ok)
	second, ok := CanonicalSocialAccountContentID(providerMastodon, "https://two.example", "", "123")
	require.True(t, ok)
	require.NotEqual(t, first, second)

	cursor, err := encodeMastodonAccountContentCursor(mastodonAccountContentCursor{InstanceURL: "https://one.example", MaxID: "123"})
	require.NoError(t, err)
	_, err = decodeMastodonAccountContentCursor(cursor, "https://two.example")
	require.Error(t, err, "an opaque cursor must not be reusable against another instance")
}
