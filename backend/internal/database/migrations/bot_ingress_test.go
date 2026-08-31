package migrations

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestBotIngressMigrationAddsNonceAndProviderEventUniqueness(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	require.NoError(t, runTestMigrations(t, db))
	require.NoError(t, runTestMigrations(t, db))
	seedMigrationUser(t.Context(), t, db)
	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "Bots"}).Exec(t.Context())
	require.NoError(t, err)
	now := time.Date(2026, time.August, 20, 12, 0, 0, 0, time.UTC)

	_, err = db.NewInsert().Model(&models.BotConnectionNonce{
		ID: "nonce-1", Provider: "telegram", WorkspaceID: "workspace-1",
		CreatedByUserID: "user-1", NonceHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		ExpiresAt: now.Add(15 * time.Minute), CreatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)

	event := &models.BotIngressEvent{
		ID: "event-1", Provider: "telegram", ProviderEventID: "provider-update-1",
		Kind: "connection.requested", ConnectionNonceID: "nonce-1",
		SubjectReference: "chat-1", OccurredAt: now, CreatedAt: now,
	}
	_, err = db.NewInsert().Model(event).Exec(t.Context())
	require.NoError(t, err)
	event.ID = "event-2"
	_, err = db.NewInsert().Model(event).Exec(t.Context())
	require.Error(t, err)
}
