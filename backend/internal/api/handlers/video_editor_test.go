package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/videoproject"
	"github.com/stretchr/testify/require"
)

func newVideoEditorHandlerTest(t *testing.T) (*VideoEditorHandler, context.Context) {
	t.Helper()
	db := createHandlerTestDB(t,
		(*models.User)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.MediaAttachment)(nil),
		(*models.VideoProject)(nil),
		(*models.VideoProjectAsset)(nil),
		(*models.VideoProjectRevision)(nil),
		(*models.VideoRevisionMediaIndexState)(nil),
		(*models.VideoReturnToken)(nil),
		(*models.MediaProvenance)(nil),
	)
	ctx := context.WithValue(context.Background(), middleware.UserIDKey, "user-1")
	users := []models.User{
		{ID: "user-1", Email: "owner@example.com", DisplayName: "Owner"},
		{ID: "user-2", Email: "editor@example.com", DisplayName: "Editor"},
	}
	_, err := db.NewInsert().Model(&users).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "Video"}).Exec(ctx)
	require.NoError(t, err)
	members := []models.WorkspaceMember{
		{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin},
		{WorkspaceID: "workspace-1", UserID: "user-2", Role: models.WorkspaceRoleEditor},
	}
	_, err = db.NewInsert().Model(&members).Exec(ctx)
	require.NoError(t, err)
	return NewVideoEditorHandler(db, testAuthenticator{}, "/video-editor-models"), ctx
}

