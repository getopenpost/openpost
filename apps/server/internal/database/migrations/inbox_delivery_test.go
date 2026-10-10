package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestInboxDeliveryUpgradePreservesExistingReceipt(t *testing.T) {
	exerciseInboxDeliveryUpgrade(t, newMigrationsTestDB(t))
}

func exerciseInboxDeliveryUpgrade(t *testing.T, db *bun.DB) {
	previous := fstest.MapFS{}
	entries, err := migrationFiles.ReadDir(".")
	require.NoError(t, err)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		version, err := parseVersion(entry.Name())
		require.NoError(t, err)
		if version >= 153 {
			continue
		}
		contents, err := migrationFiles.ReadFile(entry.Name())
		require.NoError(t, err)
		previous[entry.Name()] = &fstest.MapFile{Data: contents}
	}
	require.NoError(t, runMigrations(db, previous))
	ctx := t.Context()
	seedMigrationUser(ctx, t, db)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-inbox", Name: "Inbox"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{ID: "account-inbox", WorkspaceID: "ws-inbox", Platform: "tiktok", AccountID: "provider-account", Slug: "inbox", AccessTokenEnc: []byte("token"), IsActive: true}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{ID: "pub-inbox", WorkspaceID: "ws-inbox", CreatedByID: "user-1", Status: models.PublicationStatusScheduled}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{ID: "rend-inbox", PublicationID: "pub-inbox", SocialAccountID: "account-inbox", Platform: "tiktok", TargetKey: "rendition", Status: models.RenditionStatusScheduled}).Exec(ctx)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Second)
	_, err = db.NewInsert().Model(&models.PublicationAuthorization{ID: "auth-inbox", BatchID: "batch", WorkspaceID: "ws-inbox", PublicationID: "pub-inbox", RenditionID: "rend-inbox", SocialAccountID: "account-inbox", TargetKey: "rendition", Action: "publish", ActorOrigin: "legacy", ActorUserID: "user-1", PublicationRevision: 1, ContentHash: "sha256:content", MediaHash: "sha256:media", SettingsHash: "sha256:settings", PolicyMode: "immediate", ConfirmedAt: now, ScheduledAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ProviderWriteAttempt{ID: "attempt-inbox", AuthorizationID: "auth-inbox", OperationID: "operation-inbox", AttemptNumber: 1, WorkspaceID: "ws-inbox", PublicationID: "pub-inbox", RenditionID: "rend-inbox", SocialAccountID: "account-inbox", TargetKey: "rendition", Provider: "tiktok", Operation: "publish", PayloadFingerprint: "sha256:content", Status: "sending", SubmissionState: "pending", ProviderReference: "inbox-receipt", RetrySafety: "reconcile_only"}).Exec(ctx)
	require.NoError(t, err)
	original := models.ProviderDelivery{ID: "delivery-inbox", WorkspaceID: "ws-inbox", PublicationID: "pub-inbox", RenditionID: "rend-inbox", SocialAccountID: "account-inbox", TargetKey: "rendition", Provider: "tiktok", State: "processing", RetrySafety: "reconcile_only", SafeErrorClass: "provider", SafeErrorCode: "pending", ErrorHTTPStatus: 503, CurrentAttemptID: "attempt-inbox", CurrentAttemptNumber: 1, CurrentAttemptCreatedAt: now, NextReconciliationAt: now.Add(time.Minute), CreatedAt: now, UpdatedAt: now}
	_, err = db.NewInsert().Model(&original).Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, RunMigrations(db))
	require.NoError(t, RunMigrations(db))
	var preserved models.ProviderDelivery
	require.NoError(t, db.NewSelect().Model(&preserved).Where("id = ?", original.ID).Scan(ctx))
	preserved.CurrentAttemptCreatedAt = preserved.CurrentAttemptCreatedAt.UTC()
	preserved.NextReconciliationAt = preserved.NextReconciliationAt.UTC()
	preserved.CreatedAt = preserved.CreatedAt.UTC()
	preserved.UpdatedAt = preserved.UpdatedAt.UTC()
	require.Equal(t, original, preserved)
	_, err = db.NewUpdate().Model((*models.ProviderDelivery)(nil)).Set("state = ?", "awaiting_user").Where("id = ?", original.ID).Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, db.NewSelect().Model(&preserved).Where("id = ?", original.ID).Scan(ctx))
	require.Equal(t, "awaiting_user", preserved.State)
	_, err = db.NewUpdate().Model((*models.ProviderDelivery)(nil)).Set("state = ?", "invalid").Where("id = ?", original.ID).Exec(ctx)
	require.Error(t, err)
}

func TestInboxDeliveryUpgradePreservesExistingReceiptPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))
	schema := fmt.Sprintf("inbox_upgrade_%d", time.Now().UnixNano())
	_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, err)
	})
	_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)
	createMigrationBaseTables(t, db)
	exerciseInboxDeliveryUpgrade(t, db)
}
