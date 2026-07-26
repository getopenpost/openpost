package handlers

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func newStudioHandlerTest(t *testing.T) (*StudioHandler, context.Context) {
	t.Helper()
	db := createHandlerTestDB(t,
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.MediaAttachment)(nil),
		(*models.DesignDocument)(nil),
		(*models.DesignPage)(nil),
		(*models.DesignRevision)(nil),
		(*models.DesignMediaReference)(nil),
		(*models.DesignTemplate)(nil),
		(*models.DesignTemplateMediaReference)(nil),
		(*models.DesignReturnToken)(nil),
	)
	ctx := context.WithValue(context.Background(), middleware.UserIDKey, "user-1")
	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "Studio"}).Exec(ctx)
	require.NoError(t, err)
	members := []models.WorkspaceMember{
		{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin},
		{WorkspaceID: "workspace-1", UserID: "viewer-1", Role: models.WorkspaceRoleViewer},
	}
	_, err = db.NewInsert().Model(&members).Exec(ctx)
	require.NoError(t, err)
	return NewStudioHandler(db, testAuthenticator{}, true, "/studio-models"), ctx
}

func TestStudioDesignSaveUsesOptimisticConcurrencyAndTracksMedia(t *testing.T) {
	t.Parallel()
	handler, ctx := newStudioHandlerTest(t)
	_, err := handler.db.NewInsert().Model(&models.MediaAttachment{
		ID:               "media-1",
		WorkspaceID:      "workspace-1",
		FilePath:         "media-1.png",
		MimeType:         "image/png",
		ProcessingStatus: mediaReadyStatus,
		OriginalFilename: "media-1.png",
		FileHash:         "hash-1",
		Source:           "upload",
		AssetKind:        "library",
	}).Exec(ctx)
	require.NoError(t, err)

	create := &CreateStudioDesignInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.Title = "Launch"
	create.Body.PresetKey = "instagram-square"
	created, err := handler.createDesign(ctx, create)
	require.NoError(t, err)
	require.Equal(t, 1, created.Body.Revision)
	require.Len(t, created.Body.Document.Pages, 1)

	payload := created.Body.Document
	payload.Title = "Launch updated"
	payload.Pages[0].Layers = append(payload.Pages[0].Layers, StudioLayer{
		ID:      "image-layer-1",
		Type:    "image",
		Name:    "Photo",
		Visible: true,
		Opacity: 1,
		Transform: StudioTransform{
			Width:  1080,
			Height: 1080,
		},
		Image: &StudioImageValue{
			MediaID:      "media-1",
			SourceWidth:  1080,
			SourceHeight: 1080,
			Fit:          "cover",
			Crop:         StudioCrop{Width: 1, Height: 1},
		},
		Effects: &StudioLayerEffects{
			BlendMode: "overlay",
			DropShadow: &StudioShadowEffect{
				Color:    "#000000",
				Opacity:  0.3,
				Blur:     24,
				Angle:    45,
				Distance: 12,
			},
			InnerShadow: &StudioShadowEffect{
				Color:    "#000000",
				Opacity:  0.2,
				Blur:     16,
				Angle:    135,
				Distance: 8,
			},
			Stroke: &StudioStrokeEffect{
				Color:    "#f97316",
				Opacity:  1,
				Width:    6,
				Position: "outside",
			},
		},
		Mask: &StudioLayerMask{Shape: "circle", Inset: 4},
	})
	payload.Pages[0].Layers = append(payload.Pages[0].Layers, StudioLayer{
		ID:      "paint-layer-1",
		Type:    "paint",
		Name:    "Pencil",
		Visible: true,
		Opacity: 1,
		Transform: StudioTransform{
			X:      10,
			Y:      12,
			Width:  120,
			Height: 32,
		},
		Paint: &StudioPaintValue{
			Kind:         "stroke",
			Color:        "#f97316",
			Size:         12,
			Opacity:      1,
			SourceWidth:  120,
			SourceHeight: 32,
			Points: []StudioPaintPoint{
				{X: 2, Y: 4},
				{X: 110, Y: 24},
			},
			Spans: []StudioPaintSpan{},
		},
		Effects: &StudioLayerEffects{BlendMode: "normal"},
	})
	payload.Pages[0].Layers = append(payload.Pages[0].Layers, StudioLayer{
		ID:      "paint-layer-2",
		Type:    "paint",
		Name:    "Gradient",
		Visible: true,
		Opacity: 1,
		Transform: StudioTransform{
			Width:  240,
			Height: 120,
		},
		Paint: &StudioPaintValue{
			Kind:         "gradient",
			Color:        "#f97316",
			Size:         1,
			Opacity:      1,
			SourceWidth:  240,
			SourceHeight: 120,
			Points:       []StudioPaintPoint{},
			Spans:        []StudioPaintSpan{{X: 0, Y: 0, Width: 240}},
			Gradient: &StudioGradientValue{
				Type:  "linear",
				Start: StudioPaintPoint{X: 0, Y: 0},
				End:   StudioPaintPoint{X: 240, Y: 0},
				Stops: []StudioGradientStop{
					{Offset: 0, Color: "#f97316"},
					{Offset: 1, Color: "#7c3aed"},
				},
			},
		},
		Effects: &StudioLayerEffects{BlendMode: "normal"},
	})
	update := &UpdateStudioDesignInput{PathID: created.Body.ID}
	update.Body.ExpectedRevision = 1
	update.Body.Document = payload
	saved, err := handler.updateDesign(ctx, update)
	require.NoError(t, err)
	require.Equal(t, 2, saved.Body.Revision)
	require.Equal(t, "Launch updated", saved.Body.Document.Title)
	require.Equal(t, "overlay", saved.Body.Document.Pages[0].Layers[0].Effects.BlendMode)
	require.Equal(t, "circle", saved.Body.Document.Pages[0].Layers[0].Mask.Shape)
	require.Equal(t, "paint", saved.Body.Document.Pages[0].Layers[1].Type)
	require.Equal(t, "stroke", saved.Body.Document.Pages[0].Layers[1].Paint.Kind)
	require.Equal(t, "gradient", saved.Body.Document.Pages[0].Layers[2].Paint.Kind)
	require.Equal(t, "outside", saved.Body.Document.Pages[0].Layers[0].Effects.Stroke.Position)

	count, err := handler.db.NewSelect().Model((*models.DesignMediaReference)(nil)).
		Where("design_document_id = ? AND media_id = ?", created.Body.ID, "media-1").
		Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)

	_, err = handler.updateDesign(ctx, update)
	require.Error(t, err)
	require.Contains(t, err.Error(), "changed elsewhere")
}

