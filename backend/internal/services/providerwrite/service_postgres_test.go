package providerwrite

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

// TestDeliveryProjectionPostgres guards the provider-delivery upsert against
// Bun's automatic target-table alias. Postgres rejects target columns that are
// left unqualified when EXCLUDED exposes columns with the same names.
func TestDeliveryProjectionPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}

	ctx := context.Background()
	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(ctx))

	schema := fmt.Sprintf("provider_delivery_%d", time.Now().UnixNano())
	_, err := db.ExecContext(ctx, `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})
	_, err = db.ExecContext(ctx, `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)

	for _, model := range []interface{}{(*models.ProviderWriteAttempt)(nil), (*models.ProviderDelivery)(nil)} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.NewCreateIndex().Model((*models.ProviderDelivery)(nil)).
		Index("provider_deliveries_rendition_target_test_idx").
		Unique().Column("rendition_id", "target_key").Exec(ctx)
	require.NoError(t, err)

	service := New(db)
	input := providerWriteTestInput(t, "postgres-delivery")
	input.PublicationID = "publication-1"
	input.RenditionID = "rendition-1"
	result, err := service.Execute(ctx, input, func(_ context.Context, control *Control) (platform.PublishResult, error) {
		require.NoError(t, control.Begin(platform.PublishResult{
			ProviderState: "create_post", RetrySafety: platform.PublishRetryNever,
		}))
		return platform.AcceptedPublishResult("external-1"), nil
	}, nil)
	require.NoError(t, err)
	require.Equal(t, "external-1", result.ExternalID)

	delivery := loadProviderDelivery(t, db, input.RenditionID)
	require.Equal(t, DeliveryLive, delivery.State)
	require.Equal(t, "external-1", delivery.ExternalID)
}
