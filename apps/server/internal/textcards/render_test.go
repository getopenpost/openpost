package textcards

import (
	"bytes"
	"image/jpeg"
	"math"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRenderDrawsReadableTextAndKeepsDeterministicBytes(t *testing.T) {
	t.Parallel()
	style, err := Parse(map[string]any{"text_card": "always", "text_card_shadow": false})
	require.NoError(t, err)
	for _, text := range []string{"A new release.", "Olá, café!", "مرحبا بالعالم", "שלום עולם", "日本語の投稿", "Hello 👋 🌍"} {
		t.Run(text, func(t *testing.T) {
			images, err := Render(t.Context(), text, "instagram.feed", style, Identity{Name: "Founder", Handle: "founder"}, nil, 0)
			require.NoError(t, err)
			require.Len(t, images, 1)
			photo, err := jpeg.Decode(bytes.NewReader(images[0].JPEG))
			require.NoError(t, err)
			// This rectangle contains the body, below the identity and above the footer.
			ink := 0
			for y := 690; y < 770; y++ {
				for x := 136; x < 944; x++ {
					r, g, b, _ := photo.At(x, y).RGBA()
					if r < 16000 && g < 16000 && b < 16000 {
						ink++
					}
				}
			}
			require.Greater(t, ink, 100, "the body must contain visible glyphs")
			again, err := Render(t.Context(), text, "instagram.feed", style, Identity{Name: "Founder", Handle: "founder"}, nil, 0)
			require.NoError(t, err)
			require.Equal(t, images[0].JPEG, again[0].JPEG)
		})
	}
}

func TestAvatarPlaceholderFollowsCardColor(t *testing.T) {
	t.Parallel()
	defaultStyle, err := Parse(map[string]any{"text_card": "always", "text_card_shadow": false})
	require.NoError(t, err)
	redStyle, err := Parse(map[string]any{"text_card": "always", "text_card_shadow": false, "text_card_color": "#ff0000"})
	require.NoError(t, err)
	darkStyle, err := Parse(map[string]any{"text_card": "always", "text_card_shadow": false, "text_card_appearance": "dark"})
	require.NoError(t, err)

	sampleDisc := func(t *testing.T, style Style) [3]int {
		images, err := Render(t.Context(), "Hello", "instagram.feed", style, Identity{Name: "Founder", Handle: "founder"}, nil, 0)
		require.NoError(t, err)
		require.Len(t, images, 1)
		photo, err := jpeg.Decode(bytes.NewReader(images[0].JPEG))
		require.NoError(t, err)
		// Avatar rect is (136, top+54, 214, top+132); a short body makes
		// cardHeight 380 and top (1350-380)/2 = 485, so the centre is (175, 578).
		r, g, b, _ := photo.At(175, 578).RGBA()
		return [3]int{int(r >> 8), int(g >> 8), int(b >> 8)}
	}
	near := func(got [3]int, want ...int) bool {
		const tolerance = 40
		for i := range got {
			diff := got[i] - want[i]
			if diff < 0 {
				diff = -diff
			}
			if diff > tolerance {
				return false
			}
		}
		return true
	}

	defaultDisc := sampleDisc(t, defaultStyle)
	require.True(t, near(defaultDisc, 0xc4, 0xb5, 0xfd), "default disc must stay near #c4b5fd, got %v", defaultDisc)
	redDisc := sampleDisc(t, redStyle)
	require.True(t, near(redDisc, 0xff, 0x00, 0x00), "red card disc must follow style.Color, got %v", redDisc)
	darkDisc := sampleDisc(t, darkStyle)
	require.True(t, near(darkDisc, 0xc4, 0xb5, 0xfd), "dark appearance must keep the authored color disc, got %v", darkDisc)
}

func TestAvatarPlaceholderPicksLegibleInitial(t *testing.T) {
	t.Parallel()
	// The placeholder keeps the brand indigo monogram on light discs and
	// switches to white on dark discs; this pins the documented choice.
	light, err := Parse(map[string]any{"text_card": "always"})
	require.NoError(t, err)
	disc, initial := avatarPlaceholderColors(light)
	require.Equal(t, parseColor("#c4b5fd"), disc)
	require.Equal(t, parseColor("#312e81"), initial)

	for _, settings := range []map[string]any{
		{"text_card": "always"},
		{"text_card": "always", "text_card_appearance": "dark"},
		{"text_card": "always", "text_card_color": "#ff0000"},
		{"text_card": "always", "text_card_color": "#ff0000", "text_card_appearance": "dark"},
		{"text_card": "always", "text_card_color": "#1e1e28", "text_card_appearance": "dark"},
	} {
		style, err := Parse(settings)
		require.NoError(t, err)
		disc, initial := avatarPlaceholderColors(style)
		require.GreaterOrEqual(t, contrastRatio(disc, initial), 3.0, "initial must stay legible on the disc for %v", settings)
	}
}

func testLuminance(r, g, b int) float64 {
	lin := func(c int) float64 {
		v := float64(c) / 255
		if v <= 0.03928 {
			return v / 12.92
		}
		return math.Pow((v+0.055)/1.055, 2.4)
	}
	// Independent WCAG relative luminance; deliberately not reusing the
	// renderer helper so the test is not circular.
	return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b)
}

