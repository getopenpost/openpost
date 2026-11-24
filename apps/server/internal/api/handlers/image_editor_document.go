package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/uptrace/bun"
)

type ImageEditorTransform struct {
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Width    float64 `json:"width"`
	Height   float64 `json:"height"`
	Rotation float64 `json:"rotation"`
	FlipX    bool    `json:"flip_x"`
	FlipY    bool    `json:"flip_y"`
}

type ImageEditorTextShadow struct {
	Color   string  `json:"color"`
	Blur    float64 `json:"blur"`
	OffsetX float64 `json:"offset_x"`
	OffsetY float64 `json:"offset_y"`
}

type ImageEditorTextCurve struct {
	Type     string  `json:"type" enum:"none,arc_up,arc_down,wave,circle,ellipse"`
	Strength float64 `json:"strength" minimum:"0.05" maximum:"1"`
	Offset   float64 `json:"offset" minimum:"-1" maximum:"1"`
	Reverse  bool    `json:"reverse"`
}

type ImageEditorTextValue struct {
	Text           string                `json:"text"`
	Runs           []ImageEditorTextRun  `json:"runs,omitempty"`
	FontFamily     string                `json:"font_family"`
	FontAssetID    string                `json:"font_asset_id,omitempty"`
	FontWeight     int                   `json:"font_weight"`
	FontStyle      string                `json:"font_style"`
	Underline      bool                  `json:"underline,omitempty"`
	Strike         bool                  `json:"strike,omitempty"`
	Wrap           string                `json:"wrap,omitempty" enum:"word,character"`
	FontSize       float64               `json:"font_size"`
	Color          string                `json:"color"`
	Align          string                `json:"align"`
	LineHeight     float64               `json:"line_height"`
	LetterSpacing  float64               `json:"letter_spacing"`
	HighlightColor string                `json:"highlight_color,omitempty"`
	StrokeColor    string                `json:"stroke_color,omitempty"`
	StrokeWidth    float64               `json:"stroke_width"`
	Shadow         ImageEditorTextShadow `json:"shadow"`
	Curve          *ImageEditorTextCurve `json:"curve,omitempty"`
}

type ImageEditorTextRun struct {
	Start      int     `json:"start"`
	End        int     `json:"end"`
	FontWeight *int    `json:"font_weight,omitempty"`
	FontStyle  *string `json:"font_style,omitempty"`
	Underline  *bool   `json:"underline,omitempty"`
	Color      *string `json:"color,omitempty"`
}

type ImageEditorImageAdjustments struct {
	Wheels      *ImageEditorColorWheels `json:"wheels,omitempty"`
	Curves      *ImageEditorColorCurves `json:"curves,omitempty"`
	Brightness  float64                 `json:"brightness"`
	Contrast    float64                 `json:"contrast"`
	Saturation  float64                 `json:"saturation"`
	Temperature float64                 `json:"temperature"`
	Tint        float64                 `json:"tint"`
	Vibrance    float64                 `json:"vibrance"`
	Hue         float64                 `json:"hue"`
	Exposure    float64                 `json:"exposure"`
	Highlights  float64                 `json:"highlights"`
	Shadows     float64                 `json:"shadows"`
	Blur        float64                 `json:"blur"`
}

type ImageEditorCrop struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type ImageEditorImageValue struct {
	MediaID           string                      `json:"media_id"`
	SourceWidth       int                         `json:"source_width"`
	SourceHeight      int                         `json:"source_height"`
	IntrinsicPending  bool                        `json:"intrinsic_pending,omitempty"`
	Fit               string                      `json:"fit" enum:"cover,contain,stretch"`
	Crop              ImageEditorCrop             `json:"crop"`
	Adjustments       ImageEditorImageAdjustments `json:"adjustments"`
	ColorGradeVersion int                         `json:"color_grade_version,omitempty" enum:"1"`
	LensEffect        *ImageEditorLensEffect      `json:"lens_effect,omitempty"`
	Animation         *ImageEditorAnimation       `json:"animation,omitempty"`
}

