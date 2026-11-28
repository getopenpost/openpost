package screenshottemplates

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"math"
	"sort"
	"strings"
	"sync"
	"unicode"

	textrender "github.com/go-text/render"
	"github.com/go-text/typesetting/di"
	textfont "github.com/go-text/typesetting/font"
	opentype "github.com/go-text/typesetting/font/opentype"
	"github.com/go-text/typesetting/shaping"
	fontassets "github.com/openpost/backend/internal/memes/catalog/fonts"
	"golang.org/x/image/math/fixed"
)

// fontSet holds parsed fonts. Fonts are parsed once per process; faces (which
// carry mutable caches and variation coordinates) are created per render.
type fontSet struct {
	inter, mono, monoBold, arabic, hebrew, emoji, cjk, emojiMono *textfont.Font
}

var loadFonts = sync.OnceValues(func() (*fontSet, error) {
	parse := func(name string) (*textfont.Font, error) {
		data, err := fontassets.Files.ReadFile(name)
		if err != nil {
			return nil, err
		}
		faces, err := textfont.ParseTTC(bytes.NewReader(data))
		if err != nil || len(faces) == 0 {
			return nil, fmt.Errorf("load screenshot font %s: %w", name, err)
		}
		return faces[0].Font, nil
	}
	var set fontSet
	for _, entry := range []struct {
		name string
		dst  **textfont.Font
	}{
		{"Inter.ttf", &set.inter}, {"CourierPrime-Regular.ttf", &set.mono}, {"CourierPrime-Bold.ttf", &set.monoBold},
		{"NotoSansArabic.ttf", &set.arabic}, {"NotoSansHebrew-Bold.ttf", &set.hebrew}, {"NotoColorEmoji.ttf", &set.emoji},
		{"HG-Mincho-B.ttc", &set.cjk}, {"NotoEmoji.ttf", &set.emojiMono},
	} {
		font, err := parse(entry.name)
		if err != nil {
			return nil, err
		}
		*entry.dst = font
	}
	return &set, nil
})

type fontMap []*textfont.Face

func (fonts fontMap) ResolveFace(r rune) *textfont.Face {
	if r >= 0x2600 && r <= 0x27bf || r >= 0x1f000 {
		// Symbols with emoji presentation prefer the color font over text symbols in the UI face.
		if face := fonts.emojiFace(); face != nil {
			if _, ok := face.NominalGlyph(r); ok {
				return face
			}
		}
	}
	for _, face := range fonts {
		if _, ok := face.NominalGlyph(r); ok {
			return face
		}
	}
	return fonts[0]
}

func (fonts fontMap) emojiFace() *textfont.Face {
	if len(fonts) > 3 {
		return fonts[3]
	}
	return nil
}

type fontID struct {
	mono   bool
	weight float32
}

type faceSet map[fontID]fontMap

func newFaceSet() (faceSet, error) {
	fonts, err := loadFonts()
	if err != nil {
		return nil, err
	}
	fallback := func() []*textfont.Face {
		return []*textfont.Face{textfont.NewFace(fonts.arabic), textfont.NewFace(fonts.hebrew), textfont.NewFace(fonts.emoji), textfont.NewFace(fonts.cjk), textfont.NewFace(fonts.emojiMono)}
	}
	set := faceSet{}
	for _, weight := range []float32{300, 400, 600} {
		face := textfont.NewFace(fonts.inter)
		face.SetVariations([]textfont.Variation{{Tag: opentype.MustNewTag("wght"), Value: weight}})
		set[fontID{weight: weight}] = append(fontMap{face}, fallback()...)
	}
	set[fontID{mono: true, weight: 400}] = append(fontMap{textfont.NewFace(fonts.mono)}, fallback()...)
	set[fontID{mono: true, weight: 600}] = append(fontMap{textfont.NewFace(fonts.monoBold)}, fallback()...)
	return set, nil
}

