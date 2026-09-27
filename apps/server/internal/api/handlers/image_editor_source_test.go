package handlers

import (
	"testing"

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
