package screenshottemplates

import (
	"image"
	"image/color"
	"math"

	xdraw "golang.org/x/image/draw"
)

// rr is a rounded rectangle in device pixels with per-corner radii
// (top-left, top-right, bottom-right, bottom-left).
type rr struct {
	x0, y0, x1, y1 float64
	r              [4]float64
}

func (s rr) scaled(k float64) rr {
	return rr{s.x0 * k, s.y0 * k, s.x1 * k, s.y1 * k, [4]float64{s.r[0] * k, s.r[1] * k, s.r[2] * k, s.r[3] * k}}
}

func (s rr) bounds(limit image.Rectangle) image.Rectangle {
	return image.Rect(int(math.Floor(s.x0)), int(math.Floor(s.y0)), int(math.Ceil(s.x1)), int(math.Ceil(s.y1))).Intersect(limit)
}

func clamp01(v float64) float64 { return math.Max(0, math.Min(1, v)) }

// cov is the anti-aliased coverage of the pixel whose top-left is (x, y).
func (s rr) cov(x, y int) float64 {
	px, py := float64(x)+0.5, float64(y)+0.5
	hx, hy := (s.x1-s.x0)/2, (s.y1-s.y0)/2
	cx, cy := s.x0+hx, s.y0+hy
	dx, dy := px-cx, py-cy
	var r float64
	switch {
	case dx < 0 && dy < 0:
		r = s.r[0]
	case dx >= 0 && dy < 0:
		r = s.r[1]
	case dx >= 0:
		r = s.r[2]
	default:
		r = s.r[3]
	}
	qx, qy := math.Abs(dx)-hx+r, math.Abs(dy)-hy+r
	sd := math.Min(math.Max(qx, qy), 0) - r
	if qx > 0 || qy > 0 {
		sd += math.Hypot(math.Max(qx, 0), math.Max(qy, 0))
	}
	return clamp01(0.5 - sd)
}

func blendPixel(pix []uint8, i int, c color.RGBA, a float64) {
	if a >= 0.999 {
		pix[i], pix[i+1], pix[i+2], pix[i+3] = c.R, c.G, c.B, 255
		return
	}
	pix[i] = uint8(float64(pix[i]) + (float64(c.R)-float64(pix[i]))*a + 0.5)
	pix[i+1] = uint8(float64(pix[i+1]) + (float64(c.G)-float64(pix[i+1]))*a + 0.5)
	pix[i+2] = uint8(float64(pix[i+2]) + (float64(c.B)-float64(pix[i+2]))*a + 0.5)
}

func paintShape(canvas *image.RGBA, bounds image.Rectangle, col color.RGBA, alpha float64, cover func(x, y int) float64) {
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		i := canvas.PixOffset(bounds.Min.X, y)
		for x := bounds.Min.X; x < bounds.Max.X; x, i = x+1, i+4 {
			if c := cover(x, y) * alpha; c > 0 {
				blendPixel(canvas.Pix, i, col, c)
			}
		}
	}
}

func paintRR(canvas *image.RGBA, s rr, col color.RGBA, alpha float64) {
	bounds := s.bounds(canvas.Bounds())
	round := math.Max(math.Max(s.r[0], s.r[1]), math.Max(s.r[2], s.r[3]))
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		i := canvas.PixOffset(bounds.Min.X, y)
		py := float64(y) + 0.5
		band := round > 0 && (py < s.y0+round || py > s.y1-round)
		ycov := clamp01(math.Min(float64(y+1), s.y1) - math.Max(float64(y), s.y0))
		for x := bounds.Min.X; x < bounds.Max.X; x, i = x+1, i+4 {
			var c float64
			if band {
				c = s.cov(x, y)
			} else {
				c = clamp01(math.Min(float64(x+1), s.x1)-math.Max(float64(x), s.x0)) * ycov
			}
			if c *= alpha; c > 0 {
				blendPixel(canvas.Pix, i, col, c)
			}
		}
	}
}