type ImageEditorLensEffect struct {
	Kind      string  `json:"kind" enum:"flare,starburst,mist,prism,bokeh"`
	Amount    float64 `json:"amount" minimum:"0" maximum:"1"`
	Threshold float64 `json:"threshold" minimum:"0" maximum:"1"`
	Size      float64 `json:"size" minimum:"0" maximum:"1"`
	Angle     float64 `json:"angle" minimum:"-180" maximum:"180"`
	Blades    int     `json:"blades" minimum:"3" maximum:"8"`
}

type ImageEditorAnimationFrame struct {
	SourceIndex int `json:"source_index" minimum:"0" maximum:"199"`
	DurationMS  int `json:"duration_ms" minimum:"20" maximum:"10000"`
}

type ImageEditorAnimation struct {
	SourceFrameCount int                         `json:"source_frame_count" minimum:"1" maximum:"200"`
	Repeat           int                         `json:"repeat" minimum:"-1" maximum:"65535"`
	Frames           []ImageEditorAnimationFrame `json:"frames" minItems:"1" maxItems:"200"`
}

type ImageEditorShapeValue struct {
	Kind        string  `json:"kind" enum:"rectangle,rounded_rectangle,ellipse,line"`
	Fill        string  `json:"fill"`
	Stroke      string  `json:"stroke"`
	StrokeWidth float64 `json:"stroke_width"`
	Radius      float64 `json:"radius"`
}

type ImageEditorPaintPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type ImageEditorPaintSpan struct {
	Y     float64 `json:"y"`
	X     float64 `json:"x"`
	Width float64 `json:"width"`
}

type ImageEditorEraseStroke struct {
	Size   float64                 `json:"size" minimum:"1" maximum:"512"`
	Points []ImageEditorPaintPoint `json:"points"`
}

type ImageEditorEraseMask struct {
	SourceWidth  float64                  `json:"source_width" minimum:"1"`
	SourceHeight float64                  `json:"source_height" minimum:"1"`
	Strokes      []ImageEditorEraseStroke `json:"strokes"`
	Spans        []ImageEditorPaintSpan   `json:"spans"`
}

type ImageEditorGradientStop struct {
	Offset float64 `json:"offset" minimum:"0" maximum:"1"`
	Color  string  `json:"color"`
}

type ImageEditorGradientValue struct {
	Type    string                    `json:"type" enum:"linear,radial,angle,reflected,diamond"`
	Start   ImageEditorPaintPoint     `json:"start"`
	End     ImageEditorPaintPoint     `json:"end"`
	Stops   []ImageEditorGradientStop `json:"stops"`
	Reverse bool                      `json:"reverse"`
}

type ImageEditorPaintValue struct {
	Kind         string                    `json:"kind" enum:"stroke,fill,gradient"`
	Color        string                    `json:"color"`
	Size         float64                   `json:"size" minimum:"0" maximum:"512"`
	Opacity      float64                   `json:"opacity" minimum:"0" maximum:"1"`
	SourceWidth  float64                   `json:"source_width" minimum:"0"`
	SourceHeight float64                   `json:"source_height" minimum:"0"`
	Points       []ImageEditorPaintPoint   `json:"points"`
	Spans        []ImageEditorPaintSpan    `json:"spans"`
	Gradient     *ImageEditorGradientValue `json:"gradient,omitempty"`
}

type ImageEditorShadowEffect struct {
	Color    string  `json:"color"`
	Opacity  float64 `json:"opacity" minimum:"0" maximum:"1"`
	Blur     float64 `json:"blur" minimum:"0" maximum:"100"`
	Angle    float64 `json:"angle" minimum:"-360" maximum:"360"`
	Distance float64 `json:"distance" minimum:"0" maximum:"500"`
}

