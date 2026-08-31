package migrations

import (
	"context"
	"database/sql"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

func TestWorkspaceInvitationDeliveryMigrationPreservesExistingInvitations(t *testing.T) {
	sqlDB, err := sql.Open(sqliteshim.ShimName, ":memory:")
	require.NoError(t, err)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	ctx := context.Background()

	_, err = db.ExecContext(ctx, `CREATE TABLE workspace_invitations (
		id TEXT PRIMARY KEY,
		email TEXT NOT NULL
	)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO workspace_invitations (id, email) VALUES ('invite-1', 'person@example.com')`)
	require.NoError(t, err)

	raw, err := migrationFiles.ReadFile("111_workspace_invitation_delivery.sql")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, string(raw))
	require.NoError(t, err)

	var row struct {
		Status string `bun:"email_delivery_status"`
		JobID  string `bun:"email_delivery_job_id"`
	}
	require.NoError(t, db.NewSelect().Table("workspace_invitations").
		Column("email_delivery_status", "email_delivery_job_id").
		Where("id = ?", "invite-1").Scan(ctx, &row))
	require.Equal(t, "unavailable", row.Status)
	require.Empty(t, row.JobID)
}

func TestRunMigration111BeforeCreateSchemaBuildsStableInvitationTable(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := context.Background()
	raw, err := migrationFiles.ReadFile("111_workspace_invitation_delivery.sql")
	require.NoError(t, err)

	require.NoError(t, runMigrations(db, fstest.MapFS{
		"111_workspace_invitation_delivery.sql": &fstest.MapFile{Data: raw},
	}))

	for _, column := range []string{
		"id",
		"workspace_id",
		"email",
		"email_delivery_status",
		"email_delivery_job_id",
		"email_delivery_updated_at",
	} {
		present, columnErr := migrationColumnExists(ctx, db, "workspace_invitations", column)
		require.NoError(t, columnErr)
		require.True(t, present, "expected migration 111 table column %s", column)
	}
}
