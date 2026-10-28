package handlers

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"

	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/stretchr/testify/require"
)

func TestProcessImageKeepsTransparencyInThumbnails(t *testing.T) {
	t.Parallel()

	handler := &MediaHandler{storage: mediastore.NewLocalStorage(t.TempDir(), "/media")}
	source := image.NewNRGBA(image.Rect(0, 0, 64, 64))
	for y := range 64 {
		for x := range 64 {
			source.SetNRGBA(x, y, color.NRGBA{R: 200, G: 40, B: 40, A: 255})
		}
	}
	source.SetNRGBA(0, 0, color.NRGBA{})
	var encoded bytes.Buffer
	require.NoError(t, png.Encode(&encoded, source))

	width, height, thumbnails, err := handler.processImage(context.Background(), encoded.Bytes(), "alpha", "image/png")
	require.NoError(t, err)
	require.Equal(t, 64, width)
	require.Equal(t, 64, height)
	require.Equal(t, "sm_alpha.png", thumbnails.SM)
	require.Equal(t, "md_alpha.png", thumbnails.MD)

	for _, filename := range []string{thumbnails.SM, thumbnails.MD} {
		file, err := handler.storage.Open(context.Background(), filename)
		require.NoError(t, err)
		thumbnail, err := png.Decode(file)
		require.NoError(t, file.Close())
		require.NoError(t, err)
		// Count surviving nonopaque pixels directly instead of asking the
		// production predicate that chose the output format.
		require.Positive(t, countNonOpaquePixels(thumbnail), "%s should keep its alpha channel", filename)
	}
}

// countNonOpaquePixels reports how many pixels retain an alpha value below
// fully opaque, independently of the encoder's format decision.
func countNonOpaquePixels(img image.Image) int {
	bounds := img.Bounds()
	count := 0
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			if _, _, _, alpha := img.At(x, y).RGBA(); alpha < 0xffff {
				count++
			}
		}
	}
	return count
}

func TestProcessImageUsesJPEGThumbnailsForOpaqueImages(t *testing.T) {
	t.Parallel()

	handler := &MediaHandler{storage: mediastore.NewLocalStorage(t.TempDir(), "/media")}
	source := image.NewRGBA(image.Rect(0, 0, 64, 64))
	for y := range 64 {
		for x := range 64 {
			source.SetRGBA(x, y, color.RGBA{R: 40, G: 80, B: 200, A: 255})
		}
	}
	var encoded bytes.Buffer
	require.NoError(t, jpeg.Encode(&encoded, source, nil))

	_, _, thumbnails, err := handler.processImage(context.Background(), encoded.Bytes(), "opaque", "image/jpeg")
	require.NoError(t, err)
	require.Equal(t, "sm_opaque.jpg", thumbnails.SM)
	require.Equal(t, "md_opaque.jpg", thumbnails.MD)

	file, err := handler.storage.Open(context.Background(), thumbnails.SM)
	require.NoError(t, err)
	thumbnail, err := jpeg.Decode(file)
	require.NoError(t, file.Close())
	require.NoError(t, err)
	require.False(t, imageHasTransparency(thumbnail))
}
