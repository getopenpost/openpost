package queue

import (
	"context"
	"database/sql"
	"errors"
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
	"github.com/openpost/backend/internal/services/publicationbuilder"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestGrowthDiscoveryFailureHonorsProviderRetryAfter(t *testing.T) {
	worker := &BackgroundWorker{}
	job := &models.Job{Type: jobregistry.TypeGrowthDiscovery}
	failure := worker.classifyJobFailure(t.Context(), job, &platform.HTTPError{
		StatusCode: 429,
		Code:       "rate_limited",
		RetryAfter: 17 * time.Second,
	})
	require.True(t, failure.retryable)
	require.Equal(t, 17*time.Second, failure.retryAfter)

	definition, ok := jobregistry.Lookup(jobregistry.TypeGrowthDiscovery)
	require.True(t, ok)
	require.Equal(t, 3, definition.DefaultMaxAttempts)
	require.Equal(t, jobregistry.RecoveryRequeue, definition.Recovery)
}

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

type queuePackageBuilder struct{}

func (queuePackageBuilder) Build(context.Context, publicationbuilder.BuildInput) (publicationbuilder.BuildResult, error) {
	return publicationbuilder.BuildResult{}, nil
}

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

func TestWorkerDefersPublicationBuildWhileRuntimeIsUnavailable(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	now := time.Now().UTC()
	job, err := jobregistry.NewJob(jobregistry.TypePublicationBuild, `{"build_id":"build-1"}`, now.Add(-time.Second))
	require.NoError(t, err)
	job.ScopeID = "build-1"
	job.DedupeKey = "generate"
	job.Attempts = 1
	_, err = db.NewInsert().Model(job).Exec(t.Context())
	require.NoError(t, err)

	worker := NewWorker(db, "worker-test", time.Second, nil, nil, stubStorage{})
	worker.SetPublicationBuilderService(nil)
	require.True(t, worker.processNextJobIfAvailable(t.Context()))

	stored := new(models.Job)
	require.NoError(t, db.NewSelect().Model(stored).Where("id = ?", job.ID).Scan(t.Context()))
	require.Equal(t, jobStatusPending, stored.Status)
	require.Equal(t, 1, stored.Attempts, "missing runtime must not consume a delivery attempt")
	require.Equal(t, "Publication Builder is temporarily unavailable. OpenPost will retry when it is configured.", stored.LastError)
	require.WithinDuration(t, time.Now().UTC().Add(publicationBuilderUnavailableRetry), stored.RunAt, 5*time.Second)
}

func TestWorkerDefersPublicationBuildWhileActiveSlotsAreFull(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	now := time.Now().UTC()
	job, err := jobregistry.NewJob(jobregistry.TypePublicationBuild, `{"build_id":"build-capacity"}`, now.Add(-time.Second))
	require.NoError(t, err)
	job.ScopeID = "build-capacity"
	job.DedupeKey = "generate"
	job.Attempts = 1
	_, err = db.NewInsert().Model(job).Exec(t.Context())
	require.NoError(t, err)

	worker := NewWorker(db, "worker-test", time.Second, nil, nil, stubStorage{})
	worker.executors[jobregistry.ExecutePublicationBuild] = func(context.Context, *models.Job) error {
		return publicationbuilder.ErrTooManyActiveBuilds
	}
	require.True(t, worker.processNextJobIfAvailable(t.Context()))

	stored := new(models.Job)
	require.NoError(t, db.NewSelect().Model(stored).Where("id = ?", job.ID).Scan(t.Context()))
	require.Equal(t, jobStatusPending, stored.Status)
	require.Equal(t, 1, stored.Attempts)
	require.Equal(t, "Publication Builder is waiting for an active build slot.", stored.LastError)
	require.WithinDuration(t, time.Now().UTC().Add(publicationBuilderUnavailableRetry), stored.RunAt, 5*time.Second)
}

func TestWorkerDefersPublicationBuildWhileGenerationLeaseIsActive(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	now := time.Now().UTC()
	job, err := jobregistry.NewJob(jobregistry.TypePublicationBuild, `{"build_id":"build-leased"}`, now.Add(-time.Second))
	require.NoError(t, err)
	job.ScopeID = "build-leased"
	job.DedupeKey = "generate"
	job.Attempts = 1
	_, err = db.NewInsert().Model(job).Exec(t.Context())
	require.NoError(t, err)

	worker := NewWorker(db, "worker-test", time.Second, nil, nil, stubStorage{})
	worker.executors[jobregistry.ExecutePublicationBuild] = func(context.Context, *models.Job) error {
		return publicationbuilder.ErrBuildLeaseActive
	}
	require.True(t, worker.processNextJobIfAvailable(t.Context()))

	stored := new(models.Job)
	require.NoError(t, db.NewSelect().Model(stored).Where("id = ?", job.ID).Scan(t.Context()))
	require.Equal(t, jobStatusPending, stored.Status)
	require.Equal(t, 1, stored.Attempts, "a duplicate delivery must not consume an attempt")
	require.Equal(t, "Publication Builder is waiting for the active generation lease.", stored.LastError)
	require.WithinDuration(t, time.Now().UTC().Add(publicationBuilderUnavailableRetry), stored.RunAt, 5*time.Second)
}

func TestWorkerTerminalPublicationBuildFailureClearsTheDomainLease(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	_, err := db.NewCreateTable().Model((*publicationbuilder.BuildRecord)(nil)).IfNotExists().Exec(t.Context())
	require.NoError(t, err)
	now := time.Now().UTC()
	leaseExpiry := now.Add(time.Minute)
	build := &publicationbuilder.BuildRecord{
		ID: "build-terminal", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		State: publicationbuilder.BuildStateBuilding, Phase: publicationbuilder.BuildPhaseDrafting,
		Revision: 1, IdempotencyKey: "terminal-build", RequestFingerprint: "fingerprint",
		RequestJSON: `{}`, LeaseToken: "generation-lease", LeaseExpiresAt: &leaseExpiry,
		CreatedAt: now, UpdatedAt: now,
	}
	_, err = db.NewInsert().Model(build).Exec(t.Context())
	require.NoError(t, err)
	job, err := jobregistry.NewJob(jobregistry.TypePublicationBuild, `{"build_id":"build-terminal"}`, now.Add(-time.Second))
	require.NoError(t, err)
	job.ScopeID = build.ID
	job.DedupeKey = "generate"
	job.MaxAttempts = 1
	_, err = db.NewInsert().Model(job).Exec(t.Context())
	require.NoError(t, err)

	application, err := publicationbuilder.NewApplication(db, queuePackageBuilder{}, publicationbuilder.ApplicationConfig{})
	require.NoError(t, err)
	worker := NewWorker(db, "worker-test", time.Second, nil, nil, stubStorage{})
	worker.SetPublicationBuilderService(application)
	worker.executors[jobregistry.ExecutePublicationBuild] = func(context.Context, *models.Job) error {
		return errors.New("private infrastructure failure detail")
	}
	require.True(t, worker.processNextJobIfAvailable(t.Context()))

	require.NoError(t, db.NewSelect().Model(job).WherePK().Scan(t.Context()))
	require.Equal(t, jobStatusFailed, job.Status)
	require.Equal(t, 1, job.Attempts)
	require.NotContains(t, job.LastError, "private")
	require.NoError(t, db.NewSelect().Model(build).WherePK().Scan(t.Context()))
	require.Equal(t, publicationbuilder.BuildStateFailed, build.State)
	require.Equal(t, publicationbuilder.BuildPhaseFailed, build.Phase)
	require.Equal(t, "job_failed", build.ErrorCode)
	require.Equal(t, "OpenPost could not complete this build. You can retry it.", build.ErrorMessage)
	require.NotContains(t, build.ErrorMessage, "private")
	require.Empty(t, build.LeaseToken)
	require.True(t, build.LeaseExpiresAt == nil || build.LeaseExpiresAt.IsZero())
}

func TestWorkerCannotFailPublicationBuildAfterLosingItsJobLock(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	_, err := db.NewCreateTable().Model((*publicationbuilder.BuildRecord)(nil)).IfNotExists().Exec(t.Context())
	require.NoError(t, err)
	now := time.Now().UTC()
	leaseExpiry := now.Add(time.Minute)
	build := &publicationbuilder.BuildRecord{
		ID: "build-fenced", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		State: publicationbuilder.BuildStateBuilding, Phase: publicationbuilder.BuildPhaseDrafting,
		Revision: 1, IdempotencyKey: "fenced-build", RequestFingerprint: "fingerprint",
		RequestJSON: `{}`, LeaseToken: "generation-lease", LeaseExpiresAt: &leaseExpiry,
		CreatedAt: now, UpdatedAt: now,
	}
	_, err = db.NewInsert().Model(build).Exec(t.Context())
	require.NoError(t, err)
	job, err := jobregistry.NewJob(jobregistry.TypePublicationBuild, `{"build_id":"build-fenced"}`, now.Add(-time.Second))
	require.NoError(t, err)
	job.ScopeID = build.ID
	job.DedupeKey = "generate"
	job.MaxAttempts = 1
	_, err = db.NewInsert().Model(job).Exec(t.Context())
	require.NoError(t, err)

	application, err := publicationbuilder.NewApplication(db, queuePackageBuilder{}, publicationbuilder.ApplicationConfig{})
	require.NoError(t, err)
	worker := NewWorker(db, "old-worker", time.Second, nil, nil, stubStorage{})
	worker.SetPublicationBuilderService(application)
	worker.executors[jobregistry.ExecutePublicationBuild] = func(ctx context.Context, _ *models.Job) error {
		_, updateErr := db.NewUpdate().Model((*models.Job)(nil)).
			Set("locked_by = ?", "new-worker").
			Set("locked_at = ?", now.Add(time.Minute)).
			Where("id = ?", job.ID).
			Exec(ctx)
		require.NoError(t, updateErr)
		return errors.New("old worker failed after losing its fence")
	}
	require.True(t, worker.processNextJobIfAvailable(t.Context()))

	require.NoError(t, db.NewSelect().Model(job).WherePK().Scan(t.Context()))
	require.Equal(t, jobStatusProcessing, job.Status)
	require.Equal(t, "new-worker", job.LockedBy)
	require.NoError(t, db.NewSelect().Model(build).WherePK().Scan(t.Context()))
	require.Equal(t, publicationbuilder.BuildStateBuilding, build.State)
	require.Equal(t, "generation-lease", build.LeaseToken)
}

func TestWorkerCannotFinishJobAfterLosingItsLock(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name       string
		executeErr error
	}{
		{name: "success"},
		{name: "failure", executeErr: errors.New("safe executor failure")},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := createTestDB(t)
			now := time.Now().UTC()
			job, err := jobregistry.NewJob(jobregistry.TypePublicationBuild, `{"build_id":"build-lock"}`, now)
			require.NoError(t, err)
			job.ScopeID = "build-lock"
			job.DedupeKey = "generate"
			job.Status = jobStatusProcessing
			job.LockedAt = now
			job.LockedBy = "old-worker"
			_, err = db.NewInsert().Model(job).Exec(t.Context())
			require.NoError(t, err)

			worker := NewWorker(db, "old-worker", time.Second, nil, nil, stubStorage{})
			worker.executors[jobregistry.ExecutePublicationBuild] = func(ctx context.Context, _ *models.Job) error {
				_, updateErr := db.NewUpdate().Model((*models.Job)(nil)).
					Set("locked_by = ?", "new-worker").
					Set("locked_at = ?", now.Add(time.Minute)).
					Where("id = ?", job.ID).
					Exec(ctx)
				require.NoError(t, updateErr)
				return test.executeErr
			}
			worker.handleLockedJob(t.Context(), job)

			stored := new(models.Job)
			require.NoError(t, db.NewSelect().Model(stored).Where("id = ?", job.ID).Scan(t.Context()))
			require.Equal(t, jobStatusProcessing, stored.Status)
			require.Equal(t, "new-worker", stored.LockedBy)
			require.Equal(t, now.Add(time.Minute).Unix(), stored.LockedAt.Unix())
			require.Zero(t, stored.Attempts)
			require.Empty(t, stored.LastError)
		})
	}
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
