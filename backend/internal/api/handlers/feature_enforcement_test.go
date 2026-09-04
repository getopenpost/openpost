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
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// Fakes that record provider calls

type countingMessagingProvider struct {
	platform.Adapter
	fetchCount int32
	sendCount  int32
	support    platform.MessagingSupport
}

func (f *countingMessagingProvider) MessagingSupport() platform.MessagingSupport { return f.support }
func (f *countingMessagingProvider) FetchMessages(_ context.Context, _ string, _ platform.FetchMessagesRequest) (platform.FetchMessagesResult, error) {
	atomic.AddInt32(&f.fetchCount, 1)
	return platform.FetchMessagesResult{}, nil
}
func (f *countingMessagingProvider) SendMessage(_ context.Context, _ string, _ platform.SendMessageRequest) (platform.SendMessageResult, error) {
	atomic.AddInt32(&f.sendCount, 1)
	return platform.SendMessageResult{RemoteMessageID: "mid-1"}, nil
}
func (f *countingMessagingProvider) FetchCount() int { return int(atomic.LoadInt32(&f.fetchCount)) }
func (f *countingMessagingProvider) SendCount() int  { return int(atomic.LoadInt32(&f.sendCount)) }

type countingEngagementProvider struct {
	platform.Adapter
	listCount   int32
	replyCount  int32
	hideCount   int32
	deleteCount int32
	likeCount   int32
	support     platform.EngagementSupport
}

func (f *countingEngagementProvider) EngagementSupport() platform.EngagementSupport { return f.support }
func (f *countingEngagementProvider) ListComments(_ context.Context, _, _, _ string) ([]platform.Comment, error) {
	atomic.AddInt32(&f.listCount, 1)
	return []platform.Comment{}, nil
}
func (f *countingEngagementProvider) ReplyToComment(_ context.Context, _, _, _, _ string) (string, error) {
	atomic.AddInt32(&f.replyCount, 1)
	return "reply-id", nil
}
func (f *countingEngagementProvider) HideComment(_ context.Context, _, _, _ string) error {
	atomic.AddInt32(&f.hideCount, 1)
	return nil
}
func (f *countingEngagementProvider) DeleteComment(_ context.Context, _, _, _ string) error {
	atomic.AddInt32(&f.deleteCount, 1)
	return nil
}
func (f *countingEngagementProvider) LikeComment(_ context.Context, _, _, _ string) error {
	atomic.AddInt32(&f.likeCount, 1)
	return nil
}
func (f *countingEngagementProvider) UnlikeComment(_ context.Context, _, _, _ string) error {
	atomic.AddInt32(&f.likeCount, 1)
	return nil
}

type countingAnalyticsProvider struct {
	platform.Adapter
	accountCount int32
	contentCount int32
	support      platform.AnalyticsSupport
}

func (f *countingAnalyticsProvider) AnalyticsSupport() platform.AnalyticsSupport { return f.support }
func (f *countingAnalyticsProvider) FetchAccountAnalytics(_ context.Context, _ string, _ platform.AccountAnalyticsRequest) (platform.AnalyticsValues, error) {
	atomic.AddInt32(&f.accountCount, 1)
	return platform.AnalyticsValues{platform.MetricFollowers: 10}, nil
}
func (f *countingAnalyticsProvider) FetchContentAnalytics(_ context.Context, _ string, _ platform.ContentAnalyticsRequest) (platform.AnalyticsValues, error) {
	atomic.AddInt32(&f.contentCount, 1)
	return platform.AnalyticsValues{platform.MetricLikes: 1}, nil
}

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
	return platform.GrowthFollowResult{ProviderState: "following"}, nil
}

func newFeatureEnforcementDB(t *testing.T) *bun.DB {
	t.Helper()
	db := createHandlerTestDB(t,
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.AccountFeature)(nil),
		(*models.User)(nil),
		(*models.Organization)(nil),
		(*models.Job)(nil),
		(*models.Conversation)(nil),
		(*models.DirectMessage)(nil),
		(*models.MessagingSyncState)(nil),
		(*models.EngagementItem)(nil),
		(*models.EngagementSyncState)(nil),
		(*models.XEngagementReadBudget)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.AnalyticsSyncState)(nil),
		(*models.AnalyticsAccountSnapshot)(nil),
		(*models.AnalyticsRenditionSnapshot)(nil),
		(*models.AccountContentDiscoveryState)(nil),
		(*models.GrowthRecommendation)(nil),
		(*models.GrowthSyncState)(nil),
		(*models.ProviderWriteAttempt)(nil),
	)
	// Ensure dedupe index for growth (and any future dedupe jobs) exists in test DB
	_, _ = db.ExecContext(context.Background(), `CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_dedupe_unique_idx ON jobs (type, scope_id, dedupe_key) WHERE status IN ('pending','processing') AND scope_id <> '' AND dedupe_key <> ''`)
	return db
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