type style struct {
	fm       fontMap
	size     float64 // CSS px
	spacing  float64 // CSS px letter spacing
	color    color.RGBA
	lhFactor float64
}

type span struct {
	text string
	st   style
}

type tline struct {
	runs   shaping.Line
	colors []color.RGBA
	width  float64 // device px
}

type textBlock struct {
	lines []tline
	lh    float64 // CSS px
	base  float64 // CSS px, baseline offset inside a line box
	width float64 // CSS px, widest line
	rtl   bool
	size  float64
}

func (b *textBlock) height() float64 { return float64(len(b.lines)) * b.lh }

type paragraph struct {
	runes  []rune
	runs   shaping.Line
	pieces []piece
}

type piece struct {
	start, end int
	color      color.RGBA
}

// shapedText is shaped once and can be wrapped at several widths.
type shapedText struct {
	rc    *renderContext
	paras []paragraph
	dir   di.Direction
	lh    float64
	base  float64
	size  float64
}

func firstStrongRTL(text string) bool {
	for _, r := range text {
		switch {
		case unicode.In(r, unicode.Arabic, unicode.Hebrew, unicode.Syriac, unicode.Thaana, unicode.Nko):
			return true
		case unicode.IsLetter(r):
			return false
		}
	}
	return false
}

func fixedSize(css, scale float64) fixed.Int26_6 { return fixed.Int26_6(math.Round(css * scale * 64)) }

func (rc *renderContext) shape(spans []span, rtlAuto bool) *shapedText {
	var all strings.Builder
	for _, s := range spans {
		all.WriteString(s.text)
	}
	dir := di.DirectionLTR
	if rtlAuto && firstStrongRTL(all.String()) {
		dir = di.DirectionRTL
	}
	primary := spans[0].st
	out := &shapedText{rc: rc, dir: dir, size: primary.size}
	out.lh = primary.size * primary.lhFactor
	out.base = baseline(primary, out.lh)
	// Split spans into paragraphs on newlines.
	var current paragraph
	var text []rune
	flush := func() {
		current.runes = text
		out.paras = append(out.paras, current)
		current, text = paragraph{}, nil
	}
	for _, s := range spans {
		parts := strings.Split(s.text, "\n")
		for i, part := range parts {
			if i > 0 {
				flush()
			}
			if part == "" {
				continue
			}
			start := len(text)
			text = append(text, []rune(part)...)
			current.pieces = append(current.pieces, piece{start: start, end: len(text), color: s.st.color})
			current.runs = append(current.runs, rc.shapePiece(text, start, len(text), s.st, dir)...)
		}
	}
	flush()
	return out
}

func (rc *renderContext) shapePiece(text []rune, start, end int, st style, dir di.Direction) shaping.Line {
	input := shaping.Input{Text: text, RunStart: start, RunEnd: end, Size: fixedSize(st.size, rc.scale), Direction: dir}
	var segmenter shaping.Segmenter
	var shaper shaping.HarfbuzzShaper
	inputs := segmenter.Split(input, st.fm)
	runs := make(shaping.Line, 0, len(inputs))
	for _, in := range inputs {
		run := shaper.Shape(in)
		if st.spacing != 0 {
			extra := fixedSize(st.spacing, rc.scale)
			for i := range run.Glyphs {
				run.Glyphs[i].Advance += extra
				run.Advance += extra
			}
		}
		runs = append(runs, run)
	}
	return runs
}

func baseline(st style, lh float64) float64 {
	ext, ok := st.fm[0].FontHExtents()
	upem := float64(st.fm[0].Upem())
	if !ok || upem == 0 {
		return lh * 0.8
	}
	asc, desc := float64(ext.Ascender)/upem*st.size, -float64(ext.Descender)/upem*st.size
	return (lh-(asc+desc))/2 + asc
}

