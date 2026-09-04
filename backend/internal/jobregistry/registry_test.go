package jobregistry

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestDefinitionsCoverEveryExecutableJobKind(t *testing.T) {
	t.Parallel()

	expected := []string{
		TypePublishPublication, TypeRefreshToken, TypeMediaCleanup,
		TypeStorageDelete, TypeFeedbackDelivery, TypeAnalyticsSweep, TypeAnalyticsAccount,
		TypeAnalyticsRendition, TypeAccountContentDiscovery, TypeBillingWebhook, TypeEngagementSweep, TypeEngagementSync,
		TypeMessagingSweep, TypeMessagesSync, TypeEngagementAction, TypeMessageSend, TypeNotificationEmail,
		TypeQueueReminderSweep,
		TypeOwnershipTransferExpiry,
		TypeRepostSweep, TypeRepostEvaluate, TypeRepostExecute, TypeMediaAnalyze,
		TypeGrowthDiscovery, TypeGrowthFollow, TypePublicationBuild, TypeBotIngress,
		TypeScheduledAccountCheck,
		TypeExternalWebhookDelivery,
	}
	definitions := Definitions()
	actual := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		actual = append(actual, definition.Type)
		require.NotEmpty(t, definition.Execution, definition.Type)
		require.NotEmpty(t, definition.Failure, definition.Type)
		require.NotEmpty(t, definition.Recovery, definition.Type)
		require.Positive(t, definition.DefaultMaxAttempts, definition.Type)
		if definition.Failure == FailureProviderRead {
			require.NotEmpty(t, definition.FailureMessage, definition.Type)
		}
	}
	require.ElementsMatch(t, expected, actual)
}

func TestAccountContentDiscoveryPayloadContainsOnlyOwnerReferences(t *testing.T) {
	t.Parallel()

	payload, err := EncodeAccountContentDiscoveryPayload(AccountContentDiscoveryPayload{
		WorkspaceID: "workspace-1", SocialAccountID: "account-1",
	})
	require.NoError(t, err)
	require.JSONEq(t, `{"workspace_id":"workspace-1","social_account_id":"account-1"}`, payload)
	identity, err := IdentityForPayload(TypeAccountContentDiscovery, payload)
	require.NoError(t, err)
	require.Equal(t, Identity{ScopeID: "account-1", DedupeKey: "discover"}, identity)

	_, err = DecodeAccountContentDiscoveryPayload(`{"workspace_id":"workspace-1","social_account_id":"account-1","cursor":"secret-provider-cursor"}`)
	require.Error(t, err)
}

func TestBotIngressPayloadIsBoundedToAnEventReference(t *testing.T) {
	t.Parallel()

	payload, err := EncodeBotIngressPayload(BotIngressPayload{EventID: "event-1"})
	require.NoError(t, err)
	require.JSONEq(t, `{"event_id":"event-1"}`, payload)

	decoded, err := DecodeBotIngressPayload(payload)
	require.NoError(t, err)
	require.Equal(t, "event-1", decoded.EventID)
	_, err = DecodeBotIngressPayload(`{"event_id":"event-1","raw_payload":{"secret":"private"}}`)
	require.Error(t, err)
}

func TestMediaCleanupPayloadRetiresClientSuppliedDays(t *testing.T) {
	t.Parallel()

	legacy, err := DecodeMediaCleanupPayload(`{"workspace_id":"workspace-1","days":365}`)
	require.NoError(t, err)
	require.Equal(t, "workspace-1", legacy.WorkspaceID)

	payload, err := json.Marshal(MediaCleanupPayload{WorkspaceID: "workspace-1"})
	require.NoError(t, err)
	require.JSONEq(t, `{"workspace_id":"workspace-1"}`, string(payload))
	require.NotContains(t, string(payload), "days")
}

func TestEnqueueMediaCleanupIsIdempotentOnlyWhileTheChainIsActive(t *testing.T) {
	t.Parallel()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	for _, model := range []any{(*models.Organization)(nil), (*models.Workspace)(nil), (*models.Job)(nil)} {
		_, err = db.NewCreateTable().Model(model).Exec(context.Background())
		require.NoError(t, err)
	}
	now := time.Now().UTC()
	_, err = db.NewInsert().Model(&models.Organization{ID: "organization-1", Name: "Media", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", OrganizationID: "organization-1", Name: "Media", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, EnsureActiveDedupeIndex(context.Background(), db))

	runAt := time.Now().UTC().Add(time.Hour)
	firstID, created, err := EnqueueMediaCleanup(t.Context(), db, "workspace-1", runAt)
	require.NoError(t, err)
	require.True(t, created)
	secondID, created, err := EnqueueMediaCleanup(t.Context(), db, "workspace-1", runAt.Add(time.Hour))
	require.NoError(t, err)
	require.False(t, created)
	require.Equal(t, firstID, secondID)

	_, err = db.NewUpdate().Model((*models.Job)(nil)).
		Set("status = ?", StatusCompleted).
		Where("id = ?", firstID).
		Exec(t.Context())
	require.NoError(t, err)
	thirdID, created, err := EnqueueMediaCleanup(t.Context(), db, "workspace-1", runAt.Add(2*time.Hour))
	require.NoError(t, err)
	require.True(t, created)
	require.NotEqual(t, firstID, thirdID)

	var newest models.Job
	require.NoError(t, db.NewSelect().Model(&newest).Where("id = ?", thirdID).Scan(t.Context()))
	require.JSONEq(t, `{"workspace_id":"workspace-1"}`, newest.Payload)
}

func TestEnqueueQueueReminderSweepCreatesOneActiveRecurringChain(t *testing.T) {
	t.Parallel()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.NewCreateTable().Model((*models.Job)(nil)).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, EnsureActiveDedupeIndex(t.Context(), db))

	runAt := time.Date(2026, 9, 5, 9, 0, 0, 0, time.UTC)
	firstID, created, err := EnqueueQueueReminderSweep(t.Context(), db, runAt)
	require.NoError(t, err)
	require.True(t, created)
	secondID, created, err := EnqueueQueueReminderSweep(t.Context(), db, runAt.Add(time.Hour))
	require.NoError(t, err)
	require.False(t, created)
	require.Equal(t, firstID, secondID)
}
