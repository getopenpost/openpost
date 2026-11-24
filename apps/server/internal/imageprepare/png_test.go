package imageprepare

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOptimizeLeavesOtherFormatsAndRejectsInvalidData(t *testing.T) {
	data := []byte("GIF89a original animated image")
	got, err := OptimizePNG(context.Background(), data)
	require.NoError(t, err)
	require.Equal(t, data, got)
	_, err = OptimizePNG(context.Background(), append(signature, 1, 2))
	require.Error(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var source bytes.Buffer
	require.NoError(t, png.Encode(&source, image.NewNRGBA(image.Rect(0, 0, 4, 4))))
	_, err = OptimizePNG(ctx, source.Bytes())
	require.ErrorIs(t, err, context.Canceled)
}
