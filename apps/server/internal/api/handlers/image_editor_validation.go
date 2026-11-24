package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/rivo/uniseg"
	"github.com/uptrace/bun"
)

func (h *ImageEditorHandler) validateMediaReferences(
	ctx context.Context,
	workspaceID string,
	pages []ImageEditorPagePayload,
	extraIDs ...string,
) error {
	return validateImageEditorMediaReferences(ctx, h.db, workspaceID, pages, extraIDs...)
}

func validateImageEditorMediaReferences(
	ctx context.Context,
	db bun.IDB,
	workspaceID string,
	pages []ImageEditorPagePayload,
	extraIDs ...string,
) error {
	ids := imageEditorMediaIDs(pages)
	set := make(map[string]struct{}, len(ids)+len(extraIDs))
	for _, id := range ids {
		set[id] = struct{}{}
	}
	for _, id := range extraIDs {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			set[trimmed] = struct{}{}
		}
	}
	ids = ids[:0]
	for id := range set {
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil
	}
	valid, err := allEditorMediaBelongToWorkspace(ctx, db, workspaceID, ids, "")
	if err != nil {
		return huma.Error500InternalServerError("failed to validate OpenPost Image Editor media")
	}
	if !valid {
		return huma.Error400BadRequest("every OpenPost Image Editor media reference must belong to the workspace")
	}
	return nil
}

func resolveImageEditorDimensions(presetKey string, customWidth, customHeight int) (int, int, string, error) {
	key := strings.TrimSpace(presetKey)
	if key == "" {
		key = imageEditorPresets[0].Key
	}
	if key == "custom" {
		if err := validateImageEditorDimensions(customWidth, customHeight); err != nil {
			return 0, 0, "", err
		}
		return customWidth, customHeight, key, nil
	}
	for _, preset := range imageEditorPresets {
		if preset.Key == key {
			return preset.WidthPX, preset.HeightPX, key, nil
		}
	}
	return 0, 0, "", fmt.Errorf("unknown OpenPost Image Editor preset")
}

func validateImageEditorDimensions(width, height int) error {
	if width < imageEditorMinDimension || height < imageEditorMinDimension || width > imageEditorMaxDimension || height > imageEditorMaxDimension {
		return fmt.Errorf("image editor dimensions must be between %d and %d pixels", imageEditorMinDimension, imageEditorMaxDimension)
	}
	if width*height > imageEditorMaxPixels {
		return fmt.Errorf("image editor canvas cannot exceed %d pixels", imageEditorMaxPixels)
	}
	return nil
}

//nolint:gocyclo // Document validation reports precise failures across bounded pages and hierarchy.
func validateImageEditorPayload(payload ImageEditorDocumentPayload) error {
	if payload.SchemaVersion != 1 && payload.SchemaVersion != imageEditorSchemaVersion {
		return fmt.Errorf("unsupported OpenPost Image Editor schema version")
	}
	if strings.TrimSpace(payload.Title) == "" || len([]rune(payload.Title)) > 160 {
		return fmt.Errorf("image editor title must be between 1 and 160 characters")
	}
	if err := validateImageEditorDimensions(payload.WidthPX, payload.HeightPX); err != nil {
		return err
	}
	if len(payload.Pages) == 0 || len(payload.Pages) > imageEditorMaxPages {
		return fmt.Errorf("image editor designs must contain between 1 and %d pages", imageEditorMaxPages)
	}
	if !oneOfImageEditorString(payload.ExportDefaults.Format, "png", "jpeg", "webp", "gif") ||
		!finiteImageEditorNumber(payload.ExportDefaults.Quality) ||
		payload.ExportDefaults.Quality < 0.1 ||
		payload.ExportDefaults.Quality > 1 ||
		(payload.ExportDefaults.MatteColor != "" &&
			!imageEditorHexColor.MatchString(payload.ExportDefaults.MatteColor)) {
		return fmt.Errorf("image editor export defaults are invalid")
	}
	if len(payload.TemplateSlots) > 20 {
		return fmt.Errorf("too many template slots")
	}
	slotNames := map[string]bool{}
	for _, slot := range payload.TemplateSlots {
		found := false
		for _, page := range payload.Pages {
			for _, layer := range page.Layers {
				if layer.ID == slot.TargetID && layer.Text != nil {
					found = true
				}
			}
		}
		if !found || strings.TrimSpace(slot.Name) == "" || len(slot.Name) > 100 || slotNames[slot.Name] || slot.MaxCharacters < 1 || slot.MaxCharacters > 2000 {
			return fmt.Errorf("invalid template text slot")
		}
		slotNames[slot.Name] = true
	}
	encoded, err := json.Marshal(payload)
	if err != nil || len(encoded) > imageEditorMaxDocumentBytes {
		return fmt.Errorf("image editor design exceeds the %d MiB document limit", imageEditorMaxDocumentBytes>>20)
	}
	pageIDs := make(map[string]struct{}, len(payload.Pages))
	layerIDs := make(map[string]struct{})
	for _, page := range payload.Pages {
		if err := validateImageEditorPage(payload, page, pageIDs, layerIDs); err != nil {
			return err
		}
	}
	return nil
}

