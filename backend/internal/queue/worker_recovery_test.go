package queue

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
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