type ImageEditorLayerEffects struct {
	BlendMode   string                   `json:"blend_mode" enum:"normal,multiply,screen,overlay,darken,lighten,soft_light"`
	DropShadow  *ImageEditorShadowEffect `json:"drop_shadow,omitempty"`
	InnerShadow *ImageEditorShadowEffect `json:"inner_shadow,omitempty"`
	Stroke      *ImageEditorStrokeEffect `json:"stroke,omitempty"`
}

type ImageEditorStrokeEffect struct {
	Color    string  `json:"color"`
	Opacity  float64 `json:"opacity" minimum:"0" maximum:"1"`
	Width    float64 `json:"width" minimum:"0" maximum:"500"`
	Position string  `json:"position" enum:"inside,center,outside"`
}

type ImageEditorLayerMask struct {
	Shape  string  `json:"shape" enum:"rectangle,rounded_rectangle,circle,ellipse,diamond"`
	Inset  float64 `json:"inset" minimum:"0"`
	Radius float64 `json:"radius" minimum:"0"`
}

type ImageEditorLayer struct {
	ID        string                   `json:"id"`
	Type      string                   `json:"type" enum:"text,image,shape,paint,group"`
	Name      string                   `json:"name"`
	ParentID  string                   `json:"parent_id,omitempty"`
	Visible   bool                     `json:"visible"`
	Locked    bool                     `json:"locked"`
	Opacity   float64                  `json:"opacity"`
	Transform ImageEditorTransform     `json:"transform"`
	Text      *ImageEditorTextValue    `json:"text,omitempty"`
	Image     *ImageEditorImageValue   `json:"image,omitempty"`
	Shape     *ImageEditorShapeValue   `json:"shape,omitempty"`
	Paint     *ImageEditorPaintValue   `json:"paint,omitempty"`
	Effects   *ImageEditorLayerEffects `json:"effects,omitempty"`
	Mask      *ImageEditorLayerMask    `json:"mask,omitempty"`
	EraseMask *ImageEditorEraseMask    `json:"erase_mask,omitempty"`
}

type ImageEditorPageBackgroundImage struct {
	MediaID string `json:"media_id"`
	Fit     string `json:"fit" enum:"cover,contain,stretch"`
}

type ImageEditorPageBackground struct {
	Type     string                          `json:"type" enum:"transparent,solid,gradient,image"`
	Color    string                          `json:"color,omitempty"`
	Opacity  float64                         `json:"opacity" minimum:"0" maximum:"1"`
	Gradient *ImageEditorGradientValue       `json:"gradient,omitempty"`
	Image    *ImageEditorPageBackgroundImage `json:"image,omitempty"`
}

type ImageEditorColorGrade struct {
	Wheels      *ImageEditorColorWheels `json:"wheels,omitempty"`
	Curves      *ImageEditorColorCurves `json:"curves,omitempty"`
	Brightness  float64                 `json:"brightness" minimum:"-1" maximum:"1"`
	Contrast    float64                 `json:"contrast" minimum:"-1" maximum:"1"`
	Saturation  float64                 `json:"saturation" minimum:"-1" maximum:"1"`
	Temperature float64                 `json:"temperature" minimum:"-1" maximum:"1"`
	Tint        float64                 `json:"tint" minimum:"-1" maximum:"1"`
	Vibrance    float64                 `json:"vibrance" minimum:"-1" maximum:"1"`
	Hue         float64                 `json:"hue" minimum:"-1" maximum:"1"`
	Exposure    float64                 `json:"exposure" minimum:"-1" maximum:"1"`
	Highlights  float64                 `json:"highlights" minimum:"-1" maximum:"1"`
	Shadows     float64                 `json:"shadows" minimum:"-1" maximum:"1"`
}