func validateImageEditorPage(payload ImageEditorDocumentPayload, page ImageEditorPagePayload, pageIDs, layerIDs map[string]struct{}) error {
	if strings.TrimSpace(page.ID) == "" {
		return fmt.Errorf("every OpenPost Image Editor page requires an ID")
	}
	if _, exists := pageIDs[page.ID]; exists {
		return fmt.Errorf("image editor page IDs must be unique")
	}
	pageIDs[page.ID] = struct{}{}
	if (page.WidthPX == nil) != (page.HeightPX == nil) ||
		(payload.SchemaVersion == 1 && page.WidthPX != nil) {
		return fmt.Errorf("image editor page dimensions require schema version %d and both axes", imageEditorSchemaVersion)
	}
	width, height := imageEditorPageDimensions(payload, page)
	if err := validateImageEditorDimensions(width, height); err != nil {
		return err
	}
	if len(page.Layers) > imageEditorMaxLayersPerPage {
		return fmt.Errorf("an OpenPost Image Editor page cannot contain more than %d layers", imageEditorMaxLayersPerPage)
	}
	if err := validateImageEditorPageTextSchema(payload.SchemaVersion, page.Layers); err != nil {
		return err
	}
	if err := validateImageEditorPageBackground(page); err != nil {
		return err
	}
	if err := validateImageEditorPageColorGrade(page); err != nil {
		return err
	}
	if err := validateImageEditorPageGuides(payload, page); err != nil {
		return err
	}

	pageLayerIDs, parents, err := collectImageEditorPageLayers(page, layerIDs)
	if err != nil {
		return err
	}
	return validateImageEditorLayerHierarchy(parents, pageLayerIDs)
}

func validateImageEditorPageTextSchema(schemaVersion int, layers []ImageEditorLayer) error {
	if schemaVersion != 1 {
		return nil
	}
	for _, layer := range layers {
		if layer.Text != nil && len(layer.Text.Runs) > 0 {
			return fmt.Errorf("text emphasis requires image editor schema version 2")
		}
	}
	return nil
}

func imageEditorPageDimensions(document ImageEditorDocumentPayload, page ImageEditorPagePayload) (int, int) {
	if page.WidthPX != nil && page.HeightPX != nil {
		return *page.WidthPX, *page.HeightPX
	}
	return document.WidthPX, document.HeightPX
}

func validateImageEditorPageGuides(payload ImageEditorDocumentPayload, page ImageEditorPagePayload) error {
	if page.Guides != nil {
		if len(page.Guides.Horizontal) > 100 || len(page.Guides.Vertical) > 100 {
			return fmt.Errorf("image editor pages cannot contain more than 100 guides per axis")
		}
		for _, value := range page.Guides.Horizontal {
			_, height := imageEditorPageDimensions(payload, page)
			if !finiteImageEditorNumber(value) || value < 0 || value > float64(height) {
				return fmt.Errorf("image editor horizontal guides must remain inside the page")
			}
		}
		for _, value := range page.Guides.Vertical {
			width, _ := imageEditorPageDimensions(payload, page)
			if !finiteImageEditorNumber(value) || value < 0 || value > float64(width) {
				return fmt.Errorf("image editor vertical guides must remain inside the page")
			}
		}
	}
	return nil
}

