package queue

import (
	"context"
	"io"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	growthservice "github.com/openpost/backend/internal/services/growth"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func growthQueueTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared&_busy_timeout=5000&_journal_mode=WAL")
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	_, err = db.ExecContext(ctx, "PRAGMA foreign_keys = ON")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, "PRAGMA busy_timeout = 5000")
	require.NoError(t, err)
	// minimal schema for growth + jobs
	for _, m := range []any{(*models.Organization)(nil), (*models.Workspace)(nil), (*models.User)(nil), (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil), (*models.Job)(nil), (*models.ProviderWriteAttempt)(nil)} {
		_, err = db.NewCreateTable().Model(m).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS growth_recommendations (
		  id TEXT PRIMARY KEY,
		  workspace_id TEXT NOT NULL,
		  social_account_id TEXT NOT NULL,
		  platform TEXT NOT NULL,
		  remote_account_id TEXT NOT NULL,
		  handle TEXT NOT NULL DEFAULT '',
		  display_name TEXT NOT NULL DEFAULT '',
		  bio TEXT NOT NULL DEFAULT '',
		  avatar_url TEXT NOT NULL DEFAULT '',
		  profile_url TEXT NOT NULL DEFAULT '',
		  followers_count INTEGER NOT NULL DEFAULT 0,
		  following_count INTEGER NOT NULL DEFAULT 0,
		  mutual_count INTEGER NOT NULL DEFAULT 0,
		  mutuals_json TEXT NOT NULL DEFAULT '[]',
		  mutual_exact BOOLEAN NOT NULL DEFAULT 0,
		  follows_viewer BOOLEAN NOT NULL DEFAULT 0,
		  signals_json TEXT NOT NULL DEFAULT '[]',
		  score REAL NOT NULL DEFAULT 0,
		  generation_id TEXT NOT NULL,
		  dismissed_at TIMESTAMP,
		  follow_state TEXT NOT NULL DEFAULT 'idle',
		  follow_error_code TEXT NOT NULL DEFAULT '',
		  follow_error_message TEXT NOT NULL DEFAULT '',
		  last_seen_at TIMESTAMP NOT NULL,
		  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
		  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
		  UNIQUE (social_account_id, remote_account_id)
		);
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS growth_sync_states (
		  id TEXT PRIMARY KEY,
		  workspace_id TEXT NOT NULL,
		  social_account_id TEXT NOT NULL,
		  platform TEXT NOT NULL,
		  status TEXT NOT NULL DEFAULT 'idle',
		  error_code TEXT NOT NULL DEFAULT '',
		  error_message TEXT NOT NULL DEFAULT '',
		  current_generation_id TEXT NOT NULL DEFAULT '',
		  last_attempted_at TIMESTAMP,
		  last_success_at TIMESTAMP,
		  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
		  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
		  UNIQUE (social_account_id)
		);
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_dedupe_unique_idx ON jobs (type, scope_id, dedupe_key) WHERE status IN ('pending','processing') AND scope_id <> '' AND dedupe_key <> ''`)
	require.NoError(t, err)
	require.NoError(t, jobregistry.EnsureActiveDedupeIndex(ctx, db))
	return db
}

type fakeGrowthTokenSource struct{}

func (f fakeGrowthTokenSource) GetValidAccessToken(ctx context.Context, accountID string) (string, error) {
	return "tok", nil
}

type fakeGrowthAdapterWithRetry struct {
	err error
}

func (f *fakeGrowthAdapterWithRetry) DiscoverGrowthCandidates(ctx context.Context, input platform.GrowthDiscoveryInput) ([]platform.GrowthCandidate, error) {
	return nil, f.err
}
func (f *fakeGrowthAdapterWithRetry) FollowGrowthCandidate(ctx context.Context, accessToken, viewerID, candidateID string) (platform.GrowthFollowResult, error) {
	return platform.GrowthFollowResult{}, f.err
}

// Ensure it satisfies platform.Adapter
func (f *fakeGrowthAdapterWithRetry) GenerateAuthURL(string) (string, map[string]string) { return "", nil }
func (f *fakeGrowthAdapterWithRetry) ExchangeCode(context.Context, string, map[string]string) (*platform.TokenResult, error) { return nil, nil }
func (f *fakeGrowthAdapterWithRetry) RefreshCapability() platform.RefreshCapability { return platform.RefreshCapability{} }
func (f *fakeGrowthAdapterWithRetry) RefreshToken(context.Context, platform.RefreshTokenInput) (*platform.TokenResult, error) { return nil, nil }
func (f *fakeGrowthAdapterWithRetry) GetProfile(context.Context, string) (*platform.UserProfile, error) { return nil, nil }
func (f *fakeGrowthAdapterWithRetry) UploadMedia(ctx context.Context, accessToken, accountID, mimeType string, reader io.Reader) (string, error) { return "", nil }
func (f *fakeGrowthAdapterWithRetry) Publish(context.Context, string, string, *platform.PublishRequest) (platform.PublishResult, error) { return platform.PublishResult{}, nil }

func TestGrowthDiscoveryRetryAfterReachesQueueAndRetainsOldGeneration(t *testing.T) {
	t.Parallel()
	db := growthQueueTestDB(t)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.Organization{ID: "org-1", Name: "org", CreatedAt: now, UpdatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", OrganizationID: "org-1", Name: "ws", CreatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{ID: "user-1", Email: "u@test", CreatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleEditor, Status: models.WorkspaceMemberStatusActive, CreatedAt: now, UpdatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{ID: "acc-1", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:viewer", IsActive: true, AccessTokenEnc: []byte("tok"), CreatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	genOld := "gen-old"
	_, err = db.NewInsert().Model(&models.GrowthSyncState{ID: uuid.NewString(), WorkspaceID: "ws-1", SocialAccountID: "acc-1", Platform: "bluesky", Status: models.GrowthSyncStatusOK, CurrentGenerationID: genOld, LastSuccessAt: now, CreatedAt: now, UpdatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.GrowthRecommendation{ID: "rec-old", WorkspaceID: "ws-1", SocialAccountID: "acc-1", Platform: "bluesky", RemoteAccountID: "remote-old", Handle: "olduser", GenerationID: genOld, FollowState: models.GrowthRecommendationFollowIdle, Score: 10, LastSeenAt: now, CreatedAt: now, UpdatedAt: now}).Exec(context.Background())
	require.NoError(t, err)

	retryAfter := 45 * time.Second
	adapter := &fakeGrowthAdapterWithRetry{err: &platform.HTTPError{StatusCode: 429, Code: "rate_limited", RetryAfter: retryAfter}}
	svc := growthservice.NewService(db, fakeGrowthTokenSource{}, nil)
	svc.SetProvider("bluesky", adapter)

	// Enqueue refresh via service to get proper job dedupe
	// Use workspaceaccess ActorFacts directly via service's QueueRefresh needs it
	// Bypass authorize by inserting member above, use service.QueueRefresh with proper actor
	// Need to create ActorFacts type
	// Since we cannot import workspaceaccess easily, use jobregistry directly to enqueue job that worker will process
	// Instead manually create growth discovery job
	job, err := jobregistry.NewJob(jobregistry.TypeGrowthDiscovery, `{"workspace_id":"ws-1","social_account_id":"acc-1","actor_user_id":"user-1"}`, time.Now().UTC())
	require.NoError(t, err)
	job.ScopeID = "ws-1"
	job.DedupeKey = "growth:acc-1"
	job.RunAt = time.Now().UTC().Add(-time.Second)
	_, err = db.NewInsert().Model(job).Exec(context.Background())
	require.NoError(t, err)

	worker := NewWorker(db, "worker-test", time.Second, nil, nil, stubStorage{})
	worker.SetGrowthService(svc)

	// Process job - should fail, be requeued with RetryAfter delay, not failed, and retain old generation
	before := time.Now().UTC()
	processed := worker.processNextJobIfAvailable(context.Background())
	require.True(t, processed)

	var stored models.Job
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", job.ID).Scan(context.Background()))
	require.Equal(t, jobStatusPending, stored.Status, "growth_discovery should be requeued, not failed")
	require.Equal(t, 1, stored.Attempts)
	require.GreaterOrEqual(t, stored.RunAt.Unix(), before.Add(retryAfter).Unix()-10, "run_at should be at least retryAfter in future")
	require.LessOrEqual(t, stored.RunAt.Unix(), before.Add(retryAfter).Unix()+10)

	var state models.GrowthSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("social_account_id = ?", "acc-1").Scan(context.Background()))
	require.Equal(t, genOld, state.CurrentGenerationID, "old generation must be retained on rate limited failure")
	require.Equal(t, models.GrowthSyncStatusRateLimited, state.Status)

	// Verify job still has 3 max attempts (provider_read) - should retry
	require.Equal(t, 3, stored.MaxAttempts)

	// Follow should be 1 attempt and fail ambiguous, not requeued
	// Setup follow job
	_, err = db.NewInsert().Model(&models.GrowthRecommendation{ID: "rec-follow", WorkspaceID: "ws-1", SocialAccountID: "acc-1", Platform: "bluesky", RemoteAccountID: "remote-follow", Handle: "followuser", GenerationID: genOld, FollowState: models.GrowthRecommendationFollowIdle, Score: 5, LastSeenAt: now, CreatedAt: now, UpdatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	// Need to set follow adapter to fail with 429 as well
	adapter2 := &fakeGrowthAdapterWithRetry{err: &platform.HTTPError{StatusCode: 429, Code: "rate_limited", RetryAfter: retryAfter}}
	svc2 := growthservice.NewService(db, fakeGrowthTokenSource{}, nil)
	svc2.SetProvider("bluesky", adapter2)
	// Create follow job
	followJob, err := jobregistry.NewJob(jobregistry.TypeGrowthFollow, `{"workspace_id":"ws-1","recommendation_id":"rec-follow","actor_user_id":"user-1"}`, time.Now().UTC())
	require.NoError(t, err)
	followJob.RunAt = time.Now().UTC().Add(-time.Second)
	_, err = db.NewInsert().Model(followJob).Exec(context.Background())
	require.NoError(t, err)
	worker2 := NewWorker(db, "worker-test", time.Second, nil, nil, stubStorage{})
	worker2.SetGrowthService(svc2)
	processed = worker2.processNextJobIfAvailable(context.Background())
	require.True(t, processed)
	var followStored models.Job
	require.NoError(t, db.NewSelect().Model(&followStored).Where("id = ?", followJob.ID).Scan(context.Background()))
	require.Equal(t, jobStatusFailed, followStored.Status, "growth_follow is provider_write with 1 attempt, should fail ambiguous not requeue")
	require.Equal(t, 1, followStored.MaxAttempts)
}
