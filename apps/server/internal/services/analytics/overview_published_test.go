package analytics

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

// TestOverviewPublishedCountsPublishedDestinations locks the documented
// definition of Summary.Published for getopenpost/openpost#361: it counts
// published destination outputs (renditions), not publications. One
// publication with two published renditions contributes 2, while a failed
// rendition on another published publication contributes 0. PublicationTotal
// carries the distinct-post count so readers can reconcile the tile with the
// Posts "Published" tab, which filters by publication status.
func TestOverviewPublishedCountsPublishedDestinations(t *testing.T) {
	t.Parallel()
	db := newAnalyticsTestDB(t)
	ctx := t.Context()
	account := seedAnalyticsAccount(t, db, "")
	secondAccount := models.SocialAccount{
		ID:              "account-2",
		WorkspaceID:     account.WorkspaceID,
		Slug:            "test-account-2",
		Platform:        account.Platform,
		AccountID:       "provider-account-2",
		AccountUsername: "person-2",
		AccessTokenEnc:  []byte("encrypted"),
		IsActive:        true,
		CreatedAt:       time.Now().UTC(),
	}
	_, err := db.NewInsert().Model(&secondAccount).Exec(ctx)
	require.NoError(t, err)

	now := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	published := seedAnalyticsPublication(t, db, account.WorkspaceID, "publication-published", now)
	for _, rendition := range []models.Rendition{
		{ID: "rendition-ok-1", PublicationID: published.ID, SocialAccountID: account.ID, Platform: account.Platform, Status: models.RenditionStatusPublished, CreatedAt: now, UpdatedAt: now},
		{ID: "rendition-ok-2", PublicationID: published.ID, SocialAccountID: secondAccount.ID, Platform: secondAccount.Platform, Status: models.RenditionStatusPublished, CreatedAt: now, UpdatedAt: now},
	} {
		_, err := db.NewInsert().Model(&rendition).Exec(ctx)
		require.NoError(t, err)
	}

	mixed := seedAnalyticsPublication(t, db, account.WorkspaceID, "publication-mixed", now)
	failed := models.Rendition{ID: "rendition-failed", PublicationID: mixed.ID, SocialAccountID: account.ID, Platform: account.Platform, Status: models.RenditionStatusFailed, CreatedAt: now, UpdatedAt: now}
	_, err = db.NewInsert().Model(&failed).Exec(ctx)
	require.NoError(t, err)

	service := NewService(db, staticTokenSource{})
	service.SetProvider("test", &fakeAnalyticsAdapter{support: platform.AnalyticsSupport{Account: true, Content: true}})
	service.now = func() time.Time { return now }

	overview, err := service.Overview(ctx, account.WorkspaceID, 30)
	require.NoError(t, err)

	require.Equal(t, 2, overview.Summary.Published, "Summary.Published counts published destination outputs")
	require.Equal(t, 2, overview.ContentTotal)
	require.Equal(t, 1, overview.PublicationTotal, "PublicationTotal counts distinct published posts")
	require.Len(t, overview.Content, 2)
	for _, item := range overview.Content {
		require.Equal(t, published.ID, item.PublicationID)
		require.NotEqual(t, failed.ID, item.RenditionID)
	}
}

func TestOverviewIncludesOlderPublishedContentInLongRanges(t *testing.T) {
	t.Parallel()
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	now := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	for _, row := range []struct {
		id   string
		days int
	}{{"july-video", 95}, {"older-video", 500}} {
		post := seedAnalyticsPublication(t, db, account.WorkspaceID, row.id, now.AddDate(0, 0, -row.days))
		_, err := db.NewInsert().Model(&models.Rendition{ID: row.id, PublicationID: post.ID, SocialAccountID: account.ID, Platform: account.Platform, Status: models.RenditionStatusPublished}).Exec(t.Context())
		require.NoError(t, err)
	}
	service := NewService(db, nil)
	service.now = func() time.Time { return now }
	for _, tc := range []struct{ days, want int }{{90, 0}, {365, 1}, {0, 2}} {
		overview, err := service.Overview(t.Context(), account.WorkspaceID, tc.days)
		require.NoError(t, err)
		require.Len(t, overview.Content, tc.want, "range %d days", tc.days)
	}
}

