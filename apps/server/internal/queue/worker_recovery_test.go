package queue

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/publisher"
	"github.com/openpost/backend/internal/telemetry"
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

func TestHeartbeatCancelsJobWhenItsLeaseIsReclaimed(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	now := time.Now().UTC().Add(-time.Minute)
	job := models.Job{
		ID: "job-reclaimed", Type: jobregistry.TypeRefreshToken, Payload: `{}`,
		Status: jobStatusPending, RunAt: now, MaxAttempts: 3,
	}
	_, err := db.NewInsert().Model(&job).Exec(t.Context())
	require.NoError(t, err)

	worker := NewWorker(db, "worker-old", time.Hour, nil, nil, stubStorage{})
	worker.heartbeatInterval = 10 * time.Millisecond
	stopped := make(chan error, 1)
	worker.executors[jobregistry.ExecuteRefreshToken] = func(ctx context.Context, _ *models.Job) error {
		// Recovery hands the job to another worker while this one is busy.
		_, err := db.NewUpdate().Model((*models.Job)(nil)).
			Set("locked_by = ?", "worker-new").
			Set("lease_generation = lease_generation + 1").
			Where("id = ?", job.ID).Exec(context.WithoutCancel(ctx))
		require.NoError(t, err)
		select {
		case <-ctx.Done():
			stopped <- ctx.Err()
			return ctx.Err()
		case <-time.After(5 * time.Second):
			stopped <- nil
			return nil
		}
	}

	require.True(t, worker.processNextJobIfAvailable(t.Context()))
	require.ErrorIs(t, <-stopped, context.Canceled, "the old worker must stop once its lease is gone")
	require.NoError(t, db.NewSelect().Model(&job).WherePK().Scan(t.Context()))
	require.Equal(t, jobStatusProcessing, job.Status, "the new owner's lease is untouched")
	require.Equal(t, "worker-new", job.LockedBy)
}

type recordingPublishMarker struct{ marked []string }

func (marker *recordingPublishMarker) MarkTerminalPublishFailure(_ context.Context, _ bun.IDB, jobType, payload string) error {
	marker.marked = append(marker.marked, jobType+" "+payload)
	return nil
}

func TestTerminalPublishFailureEffectsRequireTheCurrentLease(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	now := time.Now().UTC()
	worker := NewWorker(db, "worker-terminal", time.Second, nil, nil, stubStorage{})
	marker := &recordingPublishMarker{}
	worker.terminalPublishMarker = marker
	recorder := &telemetry.MemoryRecorder{}
	worker.SetTelemetry(recorder)
	insert := func(id string, generation int64) *models.Job {
		job := &models.Job{
			ID: id, Type: jobregistry.TypePublishPublication, Payload: `{"publication_id":"publication-1"}`,
			Status: jobStatusProcessing, RunAt: now, MaxAttempts: 1, LockedAt: now,
			LockedBy: worker.workerID, LeaseGeneration: generation,
		}
		_, err := db.NewInsert().Model(job).Exec(t.Context())
		require.NoError(t, err)
		return job
	}

	stale := insert("terminal-stale-lease", 2)
	stale.LeaseGeneration = 1 // this worker's lease was reclaimed
	worker.finishFailedJob(t.Context(), stale, errors.New("provider exploded"))
	require.Empty(t, marker.marked, "a stale worker must not mark the publication")
	require.Empty(t, recorder.Exceptions, "a stale worker must not report the terminal failure")
	require.NoError(t, db.NewSelect().Model(stale).WherePK().Scan(t.Context()))
	require.Equal(t, jobStatusProcessing, stale.Status)

	owned := insert("terminal-owned-lease", 1)
	worker.finishFailedJob(t.Context(), owned, errors.New("provider exploded"))
	require.Equal(t, []string{jobregistry.TypePublishPublication + ` {"publication_id":"publication-1"}`}, marker.marked)
	require.Len(t, recorder.Exceptions, 1)
	require.NoError(t, db.NewSelect().Model(owned).WherePK().Scan(t.Context()))
	require.Equal(t, jobStatusFailed, owned.Status)
}

