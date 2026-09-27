package queue

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type renewJobBeforeRecoveryUpdate struct {
	db       *bun.DB
	jobID    string
	lockedAt time.Time
	renewed  bool
	err      error
}

func (hook *renewJobBeforeRecoveryUpdate) BeforeQuery(ctx context.Context, event *bun.QueryEvent) context.Context {
	if hook.renewed || event.Operation() != "UPDATE" || !strings.Contains(event.Query, "jobs") {
		return ctx
	}
	hook.renewed = true
	_, hook.err = hook.db.NewUpdate().Model((*models.Job)(nil)).
		Set("locked_at = ?", hook.lockedAt).
		Where("id = ?", hook.jobID).Exec(ctx)
	return ctx
}

func (*renewJobBeforeRecoveryUpdate) AfterQuery(context.Context, *bun.QueryEvent) {}

func TestWorkerRequeuesStaleProcessingJobs(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := context.Background()
	jobID := uuid.NewString()
	job := &models.Job{
		ID:          jobID,
		Type:        jobTypeMediaCleanup,
		Payload:     "{}",
		Status:      jobStatusProcessing,
		RunAt:       time.Now().UTC().Add(-time.Hour),
		Attempts:    1,
		MaxAttempts: 3,
		LockedAt:    time.Now().UTC().Add(-20 * time.Minute),
		LockedBy:    "dead-worker",
	}
	_, err := db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)

	worker := &BackgroundWorker{db: db, workerID: "worker-test"}
	worker.requeueStaleProcessingJobs(ctx)

	stored := new(models.Job)
	err = db.NewSelect().Model(stored).Where("id = ?", jobID).Scan(ctx)
	require.NoError(t, err)
	require.Equal(t, jobStatusPending, stored.Status)
	require.True(t, stored.LockedAt.IsZero())
	require.Empty(t, stored.LockedBy)
	require.Equal(t, 1, stored.Attempts)
}

func TestWorkerMarksStaleProviderWriteAmbiguousBeforeRequeue(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := t.Context()
	now := time.Now().UTC()
	job := &models.Job{
		ID: uuid.NewString(), Type: jobTypePublishPublication, Payload: "{}",
		Status: jobStatusProcessing, RunAt: now.Add(-time.Hour), MaxAttempts: 3,
		LockedAt: now.Add(-20 * time.Minute), LockedBy: "dead-worker",
	}
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(job).Exec(ctx)
		return err
	}())
	attempt := &models.ProviderWriteAttempt{
		ID: uuid.NewString(), OperationID: "operation-stale", AttemptNumber: 1,
		JobID: job.ID, WorkspaceID: "workspace-1", SocialAccountID: "account-1",
		TargetKey: "x", Provider: "x", Operation: "publish",
		PayloadFingerprint: "sha256:payload", Status: "sending", SubmissionState: "unknown",
		RetrySafety: "never", CreatedAt: now.Add(-20 * time.Minute), UpdatedAt: now.Add(-20 * time.Minute),
	}
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(attempt).Exec(ctx)
		return err
	}())

	worker := &BackgroundWorker{db: db, workerID: "worker-test"}
	requeuedPublicationJobIDs := worker.requeueStaleProcessingJobs(ctx)
	require.Equal(t, []string{job.ID}, requeuedPublicationJobIDs)

	require.NoError(t, db.NewSelect().Model(job).WherePK().Scan(ctx))
	require.Equal(t, jobStatusProcessing, job.Status, "publication work remains unclaimable until exact reconciliation commits")
	require.NoError(t, db.NewSelect().Model(attempt).WherePK().Scan(ctx))
	require.Equal(t, "ambiguous", attempt.Status)
	require.Equal(t, "unknown", attempt.SubmissionState)
	require.Equal(t, "worker_interrupted", attempt.SafeErrorClass)
}

func TestWorkerNeverRequeuesAmbiguousProviderWrites(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := t.Context()
	now := time.Now().UTC()
	job, err := jobregistry.NewJob(jobregistry.TypeMessageSend, `{"id":"message-1"}`, now.Add(-time.Hour))
	require.NoError(t, err)
	job.Status = jobStatusProcessing
	job.LockedAt = now.Add(-20 * time.Minute)
	job.LockedBy = "dead-worker"
	_, err = db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)

	worker := &BackgroundWorker{db: db, workerID: "worker-test"}
	worker.requeueStaleProcessingJobs(ctx)

	require.NoError(t, db.NewSelect().Model(job).WherePK().Scan(ctx))
	require.Equal(t, jobStatusFailed, job.Status)
	require.Contains(t, job.LastError, "did not retry")
}

func TestWorkerDoesNotFailJobRenewedDuringRecovery(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := t.Context()
	now := time.Now().UTC()
	job, err := jobregistry.NewJob(jobregistry.TypeMessageSend, `{"id":"message-1"}`, now.Add(-time.Hour))
	require.NoError(t, err)
	job.Status = jobStatusProcessing
	job.LockedAt = now.Add(-20 * time.Minute)
	job.LockedBy = "active-worker"
	_, err = db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)

	renewal := &renewJobBeforeRecoveryUpdate{db: db, jobID: job.ID, lockedAt: now}
	db.AddQueryHook(renewal)
	worker := &BackgroundWorker{db: db, workerID: "recovery-worker"}
	require.NoError(t, worker.failAmbiguousStaleJobs(ctx, now.Add(-15*time.Minute)))
	require.NoError(t, renewal.err)
	require.True(t, renewal.renewed, "the active worker renewed its lease before recovery changed status")
	require.NoError(t, db.NewSelect().Model(job).WherePK().Scan(ctx))
	require.Equal(t, jobStatusProcessing, job.Status)
	require.Equal(t, "active-worker", job.LockedBy)
	require.WithinDuration(t, now, job.LockedAt, time.Microsecond)
}
