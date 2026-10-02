package memes

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"io/fs"
	"math"
	"sort"
	"strings"
	"unicode"

	"github.com/disintegration/imaging"
	textrender "github.com/go-text/render"
	textfont "github.com/go-text/typesetting/font"
	"github.com/go-text/typesetting/shaping"
	"golang.org/x/image/math/fixed"
)

func loadBuiltinShapingFonts(files fs.FS) (map[string]*textfont.Font, error) {
	paths := make(map[string]string, len(builtinFontFiles)+2)
	for name, path := range builtinFontFiles {
		paths[name] = path
	}
	paths["arabic"] = "NotoSansArabic.ttf"
	paths["emoji"] = "NotoEmoji.ttf"
	fonts := make(map[string]*textfont.Font, len(paths))
	for name, path := range paths {
		data, err := fs.ReadFile(files, "catalog/fonts/"+path)
		if err != nil {
			return nil, fmt.Errorf("load shaping font %s: %w", name, err)
		}
		faces, err := textfont.ParseTTC(bytes.NewReader(data))
		if err != nil {
			return nil, fmt.Errorf("parse shaping font %s: %w", name, err)
		}
		if len(faces) == 0 {
			return nil, fmt.Errorf("shaping font %s has no faces", name)
		}
		fonts[name] = faces[0].Font
	}
	return fonts, nil
}

func (p *BuiltinProvider) captionNeedsShaping(name, value string) bool {
	preferred := p.builtinFont(name, value)
	for _, r := range value {
		// Preserve established Latin layout, but shape complex scripts and missing glyphs.
		if unicode.Is(unicode.Arabic, r) || unicode.Is(unicode.Hebrew, r) || unicode.Is(unicode.Mn, r) || r == '\u200d' {
			return true
		}
		glyph, err := preferred.GlyphIndex(nil, r)
		if err != nil || glyph == 0 && !unicode.IsSpace(r) {
			return true
		}
	}
	return false
}

type captionFontMap []*textfont.Face

func (fonts captionFontMap) ResolveFace(r rune) *textfont.Face {
	for _, face := range fonts {
		if _, ok := face.NominalGlyph(r); ok {
			return face
		}
	}
	return fonts[0]
}

func (p *BuiltinProvider) captionFaces(name, value string) captionFontMap {
	preferred := p.builtinFont(name, value)
	preferredName := "thick"
	for key, font := range p.fonts {
		if font == preferred {
			preferredName = key
			break
		}
	}
	// Faces cache glyph data and are local to each render, never shared by requests.
	faces := captionFontMap{textfont.NewFace(p.shapingFonts[preferredName])}
	for _, key := range []string{"notosans", "arabic", "he", "jp", "emoji"} {
		if key != preferredName {
			faces = append(faces, textfont.NewFace(p.shapingFonts[key]))
		}
	}
	return faces
}

type shapedCaptionLine struct {
	runs                   shaping.Line
	width, ascent, descent int
}

func shapeCaptionLine(value string, faces captionFontMap, size int) shapedCaptionLine {
	if value == "" {
		return shapedCaptionLine{ascent: size}
	}
	text := []rune(value)
	input := shaping.Input{Text: text, RunEnd: len(text), Size: fixed.I(size)}
	var segmenter shaping.Segmenter
	inputs := segmenter.Split(input, faces)
	var shaper shaping.HarfbuzzShaper
	runs := make(shaping.Line, len(inputs))
	for i, input := range inputs {
		runs[i] = shaper.Shape(input)
	}
	var wrapper shaping.LineWrapper
	wrapper.Prepare(shaping.WrapConfig{Direction: runs[0].Direction}, text, shaping.NewSliceIterator(runs))
	wrapped, _ := wrapper.WrapNextLine(math.MaxInt)
	runs = wrapped.Line
	sort.Slice(runs, func(i, j int) bool { return runs[i].VisualIndex < runs[j].VisualIndex })
	line := shapedCaptionLine{runs: runs}
	for _, run := range runs {
		line.width += run.Advance.Ceil()
		line.ascent = max(line.ascent, run.GlyphBounds.Ascent.Ceil())
		line.descent = max(line.descent, -run.GlyphBounds.Descent.Floor())
	}
	return line
}

