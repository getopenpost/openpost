package textcards

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"math"
	"runtime"
	"strconv"
	"strings"
	"sync"

	"github.com/disintegration/imaging"
	textrender "github.com/go-text/render"
	"github.com/openpost/backend/internal/imagethumbnail"
	xdraw "golang.org/x/image/draw"
)

type Identity struct {
	Name   string `json:"name"`
	Handle string `json:"handle"`
}

type Image struct {
	JPEG          []byte
	Width, Height int
}

func Render(ctx context.Context, body, outputProfile string, style Style, identity Identity, avatar image.Image, attachments int) ([]Image, error) {
	pages, err := Layout(body, outputProfile)
	if err != nil {
		return nil, err
	}
	// Pages are independent and JPEG encoding is single threaded, so a
	// carousel renders its pages concurrently. Faces are not safe for
	// concurrent use; each page shapes with its own.
	result := make([]Image, len(pages))
	errs := make([]error, len(pages))
	slots := make(chan struct{}, max(1, runtime.GOMAXPROCS(0)))
	var wait sync.WaitGroup
	for index := range pages {
		wait.Add(1)
		slots <- struct{}{}
		go func() {
			defer func() { <-slots; wait.Done() }()
			if err := ctx.Err(); err != nil {
				errs[index] = err
				return
			}
			result[index], errs[index] = renderPage(pages, index, style, identity, avatar, attachments)
		}()
	}
	wait.Wait()
	if err := errors.Join(errs...); err != nil {
		return nil, err
	}
	return result, nil
}

func renderPage(pages []Page, index int, style Style, identity Identity, avatar image.Image, attachments int) (Image, error) {
	faces, err := newFaces()
	if err != nil {
		return Image{}, err
	}
	page := pages[index]
	page.lines = faces.rebind(page.lines)
	// Opaque RGBA keeps golang.org/x/image/vector, image/draw and the JPEG
	// encoder on their RGBA fast paths. NRGBA fell back to per-pixel
	// interface calls and made one card cost most of a second.
	canvas := image.NewRGBA(image.Rect(0, 0, Width, page.Height))
	paintBackground(canvas, style)
	contentHeight := len(page.lines) * lineHeight(page.size)
	// The 276px footer reserve keeps the last text baseline clear of the
	// footer arrow and page counter. 244px left the arrow's head inside the
	// descender band of a full page of text.
	cardHeight := max(380, contentHeight+276)
	top := (page.Height - cardHeight) / 2
	card := image.Rect(80, top, 1000, top+cardHeight)
	radius := 0
	if style.Rounded {
		radius = 32
	}
	ink, muted, paper := parseColor("#18181b"), parseColor("#6b7280"), parseColor("#ffffff")
	if style.Appearance == "dark" {
		ink, muted, paper = parseColor("#f4f4f5"), parseColor("#a1a1aa"), parseColor("#18181b")
	}
	if style.Shadow {
		paintShadow(canvas, card.Add(image.Pt(0, 18)), card, radius, 22, 65)
	}
	paintRounded(canvas, card, radius, paper)
	text := &lineBuffer{}
	paintAvatar(canvas, text, avatar, identity.Name, faces, top, style)
	drawLabel(canvas, text, identity.Name, faces, 34, 238, top+86, 690, ink)
	handle := strings.TrimPrefix(identity.Handle, "@")
	if handle != "" {
		handle = "@" + handle
	}
	drawLabel(canvas, text, handle, faces, 27, 238, top+123, 690, muted)
	y := top + 188 + page.size
	for _, line := range page.lines {
		drawLine(canvas, text, line, 136, y, textWidth, ink)
		y += lineHeight(page.size)
	}
	more := index+1 < len(pages) || attachments > 0
	if more {
		footerY := card.Max.Y - 43
		paintArrow(canvas, 896, footerY-8, muted)
		if len(pages) > 1 {
			drawLabel(canvas, text, fmt.Sprintf("%d / %d", index+1, len(pages)+attachments), faces, 23, 136, footerY, 200, muted)
		}
	}
	var buffer bytes.Buffer
	if err := jpeg.Encode(&buffer, canvas, &jpeg.Options{Quality: 94}); err != nil {
		return Image{}, err
	}
	return Image{JPEG: buffer.Bytes(), Width: Width, Height: page.Height}, nil
}

