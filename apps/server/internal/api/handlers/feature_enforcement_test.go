package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/accountfeatures"
	growthservice "github.com/openpost/backend/internal/services/growth"
	messagingservice "github.com/openpost/backend/internal/services/messaging"
	"github.com/openpost/backend/internal/services/providerwrite"
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
	db, err := database.InitDBWithDriver("sqlite", "file:"+t.Name()+"?mode=memory&cache=shared")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))
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
	for _, legacy := range []struct{ name, state string }{
		{name: "absent", state: "{}"},
		{name: "false", state: `{"messages_enabled":"false"}`},
	} {
		t.Run(legacy.name, func(t *testing.T) {
			db := newFeatureEnforcementDB(t)
			seedFeatureUserWorkspace(t, db)
			ctx := context.Background()
			_, err := db.NewInsert().Model(&models.SocialAccount{ID: "acc-msg", WorkspaceID: "ws-1", Platform: "facebook", AccountID: "remote-msg", Slug: "acc-msg", AccessTokenEnc: []byte("tok"), CapabilityState: legacy.state, GrantedScopes: "pages_messaging", IsActive: true, CreatedAt: time.Now().UTC()}).Exec(ctx)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.Conversation{ID: "conv-1", WorkspaceID: "ws-1", SocialAccountID: "acc-msg", Platform: "facebook", RemoteConversationID: "rem-conv-1", MessagingWindowExpiresAt: time.Now().UTC().Add(time.Hour), CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}).Exec(ctx)
			require.NoError(t, err)

			msgFake := &countingMessagingProvider{support: platform.MessagingSupport{Enabled: true, CanSend: true, RequiresOptIn: true, RequiredScopes: []string{"pages_messaging"}}}
			msgFake.fetched = platform.FetchMessagesResult{Conversations: []platform.ProviderConversation{{
				ID: "rem-conv-incoming", CounterpartRemoteID: "sender-1", CounterpartName: "Sender",
				LastMessagePreview: "Incoming message", LastRemoteMessageID: "incoming-1",
				ReplyWindowExpiresAt: time.Now().UTC().Add(time.Hour),
				Messages:             []platform.ProviderMessage{{ID: "incoming-1", Direction: "inbound", AuthorRemoteID: "sender-1", Body: "Incoming message", RemoteCreatedAt: time.Now().UTC()}},
			}}}
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
			// Save the canonical preference without writing a legacy opt-in.
			saveBody := []accountfeatures.ChoiceInput{{AccountID: "acc-msg", Feature: "messaging", Enabled: true}}
			_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), saveBody)
			require.NoError(t, err)
			var saved models.AccountFeature
			require.NoError(t, db.NewSelect().Model(&saved).Where("social_account_id = ? AND feature = ?", "acc-msg", accountfeatures.FeatureMessaging).Scan(ctx))
			require.True(t, saved.Enabled)
			require.Equal(t, "user_save", saved.Source)
			// Finish activation so the sweep must admit fresh durable work.
			_, err = db.NewUpdate().Model((*models.Job)(nil)).Set("status = ?", "completed").Where("type = ?", messagingservice.JobTypeMessagesSync).Exec(ctx)
			require.NoError(t, err)
			// The automatic sweep must queue fresh work, not rely on the activation job.
			beforeSweep, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", messagingservice.JobTypeMessagesSync).Count(ctx)
			require.NoError(t, err)
			require.NoError(t, msgSvc.HandleJob(ctx, messagingservice.JobTypeSweep, "{}"))
			var jobs []models.Job
			require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", messagingservice.JobTypeMessagesSync).Order("created_at DESC").Scan(ctx))
			require.Greater(t, len(jobs), beforeSweep, "automatic sweep must admit the canonical messaging preference")
			queued, err = msgSvc.RefreshWorkspace(ctx, workspaceAccessActor(), "ws-1", true)
			require.NoError(t, err)
			require.Zero(t, queued, "manual refresh reuses the pending sweep collection")
			// Consume the sweep's durable sync job and verify actual collected records.
			require.NoError(t, msgSvc.HandleJob(ctx, messagingservice.JobTypeMessagesSync, jobs[0].Payload))
			require.Equal(t, 1, msgFake.FetchCount())
			var incoming models.DirectMessage
			require.NoError(t, db.NewSelect().Model(&incoming).Where("remote_message_id = ?", "incoming-1").Scan(ctx))
			require.Equal(t, "Incoming message", incoming.Body)
			require.Equal(t, "inbound", incoming.Direction)
			require.Equal(t, "ws-1", incoming.WorkspaceID)
			var conversation models.Conversation
			require.NoError(t, db.NewSelect().Model(&conversation).Where("id = ?", incoming.ConversationID).Scan(ctx))
			require.Equal(t, "rem-conv-incoming", conversation.RemoteConversationID)
			require.Equal(t, "acc-msg", conversation.SocialAccountID)
			require.Equal(t, "ws-1", conversation.WorkspaceID)
			require.Equal(t, "sender-1", conversation.CounterpartRemoteID)
			var state models.MessagingSyncState
			require.NoError(t, db.NewSelect().Model(&state).Where("social_account_id = ?", "acc-msg").Scan(ctx))
			require.Equal(t, "ok", state.Status)
			require.False(t, state.LastSuccessAt.IsZero())
			// Canonical disable wins even when obsolete state says true.
			_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("capability_state_json = ?", `{"messages_enabled":"true"}`).Where("id = ?", "acc-msg").Exec(ctx)
			require.NoError(t, err)
			noGate := messagingservice.NewService(db, staticTokenSourceFeature{}, nil)
			noGate.SetProvider("facebook", msgFake)
			queued, err = noGate.RefreshWorkspace(ctx, workspaceAccessActor(), "ws-1", true)
			require.NoError(t, err)
			require.Zero(t, queued, "a missing canonical feature gate must remain fail closed")
			// The enabled control must collect from the same due, unleased checkpoint,
			// otherwise the disabled runs below could pass on a stored deadline alone.
			makeMessagingCollectionDue(t, db, "acc-msg")
			msgFake.fetchCount = 0
			require.NoError(t, msgSvc.HandleJob(ctx, messagingservice.JobTypeMessagesSync, `{"id":"acc-msg"}`))
			require.Equal(t, 1, msgFake.FetchCount(), "enabled control must collect from a due checkpoint")
			// A service without the canonical gate must reach the execution gate and
			// record the disabled reason instead of collecting.
			makeMessagingCollectionDue(t, db, "acc-msg")
			msgFake.fetchCount = 0
			require.NoError(t, noGate.HandleJob(ctx, messagingservice.JobTypeMessagesSync, `{"id":"acc-msg"}`))
			require.Zero(t, msgFake.FetchCount())
			requireMessagingSyncState(t, db, "acc-msg", "disabled", "feature_disabled")
			_, err = noGate.QueueMessage(ctx, workspaceAccessActor(), "conv-1", "missing feature gate")
			require.ErrorContains(t, err, "messaging is disabled")
			// Disable before execution
			_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-msg", Feature: "messaging", Enabled: false}})
			require.NoError(t, err)
			queued, err = msgSvc.RefreshWorkspace(ctx, workspaceAccessActor(), "ws-1", true)
			require.NoError(t, err)
			require.Zero(t, queued)
			// Execute a fresh sync from an identical due checkpoint while disabled.
			makeMessagingCollectionDue(t, db, "acc-msg")
			msgFake.fetchCount = 0
			require.NoError(t, msgSvc.HandleJob(ctx, messagingservice.JobTypeMessagesSync, `{"id":"acc-msg"}`))
			require.Zero(t, msgFake.FetchCount(), "job queued while enabled then disabled before execution must not contact provider")
			requireMessagingSyncState(t, db, "acc-msg", "disabled", "feature_disabled")

			// User send enqueue while disabled should fail
			_, err = msgSvc.QueueMessage(ctx, workspaceAccessActor(), "conv-1", "hello")
			require.Error(t, err)
			require.Contains(t, err.Error(), "messaging is disabled")

			_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("capability_state_json = ?", legacy.state).Where("id = ?", "acc-msg").Exec(ctx)
			require.NoError(t, err)
			// Re-enable and send should succeed and queue job
			_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-msg", Feature: "messaging", Enabled: true}})
			require.NoError(t, err)
			_, err = msgSvc.QueueMessage(ctx, workspaceaccess.ActorFacts{UserID: "unrelated-user"}, "conv-1", "unauthorized")
			require.ErrorIs(t, err, messagingservice.ErrAccessDenied)
			msg, err := msgSvc.QueueMessage(ctx, workspaceAccessActor(), "conv-1", "hello2")
			require.NoError(t, err)
			require.NotNil(t, msg)
			// Send job execution while enabled should call provider
			var sendJobs []models.Job
			require.NoError(t, db.NewSelect().Model(&sendJobs).Where("type = ?", "message_send").Scan(ctx))
			require.NotEmpty(t, sendJobs)
			msgFake.sendCount = 0
			err = msgSvc.HandleJob(ctx, "message_send", sendJobs[0].Payload)
			require.NoError(t, err)
			require.Equal(t, 1, msgFake.SendCount(), "enabled send job should contact provider")
			var sent models.DirectMessage
			require.NoError(t, db.NewSelect().Model(&sent).Where("id = ?", msg.ID).Scan(ctx))
			require.Equal(t, "sent", sent.SendStatus)
			require.Equal(t, "mid-1", sent.RemoteMessageID)
			// While disabled, send job should not contact
			_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-msg", Feature: "messaging", Enabled: false}})
			require.NoError(t, err)
			// Queue new message while disabled should fail (already tested) but test job execution gate: create a send job while enabled then disable
			_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-msg", Feature: "messaging", Enabled: true}})
			require.NoError(t, err)
			msg2, err := msgSvc.QueueMessage(ctx, workspaceAccessActor(), "conv-1", "hello3")
			require.NoError(t, err)
			require.NotNil(t, msg2)
			queuedPayload, err := json.Marshal(map[string]string{"id": msg2.ID})
			require.NoError(t, err)
			var sendJobs2 []models.Job
			require.NoError(t, db.NewSelect().Model(&sendJobs2).Where("type = ? AND payload = ?", messagingservice.JobTypeMessageSend, string(queuedPayload)).Scan(ctx))
			require.Len(t, sendJobs2, 1)
			_, err = af.BatchSave(ctx, "ws-1", workspaceAccessActor(), []accountfeatures.ChoiceInput{{AccountID: "acc-msg", Feature: "messaging", Enabled: false}})
			require.NoError(t, err)
			msgFake.sendCount = 0
			_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("capability_state_json = ?", `{"messages_enabled":"true"}`).Where("id = ?", "acc-msg").Exec(ctx)
			require.NoError(t, err)
			err = msgSvc.HandleJob(ctx, "message_send", sendJobs2[0].Payload)
			require.Error(t, err)
			require.Equal(t, 0, msgFake.SendCount(), "send job queued while enabled then disabled must not contact provider")
		})
	}
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
	require.Equal(t, 1, followJobs)
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
	_, err = db.NewInsert().Model(&models.DirectMessage{Direction: "inbound", SendStatus: "received", ID: "msg-pres", WorkspaceID: "ws-1", ConversationID: "conv-pres", Body: "hello", CreatedAt: now, UpdatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{ID: "post-pres", WorkspaceID: "ws-1", Status: models.PublicationStatusPublished}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{ID: "rend-pres", PublicationID: "post-pres", SocialAccountID: "acc-pres", Platform: "facebook", Status: models.RenditionStatusPublished}).Exec(ctx)
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
