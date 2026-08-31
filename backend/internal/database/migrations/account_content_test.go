package migrations

import (
	"context"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun/dialect"
)

func TestAccountContentMigrationEnforcesBoundsUniquenessAndAccountCascade(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	_, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS renditions (id TEXT PRIMARY KEY);
		INSERT INTO workspaces (id, name) VALUES ('ws-1', 'Workspace');
		INSERT INTO social_accounts (
			id, workspace_id, slug, platform, account_id, access_token_encrypted, is_active
		) VALUES ('account-1', 'ws-1', 'youtube', 'youtube', 'channel-1', x'00', true);
	`)
	require.NoError(t, err)
	raw, err := migrationFiles.ReadFile("117_account_content.sql")
	require.NoError(t, err)
	budgetRaw, err := migrationFiles.ReadFile("119_account_content_discovery_budget.sql")
	require.NoError(t, err)
	require.NoError(t, runMigrations(db, fstest.MapFS{
		"117_account_content.sql":                  {Data: raw},
		"119_account_content_discovery_budget.sql": {Data: budgetRaw},
	}))
	now := time.Date(2026, time.September, 2, 12, 0, 0, 0, time.UTC)

	content := &models.AccountContent{
		ID: "content-1", WorkspaceID: "ws-1", SocialAccountID: "account-1", Platform: "youtube",
		ProviderContentID: "video-1", ContentProfile: models.ContentProfileLongVideo,
		Text: "Launch", ExternalURL: "https://www.youtube.com/watch?v=video-1",
		PublishedAt: now, Origin: "external", OriginConfidence: "exact",
		FirstDiscoveredAt: now, LastSeenAt: now,
	}
	_, err = db.NewInsert().Model(content).Exec(ctx)
	require.NoError(t, err)

	duplicate := *content
	duplicate.ID = "content-duplicate"
	_, err = db.NewInsert().Model(&duplicate).Exec(ctx)
	require.Error(t, err, "provider identity must be unique within an account")

	unsafe := *content
	unsafe.ID, unsafe.ProviderContentID, unsafe.ExternalURL = "content-unsafe", "video-unsafe", "javascript:alert(1)"
	_, err = db.NewInsert().Model(&unsafe).Exec(ctx)
	require.Error(t, err, "unsafe provider URL must be rejected")

	oversized := *content
	oversized.ID, oversized.ProviderContentID, oversized.Text = "content-oversized", "video-oversized", strings.Repeat("x", 10_001)
	_, err = db.NewInsert().Model(&oversized).Exec(ctx)
	require.Error(t, err, "content text must be bounded to 10,000 characters")

	_, err = db.NewInsert().Model(&models.AnalyticsAccountContentSnapshot{
		ID: "snapshot-1", WorkspaceID: "ws-1", AccountContentID: content.ID,
		SocialAccountID: "account-1", Platform: "youtube", MetricsJSON: `{"views":10}`,
		MetricMetadataJSON: `{}`, CapturedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.AccountContentDiscoveryState{
		ID: "discovery-1", WorkspaceID: "ws-1", SocialAccountID: "account-1", Platform: "youtube",
		Status: "partial", CoverageStatus: "partial", CoverageDescription: "Last 90 days",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.AccountContentObservation{
		ID: "observation-1", WorkspaceID: "ws-1", SocialAccountID: "account-1",
		AccountContentID: content.ID, Platform: "youtube", ProviderObservationID: "event-1",
		ProviderContentID: "video-1", ObservationType: "metrics.changed",
		MetricsJSON: `{"likes":2}`, MetricMetadataJSON: `{}`, ObservedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)

	_, err = db.NewDelete().Model((*models.SocialAccount)(nil)).Where("id = ?", "account-1").Exec(ctx)
	require.NoError(t, err)
	for _, model := range []any{
		(*models.AccountContent)(nil),
		(*models.AnalyticsAccountContentSnapshot)(nil),
		(*models.AccountContentDiscoveryState)(nil),
		(*models.AccountContentObservation)(nil),
	} {
		count, countErr := db.NewSelect().Model(model).Count(ctx)
		require.NoError(t, countErr)
		require.Zero(t, count)
	}
}

func TestAccountContentMigrationIsPostgresCompatible(t *testing.T) {
	raw, err := migrationFiles.ReadFile("117_account_content.sql")
	require.NoError(t, err)
	normalized := normalizeMigrationSQL(dialect.PG, string(raw))
	require.Contains(t, normalized, "CREATE TABLE IF NOT EXISTS account_contents")
	require.Contains(t, normalized, "CREATE TABLE IF NOT EXISTS analytics_account_content_snapshots")
	require.Contains(t, normalized, "CREATE TABLE IF NOT EXISTS account_content_discovery_states")
	require.Contains(t, normalized, "CREATE TABLE IF NOT EXISTS account_content_observations")
	require.NotContains(t, normalized, " BLOB")
	require.NotContains(t, normalized, " DATETIME")
}