func TestFeatureGateMessagingEnforcement(t *testing.T) {
	t.Parallel()
	db := newFeatureEnforcementDB(t)
	seedFeatureUserWorkspace(t, db)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-msg", WorkspaceID: "ws-1", Platform: "facebook", AccountID: "remote-msg", Slug: "acc-msg", AccessTokenEnc: []byte("tok"), GrantedScopes: "pages_messaging", IsActive: true, CreatedAt: time.Now().UTC()}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Conversation{ID: "conv-1", WorkspaceID: "ws-1", SocialAccountID: "acc-msg", Platform: "facebook", RemoteConversationID: "rem-conv-1", MessagingWindowExpiresAt: time.Now().UTC().Add(time.Hour), CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}).Exec(ctx)
	require.NoError(t, err)

	msgFake := &countingMessagingProvider{support: platform.MessagingSupport{Enabled: true, CanSend: true, RequiredScopes: []string{"pages_messaging"}}}
	providers := map[string]platform.Adapter{"facebook": msgFake}
	af := accountfeatures.NewService(db, providers, nil)
	msgSvc := messagingservice.NewService(db, staticTokenSourceFeature{}, nil)
	msgSvc.SetProvider("facebook", msgFake)
	msgSvc.SetFeatureGate(af)

	// Initially no preference -> fail closed: refresh should queue 0 and not call provider
	queued, err := msgSvc.RefreshWorkspace(ctx, workspaceAccessActor(), "ws-1", true)
	require.NoError(t, err)
	require.Equal(t, 0, queued, "disabled messaging should not queue sync")
	require.Equal(t, 0, msgFake.FetchCount(), "zero provider contact while disabled")
	// Sync job execution while disabled should also not call provider
	// Create a fake job payload and try handle it while disabled
	// First enable, queue job, then disable before execution
	saveBody := []accountfeatures.ChoiceInput{{AccountID: "acc-msg", Feature: "messaging", Enabled: true}}
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), saveBody)
	require.NoError(t, err)
	// Now refresh should queue (activation already queued one, this adds another)
	queued, err = msgSvc.RefreshWorkspace(ctx, workspaceAccessActor(), "ws-1", true)
	require.NoError(t, err)
	require.Equal(t, 1, queued)
	// Find job (at least one from activation + one from refresh)
	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", "messages_sync").Scan(ctx))
	require.GreaterOrEqual(t, len(jobs), 1)
	// Disable before execution
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-msg", Feature: "messaging", Enabled: false}})
	require.NoError(t, err)
	// Execute job while disabled -> should not call provider
	msgFake.fetchCount = 0
	err = msgSvc.HandleJob(ctx, "messages_sync", jobs[0].Payload)
	require.NoError(t, err)
	require.Equal(t, 0, msgFake.FetchCount(), "job queued while enabled then disabled before execution must not contact provider")

	// User send enqueue while disabled should fail
	_, err = msgSvc.QueueMessage(ctx, workspaceAccessActor(), "conv-1", "hello")
	require.Error(t, err)
	require.Contains(t, err.Error(), "messaging is disabled")

	// Re-enable and send should succeed and queue job
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-msg", Feature: "messaging", Enabled: true}})
	require.NoError(t, err)
	msg, err := msgSvc.QueueMessage(ctx, workspaceAccessActor(), "conv-1", "hello2")
	require.NoError(t, err)
	require.NotNil(t, msg)
	// Send job execution while enabled should call provider
	var sendJobs []models.Job
	require.NoError(t, db.NewSelect().Model(&sendJobs).Where("type = ?", "message_send").Scan(ctx))
	require.NotEmpty(t, sendJobs)
	msgFake.sendCount = 0
	err = msgSvc.HandleJob(ctx, "message_send", sendJobs[0].Payload)
	// May need token source to succeed; staticTokenSource returns token, so provider should be called
	require.NoError(t, err)
	require.Equal(t, 1, msgFake.SendCount(), "enabled send job should contact provider")
	// While disabled, send job should not contact
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-msg", Feature: "messaging", Enabled: false}})
	require.NoError(t, err)
	// Queue new message while disabled should fail (already tested) but test job execution gate: create a send job while enabled then disable
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-msg", Feature: "messaging", Enabled: true}})
	require.NoError(t, err)
	msg2, err := msgSvc.QueueMessage(ctx, workspaceAccessActor(), "conv-1", "hello3")
	require.NoError(t, err)
	require.NotNil(t, msg2)
	var sendJobs2 []models.Job
	require.NoError(t, db.NewSelect().Model(&sendJobs2).Where("type = ?", "message_send").Order("created_at DESC").Scan(ctx))
	require.NotEmpty(t, sendJobs2)
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-msg", Feature: "messaging", Enabled: false}})
	require.NoError(t, err)
	msgFake.sendCount = 0
	// Find the latest send job payload
	err = msgSvc.HandleJob(ctx, "message_send", sendJobs2[0].Payload)
	require.Error(t, err)
	require.Equal(t, 0, msgFake.SendCount(), "send job queued while enabled then disabled must not contact provider")
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
	// Disable before execution
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-grow", Feature: "grow", Enabled: false}})
	require.NoError(t, err)
	growFake.discoverCount = 0
	err = growSvc.HandleJob(ctx, "growth_discovery", jobs[0].Payload)
	require.Error(t, err)
	require.Equal(t, 0, int(atomic.LoadInt32(&growFake.discoverCount)))

	// Follow gate: need a recommendation
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-grow", Feature: "grow", Enabled: true}})
	require.NoError(t, err)
	// Create recommendation manually
	_, err = db.NewInsert().Model(&models.GrowthRecommendation{ID: "rec-1", WorkspaceID: "ws-1", SocialAccountID: "acc-grow", Platform: "bluesky", RemoteAccountID: "remote-1", Handle: "h1", GenerationID: "gen-1", FollowState: "idle", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(), LastSeenAt: time.Now().UTC()}).Exec(ctx)
	require.NoError(t, err)
	// Disable and try follow enqueue should fail
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-grow", Feature: "grow", Enabled: false}})
	require.NoError(t, err)
	_, err = growSvc.QueueFollow(ctx, workspaceAccessActor(), "ws-1", "rec-1")
	require.Error(t, err)
	require.Contains(t, err.Error(), "grow is disabled")
	// Enable and queue follow
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-grow", Feature: "grow", Enabled: true}})
	require.NoError(t, err)
	// Need to reset follow state to idle
	_, err = db.NewUpdate().Model((*models.GrowthRecommendation)(nil)).Set("follow_state = ?", "idle").Where("id = ?", "rec-1").Exec(ctx)
	require.NoError(t, err)
	jobID, err = growSvc.QueueFollow(ctx, workspaceAccessActor(), "ws-1", "rec-1")
	require.NoError(t, err)
	require.NotEmpty(t, jobID)
	var followJobs []models.Job
	require.NoError(t, db.NewSelect().Model(&followJobs).Where("type = ?", "growth_follow").Scan(ctx))
	require.NotEmpty(t, followJobs)
	// Disable before execution
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-grow", Feature: "grow", Enabled: false}})
	require.NoError(t, err)
	growFake.followCount = 0
	err = growSvc.HandleJob(ctx, "growth_follow", followJobs[0].Payload)
	require.Error(t, err)
	require.Equal(t, 0, int(atomic.LoadInt32(&growFake.followCount)))
}

