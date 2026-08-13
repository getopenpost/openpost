package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/stretchr/testify/require"
)

func TestDisconnectDestinationAndRevokeSharedGrantHaveDistinctImpact(t *testing.T) {
	ctx := context.Background()
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.Job)(nil),
	)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
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
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
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