type ImageEditorPagePayload struct {
	ID                  string                     `json:"id"`
	Name                string                     `json:"name"`
	WidthPX             *int                       `json:"width_px,omitempty"`
	HeightPX            *int                       `json:"height_px,omitempty"`
	BackgroundColor     string                     `json:"background_color"`
	Background          *ImageEditorPageBackground `json:"background,omitempty"`
	Guides              *ImageEditorPageGuides     `json:"guides,omitempty"`
	ColorGradeVersion   int                        `json:"color_grade_version,omitempty" enum:"1"`
	ColorGrade          *ImageEditorColorGrade     `json:"color_grade,omitempty"`
	Layers              []ImageEditorLayer         `json:"layers"`
	PreviewMediaID      string                     `json:"preview_media_id,omitempty"`
	LatestExportMediaID string                     `json:"latest_export_media_id,omitempty"`
}

type ImageEditorPageGuides struct {
	Horizontal []float64 `json:"horizontal"`
	Vertical   []float64 `json:"vertical"`
}

type imageEditorStoredPageState struct {
	StorageVersion    int                        `json:"storage_version"`
	WidthPX           *int                       `json:"width_px,omitempty"`
	HeightPX          *int                       `json:"height_px,omitempty"`
	Background        *ImageEditorPageBackground `json:"background"`
	Guides            *ImageEditorPageGuides     `json:"guides,omitempty"`
	ColorGradeVersion int                        `json:"color_grade_version,omitempty"`
	ColorGrade        *ImageEditorColorGrade     `json:"color_grade,omitempty"`
}

func (page ImageEditorPagePayload) BackgroundMediaID() string {
	if page.Background == nil || page.Background.Type != "image" || page.Background.Image == nil {
		return ""
	}
	return strings.TrimSpace(page.Background.Image.MediaID)
}

type ImageEditorExportDefaults struct {
	Format     string  `json:"format" enum:"png,jpeg,webp,gif"`
	Quality    float64 `json:"quality" minimum:"0.1" maximum:"1"`
	MatteColor string  `json:"matte_color"`
}

type ImageEditorTemplateSlot struct {
	Name          string `json:"name" minLength:"1" maxLength:"100"`
	TargetID      string `json:"target_id" minLength:"1"`
	MaxCharacters int    `json:"max_characters" minimum:"1" maximum:"2000"`
}

type ImageEditorDocumentPayload struct {
	TemplateSlots    []ImageEditorTemplateSlot `json:"template_slots,omitempty" maxItems:"20"`
	SchemaVersion    int                       `json:"schema_version"`
	Title            string                    `json:"title"`
	PresetKey        string                    `json:"preset_key"`
	WidthPX          int                       `json:"width_px"`
	HeightPX         int                       `json:"height_px"`
	BrandKitID       string                    `json:"brand_kit_id,omitempty"`
	BrandKitRevision int                       `json:"brand_kit_revision"`
	ExportDefaults   ImageEditorExportDefaults `json:"export_defaults"`
	Pages            []ImageEditorPagePayload  `json:"pages"`
}

type imageEditorRevisionSnapshot struct {
	SnapshotVersion     int                        `json:"snapshot_version"`
	Document            ImageEditorDocumentPayload `json:"document"`
	CoverPreviewMediaID string                     `json:"cover_preview_media_id,omitempty"`
}

type ImageEditorDocumentResponse struct {
	ID                  string                     `json:"id"`
	WorkspaceID         string                     `json:"workspace_id"`
	CreatedByID         string                     `json:"created_by_id"`
	Revision            int                        `json:"revision"`
	CanEdit             bool                       `json:"can_edit"`
	CoverPreviewMediaID string                     `json:"cover_preview_media_id,omitempty"`
	CreatedAt           string                     `json:"created_at"`
	UpdatedAt           string                     `json:"updated_at"`
	Document            ImageEditorDocumentPayload `json:"document"`
}

