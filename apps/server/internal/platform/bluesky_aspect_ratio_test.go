package platform

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBlueskyPublishPreservesMediaAspectRatios(t *testing.T) {
	for _, tc := range []struct {
		name  string
		media []MediaItem
		count int
		quote bool
		want  []map[string]int
	}{
		{name: "portrait video", media: []MediaItem{{MimeType: "video/mp4", Width: 1080, Height: 1920}}, count: 1, want: []map[string]int{{"width": 1080, "height": 1920}}},
		{name: "landscape video quote", media: []MediaItem{{MimeType: "video/mp4", Width: 1920, Height: 1080}}, count: 1, quote: true, want: []map[string]int{{"width": 1920, "height": 1080}}},
		{name: "images keep individual sizes", media: []MediaItem{{MimeType: "image/jpeg", Width: 1080, Height: 1920}, {MimeType: "image/jpeg", Width: 1920, Height: 1080}, {MimeType: "image/jpeg"}}, count: 3, want: []map[string]int{{"width": 1080, "height": 1920}, {"width": 1920, "height": 1080}, nil}},
		{name: "partial video dimensions", media: []MediaItem{{MimeType: "video/mp4", Width: 1080}}, count: 1, want: []map[string]int{nil}},
		{name: "missing image metadata", count: 1, want: []map[string]int{nil}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			originalClient := httpClient
			t.Cleanup(func() { httpClient = originalClient })
			var payload struct {
				Record struct {
					Embed json.RawMessage `json:"embed"`
				} `json:"record"`
			}
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				require.Equal(t, "/xrpc/com.atproto.repo.createRecord", req.URL.Path)
				require.NoError(t, json.NewDecoder(req.Body).Decode(&payload))
				return jsonResponse(req, `{"uri":"at://did:plc:openpost/app.bsky.feed.post/post","cid":"post-cid"}`), nil
			})}
			req := &PublishRequest{Content: "Launch update", Media: tc.media, Settings: map[string]interface{}{}}
			for range tc.count {
				req.PlatformMediaIDs = append(req.PlatformMediaIDs, `{"$type":"blob","ref":{"$link":"media-cid"},"mimeType":"video/mp4","size":100}`)
			}
			if tc.quote {
				req.Settings["quote_uri"] = "at://did:plc:example/app.bsky.feed.post/source"
				req.Settings["quote_cid"] = "source-cid"
			}
			_, err := NewBlueskyAdapter("").Publish(t.Context(), "token", "did:plc:openpost", req)
			require.NoError(t, err)
			embedJSON := payload.Record.Embed
			if tc.quote {
				var wrapper struct {
					Media json.RawMessage `json:"media"`
				}
				require.NoError(t, json.Unmarshal(embedJSON, &wrapper))
				embedJSON = wrapper.Media
			}
			var embed struct {
				AspectRatio map[string]int `json:"aspectRatio"`
				Images      []struct {
					AspectRatio map[string]int `json:"aspectRatio"`
				} `json:"images"`
			}
			require.NoError(t, json.Unmarshal(embedJSON, &embed))
			if len(tc.media) > 0 && tc.media[0].MimeType == "video/mp4" {
				require.Equal(t, tc.want[0], embed.AspectRatio)
			} else {
				require.Len(t, embed.Images, tc.count)
				for i, image := range embed.Images {
					require.Equal(t, tc.want[i], image.AspectRatio)
				}
			}
		})
	}
}
