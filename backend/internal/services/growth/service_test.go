package growth

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type staticTokenSource struct {
	token string
	err   error
}

func (s staticTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	if s.err != nil {
		return "", s.err
	}
	if s.token != "" {
		return s.token, nil
	}
	return "access-token", nil
}

type fakeGrowthAdapter struct {
	platform.Adapter
	discover func(ctx context.Context, input platform.GrowthDiscoveryInput) ([]platform.GrowthCandidate, error)
	follow   func(ctx context.Context, accessToken, viewerID, candidateID string) (platform.GrowthFollowResult, error)
}

func (f *fakeGrowthAdapter) DiscoverGrowthCandidates(ctx context.Context, input platform.GrowthDiscoveryInput) ([]platform.GrowthCandidate, error) {
	if f.discover != nil {
		return f.discover(ctx, input)
	}
	return nil, nil
}
func (f *fakeGrowthAdapter) FollowGrowthCandidate(ctx context.Context, accessToken, viewerID, candidateID string) (platform.GrowthFollowResult, error) {
	if f.follow != nil {
		return f.follow(ctx, accessToken, viewerID, candidateID)
	}
	return platform.GrowthFollowResult{ProviderState: "following"}, nil
}

func growthTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	_, err = db.ExecContext(ctx, "PRAGMA foreign_keys = ON")
	require.NoError(t, err)
	require.NoError(t, createGrowthSchema(ctx, db))
	return db
}

func createGrowthSchema(ctx context.Context, db *bun.DB) error {
	for _, m := range []any{
		(*models.Organization)(nil), (*models.Workspace)(nil), (*models.User)(nil),
		(*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil), (*models.Job)(nil), (*models.ProviderWriteAttempt)(nil),
	} {
		if _, err := db.NewCreateTable().Model(m).IfNotExists().Exec(ctx); err != nil {
			return err
		}
	}
	// Create growth tables with FK cascades via raw SQL (Bun CreateTable does not emit FKs for growth models)
	if _, err := db.ExecContext(ctx, `
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
	`); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `
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
	`); err != nil {
		return err
	}
	// Ensure dedupe index for jobs
	if _, err := db.ExecContext(ctx, `CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_dedupe_unique_idx ON jobs (type, scope_id, dedupe_key) WHERE status IN ('pending','processing') AND scope_id <> '' AND dedupe_key <> ''`); err != nil {
		return err
	}
	return nil
}

func seedGrowthWorkspace(t *testing.T, db *bun.DB, workspaceID, _ string, _ string) {
	t.Helper()
	ctx := context.Background()
	userID := "user-1"
	role := models.WorkspaceRoleEditor
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.Organization{ID: "org-1", Name: "org", CreatedAt: now, UpdatedAt: now}).On("CONFLICT DO NOTHING").Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: workspaceID, OrganizationID: "org-1", Name: "ws", CreatedAt: now}).On("CONFLICT DO NOTHING").Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{ID: userID, Email: userID + "@test", CreatedAt: now}).On("CONFLICT DO NOTHING").Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: workspaceID, UserID: userID, Role: role, Status: models.WorkspaceMemberStatusActive, CreatedAt: now, UpdatedAt: now}).On("CONFLICT DO NOTHING").Exec(ctx)
	require.NoError(t, err)
}