type ImageEditorDesignSummary struct {
	ID                  string `json:"id"`
	Title               string `json:"title"`
	PresetKey           string `json:"preset_key"`
	WidthPX             int    `json:"width_px"`
	HeightPX            int    `json:"height_px"`
	PageCount           int    `json:"page_count"`
	Revision            int    `json:"revision"`
	CoverPreviewMediaID string `json:"cover_preview_media_id,omitempty"`
	IsFavorite          bool   `json:"is_favorite"`
	CreatedAt           string `json:"created_at"`
	UpdatedAt           string `json:"updated_at"`
}

func (h *ImageEditorHandler) loadDocument(ctx context.Context, id string) (*models.DesignDocument, error) {
	var document models.DesignDocument
	err := h.db.NewSelect().Model(&document).
		Where("id = ? AND deleted_at IS NULL", id).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("OpenPost Image Editor design not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load OpenPost Image Editor design")
	}
	return &document, nil
}

func (h *ImageEditorHandler) documentResponse(ctx context.Context, id string) (*ImageEditorDocumentResponse, error) {
	document, err := h.loadDocument(ctx, id)
	if err != nil {
		return nil, err
	}
	canEdit, err := h.requireAccess(ctx, document.WorkspaceID, false)
	if err != nil {
		return nil, err
	}
	payload, err := imageEditorDocumentPayload(ctx, h.db, document)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	return &ImageEditorDocumentResponse{
		ID:                  document.ID,
		WorkspaceID:         document.WorkspaceID,
		CreatedByID:         document.CreatedByID,
		Revision:            document.Revision,
		CanEdit:             canEdit,
		CoverPreviewMediaID: document.CoverPreviewMediaID,
		CreatedAt:           document.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:           document.UpdatedAt.UTC().Format(time.RFC3339),
		Document:            payload,
	}, nil
}

func imageEditorDocumentPayload(
	ctx context.Context,
	db bun.IDB,
	document *models.DesignDocument,
) (ImageEditorDocumentPayload, error) {
	payload := ImageEditorDocumentPayload{
		SchemaVersion:    document.SchemaVersion,
		Title:            document.Title,
		PresetKey:        document.PresetKey,
		WidthPX:          document.WidthPX,
		HeightPX:         document.HeightPX,
		BrandKitID:       document.BrandKitID,
		BrandKitRevision: document.BrandKitRevision,
		ExportDefaults: ImageEditorExportDefaults{
			Format:     document.ExportFormat,
			Quality:    document.ExportQuality,
			MatteColor: defaultImageEditorBackground(document.ExportMatteColor),
		},
	}
	var pages []models.DesignPage
	if err := db.NewSelect().Model(&pages).
		Where("design_document_id = ?", document.ID).
		OrderExpr("display_order ASC").
		Scan(ctx); err != nil {
		return payload, errors.New("failed to load OpenPost Image Editor pages")
	}
	payload.Pages = make([]ImageEditorPagePayload, 0, len(pages))
	for _, page := range pages {
		var layers []ImageEditorLayer
		if err := json.Unmarshal([]byte(page.SceneJSON), &layers); err != nil {
			return payload, errors.New("OpenPost Image Editor design contains an invalid page")
		}
		background := defaultImageEditorPageBackground(page.BackgroundColor)
		var guides *ImageEditorPageGuides
		var colorGradeVersion int
		var colorGrade *ImageEditorColorGrade
		var pageWidth, pageHeight *int
		if encoded := strings.TrimSpace(page.BackgroundJSON); encoded != "" && encoded != "{}" {
			var err error
			var storedBackground *ImageEditorPageBackground
			var storedGuides *ImageEditorPageGuides
			var storedColorGradeVersion int
			var storedColorGrade *ImageEditorColorGrade
			storedBackground, storedGuides, storedColorGradeVersion, storedColorGrade, pageWidth, pageHeight, err = decodeImageEditorPageState(encoded, page.BackgroundColor)
			if err != nil {
				return payload, errors.New("OpenPost Image Editor design contains an invalid page background")
			}
			background = storedBackground
			guides = storedGuides
			colorGradeVersion = storedColorGradeVersion
			colorGrade = storedColorGrade
		}
		payload.Pages = append(payload.Pages, ImageEditorPagePayload{
			ID:                  page.ID,
			Name:                page.Name,
			WidthPX:             pageWidth,
			HeightPX:            pageHeight,
			BackgroundColor:     page.BackgroundColor,
			Background:          background,
			Guides:              guides,
			ColorGradeVersion:   colorGradeVersion,
			ColorGrade:          colorGrade,
			Layers:              layers,
			PreviewMediaID:      page.PreviewMediaID,
			LatestExportMediaID: page.LatestExportMediaID,
		})
	}
	return payload, nil
}

