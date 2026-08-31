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

func TestWorkspaceInvitationDeliveryOutcomesMigrationStoresRedactedEvidence(t *testing.T) {
	sqlDB, err := sql.Open(sqliteshim.ShimName, ":memory:")
	require.NoError(t, err)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	ctx := context.Background()
	_, err = db.ExecContext(ctx, "PRAGMA foreign_keys=ON")
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `CREATE TABLE users (
		id TEXT PRIMARY KEY
	);
	CREATE TABLE workspace_invitations (
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

	_, err = db.ExecContext(ctx, `
		INSERT INTO users (id) VALUES ('user-1');
		INSERT INTO workspace_invitations (id) VALUES ('invitation-1');
		INSERT INTO workspace_invitation_delivery_events
			(event_id, invitation_id, delivery_id, outcome, occurred_at)
			VALUES ('event-1', 'invitation-1', 'delivery-1', 'delivered', CURRENT_TIMESTAMP);
		INSERT INTO workspace_invitation_resends
			(id, invitation_id, actor_user_id, resent_at)
			VALUES ('resend-1', 'invitation-1', 'user-1', CURRENT_TIMESTAMP);
	`)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `
		INSERT INTO workspace_invitation_delivery_events
			(event_id, invitation_id, delivery_id, outcome, occurred_at, email)
			VALUES ('event-private', 'invitation-1', 'delivery-2', 'delivered', CURRENT_TIMESTAMP, 'private@example.com')
	`)
	require.ErrorContains(t, err, "email")

	_, err = db.ExecContext(ctx, "DELETE FROM workspace_invitations WHERE id = 'invitation-1'")
	require.NoError(t, err)
	for _, table := range []string{
		"workspace_invitation_delivery_events",
		"workspace_invitation_resends",
	} {
		var count int
		require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").Table(table).Scan(ctx, &count))
		require.Zero(t, count)
	}
}
