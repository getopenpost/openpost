package queue

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/crypto"
	repostservice "github.com/openpost/backend/internal/services/reposts"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type stubStorage struct{}

func (stubStorage) Driver() string { return "test" }
func (stubStorage) Save(context.Context, string, io.Reader) (string, error) {
	return "", nil
}
func (stubStorage) Delete(context.Context, string) error { return nil }
func (stubStorage) GetURL(string) string                 { return "" }
func (stubStorage) Open(context.Context, string) (io.ReadCloser, error) {
	return io.NopCloser(&emptyReader{}), nil
}

type recordingStorage struct {
	deleted []string
}

func (*recordingStorage) Driver() string { return "test" }
func (*recordingStorage) Save(context.Context, string, io.Reader) (string, error) {
	return "", nil
}
func (s *recordingStorage) Delete(_ context.Context, key string) error {
	s.deleted = append(s.deleted, key)
	return nil
}
func (*recordingStorage) GetURL(string) string { return "" }
func (*recordingStorage) Open(context.Context, string) (io.ReadCloser, error) {
	return io.NopCloser(&emptyReader{}), nil
}

type emptyReader struct{}

func (*emptyReader) Read([]byte) (int, error) { return 0, io.EOF }

func createTestDB(t *testing.T) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []interface{}{(*models.Organization)(nil), (*models.Workspace)(nil), (*models.OAuthGrant)(nil), (*models.SocialAccount)(nil), (*models.Job)(nil), (*models.ProviderWriteAttempt)(nil)} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	now := time.Now().UTC()
	_, err = db.NewInsert().Model(&models.Organization{ID: "organization-1", Name: "Queue", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.Workspace{
		{ID: "workspace-1", OrganizationID: "organization-1", Name: "One", CreatedAt: now},
		{ID: "workspace-10", OrganizationID: "organization-1", Name: "Ten", CreatedAt: now},
		{ID: "ws-1", OrganizationID: "organization-1", Name: "Refresh", CreatedAt: now},
	}).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, jobregistry.EnsureActiveDedupeIndex(context.Background(), db))

	return db
}

func TestWorkerCompletesObsoleteRefreshJobWithoutTerminalTelemetry(t *testing.T) {
	db := createTestDB(t)
	now := time.Now().UTC()
	grant := models.OAuthGrant{
		ID: "legacy:account-disconnected", WorkspaceID: "ws-1", Provider: "threads",
		AccessTokenEnc: []byte("encrypted-access"), TokenVersion: 1,
		ExecutionMode: "oauth2", AuthorizationEvidence: `{}`, ValidationStatus: "legacy_unverified",
		CreatedAt: now, UpdatedAt: now,
	}
	_, err := db.NewInsert().Model(&grant).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-disconnected", WorkspaceID: "ws-1", Platform: "threads", AccountID: "threads-user",
		OAuthGrantID: grant.ID, AccessTokenEnc: []byte{}, IsActive: false,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("is_active = ?", false).
		Where("id = ?", "account-disconnected").
		Exec(t.Context())
	require.NoError(t, err)
	job := models.Job{
		ID: "refresh-disconnected", Type: jobregistry.TypeRefreshToken,
		Payload: `{"account_id":"account-disconnected"}`, Status: jobStatusPending,
		RunAt: now.Add(-time.Minute), MaxAttempts: 1,
	}
	_, err = db.NewInsert().Model(&job).Exec(t.Context())
	require.NoError(t, err)

	tokens := tokenmanager.NewTokenManager(db, crypto.NewTokenEncryptor("test-key"))
	worker := NewWorker(db, "worker-refresh", time.Hour, nil, tokens, stubStorage{})
	recorder := &telemetry.MemoryRecorder{}
	worker.SetTelemetry(recorder)

	require.True(t, worker.processNextJobIfAvailable(t.Context()))
	require.NoError(t, db.NewSelect().Model(&job).WherePK().Scan(t.Context()))
	require.Equal(t, jobStatusCompleted, job.Status)
	require.Empty(t, job.LastError)
	require.Empty(t, recorder.Exceptions)
}

func TestWorkerFailsUnknownJobTypes(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	job := &models.Job{
		ID:          "job-unknown",
		Type:        "unknown_job",
		Payload:     `{}`,
		Status:      jobStatusPending,
		RunAt:       time.Now().UTC().Add(-time.Second),
		MaxAttempts: 1,
	}
	_, err := db.NewInsert().Model(job).Exec(t.Context())
	require.NoError(t, err)

	worker := NewWorker(db, "worker-test", time.Second, nil, nil, stubStorage{})
	recorder := &telemetry.MemoryRecorder{}
	worker.SetTelemetry(recorder)
	require.True(t, worker.processNextJobIfAvailable(t.Context()))

	stored := new(models.Job)
	require.NoError(t, db.NewSelect().Model(stored).Where("id = ?", job.ID).Scan(t.Context()))
	require.Equal(t, jobStatusFailed, stored.Status)
	require.Contains(t, stored.LastError, "unsupported job type")
	require.Len(t, recorder.Exceptions, 1)
	require.Equal(t, "unknown_job", recorder.Exceptions[0].Properties["job_type"])
	require.NotContains(t, recorder.Exceptions[0].Properties, "payload")
}

