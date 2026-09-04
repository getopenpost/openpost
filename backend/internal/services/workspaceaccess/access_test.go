package workspaceaccess

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	_ "github.com/uptrace/bun/driver/sqliteshim"
)

func TestInactiveMemberHasNoWorkspaceAccess(t *testing.T) {
	sqlDB, err := sql.Open("sqliteshim", "file:workspace-access?mode=memory&cache=shared")
	require.NoError(t, err)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	_, err = db.NewCreateTable().Model((*models.WorkspaceMember)(nil)).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
		Status:      models.WorkspaceMemberStatusInactive,
	}).Exec(context.Background())
	require.NoError(t, err)

	decision, err := NewAuthorizer(db).Authorize(context.Background(), "workspace-1", ActorFacts{UserID: "user-1"}, LevelRead)
	require.NoError(t, err)
	require.False(t, decision.Allowed)
	decision, err = NewAuthorizer(db).Authorize(context.Background(), "workspace-1", ActorFacts{UserID: "user-1"}, LevelAdminister)
	require.NoError(t, err)
	require.False(t, decision.Allowed)
}

func TestAuthorizeCombinesCredentialPolicyMembershipAndLevel(t *testing.T) {
	ctx := context.Background()
	db, err := database.InitDBWithDriver("sqlite", fmt.Sprintf("file:workspace-access-policy-%d?mode=memory&cache=shared", time.Now().UnixNano()))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))

	now := time.Now().UTC()
	user := models.User{ID: "user-1", Email: "user@example.com", PasswordHash: "hash", CreatedAt: now}
	organization := models.Organization{ID: "org-1", Name: "Org", CreatedByID: user.ID, CreatedAt: now, UpdatedAt: now}
	workspace := models.Workspace{ID: "workspace-1", OrganizationID: organization.ID, Name: "Workspace", CreatedAt: now}
	provider := models.IdentityProvider{ID: "provider-1", OrganizationID: organization.ID, Source: "database", Issuer: "https://idp.example.com", Name: "Company SSO", ClientID: "client", Scopes: "openid email", EmailClaim: "email", NameClaim: "name", IsActive: true, CreatedAt: now, UpdatedAt: now}
	session := models.UserSession{ID: "session-1", UserID: user.ID, ExpiresAt: now.Add(time.Hour), LastUsedAt: now, CreatedAt: now}
	for _, row := range []any{&user, &organization, &models.OrganizationMember{OrganizationID: organization.ID, UserID: user.ID, Role: models.OrganizationRoleMember, CreatedAt: now}, &workspace, &provider, &session} {
		_, err := db.NewInsert().Model(row).Exec(ctx)
		require.NoError(t, err)
	}
	authorizer := NewAuthorizer(db)

	decision, err := authorizer.Authorize(ctx, workspace.ID, ActorFacts{UserID: user.ID, SessionID: session.ID}, LevelRead)
	require.NoError(t, err)
	require.False(t, decision.Allowed, "organization membership alone must not grant workspace content access")

	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: workspace.ID, UserID: user.ID, Role: models.WorkspaceRoleViewer, Status: models.WorkspaceMemberStatusActive, CreatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	decision, err = authorizer.Authorize(ctx, workspace.ID, ActorFacts{UserID: user.ID, SessionID: session.ID}, LevelRead)
	require.NoError(t, err)
	require.True(t, decision.Allowed)
	require.Equal(t, models.WorkspaceRoleViewer, decision.Role)
	decision, err = authorizer.Authorize(ctx, workspace.ID, ActorFacts{UserID: user.ID, SessionID: session.ID}, LevelEdit)
	require.NoError(t, err)
	require.False(t, decision.Allowed)

	_, err = db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role = ?", models.WorkspaceRoleEditor).Where("workspace_id = ? AND user_id = ?", workspace.ID, user.ID).Exec(ctx)
	require.NoError(t, err)
	decision, err = authorizer.Authorize(ctx, workspace.ID, ActorFacts{UserID: user.ID, CredentialWorkspaceID: "other-workspace"}, LevelEdit)
	require.NoError(t, err)
	require.False(t, decision.Allowed)
	decision, err = authorizer.Authorize(ctx, workspace.ID, ActorFacts{UserID: user.ID, SessionID: session.ID}, LevelEdit)
	require.NoError(t, err)
	require.True(t, decision.Allowed)

	_, err = db.NewInsert().Model(&models.OrganizationSSOPolicy{OrganizationID: organization.ID, Mode: models.OrganizationSSOModeRequired, ProviderIDs: `["provider-1"]`, AssuranceMaxAgeSeconds: 3600, PasswordLoginAllowed: false, APITokenMode: models.OrganizationSSOTokensScoped, MaxTokenLifetimeSeconds: 3600, RequireTokenReauth: true, UpdatedByUserID: user.ID, CreatedAt: now, UpdatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	decision, err = authorizer.Authorize(ctx, workspace.ID, ActorFacts{UserID: user.ID, SessionID: session.ID}, LevelRead)
	require.NoError(t, err)
	require.False(t, decision.Allowed)
	_, err = db.NewInsert().Model(&models.SessionIdentityAssurance{SessionID: session.ID, ProviderID: provider.ID, UserID: user.ID, AuthTime: now, ExpiresAt: now.Add(time.Hour), AMR: `["mfa"]`, CreatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	decision, err = authorizer.Authorize(ctx, workspace.ID, ActorFacts{UserID: user.ID, SessionID: session.ID}, LevelRead)
	require.NoError(t, err)
	require.True(t, decision.Allowed)

	_, err = db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("status = ?", models.WorkspaceMemberStatusInactive).Where("workspace_id = ? AND user_id = ?", workspace.ID, user.ID).Exec(ctx)
	require.NoError(t, err)
	decision, err = authorizer.Authorize(ctx, workspace.ID, ActorFacts{UserID: user.ID, SessionID: session.ID}, LevelRead)
	require.NoError(t, err)
	require.False(t, decision.Allowed)
}
