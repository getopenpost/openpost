package handlers

import (
	"context"

	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/accountfeatures"
	growthservice "github.com/openpost/backend/internal/services/growth"
	messagingservice "github.com/openpost/backend/internal/services/messaging"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// Fakes that record provider calls

type countingMessagingProvider struct {
	platform.Adapter
	fetchCount int32
	sendCount  int32
	support    platform.MessagingSupport
	fetched    platform.FetchMessagesResult
}

func (f *countingMessagingProvider) MessagingSupport() platform.MessagingSupport { return f.support }
func (f *countingMessagingProvider) FetchMessages(_ context.Context, _ string, _ platform.FetchMessagesRequest) (platform.FetchMessagesResult, error) {
	atomic.AddInt32(&f.fetchCount, 1)
	return f.fetched, nil
}
func (f *countingMessagingProvider) SendMessage(_ context.Context, _ string, _ platform.SendMessageRequest) (platform.SendMessageResult, error) {
	atomic.AddInt32(&f.sendCount, 1)
	return platform.SendMessageResult{RemoteMessageID: "mid-1"}, nil
}
func (f *countingMessagingProvider) FetchCount() int { return int(atomic.LoadInt32(&f.fetchCount)) }
func (f *countingMessagingProvider) SendCount() int  { return int(atomic.LoadInt32(&f.sendCount)) }

type countingGrowthProvider struct {
	platform.Adapter
	discoverCount int32
	followCount   int32
}

func (f *countingGrowthProvider) DiscoverGrowthCandidates(_ context.Context, _ platform.GrowthDiscoveryInput) ([]platform.GrowthCandidate, error) {
	atomic.AddInt32(&f.discoverCount, 1)
	return []platform.GrowthCandidate{{RemoteID: "remote-1", Handle: "handle1"}}, nil
}
func (f *countingGrowthProvider) FollowGrowthCandidate(_ context.Context, _, _, _ string) (platform.GrowthFollowResult, error) {
	atomic.AddInt32(&f.followCount, 1)
	return platform.GrowthFollowResult{ProviderState: "following", ProviderReference: "following:remote-1"}, nil
}

func newFeatureEnforcementDB(t *testing.T) *bun.DB {
	t.Helper()
	return testdb.NewSQLite(t)
}

func seedFeatureUserWorkspace(t *testing.T, db *bun.DB) {
	t.Helper()
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{ID: "user-1", Email: "user@example.com", CreatedAt: time.Now().UTC()}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Organization{ID: "org-1", Name: "Org"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", OrganizationID: "org-1", Name: "WS"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleEditor, Status: models.WorkspaceMemberStatusActive, CreatedAt: time.Now().UTC()}).Exec(ctx)
	require.NoError(t, err)
}

func TestFeatureGateGrowEnforcement(t *testing.T) {
	t.Parallel()
	db := newFeatureEnforcementDB(t)
	seedFeatureUserWorkspace(t, db)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-grow", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:viewer", Slug: "acc-grow", AccessTokenEnc: []byte("tok"), IsActive: true, CreatedAt: time.Now().UTC()}).Exec(ctx)
	require.NoError(t, err)

	growFake := &countingGrowthProvider{}
	af := accountfeatures.NewService(db, map[string]platform.Adapter{"bluesky": growFake}, nil)
	growSvc := growthservice.NewService(db, staticTokenSourceFeature{}, nil)
	growSvc.SetProvider("bluesky", growFake)
	growSvc.SetFeatureGate(af)

	// Disabled: refresh should fail
	_, err = growSvc.QueueRefresh(ctx, workspaceAccessActor(), "ws-1", "acc-grow")
	require.Error(t, err)
	require.Contains(t, err.Error(), "grow is disabled")
	require.Equal(t, 0, int(atomic.LoadInt32(&growFake.discoverCount)))

	// Enable
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-grow", Feature: "grow", Enabled: true}})
	require.NoError(t, err)
	jobID, err := growSvc.QueueRefresh(ctx, workspaceAccessActor(), "ws-1", "acc-grow")
	require.NoError(t, err)
	require.NotEmpty(t, jobID)
	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", "growth_discovery").Scan(ctx))
	// Activation already queued one, second queue should dedupe via index so still 1
	require.Len(t, jobs, 1)

	// Enabled control: discovery must reach the provider, succeed, and persist the
	// discovered candidate, so the later no-provider negatives are meaningful.
	require.NoError(t, executeGrowthJob(t, db, growSvc, jobs[0].ID))
	require.Equal(t, 1, int(atomic.LoadInt32(&growFake.discoverCount)), "enabled discovery must reach the provider")
	var discovered models.GrowthRecommendation
	require.NoError(t, db.NewSelect().Model(&discovered).Where("social_account_id = ? AND remote_account_id = ?", "acc-grow", "remote-1").Scan(ctx))
	require.Equal(t, "handle1", discovered.Handle)

	// The feature fixture builds the base schema, which predates provider writes.
	_, err = db.NewCreateTable().Model((*models.ProviderWriteAttempt)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)

	// Enabled control: a queued follow reaches the provider exactly once.
	followJobID, err := growSvc.QueueFollow(ctx, workspaceAccessActor(), "ws-1", discovered.ID)
	require.NoError(t, err)
	followJobs, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", "growth_follow").Count(ctx)
	require.NoError(t, err)
	require.EqualValues(t, 1, followJobs)
	require.NoError(t, executeGrowthJob(t, db, growSvc, followJobID))
	require.Equal(t, 1, int(atomic.LoadInt32(&growFake.followCount)), "enabled follow must reach the provider")
	require.NoError(t, db.NewSelect().Model(&discovered).Where("id = ?", discovered.ID).Scan(ctx))
	require.Equal(t, models.GrowthRecommendationFollowFollowing, discovered.FollowState)

	// Disabled follow enqueue must still be rejected.
	_, err = db.NewUpdate().Model((*models.GrowthRecommendation)(nil)).Set("follow_state = ?", models.GrowthRecommendationFollowIdle).Set("follow_error_code = ?", "").Where("id = ?", discovered.ID).Exec(ctx)
	require.NoError(t, err)
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-grow", Feature: "grow", Enabled: false}})
	require.NoError(t, err)
	_, err = growSvc.QueueFollow(ctx, workspaceAccessActor(), "ws-1", discovered.ID)
	require.Error(t, err)
	require.Contains(t, err.Error(), "grow is disabled")

	// Queue another follow while enabled, then disable before it executes.
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-grow", Feature: "grow", Enabled: true}})
	require.NoError(t, err)
	pendingFollowID, err := growSvc.QueueFollow(ctx, workspaceAccessActor(), "ws-1", discovered.ID)
	require.NoError(t, err)
	require.NotEmpty(t, pendingFollowID)
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-grow", Feature: "grow", Enabled: false}})
	require.NoError(t, err)

	// Disabled before execution: the durable follow reaches the feature guard.
	err = executeGrowthJob(t, db, growSvc, pendingFollowID)
	require.Error(t, err)
	require.Contains(t, err.Error(), "Grow is disabled for this account.")
	require.Equal(t, 1, int(atomic.LoadInt32(&growFake.followCount)), "disabled follow must not contact the provider")
	require.NoError(t, db.NewSelect().Model(&discovered).Where("id = ?", discovered.ID).Scan(ctx))
	require.Equal(t, models.GrowthRecommendationFollowFailed, discovered.FollowState)
	require.Equal(t, "feature_disabled", discovered.FollowErrorCode)

	// Disabled discovery execution also reaches the gate, not an early rejection.
	err = executeGrowthJob(t, db, growSvc, jobs[0].ID)
	require.Error(t, err)
	require.Contains(t, err.Error(), "grow is disabled")
	require.Equal(t, 1, int(atomic.LoadInt32(&growFake.discoverCount)), "disabled discovery must not contact the provider")
	var growState models.GrowthSyncState
	require.NoError(t, db.NewSelect().Model(&growState).Where("social_account_id = ?", "acc-grow").Scan(ctx))
	require.Equal(t, "feature_disabled", growState.ErrorCode)
}