func testContrast(a, b [3]int) float64 {
	la, lb := testLuminance(a[0], a[1], a[2]), testLuminance(b[0], b[1], b[2])
	if la < lb {
		la, lb = lb, la
	}
	return (la + 0.05) / (lb + 0.05)
}

func TestAvatarPlaceholderContrastsAgainstPaperInBothAppearances(t *testing.T) {
	t.Parallel()
	for _, appearance := range []string{"light", "dark"} {
		t.Run(appearance, func(t *testing.T) {
			style, err := Parse(map[string]any{"text_card": "always", "text_card_shadow": false, "text_card_appearance": appearance})
			require.NoError(t, err)
			images, err := Render(t.Context(), "Hello", "instagram.feed", style, Identity{Name: "Founder", Handle: "founder"}, nil, 0)
			require.NoError(t, err)
			require.Len(t, images, 1)
			photo, err := jpeg.Decode(bytes.NewReader(images[0].JPEG))
			require.NoError(t, err)
			at := func(x, y int) [3]int {
				r, g, b, _ := photo.At(x, y).RGBA()
				return [3]int{int(r >> 8), int(g >> 8), int(b >> 8)}
			}
			disc := at(175, 578)
			paper := at(950, 685)
			require.GreaterOrEqual(t, testContrast(disc, paper), 1.5, "disc %v must stay visible against paper %v", disc, paper)
			darkest := [3]int{255, 255, 255}
			darkestL := 2.0
			for y := 560; y < 600; y++ {
				for x := 155; x < 195; x++ {
					px := at(x, y)
					if l := testLuminance(px[0], px[1], px[2]); l < darkestL {
						darkestL, darkest = l, px
					}
				}
			}
			require.GreaterOrEqual(t, testContrast(darkest, disc), 3.0, "initial %v must stay legible on disc %v", darkest, disc)
		})
	}
}

func TestFooterStaysClearOfBodyText(t *testing.T) {
	t.Parallel()
	// A page filled with text used to put the footer arrow inside the descender
	// band of the last line. Measure the rendered gap instead of the constants
	// that produce it, so the layout can change without losing the guarantee.
	style, err := Parse(map[string]any{"text_card": "always", "text_card_shadow": false})
	require.NoError(t, err)
	body := strings.Repeat("Publishing should feel like writing, not filling in a form. ", 12) + "Done."
	images, err := Render(t.Context(), body, "instagram.feed", style, Identity{Name: "Founder", Handle: "founder"}, nil, 1)
	require.NoError(t, err)
	require.NotEmpty(t, images)
	photo, err := jpeg.Decode(bytes.NewReader(images[0].JPEG))
	require.NoError(t, err)

	luminance := func(x, y int) float64 {
		r, g, b, _ := photo.At(x, y).RGBA()
		return testLuminance(int(r>>8), int(g>>8), int(b>>8))
	}

	// The lowest dark pixel is the last line's descender; the muted arrow is
	// lighter than body ink, so it cannot be mistaken for text.
	textBottom := 0
	for y := 0; y < photo.Bounds().Dy(); y++ {
		for x := 136; x < 944; x++ {
			if luminance(x, y) < 0.12 {
				textBottom = y
				break
			}
		}
	}
	require.Greater(t, textBottom, 0, "the body must contain visible text")

	arrowTop := 0
	for y := textBottom + 5; y < photo.Bounds().Dy() && arrowTop == 0; y++ {
		for x := 896; x < 974; x++ {
			r, g, b, _ := photo.At(x, y).RGBA()
			if abs(int(r>>8)-0x6b) < 18 && abs(int(g>>8)-0x72) < 18 && abs(int(b>>8)-0x80) < 18 {
				arrowTop = y
				break
			}
		}
	}
	require.Greater(t, arrowTop, 0, "the card must draw its footer arrow")
	require.GreaterOrEqual(t, arrowTop-textBottom, 15, "footer arrow must not touch the last text line")
}