func TestFeatureGateUnknownMissingFailClosed(t *testing.T) {
	t.Parallel()
	db := newFeatureEnforcementDB(t)
	seedFeatureUserWorkspace(t, db)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-unk", WorkspaceID: "ws-1", Platform: "facebook", AccountID: "remote-unk", Slug: "acc-unk", AccessTokenEnc: []byte("tok"), IsActive: true, CreatedAt: time.Now().UTC()}).Exec(ctx)
	require.NoError(t, err)
	msgFake := &countingMessagingProvider{support: platform.MessagingSupport{Enabled: true, CanSend: true}}
	af := accountfeatures.NewService(db, map[string]platform.Adapter{"facebook": msgFake}, nil)
	msgSvc := messagingservice.NewService(db, staticTokenSourceFeature{}, nil)
	msgSvc.SetProvider("facebook", msgFake)
	msgSvc.SetFeatureGate(af)

	// No preference -> disabled
	queued, err := msgSvc.RefreshWorkspace(ctx, workspaceAccessActor(), "ws-1", true)
	require.NoError(t, err)
	require.Equal(t, 0, queued)

	// Save unknown feature should be rejected by BatchSave (already tested) but check IsEffectiveEnabled for unknown returns false with typed error
	enabled, err := af.IsEffectiveEnabled(ctx, "acc-unk", "unknown_feature")
	require.Error(t, err)
	require.True(t, errors.Is(err, accountfeatures.ErrUnknownFeature))
	require.False(t, enabled)

	// Missing scope -> add required scope but not granted, then enabled but still ineffective
	providersWithScope := map[string]platform.Adapter{"facebook": &countingMessagingProvider{support: platform.MessagingSupport{Enabled: true, CanSend: true, RequiredScopes: []string{"pages_messaging"}}}}
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
}

