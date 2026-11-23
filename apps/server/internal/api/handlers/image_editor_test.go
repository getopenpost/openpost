package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestImageEditorTextRunsPreserveGraphemeRanges(t *testing.T) {
	t.Parallel()
	bold := 700
	italic := "italic"
	color := "#ff0000"
	value := ImageEditorTextValue{
		Text: "A👩🏽‍🚀e\u0301Z",
		Runs: []ImageEditorTextRun{{Start: 1, End: 3, FontWeight: &bold, FontStyle: &italic, Color: &color}},
	}
	require.True(t, imageEditorTextRunsValid(&value))
	encoded, err := json.Marshal(value)
	require.NoError(t, err)
	var decoded ImageEditorTextValue
	require.NoError(t, json.Unmarshal(encoded, &decoded))
	require.Equal(t, value.Runs, decoded.Runs)

	value.Runs[0].End = 5
	require.False(t, imageEditorTextRunsValid(&value), "ranges must end within grapheme count")
	value.Runs[0].End = 3
	value.Runs = append(value.Runs, ImageEditorTextRun{Start: 2, End: 4, Color: &color})
	require.False(t, imageEditorTextRunsValid(&value), "overlapping ranges must be rejected")
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

func TestPublicImageEditorTemplatesExposeOnlyBuiltins(t *testing.T) {
	t.Parallel()
	handler, ctx := newImageEditorHandlerTest(t)
	handler.enabled = false
	_, err := handler.db.NewInsert().Model(&models.DesignTemplate{
		ID: "private-template", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		Name: "Private launch template", SnapshotJSON: `{}`,
	}).Exec(ctx)
	require.NoError(t, err)

	response, err := handler.listPublicTemplates(context.Background(), &struct{}{})

	require.NoError(t, err)
	require.NotEmpty(t, response.Body.Templates)
	for _, template := range response.Body.Templates {
		require.True(t, template.BuiltIn)
		require.Empty(t, template.WorkspaceID)
		require.NotEqual(t, "private-template", template.ID, "public discovery must not expose workspace templates")
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
		Wheels: &ImageEditorColorWheels{
			OffsetHue: 120, OffsetAmount: 0.5, Gamma: 1, Gain: 1,
		},
		Curves: &ImageEditorColorCurves{MasterPoints: "[[0,0],[1,0.5]]"},
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
	// updateDesign reloads persisted pages through the same documentResponse as getDesign.
	grade := target.Body.Document.Pages[0].ColorGrade
	require.NotNil(t, grade)
	require.NotNil(t, grade.Wheels)
	require.Equal(t, 120.0, grade.Wheels.OffsetHue)
	require.Equal(t, 0.5, grade.Wheels.OffsetAmount)
	require.NotNil(t, grade.Curves)
	require.Equal(t, "[[0,0],[1,0.5]]", grade.Curves.MasterPoints)

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

func TestImageEditorRemoveCheckpointPreservesDesignAndOtherVersions(t *testing.T) {
	t.Parallel()
	handler, ctx := newImageEditorHandlerTest(t)
	create := &CreateImageEditorDesignInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.Title = "Keep current design"
	create.Body.PresetKey = "instagram-square"
	head, err := handler.createDesign(ctx, create)
	require.NoError(t, err)
	_, err = handler.db.NewInsert().Model(&models.MediaAttachment{ID: "checkpoint-media", WorkspaceID: "workspace-1", FilePath: "preview.webp", MimeType: "image/webp", ProcessingStatus: mediaReadyStatus, OriginalFilename: "preview.webp", FileHash: "checkpoint-hash", Source: "image_editor_edit", AssetKind: "design_preview"}).Exec(ctx)
	require.NoError(t, err)
	update := &UpdateImageEditorDesignInput{PathID: head.Body.ID}
	update.Body.ExpectedRevision = head.Body.Revision
	update.Body.Document = head.Body.Document
	update.Body.CoverPreviewID = "checkpoint-media"
	saved, err := handler.updateDesign(ctx, update)
	require.NoError(t, err)
	head.Body = saved.Body
	checkpoints := make([]ImageEditorRevisionSummary, 0, 2)
	for _, name := range []string{"Remove only this", "Keep this"} {
		input := &CreateImageEditorCheckpointInput{PathID: head.Body.ID}
		input.Body.Name = name
		input.Body.ExpectedRevision = head.Body.Revision
		saved, err := handler.createCheckpoint(ctx, input)
		require.NoError(t, err)
		checkpoints = append(checkpoints, saved.Body)
	}

	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.RegisterRoutes(api)
	for _, guard := range []struct {
		token  string
		query  string
		status int
	}{
		{"", "?confirm=true", http.StatusUnauthorized},
		{"other-workspace-token", "?confirm=true", http.StatusForbidden},
		{"web-token", "?confirm=false", http.StatusBadRequest},
	} {
		request := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, fmt.Sprintf("/api/v1/image-editor/designs/%s/revisions/%s%s", head.Body.ID, checkpoints[0].ID, guard.query), nil)
		if guard.token != "" {
			request.Header.Set("Authorization", "Bearer "+guard.token)
		}
		response := httptest.NewRecorder()
		e.ServeHTTP(response, request)
		require.Equal(t, guard.status, response.Code, response.Body.String())
	}
	request := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, fmt.Sprintf("/api/v1/image-editor/designs/%s/revisions/%s?confirm=true", head.Body.ID, checkpoints[0].ID), nil)
	request.Header.Set("Authorization", "Bearer web-token")
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	reader := NewImageEditorHandler(handler.db, testAuthenticator{}, true, "")
	list, err := reader.listRevisions(ctx, &ListImageEditorRevisionsInput{PathID: head.Body.ID})
	require.NoError(t, err)
	var keptIDs []string
	for _, revision := range list.Body.Revisions {
		if revision.Kind == "checkpoint" {
			keptIDs = append(keptIDs, revision.ID)
		}
	}
	require.Equal(t, []string{checkpoints[1].ID}, keptIDs)
	_, err = reader.getRevision(ctx, &GetImageEditorRevisionInput{PathID: head.Body.ID, RevisionID: checkpoints[0].ID})
	require.Error(t, err)
	kept, err := reader.getRevision(ctx, &GetImageEditorRevisionInput{PathID: head.Body.ID, RevisionID: checkpoints[1].ID})
	require.NoError(t, err)
	require.Equal(t, head.Body.Document, kept.Body.Document)
	current, err := reader.documentResponse(ctx, head.Body.ID)
	require.NoError(t, err)
	require.Equal(t, head.Body, *current)
	refs, err := handler.db.NewSelect().Model((*models.DesignRevisionMediaReference)(nil)).Where("revision_id = ?", checkpoints[0].ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, refs)
	refs, err = handler.db.NewSelect().Model((*models.DesignRevisionMediaReference)(nil)).Where("revision_id = ?", checkpoints[1].ID).Count(ctx)
	require.NoError(t, err)
	require.EqualValues(t, 1, refs)
	index, err := handler.db.NewSelect().Model((*models.DesignRevisionMediaIndexState)(nil)).Where("revision_id = ?", checkpoints[0].ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, index)
	mediaCount, err := reader.db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("id = ?", "checkpoint-media").Count(ctx)
	require.NoError(t, err)
	require.EqualValues(t, 1, mediaCount)
}
