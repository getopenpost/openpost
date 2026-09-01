package migrations

import (
	"context"
	"testing"
	"testing/fstest"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun/dialect"
)

func TestAnalyticsMetricSemanticsMigrationPreservesLegacyRows(t *testing.T) {
	t.Parallel()
	db := newMigrationsTestDB(t)
	ctx := context.Background()
	_, err := db.ExecContext(ctx, `
CREATE TABLE analytics_account_snapshots (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, social_account_id TEXT NOT NULL,
 platform TEXT NOT NULL, metrics_json TEXT NOT NULL DEFAULT '{}', capture_key TEXT NOT NULL DEFAULT '', captured_at TIMESTAMP NOT NULL
);
CREATE TABLE analytics_rendition_snapshots (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, publication_id TEXT NOT NULL, rendition_id TEXT NOT NULL,
 social_account_id TEXT NOT NULL, platform TEXT NOT NULL, metrics_json TEXT NOT NULL DEFAULT '{}',
 capture_key TEXT NOT NULL DEFAULT '', captured_at TIMESTAMP NOT NULL
);
CREATE TABLE analytics_sync_states (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
 social_account_id TEXT NOT NULL, platform TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 error_code TEXT NOT NULL DEFAULT '', error_message TEXT NOT NULL DEFAULT '', metrics_json TEXT NOT NULL DEFAULT '{}',
 last_attempted_at TIMESTAMP, last_success_at TIMESTAMP, next_sync_at TIMESTAMP,
 unchanged_streak INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NOT NULL
);
INSERT INTO analytics_account_snapshots VALUES ('account-snapshot', 'ws-1', 'account-1', 'x', '{"followers":10}', '', CURRENT_TIMESTAMP);
INSERT INTO analytics_rendition_snapshots VALUES ('rendition-snapshot', 'ws-1', 'publication-1', 'rendition-1', 'account-1', 'x', '{"views":20}', '', CURRENT_TIMESTAMP);
INSERT INTO analytics_sync_states VALUES ('rendition:rendition-1', 'ws-1', 'rendition', 'rendition-1', 'account-1', 'x', 'ok', '', '', '{"views":20}', NULL, CURRENT_TIMESTAMP, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	require.NoError(t, err)

	raw, err := migrationFiles.ReadFile("114_analytics_metric_semantics.sql")
	require.NoError(t, err)
	require.NoError(t, runMigrations(db, fstest.MapFS{
		"114_analytics_metric_semantics.sql": {Data: raw},
	}))

	var accountSnapshot models.AnalyticsAccountSnapshot
	require.NoError(t, db.NewSelect().Model(&accountSnapshot).Where("id = ?", "account-snapshot").Scan(ctx))
	require.JSONEq(t, `{"followers":10}`, accountSnapshot.MetricsJSON)
	require.JSONEq(t, `{}`, accountSnapshot.MetricMetadataJSON)

	var renditionSnapshot models.AnalyticsRenditionSnapshot
	require.NoError(t, db.NewSelect().Model(&renditionSnapshot).Where("id = ?", "rendition-snapshot").Scan(ctx))
	require.JSONEq(t, `{"views":20}`, renditionSnapshot.MetricsJSON)
	require.JSONEq(t, `{}`, renditionSnapshot.MetricMetadataJSON)

	var state models.AnalyticsSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("id = ?", "rendition:rendition-1").Scan(ctx))
	require.JSONEq(t, `{"views":20}`, state.MetricsJSON)
	require.JSONEq(t, `{}`, state.MetricMetadataJSON)
}

func TestAnalyticsMetricSemanticsMigrationIsPostgresCompatible(t *testing.T) {
	raw, err := migrationFiles.ReadFile("114_analytics_metric_semantics.sql")
	require.NoError(t, err)
	normalized := normalizeMigrationSQL(dialect.PG, string(raw))
	require.Contains(t, normalized, "ALTER TABLE analytics_account_snapshots\n  ADD COLUMN IF NOT EXISTS metric_metadata_json TEXT NOT NULL DEFAULT '{}'")
	require.Contains(t, normalized, "ALTER TABLE analytics_rendition_snapshots\n  ADD COLUMN IF NOT EXISTS metric_metadata_json TEXT NOT NULL DEFAULT '{}'")
	require.Contains(t, normalized, "ALTER TABLE analytics_sync_states\n  ADD COLUMN IF NOT EXISTS metric_metadata_json TEXT NOT NULL DEFAULT '{}'")
}