func TestFeatureGateUnknownMissingFailClosed(t *testing.T) {
	t.Parallel()
	db := newFeatureEnforcementDB(t)
	seedFeatureUserWorkspace(t, db)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-unk", WorkspaceID: "ws-1", Platform: "facebook", AccountID: "remote-unk", Slug: "acc-unk", AccessTokenEnc: []byte("tok"), CapabilityState: `{"messages_enabled":"true"}`, IsActive: true, CreatedAt: time.Now().UTC()}).Exec(ctx)
	require.NoError(t, err)
	msgFake := &countingMessagingProvider{support: platform.MessagingSupport{Enabled: true, CanSend: true, RequiresOptIn: true}}
	af := accountfeatures.NewService(db, map[string]platform.Adapter{"facebook": msgFake}, nil)
	msgSvc := messagingservice.NewService(db, staticTokenSourceFeature{}, nil)
	msgSvc.SetProvider("facebook", msgFake)
	msgSvc.SetFeatureGate(af)

	// No preference -> disabled
	queued, err := msgSvc.RefreshWorkspace(ctx, workspaceAccessActor(), "ws-1", true)
	require.NoError(t, err)
	require.Equal(t, 0, queued)

	_, err = db.NewInsert().Model(&models.Conversation{ID: "conv-unk", WorkspaceID: "ws-1", SocialAccountID: "acc-unk", Platform: "facebook", RemoteConversationID: "remote-conv-unk", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}).Exec(ctx)
	require.NoError(t, err)
	_, err = msgSvc.QueueMessage(ctx, workspaceAccessActor(), "conv-unk", "no preference")
	require.ErrorContains(t, err, "messaging is disabled")
	// Save unknown feature should be rejected by BatchSave (already tested) but check IsEffectiveEnabled for unknown returns false with typed error
	enabled, err := af.IsEffectiveEnabled(ctx, "acc-unk", "unknown_feature")
	require.Error(t, err)
	require.True(t, errors.Is(err, accountfeatures.ErrUnknownFeature))
	require.False(t, enabled)

	// Missing scope -> add required scope but not granted, then enabled but still ineffective
	providersWithScope := map[string]platform.Adapter{"facebook": &countingMessagingProvider{support: platform.MessagingSupport{Enabled: true, CanSend: true, RequiresOptIn: true, RequiredScopes: []string{"pages_messaging"}}}}
	af2 := accountfeatures.NewService(db, providersWithScope, nil)
	msgProvider := providersWithScope["facebook"].(*countingMessagingProvider)
	msgSvc2 := messagingservice.NewService(db, staticTokenSourceFeature{}, nil)
	msgSvc2.SetProvider("facebook", msgProvider)
	msgSvc2.SetFeatureGate(af2)
	_, err = af2.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-unk", Feature: "messaging", Enabled: true}})
	require.NoError(t, err)
	queued, err = msgSvc2.RefreshWorkspace(ctx, workspaceAccessActor(), "ws-1", true)
	require.NoError(t, err)
	require.Equal(t, 0, queued, "missing scope should fail closed even when stored enabled")
	// Queue while permission exists, then revoke it before the durable job executes.
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("granted_scopes = ?", "pages_messaging").Where("id = ?", "acc-unk").Exec(ctx)
	require.NoError(t, err)
	queued, err = msgSvc2.RefreshWorkspace(ctx, workspaceAccessActor(), "ws-1", true)
	require.NoError(t, err)
	require.Equal(t, 1, queued)
	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", messagingservice.JobTypeMessagesSync).Scan(ctx))
	require.NotEmpty(t, jobs)
	// Granted-scope control from the same due, unleased checkpoint must collect,
	// so the revoked-scope negative cannot pass on a cached backoff deadline.
	makeMessagingCollectionDue(t, db, "acc-unk")
	msgProvider.fetchCount = 0
	require.NoError(t, msgSvc2.HandleJob(ctx, messagingservice.JobTypeMessagesSync, jobs[0].Payload))
	require.Equal(t, 1, msgProvider.FetchCount(), "granted scope control must collect")
	// Revoke the scope, then execute a fresh sync from an identical due checkpoint.
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("granted_scopes = ?", "").Where("id = ?", "acc-unk").Exec(ctx)
	require.NoError(t, err)
	makeMessagingCollectionDue(t, db, "acc-unk")
	msgProvider.fetchCount = 0
	require.NoError(t, msgSvc2.HandleJob(ctx, messagingservice.JobTypeMessagesSync, jobs[0].Payload))
	require.Zero(t, msgProvider.FetchCount(), "revoked scope before execution must not contact provider")
	requireMessagingSyncState(t, db, "acc-unk", "disabled", "feature_disabled")
	_, err = msgSvc2.QueueMessage(ctx, workspaceAccessActor(), "conv-unk", "missing scope")
	require.ErrorContains(t, err, "messaging is disabled")
	require.Zero(t, msgProvider.SendCount())
}

