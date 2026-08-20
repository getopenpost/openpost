package migrations

import (
	"context"
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestAccountFeaturesMigrationCreatesTablesAndConstraints(t *testing.T) {
	t.Parallel()
	sqldb, err := sql.Open("sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	_, err = db.ExecContext(ctx, "PRAGMA foreign_keys = ON")
	require.NoError(t, err)

	for _, m := range []string{
		`CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL)`,
		`CREATE TABLE workspaces (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE social_accounts (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, slug TEXT NOT NULL, platform TEXT NOT NULL, account_id TEXT NOT NULL, access_token_encrypted BLOB NOT NULL, capability_state_json TEXT NOT NULL DEFAULT '{}', granted_scopes TEXT NOT NULL DEFAULT '', is_active BOOLEAN DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE)`,
	} {
		_, err = db.ExecContext(ctx, m)
		require.NoError(t, err)
	}
	raw, err := migrationFiles.ReadFile("106_account_features.sql")
	require.NoError(t, err)
	sqlStr := normalizeMigrationSQL(db.Dialect().Name(), string(raw))
	_, err = db.ExecContext(ctx, sqlStr)
	require.NoError(t, err)

	for _, tbl := range []string{"account_features"} {
		var count int
		err = db.NewRaw("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", tbl).Scan(ctx, &count)
		require.NoError(t, err)
		require.Equal(t, 1, count, "table %s should exist", tbl)
	}
	for _, idx := range []string{"account_features_workspace_idx", "account_features_feature_idx", "account_features_workspace_feature_idx"} {
		var c int
		err = db.NewRaw("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?", idx).Scan(ctx, &c)
		require.NoError(t, err)
		require.Equal(t, 1, c, "index %s should exist", idx)
	}

	_, err = db.ExecContext(ctx, "INSERT INTO workspaces VALUES ('ws-1','org-1','W','2020-01-01')")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, "INSERT INTO social_accounts (id, workspace_id, slug, platform, account_id, access_token_encrypted) VALUES ('acc-1','ws-1','s','x','1',x'00')")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO account_features (social_account_id, workspace_id, feature, enabled, decided_by_user_id, source, decided_at) VALUES ('acc-1','ws-1','messaging',1,'','backfill','2020-01-01')`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO account_features (social_account_id, workspace_id, feature, enabled, decided_by_user_id, source, decided_at) VALUES ('acc-1','ws-1','messaging',1,'','backfill','2020-01-01')`)
	require.Error(t, err, "PK (social_account_id, feature) should be unique")

	_, err = db.ExecContext(ctx, "DELETE FROM social_accounts WHERE id='acc-1'")
	require.NoError(t, err)
	var cnt int
	err = db.NewRaw("SELECT COUNT(*) FROM account_features WHERE social_account_id='acc-1'").Scan(ctx, &cnt)
	require.NoError(t, err)
	require.Equal(t, 0, cnt, "cascade should delete features")

	// Idempotent: re-apply migration should not error
	_, err = db.ExecContext(ctx, sqlStr)
	require.NoError(t, err)
}

