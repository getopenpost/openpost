package handlers

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func gzipJSONForTest(data []byte) ([]byte, error) {
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(data); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func TestImageEditorNamedRevisionPaginationReachesOlderVersions(t *testing.T) {
	t.Parallel()
	handler, ctx := newImageEditorHandlerTest(t)
	create := &CreateImageEditorDesignInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.Title = "Pagination"
	create.Body.PresetKey = "instagram-square"
	created, err := handler.createDesign(ctx, create)
	require.NoError(t, err)

	createdAt := time.Now().UTC().Add(-time.Hour)
	revisions := make([]models.DesignRevision, 0, 105)
	for index := 0; index < 105; index++ {
		revisions = append(revisions, models.DesignRevision{
			ID:               fmt.Sprintf("named-image-%03d", index),
			DesignDocumentID: created.Body.ID,
			Revision:         index + 1,
			Kind:             "checkpoint",
			Name:             fmt.Sprintf("Named image %03d", index),
			Snapshot:         []byte{1},
			CreatedByID:      "user-1",
			CreatedAt:        createdAt,
		})
	}
	_, err = handler.db.NewInsert().Model(&revisions).Exec(ctx)
	require.NoError(t, err)

	cursor := ""
	seen := make(map[string]struct{}, len(revisions))
	for {
		page, err := handler.listRevisions(ctx, &ListImageEditorRevisionsInput{
			PathID: created.Body.ID,
			Cursor: cursor,
			Limit:  17,
		})
		require.NoError(t, err)
		for _, revision := range page.Body.Revisions {
			if revision.Kind == "checkpoint" {
				seen[revision.ID] = struct{}{}
			}
		}
		if page.Body.NextCursor == "" {
			break
		}
		require.NotEqual(t, cursor, page.Body.NextCursor)
		cursor = page.Body.NextCursor
	}
	require.Len(t, seen, 105)
	require.Contains(t, seen, "named-image-000")
}

func TestImageEditorRevisionListRejectsMalformedCursor(t *testing.T) {
	t.Parallel()
	handler, ctx := newImageEditorHandlerTest(t)
	create := &CreateImageEditorDesignInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.Title = "Cursor validation"
	create.Body.PresetKey = "instagram-square"
	created, err := handler.createDesign(ctx, create)
	require.NoError(t, err)

	_, err = handler.listRevisions(ctx, &ListImageEditorRevisionsInput{
		PathID: created.Body.ID,
		Cursor: "not-a-valid-cursor",
	})
	require.Error(t, err)
	var statusError huma.StatusError
	require.ErrorAs(t, err, &statusError)
	require.Equal(t, 400, statusError.GetStatus())
}

func TestImageEditorRevisionEndpointsHonorDisabledFlag(t *testing.T) {
	t.Parallel()
	handler, ctx := newImageEditorHandlerTest(t)
	handler.enabled = false

	assertDisabled := func(err error) {
		t.Helper()
		require.Error(t, err)
		var statusError huma.StatusError
		require.ErrorAs(t, err, &statusError)
		require.Equal(t, 404, statusError.GetStatus())
		require.Contains(t, err.Error(), "OpenPost Image Editor is disabled")
	}

	_, err := handler.listRevisions(ctx, &ListImageEditorRevisionsInput{PathID: "design-1"})
	assertDisabled(err)
	_, err = handler.getRevision(ctx, &GetImageEditorRevisionInput{
		PathID:     "design-1",
		RevisionID: "revision-1",
	})
	assertDisabled(err)
	_, err = handler.createCheckpoint(ctx, &CreateImageEditorCheckpointInput{
		PathID: "design-1",
	})
	assertDisabled(err)
	_, err = handler.restoreRevision(ctx, &RestoreImageEditorRevisionInput{
		PathID:     "design-1",
		RevisionID: "revision-1",
	})
	assertDisabled(err)
}

func TestImageEditorPageColorGradeRequiresVersionAndBoundedValues(t *testing.T) {
	t.Parallel()
	handler, ctx := newImageEditorHandlerTest(t)
	create := &CreateImageEditorDesignInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.Title = "Color grade validation"
	create.Body.PresetKey = "instagram-square"
	created, err := handler.createDesign(ctx, create)
	require.NoError(t, err)

	document := created.Body.Document
	document.Pages[0].ColorGrade = &ImageEditorColorGrade{Contrast: 0.25}
	require.ErrorContains(t, validateImageEditorPayload(document), "require version 1")

	document.Pages[0].ColorGradeVersion = 1
	require.NoError(t, validateImageEditorPayload(document))
	document.Pages[0].ColorGrade.Contrast = 1.1
	require.ErrorContains(t, validateImageEditorPayload(document), "must be between -1 and 1")
}

func newImageEditorHandlerTest(t *testing.T) (*ImageEditorHandler, context.Context) {
	t.Helper()
	db := createHandlerTestDB(t,
		(*models.User)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.MediaAttachment)(nil),
		(*models.MediaTag)(nil),
		(*models.MediaTagAssignment)(nil),
		(*models.DesignDocument)(nil),
		(*models.DesignPage)(nil),
		(*models.DesignRevision)(nil),
		(*models.DesignRevisionMediaReference)(nil),
		(*models.DesignRevisionMediaIndexState)(nil),
		(*models.DesignMediaReference)(nil),
		(*models.DesignTemplate)(nil),
		(*models.DesignTemplateMediaReference)(nil),
		(*models.DesignReturnToken)(nil),
	)
	ctx := context.WithValue(context.Background(), middleware.UserIDKey, "user-1")
	users := []models.User{
		{ID: "user-1", Email: "owner@example.com", DisplayName: "Owner"},
		{ID: "viewer-1", Email: "viewer@example.com", DisplayName: "Viewer"},
	}
	_, err := db.NewInsert().Model(&users).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "OpenPost Image Editor"}).Exec(ctx)
	require.NoError(t, err)
	members := []models.WorkspaceMember{
		{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin},
		{WorkspaceID: "workspace-1", UserID: "viewer-1", Role: models.WorkspaceRoleViewer},
	}
	_, err = db.NewInsert().Model(&members).Exec(ctx)
	require.NoError(t, err)
	return NewImageEditorHandler(db, testAuthenticator{}, true, "/image-editor-models"), ctx
}

