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
		ExpectedSubjectReference: "-1001", ExpiresAt: now.Add(15 * time.Minute), CreatedAt: now,
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

	_, err = db.NewInsert().Model(&models.TelegramChatInstallation{
		ChatID: "-1001", ChatType: "channel", MembershipStatus: "administrator",
		InstalledAt: now.Add(-time.Hour), UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)

	account := &models.SocialAccount{
		ID: "telegram-1", WorkspaceID: "workspace-1", Slug: "telegram-launches",
		Platform: "telegram", AccountID: "-1001", AccessTokenEnc: []byte{}, IsActive: true, CreatedAt: now,
	}
	_, err = db.NewInsert().Model(account).Exec(t.Context())
	require.NoError(t, err)
	connection := &models.TelegramConnection{
		SocialAccountID: account.ID, WorkspaceID: account.WorkspaceID, ChatID: account.AccountID,
		ChatType: "channel", InstalledAt: now, CoverageStartedAt: now,
		CoverageKind: "since_installation", PermissionsVerifiedAt: now, CreatedAt: now,
	}
	_, err = db.NewInsert().Model(connection).Exec(t.Context())
	require.NoError(t, err)
	secondAccount := *account
	secondAccount.ID = "telegram-2"
	secondAccount.AccountID = "-2002"
	secondAccount.Slug = "telegram-founders"
	_, err = db.NewInsert().Model(&secondAccount).Exec(t.Context())
	require.NoError(t, err)
	connection.SocialAccountID = secondAccount.ID
	_, err = db.NewInsert().Model(connection).Exec(t.Context())
	require.Error(t, err, "one Telegram chat cannot be connected to another workspace account")
}
