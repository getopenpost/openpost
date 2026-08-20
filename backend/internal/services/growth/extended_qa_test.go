package growth

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/stretchr/testify/require"
)

func TestMutualBucketUnifiedAcrossGoAndBrowser(t *testing.T) {
	t.Parallel()
	cases := map[int]string{
		0:  "0",
		1:  "1",
		2:  "2-3",
		3:  "2-3",
		4:  "4-6",
		6:  "4-6",
		7:  "7+",
		10: "7+",
		100: "7+",
	}
	for count, want := range cases {
		require.Equal(t, want, mutualCountBucket(count), "count %d", count)
	}
	// Ensure buckets exactly as spec
	require.Equal(t, "0", mutualCountBucket(0))
	require.Equal(t, "1", mutualCountBucket(1))
	require.Equal(t, "2-3", mutualCountBucket(2))
	require.Equal(t, "2-3", mutualCountBucket(3))
	require.Equal(t, "4-6", mutualCountBucket(4))
	require.Equal(t, "4-6", mutualCountBucket(6))
	require.Equal(t, "7+", mutualCountBucket(7))
}

func TestRankBucketUnified(t *testing.T) {
	t.Parallel()
	require.Equal(t, "1-3", rankBucket(1))
	require.Equal(t, "1-3", rankBucket(3))
	require.Equal(t, "4-6", rankBucket(4))
	require.Equal(t, "4-6", rankBucket(6))
	require.Equal(t, "7-10", rankBucket(7))
	require.Equal(t, "7-10", rankBucket(10))
	require.Equal(t, "11+", rankBucket(11))
	require.Equal(t, "11+", rankBucket(40))
}

