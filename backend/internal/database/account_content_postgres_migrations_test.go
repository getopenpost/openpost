package database

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestAccountContentMigrationsExecuteOnPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured; migrations 117, 119, 121, and 123 were not executed on PostgreSQL")
	}
	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))

	schema := fmt.Sprintf("account_content_migrations_%d", time.Now().UnixNano())
	_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})
	_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)
	require.NoError(t, CreateSchema(db))

	for _, id := range []int64{117, 119, 121, 123} {
		var count int
		require.NoError(t, db.NewRaw("SELECT COUNT(*) FROM schema_migrations WHERE version = ?", id).Scan(t.Context(), &count))
		require.Equal(t, 1, count, "migration %d must execute", id)
	}

	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	_, err = db.NewInsert().Model(&models.Organization{ID: "org-pg", Name: "Postgres", CreatedByID: "user-pg", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-pg", OrganizationID: "org-pg", Name: "Postgres", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	account := &models.SocialAccount{ID: "account-pg", WorkspaceID: "workspace-pg", Slug: "postgres", Platform: "telegram", AccountID: "-1001", AccountUsername: "channel", IsActive: true, CreatedAt: now}
	_, err = db.NewInsert().Model(account).Exec(t.Context())
	require.NoError(t, err)
	content := &models.AccountContent{ID: "content-pg", WorkspaceID: "workspace-pg", SocialAccountID: account.ID, Platform: "telegram", ProviderContentID: "42", ContentProfile: models.ContentProfileShortText, PublishedAt: now, Origin: "external", OriginConfidence: "exact", FirstDiscoveredAt: now, LastSeenAt: now, CreatedAt: now, UpdatedAt: now}
	_, err = db.NewInsert().Model(content).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.AccountContentDiscoveryState{ID: "state-pg", WorkspaceID: "workspace-pg", SocialAccountID: account.ID, Platform: "telegram", Status: "partial", CoverageStatus: "partial", InitialItemsDiscovered: 17, ReadBudgetWindowStart: now, ReadBudgetUsed: 3, CycleStartedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.AccountContentDiscoveryLease{Provider: "telegram", Slot: 0, OwnerJobID: "job-pg", LeaseExpiresAt: now.Add(time.Minute), UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.AnalyticsAccountContentSnapshot{ID: "snapshot-pg", WorkspaceID: "workspace-pg", AccountContentID: content.ID, SocialAccountID: account.ID, Platform: "telegram", MetricsJSON: `{"reactions":4}`, MetricMetadataJSON: `{}`, CaptureKey: "capture-pg", CapturedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.AccountContentObservation{ID: "observation-pg", WorkspaceID: "workspace-pg", SocialAccountID: account.ID, AccountContentID: content.ID, ProviderContentID: "42", ProviderObservationID: "update-42", ObservationType: "reaction_count", MetricsJSON: `{"reactions":4}`, MetricMetadataJSON: `{}`, ObservedAt: now, CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.XEngagementReadBudget{SocialAccountID: account.ID, WorkspaceID: "workspace-pg", WindowStart: now, AttemptsUsed: 2, CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.BotIngressEvent{ID: "event-pg", Provider: "telegram", ProviderEventID: "update-pg", Kind: "telegram.channel_post", WorkspaceID: "workspace-pg", SocialAccountID: account.ID, SubjectReference: "-1001", ParentReference: "42", ContentProfile: models.ContentProfileShortText, ContentText: "bounded", MetricsJSON: `{"reactions":4}`, OccurredAt: now, CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)

	var state models.AccountContentDiscoveryState
	require.NoError(t, db.NewSelect().Model(&state).Where("id = ?", "state-pg").Scan(t.Context()))
	require.Equal(t, 17, state.InitialItemsDiscovered)
	require.Equal(t, 3, state.ReadBudgetUsed)
	var lease models.AccountContentDiscoveryLease
	require.NoError(t, db.NewSelect().Model(&lease).Where("provider = ? AND slot = ?", "telegram", 0).Scan(t.Context()))
	require.Equal(t, "job-pg", lease.OwnerJobID)
	var event models.BotIngressEvent
	require.NoError(t, db.NewSelect().Model(&event).Where("id = ?", "event-pg").Scan(t.Context()))
	require.Equal(t, "bounded", event.ContentText)
	require.JSONEq(t, `{"reactions":4}`, event.MetricsJSON)

	_, err = db.NewDelete().Model(account).WherePK().Exec(t.Context())
	require.NoError(t, err)
	for _, model := range []any{(*models.AccountContent)(nil), (*models.AccountContentDiscoveryState)(nil), (*models.AnalyticsAccountContentSnapshot)(nil), (*models.AccountContentObservation)(nil), (*models.XEngagementReadBudget)(nil)} {
		count, countErr := db.NewSelect().Model(model).Count(t.Context())
		require.NoError(t, countErr)
		require.Zero(t, count)
	}
}