func drawLabel(canvas *image.RGBA, text *lineBuffer, value string, faces fontMap, size, x, y, width int, ink color.NRGBA) {
	lines := wrapText(ellipsizeLabel(value, faces, size, width), faces, size, width)
	if len(lines) > 0 {
		drawLine(canvas, text, lines[0], x, y, width, ink)
	}
}

const ellipsis = "…"

// ellipsizeLabel collapses value to the longest single-line prefix that fits
// width, suffixed with an ellipsis when the full text was clipped. Values
// that already fit on one line are returned unchanged, so normal identities
// render byte-identical output to before.
func ellipsizeLabel(value string, faces fontMap, size, width int) string {
	lines := wrapText(value, faces, size, width)
	if len(lines) <= 1 && (len(lines) == 0 || lines[0].width <= width) {
		return value
	}
	runes := []rune(strings.ReplaceAll(value, "\n", " "))
	fits := func(n int) bool {
		candidate := strings.TrimRight(string(runes[:n]), " \t") + ellipsis
		candidateLines := wrapText(candidate, faces, size, width)
		return len(candidateLines) == 1 && candidateLines[0].width <= width
	}
	if !fits(0) {
		return ellipsis
	}
	low, high := 0, len(runes)
	for low < high {
		mid := (low + high + 1) / 2
		if fits(mid) {
			low = mid
		} else {
			high = mid - 1
		}
	}
	return strings.TrimRight(string(runes[:low]), " \t") + ellipsis
}

// lineBuffer reuses one small transparent RGBA image for text runs.
// go-text/render sizes its rasterizer to the destination bounds on every run,
// so drawing straight onto the page cleared and scanned the whole page for
// each word. Bitmap glyphs use absolute coordinates, so the buffer always
// starts at the origin instead of being a sub-image of the page.
type lineBuffer struct{ pix []uint8 }

func (b *lineBuffer) image(width, height int) *image.RGBA {
	size := width * height * 4
	if cap(b.pix) < size {
		b.pix = make([]uint8, size)
	}
	pix := b.pix[:size]
	clear(pix)
	return &image.RGBA{Pix: pix, Stride: width * 4, Rect: image.Rect(0, 0, width, height)}
}

func drawLine(canvas *image.RGBA, text *lineBuffer, item line, x, y, width int, ink color.NRGBA) {
	if item.rtl {
		x += width - item.width
	}
	if len(item.runs) == 0 {
		return
	}
	size := 0
	for _, run := range item.runs {
		size = max(size, run.Size.Ceil())
	}
	// A full em above the baseline and half an em below covers accents,
	// descenders and emoji bitmaps in every bundled font.
	pad := size / 2
	bounds := image.Rect(x-pad, y-size-pad, x+item.width+pad, y+size/2+pad).Intersect(canvas.Bounds())
	if bounds.Empty() {
		return
	}
	buffer := text.image(bounds.Dx(), bounds.Dy())
	var renderer textrender.Renderer
	renderer.Color = ink
	local := x - bounds.Min.X
	for _, run := range item.runs {
		renderer.FontSize = float32(run.Size) / 64
		renderer.PixScale = 1
		local = renderer.DrawShapedRunAt(run, buffer, local, y-bounds.Min.Y)
	}
	draw.Draw(canvas, bounds, buffer, image.Point{}, draw.Over)
}

func parseColor(value string) color.NRGBA {
	rgb, _ := strconv.ParseUint(strings.TrimPrefix(value, "#"), 16, 32)
	return color.NRGBA{R: uint8(rgb >> 16), G: uint8(rgb >> 8), B: uint8(rgb), A: 255}
}

