package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/services/youtubeprofile"
	"github.com/stretchr/testify/require"
)

type authorizationRevokingAdapter struct {
	providerAvailabilityAdapter
	token string
	err   error
}

func (a *authorizationRevokingAdapter) RevokeAuthorization(_ context.Context, token string) error {
	a.token = token
	return a.err
}

func TestProviderRevocationFailureKeepsTheLocalGrantRetryable(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.Organization)(nil), (*models.Workspace)(nil), (*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil), (*models.Job)(nil),
	)
	ctx := t.Context()
	_, err := db.NewInsert().Model(&models.Organization{ID: "organization-1", Name: "OAuth"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", OrganizationID: "organization-1", Name: "OAuth"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(ctx)
	require.NoError(t, err)
	encryptor := crypto.NewTokenEncryptor("test-key")
	encrypted, err := encryptor.Encrypt("provider-access")
	require.NoError(t, err)
	grant := models.OAuthGrant{
		ID: "grant-1", WorkspaceID: "workspace-1", Provider: "pinterest", ProviderProjectID: "pin-app",
		ProviderSubject: "openpost", AccessTokenEnc: encrypted, TokenVersion: 1, ExecutionMode: "oauth2",
		AuthorizationEvidence: `{"source":"test"}`, ValidationStatus: "valid", ValidatedAt: time.Now().UTC(),
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	_, err = db.NewInsert().Model(&grant).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "pinterest", AccountID: "openpost",
		OAuthGrantID: grant.ID, AccessTokenEnc: []byte{}, RefreshTokenEnc: []byte{}, IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)

	adapter := &authorizationRevokingAdapter{err: errors.New("provider unavailable")}
	handler := NewOAuthHandler(db, encryptor, map[string]platform.Adapter{"pinterest": adapter}, testAuthenticator{}, false, "https://app.openpost.test")
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.RevokeAccountGrant(api)

	response := oauthSelectionRequest(t, e, http.MethodDelete, "/api/v1/accounts/account-1/grant", nil, true)
	require.Equal(t, http.StatusBadGateway, response.Code, response.Body.String())
	require.Equal(t, "provider-access", adapter.token)
	require.NoError(t, db.NewSelect().Model(&grant).Where("id = ?", grant.ID).Scan(ctx))
	require.True(t, grant.RevokedAt.IsZero())
	require.NotEmpty(t, grant.AccessTokenEnc)
	var account models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&account).Where("id = ?", "account-1").Scan(ctx))
	require.True(t, account.IsActive)
}