// segmentDistance is the distance from (px, py) to the segment a-b.
func segmentDistance(px, py, ax, ay, bx, by float64) float64 {
	dx, dy := bx-ax, by-ay
	t := clamp01(((px-ax)*dx + (py-ay)*dy) / (dx*dx + dy*dy))
	return math.Hypot(px-(ax+t*dx), py-(ay+t*dy))
}

// strokePolyline paints a round-capped polyline (device px).
func strokePolyline(canvas *image.RGBA, points [][2]float64, width float64, col color.RGBA) {
	bounds := image.Rectangle{Min: image.Pt(1<<30, 1<<30), Max: image.Pt(-1<<30, -1<<30)}
	for _, p := range points {
		bounds.Min.X, bounds.Min.Y = min(bounds.Min.X, int(math.Floor(p[0]-width))), min(bounds.Min.Y, int(math.Floor(p[1]-width)))
		bounds.Max.X, bounds.Max.Y = max(bounds.Max.X, int(math.Ceil(p[0]+width))), max(bounds.Max.Y, int(math.Ceil(p[1]+width)))
	}
	paintShape(canvas, bounds.Intersect(canvas.Bounds()), col, 1, func(x, y int) float64 {
		d := math.MaxFloat64
		for i := 0; i+1 < len(points); i++ {
			d = math.Min(d, segmentDistance(float64(x)+0.5, float64(y)+0.5, points[i][0], points[i][1], points[i+1][0], points[i+1][1]))
		}
		return clamp01(width/2 + 0.5 - d)
	})
}

type fitMode int

const (
	fitCover fitMode = iota
	fitContain
)

// paintImage draws img inside the rounded box, clipped by it.
func paintImage(canvas *image.RGBA, img image.Image, box rr, fit fitMode) {
	dr := box.bounds(canvas.Bounds())
	if dr.Empty() {
		return
	}
	full := image.Rect(int(math.Floor(box.x0)), int(math.Floor(box.y0)), int(math.Ceil(box.x1)), int(math.Ceil(box.y1)))
	tmp := image.NewRGBA(image.Rect(0, 0, full.Dx(), full.Dy()))
	src := img.Bounds()
	target := tmp.Bounds()
	sw, sh := float64(src.Dx()), float64(src.Dy())
	tw, th := float64(target.Dx()), float64(target.Dy())
	if sw == 0 || sh == 0 {
		return
	}
	if fit == fitCover {
		if sw/sh > tw/th {
			w := sh * tw / th
			src = image.Rect(src.Min.X+int((sw-w)/2), src.Min.Y, src.Min.X+int((sw+w)/2), src.Max.Y)
		} else {
			h := sw * th / tw
			src = image.Rect(src.Min.X, src.Min.Y+int((sh-h)/2), src.Max.X, src.Min.Y+int((sh+h)/2))
		}
	} else {
		k := math.Min(tw/sw, th/sh)
		w, h := int(math.Round(sw*k)), int(math.Round(sh*k))
		target = image.Rect((target.Dx()-w)/2, (target.Dy()-h)/2, (target.Dx()-w)/2+w, (target.Dy()-h)/2+h)
	}
	xdraw.BiLinear.Scale(tmp, target, img, src, xdraw.Over, nil)
	for y := dr.Min.Y; y < dr.Max.Y; y++ {
		for x := dr.Min.X; x < dr.Max.X; x++ {
			c := box.cov(x, y)
			if c <= 0 {
				continue
			}
			s := tmp.PixOffset(x-full.Min.X, y-full.Min.Y)
			d := canvas.PixOffset(x, y)
			inv := 1 - float64(tmp.Pix[s+3])/255*c
			for k := 0; k < 3; k++ {
				canvas.Pix[d+k] = uint8(float64(canvas.Pix[d+k])*inv + float64(tmp.Pix[s+k])*c + 0.5)
			}
		}
	}
}
