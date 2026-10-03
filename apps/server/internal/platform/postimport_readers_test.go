package platform

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// Fixtures follow the providers' documented wire formats. A foreign author,
// reply, reshare or pre-activation post must never enter the library.
func TestNativePostReadersAtHTTPBoundary(t *testing.T) {
	tests := []struct{ provider, account, path, body, id, text, cursorKey string }{
		{"threads", "42", "/v1.0/42/threads", `{"data":[{"id":"new","owner":{"id":"42"},"text":"hello","timestamp":"2026-10-03T12:00:00+0000","permalink":"https://www.threads.net/@owner/post/new"},{"id":"reply","is_reply":true,"text":"reply","timestamp":"2026-10-03T12:00:00+0000"},{"id":"old","text":"old","timestamp":"2026-09-01T12:00:00+0000"}],"paging":{"cursors":{"after":"next"},"next":"https://evil.test/secret"}}`, "new", "hello", "after"},
		{"instagram", "42", "/42/media", `{"data":[{"id":"new","caption":"hello","timestamp":"2026-10-03T12:00:00+0000","permalink":"https://www.instagram.com/p/new/"},{"id":"old","caption":"old","timestamp":"2026-09-01T12:00:00+0000"}],"paging":{"cursors":{"after":"next"},"next":"https://evil.test/secret"}}`, "new", "hello", "after"},
		{"facebook", "42", "/42/posts", `{"data":[{"id":"42_new","message":"hello","created_time":"2026-10-03T12:00:00+0000","from":{"id":"42"},"permalink_url":"https://www.facebook.com/42/posts/new"},{"id":"other_new","message":"foreign","created_time":"2026-10-03T12:00:00+0000","from":{"id":"other"}},{"id":"42_old","message":"old","created_time":"2026-09-01T12:00:00+0000","from":{"id":"42"}}],"paging":{"cursors":{"after":"next"},"next":"https://evil.test/secret"}}`, "42_new", "hello", "after"},
		{"pinterest", "42", "/v5/pins", `{"items":[{"id":"new","description":"hello","created_at":"2026-10-03T12:00:00","is_owner":true},{"id":"repin","description":"repin","created_at":"2026-10-03T12:00:00","is_owner":true,"parent_pin_id":"parent"},{"id":"foreign","description":"foreign","created_at":"2026-10-03T12:00:00","is_owner":false},{"id":"old","description":"old","created_at":"2026-09-01T12:00:00","is_owner":true}],"bookmark":"next"}`, "new", "hello", "bookmark"},
		{"tiktok", "42", "/v2/video/list/", `{"data":{"videos":[{"id":"new","video_description":"hello","create_time":1791028800,"share_url":"https://www.tiktok.com/@owner/video/new"},{"id":"old","create_time":1788264000}],"cursor":1791028800000,"has_more":true},"error":{"code":"ok"}}`, "new", "hello", "cursor"},
		{"linkedin", "urn:li:organization:42", "/rest/posts", `{"elements":[{"id":"urn:li:share:new","author":"urn:li:organization:42","commentary":"hello","publishedAt":1791028800000,"lifecycleState":"PUBLISHED","visibility":"PUBLIC","distribution":{"feedDistribution":"MAIN_FEED"}},{"id":"foreign","author":"urn:li:organization:99","commentary":"foreign","publishedAt":1791028800000,"lifecycleState":"PUBLISHED","visibility":"PUBLIC"},{"id":"old","author":"urn:li:organization:42","publishedAt":1788264000000,"lifecycleState":"PUBLISHED","visibility":"PUBLIC"}],"paging":{"links":[{"rel":"next","href":"https://api.linkedin.com/rest/posts?start=50"}]}}`, "urn:li:share:new", "hello", "start"},
		{"googlebusiness", "accounts/1/locations/42", "/v4/accounts/1/locations/42/localPosts", `{"localPosts":[{"name":"accounts/1/locations/42/localPosts/new","summary":"hello","state":"LIVE","createTime":"2026-09-01T12:00:00Z","scheduledTime":"2026-10-03T12:00:00Z","searchUrl":"https://www.google.com/search?q=new"},{"name":"accounts/1/locations/42/localPosts/pending","summary":"pending","state":"PROCESSING","createTime":"2026-10-03T12:00:00Z"},{"name":"accounts/1/locations/99/localPosts/foreign","state":"LIVE","createTime":"2026-10-03T12:00:00Z"}],"nextPageToken":"next"}`, "accounts/1/locations/42/localPosts/new", "hello", "pageToken"},
		{"peertube", "42", "/api/v1/video-channels/42/videos", `{"total":51,"data":[{"id":7,"uuid":"new","name":"Video","description":"hello","publishedAt":"2026-10-03T12:00:00Z","url":"https://instance.test/videos/watch/new","channel":{"id":42},"privacy":{"id":1}},{"id":8,"uuid":"foreign","publishedAt":"2026-10-03T12:00:00Z","channel":{"id":99},"privacy":{"id":1}}]}`, "new", "hello", "start"},
		{"lemmy", "42", "/api/v3/user", `{"posts":[{"post":{"id":7,"creator_id":42,"name":"Title","body":"hello","published":"2026-10-03T12:00:00","ap_id":"https://instance.test/post/7"},"creator":{"id":42}},{"post":{"id":8,"creator_id":99,"name":"Foreign","body":"foreign","published":"2026-10-03T12:00:00","ap_id":"https://instance.test/post/8"},"creator":{"id":99}}]}`, "7", "hello", "page"},
		{"piefed", "42", "/api/alpha/user", `{"posts":[{"post":{"id":7,"user_id":42,"title":"Title","body":"hello","published":"2026-10-03T12:00:00Z","ap_id":"https://instance.test/post/7"},"creator":{"id":42}},{"post":{"id":8,"user_id":99,"title":"Foreign","body":"foreign","published":"2026-10-03T12:00:00Z","ap_id":"https://instance.test/post/8"},"creator":{"id":99}}]}`, "7", "hello", "page"},
	}
	original := httpClient
	t.Cleanup(func() { httpClient = original })
	for _, tt := range tests {
		t.Run(tt.provider, func(t *testing.T) {
			calls := 0
			httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				require.Equal(t, "Bearer token", r.Header.Get("Authorization"))
				require.True(t, strings.HasSuffix(r.URL.Path, tt.path), r.URL.String())
				require.NotEqual(t, "evil.test", r.URL.Host)
				if tt.provider == "tiktok" {
					require.Equal(t, http.MethodPost, r.Method)
				} else {
					require.Equal(t, http.MethodGet, r.Method)
				}
				if tt.provider == "pinterest" {
					require.Equal(t, "exclude_repins", r.URL.Query().Get("pin_filter"))
				}
				body := tt.body
				if calls > 1 {
					var result map[string]any
					require.NoError(t, json.Unmarshal([]byte(body), &result))
					delete(result, "paging")
					delete(result, "bookmark")
					delete(result, "nextPageToken")
					b, err := json.Marshal(result)
					require.NoError(t, err)
					body = string(b)
					if tt.provider != "tiktok" {
						require.NotEmpty(t, r.URL.Query().Get(tt.cursorKey))
					}
				}
				return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
			})}
			reader, ok := NewNativePostReader(tt.provider, "https://instance.test")
			require.True(t, ok, "native imports unavailable")
			req := NativePostRequest{AccountID: tt.account, InstanceURL: "https://instance.test", PageSize: 2, PublishedAfter: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)}
			page, err := reader.ListNativePosts(context.Background(), "token", req)
			require.NoError(t, err)
			require.Len(t, page.Items, 1)
			require.Equal(t, tt.id, page.Items[0].ProviderPostID)
			require.Equal(t, tt.text, page.Items[0].Text)
			require.Equal(t, ImportedPostOriginExternal, page.Items[0].Origin)
			// APIs with server-side 'since' or unspecified ordering must keep their
			// cursor even if one result is old. Never follow the provider's next URL.
			if tt.provider != "tiktok" {
				require.NotEmpty(t, page.NextCursor)
				req.Cursor = page.NextCursor
				_, err = reader.ListNativePosts(context.Background(), "token", req)
				require.NoError(t, err)
				require.Equal(t, 2, calls)
			}
		})
	}
}