func TestDisconnectDestinationAndRevokeSharedGrantHaveDistinctImpact(t *testing.T) {
	ctx := context.Background()
	db := createHandlerTestDB(t,
		(*models.Organization)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.Job)(nil),
	)
	_, err := db.NewInsert().Model(&models.Organization{ID: "organization-1", Name: "OAuth"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", OrganizationID: "organization-1", Name: "OAuth"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	grant := &models.OAuthGrant{
		ID:                    "grant-1",
		WorkspaceID:           "workspace-1",
		Provider:              "linkedin",
		ProviderProjectID:     "project-1",
		ProviderSubject:       "member-1",
		AccessTokenEnc:        []byte("encrypted-access"),
		RefreshTokenEnc:       []byte("encrypted-refresh"),
		AccessTokenExpiresAt:  time.Now().UTC().Add(time.Hour),
		RefreshTokenExpiresAt: time.Now().UTC().Add(24 * time.Hour),
		TokenVersion:          4,
		ExecutionMode:         "oauth2",
		AuthorizationEvidence: `{"source":"test"}`,
		ValidationStatus:      "valid",
		CreatedAt:             time.Now().UTC(),
		UpdatedAt:             time.Now().UTC(),
	}
	_, err = db.NewInsert().Model(grant).Exec(ctx)
	require.NoError(t, err)
	loneGrant := *grant
	loneGrant.ID = "grant-lone"
	loneGrant.ProviderSubject = "member-lone"
	loneGrant.AccessTokenEnc = []byte("encrypted-lone-access")
	loneGrant.RefreshTokenEnc = []byte("encrypted-lone-refresh")
	_, err = db.NewInsert().Model(&loneGrant).Exec(ctx)
	require.NoError(t, err)
	accounts := []models.SocialAccount{
		{ID: "account-person", WorkspaceID: "workspace-1", Platform: "linkedin", AccountID: "urn:li:person:member-1", OAuthGrantID: grant.ID, AccessTokenEnc: []byte{}, IsActive: true},
		{ID: "account-page", WorkspaceID: "workspace-1", Platform: "linkedin", AccountID: "urn:li:organization:42", OAuthGrantID: grant.ID, AccessTokenEnc: []byte{}, IsActive: true},
		{ID: "account-lone", WorkspaceID: "workspace-1", Platform: "linkedin", AccountID: "urn:li:organization:99", OAuthGrantID: loneGrant.ID, AccessTokenEnc: []byte{}, IsActive: true},
	}
	_, err = db.NewInsert().Model(&accounts).Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, tokenmanager.ScheduleGrantRefreshJob(ctx, db, grant.ID, grant.AccessTokenExpiresAt))

	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewOAuthHandler(db, crypto.NewTokenEncryptor("test-key"), nil, testAuthenticator{}, false, "https://app.openpost.test")
	handler.ListAccounts(api)
	handler.DisconnectAccount(api)
	handler.RevokeAccountGrant(api)

	list := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts?workspace_id=workspace-1", nil, true)
	require.Equal(t, http.StatusOK, list.Code, list.Body.String())
	var listed []AccountResponse
	require.NoError(t, json.Unmarshal(list.Body.Bytes(), &listed))
	require.Len(t, listed, 3)
	listedByID := make(map[string]AccountResponse, len(listed))
	for _, account := range listed {
		listedByID[account.ID] = account
	}
	for _, accountID := range []string{"account-person", "account-page"} {
		require.Equal(t, 2, listedByID[accountID].GrantDestinationCount)
		require.True(t, listedByID[accountID].SharedGrant)
	}
	require.Equal(t, 1, listedByID["account-lone"].GrantDestinationCount)
	require.False(t, listedByID["account-lone"].SharedGrant)

	disconnect := oauthSelectionRequest(t, e, http.MethodDelete, "/api/v1/accounts/account-person", nil, true)
	require.Equal(t, http.StatusNoContent, disconnect.Code, disconnect.Body.String())
	var person, page models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&person).Where("id = ?", "account-person").Scan(ctx))
	require.NoError(t, db.NewSelect().Model(&page).Where("id = ?", "account-page").Scan(ctx))
	require.False(t, person.IsActive)
	require.True(t, page.IsActive, "disconnecting one destination must not affect a sibling")
	require.NoError(t, db.NewSelect().Model(grant).Where("id = ?", grant.ID).Scan(ctx))
	require.True(t, grant.RevokedAt.IsZero())
	require.NotEmpty(t, grant.AccessTokenEnc)

	disconnectLast := oauthSelectionRequest(t, e, http.MethodDelete, "/api/v1/accounts/account-page", nil, true)
	require.Equal(t, http.StatusConflict, disconnectLast.Code, disconnectLast.Body.String())
	require.Contains(t, disconnectLast.Body.String(), "last destination")
	require.NoError(t, db.NewSelect().Model(&page).Where("id = ?", "account-page").Scan(ctx))
	require.True(t, page.IsActive, "the last destination must remain active until its grant is revoked")
	require.NoError(t, db.NewSelect().Model(grant).Where("id = ?", grant.ID).Scan(ctx))
	require.True(t, grant.RevokedAt.IsZero())
	require.NotEmpty(t, grant.AccessTokenEnc, "a refused disconnect must not orphan or clear the live grant")

	revoke := oauthSelectionRequest(t, e, http.MethodDelete, "/api/v1/accounts/account-page/grant", nil, true)
	require.Equal(t, http.StatusNoContent, revoke.Code, revoke.Body.String())
	require.NoError(t, db.NewSelect().Model(&person).Where("id = ?", "account-person").Scan(ctx))
	require.NoError(t, db.NewSelect().Model(&page).Where("id = ?", "account-page").Scan(ctx))
	require.False(t, person.IsActive)
	require.False(t, page.IsActive)
	require.NoError(t, db.NewSelect().Model(grant).Where("id = ?", grant.ID).Scan(ctx))
	require.False(t, grant.RevokedAt.IsZero())
	require.Equal(t, "user-1", grant.RevokedByID)
	require.Equal(t, "user_revoked", grant.RevocationReason)
	require.Equal(t, "revoked", grant.ValidationStatus)
	require.EqualValues(t, 5, grant.TokenVersion)
	require.Empty(t, grant.AccessTokenEnc)
	require.Empty(t, grant.RefreshTokenEnc)

	pending, err := db.NewSelect().Model((*models.Job)(nil)).
		Where("type = ? AND status = ?", "refresh_token", "pending").
		Count(ctx)
	require.NoError(t, err)
	require.Zero(t, pending)
}