func TestMediaUploadTagResolutionUsesOnlyAnExplicitTag(t *testing.T) {
	t.Parallel()
	handler, ctx := newImageEditorHandlerTest(t)
	tag := &models.MediaTag{ID: "launch-tag", WorkspaceID: "workspace-1", Name: "Launch", NormalizedName: "launch"}
	_, err := handler.db.NewInsert().Model(tag).Exec(ctx)
	require.NoError(t, err)

	mediaHandler := &MediaHandler{db: handler.db}
	tagID, err := mediaHandler.resolveMediaUploadTag(ctx, "workspace-1", "", "library")
	require.NoError(t, err)
	require.Empty(t, tagID)

	tagID, err = mediaHandler.resolveMediaUploadTag(ctx, "workspace-1", "launch-tag", "library")
	require.NoError(t, err)
	require.Equal(t, "launch-tag", tagID)

	tagID, err = mediaHandler.resolveMediaUploadTag(ctx, "workspace-1", "launch-tag", "design_preview")
	require.NoError(t, err)
	require.Empty(t, tagID)
}

func TestImageEditorDesignSaveUsesOptimisticConcurrencyAndTracksMedia(t *testing.T) {
	t.Parallel()
	handler, ctx := newImageEditorHandlerTest(t)
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

	create := &CreateImageEditorDesignInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.Title = "Launch"
	create.Body.PresetKey = "instagram-square"
	created, err := handler.createDesign(ctx, create)
	require.NoError(t, err)
	require.Equal(t, 1, created.Body.Revision)
	require.Len(t, created.Body.Document.Pages, 1)

	payload := created.Body.Document
	payload.Title = "Launch updated"
	payload.ExportDefaults = ImageEditorExportDefaults{
		Format:     "webp",
		Quality:    0.78,
		MatteColor: "#f5f5f4",
	}
	payload.Pages[0].Background = &ImageEditorPageBackground{
		Type:    "image",
		Opacity: 0.8,
		Image: &ImageEditorPageBackgroundImage{
			MediaID: "media-1",
			Fit:     "cover",
		},
	}
	payload.Pages[0].Layers = append(payload.Pages[0].Layers, ImageEditorLayer{
		ID:      "image-layer-1",
		Type:    "image",
		Name:    "Photo",
		Visible: true,
		Opacity: 1,
		Transform: ImageEditorTransform{
			Width:  1080,
			Height: 1080,
		},
		Image: &ImageEditorImageValue{
			MediaID:           "media-1",
			SourceWidth:       1080,
			SourceHeight:      1080,
			Fit:               "cover",
			Crop:              ImageEditorCrop{Width: 1, Height: 1},
			ColorGradeVersion: 1,
			Adjustments: ImageEditorImageAdjustments{
				Tint:     0.15,
				Vibrance: 0.25,
				Hue:      -0.1,
			},
		},
		Effects: &ImageEditorLayerEffects{
			BlendMode: "overlay",
			DropShadow: &ImageEditorShadowEffect{
				Color:    "#000000",
				Opacity:  0.3,
				Blur:     24,
				Angle:    45,
				Distance: 12,
			},
			InnerShadow: &ImageEditorShadowEffect{
				Color:    "#000000",
				Opacity:  0.2,
				Blur:     16,
				Angle:    135,
				Distance: 8,
			},
			Stroke: &ImageEditorStrokeEffect{
				Color:    "#f97316",
				Opacity:  1,
				Width:    6,
				Position: "outside",
			},
		},
		Mask: &ImageEditorLayerMask{Shape: "circle", Inset: 4},
		EraseMask: &ImageEditorEraseMask{
			SourceWidth:  1080,
			SourceHeight: 1080,
			Strokes: []ImageEditorEraseStroke{{
				Size:   24,
				Points: []ImageEditorPaintPoint{{X: 100, Y: 100}, {X: 160, Y: 120}},
			}},
			Spans: []ImageEditorPaintSpan{{X: 20, Y: 40, Width: 80}},
		},
	})
	payload.Pages[0].Layers = append(payload.Pages[0].Layers, ImageEditorLayer{
		ID:      "paint-layer-1",
		Type:    "paint",
		Name:    "Pencil",
		Visible: true,
		Opacity: 1,
		Transform: ImageEditorTransform{
			X:      10,
			Y:      12,
			Width:  120,
			Height: 32,
		},
		Paint: &ImageEditorPaintValue{
			Kind:         "stroke",
			Color:        "#f97316",
			Size:         12,
			Opacity:      1,
			SourceWidth:  120,
			SourceHeight: 32,
			Points: []ImageEditorPaintPoint{
				{X: 2, Y: 4},
				{X: 110, Y: 24},
			},
			Spans: []ImageEditorPaintSpan{},
		},
		Effects: &ImageEditorLayerEffects{BlendMode: "normal"},
	})
	payload.Pages[0].Layers = append(payload.Pages[0].Layers, ImageEditorLayer{
		ID:      "paint-layer-2",
		Type:    "paint",
		Name:    "Gradient",
		Visible: true,
		Opacity: 1,
		Transform: ImageEditorTransform{
			Width:  240,
			Height: 120,
		},
		Paint: &ImageEditorPaintValue{
			Kind:         "gradient",
			Color:        "#f97316",
			Size:         1,
			Opacity:      1,
			SourceWidth:  240,
			SourceHeight: 120,
			Points:       []ImageEditorPaintPoint{},
			Spans:        []ImageEditorPaintSpan{{X: 0, Y: 0, Width: 240}},
			Gradient: &ImageEditorGradientValue{
				Type:  "linear",
				Start: ImageEditorPaintPoint{X: 0, Y: 0},
				End:   ImageEditorPaintPoint{X: 240, Y: 0},
				Stops: []ImageEditorGradientStop{
					{Offset: 0, Color: "#f97316"},
					{Offset: 1, Color: "#7c3aed"},
				},
			},
		},
		Effects: &ImageEditorLayerEffects{BlendMode: "normal"},
	})
	update := &UpdateImageEditorDesignInput{PathID: created.Body.ID}
	update.Body.ExpectedRevision = 1
	update.Body.Document = payload
	saved, err := handler.updateDesign(ctx, update)
	require.NoError(t, err)
	require.Equal(t, 2, saved.Body.Revision)
	require.Equal(t, "Launch updated", saved.Body.Document.Title)

	reloaded, err := handler.getDesign(ctx, &GetImageEditorDesignInput{PathID: created.Body.ID})
	require.NoError(t, err)
	require.Equal(t, payload.ExportDefaults, reloaded.Body.Document.ExportDefaults)
	require.Equal(t, payload.Pages[0].Background, reloaded.Body.Document.Pages[0].Background)
	require.Equal(t, 1, reloaded.Body.Document.Pages[0].Layers[0].Image.ColorGradeVersion)

	duplicated, err := handler.duplicateDesign(ctx, &DuplicateImageEditorDesignInput{PathID: created.Body.ID})
	require.NoError(t, err)
	require.Equal(t, payload.ExportDefaults, duplicated.Body.Document.ExportDefaults)
	require.Equal(t, "image", duplicated.Body.Document.Pages[0].Background.Type)

	count, err := handler.db.NewSelect().Model((*models.DesignMediaReference)(nil)).
		Where("design_document_id = ? AND media_id = ?", created.Body.ID, "media-1").
		Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)

	var reference models.DesignMediaReference
	require.NoError(t, handler.db.NewSelect().Model(&reference).
		Where("design_document_id = ? AND media_id = ?", created.Body.ID, "media-1").
		Scan(ctx))
	require.Equal(t, "background", reference.Usage)

	_, err = handler.updateDesign(ctx, update)
	require.Error(t, err)
	require.Contains(t, err.Error(), "changed elsewhere")
}

