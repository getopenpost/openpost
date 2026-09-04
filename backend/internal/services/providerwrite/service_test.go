package providerwrite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestAcceptedCheckpointPreventsReplayAfterLocalFailure(t *testing.T) {
	db := newProviderWriteTestDB(t)
	service := New(db)
	input := providerWriteTestInput(t, "accepted-once")
	var calls atomic.Int32

	result, err := service.Execute(t.Context(), input, func(_ context.Context, control *Control) (platform.PublishResult, error) {
		calls.Add(1)
		require.NoError(t, control.Begin(platform.PublishResult{ProviderState: "create_post", RetrySafety: platform.PublishRetryNever}))
		accepted := platform.AcceptedPublishResult("external-1")
		require.NoError(t, control.Checkpoint(accepted))
		return accepted, fmt.Errorf("local status update failed after provider acceptance")
	}, nil)
	require.NoError(t, err)
	require.Equal(t, "external-1", result.ExternalID)

	result, err = service.Execute(t.Context(), input, func(context.Context, *Control) (platform.PublishResult, error) {
		calls.Add(1)
		return platform.PublishResult{}, nil
	}, nil)
	require.NoError(t, err)
	require.Equal(t, "external-1", result.ExternalID)
	require.Equal(t, int32(1), calls.Load(), "an accepted external write must never be replayed")
}

func TestAmbiguousWriteIsTerminalWithoutReconciliation(t *testing.T) {
	db := newProviderWriteTestDB(t)
	service := New(db)
	input := providerWriteTestInput(t, "ambiguous")
	var calls atomic.Int32
	send := func(_ context.Context, control *Control) (platform.PublishResult, error) {
		calls.Add(1)
		require.NoError(t, control.Begin(platform.PublishResult{ProviderState: "create_post", RetrySafety: platform.PublishRetryNever}))
		return platform.PublishResult{}, context.DeadlineExceeded
	}

	_, err := service.Execute(t.Context(), input, send, nil)
	require.Error(t, err)
	require.True(t, IsAmbiguous(err))
	_, err = service.Execute(t.Context(), input, send, nil)
	require.Error(t, err)
	require.True(t, IsAmbiguous(err))
	require.Equal(t, int32(1), calls.Load())

	attempt := latestProviderWriteAttempt(t, db, input.OperationID)
	require.Equal(t, StatusAmbiguous, attempt.Status)
	require.Equal(t, string(platform.PublishRetryNever), attempt.RetrySafety)
	require.Empty(t, attempt.SafeErrorCode)
}

func TestOperationFingerprintCannotChangeAfterAnAttemptExists(t *testing.T) {
	db := newProviderWriteTestDB(t)
	service := New(db)
	input := providerWriteTestInput(t, "immutable-fingerprint")
	_, err := service.Execute(t.Context(), input, func(_ context.Context, control *Control) (platform.PublishResult, error) {
		require.NoError(t, control.Begin(platform.PublishResult{ProviderState: "create_post", RetrySafety: platform.PublishRetryNever}))
		return platform.AcceptedPublishResult("external-1"), nil
	}, nil)
	require.NoError(t, err)

	changed := input
	changed.PayloadFingerprint = "sha256:changed"
	_, err = service.Execute(t.Context(), changed, func(context.Context, *Control) (platform.PublishResult, error) {
		t.Fatal("a changed operation must not reach the provider")
		return platform.PublishResult{}, nil
	}, nil)
	require.ErrorIs(t, err, ErrOperationChanged)
}

