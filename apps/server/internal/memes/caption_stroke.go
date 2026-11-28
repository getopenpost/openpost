package memes

import (
	"image"
	"image/color"
	"image/draw"
)

// captionLine is one caption line rasterized once, in its fill color with
// full alpha, into a buffer positioned at Min on the caption layer.
type captionLine struct {
	glyphs *image.RGBA
	at     image.Point
}

func newCaptionLine(bounds image.Rectangle) captionLine {
	return captionLine{glyphs: image.NewRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy())), at: bounds.Min}
}

// composite paints the stroke through the line's coverage at every integer
// offset within radius, then the line itself. Integer offsets keep sub-pixel
// glyph positions, so this matches drawing the text once per offset while
// rasterizing the glyphs only once.
func (line captionLine) composite(layer *image.RGBA, radius int, stroke, fill color.Color) {
	bounds := line.glyphs.Bounds().Add(line.at)
	coverage := image.NewAlpha(line.glyphs.Bounds())
	for i := 3; i < len(line.glyphs.Pix); i += 4 {
		coverage.Pix[i/4] = line.glyphs.Pix[i]
	}
	if _, _, _, a := stroke.RGBA(); a > 0 && radius > 0 {
		source := image.NewUniform(stroke)
		for dy := -radius; dy <= radius; dy++ {
			for dx := -radius; dx <= radius; dx++ {
				if dx*dx+dy*dy > radius*radius {
					continue
				}
				draw.DrawMask(layer, bounds.Add(image.Pt(dx, dy)), source, image.Point{}, coverage, image.Point{}, draw.Over)
			}
		}
	}
	// The buffer holds opaque fill; a translucent fill scales it uniformly.
	if _, _, _, a := fill.RGBA(); a == 0xffff {
		draw.Draw(layer, bounds, line.glyphs, image.Point{}, draw.Over)
	} else {
		draw.DrawMask(layer, bounds, line.glyphs, image.Point{}, image.NewUniform(color.Alpha16{A: uint16(a)}), image.Point{}, draw.Over)
	}
}

func opaque(c color.Color) color.NRGBA {
	n := color.NRGBAModel.Convert(c).(color.NRGBA)
	n.A = 255
	return n
}