func abs(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func TestLayoutPaginatesWithoutDroppingTextAndBoundsWork(t *testing.T) {
	t.Parallel()
	body := strings.Repeat("We shipped a smaller, faster editor. ", 55)
	pages, err := Layout(body, "instagram.feed")
	require.NoError(t, err)
	require.Greater(t, len(pages), 1)
	characters := 0
	for _, page := range pages {
		for _, line := range page.lines {
			for _, run := range line.runs {
				characters += run.Runes.Count
			}
		}
	}
	require.Equal(t, len([]rune(strings.TrimSpace(body))), characters)
	_, err = Layout(strings.Repeat("x\n", 1000), "instagram.feed")
	require.ErrorContains(t, err, "more than 10 images")
	_, err = Layout(strings.Repeat("x", MaxCharacters+1), "instagram.feed")
	require.ErrorContains(t, err, "2200")
}

func TestEllipsizeLabelTruncatesClippedIdentity(t *testing.T) {
	t.Parallel()
	faces, err := newFaces()
	require.NoError(t, err)
	longName := "Alexandra Josephine Montgomery Rutherfordington the Third Esquire of the Long Names Society"
	truncated := ellipsizeLabel(longName, faces, 34, 690)
	require.True(t, strings.HasSuffix(truncated, "…"), "clipped name must end in an ellipsis, got %q", truncated)
	lines := wrapText(truncated, faces, 34, 690)
	require.Len(t, lines, 1, "truncated name must fit on one line")
	require.LessOrEqual(t, lines[0].width, 690)
	require.Equal(t, "Founder", ellipsizeLabel("Founder", faces, 34, 690), "short names must stay unchanged")
	longHandle := "@" + strings.Repeat("a", 120)
	truncatedHandle := ellipsizeLabel(longHandle, faces, 27, 690)
	require.True(t, strings.HasSuffix(truncatedHandle, "…"), "clipped handle must end in an ellipsis, got %q", truncatedHandle)
	handleLines := wrapText(truncatedHandle, faces, 27, 690)
	require.Len(t, handleLines, 1, "truncated handle must fit on one line")
	require.LessOrEqual(t, handleLines[0].width, 690)
}

func TestRenderEllipsizesLongIdentity(t *testing.T) {
	t.Parallel()
	style, err := Parse(map[string]any{"text_card": "always", "text_card_shadow": false})
	require.NoError(t, err)
	faces, err := newFaces()
	require.NoError(t, err)
	longName := "Alexandra Josephine Montgomery Rutherfordington the Third Esquire of the Long Names Society"
	clipped, err := Render(t.Context(), "Hello world", "instagram.feed", style, Identity{Name: longName, Handle: "founder"}, nil, 0)
	require.NoError(t, err)
	require.Len(t, clipped, 1)
	explicit, err := Render(t.Context(), "Hello world", "instagram.feed", style, Identity{Name: ellipsizeLabel(longName, faces, 34, 690), Handle: "founder"}, nil, 0)
	require.NoError(t, err)
	require.Len(t, explicit, 1)
	require.Equal(t, explicit[0].JPEG, clipped[0].JPEG, "the renderer must draw the ellipsized identity")
}
