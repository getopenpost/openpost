package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/videoproject"
	"github.com/stretchr/testify/require"
)

func newVideoEditorHandlerTest(t *testing.T) (*VideoEditorHandler, context.Context) {
	t.Helper()
	db := createHandlerTestDB(t,
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.MediaAttachment)(nil),
		(*models.VideoProject)(nil),
		(*models.VideoProjectAsset)(nil),
		(*models.VideoProjectRevision)(nil),
		(*models.VideoReturnToken)(nil),
		(*models.MediaProvenance)(nil),
	)
	ctx := context.WithValue(context.Background(), middleware.UserIDKey, "user-1")
	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "Video"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	return NewVideoEditorHandler(db, testAuthenticator{}, true, "/video-editor-models"), ctx
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
