package textcards

import (
	"bytes"
	"fmt"
	"sort"
	"strings"
	"sync"
	"unicode"

	textfont "github.com/go-text/typesetting/font"
	"github.com/go-text/typesetting/shaping"
	fontassets "github.com/openpost/backend/internal/memes/catalog/fonts"
	"golang.org/x/image/math/fixed"
)

const textWidth = 808

var loadFonts = sync.OnceValues(func() ([]*textfont.Font, error) {
	var fonts []*textfont.Font
	for _, name := range []string{"TitilliumWeb-SemiBold.ttf", "NotoSans-Bold.ttf", "NotoSansArabic.ttf", "NotoSansHebrew-Bold.ttf", "HG-Mincho-B.ttc", "NotoEmoji.ttf"} {
		data, err := fontassets.Files.ReadFile(name)
		if err != nil {
			return nil, err
		}
		faces, err := textfont.ParseTTC(bytes.NewReader(data))
		if err != nil || len(faces) == 0 {
			return nil, fmt.Errorf("load text card font %s: %w", name, err)
		}
		fonts = append(fonts, faces[0].Font)
	}
	return fonts, nil
})

type fontMap []*textfont.Face

func (fonts fontMap) ResolveFace(r rune) *textfont.Face {
	for _, face := range fonts {
		if _, ok := face.NominalGlyph(r); ok {
			return face
		}
	}
	return fonts[0]
}

// rebind copies shaped lines onto these faces. Shaping caches live on faces,
// so concurrently drawn pages must not share the faces Layout shaped with.
func (fonts fontMap) rebind(lines []line) []line {
	byFont := make(map[*textfont.Font]*textfont.Face, len(fonts))
	for _, face := range fonts {
		byFont[face.Font] = face
	}
	result := make([]line, len(lines))
	for index, item := range lines {
		result[index] = item
		result[index].runs = append(shaping.Line(nil), item.runs...)
		for run := range result[index].runs {
			if face, ok := byFont[result[index].runs[run].Face.Font]; ok {
				result[index].runs[run].Face = face
			}
		}
	}
	return result
}

func newFaces() (fontMap, error) {
	fonts, err := loadFonts()
	if err != nil {
		return nil, err
	}
	faces := make(fontMap, len(fonts))
	for i, font := range fonts {
		faces[i] = textfont.NewFace(font)
	}
	return faces, nil
}

type line struct {
	runs  shaping.Line
	width int
	rtl   bool
}

type Page struct {
	lines  []line
	size   int
	Height int
}

// Layout is shared by capability planning and rendering, including pagination.
// The minimum font size is 36 pixels on a 1080 pixel image.
func Layout(body, outputProfile string) ([]Page, error) {
	if err := ValidateText(body); err != nil {
		return nil, err
	}
	faces, err := newFaces()
	if err != nil {
		return nil, err
	}
	height := Height(outputProfile)
	available := height - 460
	var lines []line
	size := 64
	for ; size >= 36; size -= 4 {
		lines = wrapText(strings.TrimSpace(body), faces, size, textWidth)
		if len(lines)*lineHeight(size) <= available {
			break
		}
	}
	if size < 36 {
		size = 36
	}
	perPage := max(1, available/lineHeight(size))
	if len(lines) > perPage*10 {
		return nil, fmt.Errorf("text needs more than 10 images; remove blank lines or shorten this variant")
	}
	pages := make([]Page, 0, (len(lines)+perPage-1)/perPage)
	for len(lines) > 0 {
		count := min(perPage, len(lines))
		pages = append(pages, Page{lines: lines[:count], size: size, Height: height})
		lines = lines[count:]
	}
	if len(pages) == 0 {
		pages = append(pages, Page{size: size, Height: height})
	}
	return pages, nil
}

func lineHeight(size int) int { return size * 14 / 10 }

func wrapText(value string, faces fontMap, size, width int) []line {
	var lines []line
	for _, paragraph := range strings.Split(value, "\n") {
		if paragraph == "" {
			lines = append(lines, line{})
			continue
		}
		text := []rune(paragraph)
		input := shaping.Input{Text: text, RunEnd: len(text), Size: fixed.I(size)}
		var segmenter shaping.Segmenter
		inputs := segmenter.Split(input, faces)
		var shaper shaping.HarfbuzzShaper
		runs := make(shaping.Line, len(inputs))
		for i, input := range inputs {
			runs[i] = shaper.Shape(input)
			normalizeFallbackSpaces(&runs[i], text, faces[0], input.Size)
		}
		var wrapper shaping.LineWrapper
		wrapper.Prepare(shaping.WrapConfig{Direction: runs[0].Direction}, text, shaping.NewSliceIterator(runs))
		for {
			wrapped, done := wrapper.WrapNextLine(width)
			visual := append(shaping.Line(nil), wrapped.Line...)
			sort.SliceStable(visual, func(i, j int) bool { return visual[i].VisualIndex < visual[j].VisualIndex })
			item := line{runs: visual, rtl: bool(runs[0].Direction.Progression())}
			for _, run := range visual {
				item.width += run.Advance.Ceil()
			}
			lines = append(lines, item)
			if done {
				break
			}
		}
	}
	return lines
}

// normalizeFallbackSpaces gives spaces carried into an emoji or CJK fallback
// run the primary font's advance. The segmenter keeps whitespace in the
// current face, and those fonts draw a full-em space that left wide gaps
// after every emoji.
func normalizeFallbackSpaces(run *shaping.Output, text []rune, primary *textfont.Face, size fixed.Int26_6) {
	if run.Face == primary {
		return
	}
	space, ok := primary.NominalGlyph(' ')
	if !ok {
		return
	}
	advance := fixed.Int26_6(primary.HorizontalAdvance(space) * float32(size) / float32(primary.Upem()))
	changed := false
	for index := range run.Glyphs {
		glyph := &run.Glyphs[index]
		if glyph.RuneCount == 1 && glyph.ClusterIndex < len(text) && unicode.Is(unicode.Zs, text[glyph.ClusterIndex]) {
			glyph.Advance = advance
			changed = true
		}
	}
	if changed {
		run.RecomputeAdvance()
	}
}
