package memes

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/color/palette"
	stddraw "image/draw"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io/fs"
	"math"
	"math/rand"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/disintegration/imaging"
	"golang.org/x/image/colornames"
	xfont "golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/font/sfnt"
	"golang.org/x/image/math/fixed"
	_ "golang.org/x/image/webp"
)

const (
	builtinRenderHeight = 600
	builtinMaxGIFFrames = 20
)

var standaloneIRegexp = regexp.MustCompile(`\bi\b`)

func (p *BuiltinProvider) Render(ctx context.Context, request RenderRequest) (RenderedImage, error) {
	if !p.Available() {
		return RenderedImage{}, ErrDisabled
	}
	template, ok := p.byID[strings.TrimSpace(request.TemplateID)]
	if !ok {
		return RenderedImage{}, ErrNotFound
	}
	if len(request.Text) != len(template.Text) || len(request.OverlayImages) > len(template.Overlay) {
		return RenderedImage{}, ErrInvalidRequest
	}
	for _, line := range request.Text {
		if ValidateCaption(line) != nil {
			return RenderedImage{}, ErrInvalidRequest
		}
	}
	if err := ctx.Err(); err != nil {
		return RenderedImage{}, err
	}

	overlays, err := decodeBuiltinOverlays(request.OverlayImages)
	if err != nil {
		return RenderedImage{}, err
	}
	extension := normalizeBuiltinExtension(request.Extension)
	asset := selectBuiltinAsset(template, request.Styles, extension == "gif")
	data, err := fs.ReadFile(p.files, "catalog/templates/"+template.ID+"/"+asset)
	if err != nil {
		return RenderedImage{}, &ProviderError{Kind: ErrorKindInvalidResponse, Operation: "render", Cause: err}
	}

	var rendered []byte
	var mimeType string
	var renderedExtension string
	if extension == "gif" && strings.HasSuffix(strings.ToLower(asset), ".gif") {
		rendered, err = p.renderBuiltinGIF(ctx, template, data, request.Text, overlays)
		mimeType, renderedExtension = "image/gif", "gif"
	} else {
		background, decodeErr := imaging.Decode(bytes.NewReader(data), imaging.AutoOrientation(true))
		if decodeErr != nil {
			return RenderedImage{}, &ProviderError{Kind: ErrorKindInvalidResponse, Operation: "render", Cause: decodeErr}
		}
		frame, renderErr := p.renderBuiltinFrame(ctx, template, background, request.Text, overlays, 1)
		if renderErr != nil {
			return RenderedImage{}, renderErr
		}
		rendered, mimeType, renderedExtension, err = encodeBuiltinStatic(frame, extension)
	}
	if err != nil {
		return RenderedImage{}, &ProviderError{Kind: ErrorKindInvalidResponse, Operation: "render", Cause: err}
	}
	return RenderedImage{
		Data: rendered, MIMEType: mimeType, Extension: renderedExtension, TemplateID: template.ID,
	}, nil
}

func decodeBuiltinOverlays(values []OverlayImage) ([]image.Image, error) {
	result := make([]image.Image, 0, len(values))
	for _, value := range values {
		if len(value.Data) == 0 {
			return nil, ErrInvalidRequest
		}
		decoded, err := imaging.Decode(bytes.NewReader(value.Data), imaging.AutoOrientation(true))
		if err != nil {
			return nil, ErrInvalidRequest
		}
		result = append(result, decoded)
	}
	return result, nil
}

func normalizeBuiltinExtension(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "jpg", "jpeg":
		return "jpg"
	case "gif":
		return "gif"
	case "webp":
		// The Go image stack decodes WebP but does not ship a maintained encoder.
		// Local previews use PNG and stay fully cacheable in the browser.
		return "png"
	default:
		return "png"
	}
}

