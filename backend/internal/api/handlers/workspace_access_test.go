package handlers

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestTransportWorkspaceAdapterMatchesCanonicalDecision(t *testing.T) {
	db, fixture := newWorkspaceAccessFixture(t)
	ctx := context.WithValue(t.Context(), middleware.WorkspaceIDKey, fixture.workspace.ID)
	actor := workspaceActor(ctx, fixture.user.ID)

	for _, level := range []workspaceaccess.Level{workspaceaccess.LevelRead, workspaceaccess.LevelEdit, workspaceaccess.LevelAdminister} {
		canonical, err := workspaceaccess.NewAuthorizer(db).Authorize(ctx, fixture.workspace.ID, actor, level)
		require.NoError(t, err)
		transport, err := workspaceDecision(ctx, db, fixture.workspace.ID, fixture.user.ID, level)
		require.NoError(t, err)
		require.Equal(t, canonical, transport)

		outside, err := workspaceDecision(ctx, db, "another-workspace", fixture.user.ID, level)
		require.NoError(t, err)
		require.False(t, outside.Allowed)
	}
}

func TestInvitationPreMembershipAccessUsesCanonicalCredentialAndIdentityPolicy(t *testing.T) {
	db, fixture := newWorkspaceAccessFixture(t)
	actor := workspaceaccess.ActorFacts{UserID: "invitee-1", CredentialWorkspaceID: fixture.workspace.ID}
	decision, err := workspaceaccess.NewAuthorizer(db).AuthorizePreMembership(t.Context(), fixture.workspace.ID, actor)
	require.NoError(t, err)
	require.True(t, decision.Allowed)

	decision, err = workspaceaccess.NewAuthorizer(db).AuthorizePreMembership(t.Context(), "workspace-2", actor)
	require.NoError(t, err)
	require.False(t, decision.Allowed)
}

func TestWorkspaceAccessParityAcrossAuthenticatedAdapters(t *testing.T) {
	db, fixture := newWorkspaceAccessFixture(t)
	now := time.Now().UTC()
	provider := models.IdentityProvider{ID: "provider-parity", OrganizationID: "organization-1", Source: "database", Issuer: "https://idp.example.test", Name: "Company SSO", ClientID: "client", Scopes: "openid email", EmailClaim: "email", NameClaim: "name", IsActive: true, CreatedAt: now, UpdatedAt: now}
	session := models.UserSession{ID: "session-parity", UserID: fixture.user.ID, ExpiresAt: now.Add(time.Hour), LastUsedAt: now, CreatedAt: now}
	for _, row := range []any{
		&provider,
		&session,
		&models.SessionIdentityAssurance{SessionID: session.ID, ProviderID: provider.ID, UserID: fixture.user.ID, AuthTime: now, ExpiresAt: now.Add(time.Hour), AMR: `["mfa"]`, CreatedAt: now},
		&models.OrganizationSSOPolicy{OrganizationID: "organization-1", Mode: models.OrganizationSSOModeRequired, ProviderIDs: `["provider-parity"]`, AssuranceMaxAgeSeconds: 3600, PasswordLoginAllowed: false, APITokenMode: models.OrganizationSSOTokensScoped, MaxTokenLifetimeSeconds: 3600, RequireTokenReauth: true, UpdatedByUserID: fixture.user.ID, CreatedAt: now, UpdatedAt: now},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
	for _, tokenID := range []string{"rest-token", "cli-token", "mcp-token"} {
		_, err := db.NewInsert().Model(&models.APIToken{ID: tokenID, UserID: fixture.user.ID, Name: tokenID, ClientID: tokenID + "-client", TokenHash: "hash-" + tokenID, TokenPrefix: tokenID, Scope: "cli:full", WorkspaceID: fixture.workspace.ID, OrganizationID: "organization-1", IdentityProviderID: provider.ID, AssuredAt: now, CreatedAt: now}).Exec(t.Context())
		require.NoError(t, err)
	}

	cases := []struct {
		name  string
		actor workspaceaccess.ActorFacts
	}{
		{name: "browser", actor: workspaceaccess.ActorFacts{UserID: fixture.user.ID, SessionID: session.ID}},
		{name: "rest", actor: workspaceaccess.ActorFacts{UserID: fixture.user.ID, TokenID: "rest-token", ClientID: "rest-token-client", CredentialWorkspaceID: fixture.workspace.ID}},
		{name: "cli", actor: workspaceaccess.ActorFacts{UserID: fixture.user.ID, TokenID: "cli-token", ClientID: "cli-token-client", CredentialWorkspaceID: fixture.workspace.ID}},
		{name: "mcp", actor: workspaceaccess.ActorFacts{UserID: fixture.user.ID, TokenID: "mcp-token", ClientID: "mcp-token-client", CredentialWorkspaceID: fixture.workspace.ID}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			canonical, err := workspaceaccess.NewAuthorizer(db).Authorize(t.Context(), fixture.workspace.ID, test.actor, workspaceaccess.LevelRead)
			require.NoError(t, err)
			require.True(t, canonical.Allowed)
			ctx := context.WithValue(t.Context(), middleware.SessionIDKey, test.actor.SessionID)
			ctx = context.WithValue(ctx, middleware.TokenIDKey, test.actor.TokenID)
			ctx = context.WithValue(ctx, middleware.ClientIDKey, test.actor.ClientID)
			ctx = context.WithValue(ctx, middleware.WorkspaceIDKey, test.actor.CredentialWorkspaceID)
			transport, err := workspaceDecision(ctx, db, fixture.workspace.ID, fixture.user.ID, workspaceaccess.LevelRead)
			require.NoError(t, err)
			require.Equal(t, canonical, transport)

			ctx = context.WithValue(ctx, middleware.WorkspaceIDKey, "other-workspace")
			denied, err := workspaceDecision(ctx, db, fixture.workspace.ID, fixture.user.ID, workspaceaccess.LevelRead)
			require.NoError(t, err)
			require.False(t, denied.Allowed)
		})
	}
}

type workspaceAccessFixture struct {
	workspace models.Workspace
	user      models.User
}

func newWorkspaceAccessFixture(t *testing.T) (*bun.DB, workspaceAccessFixture) {
	t.Helper()
	db := newHandlerSchemaTestDB(t)
	now := time.Now().UTC()
	fixture := workspaceAccessFixture{
		workspace: models.Workspace{ID: "workspace-1", OrganizationID: "organization-1", Name: "Workspace", CreatedAt: now},
		user:      models.User{ID: "user-1", Email: "user@example.test", PasswordHash: "hash", CreatedAt: now},
	}
	for _, row := range []any{
		&fixture.user,
		&models.Organization{ID: "organization-1", Name: "Organization", CreatedAt: now},
		&fixture.workspace,
		&models.WorkspaceMember{WorkspaceID: fixture.workspace.ID, UserID: fixture.user.ID, Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive, CreatedAt: now},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
	return db, fixture
}
