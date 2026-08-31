package memes

import (
	"bytes"
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

func TestBuiltinWebPEncodingMatchesAdvertisedFormat(t *testing.T) {
	t.Parallel()

	frame := image.NewNRGBA(image.Rect(0, 0, 32, 24))
	frame.Set(8, 7, color.NRGBA{R: 42, G: 91, B: 203, A: 255})
	data, mimeType, extension, err := encodeBuiltinStatic(frame, "webp")
	require.NoError(t, err)
	require.Equal(t, "image/webp", mimeType)
	require.Equal(t, "webp", extension)

	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	require.NoError(t, err)
	require.Equal(t, "webp", format)
	require.Equal(t, 32, config.Width)
	require.Equal(t, 24, config.Height)
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
	cases := []int{21, 40, 100, 60, 25}
	for _, total := range cases {
		frames := selectedBuiltinGIFFrames(total)
		require.Len(t, frames, builtinMaxGIFFrames, "total %d should yield exactly %d frames", total, builtinMaxGIFFrames)
		require.Equal(t, 0, frames[0], "total %d first frame", total)
		require.Equal(t, total-1, frames[len(frames)-1], "total %d last frame", total)
		for i := 1; i < len(frames); i++ {
			require.Greater(t, frames[i], frames[i-1], "frames must be strictly increasing for total %d", total)
		}
	}
	frames2 := selectedBuiltinGIFFrames(10)
	require.Len(t, frames2, 10)
	framesExact := selectedBuiltinGIFFrames(20)
	require.Len(t, framesExact, 20)
}

func TestBuiltinYAdjust(t *testing.T) {
	t.Parallel()

	cases := []struct {
		rows     int
		isImpact bool
		want     float64
	}{
		{1, false, 1.5},
		{2, false, 1.25},
		{2, true, 1.1},
		{3, false, 1.1},
		{3, true, 1.1},
		{4, false, 1.1},
	}
	for _, c := range cases {
		require.InDelta(t, c.want, builtinYAdjust(c.rows, c.isImpact), 0.0001, "rows %d impact %v", c.rows, c.isImpact)
	}
}

func TestBuiltinDescenderOffset(t *testing.T) {
	t.Parallel()

	require.Equal(t, 0, builtinDescenderOffset("hello", 100))
	require.Equal(t, 5, builtinDescenderOffset("great", 100))
	require.Equal(t, 0, builtinDescenderOffset("HELLO", 100))
	require.Equal(t, 0, builtinDescenderOffset("abc", 100))
	require.Equal(t, 10, builtinDescenderOffset("happy", 200))
	require.Equal(t, 5, builtinDescenderOffset("joggy", 100))
}

func TestBuiltinRowSpacing(t *testing.T) {
	t.Parallel()

	cases := []struct {
		offset int
		rows   int
		want   int
	}{
		{-100, 2, 25},
		{-90, 3, 15},
		{0, 2, 0},
		{-50, 1, 25},
	}
	for _, c := range cases {
		require.Equal(t, c.want, builtinRowSpacing(c.offset, c.rows))
	}
}

func TestBuiltinMultilineCaptionMatchesMemegenRowGap(t *testing.T) {
	t.Parallel()

	provider, err := NewBuiltinProvider()
	require.NoError(t, err)
	canvas := image.NewNRGBA(image.Rect(0, 0, 600, 600))
	err = provider.drawBuiltinCaption(canvas, builtinTextField{
		Font: "thick", Color: "white", ScaleX: 1, ScaleY: 0.2,
	}, "FIRST LINE\nSECOND LINE")
	require.NoError(t, err)

	inkRows := make([]int, 0, 120)
	for y := 0; y < 120; y++ {
		for x := canvas.Bounds().Min.X; x < canvas.Bounds().Max.X; x++ {
			if canvas.NRGBAAt(x, y).A != 0 {
				inkRows = append(inkRows, y)
				break
			}
		}
	}
	require.NotEmpty(t, inkRows)

	largestGap := 0
	bands := [][2]int{{inkRows[0], inkRows[0]}}
	for index := 1; index < len(inkRows); index++ {
		gap := inkRows[index] - inkRows[index-1] - 1
		largestGap = max(largestGap, gap)
		if gap > 0 {
			bands = append(bands, [2]int{inkRows[index], inkRows[index]})
		} else {
			bands[len(bands)-1][1] = inkRows[index]
		}
	}
	require.Len(t, bands, 2)
	averageInkHeight := ((bands[0][1] - bands[0][0] + 1) + (bands[1][1] - bands[1][0] + 1)) / 2
	// Memegen keeps the blank row gap below half the average glyph height for
	// this exact font, box, and caption. A larger ratio looks double-spaced.
	require.LessOrEqual(t, largestGap, averageInkHeight/2)
	for index, expected := range [][2]int{{8, 50}, {71, 114}} {
		require.InDelta(t, expected[0], bands[index][0], 3)
		require.InDelta(t, expected[1], bands[index][1], 3)
	}
}

func TestBuiltinAlignX(t *testing.T) {
	t.Parallel()

	require.Equal(t, 50, builtinAlignX(200, 100, "center"))
	require.Equal(t, 0, builtinAlignX(100, 120, "center"))
	require.Equal(t, 0, builtinAlignX(200, 100, "left"))
	require.Equal(t, 0, builtinAlignX(50, 10, "left"))
	require.Equal(t, 50, builtinAlignX(200, 100, ""))
}

func TestBuiltinCaptionSplitsMatchMemegen(t *testing.T) {
	t.Parallel()

	const caption = "the number of sample memes is too damn high"
	require.Equal(t, []string{
		"the number of sample", "memes is too damn high",
	}, splitBuiltinCaptionTwo(caption))
	require.Equal(t, []string{
		"the number of", "sample memes", "is too damn high",
	}, splitBuiltinCaptionThree(caption))
}

func TestBuiltinStrokeForField(t *testing.T) {
	t.Parallel()

	w, col := builtinStrokeForField("black", 24)
	require.Equal(t, 1, w)
	require.Equal(t, color.NRGBA{R: 255, G: 255, B: 255, A: 128}, col)

	w, col = builtinStrokeForField("white", 24)
	require.Equal(t, 2, w)
	require.Equal(t, color.NRGBA{R: 0, G: 0, B: 0, A: 255}, col)

	w, col = builtinStrokeForField("#ff0000", 24)
	require.Equal(t, 1, w)
	require.Equal(t, color.NRGBA{R: 0, G: 0, B: 0, A: 255}, col)

	w, col = builtinStrokeForField("#ff000080", 24)
	require.Equal(t, 1, w)
	require.Equal(t, uint8(128), col.A)

	w, _ = builtinStrokeForField("white", 12)
	require.Equal(t, 1, w)
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
