package handlers

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

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
