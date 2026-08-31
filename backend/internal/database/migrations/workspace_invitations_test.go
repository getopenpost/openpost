package migrations

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsWorkspaceInvitationsCascadeWithWorkspace(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-invite", Name: "Invites"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceInvitation{
		ID:              "invite-1",
		WorkspaceID:     "ws-invite",
		Email:           "teammate@example.com",
		Role:            models.WorkspaceRoleEditor,
		InvitedByUserID: "user-1",
		TokenHash:       "token-hash",
		ExpiresAt:       time.Now().UTC().Add(7 * 24 * time.Hour),
	}).Exec(ctx)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, "DELETE FROM workspaces WHERE id = ?", "ws-invite")
	require.NoError(t, err)

	var count int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("workspace_invitations").Scan(ctx, &count))
	require.Equal(t, 0, count)
}
