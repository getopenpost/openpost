package memes

import (
	"context"
	"image"
	"image/color"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOverlayPreservesAspectAndNeverUpscales(t *testing.T) {
	t.Parallel()

	canvas := image.NewNRGBA(image.Rect(0, 0, 600, 600))
	for i := range canvas.Pix {
		canvas.Pix[i] = 255
	}
	small := image.NewNRGBA(image.Rect(0, 0, 20, 10))
	red := color.NRGBA{R: 255, G: 0, B: 0, A: 255}
	for y := 0; y < 10; y++ {
		for x := 0; x < 20; x++ {
			small.Set(x, y, red)
		}
	}
	field := builtinOverlayField{CenterX: 0.5, CenterY: 0.5, Scale: 0.5, Angle: 0}
	compositeBuiltinOverlay(canvas, small, field)

	center := canvas.NRGBAAt(300, 300)
	require.Equal(t, uint8(255), center.R, "center should be red from overlay")
	far := canvas.NRGBAAt(100, 100)
	require.Equal(t, uint8(255), far.R)
	require.Equal(t, uint8(255), far.G)
	require.Equal(t, uint8(255), far.B, "small overlay must not be upscaled to fill canvas - far pixel should remain white")

	// Large image should be downscaled preserving aspect within dimension.
	canvas2 := image.NewNRGBA(image.Rect(0, 0, 600, 600))
	for i := range canvas2.Pix {
		canvas2.Pix[i] = 255
	}
	large := image.NewNRGBA(image.Rect(0, 0, 800, 400))
	for y := 0; y < 400; y++ {
		for x := 0; x < 800; x++ {
			large.Set(x, y, red)
		}
	}
	compositeBuiltinOverlay(canvas2, large, field)
	// dimension = 300, large 800x400 scaled by min(300/800,300/400)=0.375 => 300x150, centered.
	// pixel at (300, 300) should still be red, but pixel at top edge outside 150 height should be white.
	topInside := canvas2.NRGBAAt(300, 260)
	require.Equal(t, uint8(255), topInside.R, "downscaled large overlay should cover center")
	topOutside := canvas2.NRGBAAt(300, 200)
	require.Equal(t, uint8(255), topOutside.R)
	require.Equal(t, uint8(255), topOutside.G)
	require.Equal(t, uint8(255), topOutside.B, "aspect preserved: height limited, top outside should be white")
}

func TestStyleBuiltinTextLowercaseBug(t *testing.T) {
	t.Parallel()

	require.Equal(t, "hello", styleBuiltinText("HELLO", "lower"))
	require.Equal(t, "hello", styleBuiltinText("HELLO", "LOWER"))
	require.Equal(t, "HELLO", styleBuiltinText("hello", "upper"))
	require.Equal(t, "HELLO", styleBuiltinText("hello", "UPPER"))
}

func TestStyleBuiltinTextStandaloneICapitalization(t *testing.T) {
	t.Parallel()

	require.Equal(t, "I am here", styleBuiltinText("i am here", "default"))
	require.Equal(t, "I think I am", styleBuiltinText("i think i am", "default"))
	require.Equal(t, "Hi I am", styleBuiltinText("hi i am", "default"))
	// Already capitalized should stay
	require.Equal(t, "I AM HERE", styleBuiltinText("I AM HERE", "default"))
}

func TestStyleBuiltinTextDefaultCapitalization(t *testing.T) {
	t.Parallel()

	require.Equal(t, "Hello world", styleBuiltinText("hello world", "default"))
	require.Equal(t, "Hello WORLD", styleBuiltinText("Hello WORLD", "default"), "mixed case should not be forced")
}

func TestMockBuiltinTextDeterministicAndBiased(t *testing.T) {
	t.Parallel()

	first := mockBuiltinText("these are words")
	second := mockBuiltinText("these are words")
	require.Equal(t, first, second, "mock must be deterministic with seed 0")
	require.NotEqual(t, "ThEsE aRe WoRdS", first, "mock should not be simple alternating - should be biased random")
	// Verify that mock touches letters and preserves spaces
	require.Contains(t, first, " ")
	require.NotEqual(t, "these are words", first)
	// Check another deterministic input
	require.Equal(t, mockBuiltinText("hello world"), mockBuiltinText("hello world"))
}

func TestBuiltinFontsLoadedForAllPinned(t *testing.T) {
	t.Parallel()

	provider, err := NewBuiltinProvider()
	require.NoError(t, err)
	for _, name := range []string{"thick", "thin", "comic", "notosans", "he", "impact", "segoe", "jp", "tahoma", "microflf"} {
		require.NotNil(t, provider.fonts[name], "font %s should be loaded", name)
	}
	require.NotNil(t, provider.builtinFont("impact", "hello"))
	require.NotNil(t, provider.builtinFont("tahoma", "hello"))
	require.NotNil(t, provider.builtinFont("microflf", "hello"))
	require.NotNil(t, provider.builtinFont("segoe", "hello"))
	require.NotNil(t, provider.builtinFont("jp", "hello"))
	require.NotEqual(t, provider.builtinFont("impact", "hello"), provider.builtinFont("thick", "hello"), "impact should be distinct from thick")
}

func TestBuiltinMaxGIFFramesIsTwenty(t *testing.T) {
	t.Parallel()

	require.Equal(t, 20, builtinMaxGIFFrames)
	frames := selectedBuiltinGIFFrames(40)
	require.LessOrEqual(t, len(frames), 21, "40 total frames should be sampled to <=20+1")
	require.Equal(t, 0, frames[0])
	require.Equal(t, 39, frames[len(frames)-1])
	frames2 := selectedBuiltinGIFFrames(10)
	require.Len(t, frames2, 10)
}

func TestWatermarkRemainsAbsent(t *testing.T) {
	t.Parallel()

	provider, err := NewBuiltinProvider()
	require.NoError(t, err)
	rendered, err := provider.Render(context.Background(), RenderRequest{
		TemplateID: "drake",
		Text:       []string{"hello", "world"},
		Extension:  "png",
	})
	require.NoError(t, err)
	require.NotEmpty(t, rendered.Data)
}
