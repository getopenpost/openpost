package handlers

import (
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"

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

	first := mcpStructuredContent(t, mcpCallOperation(t, srv, "media-page-first", mcpToolListMedia, map[string]any{
		"workspace_id": "ws-1", "limit": 2,
	}))
	require.Equal(t, float64(3), first["total_count"])
	require.Equal(t, true, first["has_more"])
	cursor, _ := first["next_cursor"].(string)
	require.NotEmpty(t, cursor)
	items := first["media"].([]any)
	require.Len(t, items, 2)
	require.Equal(t, "media-page-3", items[0].(map[string]any)["id"])
	require.Equal(t, "media-page-2", items[1].(map[string]any)["id"])

	second := mcpStructuredContent(t, mcpCallOperation(t, srv, "media-page-second", mcpToolListMedia, map[string]any{
		"workspace_id": "ws-1", "limit": 2, "cursor": cursor,
	}))
	require.Equal(t, float64(3), second["total_count"])
	require.Equal(t, false, second["has_more"])
	rest := second["media"].([]any)
	require.Len(t, rest, 1)
	require.Equal(t, "media-page-1", rest[0].(map[string]any)["id"])
	require.Equal(t, "", second["next_cursor"])

	invalid := mcpCallOperation(t, srv, "media-page-bad", mcpToolListMedia, map[string]any{
		"workspace_id": "ws-1", "cursor": "not-a-cursor",
	})
	require.Contains(t, mcpErrorMessage(t, invalid), "cursor")
}

func TestMCPGetPostMetricsReadsStoredSnapshots(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	ctx := t.Context()
	for _, model := range []any{
		(*models.AnalyticsRenditionSnapshot)(nil),
	} {
		_, err := srv.db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err := srv.db.NewInsert().Model(&models.Publication{
		ID: "publication-metrics", WorkspaceID: "ws-1", CreatedByID: "user-1",
		Title: "Metrics", ContentProfile: models.ContentProfileShortText,
		SourceText: "Metrics", SourceContent: "Metrics", Status: models.PublicationStatusPublished,
		MetadataJSON: "{}", ReleasePlanJSON: "{}",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Rendition{
		ID: "rendition-metrics-1", PublicationID: "publication-metrics",
		SocialAccountID: "account-1", TargetKey: "x:openpost", Platform: "x",
		Profile: models.ContentProfileShortText, Body: "Metrics",
		SettingsJSON: "{}", Status: models.RenditionStatusPublished, ExternalID: "external-1",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Rendition{
		ID: "rendition-metrics-2", PublicationID: "publication-metrics",
		SocialAccountID: "account-1", TargetKey: "x:openpost", Platform: "x",
		Profile: models.ContentProfileShortText, Body: "Metrics",
		SettingsJSON: "{}", Status: models.RenditionStatusPublished, ExternalID: "external-2",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.AnalyticsRenditionSnapshot{
		ID: "snapshot-metrics-1", WorkspaceID: "ws-1", PublicationID: "publication-metrics",
		RenditionID: "rendition-metrics-1", SocialAccountID: "account-1", Platform: "x",
		MetricsJSON:        `{"views":100,"reactions":5,"likes":3,"comments":2,"impressions":400,"reach":250}`,
		MetricMetadataJSON: "{}",
		CapturedAt:         time.Date(2026, 7, 3, 12, 0, 0, 0, time.UTC),
	}).Exec(ctx)
	require.NoError(t, err)

	structured := mcpStructuredContent(t, mcpCallOperation(t, srv, "metrics-stored", mcpToolPostMetrics, map[string]any{
		"post_id": "publication-metrics",
	}))
	require.Equal(t, "publication-metrics", structured["post_id"])
	variants := structured["variants"].([]any)
	require.Len(t, variants, 2)
	first := variants[0].(map[string]any)
	require.Equal(t, "rendition-metrics-1", first["variant_id"])
	require.Equal(t, float64(100), first["views"])
	require.Equal(t, float64(5), first["reactions"])
	require.Equal(t, float64(10), first["engagements"])
	require.Equal(t, float64(400), first["impressions"])
	require.Equal(t, float64(250), first["reach"])
	require.Contains(t, first["measured"], "views")
	require.Contains(t, first["measured"], "engagements")
	second := variants[1].(map[string]any)
	require.Equal(t, float64(0), second["views"])
	require.Empty(t, second["measured"])
	totals := structured["totals"].(map[string]any)
	require.Equal(t, float64(100), totals["views"])
	require.Equal(t, float64(10), totals["engagements"])

	missing := mcpCallOperation(t, srv, "metrics-missing", mcpToolPostMetrics, map[string]any{
		"post_id": "no-such-post",
	})
	require.Contains(t, mcpErrorMessage(t, missing), "not found")
}

func TestMCPSearchDocsFindsGuides(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)

	structured := mcpStructuredContent(t, mcpCallOperation(t, srv, "docs-accounts", mcpToolSearchDocs, map[string]any{
		"query": "connect a social account", "limit": 2,
	}))
	results := structured["results"].([]any)
	require.Len(t, results, 2)
	first := results[0].(map[string]any)
	require.NotEmpty(t, first["title"])
	require.NotEmpty(t, first["path"])
	require.NotEmpty(t, first["snippet"])
	foundAccounts := false
	for _, result := range results {
		entry := result.(map[string]any)
		require.True(t, strings.HasPrefix(entry["path"].(string), "/docs/"))
		if entry["path"] == "/docs/guides/accounts" {
			foundAccounts = true
			require.Contains(t, entry["title"], "Accounts")
			require.Contains(t, entry["snippet"], "social accounts")
		}
	}
	require.True(t, foundAccounts, "account-connection search must include the Accounts guide")

	empty := mcpCallOperation(t, srv, "docs-empty", mcpToolSearchDocs, map[string]any{
		"query": "   ",
	})
	require.Contains(t, mcpErrorMessage(t, empty), "query is required")

	overLimit := mcpCallOperation(t, srv, "docs-limit", mcpToolSearchDocs, map[string]any{
		"query": "schedule", "limit": 11,
	})
	require.Contains(t, mcpErrorMessage(t, overLimit), "limit")
}
