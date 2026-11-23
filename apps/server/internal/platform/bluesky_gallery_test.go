package platform

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
)

func blueskyGalleryFixture(t *testing.T, count int) *PublishRequest {
	t.Helper()
	req := &PublishRequest{Content: "Gallery regression"}
	for i := 0; i < count; i++ {
		blob, err := json.Marshal(map[string]interface{}{
			"$type": "blob", "mimeType": "image/jpeg", "size": i + 1,
		})
		require.NoError(t, err)
		req.PlatformMediaIDs = append(req.PlatformMediaIDs, string(blob))
		req.MediaAltTexts = append(req.MediaAltTexts, fmt.Sprintf("Image %d", i+1))
		req.Media = append(req.Media, MediaItem{
			ID: fmt.Sprintf("image-%d", i), MimeType: "image/jpeg",
			Width: 1080 + i, Height: 1350,
		})
	}
	return req
}

func TestBlueskyGalleryRecordKeepsImageOrderingAndALT(t *testing.T) {
	adapter := NewBlueskyAdapter("")
	for _, count := range []int{1, 4, 5, 8, 10} {
		t.Run(fmt.Sprintf("%d_images", count), func(t *testing.T) {
			req := blueskyGalleryFixture(t, count)
			record, err := adapter.buildPostRecord("did:plc:openpost", req, fixedBlueskyTime())
			require.NoError(t, err)
			embed := record["embed"].(map[string]interface{})
			key, wantType := "images", "app.bsky.embed.images"
			if count > 4 {
				key, wantType = "items", "app.bsky.embed.gallery"
			}
			require.Equal(t, wantType, embed["$type"])
			items := embed[key].([]map[string]interface{})
			require.Len(t, items, count)
			for i, item := range items {
				require.Equal(t, req.MediaAltTexts[i], item["alt"])
				require.Equal(t, map[string]int{"width": 1080 + i, "height": 1350}, item["aspectRatio"])
				require.Equal(t, float64(i+1), item["image"].(map[string]interface{})["size"])
				if count > 4 {
					require.Equal(t, "app.bsky.embed.gallery#image", item["$type"])
				} else {
					require.NotContains(t, item, "$type")
				}
			}
		})
	}
}

func TestBlueskyGalleryQuoteWrapsInRecordWithMedia(t *testing.T) {
	req := blueskyGalleryFixture(t, 6)
	req.Settings = map[string]interface{}{
		"quote_uri": "at://did:plc:example/app.bsky.feed.post/abc",
		"quote_cid": "bafyreibjifzpqj6o6wcq3hejh7y4z4z2vmiklkvykc57tw3pcbx3kxifpm",
	}
	record, err := NewBlueskyAdapter("").buildPostRecord("did:plc:openpost", req, fixedBlueskyTime())
	require.NoError(t, err)
	wrapped := record["embed"].(map[string]interface{})
	require.Equal(t, "app.bsky.embed.recordWithMedia", wrapped["$type"])
	gallery := wrapped["media"].(map[string]interface{})
	require.Equal(t, "app.bsky.embed.gallery", gallery["$type"])
	require.Len(t, gallery["items"], 6)
}

func TestBlueskyGalleryFailsClosedOnLimitsAndIncompleteMedia(t *testing.T) {
	adapter := NewBlueskyAdapter("")
	eleven := blueskyGalleryFixture(t, 11)
	_, err := adapter.buildPostRecord("did:plc:openpost", eleven, fixedBlueskyTime())
	require.ErrorContains(t, err, "up to 10")

	for _, tc := range []struct {
		name string
		mut  func(*PublishRequest)
		want string
	}{
		{"zero width", func(r *PublishRequest) { r.Media[2].Width = 0 }, "requires dimensions"},
		{"negative height", func(r *PublishRequest) { r.Media[2].Height = -1 }, "requires dimensions"},
		{"missing metadata", func(r *PublishRequest) { r.Media = r.Media[:3] }, "metadata count"},
		{"invalid blob", func(r *PublishRequest) { r.PlatformMediaIDs[2] = "not JSON" }, "decoding bluesky blob"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := blueskyGalleryFixture(t, 5)
			tc.mut(req)
			_, err := adapter.buildPostRecord("did:plc:openpost", req, fixedBlueskyTime())
			require.ErrorContains(t, err, tc.want)
		})
	}

}

func TestBlueskyGalleryAdapterRejectsMixedMediaAndInvalidFormats(t *testing.T) {
	adapter := NewBlueskyAdapter("")
	for _, test := range []struct {
		name string
		mutate func(*PublishRequest)
		want string
	}{
		{
			name: "video first followed by image",
			mutate: func(r *PublishRequest) { r.Media[0].MimeType = "video/mp4" },
			want: "mixing video",
		},
		{
			name: "video second",
			mutate: func(r *PublishRequest) { r.Media[1].MimeType = "video/mp4" },
			want: "mixing video",
		},
		{
			name: "unsupported video format",
			mutate: func(r *PublishRequest) { r.Media[0].MimeType = "video/quicktime" },
			want: "single MP4",
		},
		{
			name: "invalid gallery image format",
			mutate: func(r *PublishRequest) { r.Media[3].MimeType = "image/gif" },
			want: "single MP4",
		},
		{
			name: "oversized gallery metadata",
			mutate: func(r *PublishRequest) { r.Media[2].Size = 2_000_001 },
			want: "supported size limit",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := blueskyGalleryFixture(t, 5)
			test.mutate(req)
			_, err := adapter.buildPostRecord("did:plc:openpost", req, fixedBlueskyTime())
			require.ErrorContains(t, err, test.want)
		})
	}
}

func TestBlueskySingleVideoRecordRemainsSupported(t *testing.T) {
	req := blueskyGalleryFixture(t, 1)
	req.Media[0].MimeType = "video/mp4"
	req.PlatformMediaIDs[0] = `{"$type":"blob","mimeType":"video/mp4","size":1}`
	record, err := NewBlueskyAdapter("").buildPostRecord("did:plc:openpost", req, fixedBlueskyTime())
	require.NoError(t, err)
	embed := record["embed"].(map[string]interface{})
	require.Equal(t, "app.bsky.embed.video", embed["$type"])
}