func TestConcurrentExecutionEntersTheFenceOnce(t *testing.T) {
	db := newProviderWriteTestDB(t)
	service := New(db)
	input := providerWriteTestInput(t, "concurrent")
	started := make(chan struct{})
	release := make(chan struct{})
	firstDone := make(chan error, 1)
	var calls atomic.Int32

	go func() {
		_, err := service.Execute(context.Background(), input, func(_ context.Context, control *Control) (platform.PublishResult, error) {
			calls.Add(1)
			if err := control.Begin(platform.PublishResult{ProviderState: "create_post", RetrySafety: platform.PublishRetryNever}); err != nil {
				return platform.PublishResult{}, err
			}
			close(started)
			<-release
			return platform.AcceptedPublishResult("external-1"), nil
		}, nil)
		firstDone <- err
	}()
	<-started

	_, err := service.Execute(t.Context(), input, func(context.Context, *Control) (platform.PublishResult, error) {
		calls.Add(1)
		return platform.PublishResult{}, nil
	}, nil)
	require.Error(t, err)
	require.True(t, IsAmbiguous(err))
	close(release)
	require.NoError(t, <-firstDone)
	require.Equal(t, int32(1), calls.Load())
}

func TestStaleWorkerAttemptBecomesAmbiguousBeforeJobRecovery(t *testing.T) {
	db := newProviderWriteTestDB(t)
	service := New(db)
	now := time.Now().UTC()
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(&models.Job{
			ID: "job-stale", Type: "publish_publication", Status: "processing",
			Payload: `{}`, LockedAt: now.Add(-20 * time.Minute), RunAt: now,
		}).Exec(t.Context())
		return err
	}())
	input := providerWriteTestInput(t, "stale")
	input.JobID = "job-stale"
	attempt, err := service.loadOrCreateAttempt(t.Context(), input)
	require.NoError(t, err)
	require.NoError(t, (&Control{service: service, attempt: attempt, ctx: t.Context()}).Begin(
		platform.PublishResult{ProviderState: "create_post", RetrySafety: platform.PublishRetryNever},
	))

	count, err := service.MarkStaleJobAttempts(t.Context(), now.Add(-15*time.Minute))
	require.NoError(t, err)
	require.Equal(t, int64(1), count)
	stored := latestProviderWriteAttempt(t, db, input.OperationID)
	require.Equal(t, StatusAmbiguous, stored.Status)
	require.Equal(t, "worker_interrupted", stored.SafeErrorClass)
}

func nilSafeSend(context.Context, *Control) (platform.PublishResult, error) {
	return platform.PublishResult{}, errors.New("send must not be called during reconciliation")
}

func newProviderWriteTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqlDB, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_busy_timeout=5000", uuid.NewString()))
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(8)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	for _, model := range []interface{}{(*models.ProviderWriteAttempt)(nil), (*models.Job)(nil)} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func newProviderDeliveryTestDB(t *testing.T) *bun.DB {
	t.Helper()
	db := newProviderWriteTestDB(t)
	_, err := db.NewCreateTable().Model((*models.ProviderDelivery)(nil)).IfNotExists().Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewCreateIndex().Model((*models.ProviderDelivery)(nil)).
		Index("provider_deliveries_rendition_target_test_idx").
		Unique().Column("rendition_id", "target_key").Exec(t.Context())
	require.NoError(t, err)
	return db
}

func loadProviderDelivery(t *testing.T, db *bun.DB, renditionID string) models.ProviderDelivery {
	t.Helper()
	var delivery models.ProviderDelivery
	require.NoError(t, db.NewSelect().Model(&delivery).Where("rendition_id = ?", renditionID).Scan(t.Context()))
	return delivery
}

func providerWriteTestInput(t *testing.T, operationID string) Input {
	t.Helper()
	fingerprint, err := Fingerprint("test", map[string]string{"content": "never persisted"})
	require.NoError(t, err)
	return Input{
		OperationID: operationID, WorkspaceID: "workspace-1",
		SocialAccountID: "account-1", TargetKey: "x", Provider: "x",
		Operation: "publish", PayloadFingerprint: fingerprint,
	}
}

func latestProviderWriteAttempt(t *testing.T, db *bun.DB, operationID string) models.ProviderWriteAttempt {
	t.Helper()
	var attempt models.ProviderWriteAttempt
	require.NoError(t, db.NewSelect().Model(&attempt).
		Where("operation_id = ?", operationID).
		Order("attempt_number DESC").Limit(1).Scan(t.Context()))
	return attempt
}
