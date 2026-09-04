package lifecycle

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestRecordCommitsEventWebhookDeliveryAndJobTogether(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=private", strings.ReplaceAll(t.Name(), "/", "_")))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	for _, model := range []any{
		(*models.PublicationLifecycleEvent)(nil),
		(*models.ExternalAppInstallation)(nil),
		(*models.ExternalAppWorkspaceGrant)(nil),
		(*models.ExternalWebhookSubscription)(nil),
		(*models.ExternalWebhookDelivery)(nil),
	} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	now := time.Date(2026, time.September, 4, 10, 0, 0, 0, time.UTC)
	_, err = db.NewInsert().Model(&models.ExternalAppInstallation{ID: "installation-1", ApplicationID: "app-1", SponsorUserID: "user-1", Scopes: "events:subscribe", TokenFamilyID: "family-1", CreatedAt: now, UpdatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ExternalAppWorkspaceGrant{InstallationID: "installation-1", WorkspaceID: "workspace-1", CreatedAt: now, UpdatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ExternalWebhookSubscription{ID: "subscription-1", InstallationID: "installation-1", WorkspaceID: "workspace-1", URL: "https://example.test/hook", SecretHash: "hash", SecretEncrypted: []byte("ciphertext"), EventTypes: EventPublished, CreatedAt: now}).Exec(ctx)
	require.NoError(t, err)

	input := EventInput{WorkspaceID: "workspace-1", PublicationID: "publication-1", Type: EventPublished, CreatedAt: now}
	_, err = NewService(db).Record(ctx, input)
	require.Error(t, err)
	count, countErr := db.NewSelect().Model((*models.PublicationLifecycleEvent)(nil)).Count(ctx)
	require.NoError(t, countErr)
	require.Zero(t, count)

	_, err = db.NewCreateTable().Model((*models.Job)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	event, err := NewService(db).Record(ctx, input)
	require.NoError(t, err)
	require.Equal(t, now, event.CreatedAt)
	for _, model := range []any{
		(*models.PublicationLifecycleEvent)(nil),
		(*models.ExternalWebhookDelivery)(nil),
		(*models.Job)(nil),
	} {
		count, countErr = db.NewSelect().Model(model).Count(ctx)
		require.NoError(t, countErr)
		require.Equal(t, 1, count)
	}
}
