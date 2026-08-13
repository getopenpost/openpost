package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesProviderDeliveryProjection(t *testing.T) {
	t.Parallel()
	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	var schema string
	require.NoError(t, db.NewSelect().Table("sqlite_master").Column("sql").
		Where("type = 'table' AND name = 'provider_deliveries'").Scan(ctx, &schema))
	require.Contains(t, schema, "current_attempt_created_at DATETIME NOT NULL")
	require.Contains(t, schema, "'provider_scheduled'")
	require.Contains(t, schema, "'manual_resolution'")
	require.Contains(t, schema, "UNIQUE (rendition_id, target_key)")
	require.Contains(t, schema, "retry_safety TEXT NOT NULL DEFAULT 'never'")
	require.Contains(t, schema, "safe_error_class TEXT NOT NULL DEFAULT ''")
	require.Contains(t, schema, "safe_error_code TEXT NOT NULL DEFAULT ''")
	require.Contains(t, schema, "error_http_status INTEGER NOT NULL DEFAULT 0")
	require.Contains(t, schema, "FOREIGN KEY (current_attempt_id) REFERENCES provider_write_attempts(id) ON DELETE CASCADE")

	var indexCount int
	require.NoError(t, db.NewSelect().Table("sqlite_master").ColumnExpr("COUNT(*)").
		Where("type = 'index' AND name IN ('provider_deliveries_publication_state_idx', 'provider_deliveries_reconcile_idx')").
		Scan(ctx, &indexCount))
	require.Equal(t, 2, indexCount)
}
