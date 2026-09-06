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
