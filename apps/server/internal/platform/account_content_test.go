package platform

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// The discovery job asks for pages no smaller than MinPageSize and rejects a
// page with more items than it asked for. Lemmy, PieFed, and PeerTube read
// fixed-size pages, so the smallest page they accept must be that size.
func TestFixedPageDiscoveryNeverReturnsMoreThanTheSmallestRequestedPage(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	const instanceURL = "https://fed.example"
	published := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	full := func(limit string, item func(id int) string) string {
		size, _ := strconv.Atoi(limit)
		items := make([]string, 0, size)
		for id := 1; id <= size; id++ {
			items = append(items, item(id))
		}
		return strings.Join(items, ",")
	}
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		query := req.URL.Query()
		switch req.URL.Path {
		case "/api/v3/user":
			return jsonResponse(req, `{"posts":[`+full(query.Get("limit"), func(id int) string {
				return fmt.Sprintf(`{"post":{"id":%d,"name":"Post","ap_id":"%s/post/%d","published":%q}}`, id, instanceURL, id, published)
			})+`]}`), nil
		case "/api/alpha/post/list":
			return jsonResponse(req, `{"posts":[`+full(query.Get("limit"), func(id int) string {
				return fmt.Sprintf(`{"post":{"id":%d,"title":"Post","ap_id":"%s/post/%d","published":%q}}`, id, instanceURL, id, published)
			})+`],"next_page":"2"}`), nil
		case "/api/v1/video-channels/demos/videos":
			return jsonResponse(req, `{"total":1000,"data":[`+full(query.Get("count"), func(id int) string {
				return fmt.Sprintf(`{"uuid":"uuid-%d","name":"Video","publishedAt":%q}`, id, published)
			})+`]}`), nil
		}
		return jsonResponseWithStatus(req, http.StatusNotFound, `{}`), nil
	})}

	tests := []struct {
		name       string
		discoverer AccountContentDiscoverer
		accountID  string
	}{
		{name: "lemmy", discoverer: NewLemmyAdapter(instanceURL), accountID: "5"},
		{name: "piefed", discoverer: NewPieFedAdapter(instanceURL), accountID: "5"},
		{name: "peertube", discoverer: NewPeerTubeAdapter(instanceURL), accountID: "demos"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			support := test.discoverer.AccountContentDiscoverySupport(AnalyticsAccountContext{AccountID: test.accountID})
			require.True(t, support.Supported)
			smallest := max(1, support.MinPageSize)
			page, err := test.discoverer.DiscoverAccountContent(t.Context(), "token", AccountContentDiscoveryRequest{
				AccountID: test.accountID, PageSize: smallest, PublishedAfter: time.Now().UTC().Add(-90 * 24 * time.Hour),
			})
			require.NoError(t, err)
			require.NotEmpty(t, page.Items)
			require.LessOrEqual(t, len(page.Items), smallest, "a page must fit the smallest page size the adapter declares")
		})
	}
}

func TestNormalizeAccountContentItemBoundsTextAndRejectsUnsafeProviderURLs(t *testing.T) {
	t.Parallel()

	item, err := NormalizeAccountContentItem("youtube", AccountContentItem{
		ProviderContentID: " video-1 ", ContentProfile: "long_video",
		Title:       strings.Repeat("a", AccountContentMaxTitleCharacters+1),
		Text:        strings.Repeat("界", AccountContentMaxTextCharacters+1) + "\r\n",
		ExternalURL: "https://www.youtube.com/watch?v=video-1", PublishedAt: time.Now(),
		Origin: AccountContentOriginExternal,
	})
	require.NoError(t, err)
	require.Equal(t, "video-1", item.ProviderContentID)
	require.Len(t, []rune(item.Title), AccountContentMaxTitleCharacters)
	require.Len(t, []rune(item.Text), AccountContentMaxTextCharacters)
	require.Equal(t, AccountContentOriginConfidenceUnknown, item.OriginConfidence)

	for _, unsafe := range []string{
		"javascript:alert(1)",
		"https://user:secret@youtube.com/watch?v=video-1",
		"https://youtube.com.evil.example/watch?v=video-1",
	} {
		candidate := item
		candidate.ExternalURL = unsafe
		_, err := NormalizeAccountContentItem("youtube", candidate)
		require.Error(t, err, unsafe)
	}
}
