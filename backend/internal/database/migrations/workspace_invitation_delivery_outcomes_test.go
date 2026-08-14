package migrations

import (
	"context"
	"database/sql"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

func TestWorkspaceInvitationDeliveryOutcomesMigrationAddsRedactedEvidence(t *testing.T) {
	sqlDB, err := sql.Open(sqliteshim.ShimName, ":memory:")
	require.NoError(t, err)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	ctx := context.Background()

	_, err = db.ExecContext(ctx, `CREATE TABLE workspace_invitations (
		id TEXT PRIMARY KEY,
		email_delivery_status TEXT NOT NULL DEFAULT 'unavailable',
		email_delivery_job_id TEXT NOT NULL DEFAULT ''
	)`)
	require.NoError(t, err)
	raw, err := migrationFiles.ReadFile("096_workspace_invitation_delivery_outcomes.sql")
	require.NoError(t, err)
	require.NoError(t, ensureWorkspaceInvitationDeliveryUpdatedAt(ctx, db))
	_, err = db.ExecContext(ctx, string(raw))
	require.NoError(t, err)

	var columnCount int
	require.NoError(t, db.NewRaw(
		"SELECT COUNT(*) FROM pragma_table_info('workspace_invitations') WHERE name = 'email_delivery_updated_at'",
	).Scan(ctx, &columnCount))
	require.Equal(t, 1, columnCount)

	var eventSchema string
	require.NoError(t, db.NewSelect().Column("sql").Table("sqlite_master").
		Where("type = 'table' AND name = 'workspace_invitation_delivery_events'").Scan(ctx, &eventSchema))
	require.Contains(t, eventSchema, "event_id TEXT PRIMARY KEY")
	require.NotContains(t, eventSchema, "email")
	require.NotContains(t, eventSchema, "token")
	require.NotContains(t, eventSchema, "payload")

	var resendSchema string
	require.NoError(t, db.NewSelect().Column("sql").Table("sqlite_master").
		Where("type = 'table' AND name = 'workspace_invitation_resends'").Scan(ctx, &resendSchema))
	require.Contains(t, resendSchema, "invitation_id TEXT NOT NULL")
	require.Contains(t, resendSchema, "actor_user_id TEXT NOT NULL")
	require.Contains(t, resendSchema, "ON DELETE CASCADE")
	require.NotContains(t, resendSchema, "email")
	require.NotContains(t, resendSchema, "token")
}
