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

	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "user-1", Title: "Launch",
		SourceContent: "Launch", Status: models.PublicationStatusPublishing, CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: account.ID,
		TargetKey: "telegram", Platform: "telegram", Profile: models.ContentProfileImagePost,
		Status: models.RenditionStatusPublishing, CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	receipt := &models.TelegramPublishReceipt{
		ID: "receipt-1", OperationID: "authorization:one:rendition-1:publish", RenditionID: "rendition-1",
		RequestIndex: 0, MessageIndex: 0, RequestKind: "media_group", Status: "accepted", MessageID: "12345",
		SendingStarted: now.Add(-time.Second), AcceptedAt: now, CreatedAt: now, UpdatedAt: now,
	}
	_, err = db.NewInsert().Model(receipt).Exec(t.Context())
	require.NoError(t, err)
	receipt.ID = "receipt-duplicate-position"
	_, err = db.NewInsert().Model(receipt).Exec(t.Context())
	require.Error(t, err, "one ordered receipt position is durable for an operation")

	_, err = db.NewDelete().Model((*models.Rendition)(nil)).Where("id = ?", "rendition-1").Exec(t.Context())
	require.NoError(t, err)
	count, err := db.NewSelect().Model((*models.TelegramPublishReceipt)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count, "Telegram receipts follow their owning Rendition")
}