func selectBuiltinAsset(template builtinTemplateManifest, requestedStyles []string, animated bool) string {
	if animated && template.AnimatedAsset != "" {
		return template.AnimatedAsset
	}
	for _, requested := range requestedStyles {
		requested = strings.TrimSpace(requested)
		if requested == "" || requested == "default" {
			continue
		}
		for _, asset := range template.Assets {
			extensionIndex := strings.LastIndexByte(asset, '.')
			if extensionIndex > 0 && asset[:extensionIndex] == requested {
				return asset
			}
		}
	}
	return template.DefaultAsset
}

func (p *BuiltinProvider) renderBuiltinFrame(
	ctx context.Context,
	template builtinTemplateManifest,
	background image.Image,
	lines []string,
	overlays []image.Image,
	percent float64,
) (*image.NRGBA, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	frame := imaging.Resize(background, 0, builtinRenderHeight, imaging.Lanczos)
	canvas := imaging.Clone(frame)
	for index, foreground := range overlays {
		if index >= len(template.Overlay) {
			break
		}
		field := template.Overlay[index]
		if !builtinFieldVisible(field.Start, field.Stop, percent) {
			continue
		}
		compositeBuiltinOverlay(canvas, foreground, field)
	}
	for index, field := range template.Text {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		line := ""
		if index < len(lines) && builtinFieldVisible(field.Start, field.Stop, percent) {
			line = styleBuiltinText(lines[index], field.Style)
		}
		if line == "" {
			continue
		}
		if err := p.drawBuiltinCaption(canvas, field, line); err != nil {
			return nil, err
		}
	}
	return canvas, nil
}

func builtinFieldVisible(start, stop, percent float64) bool {
	if percent >= 1 {
		return true
	}
	return start <= percent && (stop == 0 || percent < stop)
}

func compositeBuiltinOverlay(canvas *image.NRGBA, foreground image.Image, field builtinOverlayField) {
	bounds := canvas.Bounds()
	dimension := int(math.Min(float64(bounds.Dx())*field.Scale, float64(bounds.Dy())*field.Scale))
	if dimension < 1 {
		return
	}
	foregroundW := foreground.Bounds().Dx()
	foregroundH := foreground.Bounds().Dy()
	if foregroundW < 1 || foregroundH < 1 {
		return
	}
	scale := math.Min(float64(dimension)/float64(foregroundW), float64(dimension)/float64(foregroundH))
	if scale > 1 {
		scale = 1
	}
	var chip *image.NRGBA
	if scale < 1 {
		newW := int(math.Round(float64(foregroundW) * scale))
		newH := int(math.Round(float64(foregroundH) * scale))
		if newW < 1 {
			newW = 1
		}
		if newH < 1 {
			newH = 1
		}
		chip = imaging.Resize(foreground, newW, newH, imaging.Lanczos)
	} else {
		chip = imaging.Clone(foreground)
	}
	if field.Angle != 0 {
		chip = imaging.Rotate(chip, field.Angle, color.NRGBA{})
	}
	x := int(float64(bounds.Dx())*field.CenterX) - chip.Bounds().Dx()/2
	y := int(float64(bounds.Dy())*field.CenterY) - chip.Bounds().Dy()/2
	stddraw.Draw(canvas, image.Rect(x, y, x+chip.Bounds().Dx(), y+chip.Bounds().Dy()), chip, chip.Bounds().Min, stddraw.Over)
}