func TestCustomRangeBoundsPostsExportAndCursor(t *testing.T) {
	t.Parallel()
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	now := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	for _, row := range []struct{ id, at string }{{"before", "2026-07-20T23:59:59Z"}, {"start", "2026-07-21T00:00:00Z"}, {"end", "2026-07-22T23:59:59Z"}, {"after", "2026-07-23T00:00:00Z"}} {
		at, err := time.Parse(time.RFC3339, row.at)
		require.NoError(t, err)
		post := seedAnalyticsPublication(t, db, account.WorkspaceID, row.id, at.Add(time.Hour))
		_, err = db.NewInsert().Model(&models.Rendition{ID: row.id, PublicationID: post.ID, SocialAccountID: account.ID, Platform: account.Platform, Status: models.RenditionStatusPublished}).Exec(t.Context())
		require.NoError(t, err)
	}
	service := NewService(db, nil)
	service.now = func() time.Time { return now }
	opts := OverviewOptions{From: "2026-07-21", To: "2026-07-22", Limit: 1}
	overview, err := service.OverviewWithOptions(t.Context(), account.WorkspaceID, 30, opts)
	require.NoError(t, err)
	require.Equal(t, 2, overview.ContentTotal)
	require.NotEmpty(t, overview.ContentNextCursor)
	require.Equal(t, time.Date(2026, 7, 21, 0, 0, 0, 0, time.UTC), overview.RangeStart)
	require.Equal(t, time.Date(2026, 7, 23, 0, 0, 0, 0, time.UTC), overview.RangeEnd)
	opts.Cursor = overview.ContentNextCursor
	page, err := service.OverviewWithOptions(t.Context(), account.WorkspaceID, 30, opts)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"start", "end"}, []string{overview.Content[0].RenditionID, page.Content[0].RenditionID})
	opts.From = "2026-07-20"
	_, err = service.OverviewWithOptions(t.Context(), account.WorkspaceID, 30, opts)
	require.ErrorIs(t, err, ErrInvalidOverviewCursor)
	export, err := service.BuildExport(t.Context(), account.WorkspaceID, ExportOptions{Days: 30, From: "2026-07-21", To: "2026-07-22"})
	require.NoError(t, err)
	require.Len(t, export.Posts.Rows, 2)
	require.Equal(t, "2026-07-21", export.From)
	require.Equal(t, "2026-07-22", export.To)
	for _, rangeOpts := range []OverviewOptions{{From: "2026-07-21"}, {To: "2026-07-21"}, {From: "2026-07-22", To: "2026-07-21"}, {From: "2026-02-30", To: "2026-03-01"}} {
		_, err := service.OverviewWithOptions(t.Context(), account.WorkspaceID, 30, rangeOpts)
		require.ErrorIs(t, err, ErrInvalidRange)
	}
}

func TestManualAnalyticsRefreshCollectsOlderPublishedRenditions(t *testing.T) {
	t.Parallel()
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	now := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	post := seedAnalyticsPublication(t, db, account.WorkspaceID, "july-video", now.AddDate(0, 0, -95))
	_, err := db.NewInsert().Model(&models.Rendition{ID: "older-rendition", PublicationID: post.ID, SocialAccountID: account.ID, Platform: account.Platform, Status: models.RenditionStatusPublished, ExternalID: "real-video"}).Exec(t.Context())
	require.NoError(t, err)
	service := NewService(db, staticTokenSource{})
	service.now = func() time.Time { return now }
	service.SetFeatureGate(alwaysEnabledGate{})
	service.SetProvider("test", &fakeAnalyticsAdapter{support: platform.AnalyticsSupport{Account: true, Content: true}})
	_, err = service.RefreshWorkspace(t.Context(), account.WorkspaceID)
	require.NoError(t, err)
	var jobs []models.Job
	err = db.NewSelect().Model(&jobs).Where("type = ?", JobTypeRenditionSync).Scan(t.Context())
	require.NoError(t, err)
	require.Len(t, jobs, 1, "explicit refresh must admit a 95-day-old rendition")
	require.JSONEq(t, `{"rendition_id":"older-rendition"}`, jobs[0].Payload)
}