func TestTelemetryDismissAndFollowUseTrueRankBucketAndNoSensitiveData(t *testing.T) {
	db := growthTestDB(t)
	seedGrowthWorkspace(t, db, "ws-1", "user-1", models.WorkspaceRoleEditor)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-1", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:viewer", IsActive: true, AccessTokenEnc: []byte("tok"), CreatedAt: now}).Exec(context.Background())
	require.NoError(t, err)

	// Create 5 ranked recommendations with distinct scores to have deterministic order
	// Use score descending, mutual_count descending etc.
	// We'll insert directly with scores to test rank calculation
	gen := "gen-1"
	_, err = db.NewInsert().Model(&models.GrowthSyncState{ID: uuid.NewString(), WorkspaceID: "ws-1", SocialAccountID: "acc-1", Platform: "bluesky", Status: models.GrowthSyncStatusOK, CurrentGenerationID: gen, CreatedAt: now, UpdatedAt: now}).Exec(context.Background())
	require.NoError(t, err)

	candidates := []models.GrowthRecommendation{
		{ID: "r1", WorkspaceID: "ws-1", SocialAccountID: "acc-1", Platform: "bluesky", RemoteAccountID: "remote-1", Handle: "alice", DisplayName: "Alice", Bio: "bio", Score: 90, MutualCount: 5, GenerationID: gen, FollowState: models.GrowthRecommendationFollowIdle, LastSeenAt: now, CreatedAt: now, UpdatedAt: now},
		{ID: "r2", WorkspaceID: "ws-1", SocialAccountID: "acc-1", Platform: "bluesky", RemoteAccountID: "remote-2", Handle: "bob", DisplayName: "Bob", Bio: "bio", Score: 80, MutualCount: 3, GenerationID: gen, FollowState: models.GrowthRecommendationFollowIdle, LastSeenAt: now, CreatedAt: now, UpdatedAt: now},
		{ID: "r3", WorkspaceID: "ws-1", SocialAccountID: "acc-1", Platform: "bluesky", RemoteAccountID: "remote-3", Handle: "carol", DisplayName: "Carol", Bio: "bio", Score: 70, MutualCount: 2, GenerationID: gen, FollowState: models.GrowthRecommendationFollowIdle, LastSeenAt: now, CreatedAt: now, UpdatedAt: now},
		{ID: "r4", WorkspaceID: "ws-1", SocialAccountID: "acc-1", Platform: "bluesky", RemoteAccountID: "remote-4", Handle: "dave", DisplayName: "Dave", Bio: "bio", Score: 60, MutualCount: 1, GenerationID: gen, FollowState: models.GrowthRecommendationFollowIdle, LastSeenAt: now, CreatedAt: now, UpdatedAt: now},
		{ID: "r5", WorkspaceID: "ws-1", SocialAccountID: "acc-1", Platform: "bluesky", RemoteAccountID: "remote-5", Handle: "eve", DisplayName: "Eve", Bio: "bio", Score: 50, MutualCount: 0, GenerationID: gen, FollowState: models.GrowthRecommendationFollowIdle, LastSeenAt: now, CreatedAt: now, UpdatedAt: now},
	}
	for i := range candidates {
		_, err = db.NewInsert().Model(&candidates[i]).Exec(context.Background())
		require.NoError(t, err)
	}

	mem := &telemetry.MemoryRecorder{}
	svc := NewService(db, staticTokenSource{}, mem)
	svc.SetProvider("bluesky", &fakeGrowthAdapter{})
	actor := workspaceaccess.ActorFacts{UserID: "user-1"}

	// Dismiss r3 which is rank 3 => bucket 1-3
	require.NoError(t, svc.Dismiss(context.Background(), actor, "ws-1", "r3"))
	require.Len(t, mem.Events, 1)
	ev := mem.Events[0]
	require.Equal(t, telemetry.EventGrowthRecommendationDismissed, ev.Name)
	require.Equal(t, "bluesky", ev.Properties["platform"])
	require.Equal(t, "2-3", ev.Properties["mutual_count_bucket"]) // r3 has mutual 2 => 2-3
	require.Equal(t, "1-3", ev.Properties["rank_bucket"])
	require.NotContains(t, ev.Properties, "ranking_position")
	require.NotContains(t, ev.Properties, "handle")
	require.NotContains(t, ev.Properties, "remote_account_id")
	require.NotContains(t, ev.Properties, "display_name")
	require.NotContains(t, ev.Properties, "bio")

	// Follow r4 which after dismiss of r3, r4 becomes rank 3 => bucket 1-3, mutual 1 => bucket 1
	mem.Events = nil
	jobID, err := svc.QueueFollow(context.Background(), actor, "ws-1", "r4")
	require.NoError(t, err)
	require.NotEmpty(t, jobID)
	require.Len(t, mem.Events, 1)
	ev = mem.Events[0]
	require.Equal(t, telemetry.EventGrowthFollowRequested, ev.Name)
	require.Equal(t, "1", ev.Properties["mutual_count_bucket"])
	require.Equal(t, "1-3", ev.Properties["rank_bucket"])
	require.NotContains(t, ev.Properties, "ranking_position")
	require.NotContains(t, ev.Properties, "handle")

	// Follow r5 which is now rank 4 => bucket 4-6
	mem.Events = nil
	_, err = svc.QueueFollow(context.Background(), actor, "ws-1", "r5")
	require.NoError(t, err)
	require.Len(t, mem.Events, 1)
	require.Equal(t, "4-6", mem.Events[0].Properties["rank_bucket"])
	require.Equal(t, "0", mem.Events[0].Properties["mutual_count_bucket"])
}