func collectImageEditorPageLayers(page ImageEditorPagePayload, layerIDs map[string]struct{}) (map[string]struct{}, map[string]string, error) {
	pageLayerIDs := make(map[string]struct{}, len(page.Layers))
	parents := make(map[string]string, len(page.Layers))
	for _, layer := range page.Layers {
		if strings.TrimSpace(layer.ID) == "" {
			return nil, nil, fmt.Errorf("every OpenPost Image Editor layer requires an ID")
		}
		if _, exists := layerIDs[layer.ID]; exists {
			return nil, nil, fmt.Errorf("image editor layer IDs must be unique across the document")
		}
		layerIDs[layer.ID] = struct{}{}
		pageLayerIDs[layer.ID] = struct{}{}
		parents[layer.ID] = layer.ParentID
		if err := validateImageEditorLayer(layer); err != nil {
			return nil, nil, err
		}
	}
	return pageLayerIDs, parents, nil
}

func validateImageEditorLayerHierarchy(parents map[string]string, pageLayerIDs map[string]struct{}) error {
	for id, parentID := range parents {
		if parentID == "" {
			continue
		}
		if _, exists := pageLayerIDs[parentID]; !exists {
			return fmt.Errorf("image editor layer %s references a missing parent", id)
		}
		seen := map[string]bool{id: true}
		for current := parentID; current != ""; current = parents[current] {
			if seen[current] {
				return fmt.Errorf("image editor layer hierarchy cannot contain cycles")
			}
			seen[current] = true
		}
	}
	return nil
}

func validateImageEditorPageColorGrade(page ImageEditorPagePayload) error {
	if page.ColorGradeVersion != 0 && page.ColorGradeVersion != imageEditorColorGradeVersion {
		return fmt.Errorf("unsupported image editor page color grade version")
	}
	if page.ColorGrade == nil {
		return nil
	}
	if page.ColorGradeVersion != imageEditorColorGradeVersion {
		return fmt.Errorf("image editor page color grades require version %d", imageEditorColorGradeVersion)
	}
	grade := page.ColorGrade
	if err := validateImageEditorColorTools(grade.Wheels, grade.Curves); err != nil {
		return err
	}
	for _, value := range []float64{
		grade.Brightness,
		grade.Contrast,
		grade.Saturation,
		grade.Temperature,
		grade.Tint,
		grade.Vibrance,
		grade.Hue,
		grade.Exposure,
		grade.Highlights,
		grade.Shadows,
	} {
		if !finiteImageEditorNumber(value) || value < -1 || value > 1 {
			return fmt.Errorf("image editor page color grade values must be between -1 and 1")
		}
	}
	return nil
}

func validateImageEditorPageBackground(page ImageEditorPagePayload) error {
	if !imageEditorHexColor.MatchString(page.BackgroundColor) {
		return fmt.Errorf("image editor page backgrounds must use hexadecimal colors")
	}
	if page.Background == nil {
		return nil
	}
	background := page.Background
	if !oneOfImageEditorString(background.Type, "transparent", "solid", "gradient", "image") ||
		!finiteImageEditorNumber(background.Opacity) ||
		background.Opacity < 0 ||
		background.Opacity > 1 {
		return fmt.Errorf("image editor page background is invalid")
	}
	switch background.Type {
	case "transparent":
		return validateTransparentImageEditorBackground(background)
	case "solid":
		return validateSolidImageEditorBackground(background)
	case "gradient":
		return validateGradientImageEditorBackground(background)
	case "image":
		return validateImageImageEditorBackground(background)
	}
	return nil
}