func insertImageEditorPages(ctx context.Context, tx bun.Tx, documentID string, pages []ImageEditorPagePayload, now time.Time) error {
	rows := make([]models.DesignPage, 0, len(pages))
	for index, page := range pages {
		scene, err := json.Marshal(page.Layers)
		if err != nil {
			return err
		}
		background := normalizeImageEditorPageBackground(page.Background, page.BackgroundColor)
		backgroundJSON, err := json.Marshal(imageEditorStoredPageState{
			StorageVersion:    imageEditorPageStorageVersion,
			WidthPX:           page.WidthPX,
			HeightPX:          page.HeightPX,
			Background:        background,
			Guides:            page.Guides,
			ColorGradeVersion: page.ColorGradeVersion,
			ColorGrade:        page.ColorGrade,
		})
		if err != nil {
			return err
		}
		rows = append(rows, models.DesignPage{
			ID:                  page.ID,
			DesignDocumentID:    documentID,
			Name:                defaultImageEditorPageName(page.Name, index),
			DisplayOrder:        index,
			BackgroundColor:     defaultImageEditorBackground(page.BackgroundColor),
			BackgroundJSON:      string(backgroundJSON),
			SceneJSON:           string(scene),
			PreviewMediaID:      page.PreviewMediaID,
			LatestExportMediaID: page.LatestExportMediaID,
			CreatedAt:           now,
			UpdatedAt:           now,
		})
	}
	if len(rows) == 0 {
		return nil
	}
	_, err := tx.NewInsert().Model(&rows).Exec(ctx)
	return err
}

func decodeImageEditorPageState(
	encoded string,
	fallbackColor string,
) (*ImageEditorPageBackground, *ImageEditorPageGuides, int, *ImageEditorColorGrade, *int, *int, error) {
	var versionProbe struct {
		StorageVersion int `json:"storage_version"`
	}
	if err := json.Unmarshal([]byte(encoded), &versionProbe); err != nil {
		return nil, nil, 0, nil, nil, nil, err
	}
	if versionProbe.StorageVersion == 0 {
		var legacy ImageEditorPageBackground
		if err := json.Unmarshal([]byte(encoded), &legacy); err != nil {
			return nil, nil, 0, nil, nil, nil, err
		}
		return normalizeImageEditorPageBackground(&legacy, fallbackColor), nil, 0, nil, nil, nil, nil
	}
	if versionProbe.StorageVersion != imageEditorPageStorageVersion {
		return nil, nil, 0, nil, nil, nil, fmt.Errorf("unsupported image editor page storage version %d", versionProbe.StorageVersion)
	}
	var state imageEditorStoredPageState
	if err := json.Unmarshal([]byte(encoded), &state); err != nil {
		return nil, nil, 0, nil, nil, nil, err
	}
	return normalizeImageEditorPageBackground(state.Background, fallbackColor), state.Guides, state.ColorGradeVersion, state.ColorGrade, state.WidthPX, state.HeightPX, nil
}