func (p *BuiltinProvider) drawBuiltinCaption(canvas *image.NRGBA, field builtinTextField, value string) error {
	width := int(float64(canvas.Bounds().Dx()) * field.ScaleX)
	height := int(float64(canvas.Bounds().Dy()) * field.ScaleY)
	if width < 1 || height < 1 {
		return nil
	}
	fontSource := p.builtinFont(field.Font, value)
	maxFontSize := canvas.Bounds().Dy() / 9
	if field.Angle != 0 {
		maxFontSize = canvas.Bounds().Dy() / 4
	}
	layout, err := fitBuiltinCaption(fontSource, value, width, height, maxFontSize)
	if err != nil {
		return err
	}
	layer := image.NewNRGBA(image.Rect(0, 0, width, height))
	fill := parseBuiltinColor(field.Color)
	strokeWidth, strokeFill := builtinStrokeForField(field.Color, fill, layout.size, false)
	isImpact := builtinIsImpactFont(field.Font)
	rows := len(layout.lines)
	yAdjust := builtinYAdjust(rows, isImpact)
	metrics := layout.face.Metrics()
	lineHeight := metrics.Height.Ceil()
	textHeight := lineHeight * rows
	descender := builtinDescenderOffset(layout.lines[rows-1], textHeight)
	// Port upstream get_text_offset: vertical centering uses textHeight/yAdjust and descender.
	effectiveHeight := int(float64(textHeight) / yAdjust)
	baselineTop := (height-effectiveHeight)/2 + metrics.Ascent.Ceil()
	// Row spacing mirrors PIL spacing = -offsetY/(rows*2). OffsetY approximates -(height-effective)/2, so spacing ~ (height-effective)/(rows*4*yAdjust) simplified to small extra.
	offsetY := -(height-effectiveHeight)/2 + descender
	spacing := builtinRowSpacing(offsetY, rows)
	for row, line := range layout.lines {
		lineWidth := xfont.MeasureString(layout.face, line).Ceil()
		x := builtinAlignX(width, lineWidth, field.Align)
		y := baselineTop + descender + row*(lineHeight+spacing)
		for dy := -strokeWidth; dy <= strokeWidth; dy++ {
			for dx := -strokeWidth; dx <= strokeWidth; dx++ {
				if dx*dx+dy*dy > strokeWidth*strokeWidth {
					continue
				}
				drawBuiltinString(layer, layout.face, line, x+dx, y+dy, strokeFill)
			}
		}
		drawBuiltinString(layer, layout.face, line, x, y, fill)
	}
	if field.Angle != 0 {
		layer = imaging.Rotate(layer, field.Angle, color.NRGBA{})
	}
	x := int(float64(canvas.Bounds().Dx()) * field.AnchorX)
	y := int(float64(canvas.Bounds().Dy()) * field.AnchorY)
	stddraw.Draw(canvas, image.Rect(x, y, x+layer.Bounds().Dx(), y+layer.Bounds().Dy()), layer, layer.Bounds().Min, stddraw.Over)
	return nil
}

func builtinIsImpactFont(name string) bool {
	return strings.EqualFold(strings.TrimSpace(name), "impact")
}

func builtinYAdjust(rows int, isImpact bool) float64 {
	if rows >= 3 {
		return 1.1
	}
	if rows == 2 && isImpact {
		return 1.1
	}
	return 1 + float64(3-rows)*0.25
}

func builtinDescenderOffset(lastLine string, textHeight int) int {
	for _, r := range lastLine {
		if r == 'g' || r == 'j' || r == 'p' || r == 'q' || r == 'y' {
			return textHeight / 20
		}
	}
	return 0
}

func builtinRowSpacing(offsetY int, rows int) int {
	if rows <= 0 {
		return 0
	}
	return -offsetY / (rows * 2)
}

func builtinAlignX(width, lineWidth int, align string) int {
	if strings.EqualFold(strings.TrimSpace(align), "left") {
		return max(1, width/70)
	}
	return max(0, (width-lineWidth)/2)
}

func builtinStrokeForField(colorStr string, fill color.NRGBA, fontSize int, thick bool) (int, color.NRGBA) {
	normalized := strings.TrimSpace(strings.ToLower(colorStr))
	baseWidth := min(3, max(1, fontSize/12))
	if normalized == "black" {
		return 1, color.NRGBA{R: 255, G: 255, B: 255, A: 128}
	}
	if strings.HasPrefix(normalized, "#") {
		width := 1
		if thick {
			width = 2
		}
		stroke := color.NRGBA{R: 0, G: 0, B: 0, A: 255}
		if len(normalized) >= 9 {
			hex := strings.TrimPrefix(normalized, "#")
			if len(hex) == 8 {
				var a uint8
				if _, err := fmt.Sscanf(hex[6:8], "%02x", &a); err == nil {
					stroke.A = a
				}
			}
		}
		if width < 1 {
			width = 1
		}
		if width > 3 {
			width = 3
		}
		if baseWidth > width && !thick {
			// keep upstream color but clamp width to computed base when not thick? Upstream keeps width 1 for non-thick hex.
		}
		return width, stroke
	}
	return baseWidth, color.NRGBA{R: 0, G: 0, B: 0, A: 255}
}

