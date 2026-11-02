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
	notification := models.UserNotification{
		ID: "comment-notification", UserID: "user-1", WorkspaceID: account.WorkspaceID,
		Type: "new_engagement", Title: "New engagement", Href: "/inbox/engagement?item=" + item.ID,
		PayloadJSON: `{"engagement_id":"receipt-comment","provider":"youtube","author_name":"Fetched author"}`,
	}
	_, err = db.NewInsert().Model(&notification).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewRaw("INSERT INTO engagement_operations (workspace_id, user_id, item_id, operation_id, body_hash, job_id) VALUES (?, ?, ?, ?, ?, ?)", account.WorkspaceID, "user-1", item.ID, "original-operation", "original-hash", "original-job").Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.AnalyticsSyncState{ID: "fresh-state", WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID, Platform: "youtube", SubjectType: "account", SubjectID: account.ID, LastSuccessAt: now, MetricsJSON: `{"followers":42}`}).Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, dataretention.PurgeYouTube(ctx, db, now, account.WorkspaceID, account.ID))
	require.NoError(t, db.NewSelect().Model(&item).WherePK().Scan(ctx))
	require.Empty(t, item.Body)
	require.Empty(t, item.AuthorName)
	require.NoError(t, db.NewSelect().Model(&notification).WherePK().Scan(ctx))
	require.NotContains(t, notification.PayloadJSON, "Fetched author", "notifications must not retain fetched author data")
	require.Equal(t, "remote-comment", item.RemoteID)
	require.False(t, item.LastSeenAt.After(now.Add(-dataretention.YouTubeCacheAge)))
	var jobID string
	require.NoError(t, db.NewSelect().Table("engagement_operations").Column("job_id").Where("item_id = ?", item.ID).Scan(ctx, &jobID))
	require.Equal(t, "original-job", jobID)
	count, err := db.NewSelect().Model((*models.AnalyticsSyncState)(nil)).Where("id = ?", "fresh-state").Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count, "explicit disconnect purges even newly fetched metrics")
}

func TestYouTubeProfileExpiryKeepsAuthorizationIdentityForRefresh(t *testing.T) {
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
	require.Equal(t, 1, count)
}

func TestYouTubeRevocationRetiresProviderMetadataButKeepsAuthoredPost(t *testing.T) {
	db := newAnalyticsTestDB(t)
	ctx := t.Context()
	account := seedAnalyticsAccount(t, db, "")
	now := time.Now().UTC()
	grant := models.OAuthGrant{ID: "revoked-youtube-grant", WorkspaceID: account.WorkspaceID, Provider: "youtube", ProviderSubject: "provider-account", AccessTokenEnc: []byte{}, ValidationStatus: "revoked", RevokedAt: now}
	_, err := db.NewInsert().Model(&grant).Exec(ctx)
	require.NoError(t, err)
	account.Platform = "youtube"
	account.OAuthGrantID = grant.ID
	account.ProfileFetchedAt = now
	_, err = db.NewUpdate().Model(&account).Column("platform", "oauth_grant_id", "profile_fetched_at").WherePK().Exec(ctx)
	require.NoError(t, err)
	publication := seedAnalyticsPublication(t, db, account.WorkspaceID, "retired-youtube-publication", now)
	rendition := models.Rendition{ID: "retired-youtube-rendition", PublicationID: publication.ID, SocialAccountID: account.ID, Platform: "youtube", TargetKey: "youtube", Status: models.RenditionStatusPublished, ExternalID: "remote-video", ExternalURL: "https://www.youtube.com/watch?v=remote-video"}
	_, err = db.NewInsert().Model(&rendition).Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, dataretention.ClearRevokedYouTubeMetadata(ctx, db, now, account.WorkspaceID))
	require.NoError(t, db.NewSelect().Model(&account).WherePK().Scan(ctx))
	require.False(t, account.IsActive)
	require.Empty(t, account.AccountUsername)
	require.Equal(t, dataretention.RetiredYouTubeIdentity(account.WorkspaceID, "provider-account"), account.AccountID)
	require.NoError(t, db.NewSelect().Model(&grant).WherePK().Scan(ctx))
	require.Empty(t, grant.ProviderSubject)
	require.NoError(t, db.NewSelect().Model(&rendition).WherePK().Scan(ctx))
	require.Empty(t, rendition.ExternalID)
	require.Empty(t, rendition.ExternalURL)
	require.Equal(t, models.RenditionStatusPublished, rendition.Status)
	require.NoError(t, db.NewSelect().Model(&publication).WherePK().Scan(ctx))
	require.Equal(t, "Launch", publication.SourceText)
}

func TestYouTubeOldAuthorizationFailureCannotRetireActiveGrant(t *testing.T) {
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

func TestYouTubeExternalRevocationExpiresAfterProfileDeadline(t *testing.T) {
	db := newAnalyticsTestDB(t)
	now := time.Now().UTC()
	account := seedAnalyticsAccount(t, db, "")
	account.Platform = "youtube"
	account.ProfileFetchedAt = now.Add(-30 * 24 * time.Hour)
	account.OAuthGrantID = "external-revoked-grant"
	grant := &models.OAuthGrant{ID: account.OAuthGrantID, WorkspaceID: account.WorkspaceID, Provider: "youtube", ValidationStatus: "refresh_failed", AccessTokenEnc: []byte("expired-token"), RefreshTokenEnc: []byte("revoked-token"), TokenVersion: 4}
	_, err := db.NewInsert().Model(grant).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model(&account).WherePK().Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, dataretention.ClearRevokedYouTubeMetadata(t.Context(), db, now, account.WorkspaceID))
	require.NoError(t, db.NewSelect().Model(&account).WherePK().Scan(t.Context()))
	require.False(t, account.IsActive, "a permanently failed authorization cannot retain channel data past its deadline")
	require.NoError(t, db.NewSelect().Model(grant).WherePK().Scan(t.Context()))
	require.Equal(t, "revoked", grant.ValidationStatus)
	require.Empty(t, grant.AccessTokenEnc)
	require.Empty(t, grant.RefreshTokenEnc)
}