func replaceImageEditorMediaReferences(ctx context.Context, tx bun.Tx, document *models.DesignDocument, pages []ImageEditorPagePayload) error {
	var previousMediaIDs []string
	if err := tx.NewSelect().
		Model((*models.DesignMediaReference)(nil)).
		Column("media_id").
		Where("design_document_id = ?", document.ID).
		Scan(ctx, &previousMediaIDs); err != nil {
		return err
	}
	if _, err := tx.NewDelete().Model((*models.DesignMediaReference)(nil)).
		Where("design_document_id = ?", document.ID).
		Exec(ctx); err != nil {
		return err
	}
	refs := make([]models.DesignMediaReference, 0)
	seen := make(map[string]bool)
	for _, page := range pages {
		if mediaID := strings.TrimSpace(page.BackgroundMediaID()); mediaID != "" {
			key := page.ID + "\x00" + mediaID
			seen[key] = true
			refs = append(refs, models.DesignMediaReference{
				DesignDocumentID: document.ID,
				DesignPageID:     page.ID,
				MediaID:          mediaID,
				Usage:            "background",
				CreatedAt:        time.Now().UTC(),
			})
		}
		for _, layer := range page.Layers {
			mediaID := ""
			usage := ""
			if layer.Image != nil {
				mediaID = strings.TrimSpace(layer.Image.MediaID)
				usage = "layer"
			} else if layer.Text != nil {
				mediaID = strings.TrimSpace(layer.Text.FontAssetID)
				usage = "font"
			}
			if mediaID == "" {
				continue
			}
			key := page.ID + "\x00" + mediaID
			if seen[key] {
				continue
			}
			seen[key] = true
			refs = append(refs, models.DesignMediaReference{
				DesignDocumentID: document.ID,
				DesignPageID:     page.ID,
				MediaID:          mediaID,
				Usage:            usage,
				CreatedAt:        time.Now().UTC(),
			})
		}
	}
	if len(refs) > 0 {
		for start := 0; start < len(refs); start += imageEditorMediaWriteChunkSize {
			end := min(start+imageEditorMediaWriteChunkSize, len(refs))
			chunk := refs[start:end]
			if _, err := tx.NewInsert().Model(&chunk).Exec(ctx); err != nil {
				return err
			}
		}
	}
	mediaIDs := make([]string, 0, len(previousMediaIDs)+len(refs))
	mediaIDs = append(mediaIDs, previousMediaIDs...)
	for _, ref := range refs {
		mediaIDs = append(mediaIDs, ref.MediaID)
	}
	return medialifecycle.TouchWithDB(ctx, tx, mediaIDs, time.Now().UTC())
}