func TestWorkspaceAccountIsolationAndMastodonProviderKey(t *testing.T) {
	db := growthTestDB(t)
	seedGrowthWorkspace(t, db, "ws-1", "user-1", models.WorkspaceRoleEditor)
	seedGrowthWorkspace(t, db, "ws-2", "user-1", models.WorkspaceRoleEditor)
	now := time.Now().UTC()
	// Bluesky account in ws-1
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-bluesky", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:viewer", IsActive: true, AccessTokenEnc: []byte("tok"), CreatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	// Mastodon account with instance URL
	_, err = db.NewInsert().Model(&models.SocialAccount{ID: "acc-masto", WorkspaceID: "ws-1", Platform: "mastodon", AccountID: "123", InstanceURL: "https://mastodon.example", IsActive: true, AccessTokenEnc: []byte("tok"), CreatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	// Same account ID but different workspace should be isolated
	_, err = db.NewInsert().Model(&models.SocialAccount{ID: "acc-other-ws", WorkspaceID: "ws-2", Platform: "bluesky", AccountID: "did:plc:viewer2", IsActive: true, AccessTokenEnc: []byte("tok"), CreatedAt: now}).Exec(context.Background())
	require.NoError(t, err)

	svc := NewService(db, staticTokenSource{}, nil)
	// Register providers with exact mastodon key
	svc.SetProvider("bluesky", &fakeGrowthAdapter{})
	svc.SetProvider("mastodon:https://mastodon.example", &fakeGrowthAdapter{})

	actor := workspaceaccess.ActorFacts{UserID: "user-1"}
	// Bluesky should succeed
	_, err = svc.QueueRefresh(context.Background(), actor, "ws-1", "acc-bluesky")
	require.NoError(t, err)
	// Mastodon with correct instance key should succeed
	_, err = svc.QueueRefresh(context.Background(), actor, "ws-1", "acc-masto")
	require.NoError(t, err)
	// Wrong workspace should fail isolation
	_, err = svc.QueueRefresh(context.Background(), actor, "ws-2", "acc-bluesky")
	require.Error(t, err)
	// Mastodon without exact instance key fails
	svc2 := NewService(db, staticTokenSource{}, nil)
	svc2.SetProvider("mastodon", &fakeGrowthAdapter{})
	_, err = svc2.QueueRefresh(context.Background(), actor, "ws-1", "acc-masto")
	require.Error(t, err)
}

func TestRefreshActiveJobDedupe(t *testing.T) {
	db := growthTestDB(t)
	seedGrowthWorkspace(t, db, "ws-1", "user-1", models.WorkspaceRoleEditor)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-1", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:viewer", IsActive: true, AccessTokenEnc: []byte("tok"), CreatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	svc := NewService(db, staticTokenSource{}, nil)
	svc.SetProvider("bluesky", &fakeGrowthAdapter{})
	actor := workspaceaccess.ActorFacts{UserID: "user-1"}
	id1, err := svc.QueueRefresh(context.Background(), actor, "ws-1", "acc-1")
	require.NoError(t, err)
	id2, err := svc.QueueRefresh(context.Background(), actor, "ws-1", "acc-1")
	require.NoError(t, err)
	require.Equal(t, id1, id2)

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", "growth_discovery").Scan(context.Background()))
	require.Len(t, jobs, 1)
}

func TestSuccessfulAtomicGenerationSwapAndFailedRetainsOld(t *testing.T) {
	db := growthTestDB(t)
	seedGrowthWorkspace(t, db, "ws-1", "user-1", models.WorkspaceRoleEditor)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-1", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:viewer", IsActive: true, AccessTokenEnc: []byte("tok"), CreatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	adapter := &fakeGrowthAdapter{
		discover: func(_ context.Context, _ platform.GrowthDiscoveryInput) ([]platform.GrowthCandidate, error) {
			return []platform.GrowthCandidate{
				{RemoteID: "remote-1", Handle: "alice", DisplayName: "Alice", Bio: "bio", AvatarURL: "https://cdn.test/a.jpg", ProfileURL: "https://bsky.app/profile/alice", FollowersCount: 10, FollowingCount: 5, MutualCount: 2, Signals: []string{"friends_of_friends"}},
			}, nil
		},
	}
	svc := NewService(db, staticTokenSource{}, nil)
	svc.SetProvider("bluesky", adapter)
	actor := workspaceaccess.ActorFacts{UserID: "user-1"}
	_, err = svc.QueueRefresh(context.Background(), actor, "ws-1", "acc-1")
	require.NoError(t, err)
	// Execute discovery job directly
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("type = ?", "growth_discovery").Limit(1).Scan(context.Background()))
	require.NoError(t, svc.HandleJob(context.Background(), job.Type, job.Payload))
	// Verify generation A visible
	res, err := svc.List(context.Background(), workspaceaccess.ActorFacts{UserID: "user-1"}, "ws-1", "acc-1")
	require.NoError(t, err)
	require.Len(t, res.Items, 1)
	genA := res.SyncState.CurrentGenerationID
	require.NotEmpty(t, genA)

	// Second refresh with different candidate set should atomically swap to generation B
	adapter.discover = func(_ context.Context, _ platform.GrowthDiscoveryInput) ([]platform.GrowthCandidate, error) {
		return []platform.GrowthCandidate{
			{RemoteID: "remote-2", Handle: "bob", DisplayName: "Bob", Bio: "bio", AvatarURL: "https://cdn.test/b.jpg", ProfileURL: "https://bsky.app/profile/bob", FollowersCount: 20, FollowingCount: 5, MutualCount: 3, Signals: []string{"suggestion"}},
		}, nil
	}
	_, err = svc.QueueRefresh(context.Background(), actor, "ws-1", "acc-1")
	require.NoError(t, err)
	var job2 models.Job
	require.NoError(t, db.NewSelect().Model(&job2).Where("type = ?", "growth_discovery").Order("created_at DESC").Limit(1).Scan(context.Background()))
	// Need to find pending job (first completed but we didn't mark completed; we directly handle, so job still pending)
	// Instead queue already dedupes; we need to force handling of queued job we just ensured
	require.NoError(t, svc.HandleJob(context.Background(), job2.Type, job2.Payload))
	res2, err := svc.List(context.Background(), workspaceaccess.ActorFacts{UserID: "user-1"}, "ws-1", "acc-1")
	require.NoError(t, err)
	require.Len(t, res2.Items, 1)
	require.Equal(t, "bob", res2.Items[0].Handle)
	require.NotEqual(t, genA, res2.SyncState.CurrentGenerationID)

	// Failed discovery retains old generation
	adapter.discover = func(_ context.Context, _ platform.GrowthDiscoveryInput) ([]platform.GrowthCandidate, error) {
		return nil, &platform.HTTPError{StatusCode: 500, Code: "provider_server"}
	}
	_, err = svc.QueueRefresh(context.Background(), actor, "ws-1", "acc-1")
	require.NoError(t, err)
	var job3 models.Job
	require.NoError(t, db.NewSelect().Model(&job3).Where("type = ?", "growth_discovery").Order("created_at DESC").Limit(1).Scan(context.Background()))
	err = svc.HandleJob(context.Background(), job3.Type, job3.Payload)
	require.Error(t, err)
	res3, err := svc.List(context.Background(), workspaceaccess.ActorFacts{UserID: "user-1"}, "ws-1", "acc-1")
	require.NoError(t, err)
	require.Len(t, res3.Items, 1)
	require.Equal(t, "bob", res3.Items[0].Handle, "failed discovery should keep old generation")
	require.Equal(t, res2.SyncState.CurrentGenerationID, res3.SyncState.CurrentGenerationID)
}

func TestDismissalSurvivesAndFollowingDoesNotResurface(t *testing.T) {
	db := growthTestDB(t)
	seedGrowthWorkspace(t, db, "ws-1", "user-1", models.WorkspaceRoleEditor)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-1", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:viewer", IsActive: true, AccessTokenEnc: []byte("tok"), CreatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	candidates := []platform.GrowthCandidate{
		{RemoteID: "remote-1", Handle: "alice", DisplayName: "Alice", FollowersCount: 10, FollowingCount: 5, Signals: []string{"friends_of_friends"}},
		{RemoteID: "remote-2", Handle: "bob", DisplayName: "Bob", FollowersCount: 10, FollowingCount: 5, Signals: []string{"suggestion"}},
	}
	adapter := &fakeGrowthAdapter{
		discover: func(_ context.Context, _ platform.GrowthDiscoveryInput) ([]platform.GrowthCandidate, error) {
			return candidates, nil
		},
	}
	svc := NewService(db, staticTokenSource{}, nil)
	svc.SetProvider("bluesky", adapter)
	actor := workspaceaccess.ActorFacts{UserID: "user-1"}
	_, err = svc.QueueRefresh(context.Background(), actor, "ws-1", "acc-1")
	require.NoError(t, err)
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("type = ?", "growth_discovery").Limit(1).Scan(context.Background()))
	require.NoError(t, svc.HandleJob(context.Background(), job.Type, job.Payload))
	res, err := svc.List(context.Background(), actor, "ws-1", "acc-1")
	require.NoError(t, err)
	require.Len(t, res.Items, 2)
	// Dismiss alice
	aliceID := ""
	for _, it := range res.Items {
		if it.Handle == "alice" {
			aliceID = it.ID
		}
	}
	require.NotEmpty(t, aliceID)
	require.NoError(t, svc.Dismiss(context.Background(), actor, "ws-1", aliceID))
	// Mark bob as following (terminal)
	var bobRec models.GrowthRecommendation
	require.NoError(t, db.NewSelect().Model(&bobRec).Where("handle = ? AND social_account_id = ?", "bob", "acc-1").Scan(context.Background()))
	_, err = db.NewUpdate().Model(&bobRec).Set("follow_state = ?", models.GrowthRecommendationFollowFollowing).WherePK().Exec(context.Background())
	require.NoError(t, err)

	// Refresh again includes same remote IDs, but dismissed/following should not reappear
	_, err = svc.QueueRefresh(context.Background(), actor, "ws-1", "acc-1")
	require.NoError(t, err)
	var job2 models.Job
	require.NoError(t, db.NewSelect().Model(&job2).Where("type = ?", "growth_discovery").Order("created_at DESC").Limit(1).Scan(context.Background()))
	require.NoError(t, svc.HandleJob(context.Background(), job2.Type, job2.Payload))
	res2, err := svc.List(context.Background(), actor, "ws-1", "acc-1")
	require.NoError(t, err)
	for _, it := range res2.Items {
		require.NotEqual(t, "alice", it.Handle, "dismissed should not reappear")
		require.NotEqual(t, "bob", it.Handle, "following should not reappear")
	}
}