type shapedCaptionLayout struct {
	lines        []shapedCaptionLine
	size, height int
}

func fitShapedCaption(value string, faces captionFontMap, width, height, maxSize int, colorName string) (shapedCaptionLayout, error) {
	candidates := [][]string{strings.Split(value, "\n")}
	if !strings.Contains(value, "\n") {
		candidates = append(candidates, splitBuiltinCaptionTwo(value), splitBuiltinCaptionThree(value))
	}
	var lines []shapedCaptionLine
	bestSize, totalHeight := 0, 0
	for _, candidate := range candidates {
		for size := max(7, maxSize); size >= 7; size-- {
			shaped := make([]shapedCaptionLine, len(candidate))
			widest, total := 0, 0
			stroke, _ := builtinStrokeForField(colorName, size)
			for i, line := range candidate {
				shaped[i] = shapeCaptionLine(line, faces, size)
				widest = max(widest, shaped[i].width+2*stroke)
				total += shaped[i].ascent + shaped[i].descent + 2*stroke
				if i > 0 {
					total += builtinPILDefaultSpacing
				}
			}
			if widest > width-width/35 || total > height-height/10 {
				continue
			}
			if size > bestSize {
				lines, bestSize, totalHeight = shaped, size, total
			}
			break
		}
	}
	if len(lines) == 0 {
		return shapedCaptionLayout{}, fmt.Errorf("caption does not fit its template slot: %w", ErrInvalidRequest)
	}
	return shapedCaptionLayout{lines: lines, size: bestSize, height: totalHeight}, nil
}

func (p *BuiltinProvider) drawShapedCaption(canvas *image.NRGBA, field builtinTextField, value string) error {
	width := int(float64(canvas.Bounds().Dx()) * field.ScaleX)
	height := int(float64(canvas.Bounds().Dy()) * field.ScaleY)
	if width < 1 || height < 1 {
		return nil
	}
	faces := p.captionFaces(field.Font, value)
	maxSize := canvas.Bounds().Dy() / 9
	if field.Angle != 0 {
		maxSize = canvas.Bounds().Dy() / 4
	}
	layout, err := fitShapedCaption(value, faces, width, height, maxSize, field.Color)
	if err != nil {
		return err
	}
	layer := image.NewNRGBA(image.Rect(0, 0, width, height))
	stroke, strokeColor := builtinStrokeForField(field.Color, layout.size)
	renderer := textrender.Renderer{FontSize: float32(layout.size)}
	y := (height - layout.height) / 2
	for _, line := range layout.lines {
		x := builtinAlignX(width, line.width, field.Align)
		if strings.EqualFold(field.Align, "left") {
			x += stroke
		}
		y += line.ascent + stroke
		drawLine := func(dx, dy int, fill color.Color) {
			renderer.Color = fill
			runX := x + dx
			for _, run := range line.runs {
				runX = renderer.DrawShapedRunAt(run, layer, runX, y+dy)
			}
		}
		for dy := -stroke; dy <= stroke; dy++ {
			for dx := -stroke; dx <= stroke; dx++ {
				if dx*dx+dy*dy <= stroke*stroke {
					drawLine(dx, dy, strokeColor)
				}
			}
		}
		drawLine(0, 0, parseBuiltinColor(field.Color))
		y += line.descent + stroke + builtinPILDefaultSpacing
	}
	if field.Angle != 0 {
		layer = imaging.Rotate(layer, field.Angle, color.NRGBA{})
	}
	x := int(float64(canvas.Bounds().Dx()) * field.AnchorX)
	y = int(float64(canvas.Bounds().Dy()) * field.AnchorY)
	draw.Draw(canvas, image.Rect(x, y, x+layer.Bounds().Dx(), y+layer.Bounds().Dy()), layer, layer.Bounds().Min, draw.Over)
	return nil
}