func TestStudioSourceDesignUsesItsImageAsTheLibraryPreview(t *testing.T) {
	t.Parallel()
	handler, ctx := newStudioHandlerTest(t)
	_, err := handler.db.NewInsert().Model(&models.MediaAttachment{
		ID:               "source-image",
		WorkspaceID:      "workspace-1",
		FilePath:         "source-image.png",
		MimeType:         "image/png",
		ProcessingStatus: mediaReadyStatus,
		OriginalFilename: "source-image.png",
		FileHash:         "source-image-hash",
		Source:           "upload",
		AssetKind:        "library",
		Width:            1200,
		Height:           630,
	}).Exec(ctx)
	require.NoError(t, err)

	create := &CreateStudioDesignInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.Title = "Edit source image"
	create.Body.PresetKey = "custom"
	create.Body.WidthPX = 1200
	create.Body.HeightPX = 630
	create.Body.SourceMediaID = "source-image"
	created, err := handler.createDesign(ctx, create)
	require.NoError(t, err)
	require.Equal(t, "source-image", created.Body.CoverPreviewMediaID)

	_, err = handler.db.NewUpdate().
		Model((*models.DesignDocument)(nil)).
		Set("cover_preview_media_id = ''").
		Where("id = ?", created.Body.ID).
		Exec(ctx)
	require.NoError(t, err)

	listed, err := handler.listDesigns(ctx, &ListStudioDesignsInput{WorkspaceID: "workspace-1"})
	require.NoError(t, err)
	require.Len(t, listed.Body.Designs, 1)
	require.Equal(t, "source-image", listed.Body.Designs[0].CoverPreviewMediaID)
}

func TestStudioViewerCanReadButCannotEdit(t *testing.T) {
	t.Parallel()
	handler, adminCtx := newStudioHandlerTest(t)
	create := &CreateStudioDesignInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.Title = "Read only"
	create.Body.PresetKey = "linkedin-square"
	created, err := handler.createDesign(adminCtx, create)
	require.NoError(t, err)

	viewerCtx := context.WithValue(context.Background(), middleware.UserIDKey, "viewer-1")
	read, err := handler.getDesign(viewerCtx, &GetStudioDesignInput{PathID: created.Body.ID})
	require.NoError(t, err)
	require.False(t, read.Body.CanEdit)

	update := &UpdateStudioDesignInput{PathID: created.Body.ID}
	update.Body.ExpectedRevision = created.Body.Revision
	update.Body.Document = created.Body.Document
	_, err = handler.updateDesign(viewerCtx, update)
	require.Error(t, err)
	require.Contains(t, err.Error(), "read-only")
}