func TestProvider429AndRetryAfterState(t *testing.T) {
	db := growthTestDB(t)
	seedGrowthWorkspace(t, db, "ws-1", "user-1", models.WorkspaceRoleEditor)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-1", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:viewer", IsActive: true, AccessTokenEnc: []byte("tok"), CreatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	adapter := &fakeGrowthAdapter{
		discover: func(_ context.Context, _ platform.GrowthDiscoveryInput) ([]platform.GrowthCandidate, error) {
			return nil, &platform.HTTPError{StatusCode: 429, Code: "rate_limited"}
		},
	}
	svc := NewService(db, staticTokenSource{}, nil)
	svc.SetProvider("bluesky", adapter)
	actor := workspaceaccess.ActorFacts{UserID: "user-1"}
	_, err = svc.QueueRefresh(context.Background(), actor, "ws-1", "acc-1")
	require.NoError(t, err)
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("type = ?", "growth_discovery").Limit(1).Scan(context.Background()))
	err = svc.HandleJob(context.Background(), job.Type, job.Payload)
	require.Error(t, err)
	var state models.GrowthSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("social_account_id = ?", "acc-1").Scan(context.Background()))
	require.Equal(t, models.GrowthSyncStatusRateLimited, state.Status)
}

func TestAccountDisconnectCascades(t *testing.T) {
	db := growthTestDB(t)
	seedGrowthWorkspace(t, db, "ws-1", "user-1", models.WorkspaceRoleEditor)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-1", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:viewer", IsActive: true, AccessTokenEnc: []byte("tok"), CreatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.GrowthSyncState{ID: uuid.NewString(), WorkspaceID: "ws-1", SocialAccountID: "acc-1", Platform: "bluesky", Status: models.GrowthSyncStatusOK, CurrentGenerationID: "gen-1", CreatedAt: now, UpdatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.GrowthRecommendation{ID: uuid.NewString(), WorkspaceID: "ws-1", SocialAccountID: "acc-1", Platform: "bluesky", RemoteAccountID: "remote-1", Handle: "alice", GenerationID: "gen-1", FollowState: models.GrowthRecommendationFollowIdle, Score: 10, LastSeenAt: now, CreatedAt: now, UpdatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	// Delete account cascades
	_, err = db.NewDelete().Model((*models.SocialAccount)(nil)).Where("id = ?", "acc-1").Exec(context.Background())
	require.NoError(t, err)
	var count int
	count, err = db.NewSelect().Model((*models.GrowthRecommendation)(nil)).Where("social_account_id = ?", "acc-1").Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 0, count)
	count, err = db.NewSelect().Model((*models.GrowthSyncState)(nil)).Where("social_account_id = ?", "acc-1").Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 0, count)
}

