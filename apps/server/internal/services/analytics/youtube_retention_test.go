package analytics

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/dataretention"
	"github.com/stretchr/testify/require"
)

func TestYouTubeCacheExpiresBeforeThirtyDaysOnOverview(t *testing.T) {
	t.Parallel()
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
		{"expired", "youtube", 22 * 24 * time.Hour},
		{"fresh", "youtube", 21 * 24 * time.Hour},
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
		require.EqualValues(t, 2, count, "fresh YouTube data and other providers must remain")
	}
}

func TestYouTubeProfileExpiryKeepsAuthorizationIdentityForRefresh(t *testing.T) {
	t.Parallel()
	db := newAnalyticsTestDB(t)
	ctx := t.Context()
	account := seedAnalyticsAccount(t, db, "")
	now := time.Now().UTC()
	account.Platform = "youtube"
	account.ProfileFetchedAt = now.Add(-30 * 24 * time.Hour)
	account.AccountAvatarURL = "/avatars/avatar_account_old.png"
	_, err := db.NewUpdate().Model(&account).Column("platform", "profile_fetched_at", "account_avatar_url").WherePK().Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, dataretention.ClearRevokedYouTubeMetadata(ctx, db, now, account.WorkspaceID))
	require.NoError(t, db.NewSelect().Model(&account).WherePK().Scan(ctx))
	require.Empty(t, account.AccountUsername)
	require.Empty(t, account.AccountAvatarURL)
	require.Equal(t, "provider-account", account.AccountID)
	require.True(t, account.IsActive)
	require.True(t, account.ProfileFetchedAt.IsZero())
	count, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", "storage_delete").Count(ctx)
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
}

func TestYouTubeOldAuthorizationFailureCannotRetireActiveGrant(t *testing.T) {
	t.Parallel()
	db := newAnalyticsTestDB(t)
	ctx := t.Context()
	account := seedAnalyticsAccount(t, db, "")
	now := time.Now().UTC()
	grant := models.OAuthGrant{ID: "active-youtube-grant", WorkspaceID: account.WorkspaceID, Provider: "youtube", ProviderSubject: "provider-account", AccessTokenEnc: []byte("new-token"), ValidationStatus: "valid"}
	_, err := db.NewInsert().Model(&grant).Exec(ctx)
	require.NoError(t, err)
	account.Platform = "youtube"
	account.OAuthGrantID = grant.ID
	account.ProfileFetchedAt = now
	_, err = db.NewUpdate().Model(&account).Column("platform", "oauth_grant_id", "profile_fetched_at").WherePK().Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, dataretention.RetireYouTubeAccount(ctx, db, now, account.WorkspaceID, account.ID))
	require.NoError(t, db.NewSelect().Model(&account).WherePK().Scan(ctx))
	require.True(t, account.IsActive)
	require.Equal(t, "provider-account", account.AccountID)
	require.Equal(t, "person", account.AccountUsername)
}

func TestYouTubeRetirementPostgresPreservesOtherWorkspace(t *testing.T) {
	t.Parallel()
	db := analyticsSnapshotTestDB(t, "postgres", (*models.Organization)(nil), (*models.Workspace)(nil), (*models.SocialAccount)(nil), (*models.OAuthGrant)(nil), (*models.UserNotification)(nil), (*models.AnalyticsAccountSnapshot)(nil), (*models.AnalyticsSyncState)(nil), (*models.ImportedPost)(nil), (*models.PostImportState)(nil), (*models.EngagementItem)(nil), (*models.Rendition)(nil), (*models.RenditionSegment)(nil), (*models.ProviderWriteAttempt)(nil), (*models.ProviderDelivery)(nil), (*models.Job)(nil))
	_, err := db.ExecContext(t.Context(), "CREATE TABLE engagement_operations (item_id TEXT); CREATE TABLE engagement_automation_replies (item_id TEXT, item_body TEXT)")
	require.NoError(t, err)
	now := time.Now().UTC()
	for _, model := range []any{&models.Organization{ID: "pg-org", Name: "Review"}, &models.Workspace{ID: "pg-ws", OrganizationID: "pg-org", Name: "Review"}, &models.SocialAccount{ID: "pg-account", WorkspaceID: "pg-ws", Slug: "youtube", Platform: "youtube", AccountID: "channel-id", AccountUsername: "Fetched profile", AccountAvatarURL: "/avatars/avatar_pg.png", AccessTokenEnc: []byte{}, IsActive: false, ProfileFetchedAt: now}, &models.EngagementItem{ID: "pg-comment", WorkspaceID: "pg-ws", SocialAccountID: "pg-account", Platform: "youtube", RemoteID: "remote-comment", AuthorName: "Fetched author", LastSeenAt: now}, &models.UserNotification{ID: "pg-notification", UserID: "user", WorkspaceID: "pg-ws", Href: "/inbox/engagement?item=pg-comment", PayloadJSON: `{"author_name":"Fetched author"}`}, &models.UserNotification{ID: "other-notification", UserID: "other-user", WorkspaceID: "other-ws", Href: "/inbox/engagement?item=pg-comment", PayloadJSON: `{"author_name":"Other workspace"}`}} {
		_, err := db.NewInsert().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("is_active = ?", false).Where("id = ?", "pg-account").Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, dataretention.RetireYouTubeAccount(t.Context(), db, now, "pg-ws", "pg-account"))
	var notifications []models.UserNotification
	require.NoError(t, db.NewSelect().Model(&notifications).Order("id").Scan(t.Context()))
	require.Equal(t, `{"author_name":"Other workspace"}`, notifications[0].PayloadJSON)
	require.Equal(t, "{}", notifications[1].PayloadJSON)
	var account models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&account).Where("id = ?", "pg-account").Scan(t.Context()))
	require.Empty(t, account.AccountUsername)
	require.Empty(t, account.AccountAvatarURL)
	require.Equal(t, dataretention.RetiredYouTubeIdentity("pg-ws", "channel-id"), account.AccountID)
}