func TestFeatureGateGrowNeverQueuesAutomaticFollow(t *testing.T) {
	t.Parallel()
	db := newFeatureEnforcementDB(t)
	seedFeatureUserWorkspace(t, db)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-grow-follow", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:follow", Slug: "acc-grow-follow", AccessTokenEnc: []byte("tok"), IsActive: true, CreatedAt: time.Now().UTC()}).Exec(ctx)
	require.NoError(t, err)
	growFake := &countingGrowthProvider{}
	af := accountfeatures.NewService(db, map[string]platform.Adapter{"bluesky": growFake}, nil)
	// Enable grow should queue discovery but not follow
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-grow-follow", Feature: "grow", Enabled: true}})
	require.NoError(t, err)
	var discoveryJobs []models.Job
	require.NoError(t, db.NewSelect().Model(&discoveryJobs).Where("type = ?", "growth_discovery").Scan(ctx))
	require.Len(t, discoveryJobs, 1)
	var followJobs []models.Job
	require.NoError(t, db.NewSelect().Model(&followJobs).Where("type = ?", "growth_follow").Scan(ctx))
	require.Len(t, followJobs, 0, "enabling grow must not queue automatic follow")

	// Also via service HandleJob discovery should not queue follow
	growSvc := growthservice.NewService(db, staticTokenSourceFeature{}, nil)
	growSvc.SetProvider("bluesky", growFake)
	growSvc.SetFeatureGate(af)
	// Discovery execution must succeed, reach the provider, and persist the
	// discovered candidate before the "never follows" assertions mean anything.
	require.NoError(t, executeGrowthJob(t, db, growSvc, discoveryJobs[0].ID))
	require.Equal(t, 1, int(atomic.LoadInt32(&growFake.discoverCount)), "discovery must reach the provider")
	var discovered models.GrowthRecommendation
	require.NoError(t, db.NewSelect().Model(&discovered).Where("social_account_id = ? AND remote_account_id = ?", "acc-grow-follow", "remote-1").Scan(ctx))
	require.Equal(t, "handle1", discovered.Handle)
	require.NoError(t, db.NewSelect().Model(&followJobs).Where("type = ?", "growth_follow").Scan(ctx))
	require.Len(t, followJobs, 0)
	require.Equal(t, 0, int(atomic.LoadInt32(&growFake.followCount)), "discovery must not trigger automatic follow")
}