func TestFeatureGateEnabledTransitionQueuesInitialWorkAndNoDuplicate(t *testing.T) {
	t.Parallel()
	db := newFeatureEnforcementDB(t)
	seedFeatureUserWorkspace(t, db)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-trans", WorkspaceID: "ws-1", Platform: "facebook", AccountID: "remote-trans", Slug: "acc-trans", AccessTokenEnc: []byte("tok"), GrantedScopes: "pages_messaging", IsActive: true, CreatedAt: time.Now().UTC()}).Exec(ctx)
	require.NoError(t, err)
	msgFake := &countingMessagingProvider{support: platform.MessagingSupport{Enabled: true, CanSend: true, RequiredScopes: []string{"pages_messaging"}}}
	af := accountfeatures.NewService(db, map[string]platform.Adapter{"facebook": msgFake}, nil)

	// Initially no job
	count, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", "messages_sync").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 0, count)

	// Enable should queue one messages_sync
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-trans", Feature: "messaging", Enabled: true}})
	require.NoError(t, err)
	count, err = db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", "messages_sync").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count, "enabling should queue initial durable refresh")

	// Repeated enabled writes should not duplicate
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-trans", Feature: "messaging", Enabled: true}})
	require.NoError(t, err)
	count, err = db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", "messages_sync").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count, "repeated enabled writes should not duplicate")

	// Test Grow as well (dedupe via scope/dedupe)
	_, err = db.NewInsert().Model(&models.SocialAccount{ID: "acc-grow2", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:2", Slug: "acc-grow2", AccessTokenEnc: []byte("tok"), IsActive: true, CreatedAt: time.Now().UTC()}).Exec(ctx)
	require.NoError(t, err)
	afGrow := accountfeatures.NewService(db, map[string]platform.Adapter{"bluesky": &countingGrowthProvider{}}, nil)
	_, err = afGrow.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-grow2", Feature: "grow", Enabled: true}})
	require.NoError(t, err)
	growCount, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", "growth_discovery").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, growCount)
	_, err = afGrow.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-grow2", Feature: "grow", Enabled: true}})
	require.NoError(t, err)
	growCount, err = db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", "growth_discovery").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, growCount)
}

func TestFeatureGateDisablingPreservesStoredData(t *testing.T) {
	t.Parallel()
	db := newFeatureEnforcementDB(t)
	seedFeatureUserWorkspace(t, db)
	ctx := context.Background()
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-pres", WorkspaceID: "ws-1", Platform: "facebook", AccountID: "remote-pres", Slug: "acc-pres", AccessTokenEnc: []byte("tok"), IsActive: true, CreatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	// Seed stored data
	_, err = db.NewInsert().Model(&models.Conversation{ID: "conv-pres", WorkspaceID: "ws-1", SocialAccountID: "acc-pres", Platform: "facebook", RemoteConversationID: "rem-pres", CreatedAt: now, UpdatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.DirectMessage{ID: "msg-pres", WorkspaceID: "ws-1", ConversationID: "conv-pres", Body: "hello", CreatedAt: now, UpdatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.EngagementItem{ID: "eng-pres", WorkspaceID: "ws-1", RenditionID: "rend-pres", SocialAccountID: "acc-pres", Platform: "facebook", RemoteID: "rem-eng", Body: "hi", CreatedAt: now, UpdatedAt: now, LastSeenAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.AnalyticsSyncState{ID: "account:acc-pres", WorkspaceID: "ws-1", SubjectType: "account", SubjectID: "acc-pres", SocialAccountID: "acc-pres", Platform: "facebook", Status: "ok", MetricsJSON: `{"followers":1}`, CreatedAt: now, UpdatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.GrowthRecommendation{ID: "grow-pres", WorkspaceID: "ws-1", SocialAccountID: "acc-pres", Platform: "bluesky", RemoteAccountID: "remote-grow", Handle: "h", GenerationID: "gen-pres", FollowState: "idle", CreatedAt: now, UpdatedAt: now, LastSeenAt: now}).Exec(ctx)
	require.NoError(t, err)

	msgFake := &countingMessagingProvider{support: platform.MessagingSupport{Enabled: true}}
	af := accountfeatures.NewService(db, map[string]platform.Adapter{"facebook": msgFake, "bluesky": &countingGrowthProvider{}}, nil)
	// Enable then disable
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-pres", Feature: "messaging", Enabled: true}, {AccountID: "acc-pres", Feature: "engagement", Enabled: true}, {AccountID: "acc-pres", Feature: "analytics", Enabled: true}, {AccountID: "acc-pres", Feature: "grow", Enabled: true}})
	require.NoError(t, err)
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-pres", Feature: "messaging", Enabled: false}, {AccountID: "acc-pres", Feature: "engagement", Enabled: false}, {AccountID: "acc-pres", Feature: "analytics", Enabled: false}, {AccountID: "acc-pres", Feature: "grow", Enabled: false}})
	require.NoError(t, err)

	// Verify data still exists
	var convCount, msgCount, engCount, anaCount, growCount int
	convCount, err = db.NewSelect().Model((*models.Conversation)(nil)).Where("id = ?", "conv-pres").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, convCount)
	msgCount, err = db.NewSelect().Model((*models.DirectMessage)(nil)).Where("id = ?", "msg-pres").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, msgCount)
	engCount, err = db.NewSelect().Model((*models.EngagementItem)(nil)).Where("id = ?", "eng-pres").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, engCount)
	anaCount, err = db.NewSelect().Model((*models.AnalyticsSyncState)(nil)).Where("id = ?", "account:acc-pres").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, anaCount)
	growCount, err = db.NewSelect().Model((*models.GrowthRecommendation)(nil)).Where("id = ?", "grow-pres").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, growCount)

	// Reads of stored data remain allowed (service List)
	msgSvc := messagingservice.NewService(db, staticTokenSourceFeature{}, nil)
	msgSvc.SetFeatureGate(af)
	page, err := msgSvc.ListConversations(ctx, workspaceAccessActor(), messagingservice.ConversationQuery{WorkspaceID: "ws-1"})
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(page.Items), 1)
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
	// Discovery execution should not create follow jobs
	_ = growSvc.HandleJob(ctx, "growth_discovery", discoveryJobs[0].Payload)
	// May error due to missing sync state but should not create follow job
	require.NoError(t, db.NewSelect().Model(&followJobs).Where("type = ?", "growth_follow").Scan(ctx))
	require.Len(t, followJobs, 0)
	require.Equal(t, 0, int(atomic.LoadInt32(&growFake.followCount)), "discovery must not trigger automatic follow")
}

