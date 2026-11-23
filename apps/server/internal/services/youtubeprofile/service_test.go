package youtubeprofile

import (
	"context"

	"testing"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type profileAdapter struct {
	platform.Adapter
	profile *platform.UserProfile
	err     error
	hook    func()
}

func (a profileAdapter) RefreshAccountMetadata(context.Context, string, platform.AccountMetadataRequest) (*platform.UserProfile, error) {
	if a.hook != nil {
		a.hook()
	}
	return a.profile, a.err
}
func fixture(t *testing.T) (*Service, *bun.DB, models.SocialAccount) {
	t.Helper()
	db := testdb.NewSQLite(t)
	now := time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)
	for _, m := range []any{&models.Organization{ID: "org", Name: "Org"}, &models.Workspace{ID: "ws", OrganizationID: "org", Name: "WS"}} {
		_, err := db.NewInsert().Model(m).Exec(t.Context())
		require.NoError(t, err)
	}
	account := models.SocialAccount{ID: "a", WorkspaceID: "ws", Platform: "youtube", Slug: "a", AccountID: "channel", AccountUsername: "Old", AccountAvatarURL: "/avatars/avatar_account_old.png", AccessTokenEnc: []byte{}, IsActive: true, ProfileFetchedAt: now.Add(-22 * 24 * time.Hour)}
	_, err := db.NewInsert().Model(&account).Exec(t.Context())
	require.NoError(t, err)
	s := NewService(db, nil, nil)
	s.now = func() time.Time { return now }
	return s, db, account
}
func TestRefreshRenewsOnlySuccessfulProfileAndDurablyRetiresAvatar(t *testing.T) {
	s, db, a := fixture(t)
	require.NoError(t, s.Refresh(t.Context(), a, profileAdapter{profile: &platform.UserProfile{ID: "channel", Username: "New"}}, "token"))
	var got models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&got).Where("id = ?", a.ID).Scan(t.Context()))
	require.Equal(t, s.now(), got.ProfileFetchedAt.UTC(), "only actual provider profile success can renew retention")
	require.Equal(t, "New", got.AccountUsername)
	require.Empty(t, got.AccountAvatarURL)
	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", jobregistry.TypeStorageDelete).Scan(t.Context()))
	require.Len(t, jobs, 1)
	require.Contains(t, jobs[0].Payload, "avatar_account_old.png")
}

type profileTokenSource func(context.Context, string) (string, error)