func TestImageEditorDesignCreationIsIdempotentForClientRequest(t *testing.T) {
	t.Parallel()
	handler, ctx := newImageEditorHandlerTest(t)
	input := &CreateImageEditorDesignInput{}
	input.Body.WorkspaceID = "workspace-1"
	input.Body.Title = "Imported local design"
	input.Body.PresetKey = "instagram-square"
	input.Body.ClientRequestID = "local_design_123"

	first, err := handler.createDesign(ctx, input)
	require.NoError(t, err)
	second, err := handler.createDesign(ctx, input)
	require.NoError(t, err)

	require.Equal(t, first.Body.ID, second.Body.ID)
	count, err := handler.db.NewSelect().
		Model((*models.DesignDocument)(nil)).
		Where("workspace_id = ? AND created_by_id = ?", "workspace-1", "user-1").
		Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestImageEditorViewerCanReadButCannotEdit(t *testing.T) {
	t.Parallel()
	handler, adminCtx := newImageEditorHandlerTest(t)
	create := &CreateImageEditorDesignInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.Title = "Read only"
	create.Body.PresetKey = "linkedin-square"
	created, err := handler.createDesign(adminCtx, create)
	require.NoError(t, err)

	viewerCtx := context.WithValue(context.Background(), middleware.UserIDKey, "viewer-1")
	read, err := handler.getDesign(viewerCtx, &GetImageEditorDesignInput{PathID: created.Body.ID})
	require.NoError(t, err)
	require.False(t, read.Body.CanEdit)

	update := &UpdateImageEditorDesignInput{PathID: created.Body.ID}
	update.Body.ExpectedRevision = created.Body.Revision
	update.Body.Document = created.Body.Document
	_, err = handler.updateDesign(viewerCtx, update)
	require.Error(t, err)
	require.Contains(t, err.Error(), "read-only")
}

func TestImageEditorReturnTokenIsOrderedAndOneTime(t *testing.T) {
	t.Parallel()
	handler, ctx := newImageEditorHandlerTest(t)
	media := []models.MediaAttachment{
		{ID: "export-1", WorkspaceID: "workspace-1", FilePath: "1.png", MimeType: "image/png", ProcessingStatus: mediaReadyStatus, OriginalFilename: "1.png", FileHash: "export-hash-1", Source: "image_editor_export", AssetKind: "library"},
		{ID: "export-2", WorkspaceID: "workspace-1", FilePath: "2.png", MimeType: "image/png", ProcessingStatus: mediaReadyStatus, OriginalFilename: "2.png", FileHash: "export-hash-2", Source: "image_editor_export", AssetKind: "library"},
	}
	_, err := handler.db.NewInsert().Model(&media).Exec(ctx)
	require.NoError(t, err)

	create := &CreateImageEditorReturnTokenInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.ReturnURL = "/?draft=post-1"
	create.Body.Purpose = "thread_segment"
	create.Body.MaxSelection = 2
	create.Body.Constraints = map[string]any{"accept": []string{"image/png"}}
	token, err := handler.createReturnToken(ctx, create)
	require.NoError(t, err)
	require.NotEmpty(t, token.Body.Token)

	complete := &CompleteImageEditorReturnTokenInput{Token: token.Body.Token}
	complete.Body.MediaIDs = []string{"export-2", "export-1"}
	completed, err := handler.completeReturnToken(ctx, complete)
	require.NoError(t, err)
	require.Equal(t, "/?draft=post-1", completed.Body.ReturnURL)

	consumed, err := handler.consumeReturnToken(ctx, &ConsumeImageEditorReturnTokenInput{Token: token.Body.Token})
	require.NoError(t, err)
	require.Equal(t, []string{"export-2", "export-1"}, consumed.Body.MediaIDs)
	require.Equal(t, "thread_segment", consumed.Body.Purpose)

	_, err = handler.consumeReturnToken(ctx, &ConsumeImageEditorReturnTokenInput{Token: token.Body.Token})
	require.Error(t, err)
	require.Contains(t, err.Error(), "already been consumed")
}

func TestImageEditorReturnTokenRejectsExternalReturnURL(t *testing.T) {
	t.Parallel()
	handler, ctx := newImageEditorHandlerTest(t)
	input := &CreateImageEditorReturnTokenInput{}
	input.Body.WorkspaceID = "workspace-1"
	input.Body.ReturnURL = "https://example.com/steal"
	input.Body.MaxSelection = 1
	_, err := handler.createReturnToken(ctx, input)
	require.Error(t, err)
	require.Contains(t, err.Error(), "same-origin")
}

func TestImageEditorReturnTokenEnforcesComposerMIMEConstraints(t *testing.T) {
	t.Parallel()
	handler, ctx := newImageEditorHandlerTest(t)
	_, err := handler.db.NewInsert().Model(&models.MediaAttachment{
		ID:               "export-jpeg",
		WorkspaceID:      "workspace-1",
		FilePath:         "export.jpg",
		MimeType:         "image/jpeg",
		ProcessingStatus: mediaReadyStatus,
		OriginalFilename: "export.jpg",
		FileHash:         "export-jpeg-hash",
		Source:           "image_editor_export",
		AssetKind:        "library",
	}).Exec(ctx)
	require.NoError(t, err)

	create := &CreateImageEditorReturnTokenInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.ReturnURL = "/"
	create.Body.MaxSelection = 1
	create.Body.Constraints = map[string]any{"allowed_mimes": []string{"image/png"}}
	token, err := handler.createReturnToken(ctx, create)
	require.NoError(t, err)

	complete := &CompleteImageEditorReturnTokenInput{Token: token.Body.Token}
	complete.Body.MediaIDs = []string{"export-jpeg"}
	_, err = handler.completeReturnToken(ctx, complete)
	require.Error(t, err)
	require.Contains(t, err.Error(), "format is not supported")
}

func TestPublicImageEditorTemplatesExposeOnlyBuiltins(t *testing.T) {
	t.Parallel()
	handler, _ := newImageEditorHandlerTest(t)
	handler.enabled = false

	response, err := handler.listPublicTemplates(context.Background(), &struct{}{})

	require.NoError(t, err)
	require.NotEmpty(t, response.Body.Templates)
	for _, template := range response.Body.Templates {
		require.True(t, template.BuiltIn)
		require.Empty(t, template.WorkspaceID)
	}
}

func TestImageEditorRejectsCrossWorkspacePreviewReferences(t *testing.T) {
	t.Parallel()
	handler, ctx := newImageEditorHandlerTest(t)
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
		Source:           "image_editor_edit",
		AssetKind:        "design_preview",
	}).Exec(ctx)
	require.NoError(t, err)

	create := &CreateImageEditorDesignInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.Title = "Preview ownership"
	create.Body.PresetKey = "instagram-square"
	design, err := handler.createDesign(ctx, create)
	require.NoError(t, err)

	update := &UpdateImageEditorDesignInput{PathID: design.Body.ID}
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
	foreignRevisionReferences, err := handler.db.NewSelect().
		Model((*models.DesignRevisionMediaReference)(nil)).
		Where("media_id = ?", "foreign-preview").
		Count(ctx)
	require.NoError(t, err)
	require.Zero(t, foreignRevisionReferences)
}

