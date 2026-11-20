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
			require.Empty(t, validateBlueskyMedia(req.Media))
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
	issues := validateBlueskyMedia(eleven.Media)
	require.Len(t, issues, 1)
	require.Equal(t, severityError, issues[0].Severity)
	_, err := adapter.buildPostRecord("did:plc:openpost", eleven, fixedBlueskyTime())
	require.ErrorContains(t, err, "up to 10")

	for _, tc := range []struct {
		name string
		mut  func(*PublishRequest)
		want string
	}{
		{"zero width", func(r *PublishRequest) { r.Media[2].Width = 0 }, "requires dimensions"},
		{"negative height", func(r *PublishRequest) { r.Media[2].Height = -1 }, "requires dimensions"},
		{"missing metadata", func(r *PublishRequest) { r.Media = r.Media[:3] }, "requires dimensions"},
		{"invalid blob", func(r *PublishRequest) { r.PlatformMediaIDs[2] = "not JSON" }, "decoding bluesky blob"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := blueskyGalleryFixture(t, 5)
			tc.mut(req)
			_, err := adapter.buildPostRecord("did:plc:openpost", req, fixedBlueskyTime())
			require.ErrorContains(t, err, tc.want)
		})
	}

	for _, mime := range []string{"image/gif", "application/pdf"} {
		req := blueskyGalleryFixture(t, 5)
		req.Media[3].MimeType = mime
		issues := validateBlueskyMedia(req.Media)
		require.Len(t, issues, 1)
		require.Equal(t, req.Media[3].ID, issues[0].MediaID)
	}
	req := blueskyGalleryFixture(t, 5)
	req.Media[0].Height = 0
	issues = validateBlueskyMedia(req.Media)
	require.Len(t, issues, 1)
	require.Equal(t, req.Media[0].ID, issues[0].MediaID)
}
