package handlers

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

func TestListPublicationEventsPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}

	db := bun.NewDB(sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn))), pgdialect.New())
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	ctx := t.Context()
	schema := fmt.Sprintf("publication_history_%d", time.Now().UnixNano())
	_, err := db.ExecContext(ctx, `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, err)
	})
	_, err = db.ExecContext(ctx, `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)
	for _, model := range []any{
		(*models.User)(nil), (*models.Workspace)(nil), (*models.WorkspaceMember)(nil),
		(*models.Publication)(nil), (*models.Rendition)(nil),
		(*models.PublicationLifecycleEvent)(nil), (*models.PublicationAuthorization)(nil),
		(*models.DraftRevisionChange)(nil),
		(*models.ExternalWebhookSubscription)(nil), (*models.ProviderDelivery)(nil),
		(*models.SocialAccount)(nil),
	} {
		_, err = db.NewCreateTable().Model(model).Exec(ctx)
		require.NoError(t, err)
	}
	testPublicationEventsPaginatesSafeActorAttributedHistory(t, db)
}