func (f profileTokenSource) GetValidAccessToken(ctx context.Context, id string) (string, error) {
	return f(ctx, id)
}
func attachGrant(t *testing.T, s *Service, db *bun.DB, a models.SocialAccount) models.SocialAccount {
	t.Helper()
	grant := models.OAuthGrant{ID: "grant", WorkspaceID: a.WorkspaceID, Provider: "youtube", AccessTokenEnc: []byte("credential"), RefreshTokenEnc: []byte("refresh"), TokenVersion: 1, ValidationStatus: "valid"}
	_, err := db.NewInsert().Model(&grant).Exec(t.Context())
	require.NoError(t, err)
	a.OAuthGrantID = grant.ID
	_, err = db.NewUpdate().Model(&a).Column("oauth_grant_id").WherePK().Exec(t.Context())
	require.NoError(t, err)
	s.tokens = profileTokenSource(func(context.Context, string) (string, error) { return "token", nil })
	return a
}
func TestUnauthorizedProfileRetiresAtDeadline(t *testing.T) {
	s, db, a := fixture(t)
	a = attachGrant(t, s, db, a)
	s.SetProvider("youtube", profileAdapter{err: &platform.HTTPError{StatusCode: 401}})
	require.Error(t, s.HandleJob(t.Context(), jobregistry.TypeYouTubeProfileAccount, `{"account_id":"a"}`))
	var got models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&got).Where("id = ?", a.ID).Scan(t.Context()))
	require.False(t, got.IsActive)
	var grant models.OAuthGrant
	require.NoError(t, db.NewSelect().Model(&grant).Where("id = ?", a.OAuthGrantID).Scan(t.Context()))
	require.Equal(t, "revoked", grant.ValidationStatus)
	require.Empty(t, grant.AccessTokenEnc)
	require.Empty(t, grant.RefreshTokenEnc)
	require.False(t, got.ProfileFetchedAt.After(a.ProfileFetchedAt), "an authorization failure cannot renew retention")
}
func TestOldUnauthorizedResponseCannotInvalidateRotatedGrant(t *testing.T) {
	s, db, a := fixture(t)
	a = attachGrant(t, s, db, a)
	s.SetProvider("youtube", profileAdapter{err: &platform.HTTPError{StatusCode: 401}, hook: func() {
		_, err := db.NewUpdate().Model((*models.OAuthGrant)(nil)).Set("token_version = token_version + 1").Where("id = ?", a.OAuthGrantID).Exec(t.Context())
		require.NoError(t, err)
	}})
	require.Error(t, s.HandleJob(t.Context(), jobregistry.TypeYouTubeProfileAccount, `{"account_id":"a"}`))
	var grant models.OAuthGrant
	require.NoError(t, db.NewSelect().Model(&grant).Where("id = ?", a.OAuthGrantID).Scan(t.Context()))
	require.Equal(t, "valid", grant.ValidationStatus)
	require.EqualValues(t, 2, grant.TokenVersion)
	require.Equal(t, []byte("credential"), grant.AccessTokenEnc)
	var got models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&got).Where("id = ?", a.ID).Scan(t.Context()))
	require.True(t, got.IsActive)
	require.True(t, a.ProfileFetchedAt.Equal(got.ProfileFetchedAt))
}
func TestUnauthorizedBeforeDeadlineDoesNotRetireOrRenewProfile(t *testing.T) {
	s, db, a := fixture(t)
	a.ProfileFetchedAt = s.now().Add(-RefreshAge)
	_, err := db.NewUpdate().Model(&a).Column("profile_fetched_at").WherePK().Exec(t.Context())
	require.NoError(t, err)
	a = attachGrant(t, s, db, a)
	s.SetProvider("youtube", profileAdapter{err: &platform.HTTPError{StatusCode: 401}})
	require.Error(t, s.HandleJob(t.Context(), jobregistry.TypeYouTubeProfileAccount, `{"account_id":"a"}`))
	var grant models.OAuthGrant
	require.NoError(t, db.NewSelect().Model(&grant).Where("id = ?", a.OAuthGrantID).Scan(t.Context()))
	require.Equal(t, "refresh_failed", grant.ValidationStatus)
	var got models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&got).Where("id = ?", a.ID).Scan(t.Context()))
	require.True(t, got.IsActive)
	require.True(t, a.ProfileFetchedAt.Equal(got.ProfileFetchedAt))
}

func TestOldUnauthorizedResponseCannotInvalidateFreshProfile(t *testing.T) {
	s, db, a := fixture(t)
	a = attachGrant(t, s, db, a)
	s.SetProvider("youtube", profileAdapter{err: &platform.HTTPError{StatusCode: 401}, hook: func() {
		_, err := db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("profile_fetched_at = ?", s.now()).Where("id = ?", a.ID).Exec(t.Context())
		require.NoError(t, err)
	}})
	require.Error(t, s.HandleJob(t.Context(), jobregistry.TypeYouTubeProfileAccount, `{"account_id":"a"}`))
	var grant models.OAuthGrant
	require.NoError(t, db.NewSelect().Model(&grant).Where("id = ?", a.OAuthGrantID).Scan(t.Context()))
	require.Equal(t, "valid", grant.ValidationStatus)
	var got models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&got).Where("id = ?", a.ID).Scan(t.Context()))
	require.True(t, got.IsActive)
	require.True(t, s.now().Equal(got.ProfileFetchedAt))
}
