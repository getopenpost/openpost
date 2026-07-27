package queue

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	analyticsservice "github.com/openpost/backend/internal/services/analytics"
	"github.com/stretchr/testify/require"
)

func TestWorkerRequeuesStaleProcessingJobs(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := context.Background()
	jobID := uuid.NewString()
	job := &models.Job{
		ID:          jobID,
		Type:        jobTypePublishPost,
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

func TestWorkerKeepsRecentProcessingJobsLocked(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := context.Background()
	jobID := uuid.NewString()
	lockedAt := time.Now().UTC().Add(-5 * time.Minute)
	job := &models.Job{
		ID:          jobID,
		Type:        jobTypePublishPost,
		Payload:     "{}",
		Status:      jobStatusProcessing,
		RunAt:       time.Now().UTC().Add(-time.Hour),
		Attempts:    0,
		MaxAttempts: 3,
		LockedAt:    lockedAt,
		LockedBy:    "active-worker",
	}
	_, err := db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)

	worker := &BackgroundWorker{db: db, workerID: "worker-test"}
	worker.requeueStaleProcessingJobs(ctx)

	stored := new(models.Job)
	err = db.NewSelect().Model(stored).Where("id = ?", jobID).Scan(ctx)
	require.NoError(t, err)
	require.Equal(t, jobStatusProcessing, stored.Status)
	require.False(t, stored.LockedAt.IsZero())
	require.Equal(t, "active-worker", stored.LockedBy)
}

func TestWorkerSupersedesStaleAnalyticsSweepWhenSuccessorIsPending(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := context.Background()
	_, err := db.NewCreateIndex().
		Index("analytics_sweep_pending_unique_idx").
		Table("jobs").
		Column("type").
		Unique().
		Where("status = 'pending' AND type = 'analytics_sweep'").
		Exec(ctx)
	require.NoError(t, err)

	staleID := uuid.NewString()
	for _, job := range []*models.Job{
		{
			ID:          staleID,
			Type:        analyticsservice.JobTypeSweep,
			Payload:     `{"scheduled_for":"2026-07-26T10:00:00Z"}`,
			Status:      jobStatusProcessing,
			RunAt:       time.Now().UTC().Add(-time.Hour),
			MaxAttempts: 3,
			LockedAt:    time.Now().UTC().Add(-20 * time.Minute),
			LockedBy:    "dead-worker",
		},
		{
			ID:          uuid.NewString(),
			Type:        analyticsservice.JobTypeSweep,
			Payload:     `{"scheduled_for":"2026-07-26T10:15:00Z"}`,
			Status:      jobStatusPending,
			RunAt:       time.Now().UTC().Add(time.Minute),
			MaxAttempts: 3,
		},
	} {
		_, err = db.NewInsert().Model(job).Exec(ctx)
		require.NoError(t, err)
	}

	worker := &BackgroundWorker{db: db, workerID: "worker-test"}
	worker.requeueStaleProcessingJobs(ctx)

	stale := new(models.Job)
	require.NoError(t, db.NewSelect().Model(stale).Where("id = ?", staleID).Scan(ctx))
	require.Equal(t, jobStatusCompleted, stale.Status)
	require.Contains(t, stale.LastError, "later analytics sweep")

	pending, err := db.NewSelect().
		Model((*models.Job)(nil)).
		Where("type = ? AND status = ?", analyticsservice.JobTypeSweep, jobStatusPending).
		Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, pending)
}