func (t *shapedText) wrap(width float64) *textBlock {
	block := &textBlock{lh: t.lh, base: t.base, rtl: t.dir == di.DirectionRTL, size: t.size}
	maxWidth := int(math.Floor(width * t.rc.scale))
	for _, para := range t.paras {
		if len(para.runes) == 0 {
			block.lines = append(block.lines, tline{})
			continue
		}
		var wrapper shaping.LineWrapper
		wrapper.Prepare(shaping.WrapConfig{Direction: t.dir, BreakPolicy: shaping.WhenNecessary}, para.runes, shaping.NewSliceIterator(para.runs))
		for {
			wrapped, done := wrapper.WrapNextLine(maxWidth)
			visual := append(shaping.Line(nil), wrapped.Line...)
			sort.SliceStable(visual, func(i, j int) bool { return visual[i].VisualIndex < visual[j].VisualIndex })
			item := tline{runs: visual}
			for _, run := range visual {
				item.width += float64(run.Advance) / 64
				item.colors = append(item.colors, para.colorAt(run.Runes.Offset))
			}
			block.width = math.Max(block.width, item.width/t.rc.scale)
			block.lines = append(block.lines, item)
			if done {
				break
			}
		}
	}
	return block
}

func (p paragraph) colorAt(offset int) color.RGBA {
	for _, piece := range p.pieces {
		if offset >= piece.start && offset < piece.end {
			return piece.color
		}
	}
	return p.pieces[0].color
}

// maxContent is the CSS width of the widest unwrapped paragraph.
func (t *shapedText) maxContent() float64 {
	return (math.Ceil(t.wrap(1<<20).width*t.rc.scale) + 1) / t.rc.scale
}

func (rc *renderContext) layoutText(spans []span, width float64, rtlAuto bool) *textBlock {
	return rc.shape(spans, rtlAuto).wrap(width)
}

type align int

const (
	alignStart align = iota
	alignCenter
	alignEnd
)

// text paints block with its box at (x, y) of CSS width boxWidth.
func (rc *renderContext) text(block *textBlock, x, y, boxWidth float64, how align) {
	scale := rc.scale
	rc.add(func(canvas *image.RGBA) {
		pad := int(0.5*block.size*scale) + 2
		var renderer textrender.Renderer
		renderer.PixScale = 1
		for i, line := range block.lines {
			if len(line.runs) == 0 {
				continue
			}
			dx := 0.0
			switch {
			case how == alignCenter:
				dx = (boxWidth - line.width/scale) / 2
			case how == alignEnd || (how == alignStart && block.rtl):
				dx = boxWidth - line.width/scale
			}
			baseline := int(math.Round((y + float64(i)*block.lh + block.base) * scale))
			left := int(math.Round((x + dx) * scale))
			ascent := int(math.Ceil(block.base*scale)) + pad
			width := int(math.Ceil(line.width)) + 2*pad
			height := ascent + int(math.Ceil(block.lh*scale)) + pad
			buf := rc.lineBuffer(width, height)
			pen := pad
			for r, run := range line.runs {
				renderer.Color = line.colors[r]
				renderer.FontSize = float32(run.Size) / 64
				pen = renderer.DrawShapedRunAt(run, buf, pen, ascent)
			}
			dst := image.Rect(left-pad, baseline-ascent, left-pad+width, baseline-ascent+height)
			draw.Draw(canvas, dst, buf, image.Point{}, draw.Over)
		}
	})
}

// lineBuffer returns a cleared RGBA image with Min at the origin. Text is
// rasterized there and composited, so scanners stay small and emoji bitmaps
// keep absolute coordinates.
func (rc *renderContext) lineBuffer(width, height int) *image.RGBA {
	if rc.buf == nil || rc.buf.Rect.Dx() < width || rc.buf.Rect.Dy() < height {
		rc.buf = image.NewRGBA(image.Rect(0, 0, max(width, 512), max(height, 128)))
	}
	sub := rc.buf.SubImage(image.Rect(0, 0, width, height)).(*image.RGBA)
	for y := 0; y < height; y++ {
		row := sub.Pix[y*sub.Stride : y*sub.Stride+width*4]
		clear(row)
	}
	return sub
}
