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

	structured := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "metrics-stored", mcpToolPostMetrics, map[string]any{
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

	missing := mcpCallOperation(t, srv, "web-token", "metrics-missing", mcpToolPostMetrics, map[string]any{
		"post_id": "no-such-post",
	})
	require.Contains(t, mcpErrorMessage(t, missing), "not found")
}

func TestMCPGetDashboardLinkBuildsAppURLs(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)

	post := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "link-post", mcpToolDashboardLink, map[string]any{
		"workspace_id": "ws-1", "kind": "post", "id": "post-123",
	}))
	require.Equal(t, "https://app.openpost.test/publications/post-123", post["url"])

	media := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "link-media", mcpToolDashboardLink, map[string]any{
		"workspace_id": "ws-1", "kind": "media",
	}))
	require.Equal(t, "https://app.openpost.test/media", media["url"])

	account := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "link-account", mcpToolDashboardLink, map[string]any{
		"workspace_id": "ws-1", "kind": "account",
	}))
	require.Equal(t, "https://app.openpost.test/settings?tab=accounts", account["url"])

	calendar := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "link-calendar", mcpToolDashboardLink, map[string]any{
		"workspace_id": "ws-1", "kind": "calendar",
	}))
	require.Equal(t, "https://app.openpost.test/calendar", calendar["url"])

	missingID := mcpCallOperation(t, srv, "web-token", "link-no-id", mcpToolDashboardLink, map[string]any{
		"workspace_id": "ws-1", "kind": "post",
	})
	require.Contains(t, mcpErrorMessage(t, missingID), "id is required")

	badKind := mcpCallOperation(t, srv, "web-token", "link-bad-kind", mcpToolDashboardLink, map[string]any{
		"workspace_id": "ws-1", "kind": "orbit",
	})
	require.Contains(t, mcpErrorMessage(t, badKind), "one of")
}

func TestMCPSearchDocsFindsGuides(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)

	structured := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "docs-accounts", mcpToolSearchDocs, map[string]any{
		"query": "connect a social account", "limit": 2,
	}))
	results := structured["results"].([]any)
	require.Len(t, results, 2)
	first := results[0].(map[string]any)
	require.NotEmpty(t, first["title"])
	require.NotEmpty(t, first["path"])
	require.NotEmpty(t, first["snippet"])

	empty := mcpCallOperation(t, srv, "web-token", "docs-empty", mcpToolSearchDocs, map[string]any{
		"query": "   ",
	})
	require.Contains(t, mcpErrorMessage(t, empty), "query is required")

	overLimit := mcpCallOperation(t, srv, "web-token", "docs-limit", mcpToolSearchDocs, map[string]any{
		"query": "schedule", "limit": 11,
	})
	require.Contains(t, mcpErrorMessage(t, overLimit), "limit")
}

func TestMCPToolDescriptionsCrossLinkNextSteps(t *testing.T) {
	t.Parallel()

	descriptions := map[string]string{}
	for _, operation := range mcpOperationCatalog() {
		name, _ := operation.Descriptor["name"].(string)
		text, _ := operation.Descriptor["description"].(string)
		descriptions[name] = text
	}
	require.Contains(t, descriptions[mcpToolProviders], "list_accounts")
	require.Contains(t, descriptions[mcpToolProviders], "get_provider_readiness")
	require.Contains(t, descriptions[mcpToolAccounts], "list_provider_catalog")
	require.Contains(t, descriptions[mcpToolAccounts], "get_provider_readiness")
	require.Contains(t, descriptions[mcpToolReadiness], "list_provider_catalog")
	require.Contains(t, descriptions[mcpToolReadiness], "list_accounts")
	require.Contains(t, descriptions[mcpToolListPubs], "retry_failed_variants")
	require.Contains(t, descriptions[mcpToolListPubs], "get_post")
	require.Contains(t, descriptions[mcpToolValidatePub], "retry_failed_variants")
	require.Contains(t, descriptions[mcpToolValidatePub], "get_post")
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