func TestVideoProjectNamedRevisionPaginationReachesOlderVersions(t *testing.T) {
	t.Parallel()
	handler, ctx := newVideoEditorHandlerTest(t)
	create := &CreateVideoProjectInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.Document = emptyVideoProjectDocument("Pagination")
	created, err := handler.createProject(ctx, create)
	require.NoError(t, err)

	createdAt := time.Now().UTC().Add(-time.Hour)
	revisions := make([]models.VideoProjectRevision, 0, 105)
	for index := 0; index < 105; index++ {
		revisions = append(revisions, models.VideoProjectRevision{
			ID:             fmt.Sprintf("named-video-%03d", index),
			VideoProjectID: created.Body.ID,
			Revision:       index + 1,
			Kind:           "checkpoint",
			Name:           fmt.Sprintf("Named video %03d", index),
			Snapshot:       []byte{1},
			CreatedByID:    "user-1",
			CreatedAt:      createdAt,
		})
	}
	_, err = handler.db.NewInsert().Model(&revisions).Exec(ctx)
	require.NoError(t, err)

	cursor := ""
	seen := make(map[string]struct{}, len(revisions))
	for {
		page, err := handler.listRevisions(ctx, &ListVideoProjectRevisionsInput{
			PathID: created.Body.ID,
			Cursor: cursor,
			Limit:  19,
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
	require.Contains(t, seen, "named-video-000")
}

func TestVideoProjectRevisionListRejectsMalformedCursor(t *testing.T) {
	t.Parallel()
	handler, ctx := newVideoEditorHandlerTest(t)
	create := &CreateVideoProjectInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.Document = emptyVideoProjectDocument("Cursor validation")
	created, err := handler.createProject(ctx, create)
	require.NoError(t, err)

	_, err = handler.listRevisions(ctx, &ListVideoProjectRevisionsInput{
		PathID: created.Body.ID,
		Cursor: "not-a-valid-cursor",
	})
	require.Error(t, err)
	var statusError huma.StatusError
	require.ErrorAs(t, err, &statusError)
	require.Equal(t, 400, statusError.GetStatus())
}

func TestVideoReturnTokenCompletesAndConsumesExactlyOnce(t *testing.T) {
	t.Parallel()
	handler, ctx := newVideoEditorHandlerTest(t)
	now := time.Now().UTC()
	rawToken := "return-token"
	hash := sha256.Sum256([]byte(rawToken))
	_, err := handler.db.NewInsert().Model(&models.VideoProject{
		ID: "project-1", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		Title: "Project", SchemaVersion: 1, Revision: 1, DocumentJSON: "{}",
		CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = handler.db.NewInsert().Model(&models.MediaAttachment{
		ID: "media-1", WorkspaceID: "workspace-1", FilePath: "media-1.mp4",
		MimeType: "video/mp4", ProcessingStatus: mediaReadyStatus, Size: 1024,
		OriginalFilename: "portrait.mp4", FileHash: "hash-1", Source: "video_editor_export",
		AssetKind: "library", VideoProjectID: "project-1", Width: 1080, Height: 1920,
		DurationMS: 42_000, FrameRate: 30,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = handler.db.NewInsert().Model(&models.VideoReturnToken{
		ID: "token-1", TokenHash: hex.EncodeToString(hash[:]), WorkspaceID: "workspace-1",
		UserID: "user-1", ReturnURL: "/compose", Purpose: "post_media",
		ConstraintsJSON: `{
			"allowed_mimes":["video/mp4"], "max_width":1920, "max_height":1920,
			"max_duration_ms":60000, "max_file_size_bytes":2000000, "max_fps":60,
			"required_variants":["portrait"], "rendition_ids":["rendition-1"]
		}`,
		ResultJSON: `{"project_id":"","exports":[]}`, CreatedAt: now, ExpiresAt: now.Add(time.Hour),
	}).Exec(ctx)
	require.NoError(t, err)

	complete := &CompleteVideoReturnTokenInput{Token: rawToken}
	complete.Body.ProjectID = "project-1"
	complete.Body.Exports = []VideoReturnExport{{
		VariantID: "portrait", MediaID: "media-1", Width: 1080, Height: 1920,
		DurationMS: 42_050, RenditionIDs: []string{"rendition-1"},
	}}
	completed, err := handler.completeReturnToken(ctx, complete)
	require.NoError(t, err)
	require.Equal(t, "/compose", completed.Body.ReturnURL)
	_, err = handler.completeReturnToken(ctx, complete)
	require.Error(t, err)

	consumed, err := handler.consumeReturnToken(ctx, &ConsumeVideoReturnTokenInput{Token: rawToken})
	require.NoError(t, err)
	require.Equal(t, "workspace-1", consumed.Body.WorkspaceID)
	require.Equal(t, "project-1", consumed.Body.Result.ProjectID)
	require.Len(t, consumed.Body.Result.Exports, 1)
	_, err = handler.consumeReturnToken(ctx, &ConsumeVideoReturnTokenInput{Token: rawToken})
	require.Error(t, err)
}

func TestVideoProjectUpdateUsesOptimisticRevision(t *testing.T) {
	t.Parallel()
	handler, ctx := newVideoEditorHandlerTest(t)
	create := &CreateVideoProjectInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.ClientRequestID = "request-1"
	create.Body.Document = emptyVideoProjectDocument("First")
	created, err := handler.createProject(ctx, create)
	require.NoError(t, err)
	require.Equal(t, 1, created.Body.Revision)

	update := &UpdateVideoProjectInput{PathID: created.Body.ID}
	update.Body.ExpectedRevision = 1
	update.Body.Document = emptyVideoProjectDocument("Second")
	updated, err := handler.updateProject(ctx, update)
	require.NoError(t, err)
	require.Equal(t, 2, updated.Body.Revision)
	require.Equal(t, "Second", updated.Body.Document.Title)

	update.Body.Document = emptyVideoProjectDocument("Stale")
	_, err = handler.updateProject(ctx, update)
	require.ErrorContains(t, err, "latest revision is 2")

	again, err := handler.createProject(ctx, create)
	require.NoError(t, err)
	require.Equal(t, created.Body.ID, again.Body.ID)
	require.Equal(t, 2, again.Body.Revision)
}

func TestVideoProjectRejectsCrossWorkspaceRevisionMediaOwnership(t *testing.T) {
	t.Parallel()

	handler, ctx := newVideoEditorHandlerTest(t)
	_, err := handler.db.NewInsert().Model(&models.Workspace{ID: "workspace-2", Name: "Other"}).Exec(ctx)
	require.NoError(t, err)
	_, err = handler.db.NewInsert().Model(&models.MediaAttachment{
		ID: "foreign-video-media", WorkspaceID: "workspace-2", FilePath: "foreign.mp4",
		MimeType: "video/mp4", ProcessingStatus: mediaReadyStatus, Size: 100,
		OriginalFilename: "foreign.mp4", FileHash: "foreign-video-hash",
		Source: "video_editor_source", AssetKind: "library",
	}).Exec(ctx)
	require.NoError(t, err)

	create := &CreateVideoProjectInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.Document = videoDocumentWithMedia("Foreign source", "foreign-video-media")
	_, err = handler.createProject(ctx, create)
	require.ErrorContains(t, err, "belong to the workspace")

	create.Body.Document = emptyVideoProjectDocument("Foreign cover")
	create.Body.CoverPreviewMediaID = "foreign-video-media"
	_, err = handler.createProject(ctx, create)
	require.ErrorContains(t, err, "belong to the workspace")

	assetCount, err := handler.db.NewSelect().Model((*models.VideoProjectAsset)(nil)).
		Where("media_id = ?", "foreign-video-media").
		Count(ctx)
	require.NoError(t, err)
	require.Zero(t, assetCount, "runtime validation must reject cross-workspace current and revision pins")
}

func TestVideoProjectRevisionPreviewAndRestorePointRoundTripExactHead(t *testing.T) {
	t.Parallel()
	handler, ownerCtx := newVideoEditorHandlerTest(t)
	editorCtx := context.WithValue(context.Background(), middleware.UserIDKey, "user-2")
	media := []models.MediaAttachment{
		{
			ID: "target-source", WorkspaceID: "workspace-1", FilePath: "target.mp4",
			MimeType: "video/mp4", ProcessingStatus: mediaReadyStatus, Size: 100,
			OriginalFilename: "target.mp4", FileHash: "target-source-hash",
			Source: "video_editor_source", AssetKind: "library", RetentionClass: "temporary",
		},
		{
			ID: "current-source", WorkspaceID: "workspace-1", FilePath: "current.mp4",
			MimeType: "video/mp4", ProcessingStatus: mediaReadyStatus, Size: 100,
			OriginalFilename: "current.mp4", FileHash: "current-source-hash",
			Source: "video_editor_source", AssetKind: "library", RetentionClass: "temporary",
		},
		{
			ID: "target-cover", WorkspaceID: "workspace-1", FilePath: "target.webp",
			MimeType: "image/webp", ProcessingStatus: mediaReadyStatus, Size: 10,
			OriginalFilename: "target.webp", FileHash: "target-cover-hash",
			Source: "video_editor_preview", AssetKind: "video_preview", RetentionClass: "temporary",
		},
		{
			ID: "current-cover", WorkspaceID: "workspace-1", FilePath: "current.webp",
			MimeType: "image/webp", ProcessingStatus: mediaReadyStatus, Size: 10,
			OriginalFilename: "current.webp", FileHash: "current-cover-hash",
			Source: "video_editor_preview", AssetKind: "video_preview", RetentionClass: "temporary",
		},
	}
	_, err := handler.db.NewInsert().Model(&media).Exec(ownerCtx)
	require.NoError(t, err)

	create := &CreateVideoProjectInput{}
	create.Body.WorkspaceID = "workspace-1"
	create.Body.Document = videoDocumentWithMedia("Target version", "target-source")
	create.Body.CoverPreviewMediaID = "target-cover"
	created, err := handler.createProject(ownerCtx, create)
	require.NoError(t, err)

	checkpointInput := &CreateVideoProjectCheckpointInput{PathID: created.Body.ID}
	checkpointInput.Body.Name = "Approved target"
	checkpointInput.Body.ExpectedRevision = created.Body.Revision
	checkpoint, err := handler.createCheckpoint(ownerCtx, checkpointInput)
	require.NoError(t, err)
	require.Equal(t, "Owner", checkpoint.Body.Actor.Name)

	update := &UpdateVideoProjectInput{PathID: created.Body.ID}
	update.Body.ExpectedRevision = created.Body.Revision
	update.Body.Document = videoDocumentWithMedia("Exact current head", "current-source")
	update.Body.CoverPreviewMediaID = "current-cover"
	current, err := handler.updateProject(editorCtx, update)
	require.NoError(t, err)
	staleCheckpoint := &CreateVideoProjectCheckpointInput{PathID: created.Body.ID}
	staleCheckpoint.Body.Name = "Stale checkpoint"
	staleCheckpoint.Body.ExpectedRevision = created.Body.Revision
	_, err = handler.createCheckpoint(ownerCtx, staleCheckpoint)
	require.ErrorContains(t, err, "latest revision")

	revisions, err := handler.listRevisions(editorCtx, &ListVideoProjectRevisionsInput{PathID: created.Body.ID})
	require.NoError(t, err)
	var editorAutosave VideoProjectRevisionSummary
	for _, revision := range revisions.Body.Revisions {
		if revision.Revision == current.Body.Revision && revision.Kind == "autosave" {
			editorAutosave = revision
			break
		}
	}
	require.Equal(t, "Editor", editorAutosave.Actor.Name)
	require.True(t, editorAutosave.Actor.IsCurrentUser)

	preview, err := handler.getRevision(editorCtx, &GetVideoProjectRevisionInput{
		PathID:     created.Body.ID,
		RevisionID: checkpoint.Body.ID,
	})
	require.NoError(t, err)
	require.Equal(t, "Target version", preview.Body.Document.Title)
	require.Equal(t, "target-cover", preview.Body.CoverPreviewMediaID)

	restore := &RestoreVideoProjectRevisionInput{
		PathID:     created.Body.ID,
		RevisionID: checkpoint.Body.ID,
	}
	trashTime := time.Now().UTC()
	for _, mediaID := range []string{"target-source", "target-cover"} {
		_, err = handler.db.NewUpdate().Model((*models.MediaAttachment)(nil)).
			Set("trashed_at = ?", trashTime).
			Set("purge_after = ?", trashTime.Add(time.Hour)).
			Set("trash_reason = 'test'").
			Where("id = ?", mediaID).
			Exec(editorCtx)
		require.NoError(t, err)
	}
	restore.Body.ExpectedRevision = created.Body.Revision
	_, err = handler.restoreRevision(editorCtx, restore)
	require.ErrorContains(t, err, "latest revision")
	for _, mediaID := range []string{"target-source", "target-cover"} {
		var stillTrashed models.MediaAttachment
		require.NoError(t, handler.db.NewSelect().Model(&stillTrashed).Where("id = ?", mediaID).Scan(editorCtx))
		require.False(t, stillTrashed.TrashedAt.IsZero(), "conflicting restore must not revive %s", mediaID)
	}
	restore.Body.ExpectedRevision = current.Body.Revision
	restored, err := handler.restoreRevision(editorCtx, restore)
	require.NoError(t, err)
	require.Equal(t, current.Body.Revision+1, restored.Body.Revision)
	require.Equal(t, "Target version", restored.Body.Document.Title)
	require.Equal(t, "target-cover", restored.Body.CoverPreviewMediaID)
	for _, mediaID := range []string{"target-source", "target-cover"} {
		var revived models.MediaAttachment
		require.NoError(t, handler.db.NewSelect().Model(&revived).Where("id = ?", mediaID).Scan(editorCtx))
		require.True(t, revived.TrashedAt.IsZero(), "restore must revive %s", mediaID)
		require.True(t, revived.PurgeAfter.IsZero())
		require.Empty(t, revived.TrashReason)
	}

	revisions, err = handler.listRevisions(editorCtx, &ListVideoProjectRevisionsInput{PathID: created.Body.ID})
	require.NoError(t, err)
	var restorePoint VideoProjectRevisionSummary
	for _, revision := range revisions.Body.Revisions {
		if revision.Kind == "restore_point" && revision.Revision == current.Body.Revision {
			restorePoint = revision
			break
		}
	}
	require.NotEmpty(t, restorePoint.ID)
	restorePointPreview, err := handler.getRevision(editorCtx, &GetVideoProjectRevisionInput{
		PathID:     created.Body.ID,
		RevisionID: restorePoint.ID,
	})
	require.NoError(t, err)
	require.Equal(t, "Exact current head", restorePointPreview.Body.Document.Title)
	require.Equal(t, "current-cover", restorePointPreview.Body.CoverPreviewMediaID)

	var protectedAssets []models.VideoProjectAsset
	require.NoError(t, handler.db.NewSelect().Model(&protectedAssets).
		Where("video_project_id = ? AND usage = ?", created.Body.ID, "revision:"+restorePoint.ID).
		OrderExpr("media_id ASC").Scan(editorCtx))
	require.Len(t, protectedAssets, 2)
	require.Equal(t, []string{"current-cover", "current-source"}, []string{
		protectedAssets[0].MediaID,
		protectedAssets[1].MediaID,
	})

	restoreBack := &RestoreVideoProjectRevisionInput{
		PathID:     created.Body.ID,
		RevisionID: restorePoint.ID,
	}
	restoreBack.Body.ExpectedRevision = restored.Body.Revision
	for _, mediaID := range []string{"current-source", "current-cover"} {
		_, err = handler.db.NewUpdate().Model((*models.MediaAttachment)(nil)).
			Set("trashed_at = ?", trashTime).
			Set("purge_after = ?", trashTime.Add(time.Hour)).
			Set("trash_reason = 'test'").
			Where("id = ?", mediaID).
			Exec(editorCtx)
		require.NoError(t, err)
	}
	recovered, err := handler.restoreRevision(editorCtx, restoreBack)
	require.NoError(t, err)
	require.Equal(t, "Exact current head", recovered.Body.Document.Title)
	require.Equal(t, "current-cover", recovered.Body.CoverPreviewMediaID)
	for _, mediaID := range []string{"current-source", "current-cover"} {
		var revived models.MediaAttachment
		require.NoError(t, handler.db.NewSelect().Model(&revived).Where("id = ?", mediaID).Scan(editorCtx))
		require.True(t, revived.TrashedAt.IsZero(), "restore point must revive %s", mediaID)
	}

	beforeConflict, err := handler.db.NewSelect().Model((*models.VideoProjectRevision)(nil)).
		Where("video_project_id = ? AND kind = ?", created.Body.ID, "restore_point").Count(editorCtx)
	require.NoError(t, err)
	restore.Body.ExpectedRevision = restored.Body.Revision
	_, err = handler.restoreRevision(editorCtx, restore)
	require.ErrorContains(t, err, "latest revision")
	afterConflict, err := handler.db.NewSelect().Model((*models.VideoProjectRevision)(nil)).
		Where("video_project_id = ? AND kind = ?", created.Body.ID, "restore_point").Count(editorCtx)
	require.NoError(t, err)
	require.Equal(t, beforeConflict, afterConflict)
}

func TestVideoProjectLegacyRevisionSnapshotRemainsReadable(t *testing.T) {
	t.Parallel()
	document := emptyVideoProjectDocument("Legacy")
	legacy, err := json.Marshal(document)
	require.NoError(t, err)
	compressed, err := gzipJSONForTest(legacy)
	require.NoError(t, err)
	decoded, err := decompressVideoProjectSnapshot(compressed)
	require.NoError(t, err)
	require.Equal(t, document.Title, decoded.Document.Title)
	require.Empty(t, decoded.CoverPreviewMediaID)
}

func TestVideoEditorSyncPlanReusesWorkspaceMediaAndCountsMissingHashesOnce(t *testing.T) {
	t.Parallel()
	handler, ctx := newVideoEditorHandlerTest(t)
	reusedHash := strings.Repeat("a", 64)
	missingHash := strings.Repeat("b", 64)
	_, err := handler.db.NewInsert().Model(&models.MediaAttachment{
		ID: "media-reused", WorkspaceID: "workspace-1", FilePath: "source.mp4",
		MimeType: "video/mp4", ProcessingStatus: mediaReadyStatus, Size: 1024,
		OriginalFilename: "source.mp4", FileHash: reusedHash, AssetKind: "library",
	}).Exec(ctx)
	require.NoError(t, err)

	input := &PlanVideoEditorSyncInput{WorkspaceID: "workspace-1"}
	input.Body.Sources = []VideoEditorSyncSource{
		{SourceID: "reused", SHA256: reusedHash, SizeBytes: 1024, MIMEType: "video/mp4", OriginalName: "source.mp4"},
		{SourceID: "missing-a", SHA256: missingHash, SizeBytes: 2048, MIMEType: "video/mp4", OriginalName: "a.mp4"},
		{SourceID: "missing-b", SHA256: missingHash, SizeBytes: 2048, MIMEType: "video/mp4", OriginalName: "b.mp4"},
	}
	result, err := handler.planSync(ctx, input)
	require.NoError(t, err)
	require.True(t, result.Body.Allowed)
	require.Equal(t, int64(2048), result.Body.AdditionalBytes)
	require.Equal(t, []string{"missing-a", "missing-b"}, result.Body.MissingSourceIDs)
	require.Equal(t, []VideoEditorSyncReuse{{SourceID: "reused", MediaID: "media-reused"}}, result.Body.Reused)
	require.Nil(t, result.Body.Storage.LimitBytes)
}

func TestVideoReturnTokenRejectsMissingRequiredVariant(t *testing.T) {
	t.Parallel()
	handler, ctx := newVideoEditorHandlerTest(t)
	now := time.Now().UTC()
	rawToken := "required-variant-token"
	hash := sha256.Sum256([]byte(rawToken))
	_, err := handler.db.NewInsert().Model(&models.VideoProject{
		ID: "project-1", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		Title: "Project", SchemaVersion: 1, Revision: 1, DocumentJSON: "{}",
		CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = handler.db.NewInsert().Model(&models.VideoReturnToken{
		ID: "token-1", TokenHash: hex.EncodeToString(hash[:]), WorkspaceID: "workspace-1",
		UserID: "user-1", ReturnURL: "/compose", Purpose: "post_media",
		ConstraintsJSON: `{"required_variants":["portrait"]}`,
		ResultJSON:      `{"project_id":"","exports":[]}`,
		CreatedAt:       now, ExpiresAt: now.Add(time.Hour),
	}).Exec(ctx)
	require.NoError(t, err)

	input := &CompleteVideoReturnTokenInput{Token: rawToken}
	input.Body.ProjectID = "project-1"
	input.Body.Exports = []VideoReturnExport{{VariantID: "square", MediaID: "missing"}}
	_, err = handler.completeReturnToken(ctx, input)
	require.ErrorContains(t, err, "required format")
}

func TestNormalizeVideoReturnURLRequiresSameOriginPath(t *testing.T) {
	t.Parallel()
	value, err := normalizeVideoReturnURL("")
	require.NoError(t, err)
	require.Equal(t, "/", value)
	value, err = normalizeVideoReturnURL("/compose?mode=short-video")
	require.NoError(t, err)
	require.Equal(t, "/compose?mode=short-video", value)
	for _, value := range []string{"https://example.com/compose", "//example.com", "/compose\nLocation: bad"} {
		_, err := normalizeVideoReturnURL(value)
		require.Error(t, err)
	}
}

func TestStockUploadProvenanceIsRequiredAndValidated(t *testing.T) {
	t.Parallel()
	provenance := &videoproject.StockMediaProvenance{
		Provider: "pexels", ExternalID: "asset-1",
		SourceURL: "https://example.com/source", CreatorName: "Creator",
		CreatorURL: "https://example.com/creator", LicenseName: "Pexels",
		LicenseURL: "https://example.com/license", AttributionText: "Creator / Pexels",
	}
	require.NoError(t, validateStockUploadProvenance("stock_import", provenance))
	require.ErrorContains(t, validateStockUploadProvenance("stock_import", nil), "require")
	require.ErrorContains(t, validateStockUploadProvenance("upload", provenance), "only")
	invalid := *provenance
	invalid.SourceURL = "http://example.com/source"
	require.ErrorContains(t, validateStockUploadProvenance("stock_import", &invalid), "HTTPS")
}

func emptyVideoProjectDocument(title string) videoproject.Document {
	return videoproject.Document{
		SchemaVersion: 1,
		Title:         title,
		Timebase: videoproject.Timebase{
			TicksPerSecond: videoproject.TicksPerSecond,
			FPSNumerator:   30,
			FPSDenominator: 1,
		},
		Sources:         map[string]videoproject.Source{},
		PrimarySequence: []videoproject.PrimarySequenceClip{},
		VisualTracks:    []videoproject.VisualTrack{},
		AudioTracks:     []videoproject.AudioTrack{},
		CaptionTracks:   []videoproject.CaptionTrack{},
		Variants: []videoproject.VideoVariant{
			{ID: "portrait", Name: "Portrait", Width: 1080, Height: 1920, BackgroundColor: "#000000"},
			{ID: "feed-portrait", Name: "Feed portrait", Width: 1080, Height: 1350, BackgroundColor: "#000000"},
			{ID: "square", Name: "Square", Width: 1080, Height: 1080, BackgroundColor: "#000000"},
			{ID: "landscape", Name: "Landscape", Width: 1920, Height: 1080, BackgroundColor: "#000000"},
		},
		Markers: []videoproject.TimelineMarker{},
		ExportDefaults: videoproject.ExportDefaults{
			VariantIDs: []string{"portrait"},
			Format:     "mp4", VideoCodec: "avc", AudioCodec: "aac",
			FrameRate:    videoproject.ExportFrameRate{Numerator: 30, Denominator: 1},
			VideoBitrate: 8_000_000, AudioBitrate: 128_000,
		},
	}
}

func videoDocumentWithMedia(title string, mediaID string) videoproject.Document {
	document := emptyVideoProjectDocument(title)
	document.Sources["source"] = videoproject.Source{
		ID:           "source",
		Kind:         "video",
		Locator:      videoproject.SourceLocator{Type: "openpost-media", MediaID: mediaID},
		OriginalName: title + ".mp4",
		MIMEType:     "video/mp4",
		SizeBytes:    100,
		DurationUS:   10_000_000,
		Width:        1920,
		Height:       1080,
	}
	document.PrimarySequence = []videoproject.PrimarySequenceClip{{
		ID: "clip", SourceID: "source", Mode: "source",
		SourceInUS: 0, SourceOutUS: 10_000_000, Speed: 1,
		Video: videoproject.VideoPresentation{
			PositionX: 0.5, PositionY: 0.5, Scale: 1, Opacity: 1,
			Crop:        videoproject.CropRectangle{Width: 1, Height: 1},
			BorderColor: "#000000", Background: "#000000",
		},
		Audio:   videoproject.ClipAudioSettings{GainDB: 0},
		Effects: []videoproject.VideoEffect{},
	}}
	return document
}
