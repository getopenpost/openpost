package handlers

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func mcpSeedMedia(t *testing.T, srv *mcpTestServer, id string, createdAt time.Time) {
	t.Helper()
	_, err := srv.db.NewInsert().Model(&models.MediaAttachment{
		ID: id, WorkspaceID: "ws-1", FilePath: id + ".jpg",
		MimeType: "image/jpeg", Size: 12, OriginalFilename: id + ".jpg",
		CreatedAt: createdAt,
	}).Exec(t.Context())
	require.NoError(t, err)
}

func TestMCPListMediaCursorPagination(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	base := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	mcpSeedMedia(t, srv, "media-page-1", base.Add(-2*time.Hour))
	mcpSeedMedia(t, srv, "media-page-2", base.Add(-1*time.Hour))
	mcpSeedMedia(t, srv, "media-page-3", base)

	first := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "media-page-first", mcpToolListMedia, map[string]any{
		"workspace_id": "ws-1", "limit": 2,
	}))
	require.Equal(t, float64(3), first["total_count"])
	require.Equal(t, true, first["has_more"])
	cursor, _ := first["next_cursor"].(string)
	require.NotEmpty(t, cursor)
	items := first["media"].([]any)
	require.Len(t, items, 2)
	require.Equal(t, "media-page-3", items[0].(map[string]any)["id"])

	second := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "media-page-second", mcpToolListMedia, map[string]any{
		"workspace_id": "ws-1", "limit": 2, "cursor": cursor,
	}))
	require.Equal(t, float64(3), second["total_count"])
	require.Equal(t, false, second["has_more"])
	rest := second["media"].([]any)
	require.Len(t, rest, 1)
	require.Equal(t, "media-page-1", rest[0].(map[string]any)["id"])

	invalid := mcpCallOperation(t, srv, "web-token", "media-page-bad", mcpToolListMedia, map[string]any{
		"workspace_id": "ws-1", "cursor": "not-a-cursor",
	})
	require.Contains(t, mcpErrorMessage(t, invalid), "cursor")
}

func TestMCPListPostEventsCursorPagination(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	ctx := t.Context()
	base := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	_, err := srv.db.NewInsert().Model(&models.Publication{
		ID: "publication-events-page", WorkspaceID: "ws-1", CreatedByID: "user-1",
		Title: "Paged", ContentProfile: models.ContentProfileShortText,
		SourceText: "Paged", SourceContent: "Paged", Status: models.PublicationStatusDraft,
		MetadataJSON: "{}", ReleasePlanJSON: "{}",
		CreatedAt: base.Add(-time.Hour),
	}).Exec(ctx)
	require.NoError(t, err)
	for index, id := range []string{"event-page-1", "event-page-2"} {
		_, err = srv.db.NewInsert().Model(&models.PublicationLifecycleEvent{
			ID: id, WorkspaceID: "ws-1", PublicationID: "publication-events-page",
			Type: "note", Status: "info", Message: "note",
			MetadataJSON: "{}", CreatedAt: base.Add(time.Duration(index) * time.Minute),
		}).Exec(ctx)
		require.NoError(t, err)
	}

	first := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "events-page-first", mcpToolPubEvents, map[string]any{
		"post_id": "publication-events-page", "limit": 2,
	}))
	require.Equal(t, float64(3), first["total_count"])
	require.Equal(t, true, first["has_more"])
	cursor, _ := first["next_cursor"].(string)
	require.NotEmpty(t, cursor)
	require.Len(t, first["events"].([]any), 2)

	second := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "events-page-second", mcpToolPubEvents, map[string]any{
		"post_id": "publication-events-page", "limit": 2, "cursor": cursor,
	}))
	require.Equal(t, float64(3), second["total_count"])
	require.Equal(t, false, second["has_more"])
	require.Len(t, second["events"].([]any), 1)
}

type mcpStubTokenSource struct{}

func (mcpStubTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	return "stub-token", nil
}

func TestMCPListVariantCommentsLimitTruncates(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	ctx := t.Context()
	_, err := srv.db.NewInsert().Model(&models.Publication{
		ID: "publication-comments-limit", WorkspaceID: "ws-1", CreatedByID: "user-1",
		Title: "Launch", ContentProfile: models.ContentProfileShortText,
		SourceText: "Launch", SourceContent: "Launch", Status: models.PublicationStatusPublished,
		MetadataJSON: "{}", ReleasePlanJSON: "{}",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Rendition{
		ID: "rendition-comments-limit", PublicationID: "publication-comments-limit",
		SocialAccountID: "account-1", Platform: "x", Profile: models.ContentProfileShortText,
		Body: "Launch", SettingsJSON: "{}", Status: models.RenditionStatusPublished,
		ExternalID: "external-1",
	}).Exec(ctx)
	require.NoError(t, err)
	srv.handler.SetTokenSource(mcpStubTokenSource{})
	srv.handler.SetProviderCatalog(map[string]platform.Adapter{"x": fakeCommentAdapter{comments: []platform.Comment{
		{ID: "c1", Text: "one"}, {ID: "c2", Text: "two"}, {ID: "c3", Text: "three"},
	}}}, false)

	out := mcpCallOperation(t, srv, "web-token", "comments-truncated", mcpToolComments, map[string]any{
		"variant_id": "rendition-comments-limit", "limit": 2,
	})
	require.Nil(t, out["error"])
	result := out["result"].(map[string]any)
	comments := result["structuredContent"].(map[string]any)["comments"].([]any)
	require.Len(t, comments, 2)
	text := result["content"].([]any)[0].(map[string]any)["text"].(string)
	require.Contains(t, text, "showing the first 2")

	full := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "comments-full", mcpToolComments, map[string]any{
		"variant_id": "rendition-comments-limit",
	}))
	require.Len(t, full["comments"].([]any), 3)

	invalid := mcpCallOperation(t, srv, "web-token", "comments-bad-limit", mcpToolComments, map[string]any{
		"variant_id": "rendition-comments-limit", "limit": 101,
	})
	require.Contains(t, mcpErrorMessage(t, invalid), "limit")
}
