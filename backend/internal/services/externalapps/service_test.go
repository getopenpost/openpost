package externalapps

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"fmt"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestPublicClientAuthorizesSelectedCurrentWorkspacesAndRotatesRefreshTokens(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	db := newExternalAppsTestDB(t)
	seedExternalAppsTestData(t, db)
	service := NewService(db, apitokens.NewService(db), "https://app.openpost.test")

	registered, err := service.RegisterApplication(ctx, RegisterApplicationInput{
		Name: "Design exporter", ClientType: ClientTypePublic,
		RedirectURIs:    []string{"https://design.example/callback"},
		AllowedScopes:   []string{ScopeWorkspaceRead, ScopeAccountsRead, ScopeDraftsWrite},
		CreatedByUserID: "operator-1",
	})
	require.NoError(t, err)

	verifier := strings.Repeat("v", 43)
	authorized, err := service.Authorize(ctx, AuthorizeInput{
		UserID: "admin-1", ClientID: registered.Application.ClientID,
		RedirectURI: "https://design.example/callback",
		Scopes:      []string{ScopeWorkspaceRead, ScopeAccountsRead, ScopeDraftsWrite},
		WorkspaceGrants: []WorkspaceGrantInput{
			{WorkspaceID: "ws-1", AccountIDs: []string{"account-1"}},
			{WorkspaceID: "ws-2", AllCurrentAccounts: true},
			{WorkspaceID: "ws-empty"},
		},
		CodeChallenge: pkceChallenge(verifier), State: "state-1",
	})
	require.NoError(t, err)

	tokens, err := service.ExchangeCode(ctx, ExchangeInput{
		Code: authorized.Code, ClientID: registered.Application.ClientID,
		RedirectURI: "https://design.example/callback", CodeVerifier: verifier,
	})
	require.NoError(t, err)
	require.NotEmpty(t, tokens.AccessToken)
	require.NotEmpty(t, tokens.RefreshToken)

	principal, err := apitokens.NewService(db).ValidateToken(ctx, tokens.AccessToken)
	require.NoError(t, err)
	require.Equal(t, authorized.InstallationID, principal.InstallationID)
	require.Equal(t, strings.Join([]string{ScopeAccountsRead, ScopeDraftsWrite, ScopeWorkspaceRead}, " "), principal.DelegatedScopes)

	allowed, err := service.WorkspaceAllowed(ctx, authorized.InstallationID, "admin-1", "ws-1")
	require.NoError(t, err)
	require.True(t, allowed)
	allowed, err = service.WorkspaceAllowed(ctx, authorized.InstallationID, "admin-1", "ws-future")
	require.NoError(t, err)
	require.False(t, allowed)
	allowed, err = service.WorkspaceAllowed(ctx, authorized.InstallationID, "admin-1", "ws-empty")
	require.NoError(t, err)
	require.True(t, allowed)
	accountAllowed, err := service.AccountAllowed(ctx, authorized.InstallationID, "ws-1", "account-1")
	require.NoError(t, err)
	require.True(t, accountAllowed)
	accountAllowed, err = service.AccountAllowed(ctx, authorized.InstallationID, "ws-1", "account-2")
	require.NoError(t, err)
	require.False(t, accountAllowed)
	accountAllowed, err = service.AccountAllowed(ctx, authorized.InstallationID, "ws-2", "account-2")
	require.NoError(t, err)
	require.True(t, accountAllowed)
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("is_active = ?", true).Where("id = ?", "account-inactive").Exec(ctx)
	require.NoError(t, err)
	accountAllowed, err = service.AccountAllowed(ctx, authorized.InstallationID, "ws-2", "account-inactive")
	require.NoError(t, err)
	require.False(t, accountAllowed, "all current accounts must be the exact active snapshot approved at consent")

	rotated, err := service.Refresh(ctx, RefreshInput{ClientID: registered.Application.ClientID, RefreshToken: tokens.RefreshToken})
	require.NoError(t, err)
	require.NotEqual(t, tokens.RefreshToken, rotated.RefreshToken)
	_, err = service.Refresh(ctx, RefreshInput{ClientID: registered.Application.ClientID, RefreshToken: tokens.RefreshToken})
	require.ErrorIs(t, err, ErrRefreshReplay)
	_, err = apitokens.NewService(db).ValidateToken(ctx, rotated.AccessToken)
	require.Error(t, err)
}