func drawBuiltinString(target stddraw.Image, face xfont.Face, value string, x, baseline int, source color.Color) {
	drawer := xfont.Drawer{
		Dst: target, Src: image.NewUniform(source), Face: face,
		Dot: fixed.P(x, baseline),
	}
	drawer.DrawString(value)
}

type builtinCaptionLayout struct {
	face  xfont.Face
	lines []string
	size  int
}

func fitBuiltinCaption(fontSource *sfnt.Font, value string, width, height, maxSize int) (builtinCaptionLayout, error) {
	if maxSize < 7 {
		maxSize = 7
	}
	candidates := builtinLineCandidates(value)
	var best builtinCaptionLayout
	for _, lines := range candidates {
		for size := maxSize; size >= 7; size-- {
			face, err := opentype.NewFace(fontSource, &opentype.FaceOptions{
				Size: float64(size), DPI: 72, Hinting: xfont.HintingFull,
			})
			if err != nil {
				return builtinCaptionLayout{}, err
			}
			maxWidth := 0
			for _, line := range lines {
				maxWidth = max(maxWidth, xfont.MeasureString(face, line).Ceil())
			}
			totalHeight := face.Metrics().Height.Ceil() * len(lines)
			if maxWidth <= width-width/35 && totalHeight <= height-height/10 {
				if size > best.size || (size == best.size && len(lines) < len(best.lines)) {
					best = builtinCaptionLayout{face: face, lines: lines, size: size}
				}
				break
			}
		}
	}
	if best.face == nil {
		face, err := opentype.NewFace(fontSource, &opentype.FaceOptions{Size: 7, DPI: 72})
		if err != nil {
			return builtinCaptionLayout{}, err
		}
		best = builtinCaptionLayout{face: face, lines: []string{value}, size: 7}
	}
	return best, nil
}

func builtinLineCandidates(value string) [][]string {
	manual := strings.Split(value, "\n")
	if len(manual) > 1 {
		return [][]string{manual}
	}
	words := strings.Fields(value)
	if len(words) < 2 {
		return [][]string{{value}}
	}
	result := [][]string{{value}}
	for count := 2; count <= 3 && count <= len(words); count++ {
		result = append(result, balanceBuiltinWords(words, count))
	}
	return result
}

func balanceBuiltinWords(words []string, count int) []string {
	total := 0
	for _, word := range words {
		total += utf8.RuneCountInString(word)
	}
	total += len(words) - 1
	target := float64(total) / float64(count)
	lines := make([]string, 0, count)
	current := make([]string, 0, len(words))
	currentLength := 0
	for index, word := range words {
		wordLength := utf8.RuneCountInString(word)
		remainingWords := len(words) - index
		remainingLines := count - len(lines)
		if len(current) > 0 && float64(currentLength+1+wordLength) > target && remainingWords >= remainingLines {
			lines = append(lines, strings.Join(current, " "))
			current = current[:0]
			currentLength = 0
		}
		current = append(current, word)
		if currentLength > 0 {
			currentLength++
		}
		currentLength += wordLength
	}
	if len(current) > 0 {
		lines = append(lines, strings.Join(current, " "))
	}
	for len(lines) < count {
		lines = append(lines, "")
	}
	return lines
}