func validateTransparentImageEditorBackground(background *ImageEditorPageBackground) error {
	if background.Gradient != nil || background.Image != nil {
		return fmt.Errorf("transparent OpenPost Image Editor backgrounds cannot include fill properties")
	}
	return nil
}

func validateSolidImageEditorBackground(background *ImageEditorPageBackground) error {
	if !imageEditorHexColor.MatchString(background.Color) ||
		background.Gradient != nil ||
		background.Image != nil {
		return fmt.Errorf("solid OpenPost Image Editor backgrounds are invalid")
	}
	return nil
}

func validateGradientImageEditorBackground(background *ImageEditorPageBackground) error {
	if background.Image != nil {
		return fmt.Errorf("gradient OpenPost Image Editor backgrounds cannot include an image")
	}
	return validateImageEditorGradient(background.Gradient)
}

func validateImageImageEditorBackground(background *ImageEditorPageBackground) error {
	if background.Gradient != nil ||
		background.Image == nil ||
		strings.TrimSpace(background.Image.MediaID) == "" ||
		!oneOfImageEditorString(background.Image.Fit, "cover", "contain", "stretch") {
		return fmt.Errorf("image OpenPost Image Editor backgrounds are invalid")
	}
	return nil
}

//nolint:gocyclo // Layer-specific validation is centralized so every write path enforces identical limits.
func validateImageEditorLayer(layer ImageEditorLayer) error {
	if err := validateImageEditorBaseLayer(layer); err != nil {
		return err
	}
	switch layer.Type {
	case "text":
		return validateImageEditorTextLayer(layer)
	case "image":
		return validateImageEditorImageLayer(layer)
	case "shape":
		return validateImageEditorShapeLayer(layer)
	case "paint":
		return validateImageEditorPaintLayer(layer)
	case "group":
		return validateImageEditorGroupLayer(layer)
	default:
		return fmt.Errorf("unsupported OpenPost Image Editor layer type")
	}
}

func validateImageEditorBaseLayer(layer ImageEditorLayer) error {
	if !finiteImageEditorNumber(layer.Opacity) || layer.Opacity < 0 || layer.Opacity > 1 {
		return fmt.Errorf("image editor layer opacity must be between 0 and 1")
	}
	transformValues := []float64{
		layer.Transform.X,
		layer.Transform.Y,
		layer.Transform.Width,
		layer.Transform.Height,
		layer.Transform.Rotation,
	}
	for _, value := range transformValues {
		if !finiteImageEditorNumber(value) {
			return fmt.Errorf("image editor layer transforms must be finite numbers")
		}
	}
	if layer.Transform.Width < 0 || layer.Transform.Height < 0 {
		return fmt.Errorf("image editor layer dimensions cannot be negative")
	}
	return validateImageEditorLayerOverlays(layer)
}

func validateImageEditorLayerOverlays(layer ImageEditorLayer) error {
	if layer.Mask != nil {
		if !oneOfImageEditorString(layer.Mask.Shape, "rectangle", "rounded_rectangle", "circle", "ellipse", "diamond") ||
			!finiteImageEditorNumber(layer.Mask.Inset) ||
			!finiteImageEditorNumber(layer.Mask.Radius) ||
			layer.Mask.Inset < 0 ||
			layer.Mask.Radius < 0 {
			return fmt.Errorf("image editor layer mask is invalid")
		}
	}
	if layer.EraseMask != nil {
		if layer.Type != "image" && layer.Type != "paint" {
			return fmt.Errorf("only image and paint layers can include erase masks")
		}
		if err := validateImageEditorEraseMask(layer.EraseMask); err != nil {
			return err
		}
	}
	return validateImageEditorLayerEffects(layer)
}

func validateImageEditorLayerEffects(layer ImageEditorLayer) error {
	if layer.Effects == nil {
		return nil
	}
	if !oneOfImageEditorString(layer.Effects.BlendMode, "normal", "multiply", "screen", "overlay", "darken", "lighten", "soft_light") {
		return fmt.Errorf("image editor layer blend mode is invalid")
	}
	if err := validateImageEditorShadowEffect(layer.Effects.DropShadow); err != nil {
		return err
	}
	if err := validateImageEditorShadowEffect(layer.Effects.InnerShadow); err != nil {
		return err
	}
	return validateImageEditorStrokeEffect(layer.Effects.Stroke)
}

