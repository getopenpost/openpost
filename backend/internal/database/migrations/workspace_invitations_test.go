package migrations

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesWorkspaceInvitationsSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, RunMigrations(db))

	row := db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'workspace_invitations'")
	var schema string
	require.NoError(t, row.Scan(&schema))
	require.Contains(t, schema, "workspace_id TEXT NOT NULL")
	require.Contains(t, schema, "email TEXT NOT NULL")
	require.Contains(t, schema, "role TEXT NOT NULL DEFAULT 'editor'")
	require.Contains(t, schema, "token_hash TEXT NOT NULL UNIQUE")
	require.Contains(t, schema, "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE")
	require.Contains(t, schema, "FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE")
	require.Contains(t, schema, "FOREIGN KEY (accepted_by_user_id) REFERENCES users(id) ON DELETE SET NULL")

	var indexCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("sqlite_master").
		Where("type = 'index' AND name IN ('workspace_invitations_workspace_status_idx', 'workspace_invitations_email_idx')").
		Scan(ctx, &indexCount))
	require.Equal(t, 2, indexCount)
}

func TestRunMigrationsWorkspaceInvitationsCascadeWithWorkspace(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, RunMigrations(db))

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
