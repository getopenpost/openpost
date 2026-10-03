package handlers

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/api/middleware"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestImageEditorReopensSourceDesignUntilTrashed(t *testing.T) {
	handler, ctx := newImageEditorHandlerTest(t)
	_, err := handler.db.NewInsert().Model(&models.MediaAttachment{
		ID: "source-image", WorkspaceID: "workspace-1", FilePath: "source.png", MimeType: "image/png", ProcessingStatus: mediaReadyStatus, OriginalFilename: "source.png", FileHash: "source-hash", Source: "upload", AssetKind: "library",
	}).Exec(ctx)
	require.NoError(t, err)
	input := &CreateImageEditorDesignInput{}
	input.Body.WorkspaceID = "workspace-1"
	input.Body.Title = "Edit source"
	input.Body.PresetKey = "instagram-square"
	input.Body.SourceMediaID = "source-image"
	first, err := handler.createDesign(ctx, input)
	require.NoError(t, err)
	duplicate, err := handler.duplicateDesign(ctx, &DuplicateImageEditorDesignInput{PathID: first.Body.ID})
	require.NoError(t, err)
	reopened, err := handler.createDesign(ctx, input)
	require.NoError(t, err)
	require.Equal(t, first.Body.ID, reopened.Body.ID)
	_, err = handler.deleteDesign(ctx, &DeleteImageEditorDesignInput{PathID: first.Body.ID})
	require.NoError(t, err)
	replacement, err := handler.createDesign(ctx, input)
	require.NoError(t, err)
	require.NotEqual(t, first.Body.ID, replacement.Body.ID)
	require.NotEqual(t, duplicate.Body.ID, replacement.Body.ID)
}

func TestImageEditorRestorePreservesIndependentContentAndSourceOwner(t *testing.T) {
	handler, ctx := newImageEditorHandlerTest(t)
	_, err := handler.db.NewInsert().Model(&models.MediaAttachment{ID: "restore-source", WorkspaceID: "workspace-1", FilePath: "source.png", MimeType: "image/png", ProcessingStatus: mediaReadyStatus, OriginalFilename: "source.png", FileHash: "restore-hash", Source: "upload", AssetKind: "library"}).Exec(ctx)
	require.NoError(t, err)
	input := &CreateImageEditorDesignInput{}
	input.Body.WorkspaceID = "workspace-1"
	input.Body.Title = "Original edit"
	input.Body.PresetKey = "instagram-square"
	input.Body.SourceMediaID = "restore-source"
	original, err := handler.createDesign(ctx, input)
	require.NoError(t, err)
	_, err = handler.deleteDesign(ctx, &DeleteImageEditorDesignInput{PathID: original.Body.ID})
	require.NoError(t, err)
	replacement, err := handler.createDesign(ctx, input)
	require.NoError(t, err)
	viewer := context.WithValue(ctx, middleware.UserIDKey, "viewer-1")
	_, err = handler.restoreDesign(viewer, &DeleteImageEditorDesignInput{PathID: original.Body.ID})
	require.Error(t, err)
	outsider := context.WithValue(ctx, middleware.UserIDKey, "outsider")
	_, err = handler.restoreDesign(outsider, &DeleteImageEditorDesignInput{PathID: original.Body.ID})
	require.Error(t, err)
	restored, err := handler.restoreDesign(ctx, &DeleteImageEditorDesignInput{PathID: original.Body.ID})
	require.NoError(t, err)
	require.Equal(t, original.Body.Document, restored.Body.Document)
	require.Equal(t, original.Body.ID, restored.Body.ID)
	var record models.DesignDocument
	require.NoError(t, handler.db.NewSelect().Model(&record).Where("id = ?", original.Body.ID).Scan(ctx))
	require.Empty(t, record.SourceMediaID)
	references, err := handler.db.NewSelect().Model((*models.DesignMediaReference)(nil)).Where("design_document_id = ? AND media_id = ?", original.Body.ID, "restore-source").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, references)
	reopened, err := handler.createDesign(ctx, input)
	require.NoError(t, err)
	require.Equal(t, replacement.Body.ID, reopened.Body.ID)
	trash, err := handler.listDesigns(ctx, &ListImageEditorDesignsInput{WorkspaceID: "workspace-1", Trashed: true})
	require.NoError(t, err)
	require.Empty(t, trash.Body.Designs)
}
