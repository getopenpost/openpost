package imageprepare

import (
	"bytes"

	"image"

	"image/png"
	"os"
	"testing"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/stretchr/testify/require"
)

func TestFitNarrowImageRespectsPixelBudget(t *testing.T) {
	var input bytes.Buffer
	require.NoError(t, png.Encode(&input, image.NewNRGBA(image.Rect(0, 0, 10000, 1))))
	prepared, err := Prepare(t.Context(), input.Bytes(), capabilities.MediaConstraint{MaxPixels: 1000})
	require.NoError(t, err)
	config, _, err := image.DecodeConfig(bytes.NewReader(prepared.Content))
	require.NoError(t, err)
	require.LessOrEqual(t, config.Width*config.Height, 1000)
}

func TestMain(m *testing.M) {
	if handled, err := RunWorker(os.Args[1:], os.Stdin, os.Stdout); handled {
		if err != nil {
			os.Exit(1)
		}
		return
	}
	os.Exit(m.Run())
}