func TestFollowProviderWriteAndOneAttempt(t *testing.T) {
	db := growthTestDB(t)
	seedGrowthWorkspace(t, db, "ws-1", "user-1", models.WorkspaceRoleEditor)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-1", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:viewer", IsActive: true, AccessTokenEnc: []byte("tok"), CreatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	recID := uuid.NewString()
	_, err = db.NewInsert().Model(&models.GrowthSyncState{ID: uuid.NewString(), WorkspaceID: "ws-1", SocialAccountID: "acc-1", Platform: "bluesky", Status: models.GrowthSyncStatusOK, CurrentGenerationID: "gen-1", CreatedAt: now, UpdatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.GrowthRecommendation{ID: recID, WorkspaceID: "ws-1", SocialAccountID: "acc-1", Platform: "bluesky", RemoteAccountID: "remote-1", Handle: "alice", GenerationID: "gen-1", FollowState: models.GrowthRecommendationFollowIdle, Score: 10, LastSeenAt: now, CreatedAt: now, UpdatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	followCalled := 0
	adapter := &fakeGrowthAdapter{
		follow: func(_ context.Context, _, _, _ string) (platform.GrowthFollowResult, error) {
			followCalled++
			return platform.GrowthFollowResult{ProviderState: "following"}, nil
		},
	}
	svc := NewService(db, staticTokenSource{}, nil)
	svc.SetProvider("bluesky", adapter)
	actor := workspaceaccess.ActorFacts{UserID: "user-1"}
	jobID, err := svc.QueueFollow(context.Background(), actor, "ws-1", recID)
	require.NoError(t, err)
	require.NotEmpty(t, jobID)
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", jobID).Scan(context.Background()))
	ctx := providerwrite.WithJobExecution(context.Background(), job.ID, 1, time.Now().UTC())
	require.NoError(t, svc.HandleJob(ctx, job.Type, job.Payload))
	var updated models.GrowthRecommendation
	require.NoError(t, db.NewSelect().Model(&updated).Where("id = ?", recID).Scan(context.Background()))
	require.Equal(t, models.GrowthRecommendationFollowFollowing, updated.FollowState)
	require.Equal(t, 1, followCalled)
	// Duplicate pending/terminal should be prevented
	_, err = svc.QueueFollow(context.Background(), actor, "ws-1", recID)
	require.ErrorIs(t, err, ErrConflict)
}

func TestConcurrentFirstRefreshUsesOneJob(t *testing.T) {
	db := growthTestDB(t)
	db.SetMaxOpenConns(1)
	seedGrowthWorkspace(t, db, "ws-1", "user-1", models.WorkspaceRoleEditor)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.SocialAccount{
		ID: "acc-1", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:viewer",
		IsActive: true, AccessTokenEnc: []byte("tok"), CreatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)

	svc := NewService(db, staticTokenSource{}, nil)
	svc.SetProvider("bluesky", &fakeGrowthAdapter{})
	actor := workspaceaccess.ActorFacts{UserID: "user-1"}
	start := make(chan struct{})
	ids := make([]string, 2)
	errs := make([]error, 2)
	var wait sync.WaitGroup
	for index := range ids {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			<-start
			ids[index], errs[index] = svc.QueueRefresh(t.Context(), actor, "ws-1", "acc-1")
		}(index)
	}
	close(start)
	wait.Wait()

	require.NoError(t, errs[0])
	require.NoError(t, errs[1])
	require.NotEmpty(t, ids[0])
	require.Equal(t, ids[0], ids[1])
	count, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", jobregistry.TypeGrowthDiscovery).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestDiscoveryPersistsOnlyTopFortyCandidates(t *testing.T) {
	db := growthTestDB(t)
	seedGrowthWorkspace(t, db, "ws-1", "user-1", models.WorkspaceRoleEditor)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.SocialAccount{
		ID: "acc-1", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:viewer",
		IsActive: true, AccessTokenEnc: []byte("tok"), CreatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)

	candidates := make([]platform.GrowthCandidate, 65)
	for index := range candidates {
		handle := fmt.Sprintf("person-%03d", 64-index)
		candidates[index] = platform.GrowthCandidate{
			RemoteID: "did:plc:" + handle, Handle: handle, DisplayName: handle,
			Bio: "A complete profile", AvatarURL: "https://cdn.example/" + handle + ".jpg",
			ProfileURL:     "https://bsky.app/profile/" + handle,
			FollowersCount: 100, FollowingCount: 100, MutualCount: 2,
			Signals: []string{"friends_of_friends"},
		}
	}
	adapter := &fakeGrowthAdapter{discover: func(context.Context, platform.GrowthDiscoveryInput) ([]platform.GrowthCandidate, error) {
		return candidates, nil
	}}
	svc := NewService(db, staticTokenSource{}, nil)
	svc.SetProvider("bluesky", adapter)
	actor := workspaceaccess.ActorFacts{UserID: "user-1"}
	_, err = svc.QueueRefresh(t.Context(), actor, "ws-1", "acc-1")
	require.NoError(t, err)
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("type = ?", jobregistry.TypeGrowthDiscovery).Scan(t.Context()))
	require.NoError(t, svc.HandleJob(t.Context(), job.Type, job.Payload))

	result, err := svc.List(t.Context(), actor, "ws-1", "acc-1")
	require.NoError(t, err)
	require.Len(t, result.Items, discoveryTarget)
	for index, item := range result.Items {
		require.Equal(t, fmt.Sprintf("person-%03d", index), item.Handle)
	}
	count, err := db.NewSelect().Model((*models.GrowthRecommendation)(nil)).
		Where("social_account_id = ? AND generation_id = ?", "acc-1", result.SyncState.CurrentGenerationID).
		Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, discoveryTarget, count)
}

