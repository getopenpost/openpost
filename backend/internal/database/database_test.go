package database

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun/dialect"
)

func TestInitDBPreservesSQLiteDefault(t *testing.T) {
	db, err := InitDB("file::memory:?cache=shared")
	require.NoError(t, err)
	defer db.Close()

	var one int
	require.NoError(t, db.QueryRow("SELECT 1").Scan(&one))
	require.Equal(t, 1, one)
}

func TestInitDBWithDriverInitializesSQLite(t *testing.T) {
	db, err := InitDBWithDriver("sqlite", "file::memory:?cache=shared")
	require.NoError(t, err)
	defer db.Close()

	var one int
	require.NoError(t, db.QueryRow("SELECT 1").Scan(&one))
	require.Equal(t, 1, one)
}

func TestInitDBWithDriverRejectsUnsupportedDriver(t *testing.T) {
	db, err := InitDBWithDriver("mysql", "mysql://example")
	require.Nil(t, db)
	require.ErrorContains(t, err, "unsupported database driver")
}

func TestJSONTextExprForDialect(t *testing.T) {
	require.Equal(t, "json_extract(job.payload, '$.post_id')", JSONTextExprForDialect(dialect.SQLite, "job.payload", "post_id"))
	require.Equal(t, "(job.payload::jsonb ->> 'post_id')", JSONTextExprForDialect(dialect.PG, "job.payload", "post_id"))
}

func TestDateExprForDialect(t *testing.T) {
	require.Equal(t, "DATE(p.scheduled_at)", DateExprForDialect(dialect.SQLite, "p.scheduled_at", ""))
	require.Equal(t, "DATE(datetime(p.scheduled_at, '+01:30'))", DateExprForDialect(dialect.SQLite, "p.scheduled_at", "+01:30"))
	require.Equal(t, "DATE(p.scheduled_at + (-300 * INTERVAL '1 minute'))", DateExprForDialect(dialect.PG, "p.scheduled_at", "-05:00"))
}

func TestInitDBWithDriverBuildsPostgresHandle(t *testing.T) {
	db, err := InitDBWithDriver("postgres", "postgres://openpost:secret@localhost:5432/openpost?sslmode=disable")
	require.NoError(t, err)
	defer db.Close()

	require.NotNil(t, db)
}

func TestCreateSchemaRunsPublicationMigration(t *testing.T) {
	db, err := InitDBWithDriver("sqlite", "file:"+t.Name()+"?mode=memory&cache=private")
	require.NoError(t, err)
	defer db.Close()
	ctx := context.Background()

	require.NoError(t, CreateSchema(db))

	for _, table := range []string{"publications", "publication_assets"} {
		var count int
		require.NoError(t, db.NewSelect().
			ColumnExpr("COUNT(*)").
			TableExpr("sqlite_master").
			Where("type = 'table' AND name = ?", table).
			Scan(ctx, &count))
		require.Equal(t, 1, count, table)
	}

	row := db.QueryRow("SELECT sql FROM sqlite_master WHERE name = 'posts'")
	var postSchema string
	require.NoError(t, row.Scan(&postSchema))
	require.Contains(t, postSchema, "publication_id")

	var jobIndexCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("sqlite_master").
		Where("type = 'index' AND name = ?", "jobs_status_run_at_idx").
		Scan(ctx, &jobIndexCount))
	require.Equal(t, 1, jobIndexCount)

	var videoCodecColumnCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("pragma_table_info('media_attachments')").
		Where("name = ?", "video_codec").
		Scan(ctx, &videoCodecColumnCount))
	require.Equal(t, 1, videoCodecColumnCount)
}

func TestCreateSchemaLetsMigrationOwnImpersonationOrganizationConstraints(t *testing.T) {
	db, err := InitDBWithDriver("sqlite", "file:"+t.Name()+"?mode=memory&cache=private")
	require.NoError(t, err)
	defer db.Close()
	require.NoError(t, CreateSchema(db))

	var schema string
	require.NoError(t, db.QueryRow(
		"SELECT sql FROM sqlite_master WHERE name = 'user_impersonation_grant_organizations'",
	).Scan(&schema))
	require.Contains(t, schema, "FOREIGN KEY (grant_id) REFERENCES user_impersonation_grants(id) ON DELETE CASCADE")
	require.Contains(t, schema, "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE")
}