func TestAccountFeaturesBackfillPreservesExistingBehavior(t *testing.T) {
	t.Parallel()
	sqldb, err := sql.Open("sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	_, err = db.ExecContext(ctx, "PRAGMA foreign_keys = ON")
	require.NoError(t, err)

	for _, m := range []string{
		`CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL)`,
		`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL)`,
		`CREATE TABLE workspaces (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL)`,
	} {
		_, err = db.ExecContext(ctx, m)
		require.NoError(t, err)
	}
	_, err = db.NewCreateTable().Model((*models.SocialAccount)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewCreateTable().Model((*models.GrowthSyncState)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewCreateTable().Model((*models.GrowthRecommendation)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	raw, err := migrationFiles.ReadFile("106_account_features.sql")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, normalizeMigrationSQL(db.Dialect().Name(), string(raw)))
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, "INSERT INTO workspaces VALUES ('ws-1','org-1','W')")
	require.NoError(t, err)
	// Insert diverse accounts
	accounts := []struct {
		id       string
		platform string
		capState string
	}{
		{"acc-msg-on", "x", `{"messages_enabled":"true"}`},
		{"acc-msg-off", "x", `{"messages_enabled":"false"}`},
		{"acc-fb", "facebook", `{}`},
		{"acc-discord", "discord", `{}`},
		{"acc-bsky", "bluesky", `{}`},
		{"acc-yt", "youtube", `{}`},
	}
	for _, a := range accounts {
		_, err = db.ExecContext(ctx, "INSERT INTO social_accounts (id, workspace_id, slug, platform, account_id, access_token_encrypted, capability_state_json) VALUES (?,?,?,?,?,x'00',?)", a.id, "ws-1", a.id, a.platform, "remote-"+a.id, a.capState)
		require.NoError(t, err)
	}
	// Grow prior use: only acc-bsky has sync state
	_, err = db.ExecContext(ctx, "INSERT INTO growth_sync_states (id, workspace_id, social_account_id, platform) VALUES ('sync-1','ws-1','acc-bsky','bluesky')")
	require.NoError(t, err)

	require.NoError(t, backfillAccountFeatures(ctx, db))

	// Verify messaging
	var pf models.AccountFeature
	require.NoError(t, db.NewSelect().Model(&pf).Where("social_account_id = ? AND feature = ?", "acc-msg-on", "messaging").Scan(ctx))
	require.True(t, pf.Enabled, "messages_enabled true should backfill enabled")
	require.NoError(t, db.NewSelect().Model(&pf).Where("social_account_id = ? AND feature = ?", "acc-msg-off", "messaging").Scan(ctx))
	require.False(t, pf.Enabled)

	// Analytics: facebook, bluesky, youtube should be enabled; discord disabled
	require.NoError(t, db.NewSelect().Model(&pf).Where("social_account_id = ? AND feature = ?", "acc-fb", "analytics").Scan(ctx))
	require.True(t, pf.Enabled)
	require.NoError(t, db.NewSelect().Model(&pf).Where("social_account_id = ? AND feature = ?", "acc-discord", "analytics").Scan(ctx))
	require.False(t, pf.Enabled)

	// Engagement: facebook enabled, discord disabled, youtube enabled
	require.NoError(t, db.NewSelect().Model(&pf).Where("social_account_id = ? AND feature = ?", "acc-fb", "engagement").Scan(ctx))
	require.True(t, pf.Enabled)
	require.NoError(t, db.NewSelect().Model(&pf).Where("social_account_id = ? AND feature = ?", "acc-discord", "engagement").Scan(ctx))
	require.False(t, pf.Enabled)
	require.NoError(t, db.NewSelect().Model(&pf).Where("social_account_id = ? AND feature = ?", "acc-yt", "engagement").Scan(ctx))
	require.True(t, pf.Enabled)

	// Grow: only acc-bsky enabled
	require.NoError(t, db.NewSelect().Model(&pf).Where("social_account_id = ? AND feature = ?", "acc-bsky", "grow").Scan(ctx))
	require.True(t, pf.Enabled)
	require.NoError(t, db.NewSelect().Model(&pf).Where("social_account_id = ? AND feature = ?", "acc-fb", "grow").Scan(ctx))
	require.False(t, pf.Enabled)

	// All accounts should have 4 rows each (explicit off for others)
	total, err := db.NewSelect().Model((*models.AccountFeature)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, len(accounts)*4, total)

	// Idempotent: second backfill should not duplicate or error
	require.NoError(t, backfillAccountFeatures(ctx, db))
	total2, err := db.NewSelect().Model((*models.AccountFeature)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, total, total2)

	// Cascade: delete workspace should delete features
	_, err = db.ExecContext(ctx, "DELETE FROM workspaces WHERE id='ws-1'")
	require.NoError(t, err)
	cnt, err := db.NewSelect().Model((*models.AccountFeature)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 0, cnt)

	// Fresh DB backfill with no accounts should be no-op and idempotent
	sqldb2, err := sql.Open("sqlite3", "file:"+t.Name()+"_fresh?mode=memory&cache=shared")
	require.NoError(t, err)
	db2 := bun.NewDB(sqldb2, sqlitedialect.New())
	t.Cleanup(func() { _ = db2.Close() })
	_, err = db2.ExecContext(ctx, "PRAGMA foreign_keys = ON")
	require.NoError(t, err)
	_, err = db2.ExecContext(ctx, `CREATE TABLE workspaces (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL)`)
	require.NoError(t, err)
	_, err = db2.NewCreateTable().Model((*models.SocialAccount)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	_, err = db2.ExecContext(ctx, normalizeMigrationSQL(db2.Dialect().Name(), string(raw)))
	require.NoError(t, err)
	require.NoError(t, backfillAccountFeatures(ctx, db2))
}

func TestAccountFeaturesPostgresNormalization(t *testing.T) {
	raw, err := migrationFiles.ReadFile("106_account_features.sql")
	require.NoError(t, err)
	pgSQL := normalizeMigrationSQL(dialect.PG, string(raw))
	require.NotEmpty(t, pgSQL)
	require.Contains(t, pgSQL, "account_features")
}