func TestFeatureGateStaleCallerCannotBypass(t *testing.T) {
	t.Parallel()
	db := newFeatureEnforcementDB(t)
	seedFeatureUserWorkspace(t, db)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-stale", WorkspaceID: "ws-1", Platform: "bluesky", AccountID: "did:plc:stale", Slug: "acc-stale", AccessTokenEnc: []byte("tok"), IsActive: true, CreatedAt: time.Now().UTC()}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.GrowthRecommendation{ID: "rec-stale", WorkspaceID: "ws-1", SocialAccountID: "acc-stale", Platform: "bluesky", RemoteAccountID: "remote-stale", Handle: "h", GenerationID: "gen-stale", FollowState: "idle", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(), LastSeenAt: time.Now().UTC()}).Exec(ctx)
	require.NoError(t, err)
	growFake := &countingGrowthProvider{}
	af := accountfeatures.NewService(db, map[string]platform.Adapter{"bluesky": growFake}, nil)
	growSvc := growthservice.NewService(db, staticTokenSourceFeature{}, nil)
	growSvc.SetProvider("bluesky", growFake)
	growSvc.SetFeatureGate(af)

	// Enable then queue follow
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-stale", Feature: "grow", Enabled: true}})
	require.NoError(t, err)
	_, err = growSvc.QueueFollow(ctx, workspaceAccessActor(), "ws-1", "rec-stale")
	require.NoError(t, err)
	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", "growth_follow").Scan(ctx))
	require.Len(t, jobs, 1)
	// Disable before job execution (stale page would have already queued)
	_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-stale", Feature: "grow", Enabled: false}})
	require.NoError(t, err)
	growFake.followCount = 0
	err = growSvc.HandleJob(ctx, "growth_follow", jobs[0].Payload)
	require.Error(t, err)
	require.Equal(t, 0, int(atomic.LoadInt32(&growFake.followCount)), "stale follow job must not bypass current disabled state")
}

type staticTokenSourceFeature struct{}

func (staticTokenSourceFeature) GetValidAccessToken(context.Context, string) (string, error) {
	return "tok", nil
}

func workspaceAccessActor() workspaceaccess.ActorFacts {
	return workspaceaccess.ActorFacts{UserID: "user-1"}
}
