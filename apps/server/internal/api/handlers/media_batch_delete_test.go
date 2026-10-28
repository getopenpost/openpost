package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/stretchr/testify/require"
)

func TestMediaBatchDeletionAlreadyCompleteSupportsIdempotentReplay(t *testing.T) {
	t.Parallel()

	srv := newMediaDirectUploadTestServer(t, newFakeDirectUploadStorage(), entitlements.NewSelfHostedService())
	// The manual Trash path consults the reference-protection schema, so the
	// fixture must own it for a live item to reach native deletion.
	for _, model := range []any{
		(*models.Publication)(nil),
		(*models.PublicationAsset)(nil),
		(*models.PublicationSegment)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionMedia)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
		(*models.RenditionMediaDelivery)(nil),
		(*models.RenditionMediaDeliveryRelation)(nil),
		(*models.ScreenshotTemplateDesign)(nil),
		(*models.ScreenshotTemplateMediaReference)(nil),
		(*models.ScreenshotTemplateRecipeMediaReference)(nil),
		(*models.MediaGenerationRecipe)(nil),
		(*models.MediaTag)(nil),
		(*models.MediaTagAssignment)(nil),
		(*models.MediaCollection)(nil),
		(*models.MediaCollectionItem)(nil),
		(*models.DesignDocument)(nil),
		(*models.DesignPage)(nil),
		(*models.DesignRevision)(nil),
		(*models.DesignMediaReference)(nil),
		(*models.DesignRevisionMediaReference)(nil),
		(*models.DesignTemplate)(nil),
		(*models.DesignTemplateMediaReference)(nil),
		(*models.ProjectAsset)(nil),
		(*models.BrandKit)(nil),
		(*models.BrandFont)(nil),
		(*models.VideoProject)(nil),
	} {
		_, err := srv.db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}

	seededTrash := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	_, err := srv.db.NewInsert().Model(&models.MediaAttachment{
		ID: "live-delete", WorkspaceID: "ws-1", FilePath: "live-delete.png",
		OriginalFilename: "live-delete.png", MimeType: "image/png", Size: 10,
		ProcessingStatus: mediaReadyStatus,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.MediaAttachment{
		ID: "already-trashed", WorkspaceID: "ws-1", FilePath: "already-trashed.png",
		OriginalFilename: "already-trashed.png", MimeType: "image/png", Size: 10,
		ProcessingStatus: mediaReadyStatus, TrashedAt: seededTrash,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Workspace{ID: "ws-2", Name: "Other"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.MediaAttachment{
		ID: "foreign-trashed", WorkspaceID: "ws-2", FilePath: "foreign-trashed.png",
		OriginalFilename: "foreign-trashed.png", MimeType: "image/png", Size: 10,
		ProcessingStatus: mediaReadyStatus, TrashedAt: seededTrash,
	}).Exec(t.Context())
	require.NoError(t, err)

	deleteMedia := func(ids ...string) (*BatchDeleteMediaOutput, int, string) {
		response := srv.postJSON(t, "/api/v1/media/batch-delete", map[string]any{"media_ids": ids})
		var output BatchDeleteMediaOutput
		if response.Code == http.StatusOK {
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output.Body))
		}
		return &output, response.Code, response.Body.String()
	}

	// A live item must be deleted natively and carry a fresh Trash stamp.
	live, code, body := deleteMedia("live-delete")
	require.Equal(t, http.StatusOK, code, body)
	require.Equal(t, 1, live.Body.Deleted, "a live item must be deleted")
	require.Empty(t, live.Body.FailedIDs)
	var storedLive models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&storedLive).Where("id = ?", "live-delete").Scan(t.Context()))
	require.False(t, storedLive.TrashedAt.IsZero(), "a first deletion must write the Trash stamp")

	// Replaying that request must reuse the stored stamp rather than restamp it.
	replayed, code, body := deleteMedia("live-delete")
	require.Equal(t, http.StatusOK, code, body)
	require.Equal(t, 1, replayed.Body.Deleted, "an already-trashed item counts as a completed deletion")
	require.Empty(t, replayed.Body.FailedIDs)
	var replayedStored models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&replayedStored).Where("id = ?", "live-delete").Scan(t.Context()))
	require.True(t, replayedStored.TrashedAt.Equal(storedLive.TrashedAt), "replay must not restamp the existing Trash entry")

	// A replay after a lost response succeeds for an item trashed before the call.
	pretrashed, code, body := deleteMedia("already-trashed")
	require.Equal(t, http.StatusOK, code, body)
	require.Equal(t, 1, pretrashed.Body.Deleted)
	require.Empty(t, pretrashed.Body.FailedIDs)
	var pretrashedStored models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&pretrashedStored).Where("id = ?", "already-trashed").Scan(t.Context()))
	require.True(t, pretrashedStored.TrashedAt.Equal(seededTrash), "a pre-trashed replay must keep its original stamp")

	// Workspace authorization is decided before replay recognition.
	denied, code, body := deleteMedia("foreign-trashed")
	require.Equal(t, http.StatusOK, code, body)
	require.Equal(t, 0, denied.Body.Deleted)
	require.Equal(t, []string{"foreign-trashed"}, denied.Body.FailedIDs)
	var foreign models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&foreign).Where("id = ?", "foreign-trashed").Scan(t.Context()))
	require.True(t, foreign.TrashedAt.Equal(seededTrash), "a denied replay must not touch the foreign row")
}
