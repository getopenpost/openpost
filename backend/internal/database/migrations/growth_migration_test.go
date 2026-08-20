package migrations

import (
	"context"
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestGrowthMigrationCreatesTablesAndConstraints(t *testing.T) {
	t.Parallel()
	sqldb, err := sql.Open("sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	_, err = db.ExecContext(ctx, "PRAGMA foreign_keys = ON")
	require.NoError(t, err)

	// Create prerequisite tables
	for _, m := range []string{
		`CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE workspaces (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE social_accounts (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, slug TEXT NOT NULL, platform TEXT NOT NULL, account_id TEXT NOT NULL, access_token_encrypted BLOB NOT NULL, is_active BOOLEAN DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
	} {
		_, err = db.ExecContext(ctx, m)
		require.NoError(t, err)
	}

	raw, err := migrationFiles.ReadFile("105_growth_recommendations.sql")
	require.NoError(t, err)
	sqlStr := normalizeMigrationSQL(db.Dialect().Name(), string(raw))
	// Execute migration SQL
	_, err = db.ExecContext(ctx, sqlStr)
	require.NoError(t, err)

	// Verify tables exist
	for _, tbl := range []string{"growth_recommendations", "growth_sync_states"} {
		var count int
		err = db.NewRaw("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", tbl).Scan(ctx, &count)
		require.NoError(t, err)
		require.Equal(t, 1, count, "table %s should exist", tbl)
	}

	// Verify indexes
	for _, idx := range []string{
		"growth_recommendations_workspace_idx",
		"growth_recommendations_social_account_idx",
		"growth_recommendations_generation_idx",
		"growth_recommendations_score_idx",
		"growth_sync_states_workspace_idx",
		"growth_sync_states_social_account_idx",
	} {
		var c int
		err = db.NewRaw("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?", idx).Scan(ctx, &c)
		require.NoError(t, err)
		require.Equal(t, 1, c, "index %s should exist", idx)
	}

	// Verify unique constraint on (social_account_id, remote_account_id)
	_, err = db.ExecContext(ctx, "INSERT INTO workspaces VALUES ('ws-1','org-1','W','2020-01-01')")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, "INSERT INTO social_accounts VALUES ('acc-1','ws-1','s','bluesky','did:plc:1',x'00',1,'2020-01-01')")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO growth_sync_states (id, workspace_id, social_account_id, platform, status, current_generation_id, created_at, updated_at) VALUES ('sync-1','ws-1','acc-1','bluesky','idle','gen-1','2020-01-01','2020-01-01')`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO growth_recommendations (id, workspace_id, social_account_id, platform, remote_account_id, handle, generation_id, last_seen_at, created_at, updated_at) VALUES ('rec-1','ws-1','acc-1','bluesky','remote-1','alice','gen-1','2020-01-01','2020-01-01','2020-01-01')`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO growth_recommendations (id, workspace_id, social_account_id, platform, remote_account_id, handle, generation_id, last_seen_at, created_at, updated_at) VALUES ('rec-2','ws-1','acc-1','bluesky','remote-1','alice','gen-1','2020-01-01','2020-01-01','2020-01-01')`)
	require.Error(t, err, "unique (social_account_id, remote_account_id) should be enforced")

	// Verify cascade on social account delete
	_, err = db.ExecContext(ctx, "DELETE FROM social_accounts WHERE id='acc-1'")
	require.NoError(t, err)
	var recCount int
	err = db.NewRaw("SELECT COUNT(*) FROM growth_recommendations WHERE social_account_id='acc-1'").Scan(ctx, &recCount)
	require.NoError(t, err)
	require.Equal(t, 0, recCount, "cascade should delete recommendations")
	var syncCount int
	err = db.NewRaw("SELECT COUNT(*) FROM growth_sync_states WHERE social_account_id='acc-1'").Scan(ctx, &syncCount)
	require.NoError(t, err)
	require.Equal(t, 0, syncCount, "cascade should delete sync state")

	// Verify unique on social_account_id for sync state
	_, err = db.ExecContext(ctx, "INSERT INTO social_accounts VALUES ('acc-2','ws-1','s2','bluesky','did:plc:2',x'00',1,'2020-01-01')")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO growth_sync_states (id, workspace_id, social_account_id, platform, status, current_generation_id, created_at, updated_at) VALUES ('sync-2','ws-1','acc-2','bluesky','idle','gen-2','2020-01-01','2020-01-01')`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO growth_sync_states (id, workspace_id, social_account_id, platform, status, current_generation_id, created_at, updated_at) VALUES ('sync-3','ws-1','acc-2','bluesky','idle','gen-3','2020-01-01','2020-01-01')`)
	require.Error(t, err, "unique social_account_id should be enforced for sync state")
}
