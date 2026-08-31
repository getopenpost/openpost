package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNotificationMutesMigrationKeepsLegacyDigestScopeUnknown(t *testing.T) {
	db := newMigrationsTestDB(t)
	require.NoError(t, runTestMigrations(t, db))
	ctx := context.Background()

	_, err := db.ExecContext(ctx, "INSERT INTO users (id, email, password_hash) VALUES ('legacy-mute-user', 'legacy-mute@example.com', 'hash')")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO user_notification_digest_items
		(id, user_id, type, title, delivery_window_at)
		VALUES ('legacy-item', 'legacy-mute-user', 'new_message', 'Legacy item', '2035-08-16T21:15:00Z')`)
	require.NoError(t, err)
	var workspaceID string
	var workspaceKnown bool
	require.NoError(t, db.QueryRowContext(ctx,
		"SELECT workspace_id, workspace_scope_known FROM user_notification_digest_items WHERE id = 'legacy-item'",
	).Scan(&workspaceID, &workspaceKnown))
	require.Empty(t, workspaceID)
	require.False(t, workspaceKnown, "pre-upgrade items must keep an explicit unknown Workspace scope")
}