func TestGrowthTelemetryUsesRealRankAndSharedMutualBuckets(t *testing.T) {
	db := growthTestDB(t)
	seedGrowthWorkspace(t, db, "ws-1", "user-1", models.WorkspaceRoleEditor)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.SocialAccount{
		ID: "acc-1", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:viewer",
		IsActive: true, AccessTokenEnc: []byte("tok"), CreatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.GrowthSyncState{
		ID: "state-1", WorkspaceID: "ws-1", SocialAccountID: "acc-1", Platform: "bluesky",
		Status: models.GrowthSyncStatusOK, CurrentGenerationID: "gen-1", CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	for index := 1; index <= 5; index++ {
		_, err = db.NewInsert().Model(&models.GrowthRecommendation{
			ID: fmt.Sprintf("rec-%d", index), WorkspaceID: "ws-1", SocialAccountID: "acc-1",
			Platform: "bluesky", RemoteAccountID: fmt.Sprintf("remote-%d", index),
			Handle: fmt.Sprintf("person-%d", index), MutualCount: 4, Score: float64(6 - index),
			GenerationID: "gen-1", FollowState: models.GrowthRecommendationFollowIdle,
			LastSeenAt: now, CreatedAt: now, UpdatedAt: now,
		}).Exec(t.Context())
		require.NoError(t, err)
	}

	recorder := &telemetry.MemoryRecorder{}
	svc := NewService(db, staticTokenSource{}, recorder)
	actor := workspaceaccess.ActorFacts{UserID: "user-1"}
	require.NoError(t, svc.Dismiss(t.Context(), actor, "ws-1", "rec-4"))
	require.Len(t, recorder.Events, 1)
	require.Equal(t, "4-6", recorder.Events[0].Properties["rank_bucket"])
	require.Equal(t, "4-6", recorder.Events[0].Properties["mutual_count_bucket"])
	require.NotContains(t, recorder.Events[0].Properties, "ranking_position")
}

func TestJobPayloadValidation(t *testing.T) {
	_, err := decodeDiscoveryPayload(`{}`)
	require.Error(t, err)
	_, err = decodeFollowPayload(`{}`)
	require.Error(t, err)
}