func TestYouTubeRevocationCommitsBeforeRetryableCleanup(t *testing.T) {
	for _, failure := range []string{"retention", "queue"} {
		t.Run(failure, func(t *testing.T) {
			db := newAnalyticsHandlerTestDB(t, "revoke-ws")
			ctx := t.Context()
			now := time.Now().UTC()
			_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "revoke-ws", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(ctx)
			require.NoError(t, err)
			encryptor := crypto.NewTokenEncryptor("test-key")
			token, err := encryptor.Encrypt("provider-access")
			require.NoError(t, err)
			grant := &models.OAuthGrant{ID: "revoke-youtube", WorkspaceID: "revoke-ws", Provider: "youtube", ProviderSubject: "channel", AccessTokenEnc: token, ValidationStatus: "valid", TokenVersion: 1}
			_, err = db.NewInsert().Model(grant).Exec(ctx)
			require.NoError(t, err)
			account := &models.SocialAccount{ID: "revoke-channel", WorkspaceID: "revoke-ws", Platform: "youtube", Slug: "channel", AccountID: "channel", AccountUsername: "Channel", OAuthGrantID: grant.ID, AccessTokenEnc: []byte{}, IsActive: true, ProfileFetchedAt: now}
			_, err = db.NewInsert().Model(account).Exec(ctx)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.AnalyticsAccountSnapshot{ID: "revoke-snapshot", WorkspaceID: "revoke-ws", SocialAccountID: account.ID, Platform: "youtube", MetricsJSON: `{"views":10}`, CapturedAt: now}).Exec(ctx)
			require.NoError(t, err)
			trigger := `CREATE TRIGGER fail_youtube_retention BEFORE DELETE ON analytics_account_snapshots BEGIN SELECT RAISE(ABORT,'temporary cleanup failure'); END`
			if failure == "queue" {
				trigger = `CREATE TRIGGER fail_youtube_retention BEFORE INSERT ON jobs BEGIN SELECT RAISE(ABORT,'temporary job receipt failure'); END`
			}
			_, err = db.ExecContext(ctx, trigger)
			require.NoError(t, err)
			adapter := &authorizationRevokingAdapter{}
			handler := NewOAuthHandler(db, encryptor, map[string]platform.Adapter{"youtube": adapter}, testAuthenticator{}, false, "https://app.openpost.test")
			e := echo.New()
			api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
			handler.RevokeAccountGrant(api)
			response := oauthSelectionRequest(t, e, http.MethodDelete, "/api/v1/accounts/revoke-channel/grant", nil, true)
			require.Equal(t, http.StatusNoContent, response.Code, response.Body.String())
			require.Equal(t, "provider-access", adapter.token)
			require.NoError(t, db.NewSelect().Model(grant).WherePK().Scan(ctx))
			require.Equal(t, "revoked", grant.ValidationStatus)
			require.Empty(t, grant.AccessTokenEnc)
			require.NoError(t, db.NewSelect().Model(account).WherePK().Scan(ctx))
			require.False(t, account.IsActive)
			count, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ? AND status = ?", jobregistry.TypeYouTubeProfileSweep, "pending").Count(ctx)
			require.NoError(t, err)
			if failure == "queue" {
				require.Zero(t, count)
				var remaining int
				remaining, err = db.NewSelect().Model((*models.AnalyticsAccountSnapshot)(nil)).Where("id = ?", "revoke-snapshot").Count(ctx)
				require.NoError(t, err)
				require.Zero(t, remaining, "queue failure cannot prevent inline cleanup")
			} else {
				require.Positive(t, count, "cleanup must remain durable after a transient retention error")
			}
			_, err = db.ExecContext(ctx, "DROP TRIGGER fail_youtube_retention")
			require.NoError(t, err)
			require.NoError(t, youtubeprofile.NewService(db, nil, nil).HandleJob(ctx, jobregistry.TypeYouTubeProfileSweep, "{}"))
			require.NoError(t, db.NewSelect().Model(account).WherePK().Scan(ctx))
			require.Empty(t, account.AccountUsername)
			count, err = db.NewSelect().Model((*models.AnalyticsAccountSnapshot)(nil)).Where("id = ?", "revoke-snapshot").Count(ctx)
			require.NoError(t, err)
			require.Zero(t, count, "the durable cleanup can finish after the original request returns")
		})
	}
}