func validateImageEditorTextLayer(layer ImageEditorLayer) error {
	if layer.Text == nil || layer.Image != nil || layer.Shape != nil || layer.Paint != nil {
		return fmt.Errorf("text layers require only text properties")
	}
	if !imageEditorTextContentValid(layer.Text) {
		return fmt.Errorf("text layer properties are invalid")
	}
	if !imageEditorHexColor.MatchString(layer.Text.Color) {
		return fmt.Errorf("text colors must use hexadecimal values")
	}
	if !imageEditorTextEffectsValid(layer.Text) {
		return fmt.Errorf("text effects are invalid")
	}
	if !imageEditorTextRunsValid(layer.Text) {
		return fmt.Errorf("text emphasis ranges are invalid")
	}
	if layer.Text.Curve != nil && !imageEditorTextCurveValid(layer.Text.Curve) {
		return fmt.Errorf("text curve is invalid")
	}
	return nil
}

func imageEditorTextRunsValid(text *ImageEditorTextValue) bool {
	if len(text.Runs) > 2000 {
		return false
	}
	length := uniseg.GraphemeClusterCount(text.Text)
	lastEnd := 0
	for _, run := range text.Runs {
		if !imageEditorTextRunValid(run, lastEnd, length) {
			return false
		}
		lastEnd = run.End
	}
	return true
}

func imageEditorTextRunValid(run ImageEditorTextRun, lastEnd, length int) bool {
	if run.Start < lastEnd || run.End <= run.Start || run.End > length {
		return false
	}
	if run.FontWeight == nil && run.FontStyle == nil && run.Underline == nil && run.Color == nil {
		return false
	}
	if run.FontWeight != nil && (*run.FontWeight < 100 || *run.FontWeight > 900) {
		return false
	}
	if run.FontStyle != nil && !oneOfImageEditorString(*run.FontStyle, "normal", "italic") {
		return false
	}
	return run.Color == nil || imageEditorHexColor.MatchString(*run.Color)
}

func imageEditorTextContentValid(text *ImageEditorTextValue) bool {
	return text.FontSize > 0 &&
		finiteImageEditorNumber(text.FontSize) &&
		text.FontWeight >= 100 &&
		text.FontWeight <= 900 &&
		oneOfImageEditorString(text.FontStyle, "normal", "italic") &&
		(text.Wrap == "" || oneOfImageEditorString(text.Wrap, "word", "character")) &&
		oneOfImageEditorString(text.Align, "left", "center", "right", "justify") &&
		text.LineHeight > 0 &&
		finiteImageEditorNumber(text.LineHeight) &&
		finiteImageEditorNumber(text.LetterSpacing) &&
		text.StrokeWidth >= 0 &&
		finiteImageEditorNumber(text.StrokeWidth) &&
		len([]rune(text.Text)) <= 20_000
}

func imageEditorTextEffectsValid(text *ImageEditorTextValue) bool {
	return (text.HighlightColor == "" || imageEditorHexColor.MatchString(text.HighlightColor)) &&
		(text.StrokeColor == "" || imageEditorHexColor.MatchString(text.StrokeColor)) &&
		imageEditorHexColor.MatchString(text.Shadow.Color) &&
		finiteImageEditorNumber(text.Shadow.Blur) &&
		finiteImageEditorNumber(text.Shadow.OffsetX) &&
		finiteImageEditorNumber(text.Shadow.OffsetY) &&
		text.Shadow.Blur >= 0 &&
		text.Shadow.Blur <= 100
}

