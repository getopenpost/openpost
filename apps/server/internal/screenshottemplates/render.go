// Package screenshottemplates validates screenshot template documents and
// rasterizes them on the CPU, matching the web preview at 540 CSS px.
package screenshottemplates

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math"
)

const TemplateWidth = 540
const ExportScale = 2
const MaxRenderHeight = 8192

var (
	ErrOverflow    = errors.New("this content does not fit the selected frame; choose Natural or remove content")
	ErrTooTall     = errors.New("this screenshot is too tall to export")
	ErrUnsupported = errors.New("this template is rendered by the meme renderer")
)

// ImageSource loads a media image referenced by the document (avatars, photos).
type ImageSource func(ctx context.Context, mediaID string) (image.Image, error)

// Region is a selectable content box in CSS px at TemplateWidth.
type Region struct {
	ID     string  `json:"id"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type Rendered struct {
	Image   *image.RGBA
	Regions []Region
}

type palette struct {
	bg, text, muted, panel, bubble color.RGBA
}

var (
	lightPalette = palette{hex(0xffffff), hex(0x111111), hex(0x71717a), hex(0xf4f4f5), hex(0xe9e9eb)}
	darkPalette  = palette{hex(0x000000), hex(0xffffff), hex(0xa1a1aa), hex(0x191919), hex(0x28282a)}
	accentBlue   = hex(0x007aff)
	avatarGrey   = hex(0x969ba6)
	chevronGrey  = hex(0x96969c)
)

func hex(v uint32) color.RGBA { return color.RGBA{uint8(v >> 16), uint8(v >> 8), uint8(v), 255} }

type renderContext struct {
	ctx     context.Context
	scale   float64
	pal     palette
	faces   faceSet
	images  ImageSource
	cache   map[string]image.Image
	ops     []func(*image.RGBA)
	regions []Region
	buf     *image.RGBA
	size    float64 // template font size in CSS px
}

func (rc *renderContext) add(op func(*image.RGBA)) { rc.ops = append(rc.ops, op) }

func (rc *renderContext) region(id string, x, y, w, h float64) {
	rc.regions = append(rc.regions, Region{ID: id, X: x, Y: y, Width: w, Height: h})
}

func (rc *renderContext) style(mono bool, weight float32, size float64, col color.RGBA, lhFactor float64) style {
	return style{fm: rc.faces[fontID{mono: mono, weight: weight}], size: size, color: col, lhFactor: lhFactor}
}

func (rc *renderContext) fillRR(x, y, w, h float64, radii [4]float64, col color.RGBA, alpha float64) {
	shape := rr{x, y, x + w, y + h, radii}.scaled(rc.scale)
	rc.add(func(canvas *image.RGBA) { paintRR(canvas, shape, col, alpha) })
}

func (rc *renderContext) rect(x, y, w, h float64, col color.RGBA) {
	rc.fillRR(x, y, w, h, [4]float64{}, col, 1)
}

func (rc *renderContext) circle(x, y, d float64, col color.RGBA) {
	rc.fillRR(x, y, d, d, [4]float64{d / 2, d / 2, d / 2, d / 2}, col, 1)
}

func (rc *renderContext) picture(img image.Image, x, y, w, h float64, radii [4]float64, fit fitMode) {
	shape := rr{x, y, x + w, y + h, radii}.scaled(rc.scale)
	rc.add(func(canvas *image.RGBA) { paintImage(canvas, img, shape, fit) })
}

func (rc *renderContext) image(id string) (image.Image, error) {
	if img, ok := rc.cache[id]; ok {
		return img, nil
	}
	if rc.images == nil {
		return nil, fmt.Errorf("load image %s: no image source", id)
	}
	img, err := rc.images(rc.ctx, id)
	if err != nil {
		return nil, fmt.Errorf("load image %s: %w", id, err)
	}
	if img == nil || img.Bounds().Empty() {
		return nil, fmt.Errorf("load image %s: empty image", id)
	}
	rc.cache[id] = img
	return img, nil
}

// Render validates doc and rasterizes it at scale (1 or 2).
func Render(ctx context.Context, doc ScreenshotTemplateDocument, images ImageSource, scale float64) (Rendered, error) {
	if scale != 1 && scale != 2 {
		return Rendered{}, errors.New("scale must be 1 or 2")
	}
	if err := Validate(doc); err != nil {
		return Rendered{}, err
	}
	if doc.TemplateID == "meme" {
		return Rendered{}, ErrUnsupported
	}
	faces, err := newFaceSet()
	if err != nil {
		return Rendered{}, err
	}
	rc := &renderContext{ctx: ctx, scale: scale, faces: faces, images: images, cache: map[string]image.Image{}, pal: lightPalette}
	if doc.Appearance == "dark" {
		rc.pal = darkPalette
	}
	rc.size = map[string]float64{"small": 19, "normal": 23, "large": 27}[doc.TextSize]
	var height float64
	switch doc.TemplateID {
	case "messages", "group-chat":
		height, err = rc.layoutChat(doc)
	case "receipt":
		height, err = rc.layoutReceipt(doc.Receipt)
	case "status-page":
		height, err = rc.layoutStatus(doc.StatusPage)
	default:
		err = ErrUnsupported
	}
	if err != nil {
		return Rendered{}, err
	}
	frame := map[string]float64{"natural": 0, "square": 540, "portrait": 675}[doc.Frame]
	if frame > 0 && height > frame+1 {
		return Rendered{}, ErrOverflow
	}
	height = math.Max(height, frame)
	pixels := int(math.Ceil(height*scale - 1e-6))
	if pixels > MaxRenderHeight {
		return Rendered{}, ErrTooTall
	}
	canvas := image.NewRGBA(image.Rect(0, 0, int(TemplateWidth*scale), pixels))
	fill(canvas, rc.pal.bg)
	for _, op := range rc.ops {
		op(canvas)
	}
	if err := ctx.Err(); err != nil {
		return Rendered{}, err
	}
	return Rendered{Image: canvas, Regions: rc.regions}, nil
}

func fill(canvas *image.RGBA, col color.RGBA) {
	row := make([]uint8, canvas.Stride)
	for x := 0; x < canvas.Rect.Dx(); x++ {
		row[x*4], row[x*4+1], row[x*4+2], row[x*4+3] = col.R, col.G, col.B, 255
	}
	for y := 0; y < canvas.Rect.Dy(); y++ {
		copy(canvas.Pix[y*canvas.Stride:], row)
	}
}

// EncodePNG encodes with png.BestSpeed.
func EncodePNG(img image.Image) ([]byte, error) {
	var out bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := encoder.Encode(&out, img); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// EncodeJPEG encodes at quality 88 (previews).
func EncodeJPEG(img image.Image) ([]byte, error) {
	var out bytes.Buffer
	if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: 88}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