func TestUnrecoverableStalePublicationJobDoesNotHaltTheQueue(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	now := time.Now().UTC()
	jobs := []models.Job{{
		// A stale publication job whose payload names no aggregate.
		ID: "poison-publication", Type: jobregistry.TypePublishPublication, Payload: `{}`,
		Status: jobStatusProcessing, RunAt: now.Add(-time.Hour), MaxAttempts: 3,
		LockedAt: now.Add(-20 * time.Minute), LockedBy: "dead-worker",
	}, {
		ID: "unrelated", Type: jobregistry.TypeRefreshToken, Payload: `{}`,
		Status: jobStatusPending, RunAt: now.Add(-time.Minute), MaxAttempts: 3,
	}}
	_, err := db.NewInsert().Model(&jobs).Exec(t.Context())
	require.NoError(t, err)

	worker := NewWorker(db, "worker-poison", time.Hour, nil, nil, stubStorage{})
	worker.executors[jobregistry.ExecuteRefreshToken] = func(context.Context, *models.Job) error { return nil }
	worker.processDueJobs(t.Context())

	var poison, unrelated models.Job
	require.NoError(t, db.NewSelect().Model(&poison).Where("id = ?", "poison-publication").Scan(t.Context()))
	require.Equal(t, jobStatusFailed, poison.Status, "an unrecoverable job is quarantined, never replayed")
	require.Contains(t, poison.LastError, "did not retry")
	require.NoError(t, db.NewSelect().Model(&unrelated).Where("id = ?", "unrelated").Scan(t.Context()))
	require.Equal(t, jobStatusCompleted, unrelated.Status)
}

func TestLaneWorkerRecoversOnlyItsOwnStaleJobs(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	stale := time.Now().UTC().Add(-20 * time.Minute)
	jobs := []models.Job{
		{ID: "lane-stale", Type: jobregistry.TypeRefreshToken, Payload: `{}`, Status: jobStatusProcessing, RunAt: stale, MaxAttempts: 3, LockedAt: stale, LockedBy: "dead-lane-worker"},
		{ID: "other-stale", Type: jobTypeMediaCleanup, Payload: `{}`, Status: jobStatusProcessing, RunAt: stale, MaxAttempts: 3, LockedAt: stale, LockedBy: "dead-main-worker"},
	}
	_, err := db.NewInsert().Model(&jobs).Exec(t.Context())
	require.NoError(t, err)

	worker := &BackgroundWorker{db: db, workerID: "lane-worker"}
	worker.SetJobTypes(jobregistry.TypeRefreshToken)
	worker.requeueStaleProcessingJobs(t.Context())

	var lane, other models.Job
	require.NoError(t, db.NewSelect().Model(&lane).Where("id = ?", "lane-stale").Scan(t.Context()))
	require.Equal(t, jobStatusPending, lane.Status)
	require.NoError(t, db.NewSelect().Model(&other).Where("id = ?", "other-stale").Scan(t.Context()))
	require.Equal(t, jobStatusProcessing, other.Status, "another lane's stale job is left to its own worker")
}

func TestPublishRetryAlignmentRequiresTheCurrentLease(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	originalRetryAt := now.Add(time.Hour)
	seedTerminalJobPublication(t, db)
	_, err := db.NewInsert().Model(&models.Rendition{
		ID: "rendition-retry", PublicationID: "publication-terminal", SocialAccountID: "account-1",
		TargetKey: "x", Platform: "x", Profile: "post", Status: models.RenditionStatusFailed,
		ErrorRetryable: true, ErrorRetryAt: originalRetryAt, SettingsJSON: "{}", CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	worker := NewWorker(db, "worker-retry", time.Second, publisher.NewService(db, nil), nil, stubStorage{})
	job := &models.Job{
		ID: "retry-stale-lease", Type: jobregistry.TypePublishPublication, ScopeID: "publication-terminal",
		Payload: `{"publication_id":"publication-terminal"}`, Status: jobStatusProcessing, RunAt: now,
		MaxAttempts: 5, LockedAt: now, LockedBy: worker.workerID, LeaseGeneration: 2,
	}
	_, err = db.NewInsert().Model(job).Exec(t.Context())
	require.NoError(t, err)
	retryable := &publisher.RetryableError{Failure: publisher.Failure{Retryable: true, RetryAfter: time.Minute, Message: "Try again"}}
	retryAt := func() time.Time {
		var rendition models.Rendition
		require.NoError(t, db.NewSelect().Model(&rendition).Where("id = ?", "rendition-retry").Scan(t.Context()))
		return rendition.ErrorRetryAt
	}

	job.LeaseGeneration = 1 // this worker's lease was reclaimed
	worker.finishFailedJob(t.Context(), job, retryable)
	require.WithinDuration(t, originalRetryAt, retryAt(), time.Second, "a stale worker must not move the visible retry time")

	job.LeaseGeneration = 2
	worker.finishFailedJob(t.Context(), job, retryable)
	require.NoError(t, db.NewSelect().Model(job).WherePK().Scan(t.Context()))
	require.Equal(t, jobStatusPending, job.Status)
	require.WithinDuration(t, job.RunAt, retryAt(), time.Second, "the owner aligns the visible retry with the job")
}