func imageEditorTextCurveValid(curve *ImageEditorTextCurve) bool {
	return oneOfImageEditorString(curve.Type, "none", "arc_up", "arc_down", "wave", "circle", "ellipse") &&
		finiteImageEditorNumber(curve.Strength) &&
		curve.Strength >= 0.05 &&
		curve.Strength <= 1 &&
		finiteImageEditorNumber(curve.Offset) &&
		curve.Offset >= -1 &&
		curve.Offset <= 1
}

func validateImageEditorImageLayer(layer ImageEditorLayer) error {
	if layer.Image == nil || layer.Text != nil || layer.Shape != nil || layer.Paint != nil || strings.TrimSpace(layer.Image.MediaID) == "" {
		return fmt.Errorf("image layers require only image properties and a media ID")
	}
	crop := layer.Image.Crop
	if !imageEditorCropValid(layer.Image.Fit, crop) {
		return fmt.Errorf("image crop must stay within normalized image bounds")
	}
	adjustments := layer.Image.Adjustments
	if err := validateImageEditorColorTools(adjustments.Wheels, adjustments.Curves); err != nil {
		return err
	}
	if layer.Image.ColorGradeVersion != 0 && layer.Image.ColorGradeVersion != imageEditorColorGradeVersion {
		return fmt.Errorf("unsupported image editor layer color grade version")
	}
	if !imageEditorAdjustmentsValid(adjustments) {
		return fmt.Errorf("image adjustments must be between -1 and 1")
	}
	if !finiteImageEditorNumber(adjustments.Blur) || adjustments.Blur < 0 || adjustments.Blur > 1 {
		return fmt.Errorf("image blur must be between 0 and 1")
	}
	if err := validateImageEditorLensEffect(layer.Image.LensEffect); err != nil {
		return err
	}
	return validateImageEditorAnimation(layer.Image.Animation)
}

func validateImageEditorLensEffect(effect *ImageEditorLensEffect) error {
	if effect == nil {
		return nil
	}
	if !oneOfImageEditorString(effect.Kind, "flare", "starburst", "mist", "prism", "bokeh") || effect.Blades < 3 || effect.Blades > 8 || !finiteImageEditorNumber(effect.Angle) || effect.Angle < -180 || effect.Angle > 180 {
		return fmt.Errorf("invalid lens effect")
	}
	for _, value := range []float64{effect.Amount, effect.Threshold, effect.Size} {
		if !finiteImageEditorNumber(value) || value < 0 || value > 1 {
			return fmt.Errorf("lens effect values must be between zero and one")
		}
	}
	return nil
}

func validateImageEditorAnimation(animation *ImageEditorAnimation) error {
	if animation == nil {
		return nil
	}
	if animation.SourceFrameCount < 1 || animation.SourceFrameCount > 200 || animation.Repeat < -1 || animation.Repeat > 65535 || len(animation.Frames) < 1 || len(animation.Frames) > 200 {
		return fmt.Errorf("invalid GIF animation")
	}
	duration := 0
	for _, frame := range animation.Frames {
		if frame.SourceIndex < 0 || frame.SourceIndex >= animation.SourceFrameCount || frame.DurationMS < 20 || frame.DurationMS > 10000 || frame.DurationMS%10 != 0 {
			return fmt.Errorf("invalid GIF frame or timing")
		}
		duration += frame.DurationMS
	}
	if duration > 60000 {
		return fmt.Errorf("GIF animation exceeds 60 seconds")
	}
	return nil
}

func imageEditorCropValid(fit string, crop ImageEditorCrop) bool {
	return oneOfImageEditorString(fit, "cover", "contain", "stretch") &&
		finiteImageEditorNumber(crop.X) &&
		finiteImageEditorNumber(crop.Y) &&
		finiteImageEditorNumber(crop.Width) &&
		finiteImageEditorNumber(crop.Height) &&
		crop.X >= 0 &&
		crop.Y >= 0 &&
		crop.Width > 0 &&
		crop.Height > 0 &&
		crop.X+crop.Width <= 1.000001 &&
		crop.Y+crop.Height <= 1.000001
}