func TestOperatorRotatesAndRevokesConfidentialApplication(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	db := newExternalAppsTestDB(t)
	seedExternalAppsTestData(t, db)
	service := NewService(db, apitokens.NewService(db), "https://app.openpost.test")

	registered, err := service.RegisterApplication(ctx, RegisterApplicationInput{
		Name: "Automation server", ClientType: ClientTypeConfidential,
		RedirectURIs: []string{"https://automation.example/callback"}, AllowedScopes: []string{ScopeWorkspaceRead},
		CreatedByUserID: "operator-1",
	})
	require.NoError(t, err)
	require.NotEmpty(t, registered.ClientSecret)

	replacement, err := service.RotateClientSecret(ctx, registered.Application.ID)
	require.NoError(t, err)
	require.NotEqual(t, registered.ClientSecret, replacement)
	app, err := service.ApplicationForAuthorization(ctx, registered.Application.ClientID, "https://automation.example/callback")
	require.NoError(t, err)
	require.False(t, validClientSecret(app, registered.ClientSecret))
	require.True(t, validClientSecret(app, replacement))

	require.NoError(t, service.RevokeApplication(ctx, registered.Application.ID))
	_, err = service.ApplicationForAuthorization(ctx, registered.Application.ClientID, "https://automation.example/callback")
	require.Error(t, err)
}

func TestDynamicRegistrationStoresNoOperatorForeignKey(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	db := newExternalAppsTestDB(t)
	seedExternalAppsTestData(t, db)
	service := NewService(db, apitokens.NewService(db), "https://app.openpost.test")
	service.SetDynamicRegistrationEnabled(true)

	registered, err := service.RegisterDynamicApplication(ctx, RegisterApplicationInput{
		Name: "Dynamic client", ClientType: ClientTypePublic,
		RedirectURIs: []string{"https://dynamic.example/callback"}, AllowedScopes: []string{ScopeWorkspaceRead},
	})
	require.NoError(t, err)

	var createdBy sql.NullString
	require.NoError(t, db.NewRaw("SELECT created_by_user_id FROM external_applications WHERE id = ?", registered.Application.ID).Scan(ctx, &createdBy))
	require.False(t, createdBy.Valid)
}

func TestApplicationRegistrationRejectsUnboundedMetadata(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	db := newExternalAppsTestDB(t)
	service := NewService(db, apitokens.NewService(db), "https://app.openpost.test")

	_, err := service.RegisterApplication(ctx, RegisterApplicationInput{
		Name: strings.Repeat("a", maxApplicationNameLength+1), ClientType: ClientTypePublic,
		RedirectURIs: []string{"https://client.example/callback"}, AllowedScopes: []string{ScopeWorkspaceRead},
	})
	require.ErrorIs(t, err, ErrInvalidRequest)

	redirects := make([]string, maxRedirectURIs+1)
	for index := range redirects {
		redirects[index] = fmt.Sprintf("https://client.example/callback/%d", index)
	}
	_, err = service.RegisterApplication(ctx, RegisterApplicationInput{
		Name: "Client", ClientType: ClientTypePublic, RedirectURIs: redirects, AllowedScopes: []string{ScopeWorkspaceRead},
	})
	require.ErrorIs(t, err, ErrInvalidRequest)
}

func newExternalAppsTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=private", strings.ReplaceAll(t.Name(), "/", "_")))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []any{
		(*models.User)(nil), (*models.Workspace)(nil), (*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil), (*models.APIToken)(nil),
		(*models.ExternalApplication)(nil), (*models.ExternalAppInstallation)(nil),
		(*models.ExternalAppWorkspaceGrant)(nil), (*models.ExternalAppAccountGrant)(nil),
		(*models.ExternalOAuthCode)(nil), (*models.ExternalRefreshToken)(nil),
	} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func seedExternalAppsTestData(t *testing.T, db *bun.DB) {
	t.Helper()
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&[]models.User{
		{ID: "operator-1", Email: "operator@example.com", IsAdmin: true, CreatedAt: now},
		{ID: "admin-1", Email: "admin@example.com", CreatedAt: now},
	}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.Workspace{
		{ID: "ws-1", Name: "One", CreatedAt: now}, {ID: "ws-2", Name: "Two", CreatedAt: now},
		{ID: "ws-empty", Name: "Empty", CreatedAt: now},
		{ID: "ws-future", Name: "Future", CreatedAt: now},
	}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.WorkspaceMember{
		{WorkspaceID: "ws-1", UserID: "admin-1", Role: models.WorkspaceRoleAdmin},
		{WorkspaceID: "ws-2", UserID: "admin-1", Role: models.WorkspaceRoleAdmin},
		{WorkspaceID: "ws-empty", UserID: "admin-1", Role: models.WorkspaceRoleAdmin},
	}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.SocialAccount{
		{ID: "account-1", WorkspaceID: "ws-1", Platform: "x", AccountID: "one", Slug: "one", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "account-2", WorkspaceID: "ws-2", Platform: "linkedin", AccountID: "two", Slug: "two", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "account-inactive", WorkspaceID: "ws-2", Platform: "x", AccountID: "inactive", Slug: "inactive", AccessTokenEnc: []byte("token"), IsActive: false},
	}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("is_active = ?", false).Where("id = ?", "account-inactive").Exec(context.Background())
	require.NoError(t, err)
}

func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