func (p *BuiltinProvider) builtinFont(name, value string) *sfnt.Font {
	name = strings.ToLower(strings.TrimSpace(name))
	if containsHebrew(value) {
		if font, ok := p.fonts["he"]; ok && font != nil {
			return font
		}
	}
	switch name {
	case "comic", "kalam":
		return p.fonts["comic"]
	case "impact":
		if font, ok := p.fonts["impact"]; ok && font != nil {
			return font
		}
		return p.fonts["thick"]
	case "thin", "titilliumweb-thin":
		return p.fonts["thin"]
	case "tiny", "segoe", "segoe ui", "segoe ui bold":
		if font, ok := p.fonts["segoe"]; ok && font != nil {
			return font
		}
		return p.fonts["thin"]
	case "tahoma", "tahoma-bold":
		if font, ok := p.fonts["tahoma"]; ok && font != nil {
			return font
		}
		return p.fonts["thick"]
	case "microflf", "microflf-bold":
		if font, ok := p.fonts["microflf"]; ok && font != nil {
			return font
		}
		return p.fonts["thick"]
	case "jp", "hgminchob", "hg-mincho", "notosansjp":
		if font, ok := p.fonts["jp"]; ok && font != nil {
			return font
		}
		return p.fonts["notosans"]
	case "notosans", "notosans-bold", "he":
		return p.fonts["notosans"]
	default:
		return p.fonts["thick"]
	}
}

func containsHebrew(value string) bool {
	for _, current := range value {
		if unicode.Is(unicode.Hebrew, current) {
			return true
		}
	}
	return false
}

func styleBuiltinText(value, style string) string {
	normalized := strings.ToLower(strings.TrimSpace(style))
	switch normalized {
	case "upper":
		return strings.ToUpper(value)
	case "lower":
		return strings.ToLower(value)
	case "capitalize":
		if value == "" {
			return value
		}
		runes := []rune(strings.ToLower(value))
		runes[0] = unicode.ToUpper(runes[0])
		return string(runes)
	case "title":
		return strings.Title(strings.ToLower(value))
	case "mock":
		return mockBuiltinText(value)
	case "none":
		return value
	case "default", "":
		trimmed := strings.TrimSpace(value)
		if trimmed != "" && trimmed == strings.ToLower(trimmed) && trimmed != strings.ToUpper(trimmed) {
			runes := []rune(value)
			for index, r := range runes {
				if unicode.IsLetter(r) {
					runes[index] = unicode.ToUpper(r)
					break
				}
			}
			value = string(runes)
		}
		return standaloneIRegexp.ReplaceAllString(value, "I")
	default:
		if normalized == "lower" {
			return strings.ToLower(value)
		}
		if normalized == "upper" {
			return strings.ToUpper(value)
		}
		return value
	}
}

func mockBuiltinText(value string) string {
	rng := rand.New(rand.NewSource(0))
	out := make([]rune, 0, len([]rune(value)))
	lastWasUpper := true
	swapChance := 0.5
	const diversityBias = 0.75
	for _, current := range value {
		if !unicode.IsLetter(current) {
			out = append(out, current)
			continue
		}
		if rng.Float64() < swapChance {
			lastWasUpper = !lastWasUpper
			swapChance = 0.5
		}
		if lastWasUpper {
			out = append(out, unicode.ToUpper(current))
		} else {
			out = append(out, unicode.ToLower(current))
		}
		swapChance += (1 - swapChance) * diversityBias
	}
	return string(out)
}

func parseBuiltinColor(value string) color.NRGBA {
	value = strings.TrimSpace(strings.ToLower(value))
	if named, ok := colornames.Map[value]; ok {
		return color.NRGBAModel.Convert(named).(color.NRGBA)
	}
	hex := strings.TrimPrefix(value, "#")
	if len(hex) == 6 || len(hex) == 8 {
		decoded := make([]byte, len(hex)/2)
		for index := range decoded {
			var parsed uint8
			if _, err := fmt.Sscanf(hex[index*2:index*2+2], "%02x", &parsed); err != nil {
				return color.NRGBA{R: 255, G: 255, B: 255, A: 255}
			}
			decoded[index] = parsed
		}
		result := color.NRGBA{R: decoded[0], G: decoded[1], B: decoded[2], A: 255}
		if len(decoded) == 4 {
			result.A = decoded[3]
		}
		return result
	}
	return color.NRGBA{R: 255, G: 255, B: 255, A: 255}
}