func imageEditorAdjustmentsValid(adjustments ImageEditorImageAdjustments) bool {
	for _, value := range []float64{
		adjustments.Brightness,
		adjustments.Contrast,
		adjustments.Saturation,
		adjustments.Temperature,
		adjustments.Tint,
		adjustments.Vibrance,
		adjustments.Hue,
		adjustments.Exposure,
		adjustments.Highlights,
		adjustments.Shadows,
	} {
		if !finiteImageEditorNumber(value) || value < -1 || value > 1 {
			return false
		}
	}
	return true
}

func validateImageEditorShapeLayer(layer ImageEditorLayer) error {
	if layer.Shape == nil || layer.Text != nil || layer.Image != nil || layer.Paint != nil {
		return fmt.Errorf("shape layers require only shape properties")
	}
	if !oneOfImageEditorString(layer.Shape.Kind, "rectangle", "rounded_rectangle", "ellipse", "line") ||
		layer.Shape.StrokeWidth < 0 ||
		layer.Shape.Radius < 0 ||
		!finiteImageEditorNumber(layer.Shape.StrokeWidth) ||
		!finiteImageEditorNumber(layer.Shape.Radius) {
		return fmt.Errorf("shape layer properties are invalid")
	}
	if !imageEditorHexColor.MatchString(layer.Shape.Fill) || !imageEditorHexColor.MatchString(layer.Shape.Stroke) {
		return fmt.Errorf("shape colors must use hexadecimal values")
	}
	return nil
}

func validateImageEditorPaintLayer(layer ImageEditorLayer) error {
	if layer.Paint == nil || layer.Text != nil || layer.Image != nil || layer.Shape != nil {
		return fmt.Errorf("paint layers require only paint properties")
	}
	if !paintPropertiesValid(layer.Paint) {
		return fmt.Errorf("paint layer properties are invalid")
	}
	if err := validatePaintGeometry(layer.Paint); err != nil {
		return err
	}
	if layer.Paint.Kind == "gradient" {
		if err := validateImageEditorGradient(layer.Paint.Gradient); err != nil {
			return err
		}
	} else if layer.Paint.Gradient != nil {
		return fmt.Errorf("only gradient paint layers can include gradient properties")
	}
	return nil
}

func paintPropertiesValid(paint *ImageEditorPaintValue) bool {
	return oneOfImageEditorString(paint.Kind, "stroke", "fill", "gradient") &&
		imageEditorHexColor.MatchString(paint.Color) &&
		finiteImageEditorNumber(paint.Size) &&
		paint.Size > 0 &&
		paint.Size <= 512 &&
		finiteImageEditorNumber(paint.Opacity) &&
		paint.Opacity >= 0 &&
		paint.Opacity <= 1 &&
		finiteImageEditorNumber(paint.SourceWidth) &&
		finiteImageEditorNumber(paint.SourceHeight) &&
		paint.SourceWidth > 0 &&
		paint.SourceHeight > 0 &&
		len(paint.Points) <= 100_000 &&
		len(paint.Spans) <= 250_000
}

func validatePaintGeometry(paint *ImageEditorPaintValue) error {
	for _, point := range paint.Points {
		if !finiteImageEditorNumber(point.X) || !finiteImageEditorNumber(point.Y) {
			return fmt.Errorf("paint layer points must be finite")
		}
	}
	for _, span := range paint.Spans {
		if !finiteImageEditorNumber(span.X) ||
			!finiteImageEditorNumber(span.Y) ||
			!finiteImageEditorNumber(span.Width) ||
			span.Width <= 0 {
			return fmt.Errorf("paint layer spans are invalid")
		}
	}
	return nil
}

func validateImageEditorGroupLayer(layer ImageEditorLayer) error {
	if layer.Text != nil || layer.Image != nil || layer.Shape != nil || layer.Paint != nil || layer.Effects != nil || layer.Mask != nil || layer.EraseMask != nil {
		return fmt.Errorf("group layers cannot contain visual properties")
	}
	return nil
}