func TestYouTubeNativeImportsUseVideoPublicationTimeAndChannel(t *testing.T) {
	original := httpClient
	t.Cleanup(func() { httpClient = original })
	reads := []string{}
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		reads = append(reads, r.URL.Path)
		require.Equal(t, "Bearer token", r.Header.Get("Authorization"))
		body := ""
		switch {
		case strings.HasSuffix(r.URL.Path, "/channels"):
			require.Equal(t, "channel", r.URL.Query().Get("id"))
			body = `{"items":[{"id":"channel","contentDetails":{"relatedPlaylists":{"uploads":"uploads"}}}]}`
		case strings.HasSuffix(r.URL.Path, "/playlistItems"):
			require.Equal(t, "uploads", r.URL.Query().Get("playlistId"))
			body = `{"nextPageToken":"next","items":[{"contentDetails":{"videoId":"new"},"snippet":{"publishedAt":"2026-09-01T12:00:00Z"}},{"contentDetails":{"videoId":"private"}},{"contentDetails":{"videoId":"foreign"}}]}`
		case strings.HasSuffix(r.URL.Path, "/videos"):
			body = `{"items":[{"id":"new","snippet":{"channelId":"channel","title":"Launch","description":"hello","publishedAt":"2026-10-03T12:00:00Z"},"status":{"privacyStatus":"public","uploadStatus":"processed"}},{"id":"private","snippet":{"channelId":"channel","publishedAt":"2026-10-03T12:00:00Z"},"status":{"privacyStatus":"private"}},{"id":"foreign","snippet":{"channelId":"other","publishedAt":"2026-10-03T12:00:00Z"},"status":{"privacyStatus":"public"}}]}`
		default:
			t.Fatalf("unexpected read %s", r.URL)
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
	reader, ok := NewNativePostReader("youtube", "")
	require.True(t, ok)
	input := NativePostRequest{AccountID: "channel", PageSize: 50, PublishedAfter: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)}
	estimator, ok := reader.(NativePostReadEstimator)
	require.True(t, ok)
	require.Equal(t, 3, estimator.NativePostReadCost(input))
	page, err := reader.ListNativePosts(context.Background(), "token", input)
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Equal(t, "new", page.Items[0].ProviderPostID)
	require.Equal(t, "hello", page.Items[0].Text)
	require.Equal(t, "https://www.youtube.com/watch?v=new", page.Items[0].ExternalURL)
	require.Len(t, reads, 3)
	input.Cursor = page.NextCursor
	require.Equal(t, 2, estimator.NativePostReadCost(input))
}

func TestApprovedLinkedInMemberImportsRequestTheirReadPermission(t *testing.T) {
	app := AppConfig{Provider: "linkedin", ClientID: "approved-app", ClientSecret: "test", RedirectURI: "https://app.test/callback"}
	for _, enabled := range []bool{false, true} {
		adapters, _, err := BuildAdapterRegistry([]AppConfig{app}, RegistryOptions{DisableLinkedInThreadReplies: true, EnableLinkedInMemberReads: enabled})
		require.NoError(t, err)
		adapter := adapters["linkedin"]
		authURL, _ := adapter.GenerateAuthURL("state")
		parsed, err := url.Parse(authURL)
		require.NoError(t, err)
		scopes := strings.Fields(parsed.Query().Get("scope"))
		if enabled {
			require.Contains(t, scopes, "r_member_social")
		} else {
			require.NotContains(t, scopes, "r_member_social")
		}
		support := adapter.(AccountNativePostSupportResolver).ResolveAccountNativePostSupport(NativePostAccountContext{AccountID: "urn:li:person:42", GrantedScopes: "r_member_social"})
		require.Equal(t, enabled, support.Supported)
	}
}