func TestWorkerRequeuesCurrentJobForRepostContinuation(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	now := time.Now().UTC()
	job := &models.Job{
		ID: "repost-continuation", Type: jobregistry.TypeRepostExecute, Payload: `{}`,
		Status: jobStatusProcessing, RunAt: now.Add(-time.Minute), MaxAttempts: 1,
		LockedAt: now, LockedBy: "worker-repost",
	}
	_, err := db.NewInsert().Model(job).Exec(t.Context())
	require.NoError(t, err)

	worker := NewWorker(db, "worker-repost", time.Second, nil, nil, stubStorage{})
	worker.finishFailedJob(t.Context(), job, &repostservice.ExecutionContinuationError{RetryAfter: time.Minute})

	require.NoError(t, db.NewSelect().Model(job).WherePK().Scan(t.Context()))
	require.Equal(t, jobStatusPending, job.Status)
	require.Zero(t, job.Attempts)
	require.Empty(t, job.LockedBy)
	require.True(t, job.RunAt.After(now.Add(59*time.Second)))
}

func TestWorkerQuiesceFinishesCurrentJobWithoutClaimingAnother(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	now := time.Now().UTC().Add(-time.Minute)
	jobs := []models.Job{
		{ID: "job-current", Type: jobregistry.TypeRefreshToken, Payload: `{}`, Status: jobStatusPending, RunAt: now, MaxAttempts: 1},
		{ID: "job-next", Type: jobregistry.TypeRefreshToken, Payload: `{}`, Status: jobStatusPending, RunAt: now.Add(time.Second), MaxAttempts: 1},
	}
	_, err := db.NewInsert().Model(&jobs).Exec(t.Context())
	require.NoError(t, err)

	worker := NewWorker(db, "worker-drain", time.Hour, nil, nil, stubStorage{})
	started := make(chan struct{})
	release := make(chan struct{})
	worker.executors[jobregistry.ExecuteRefreshToken] = func(context.Context, *models.Job) error {
		close(started)
		<-release
		return nil
	}
	workerCtx, cancelWorker := context.WithCancel(t.Context())
	t.Cleanup(cancelWorker)
	go worker.Start(workerCtx)
	<-started

	worker.Quiesce()
	deadlineCtx, cancelDeadline := context.WithTimeout(t.Context(), 25*time.Millisecond)
	require.ErrorIs(t, worker.Wait(deadlineCtx), context.DeadlineExceeded)
	cancelDeadline()

	close(release)
	waitCtx, cancelWait := context.WithTimeout(t.Context(), time.Second)
	t.Cleanup(cancelWait)
	require.NoError(t, worker.Wait(waitCtx))

	var next models.Job
	require.NoError(t, db.NewSelect().Model(&next).Where("id = ?", "job-next").Scan(t.Context()))
	require.Equal(t, jobStatusPending, next.Status)
}

func TestWorkerPersistsInterruptedJobBeforeExiting(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	job := models.Job{
		ID: "job-interrupted", Type: jobregistry.TypeRefreshToken, Payload: `{}`,
		Status: jobStatusPending, RunAt: time.Now().UTC().Add(-time.Minute), MaxAttempts: 2,
	}
	_, err := db.NewInsert().Model(&job).Exec(t.Context())
	require.NoError(t, err)

	worker := NewWorker(db, "worker-interrupted", time.Hour, nil, nil, stubStorage{})
	started := make(chan struct{})
	worker.executors[jobregistry.ExecuteRefreshToken] = func(ctx context.Context, _ *models.Job) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}
	workerCtx, cancelWorker := context.WithCancel(t.Context())
	go worker.Start(workerCtx)
	<-started
	cancelWorker()

	waitCtx, cancelWait := context.WithTimeout(t.Context(), time.Second)
	t.Cleanup(cancelWait)
	require.NoError(t, worker.Wait(waitCtx))

	require.NoError(t, db.NewSelect().Model(&job).WherePK().Scan(t.Context()))
	require.NotEqual(t, jobStatusProcessing, job.Status)
	require.Empty(t, job.LockedBy)
}

func TestStorageDeletionRejectsTraversal(t *testing.T) {
	t.Parallel()

	worker := NewWorker(nil, "worker-test", time.Second, nil, nil, &recordingStorage{})
	err := worker.handleStorageDelete(t.Context(), `{"keys":["../outside"]}`)
	require.ErrorContains(t, err, "invalid key")
}