func paintBackground(canvas *image.RGBA, style Style) {
	from, to := parseColor(style.Color), parseColor(style.ColorEnd)
	height := canvas.Bounds().Dy()
	// The mesh field sin(5u+3v) and cos(6v-2u) separates into per-column and
	// per-row terms, so the page needs no per-pixel trigonometry.
	var sin5u, cos5u, sin2u, cos2u []float64
	if style.Background == "mesh" {
		sin5u, cos5u, sin2u, cos2u = make([]float64, Width), make([]float64, Width), make([]float64, Width), make([]float64, Width)
		for x := range Width {
			u := float64(x) / Width
			sin5u[x], cos5u[x] = math.Sincos(u * 5)
			sin2u[x], cos2u[x] = math.Sincos(u * 2)
		}
	}
	for y := range height {
		v := float64(y) / float64(height)
		sin3v, cos3v := math.Sincos(v * 3)
		sin6v, cos6v := math.Sincos(v * 6)
		row := canvas.Pix[y*canvas.Stride : y*canvas.Stride+Width*4]
		for x := range Width {
			t := 0.0
			switch style.Background {
			case "gradient":
				t = (float64(x)/Width + v) / 2
			case "mesh":
				wave := sin5u[x]*cos3v + cos5u[x]*sin3v
				ripple := cos6v*cos2u[x] + sin6v*sin2u[x]
				t = min(1, max(0, 0.5+0.3*wave+0.2*ripple))
			}
			pixel := row[x*4 : x*4+4 : x*4+4]
			pixel[0] = uint8(float64(from.R)*(1-t) + float64(to.R)*t)
			pixel[1] = uint8(float64(from.G)*(1-t) + float64(to.G)*t)
			pixel[2] = uint8(float64(from.B)*(1-t) + float64(to.B)*t)
			pixel[3] = 255
		}
	}
}

// paintRounded fills the integer rounded rectangle span by span. A row inside a
// corner band keeps exactly the pixels with dx*dx+dy*dy <= radius*radius.
func paintRounded(canvas *image.RGBA, rect image.Rectangle, radius int, ink color.NRGBA) {
	rect = rect.Intersect(canvas.Bounds())
	if rect.Empty() {
		return
	}
	premultiplied := color.RGBAModel.Convert(ink).(color.RGBA)
	pixel := [4]uint8{premultiplied.R, premultiplied.G, premultiplied.B, premultiplied.A}
	for y := rect.Min.Y; y < rect.Max.Y; y++ {
		dy := max(rect.Min.Y+radius-y, y-(rect.Max.Y-radius-1), 0)
		budget := radius*radius - dy*dy
		if budget < 0 {
			continue
		}
		// reach is the largest horizontal distance into a corner that still
		// satisfies the circle test on this row.
		reach := int(math.Sqrt(float64(budget)))
		for reach*reach > budget {
			reach--
		}
		for (reach+1)*(reach+1) <= budget {
			reach++
		}
		start, end := rect.Min.X+radius-reach, rect.Max.X-radius+reach
		start, end = max(start, rect.Min.X), min(end, rect.Max.X)
		if start >= end {
			continue
		}
		row := canvas.Pix[canvas.PixOffset(start, y):canvas.PixOffset(end, y)]
		if pixel[3] == 255 {
			for i := 0; i < len(row); i += 4 {
				copy(row[i:i+4], pixel[:])
			}
			continue
		}
		alpha := 255 - uint32(pixel[3])
		for i := 0; i < len(row); i += 4 {
			for c := range 4 {
				row[i+c] = pixel[c] + uint8(uint32(row[i+c])*alpha/255)
			}
		}
	}
}

// paintShadow blurs a quarter-resolution mask of the card and scales it up
// only where the opaque card will not cover it. A soft 22 px shadow carries
// no detail that a full-resolution Gaussian kept, and blurring the whole page
// cost hundreds of milliseconds per card.
func paintShadow(canvas *image.RGBA, rect, occluder image.Rectangle, radius int, sigma float64, alpha uint8) {
	const factor = 4
	margin := int(math.Ceil(sigma * 3))
	region := rect.Inset(-margin).Intersect(canvas.Bounds())
	if region.Empty() {
		return
	}
	small := image.NewRGBA(image.Rect(0, 0, (region.Dx()+factor-1)/factor, (region.Dy()+factor-1)/factor))
	local := rect.Sub(region.Min)
	scaled := image.Rect(local.Min.X/factor, local.Min.Y/factor, (local.Max.X+factor-1)/factor, (local.Max.Y+factor-1)/factor)
	paintRounded(small, scaled, radius/factor, color.NRGBA{A: alpha})
	blurred := imaging.Blur(small, sigma/factor)
	// The card's straight-edged interior hides the shadow, so scale only the
	// four bands around it. Its rounded corners stay inside these bands.
	inner := occluder.Inset(radius)
	bands := []image.Rectangle{
		image.Rect(region.Min.X, region.Min.Y, region.Max.X, inner.Min.Y),
		image.Rect(region.Min.X, inner.Max.Y, region.Max.X, region.Max.Y),
		image.Rect(region.Min.X, inner.Min.Y, inner.Min.X, inner.Max.Y),
		image.Rect(inner.Max.X, inner.Min.Y, region.Max.X, inner.Max.Y),
	}
	if inner.Empty() {
		bands = []image.Rectangle{region}
	}
	for _, band := range bands {
		band = band.Intersect(region)
		if band.Empty() {
			continue
		}
		xdraw.ApproxBiLinear.Scale(canvas.SubImage(band).(*image.RGBA), region, blurred, blurred.Bounds(), xdraw.Over, nil)
	}
}