func imageEditorMediaIDs(pages []ImageEditorPagePayload) []string {
	set := make(map[string]struct{})
	for _, page := range pages {
		if strings.TrimSpace(page.PreviewMediaID) != "" {
			set[page.PreviewMediaID] = struct{}{}
		}
		if strings.TrimSpace(page.LatestExportMediaID) != "" {
			set[page.LatestExportMediaID] = struct{}{}
		}
		if mediaID := page.BackgroundMediaID(); mediaID != "" {
			set[mediaID] = struct{}{}
		}
		for _, layer := range page.Layers {
			if layer.Image != nil && strings.TrimSpace(layer.Image.MediaID) != "" {
				set[layer.Image.MediaID] = struct{}{}
			}
			if layer.Text != nil && strings.TrimSpace(layer.Text.FontAssetID) != "" {
				set[layer.Text.FontAssetID] = struct{}{}
			}
		}
	}
	ids := make([]string, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func cloneImageEditorPayload(payload ImageEditorDocumentPayload) ImageEditorDocumentPayload {
	data, _ := json.Marshal(payload)
	var clone ImageEditorDocumentPayload
	_ = json.Unmarshal(data, &clone)
	layerIDs := make(map[string]string)
	for pageIndex := range clone.Pages {
		clone.Pages[pageIndex].ID = uuid.NewString()
		for layerIndex := range clone.Pages[pageIndex].Layers {
			oldID := clone.Pages[pageIndex].Layers[layerIndex].ID
			newID := uuid.NewString()
			layerIDs[oldID] = newID
			clone.Pages[pageIndex].Layers[layerIndex].ID = newID
		}
		for layerIndex := range clone.Pages[pageIndex].Layers {
			parentID := clone.Pages[pageIndex].Layers[layerIndex].ParentID
			if parentID != "" {
				clone.Pages[pageIndex].Layers[layerIndex].ParentID = layerIDs[parentID]
			}
		}
	}
	return clone
}

func newImageEditorImageLayer(media models.MediaAttachment, width, height int) ImageEditorLayer {
	sourceWidth := media.Width
	sourceHeight := media.Height
	if sourceWidth <= 0 {
		sourceWidth = width
	}
	if sourceHeight <= 0 {
		sourceHeight = height
	}
	scale := math.Min(float64(width)/float64(sourceWidth), float64(height)/float64(sourceHeight))
	layerWidth := float64(sourceWidth) * scale
	layerHeight := float64(sourceHeight) * scale
	return ImageEditorLayer{
		ID:      uuid.NewString(),
		Type:    "image",
		Name:    defaultImageEditorLayerName(media.OriginalFilename, "Image"),
		Visible: true,
		Opacity: 1,
		Transform: ImageEditorTransform{
			X:      (float64(width) - layerWidth) / 2,
			Y:      (float64(height) - layerHeight) / 2,
			Width:  layerWidth,
			Height: layerHeight,
		},
		Image: &ImageEditorImageValue{
			MediaID:      media.ID,
			SourceWidth:  sourceWidth,
			SourceHeight: sourceHeight,
			Fit:          "cover",
			Crop:         ImageEditorCrop{Width: 1, Height: 1},
		},
	}
}

func designSummary(document models.DesignDocument, pageCount int) ImageEditorDesignSummary {
	return ImageEditorDesignSummary{
		ID:                  document.ID,
		Title:               document.Title,
		PresetKey:           document.PresetKey,
		WidthPX:             document.WidthPX,
		HeightPX:            document.HeightPX,
		PageCount:           pageCount,
		Revision:            document.Revision,
		CoverPreviewMediaID: document.CoverPreviewMediaID,
		IsFavorite:          document.IsFavorite,
		CreatedAt:           document.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:           document.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func defaultImageEditorFormat(presetKey string) string {
	for _, preset := range imageEditorPresets {
		if preset.Key == presetKey {
			return preset.DefaultFormat
		}
	}
	return "png"
}

func defaultImageEditorPageName(name string, index int) string {
	if trimmed := strings.TrimSpace(name); trimmed != "" {
		return trimmed
	}
	return fmt.Sprintf("Page %d", index+1)
}

func defaultImageEditorBackground(value string) string {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		return trimmed
	}
	return "#ffffff"
}

func defaultImageEditorPageBackground(color string) *ImageEditorPageBackground {
	return &ImageEditorPageBackground{
		Type:    "solid",
		Color:   defaultImageEditorBackground(color),
		Opacity: 1,
	}
}

func normalizeImageEditorPageBackground(
	background *ImageEditorPageBackground,
	legacyColor string,
) *ImageEditorPageBackground {
	if background == nil || !oneOfImageEditorString(background.Type, "transparent", "solid", "gradient", "image") {
		return defaultImageEditorPageBackground(legacyColor)
	}
	normalized := *background
	switch normalized.Type {
	case "transparent":
		normalized.Color = ""
		normalized.Opacity = 0
		normalized.Gradient = nil
		normalized.Image = nil
	case "solid":
		normalized.Color = defaultImageEditorBackground(normalized.Color)
		normalized.Gradient = nil
		normalized.Image = nil
	case "gradient":
		normalized.Color = ""
		normalized.Image = nil
	case "image":
		normalized.Color = ""
		normalized.Gradient = nil
	}
	return &normalized
}

func defaultImageEditorLayerName(value, fallback string) string {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		return trimmed
	}
	return fallback
}