func TestConcurrentQueueRefreshFirstEverReturnsSameJobAndOneJob(t *testing.T) {
	db := growthTestDB(t)
	seedGrowthWorkspace(t, db, "ws-1", "user-1", models.WorkspaceRoleEditor)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-1", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:viewer", IsActive: true, AccessTokenEnc: []byte("tok"), CreatedAt: now}).Exec(context.Background())
	require.NoError(t, err)
	svc := NewService(db, staticTokenSource{}, nil)
	svc.SetProvider("bluesky", &fakeGrowthAdapter{})
	actor := workspaceaccess.ActorFacts{UserID: "user-1"}

	// Ensure no sync state exists
	count, err := db.NewSelect().Model((*models.GrowthSyncState)(nil)).Where("social_account_id = ?", "acc-1").Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 0, count)

	const goroutines = 10
	results := make([]string, goroutines)
	errs := make([]error, goroutines)
	var wg sync.WaitGroup
	start := make(chan struct{})
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			<-start
			id, err := svc.QueueRefresh(context.Background(), actor, "ws-1", "acc-1")
			results[idx] = id
			errs[idx] = err
		}(i)
	}
	close(start)
	wg.Wait()
	for i := 0; i < goroutines; i++ {
		require.NoError(t, errs[i])
		require.NotEmpty(t, results[i])
		require.Equal(t, results[0], results[i], "all callers should receive same job ID")
	}
	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", jobregistry.TypeGrowthDiscovery).Scan(context.Background()))
	require.Len(t, jobs, 1)
	require.Equal(t, results[0], jobs[0].ID)
	// Sync state should exist, queued, with no current generation preserved (empty) but status queued
	var state models.GrowthSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("social_account_id = ?", "acc-1").Scan(context.Background()))
	require.Equal(t, models.GrowthSyncStatusQueued, state.Status)

	// Second round concurrent when sync state already exists should also dedupe
	results2 := make([]string, goroutines)
	errs2 := make([]error, goroutines)
	wg.Add(goroutines)
	start2 := make(chan struct{})
	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			<-start2
			id, err := svc.QueueRefresh(context.Background(), actor, "ws-1", "acc-1")
			results2[idx] = id
			errs2[idx] = err
		}(i)
	}
	close(start2)
	wg.Wait()
	for i := 0; i < goroutines; i++ {
		require.NoError(t, errs2[i])
		require.Equal(t, results[0], results2[i])
	}
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", jobregistry.TypeGrowthDiscovery).Scan(context.Background()))
	require.Len(t, jobs, 1, "still one job after second concurrent round")
}

