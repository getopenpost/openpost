package queue

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type stubStorage struct{}

func (stubStorage) Driver() string                         { return "test" }
func (stubStorage) Save(string, io.Reader) (string, error) { return "", nil }
func (stubStorage) Delete(string) error                    { return nil }
func (stubStorage) GetURL(string) string                   { return "" }
func (stubStorage) Open(string) (io.ReadCloser, error)     { return io.NopCloser(&emptyReader{}), nil }

type recordingStorage struct {
	deleted []string
}

func (*recordingStorage) Driver() string                         { return "test" }
func (*recordingStorage) Save(string, io.Reader) (string, error) { return "", nil }
func (s *recordingStorage) Delete(key string) error {
	s.deleted = append(s.deleted, key)
	return nil
}
func (*recordingStorage) GetURL(string) string { return "" }
func (*recordingStorage) Open(string) (io.ReadCloser, error) {
	return io.NopCloser(&emptyReader{}), nil
}

type emptyReader struct{}

func (*emptyReader) Read([]byte) (int, error) { return 0, io.EOF }

type stubAdapter struct {
	capability platform.RefreshCapability
	tokenResp  *platform.TokenResult
}

func (s *stubAdapter) GenerateAuthURL(string) (string, map[string]string) { return "", nil }
func (s *stubAdapter) ExchangeCode(context.Context, string, map[string]string) (*platform.TokenResult, error) {
	return nil, nil
}
func (s *stubAdapter) RefreshCapability() platform.RefreshCapability { return s.capability }
func (s *stubAdapter) RefreshToken(context.Context, platform.RefreshTokenInput) (*platform.TokenResult, error) {
	return s.tokenResp, nil
}
func (s *stubAdapter) GetProfile(context.Context, string) (*platform.UserProfile, error) {
	return nil, nil
}
func (s *stubAdapter) UploadMedia(context.Context, string, string, string, io.Reader) (string, error) {
	return "", nil
}
func (s *stubAdapter) Publish(context.Context, string, string, *platform.PublishRequest) (platform.PublishResult, error) {
	return platform.PublishResult{}, nil
}