func encodeBuiltinStatic(frame image.Image, extension string) ([]byte, string, string, error) {
	var output bytes.Buffer
	switch extension {
	case "jpg":
		err := jpeg.Encode(&output, frame, &jpeg.Options{Quality: 94})
		return output.Bytes(), "image/jpeg", "jpg", err
	case "gif":
		err := gif.Encode(&output, frame, &gif.Options{NumColors: 256, Drawer: stddraw.FloydSteinberg})
		return output.Bytes(), "image/gif", "gif", err
	default:
		err := png.Encode(&output, frame)
		return output.Bytes(), "image/png", "png", err
	}
}

func (p *BuiltinProvider) renderBuiltinGIF(
	ctx context.Context,
	template builtinTemplateManifest,
	data []byte,
	lines []string,
	overlays []image.Image,
) ([]byte, error) {
	source, err := gif.DecodeAll(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decode animated meme template: %w", err)
	}
	if len(source.Image) == 0 {
		return nil, fmt.Errorf("animated meme template contains no frames")
	}
	width, height := source.Config.Width, source.Config.Height
	canvas := image.NewNRGBA(image.Rect(0, 0, width, height))
	previousBounds := image.Rectangle{}
	var restore *image.NRGBA
	selected := selectedBuiltinGIFFrames(len(source.Image))
	selectedSet := make(map[int]struct{}, len(selected))
	for _, index := range selected {
		selectedSet[index] = struct{}{}
	}
	result := &gif.GIF{LoopCount: source.LoopCount}
	for index, frame := range source.Image {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if index > 0 && index-1 < len(source.Disposal) {
			switch source.Disposal[index-1] {
			case gif.DisposalBackground:
				stddraw.Draw(canvas, previousBounds, image.Transparent, image.Point{}, stddraw.Src)
			case gif.DisposalPrevious:
				if restore != nil {
					canvas = imaging.Clone(restore)
				}
			}
		}
		if index < len(source.Disposal) && source.Disposal[index] == gif.DisposalPrevious {
			restore = imaging.Clone(canvas)
		}
		stddraw.Draw(canvas, frame.Bounds(), frame, frame.Bounds().Min, stddraw.Over)
		previousBounds = frame.Bounds()
		if _, keep := selectedSet[index]; !keep {
			continue
		}
		percent := 1.0
		if len(source.Image) > 1 {
			percent = float64(index) / float64(len(source.Image))
		}
		rendered, renderErr := p.renderBuiltinFrame(ctx, template, canvas, lines, overlays, percent)
		if renderErr != nil {
			return nil, renderErr
		}
		paletted := image.NewPaletted(rendered.Bounds(), palette.Plan9)
		stddraw.FloydSteinberg.Draw(paletted, rendered.Bounds(), rendered, rendered.Bounds().Min)
		result.Image = append(result.Image, paletted)
		result.Delay = append(result.Delay, builtinGIFDelay(source.Delay, index, selected))
		result.Disposal = append(result.Disposal, gif.DisposalNone)
	}
	var output bytes.Buffer
	if err := gif.EncodeAll(&output, result); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func selectedBuiltinGIFFrames(total int) []int {
	if total <= builtinMaxGIFFrames {
		result := make([]int, total)
		for index := range result {
			result[index] = index
		}
		return result
	}
	result := make([]int, builtinMaxGIFFrames)
	step := float64(total-1) / float64(builtinMaxGIFFrames-1)
	for index := 0; index < builtinMaxGIFFrames; index++ {
		pos := int(math.Round(float64(index) * step))
		if pos < 0 {
			pos = 0
		}
		if pos >= total {
			pos = total - 1
		}
		if index > 0 && pos <= result[index-1] {
			pos = result[index-1] + 1
			if pos >= total {
				pos = total - 1
			}
		}
		result[index] = pos
	}
	result[0] = 0
	result[builtinMaxGIFFrames-1] = total - 1
	return result
}

func builtinGIFDelay(delays []int, current int, selected []int) int {
	next := len(delays)
	for _, index := range selected {
		if index > current {
			next = index
			break
		}
	}
	total := 0
	for index := current; index < next && index < len(delays); index++ {
		total += delays[index]
	}
	return max(1, total)
}
