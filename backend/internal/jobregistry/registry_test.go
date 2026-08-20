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
		TypeAnalyticsRendition, TypeBillingWebhook, TypeEngagementSweep, TypeEngagementSync,
		TypeMessagingSweep, TypeMessagesSync, TypeEngagementAction, TypeMessageSend, TypeNotificationEmail,
		TypeOwnershipTransferExpiry,
		TypeRepostSweep, TypeRepostEvaluate, TypeRepostExecute, TypeMediaAnalyze,
		TypeGrowthDiscovery, TypeGrowthFollow,
	}
	definitions := Definitions()
	actual := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		actual = append(actual, definition.Type)
		require.NotEmpty(t, definition.Execution, definition.Type)
		require.NotEmpty(t, definition.Failure, definition.Type)
		require.NotEmpty(t, definition.Recovery, definition.Type)
		require.Positive(t, definition.DefaultMaxAttempts, definition.Type)
	}
	require.ElementsMatch(t, expected, actual)
}

func TestNewJobUsesRegisteredDurablePolicy(t *testing.T) {
	t.Parallel()

	runAt := time.Date(2026, time.August, 11, 12, 0, 0, 0, time.UTC)
	job, err := NewJob(TypeMessageSend, `{"message_id":"message-1"}`, runAt)
	require.NoError(t, err)
	require.Equal(t, TypeMessageSend, job.Type)
	require.Equal(t, StatusPending, job.Status)
	require.Equal(t, 1, job.MaxAttempts)
	require.Equal(t, runAt, job.RunAt)

	_, err = NewJob("unknown", `{}`, runAt)
	require.ErrorContains(t, err, "not registered")
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
