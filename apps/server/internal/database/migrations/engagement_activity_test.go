package migrations

import (
	"strings"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestAccountActivityUpgradePreservesCommentsAndReceipts(t *testing.T) {
	exerciseAccountActivityUpgrade(t, newMigrationsTestDB(t))
}

func TestAccountActivityUpgradePreservesCommentsAndReceiptsPostgres(t *testing.T) {
	exerciseAccountActivityUpgrade(t, newPostgresMigrationTestDB(t))
}

func TestAccountActivityUpgradePreservesUnrelatedForeignKeyViolations(t *testing.T) {
	db := newMigrationsTestDB(t)
	migrateBeforeAccountActivity(t, db)
	for _, statement := range []string{
		`PRAGMA foreign_keys=OFF`,
		`INSERT INTO analytics_sync_states(id,workspace_id,subject_type,subject_id,social_account_id,platform) VALUES('orphan-analytics','missing-workspace','account','missing-account','missing-account','bluesky')`,
		`INSERT INTO messaging_sync_states(id,workspace_id,social_account_id,platform) VALUES('orphan-messaging','missing-workspace','missing-account','bluesky')`,
		`PRAGMA foreign_keys=ON`,
	} {
		_, err := db.ExecContext(t.Context(), statement)
		require.NoError(t, err)
	}
	require.NoError(t, RunMigrations(db))
	for _, table := range []string{"analytics_sync_states", "messaging_sync_states"} {
		var count int
		require.NoError(t, db.QueryRowContext(t.Context(), `SELECT COUNT(*) FROM `+table+` WHERE social_account_id='missing-account'`).Scan(&count))
		require.Equal(t, 1, count, "unrelated historical rows must remain intact")
	}
	var violations int
	require.NoError(t, db.QueryRowContext(t.Context(), `SELECT COUNT(*) FROM pragma_foreign_key_check`).Scan(&violations))
	require.Equal(t, 2, violations)
}

func TestAccountActivityUpgradeRejectsBrokenEngagementForeignKeys(t *testing.T) {
	for _, fixture := range []struct{ name, statement string }{
		{"outgoing", `INSERT INTO engagement_items(id,rendition_id) VALUES('item','missing-rendition')`},
		{"incoming", `INSERT INTO activity_receipts(item_id) VALUES('missing-item')`},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			db := newMigrationsTestDB(t)
			for _, statement := range []string{
				`CREATE TABLE activity_renditions(id TEXT PRIMARY KEY)`,
				`CREATE TABLE engagement_items(id TEXT PRIMARY KEY,rendition_id TEXT NOT NULL REFERENCES activity_renditions(id))`,
				`CREATE TABLE activity_receipts(item_id TEXT REFERENCES "ENGAGEMENT_ITEMS"(id))`,
				`PRAGMA foreign_keys=OFF`,
				fixture.statement,
				`PRAGMA foreign_keys=ON`,
			} {
				_, err := db.ExecContext(t.Context(), statement)
				require.NoError(t, err)
			}
			require.ErrorContains(t, prepareAccountEngagement(t.Context(), db), "engagement rebuild violates an existing foreign key")
			var ddl string
			require.NoError(t, db.QueryRowContext(t.Context(), `SELECT sql FROM sqlite_master WHERE name='engagement_items'`).Scan(&ddl))
			require.Contains(t, ddl, "rendition_id TEXT NOT NULL", "failed rebuild must roll back")
			var foreignKeys int
			require.NoError(t, db.QueryRowContext(t.Context(), `PRAGMA foreign_keys`).Scan(&foreignKeys))
			require.Equal(t, 1, foreignKeys, "failed rebuild must restore enforcement")
		})
	}
}

func migrateBeforeAccountActivity(t *testing.T, db *bun.DB) {
	t.Helper()
	previous := fstest.MapFS{}
	entries, err := migrationFiles.ReadDir(".")
	require.NoError(t, err)
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		version, err := parseVersion(entry.Name())
		require.NoError(t, err)
		if version < 171 {
			data, err := migrationFiles.ReadFile(entry.Name())
			require.NoError(t, err)
			previous[entry.Name()] = &fstest.MapFile{Data: data}
		}
	}
	require.NoError(t, runMigrations(db, previous))
}

func exerciseAccountActivityUpgrade(t *testing.T, db *bun.DB) {
	t.Helper()
	migrateBeforeAccountActivity(t, db)
	for _, statement := range []string{
		`INSERT INTO users(id,email,password_hash) VALUES('activity-user','activity@example.com','hash')`,
		`INSERT INTO workspaces(id,name) VALUES('activity-ws','Activity')`,
		`INSERT INTO social_accounts(id,workspace_id,slug,platform,account_id,access_token_encrypted) VALUES('activity-account','activity-ws','activity','bluesky','did:plc:sample',?)`,
		`INSERT INTO publications(id,workspace_id,created_by,title,status) VALUES('activity-post','activity-ws','activity-user','Activity','draft')`,
		`INSERT INTO renditions(id,publication_id,social_account_id,platform,profile) VALUES('activity-rendition','activity-post','activity-account','bluesky','short_text')`,
		`INSERT INTO engagement_items(id,workspace_id,rendition_id,social_account_id,platform,remote_id,body,read_at,last_seen_at) VALUES('activity-comment','activity-ws','activity-rendition','activity-account','bluesky','{"uri":"at://did:plc:alice/app.bsky.feed.post/comment","cid":"comment-cid"}','Original',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
		`INSERT INTO engagement_operations(workspace_id,user_id,item_id,operation_id,body_hash,job_id) VALUES('activity-ws','activity-user','activity-comment','operation','hash','job')`,
	} {
		var args []any
		if strings.Contains(statement, "access_token_encrypted") {
			args = []any{[]byte{0}}
		}
		_, err := db.ExecContext(t.Context(), statement, args...)
		require.NoError(t, err)
	}
	require.NoError(t, RunMigrations(db))
	require.NoError(t, RunMigrations(db))
	_, err := db.ExecContext(t.Context(), `INSERT INTO engagement_items(id,workspace_id,rendition_id,social_account_id,platform,remote_id,last_seen_at) VALUES('activity-mention','activity-ws',NULL,'activity-account','bluesky','mention',CURRENT_TIMESTAMP)`)
	require.NoError(t, err, "account activity must not require a fabricated post")
	var body, receipt string
	var read bool
	require.NoError(t, db.QueryRowContext(t.Context(), `SELECT body,read_at IS NOT NULL FROM engagement_items WHERE id='activity-comment'`).Scan(&body, &read))
	require.Equal(t, "Original", body)
	var nativeID string
	require.NoError(t, db.QueryRowContext(t.Context(), `SELECT native_remote_id FROM engagement_items WHERE id='activity-comment'`).Scan(&nativeID))
	require.Equal(t, "at://did:plc:alice/app.bsky.feed.post/comment", nativeID)
	require.True(t, read)
	require.NoError(t, db.QueryRowContext(t.Context(), `SELECT job_id FROM engagement_operations WHERE item_id='activity-comment'`).Scan(&receipt))
	require.Equal(t, "job", receipt)
	_, err = db.ExecContext(t.Context(), `DELETE FROM social_accounts WHERE id='activity-account'`)
	require.NoError(t, err)
	var count int
	require.NoError(t, db.QueryRowContext(t.Context(), `SELECT COUNT(*) FROM engagement_items`).Scan(&count))
	require.Zero(t, count, "account cascade remains enforced after the rebuild")
}