func TestStudioDesignFavoriteIsListedAndRequiresEditAccess(t *testing.T) {
	t.Parallel()
	handler, adminCtx := newStudioHandlerTest(t)
	create := &CreateStudioDesignInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.Title = "Favorite design"
	create.Body.PresetKey = "instagram-square"
	created, err := handler.createDesign(adminCtx, create)
	require.NoError(t, err)

	listed, err := handler.listDesigns(adminCtx, &ListStudioDesignsInput{WorkspaceID: "workspace-1"})
	require.NoError(t, err)
	require.Len(t, listed.Body.Designs, 1)
	require.False(t, listed.Body.Designs[0].IsFavorite)

	favorite, err := handler.toggleDesignFavorite(adminCtx, &ToggleStudioDesignFavoriteInput{
		PathID: created.Body.ID,
	})
	require.NoError(t, err)
	require.True(t, favorite.Body.IsFavorite)

	listed, err = handler.listDesigns(adminCtx, &ListStudioDesignsInput{WorkspaceID: "workspace-1"})
	require.NoError(t, err)
	require.True(t, listed.Body.Designs[0].IsFavorite)

	viewerCtx := context.WithValue(context.Background(), middleware.UserIDKey, "viewer-1")
	_, err = handler.toggleDesignFavorite(viewerCtx, &ToggleStudioDesignFavoriteInput{
		PathID: created.Body.ID,
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "read-only")
}

func TestStudioReturnTokenIsOrderedAndOneTime(t *testing.T) {
	t.Parallel()
	handler, ctx := newStudioHandlerTest(t)
	media := []models.MediaAttachment{
		{ID: "export-1", WorkspaceID: "workspace-1", FilePath: "1.png", MimeType: "image/png", ProcessingStatus: mediaReadyStatus, OriginalFilename: "1.png", FileHash: "export-hash-1", Source: "studio_export", AssetKind: "library"},
		{ID: "export-2", WorkspaceID: "workspace-1", FilePath: "2.png", MimeType: "image/png", ProcessingStatus: mediaReadyStatus, OriginalFilename: "2.png", FileHash: "export-hash-2", Source: "studio_export", AssetKind: "library"},
	}
	_, err := handler.db.NewInsert().Model(&media).Exec(ctx)
	require.NoError(t, err)

	create := &CreateStudioReturnTokenInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.ReturnURL = "/?draft=post-1"
	create.Body.Purpose = "thread_segment"
	create.Body.MaxSelection = 2
	create.Body.Constraints = map[string]any{"accept": []string{"image/png"}}
	token, err := handler.createReturnToken(ctx, create)
	require.NoError(t, err)
	require.NotEmpty(t, token.Body.Token)

	complete := &CompleteStudioReturnTokenInput{Token: token.Body.Token}
	complete.Body.MediaIDs = []string{"export-2", "export-1"}
	completed, err := handler.completeReturnToken(ctx, complete)
	require.NoError(t, err)
	require.Equal(t, "/?draft=post-1", completed.Body.ReturnURL)

	consumed, err := handler.consumeReturnToken(ctx, &ConsumeStudioReturnTokenInput{Token: token.Body.Token})
	require.NoError(t, err)
	require.Equal(t, []string{"export-2", "export-1"}, consumed.Body.MediaIDs)
	require.Equal(t, "thread_segment", consumed.Body.Purpose)

	_, err = handler.consumeReturnToken(ctx, &ConsumeStudioReturnTokenInput{Token: token.Body.Token})
	require.Error(t, err)
	require.Contains(t, err.Error(), "already been consumed")
}

func TestStudioReturnTokenRejectsExternalReturnURL(t *testing.T) {
	t.Parallel()
	handler, ctx := newStudioHandlerTest(t)
	input := &CreateStudioReturnTokenInput{}
	input.Body.WorkspaceID = "workspace-1"
	input.Body.ReturnURL = "https://example.com/steal"
	input.Body.MaxSelection = 1
	_, err := handler.createReturnToken(ctx, input)
	require.Error(t, err)
	require.Contains(t, err.Error(), "same-origin")
}

func TestStudioReturnTokenEnforcesComposerMIMEConstraints(t *testing.T) {
	t.Parallel()
	handler, ctx := newStudioHandlerTest(t)
	_, err := handler.db.NewInsert().Model(&models.MediaAttachment{
		ID:               "export-jpeg",
		WorkspaceID:      "workspace-1",
		FilePath:         "export.jpg",
		MimeType:         "image/jpeg",
		ProcessingStatus: mediaReadyStatus,
		OriginalFilename: "export.jpg",
		FileHash:         "export-jpeg-hash",
		Source:           "studio_export",
		AssetKind:        "library",
	}).Exec(ctx)
	require.NoError(t, err)

	create := &CreateStudioReturnTokenInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.ReturnURL = "/"
	create.Body.MaxSelection = 1
	create.Body.Constraints = map[string]any{"allowed_mimes": []string{"image/png"}}
	token, err := handler.createReturnToken(ctx, create)
	require.NoError(t, err)

	complete := &CompleteStudioReturnTokenInput{Token: token.Body.Token}
	complete.Body.MediaIDs = []string{"export-jpeg"}
	_, err = handler.completeReturnToken(ctx, complete)
	require.Error(t, err)
	require.Contains(t, err.Error(), "format is not supported")
}

func TestStudioWorkspaceTemplateCanBeReplacedDeliberately(t *testing.T) {
	t.Parallel()
	handler, ctx := newStudioHandlerTest(t)
	createDesign := &CreateStudioDesignInput{}
	createDesign.Body.WorkspaceID = "workspace-1"
	createDesign.Body.Title = "Template source"
	createDesign.Body.PresetKey = "instagram-square"
	design, err := handler.createDesign(ctx, createDesign)
	require.NoError(t, err)

	createTemplate := &CreateStudioTemplateInput{}
	createTemplate.Body.WorkspaceID = "workspace-1"
	createTemplate.Body.Name = "Campaign"
	createTemplate.Body.Category = "Launch"
	createTemplate.Body.Document = design.Body.Document
	template, err := handler.createTemplate(ctx, createTemplate)
	require.NoError(t, err)
	require.Equal(t, "Campaign", template.Body.Name)

	replacement := design.Body.Document
	replacement.Title = "Replacement snapshot"
	update := &UpdateStudioTemplateInput{PathID: template.Body.ID}
	update.Body.Name = "Campaign v2"
	update.Body.Category = "Announcements"
	update.Body.Document = replacement
	replaced, err := handler.updateTemplate(ctx, update)
	require.NoError(t, err)
	require.Equal(t, "Campaign v2", replaced.Body.Name)
	require.Equal(t, "Replacement snapshot", replaced.Body.Document.Title)
}

func TestBuiltinStudioTemplatesIncludeOriginalMultipageSets(t *testing.T) {
	t.Parallel()
	templates := builtinStudioTemplates()
	require.Len(t, templates, 5)

	multipage := 0
	for _, template := range templates {
		require.True(t, template.BuiltIn)
		require.NotEmpty(t, template.Document.Pages)
		require.NoError(t, validateStudioPayload(template.Document), template.ID)
		for _, page := range template.Document.Pages {
			for _, layer := range page.Layers {
				if layer.Text != nil {
					require.Equal(t, "Geist Variable", layer.Text.FontFamily, template.ID)
				}
			}
		}
		if len(template.Document.Pages) > 1 {
			multipage++
		}
	}
	require.Equal(t, 1, multipage)
}

func TestStudioRejectsCrossWorkspacePreviewReferences(t *testing.T) {
	t.Parallel()
	handler, ctx := newStudioHandlerTest(t)
	_, err := handler.db.NewInsert().Model(&models.Workspace{ID: "workspace-2", Name: "Other"}).Exec(ctx)
	require.NoError(t, err)
	_, err = handler.db.NewInsert().Model(&models.MediaAttachment{
		ID:               "foreign-preview",
		WorkspaceID:      "workspace-2",
		FilePath:         "preview.webp",
		MimeType:         "image/webp",
		ProcessingStatus: mediaReadyStatus,
		OriginalFilename: "preview.webp",
		FileHash:         "foreign-preview-hash",
		Source:           "studio_edit",
		AssetKind:        "design_preview",
	}).Exec(ctx)
	require.NoError(t, err)

	create := &CreateStudioDesignInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.Title = "Preview ownership"
	create.Body.PresetKey = "instagram-square"
	design, err := handler.createDesign(ctx, create)
	require.NoError(t, err)

	update := &UpdateStudioDesignInput{PathID: design.Body.ID}
	update.Body.ExpectedRevision = design.Body.Revision
	update.Body.Document = design.Body.Document
	update.Body.Document.Pages[0].PreviewMediaID = "foreign-preview"
	_, err = handler.updateDesign(ctx, update)
	require.Error(t, err)
	require.Contains(t, err.Error(), "must belong to the workspace")

	update.Body.Document.Pages[0].PreviewMediaID = ""
	update.Body.CoverPreviewID = "foreign-preview"
	_, err = handler.updateDesign(ctx, update)
	require.Error(t, err)
	require.Contains(t, err.Error(), "must belong to the workspace")
}