//nolint:gocyclo // Erase-mask validation keeps all bounded raster limits at the API boundary.
func validateImageEditorEraseMask(mask *ImageEditorEraseMask) error {
	if mask == nil {
		return nil
	}
	if !finiteImageEditorNumber(mask.SourceWidth) ||
		!finiteImageEditorNumber(mask.SourceHeight) ||
		mask.SourceWidth <= 0 ||
		mask.SourceHeight <= 0 ||
		mask.SourceWidth > imageEditorMaxDimension ||
		mask.SourceHeight > imageEditorMaxDimension ||
		len(mask.Strokes) > 10_000 ||
		len(mask.Spans) > 250_000 {
		return fmt.Errorf("image editor erase mask properties are invalid")
	}
	totalPoints := 0
	for _, stroke := range mask.Strokes {
		totalPoints += len(stroke.Points)
		if !finiteImageEditorNumber(stroke.Size) ||
			stroke.Size < 1 ||
			stroke.Size > 512 ||
			totalPoints > 100_000 {
			return fmt.Errorf("image editor erase mask strokes are invalid")
		}
		for _, point := range stroke.Points {
			if !finiteImageEditorNumber(point.X) || !finiteImageEditorNumber(point.Y) {
				return fmt.Errorf("image editor erase mask points must be finite")
			}
		}
	}
	for _, span := range mask.Spans {
		if !finiteImageEditorNumber(span.X) ||
			!finiteImageEditorNumber(span.Y) ||
			!finiteImageEditorNumber(span.Width) ||
			span.Width <= 0 {
			return fmt.Errorf("image editor erase mask spans are invalid")
		}
	}
	return nil
}

func validateImageEditorShadowEffect(effect *ImageEditorShadowEffect) error {
	if effect == nil {
		return nil
	}
	if !imageEditorHexColor.MatchString(effect.Color) ||
		!finiteImageEditorNumber(effect.Opacity) ||
		!finiteImageEditorNumber(effect.Blur) ||
		!finiteImageEditorNumber(effect.Angle) ||
		!finiteImageEditorNumber(effect.Distance) ||
		effect.Opacity < 0 ||
		effect.Opacity > 1 ||
		effect.Blur < 0 ||
		effect.Blur > 100 ||
		effect.Angle < -360 ||
		effect.Angle > 360 ||
		effect.Distance < 0 ||
		effect.Distance > 500 {
		return fmt.Errorf("image editor layer shadow effect is invalid")
	}
	return nil
}

func validateImageEditorStrokeEffect(effect *ImageEditorStrokeEffect) error {
	if effect == nil {
		return nil
	}
	if !imageEditorHexColor.MatchString(effect.Color) ||
		!finiteImageEditorNumber(effect.Opacity) ||
		effect.Opacity < 0 ||
		effect.Opacity > 1 ||
		!finiteImageEditorNumber(effect.Width) ||
		effect.Width <= 0 ||
		effect.Width > 500 ||
		!oneOfImageEditorString(effect.Position, "inside", "center", "outside") {
		return fmt.Errorf("image editor layer stroke effect is invalid")
	}
	return nil
}

func validateImageEditorGradient(gradient *ImageEditorGradientValue) error {
	if gradient == nil ||
		!oneOfImageEditorString(gradient.Type, "linear", "radial", "angle", "reflected", "diamond") ||
		!finiteImageEditorNumber(gradient.Start.X) ||
		!finiteImageEditorNumber(gradient.Start.Y) ||
		!finiteImageEditorNumber(gradient.End.X) ||
		!finiteImageEditorNumber(gradient.End.Y) ||
		len(gradient.Stops) < 2 ||
		len(gradient.Stops) > 32 {
		return fmt.Errorf("image editor gradient is invalid")
	}
	for _, stop := range gradient.Stops {
		if !finiteImageEditorNumber(stop.Offset) ||
			stop.Offset < 0 ||
			stop.Offset > 1 ||
			!imageEditorHexColor.MatchString(stop.Color) {
			return fmt.Errorf("image editor gradient is invalid")
		}
	}
	return nil
}

func finiteImageEditorNumber(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func oneOfImageEditorString(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}