func TestDiscoveryPersistsAtMost40DeterministicallyOrderedAndAtomicGeneration(t *testing.T) {
	db := growthTestDB(t)
	seedGrowthWorkspace(t, db, "ws-1", "user-1", models.WorkspaceRoleEditor)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-1", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:viewer", IsActive: true, AccessTokenEnc: []byte("tok"), CreatedAt: now}).Exec(context.Background())
	require.NoError(t, err)

	// Generate 65 candidates with varying scores to test ordering and limit
	var cands []platform.GrowthCandidate
	for i := 0; i < 65; i++ {
		handle := fmt.Sprintf("user%02d", i)
		// Create deterministic but varied scores: mutualCount decreasing, etc.
		// Use handle to ensure stable tie breaker
		cands = append(cands, platform.GrowthCandidate{
			RemoteID: fmt.Sprintf("remote-%02d", i),
			Handle:   handle,
			DisplayName: "Name " + handle,
			Bio: "bio",
			AvatarURL: "https://cdn.test/a.jpg",
			ProfileURL: "https://bsky.app/profile/" + handle,
			FollowersCount: 100 - i,
			FollowingCount: 50,
			MutualCount: 65 - i, // decreasing
			Signals: []string{"friends_of_friends"},
		})
	}
	adapter := &fakeGrowthAdapter{
		discover: func(ctx context.Context, input platform.GrowthDiscoveryInput) ([]platform.GrowthCandidate, error) {
			require.Equal(t, 40, input.Limit, "should request 40")
			// Return 65 to test capping
			return cands, nil
		},
	}
	svc := NewService(db, staticTokenSource{}, nil)
	svc.SetProvider("bluesky", adapter)
	actor := workspaceaccess.ActorFacts{UserID: "user-1"}
	_, err = svc.QueueRefresh(context.Background(), actor, "ws-1", "acc-1")
	require.NoError(t, err)
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("type = ?", jobregistry.TypeGrowthDiscovery).Limit(1).Scan(context.Background()))
	require.NoError(t, svc.HandleJob(context.Background(), job.Type, job.Payload))

	// Verify at most 40 persisted for current generation
	var state models.GrowthSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("social_account_id = ?", "acc-1").Scan(context.Background()))
	require.NotEmpty(t, state.CurrentGenerationID)
	var rows []models.GrowthRecommendation
	require.NoError(t, db.NewSelect().Model(&rows).Where("social_account_id = ? AND generation_id = ?", "acc-1", state.CurrentGenerationID).Scan(context.Background()))
	require.LessOrEqual(t, len(rows), 40)
	require.Equal(t, 40, len(rows), "should persist exactly 40 when 65 provided")

	// Verify deterministic order: score DESC, mutual_count DESC, handle ASC, remote_account_id ASC
	// Since we used decreasing mutualCount, order should be increasing handle? Let's check ranking logic: top scores will be highest mutual.
	var ordered []models.GrowthRecommendation
	require.NoError(t, db.NewSelect().Model(&ordered).Where("social_account_id = ? AND generation_id = ?", "acc-1", state.CurrentGenerationID).Order("score DESC").Order("mutual_count DESC").Order("handle ASC").Order("remote_account_id ASC").Scan(context.Background()))
	// Check ordered is sorted correctly
	for i := 1; i < len(ordered); i++ {
		prev := ordered[i-1]
		cur := ordered[i]
		// Compare using same logic as ranking
		a := scoredCandidate{candidate: platform.GrowthCandidate{Handle: prev.Handle, RemoteID: prev.RemoteAccountID, MutualCount: prev.MutualCount}, score: prev.Score}
		b := scoredCandidate{candidate: platform.GrowthCandidate{Handle: cur.Handle, RemoteID: cur.RemoteAccountID, MutualCount: cur.MutualCount}, score: cur.Score}
		require.False(t, compareScored(b, a), "order should be stable sorted at %d: %s vs %s", i, prev.Handle, cur.Handle)
	}

	// Atomic generation query returns only current bounded set via List
	res, err := svc.List(context.Background(), actor, "ws-1", "acc-1")
	require.NoError(t, err)
	require.Len(t, res.Items, 40)
	require.Equal(t, state.CurrentGenerationID, res.SyncState.CurrentGenerationID)
	// Ensure List's items are exactly the ordered set
	for i, item := range res.Items {
		require.Equal(t, ordered[i].ID, item.ID)
	}

	// Second generation with different set should replace and List should return only new generation
	cands2 := make([]platform.GrowthCandidate, 0, 5)
	for i := 0; i < 5; i++ {
		cands2 = append(cands2, platform.GrowthCandidate{RemoteID: fmt.Sprintf("new-%d", i), Handle: fmt.Sprintf("newuser%02d", i), DisplayName: "New", Bio: "bio", AvatarURL: "https://cdn.test/a.jpg", ProfileURL: "https://bsky.app/profile/new", FollowersCount: 10, FollowingCount: 10, MutualCount: 1, Signals: []string{"suggestion"}})
	}
	adapter.discover = func(ctx context.Context, input platform.GrowthDiscoveryInput) ([]platform.GrowthCandidate, error) {
		return cands2, nil
	}
	_, err = svc.QueueRefresh(context.Background(), actor, "ws-1", "acc-1")
	require.NoError(t, err)
	var job2 models.Job
	require.NoError(t, db.NewSelect().Model(&job2).Where("type = ?", jobregistry.TypeGrowthDiscovery).Order("created_at DESC").Limit(1).Scan(context.Background()))
	// Need to find the queued job (the previous completed job still pending in DB? Actually we didn't mark completed, so need to handle that job)
	// Our queue dedupes; after first generation, job still pending but we handled it directly. The second QueueRefresh will dedupe to same job ID, but we need a new job execution. Simplify: directly handle with new generation via HandleJob on latest payload
	require.NoError(t, svc.HandleJob(context.Background(), job2.Type, job2.Payload))
	var state2 models.GrowthSyncState
	require.NoError(t, db.NewSelect().Model(&state2).Where("social_account_id = ?", "acc-1").Scan(context.Background()))
	require.NotEqual(t, state.CurrentGenerationID, state2.CurrentGenerationID)
	res2, err := svc.List(context.Background(), actor, "ws-1", "acc-1")
	require.NoError(t, err)
	require.Len(t, res2.Items, 5)
	for _, it := range res2.Items {
		require.Equal(t, state2.CurrentGenerationID, it.GenerationID)
	}
	// Ensure old generation not returned
	for _, it := range res2.Items {
		require.NotEqual(t, "remote-00", it.RemoteAccountID)
	}
}
