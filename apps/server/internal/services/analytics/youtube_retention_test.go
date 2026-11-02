package analytics

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/dataretention"
	"github.com/stretchr/testify/require"
)

func TestYouTubeCacheExpiresBeforeThirtyDaysOnOverview(t *testing.T) {
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	account.Platform = "youtube"
	_, err := db.NewUpdate().Model(&account).Column("platform").WherePK().Exec(t.Context())
	require.NoError(t, err)
	now := time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)
	for _, row := range []struct {
		id, provider string
		age          time.Duration
	}{
		{"expired", "youtube", 29 * 24 * time.Hour},
		{"fresh", "youtube", 28 * 24 * time.Hour},
		{"other", "test", 40 * 24 * time.Hour},
	} {
		_, err := db.NewInsert().Model(&models.AnalyticsAccountSnapshot{ID: row.id, WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID, Platform: row.provider, MetricsJSON: `{"followers":42}`, CapturedAt: now.Add(-row.age)}).Exec(t.Context())
		require.NoError(t, err)
		_, err = db.NewInsert().Model(&models.ImportedPost{ID: row.id, WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID, Platform: row.provider, ProviderPostID: row.id, PublishedAt: now.Add(-row.age), FirstSeenAt: now.Add(-row.age), LastSeenAt: now.Add(-row.age)}).Exec(t.Context())
		require.NoError(t, err)
		_, err = db.NewInsert().Model(&models.EngagementItem{ID: row.id, WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID, Platform: row.provider, RemoteID: row.id, LastSeenAt: now.Add(-row.age)}).Exec(t.Context())
		require.NoError(t, err)
	}
	s := NewService(db, nil)
	s.now = func() time.Time { return now }
	_, err = s.Overview(t.Context(), account.WorkspaceID, 0)
	require.NoError(t, err)
	for _, model := range []any{(*models.AnalyticsAccountSnapshot)(nil), (*models.ImportedPost)(nil), (*models.EngagementItem)(nil)} {
		count, err := db.NewSelect().Model(model).Where("id = ?", "expired").Count(t.Context())
		require.NoError(t, err)
		require.Zero(t, count, "expired YouTube cache must be removed")
		count, err = db.NewSelect().Model(model).Count(t.Context())
		require.NoError(t, err)
		require.Equal(t, 2, count, "fresh YouTube data and other providers must remain")
	}
}

func TestYouTubeDisconnectPurgesFreshCacheAndPreservesReceipts(t *testing.T) {
	db := newAnalyticsTestDB(t)
	ctx := t.Context()
	account := seedAnalyticsAccount(t, db, "")
	account.Platform = "youtube"
	_, err := db.NewUpdate().Model(&account).Column("platform").WherePK().Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{ID: "user-1", Email: "retention@example.com"}).Exec(ctx)
	require.NoError(t, err)
	now := time.Now().UTC()
	item := models.EngagementItem{ID: "receipt-comment", WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID, Platform: "youtube", RemoteID: "remote-comment", Body: "Fetched comment", AuthorName: "Fetched author", LastSeenAt: now}
	_, err = db.NewInsert().Model(&item).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewRaw("INSERT INTO engagement_operations (workspace_id, user_id, item_id, operation_id, body_hash, job_id) VALUES (?, ?, ?, ?, ?, ?)", account.WorkspaceID, "user-1", item.ID, "original-operation", "original-hash", "original-job").Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.AnalyticsSyncState{ID: "fresh-state", WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID, Platform: "youtube", SubjectType: "account", SubjectID: account.ID, LastSuccessAt: now, MetricsJSON: `{"followers":42}`}).Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, dataretention.PurgeYouTube(ctx, db, now, account.WorkspaceID, account.ID))
	require.NoError(t, db.NewSelect().Model(&item).WherePK().Scan(ctx))
	require.Empty(t, item.Body)
	require.Empty(t, item.AuthorName)
	require.Equal(t, "remote-comment", item.RemoteID)
	require.False(t, item.LastSeenAt.After(now.Add(-dataretention.YouTubeCacheAge)))
	var jobID string
	require.NoError(t, db.NewSelect().Table("engagement_operations").Column("job_id").Where("item_id = ?", item.ID).Scan(ctx, &jobID))
	require.Equal(t, "original-job", jobID)
	count, err := db.NewSelect().Model((*models.AnalyticsSyncState)(nil)).Where("id = ?", "fresh-state").Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count, "explicit disconnect purges even newly fetched metrics")
}
