package publisher

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func blueskyGalleryStoredMedia(count int) []models.MediaAttachment {
	media := make([]models.MediaAttachment, count)
	for i := range media {
		media[i] = models.MediaAttachment{
			ID:       fmt.Sprintf("image-%d", i),
			MimeType: "image/png",
			FilePath: fmt.Sprintf("image-%d.png", i),
			Width:    1080,
			Height:   1350,
		}
	}
	return media
}

func TestBlueskyGalleryPreflightRecoversLegacyDimensionsWithoutProviderWrites(t *testing.T) {
	for _, count := range []int{5, 10} {
		t.Run(fmt.Sprintf("%d images", count), func(t *testing.T) {
			media := blueskyGalleryStoredMedia(count)
			media[2].Width, media[2].Height = 0, 0
			var encoded bytes.Buffer
			require.NoError(t, png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 32, 17))))
			var opened []string
			err := checkBlueskyGalleryMedia(t.Context(), media, func(_ context.Context, key string) (io.ReadCloser, error) {
				opened = append(opened, key)
				return io.NopCloser(bytes.NewReader(encoded.Bytes())), nil
			})
			require.NoError(t, err)
			require.Equal(t, []string{"image-2.png"}, opened)
			require.Equal(t, 32, media[2].Width)
			require.Equal(t, 17, media[2].Height)
			require.Equal(t, 1080, media[0].Width)
			require.Equal(t, 1350, media[count-1].Height)
		})
	}
}

func TestBlueskyGalleryPreflightAcceptsJPEGAndPreservesLegacyEmbeds(t *testing.T) {
	var encoded bytes.Buffer
	require.NoError(t, jpeg.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 15, 23)), nil))
	media := blueskyGalleryStoredMedia(5)
	media[4].MimeType = "image/jpeg"
	media[4].FilePath = "photo.jpg"
	media[4].Width, media[4].Height = 0, 0
	err := checkBlueskyGalleryMedia(t.Context(), media, func(_ context.Context, key string) (io.ReadCloser, error) {
		require.Equal(t, "photo.jpg", key)
		return io.NopCloser(bytes.NewReader(encoded.Bytes())), nil
	})
	require.NoError(t, err)
	require.Equal(t, 15, media[4].Width)
	require.Equal(t, 23, media[4].Height)

	for _, count := range []int{1, 4} {
		legacy := blueskyGalleryStoredMedia(count)
		legacy[0].Width, legacy[0].Height = 0, 0
		require.NoError(t, checkBlueskyGalleryMedia(t.Context(), legacy, nil))
	}
	// Galleries with already-valid dimensions do not need to read files again.
	require.NoError(t, checkBlueskyGalleryMedia(t.Context(), blueskyGalleryStoredMedia(5),
		func(context.Context, string) (io.ReadCloser, error) {
			return nil, errors.New("unexpected storage access")
		}))
}

func TestBlueskyGalleryPreflightFailsBeforeUploadOnIncompleteOrUnsupportedMedia(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func([]models.MediaAttachment)
		open   func(context.Context, string) (io.ReadCloser, error)
		want   string
	}{
		{
			name: "GIF in gallery",
			change: func(m []models.MediaAttachment) { m[2].MimeType = "image/gif" },
			want:   "must be JPEG, PNG, or WebP",
		},
		{
			name: "unknown image dimensions with no storage",
			change: func(m []models.MediaAttachment) { m[2].Width, m[2].Height = 0, 0 },
			want:   "no recoverable dimensions",
		},
		{
			name:   "missing image file",
			change: func(m []models.MediaAttachment) { m[2].Width, m[2].Height = 0, 0 },
			open: func(context.Context, string) (io.ReadCloser, error) {
				return nil, errors.New("storage path must not be leaked")
			},
			want: "cannot be inspected",
		},
		{
			name:   "corrupt stored image",
			change: func(m []models.MediaAttachment) { m[2].Width, m[2].Height = 0, 0 },
			open: func(context.Context, string) (io.ReadCloser, error) {
				return io.NopCloser(bytes.NewReader([]byte("not an image"))), nil
			},
			want: "no valid dimensions",
		},
		{
			name: "oversized pixel count",
			change: func(m []models.MediaAttachment) { m[2].Width, m[2].Height = 10_000, 10_000 },
			want:   "supported pixel limit",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			media := blueskyGalleryStoredMedia(5)
			test.change(media)
			err := checkBlueskyGalleryMedia(t.Context(), media, test.open)
			require.ErrorContains(t, err, test.want)
		})
	}
	require.ErrorContains(t,
		checkBlueskyGalleryMedia(t.Context(), blueskyGalleryStoredMedia(11), nil),
		"up to 10 images")
}