func createTestDB(t *testing.T) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []interface{}{(*models.Organization)(nil), (*models.Workspace)(nil), (*models.SocialAccount)(nil), (*models.Job)(nil), (*models.ProviderWriteAttempt)(nil)} {
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

func TestWorkerProcessesRefreshTokenJob(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	encryptor := crypto.NewTokenEncryptor("test-secret-key")
	manager := tokenmanager.NewTokenManager(db, encryptor)
	manager.SetProvider("threads", &stubAdapter{
		capability: platform.RefreshCapability{
			Supported:        true,
			CredentialSource: platform.RefreshCredentialAccessToken,
		},
		tokenResp: &platform.TokenResult{
			AccessToken: "refreshed-access-token",
			ExpiresIn:   3600,
		},
	})

	encAccess, err := encryptor.Encrypt("stale-access-token")
	require.NoError(t, err)

	account := &models.SocialAccount{
		ID:             "acc-1",
		WorkspaceID:    "ws-1",
		Platform:       "threads",
		AccountID:      "user-1",
		AccessTokenEnc: encAccess,
		TokenExpiresAt: time.Now().UTC().Add(1 * time.Minute),
		IsActive:       true,
	}
	_, err = db.NewInsert().Model(account).Exec(context.Background())
	require.NoError(t, err)

	err = tokenmanager.ScheduleRefreshJob(context.Background(), db, account.ID, account.TokenExpiresAt)
	require.NoError(t, err)

	_, err = db.NewUpdate().
		Model((*models.Job)(nil)).
		Set("run_at = ?", time.Now().UTC().Add(-time.Second)).
		Where("type = ?", "refresh_token").
		Exec(context.Background())
	require.NoError(t, err)

	worker := NewWorker(db, "worker-test", time.Second, nil, manager, stubStorage{})
	processed := worker.processNextJobIfAvailable(context.Background())
	require.True(t, processed)

	var jobs []models.Job
	err = db.NewSelect().Model(&jobs).Where("type = ?", "refresh_token").Scan(context.Background())
	require.NoError(t, err)
	require.Len(t, jobs, 2)

	statusCounts := map[string]int{}
	for _, job := range jobs {
		statusCounts[job.Status]++
	}
	require.Equal(t, 1, statusCounts["completed"])
	require.Equal(t, 1, statusCounts["pending"])

	stored := new(models.SocialAccount)
	err = db.NewSelect().Model(stored).Where("id = ?", account.ID).Scan(context.Background())
	require.NoError(t, err)

	accessToken, err := encryptor.Decrypt(stored.AccessTokenEnc)
	require.NoError(t, err)
	require.Equal(t, "refreshed-access-token", accessToken)
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

func TestWorkerProcessesDurableStorageDeletion(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	job := &models.Job{
		ID: "job-storage-delete", Type: jobTypeStorageDelete,
		Payload: `{"keys":["media.png","thumbs/media-sm.png"]}`,
		Status:  jobStatusPending, RunAt: time.Now().UTC().Add(-time.Second), MaxAttempts: 3,
	}
	_, err := db.NewInsert().Model(job).Exec(t.Context())
	require.NoError(t, err)
	storage := &recordingStorage{}
	worker := NewWorker(db, "worker-test", time.Second, nil, nil, storage)

	require.True(t, worker.processNextJobIfAvailable(t.Context()))
	require.Equal(t, []string{"media.png", "thumbs/media-sm.png"}, storage.deleted)

	stored := new(models.Job)
	require.NoError(t, db.NewSelect().Model(stored).Where("id = ?", job.ID).Scan(t.Context()))
	require.Equal(t, jobStatusCompleted, stored.Status)
}

func TestStorageDeletionRejectsTraversal(t *testing.T) {
	t.Parallel()

	worker := NewWorker(nil, "worker-test", time.Second, nil, nil, &recordingStorage{})
	err := worker.handleStorageDelete(`{"keys":["../outside"]}`)
	require.ErrorContains(t, err, "invalid key")
}

func TestScheduleMediaCleanupUsesExactWorkspaceIdentity(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	require.NoError(t, ScheduleMediaCleanup(db, "workspace-10"))
	require.NoError(t, ScheduleMediaCleanup(db, "workspace-1"))

	count, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", jobTypeMediaCleanup).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 2, count)
}

func TestScheduleMediaCleanupIgnoresCompletedHistory(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	payload := `{"workspace_id":"workspace-1","days":14}`
	_, err := db.NewInsert().Model(&models.Job{
		ID: "completed-cleanup", Type: jobTypeMediaCleanup, Payload: payload,
		Status: jobStatusCompleted, RunAt: time.Now().UTC().Add(-time.Hour),
	}).Exec(t.Context())
	require.NoError(t, err)

	require.NoError(t, ScheduleMediaCleanup(db, "workspace-1"))
	active, err := db.NewSelect().Model((*models.Job)(nil)).
		Where("type = ? AND status IN (?, ?)", jobTypeMediaCleanup, jobStatusPending, jobStatusProcessing).
		Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, active)
}

func TestMediaCleanupReschedulesTheSameDurableChain(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	for _, model := range []any{
		(*models.MediaAttachment)(nil),
		(*models.DesignDocument)(nil),
		(*models.DesignRevision)(nil),
		(*models.DesignRevisionMediaIndexState)(nil),
		(*models.VideoProject)(nil),
		(*models.VideoProjectRevision)(nil),
		(*models.VideoRevisionMediaIndexState)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
	require.NoError(t, ScheduleMediaCleanup(db, "workspace-1"))
	_, err := db.NewUpdate().Model((*models.Job)(nil)).
		Set("run_at = ?", time.Now().UTC().Add(-time.Second)).
		Where("type = ?", jobTypeMediaCleanup).Exec(t.Context())
	require.NoError(t, err)

	worker := NewWorker(db, "worker-test", time.Second, nil, nil, stubStorage{})
	require.True(t, worker.processNextJobIfAvailable(t.Context()))

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", jobTypeMediaCleanup).Scan(t.Context()))
	require.Len(t, jobs, 1)
	require.Equal(t, jobStatusPending, jobs[0].Status)
	require.Zero(t, jobs[0].Attempts)
	require.Empty(t, jobs[0].LastError)
	require.WithinDuration(t, time.Now().UTC().Add(24*time.Hour), jobs[0].RunAt, 5*time.Second)
}

func TestScheduleMediaCleanupConcurrentEnqueueKeepsOneActiveChain(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	const callers = 16
	start := make(chan struct{})
	errs := make(chan error, callers)
	var ready sync.WaitGroup
	ready.Add(callers)
	for range callers {
		go func() {
			ready.Done()
			<-start
			errs <- ScheduleMediaCleanup(db, "workspace-1")
		}()
	}
	ready.Wait()
	close(start)
	for range callers {
		require.NoError(t, <-errs)
	}

	active, err := db.NewSelect().Model((*models.Job)(nil)).
		Where("type = ? AND scope_id = ?", jobTypeMediaCleanup, "workspace-1").
		Where("status IN (?, ?)", jobStatusPending, jobStatusProcessing).
		Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, active)
}