func paintArrow(canvas *image.RGBA, x, y int, ink color.NRGBA) {
	for dx := 0; dx < 34; dx++ {
		for d := -2; d <= 2; d++ {
			canvas.Set(x+dx, y+d, ink)
		}
	}
	for i := 0; i < 14; i++ {
		for d := -2; d <= 2; d++ {
			canvas.Set(x+33-i, y-i+d, ink)
			canvas.Set(x+33-i, y+i+d, ink)
		}
	}
}

func paintAvatar(canvas *image.RGBA, text *lineBuffer, avatar image.Image, name string, faces fontMap, top int, style Style) {
	avatarRect := image.Rect(136, top+54, 214, top+132)
	disc, initialInk := avatarPlaceholderColors(style)
	paintRounded(canvas, avatarRect, 39, disc)
	if avatar != nil {
		photo := imagethumbnail.Square(avatar, 78)
		mask := image.NewAlpha(image.Rect(0, 0, 78, 78))
		for y := 0; y < 78; y++ {
			for x := 0; x < 78; x++ {
				if math.Hypot(float64(x)-38.5, float64(y)-38.5) <= 39 {
					mask.SetAlpha(x, y, color.Alpha{A: 255})
				}
			}
		}
		draw.DrawMask(canvas, avatarRect, photo, image.Point{}, mask, image.Point{}, draw.Over)
	} else {
		letter := "O"
		if runes := []rune(strings.TrimSpace(name)); len(runes) > 0 {
			letter = strings.ToUpper(string(runes[0]))
		}
		drawLabel(canvas, text, letter, faces, 36, 154, top+108, 70, initialInk)
	}
}

// avatarPlaceholderColors owns the text-card avatar placeholder palette.
//
// The disc follows the card's authored text_card_color (falling back to
// DefaultColor when unset) so the monogram reads as part of the card rather
// than a fixed violet patch. The initial keeps the brand indigo #312e81 on
// light discs and switches to white on dark discs, whichever contrasts more
// with the disc. Both candidates contrast against the default gradient in
// either appearance; arbitrary author colors cannot guarantee a ratio, so the
// rule maximizes rather than floors it.
func avatarPlaceholderColors(style Style) (disc, initial color.NRGBA) {
	disc = parseColor(DefaultColor)
	if hexColor.MatchString(style.Color) {
		disc = parseColor(style.Color)
	}
	indigo := parseColor("#312e81")
	light := parseColor("#ffffff")
	initial = indigo
	if contrastRatio(disc, light) > contrastRatio(disc, indigo) {
		initial = light
	}
	return disc, initial
}

func linearChannel(v float64) float64 {
	if v <= 0.03928 {
		return v / 12.92
	}
	return math.Pow((v+0.055)/1.055, 2.4)
}

func relativeLuminance(c color.NRGBA) float64 {
	return 0.2126*linearChannel(float64(c.R)/255) + 0.7152*linearChannel(float64(c.G)/255) + 0.0722*linearChannel(float64(c.B)/255)
}

func contrastRatio(a, b color.NRGBA) float64 {
	la, lb := relativeLuminance(a), relativeLuminance(b)
	if la < lb {
		la, lb = lb, la
	}
	return (la + 0.05) / (lb + 0.05)
}