type staticTokenSourceFeature struct{}

func (staticTokenSourceFeature) GetValidAccessToken(context.Context, string) (string, error) {
	return "tok", nil
}

func workspaceAccessActor() workspaceaccess.ActorFacts {
	return workspaceaccess.ActorFacts{UserID: "user-1"}
}

// makeMessagingCollectionDue clears the collection lease and stores a due,
// healthy sync state. The disabled-before-execution negatives must fail at the
// feature guard, not at a stale collection deadline.
func makeMessagingCollectionDue(t *testing.T, db *bun.DB, accountID string) {
	t.Helper()
	_, err := db.NewRaw(`UPDATE message_event_checkpoints SET lease_owner='', lease_until=NULL WHERE social_account_id=?`, accountID).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewRaw(`UPDATE messaging_sync_states SET status='ok', next_sync_at=? WHERE social_account_id=?`, time.Now().UTC().Add(-time.Minute), accountID).Exec(t.Context())
	require.NoError(t, err)
}

func requireMessagingSyncState(t *testing.T, db *bun.DB, accountID, status, errorCode string) {
	t.Helper()
	var state models.MessagingSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("social_account_id = ?", accountID).Scan(t.Context()))
	require.Equal(t, status, state.Status)
	require.Equal(t, errorCode, state.ErrorCode)
}

// executeGrowthJob runs a queued growth job the way the worker does: the job
// row carries a real lease generation and the execution context supplies it, so
// provider-write fences validate the durable lease instead of the legacy
// attempts/locked_at fallback.
func executeGrowthJob(t *testing.T, db *bun.DB, svc *growthservice.Service, jobID string) error {
	t.Helper()
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", jobID).Scan(t.Context()))
	job.Status = "processing"
	job.Attempts = 1
	job.LockedAt = time.Now().UTC()
	job.LeaseGeneration = 1
	_, err := db.NewUpdate().Model(&job).Column("status", "attempts", "locked_at", "lease_generation").WherePK().Exec(t.Context())
	require.NoError(t, err)
	return svc.HandleJob(
		providerwrite.WithJobExecution(t.Context(), job.ID, job.Attempts, job.LockedAt, job.LeaseGeneration),
		job.Type,
		job.Payload,
	)
}