func TestImageEditorRevisionPreviewAndRestorePointRoundTripExactHead(t *testing.T) {
	t.Parallel()
	handler, ctx := newImageEditorHandlerTest(t)
	media := []models.MediaAttachment{
		{
			ID: "source-target", WorkspaceID: "workspace-1", FilePath: "target.png",
			MimeType: "image/png", ProcessingStatus: mediaReadyStatus,
			OriginalFilename: "target.png", FileHash: "source-target-hash",
			Source: "upload", AssetKind: "library",
		},
		{
			ID: "source-current", WorkspaceID: "workspace-1", FilePath: "current.png",
			MimeType: "image/png", ProcessingStatus: mediaReadyStatus,
			OriginalFilename: "current.png", FileHash: "source-current-hash",
			Source: "upload", AssetKind: "library",
		},
		{
			ID: "preview-target", WorkspaceID: "workspace-1", FilePath: "target.webp",
			MimeType: "image/webp", ProcessingStatus: mediaReadyStatus,
			OriginalFilename: "target.webp", FileHash: "preview-target-hash",
			Source: "image_editor_edit", AssetKind: "design_preview",
		},
		{
			ID: "preview-current", WorkspaceID: "workspace-1", FilePath: "current.webp",
			MimeType: "image/webp", ProcessingStatus: mediaReadyStatus,
			OriginalFilename: "current.webp", FileHash: "preview-current-hash",
			Source: "image_editor_edit", AssetKind: "design_preview",
		},
	}
	_, err := handler.db.NewInsert().Model(&media).Exec(ctx)
	require.NoError(t, err)

	create := &CreateImageEditorDesignInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.Title = "Initial"
	create.Body.PresetKey = "instagram-square"
	created, err := handler.createDesign(ctx, create)
	require.NoError(t, err)

	targetUpdate := &UpdateImageEditorDesignInput{PathID: created.Body.ID}
	targetUpdate.Body.ExpectedRevision = created.Body.Revision
	targetUpdate.Body.Document = created.Body.Document
	targetUpdate.Body.Document.Title = "Target version"
	targetUpdate.Body.Document.Pages[0].Guides = &ImageEditorPageGuides{
		Horizontal: []float64{100},
		Vertical:   []float64{200},
	}
	targetUpdate.Body.Document.Pages[0].ColorGradeVersion = 1
	targetUpdate.Body.Document.Pages[0].ColorGrade = &ImageEditorColorGrade{
		Contrast: 0.14,
		Vibrance: 0.12,
	}
	targetUpdate.Body.Document.Pages[0].Background = &ImageEditorPageBackground{
		Type:    "image",
		Opacity: 1,
		Image: &ImageEditorPageBackgroundImage{
			MediaID: "source-target",
			Fit:     "cover",
		},
	}
	targetUpdate.Body.CoverPreviewID = "preview-target"
	target, err := handler.updateDesign(ctx, targetUpdate)
	require.NoError(t, err)
	require.Equal(t, targetUpdate.Body.Document.Pages[0].Guides, target.Body.Document.Pages[0].Guides)
	require.Equal(t, targetUpdate.Body.Document.Pages[0].ColorGrade, target.Body.Document.Pages[0].ColorGrade)

	checkpointInput := &CreateImageEditorCheckpointInput{PathID: created.Body.ID}
	checkpointInput.Body.Name = "Approved target"
	checkpointInput.Body.ExpectedRevision = target.Body.Revision
	checkpoint, err := handler.createCheckpoint(ctx, checkpointInput)
	require.NoError(t, err)
	require.Equal(t, "Owner", checkpoint.Body.Actor.Name)
	require.True(t, checkpoint.Body.Actor.IsCurrentUser)

	currentUpdate := &UpdateImageEditorDesignInput{PathID: created.Body.ID}
	currentUpdate.Body.ExpectedRevision = target.Body.Revision
	currentUpdate.Body.Document = target.Body.Document
	currentUpdate.Body.Document.Title = "Exact current head"
	currentUpdate.Body.Document.Pages[0].Guides = &ImageEditorPageGuides{
		Horizontal: []float64{300},
		Vertical:   []float64{400},
	}
	currentUpdate.Body.Document.Pages[0].Background.Image.MediaID = "source-current"
	currentUpdate.Body.CoverPreviewID = "preview-current"
	current, err := handler.updateDesign(ctx, currentUpdate)
	require.NoError(t, err)
	var checkpointRefs []models.DesignRevisionMediaReference
	require.NoError(t, handler.db.NewSelect().Model(&checkpointRefs).
		Where("revision_id = ?", checkpoint.Body.ID).OrderExpr("media_id ASC").Scan(ctx))
	require.Len(t, checkpointRefs, 2)
	require.Equal(t, []string{"preview-target", "source-target"}, []string{
		checkpointRefs[0].MediaID,
		checkpointRefs[1].MediaID,
	})

	staleCheckpoint := &CreateImageEditorCheckpointInput{PathID: created.Body.ID}
	staleCheckpoint.Body.Name = "Stale checkpoint"
	staleCheckpoint.Body.ExpectedRevision = target.Body.Revision
	_, err = handler.createCheckpoint(ctx, staleCheckpoint)
	require.ErrorContains(t, err, "changed elsewhere")

	preview, err := handler.getRevision(ctx, &GetImageEditorRevisionInput{
		PathID:     created.Body.ID,
		RevisionID: checkpoint.Body.ID,
	})
	require.NoError(t, err)
	require.Equal(t, "Target version", preview.Body.Document.Title)
	require.Equal(t, "preview-target", preview.Body.CoverPreviewMediaID)
	require.Equal(t, []float64{100}, preview.Body.Document.Pages[0].Guides.Horizontal)
	require.Equal(t, 1, preview.Body.Document.Pages[0].ColorGradeVersion)
	require.InDelta(t, 0.14, preview.Body.Document.Pages[0].ColorGrade.Contrast, 0.0001)

	restore := &RestoreImageEditorRevisionInput{
		PathID:     created.Body.ID,
		RevisionID: checkpoint.Body.ID,
	}
	trashTime := time.Now().UTC()
	for _, mediaID := range []string{"preview-target", "source-target"} {
		_, err = handler.db.NewUpdate().Model((*models.MediaAttachment)(nil)).
			Set("trashed_at = ?", trashTime).
			Set("purge_after = ?", trashTime.Add(time.Hour)).
			Set("trash_reason = 'test'").
			Where("id = ?", mediaID).
			Exec(ctx)
		require.NoError(t, err)
	}
	restore.Body.ExpectedRevision = target.Body.Revision
	_, err = handler.restoreRevision(ctx, restore)
	require.ErrorContains(t, err, "changed elsewhere")
	for _, mediaID := range []string{"preview-target", "source-target"} {
		var stillTrashed models.MediaAttachment
		require.NoError(t, handler.db.NewSelect().Model(&stillTrashed).Where("id = ?", mediaID).Scan(ctx))
		require.False(t, stillTrashed.TrashedAt.IsZero(), "conflicting restore must not revive %s", mediaID)
	}
	restore.Body.ExpectedRevision = current.Body.Revision
	restored, err := handler.restoreRevision(ctx, restore)
	require.NoError(t, err)
	require.Equal(t, current.Body.Revision+1, restored.Body.Revision)
	require.Equal(t, "Target version", restored.Body.Document.Title)
	require.Equal(t, "preview-target", restored.Body.CoverPreviewMediaID)
	require.Equal(t, []float64{100}, restored.Body.Document.Pages[0].Guides.Horizontal)
	for _, mediaID := range []string{"preview-target", "source-target"} {
		var revived models.MediaAttachment
		require.NoError(t, handler.db.NewSelect().Model(&revived).Where("id = ?", mediaID).Scan(ctx))
		require.True(t, revived.TrashedAt.IsZero(), "restore must revive %s", mediaID)
		require.True(t, revived.PurgeAfter.IsZero())
		require.Empty(t, revived.TrashReason)
	}

	revisions, err := handler.listRevisions(ctx, &ListImageEditorRevisionsInput{PathID: created.Body.ID})
	require.NoError(t, err)
	var restorePoint ImageEditorRevisionSummary
	for _, revision := range revisions.Body.Revisions {
		if revision.Kind == "restore_point" && revision.Revision == current.Body.Revision {
			restorePoint = revision
			break
		}
	}
	require.NotEmpty(t, restorePoint.ID)
	restorePointPreview, err := handler.getRevision(ctx, &GetImageEditorRevisionInput{
		PathID:     created.Body.ID,
		RevisionID: restorePoint.ID,
	})
	require.NoError(t, err)
	require.Equal(t, "Exact current head", restorePointPreview.Body.Document.Title)
	require.Equal(t, "preview-current", restorePointPreview.Body.CoverPreviewMediaID)
	require.Equal(t, []float64{300}, restorePointPreview.Body.Document.Pages[0].Guides.Horizontal)
	var restorePointRefs []models.DesignRevisionMediaReference
	require.NoError(t, handler.db.NewSelect().Model(&restorePointRefs).
		Where("revision_id = ?", restorePoint.ID).OrderExpr("media_id ASC").Scan(ctx))
	require.Len(t, restorePointRefs, 2)
	require.Equal(t, []string{"preview-current", "source-current"}, []string{
		restorePointRefs[0].MediaID,
		restorePointRefs[1].MediaID,
	})

	restoreBack := &RestoreImageEditorRevisionInput{
		PathID:     created.Body.ID,
		RevisionID: restorePoint.ID,
	}
	restoreBack.Body.ExpectedRevision = restored.Body.Revision
	for _, mediaID := range []string{"preview-current", "source-current"} {
		_, err = handler.db.NewUpdate().Model((*models.MediaAttachment)(nil)).
			Set("trashed_at = ?", trashTime).
			Set("purge_after = ?", trashTime.Add(time.Hour)).
			Set("trash_reason = 'test'").
			Where("id = ?", mediaID).
			Exec(ctx)
		require.NoError(t, err)
	}
	recovered, err := handler.restoreRevision(ctx, restoreBack)
	require.NoError(t, err)
	require.Equal(t, "Exact current head", recovered.Body.Document.Title)
	require.Equal(t, "preview-current", recovered.Body.CoverPreviewMediaID)
	require.Equal(t, []float64{300}, recovered.Body.Document.Pages[0].Guides.Horizontal)
	for _, mediaID := range []string{"preview-current", "source-current"} {
		var revived models.MediaAttachment
		require.NoError(t, handler.db.NewSelect().Model(&revived).Where("id = ?", mediaID).Scan(ctx))
		require.True(t, revived.TrashedAt.IsZero(), "restore point must revive %s", mediaID)
	}

	beforeConflict, err := handler.db.NewSelect().Model((*models.DesignRevision)(nil)).
		Where("design_document_id = ? AND kind = ?", created.Body.ID, "restore_point").
		Count(ctx)
	require.NoError(t, err)
	restore.Body.ExpectedRevision = restored.Body.Revision
	_, err = handler.restoreRevision(ctx, restore)
	require.ErrorContains(t, err, "changed elsewhere")
	afterConflict, err := handler.db.NewSelect().Model((*models.DesignRevision)(nil)).
		Where("design_document_id = ? AND kind = ?", created.Body.ID, "restore_point").
		Count(ctx)
	require.NoError(t, err)
	require.Equal(t, beforeConflict, afterConflict)
}

func TestImageEditorLegacyPageAndRevisionSnapshotsRemainReadable(t *testing.T) {
	t.Parallel()
	document := builtinImageEditorTemplates()[0].Document
	legacySnapshot, err := json.Marshal(document)
	require.NoError(t, err)
	compressed, err := gzipJSONForTest(legacySnapshot)
	require.NoError(t, err)
	decoded, err := decompressImageEditorSnapshot(compressed)
	require.NoError(t, err)
	require.Equal(t, document.Title, decoded.Document.Title)
	require.Empty(t, decoded.CoverPreviewMediaID)

	background := ImageEditorPageBackground{Type: "solid", Color: "#123456", Opacity: 1}
	encoded, err := json.Marshal(background)
	require.NoError(t, err)
	decodedBackground, guides, colorGradeVersion, colorGrade, err := decodeImageEditorPageState(string(encoded), "#ffffff")
	require.NoError(t, err)
	require.Equal(t, "#123456", decodedBackground.Color)
	require.Nil(t, guides)
	require.Zero(t, colorGradeVersion)
	require.Nil(t, colorGrade)
}
