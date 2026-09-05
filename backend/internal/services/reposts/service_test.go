package reposts

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type testTokenSource struct{}

func (testTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	return "token", nil
}

type testRepostAdapter struct {
	platform.Adapter
	requests         []platform.RepostRequest
	unrepostRequests []platform.UnrepostRequest
}

func (a *testRepostAdapter) Repost(_ context.Context, _, _ string, request platform.RepostRequest) (platform.RepostResult, error) {
	a.requests = append(a.requests, request)
	id := fmt.Sprintf("repost-%d", len(a.requests))
	return platform.RepostResult{ExternalID: id, ExternalURL: "https://social.example/" + id}, nil
}

func (a *testRepostAdapter) Unrepost(_ context.Context, _, _ string, request platform.UnrepostRequest) error {
	a.unrepostRequests = append(a.unrepostRequests, request)
	return nil
}

func TestNormalizeRuleMultiStageAndBackwardsCompatibility(t *testing.T) {
	// Legacy single-stage backwards compatibility
	legacy := Rule{DelaySeconds: 3600, EvaluationWindowSeconds: 7200, ThresholdMode: ThresholdAll, MinLikes: 10}
	normalized, err := NormalizeRule(legacy)
	require.NoError(t, err)
	require.Equal(t, 3600, normalized.DelaySeconds)
	require.Len(t, normalized.Stages, 1)
	require.Equal(t, 1, normalized.Stages[0].Stage)
	require.Equal(t, 3600, normalized.Stages[0].DelaySeconds)
	require.False(t, normalized.Stages[0].UnrepostPrevious)

	// Valid multi-stage rule
	multi := Rule{
		EvaluationWindowSeconds: 86400,
		Stages: []RepostStage{
			{DelaySeconds: 3600, UnrepostPrevious: true}, // UnrepostPrevious on stage 1 should be forced false
			{DelaySeconds: 7200, UnrepostPrevious: true},
			{DelaySeconds: 14400, UnrepostPrevious: false},
		},
	}
	normalizedMulti, err := NormalizeRule(multi)
	require.NoError(t, err)
	require.Equal(t, 3600, normalizedMulti.DelaySeconds)
	require.Len(t, normalizedMulti.Stages, 3)
	require.Equal(t, 1, normalizedMulti.Stages[0].Stage)
	require.False(t, normalizedMulti.Stages[0].UnrepostPrevious)
	require.Equal(t, 2, normalizedMulti.Stages[1].Stage)
	require.True(t, normalizedMulti.Stages[1].UnrepostPrevious)
	require.Equal(t, 3, normalizedMulti.Stages[2].Stage)
	require.False(t, normalizedMulti.Stages[2].UnrepostPrevious)

	// Non-increasing delays should fail
	invalidNonIncreasing := Rule{
		Stages: []RepostStage{
			{DelaySeconds: 7200},
			{DelaySeconds: 7200},
		},
	}
	_, err = NormalizeRule(invalidNonIncreasing)
	require.ErrorContains(t, err, "monotonically increasing")

	invalidDecreasing := Rule{
		Stages: []RepostStage{
			{DelaySeconds: 7200},
			{DelaySeconds: 3600},
		},
	}
	_, err = NormalizeRule(invalidDecreasing)
	require.ErrorContains(t, err, "monotonically increasing")

	// Window shorter than last stage delay should fail
	invalidWindow := Rule{
		EvaluationWindowSeconds: 5000,
		Stages: []RepostStage{
			{DelaySeconds: 3600},
			{DelaySeconds: 7200},
		},
	}
	_, err = NormalizeRule(invalidWindow)
	require.ErrorContains(t, err, "evaluation window cannot end before its delay")
}

func TestThresholdsTreatMissingMetricsAsUnknown(t *testing.T) {
	rule := DefaultRule()
	rule.MinLikes = 5
	rule.MinComments = 2
	rule.ThresholdMode = ThresholdAll
	require.False(t, thresholdsSatisfied(rule, platform.AnalyticsValues{platform.MetricLikes: 10}))
	require.True(t, thresholdsSatisfied(rule, platform.AnalyticsValues{platform.MetricLikes: 10, platform.MetricComments: 2}))

	rule.ThresholdMode = ThresholdAny
	require.True(t, thresholdsSatisfied(rule, platform.AnalyticsValues{platform.MetricLikes: 10}))
	require.False(t, thresholdsSatisfied(rule, platform.AnalyticsValues{platform.MetricViews: 100}))
}

func TestScheduleSweepIgnoresAnExistingPendingSweep(t *testing.T) {
	db := repostTestDB(t)
	ctx := context.Background()
	_, err := db.ExecContext(ctx, `CREATE UNIQUE INDEX repost_sweep_pending_unique_idx
		ON jobs (type) WHERE type = 'repost_sweep' AND status IN ('pending', 'processing')`)
	require.NoError(t, err)

	service := NewService(db, testTokenSource{})
	firstRun := time.Now().UTC().Truncate(time.Minute)
	require.NoError(t, service.ScheduleSweep(ctx, firstRun))
	require.NoError(t, service.ScheduleSweep(ctx, firstRun.Add(time.Minute)))

	count, err := db.NewSelect().Model((*models.Job)(nil)).
		Where("type = ? AND status = ?", JobTypeSweep, "pending").
		Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestCustomOverrideSchedulesEvaluatesAndExecutes(t *testing.T) {
	db := repostTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC().Add(-time.Minute)
	workspace := models.Workspace{ID: "workspace-1", OrganizationID: "organization-1", Name: "Launch"}
	user := models.User{ID: "user-1", Email: "user@example.com"}
	require.NoError(t, insertModels(ctx, db, &workspace, &user, &models.WorkspaceMember{WorkspaceID: workspace.ID, UserID: user.ID, Role: models.WorkspaceRoleAdmin}))
	source := models.SocialAccount{ID: "source", WorkspaceID: workspace.ID, Slug: "source", Platform: "x", AccountID: "source-provider", AccountUsername: "source", AccessTokenEnc: []byte("token"), IsActive: true}
	target := models.SocialAccount{ID: "target", WorkspaceID: workspace.ID, Slug: "target", Platform: "x", AccountID: "target-provider", AccountUsername: "target", AccessTokenEnc: []byte("token"), IsActive: true}
	require.NoError(t, insertModels(ctx, db, &source, &target))
	overrideJSON, err := EncodeOverride(Override{
		Mode: ModeCustom, TargetAccountIDs: []string{target.ID},
		Rule: Rule{DelaySeconds: 0, EvaluationWindowSeconds: 900, ThresholdMode: ThresholdAll, MinLikes: 5, PlateauChecks: 2},
	})
	require.NoError(t, err)
	publication := models.Publication{
		ID: "publication-1", WorkspaceID: workspace.ID, CreatedByID: user.ID, Title: "Launch", Intent: models.PublishingIntentPost,
		ContentProfile: models.ContentProfileShortText, SourceText: "Launch", SourceContent: "Launch", Status: models.PublicationStatusPublished,
		RepostOverride: overrideJSON, ActualRunAt: now, CreatedAt: now, UpdatedAt: now,
	}
	rendition := models.Rendition{
		ID: "rendition-1", PublicationID: publication.ID, SocialAccountID: source.ID, Platform: "x", Profile: models.ContentProfileShortText,
		Status: models.RenditionStatusPublished, ExternalID: "post-1", ExternalURL: "https://x.com/source/status/post-1", CreatedAt: now, UpdatedAt: now,
	}
	require.NoError(t, insertModels(ctx, db, &publication, &rendition))
	state := models.AnalyticsSyncState{
		ID: "rendition:" + rendition.ID, WorkspaceID: workspace.ID, SubjectType: "rendition", SubjectID: rendition.ID,
		SocialAccountID: source.ID, Platform: "x", Status: string(platform.AnalyticsStatusOK), MetricsJSON: `{"likes":7}`,
		LastSuccessAt: time.Now().UTC(), CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	require.NoError(t, insertModels(ctx, db, &state))

	adapter := &testRepostAdapter{}
	service := NewService(db, testTokenSource{})
	service.SetProvider("x", adapter)
	require.NoError(t, service.ScheduleForRendition(ctx, rendition.ID))

	var execution models.RepostExecution
	require.NoError(t, db.NewSelect().Model(&execution).Where("rendition_id = ?", rendition.ID).Scan(ctx))
	require.Equal(t, StatusPending, execution.Status)
	require.Equal(t, 1, execution.CurrentStage)
	require.Equal(t, 1, execution.TotalStages)
	require.NoError(t, service.evaluate(ctx, execution.ID))
	require.NoError(t, service.execute(ctx, execution.ID))
	require.NoError(t, db.NewSelect().Model(&execution).Where("id = ?", execution.ID).Scan(ctx))
	require.Equal(t, StatusSucceeded, execution.Status)
	require.Equal(t, "repost-1", execution.ExternalID)
	require.Equal(t, "repost-1", execution.LastRepostExternalID)
	require.Len(t, adapter.requests, 1)
	require.Equal(t, "post-1", adapter.requests[0].ExternalID)
	_, err = db.NewUpdate().Model((*models.RepostExecution)(nil)).
		Set("status = ?", StatusReady).
		Set("external_id = ''").Set("external_url = ''").Set("completed_at = NULL").
		Where("id = ?", execution.ID).Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, service.execute(ctx, execution.ID))
	require.Len(t, adapter.requests, 1, "recovery after a local commit failure must reuse the accepted repost result")
	var usage models.UsageCounter
	require.NoError(t, db.NewSelect().Model(&usage).
		Where("workspace_id = ? AND metric = ?", workspace.ID, "provider_write_calls_monthly").
		Scan(ctx))
	require.Equal(t, int64(1), usage.Value)
}

func TestMultiStageRepostExecutionWithUnrepost(t *testing.T) {
	db := repostTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC().Add(-time.Hour)
	workspace := models.Workspace{ID: "workspace-1", OrganizationID: "organization-1", Name: "Launch"}
	user := models.User{ID: "user-1", Email: "user@example.com"}
	require.NoError(t, insertModels(ctx, db, &workspace, &user, &models.WorkspaceMember{WorkspaceID: workspace.ID, UserID: user.ID, Role: models.WorkspaceRoleAdmin}))
	source := models.SocialAccount{ID: "source", WorkspaceID: workspace.ID, Slug: "source", Platform: "x", AccountID: "source-provider", AccountUsername: "source", AccessTokenEnc: []byte("token"), IsActive: true}
	target := models.SocialAccount{ID: "target", WorkspaceID: workspace.ID, Slug: "target", Platform: "x", AccountID: "target-provider", AccountUsername: "target", AccessTokenEnc: []byte("token"), IsActive: true}
	require.NoError(t, insertModels(ctx, db, &source, &target))

	overrideJSON, err := EncodeOverride(Override{
		Mode: ModeCustom, TargetAccountIDs: []string{target.ID},
		Rule: Rule{
			EvaluationWindowSeconds: 86400,
			ThresholdMode:           ThresholdAll,
			MinLikes:                5,
			PlateauChecks:           2,
			Stages: []RepostStage{
				{DelaySeconds: 0, UnrepostPrevious: false},
				{DelaySeconds: 3600, UnrepostPrevious: true},
			},
		},
	})
	require.NoError(t, err)
	publication := models.Publication{
		ID: "publication-1", WorkspaceID: workspace.ID, CreatedByID: user.ID, Title: "MultiStage Launch", Intent: models.PublishingIntentPost,
		ContentProfile: models.ContentProfileShortText, SourceText: "Launch", SourceContent: "Launch", Status: models.PublicationStatusPublished,
		RepostOverride: overrideJSON, ActualRunAt: now, CreatedAt: now, UpdatedAt: now,
	}
	rendition := models.Rendition{
		ID: "rendition-1", PublicationID: publication.ID, SocialAccountID: source.ID, Platform: "x", Profile: models.ContentProfileShortText,
		Status: models.RenditionStatusPublished, ExternalID: "post-source-1", ExternalURL: "https://x.com/source/status/post-source-1", CreatedAt: now, UpdatedAt: now,
	}
	require.NoError(t, insertModels(ctx, db, &publication, &rendition))
	state := models.AnalyticsSyncState{
		ID: "rendition:" + rendition.ID, WorkspaceID: workspace.ID, SubjectType: "rendition", SubjectID: rendition.ID,
		SocialAccountID: source.ID, Platform: "x", Status: string(platform.AnalyticsStatusOK), MetricsJSON: `{"likes":10}`,
		LastSuccessAt: time.Now().UTC(), CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	require.NoError(t, insertModels(ctx, db, &state))

	adapter := &testRepostAdapter{}
	service := NewService(db, testTokenSource{})
	service.SetProvider("x", adapter)

	// Step 1: Schedule
	require.NoError(t, service.ScheduleForRendition(ctx, rendition.ID))

	var execution models.RepostExecution
	require.NoError(t, db.NewSelect().Model(&execution).Where("rendition_id = ?", rendition.ID).Scan(ctx))
	require.Equal(t, StatusPending, execution.Status)
	require.Equal(t, 1, execution.CurrentStage)
	require.Equal(t, 2, execution.TotalStages)

	// Step 2: Evaluate Stage 1 -> StatusReady
	require.NoError(t, service.evaluate(ctx, execution.ID))
	require.NoError(t, db.NewSelect().Model(&execution).Where("id = ?", execution.ID).Scan(ctx))
	require.Equal(t, StatusReady, execution.Status)

	// Step 3: Execute Stage 1
	require.NoError(t, service.execute(ctx, execution.ID))
	require.NoError(t, db.NewSelect().Model(&execution).Where("id = ?", execution.ID).Scan(ctx))
	// After stage 1, execution advances to stage 2 and returns to pending status
	require.Equal(t, StatusPending, execution.Status)
	require.Equal(t, 2, execution.CurrentStage)
	require.Equal(t, "repost-1", execution.LastRepostExternalID)
	require.Len(t, adapter.requests, 1)
	require.Len(t, adapter.unrepostRequests, 0, "stage 1 should not un-repost")

	// Step 4: Evaluate Stage 2 -> StatusReady
	require.NoError(t, service.evaluate(ctx, execution.ID))
	require.NoError(t, db.NewSelect().Model(&execution).Where("id = ?", execution.ID).Scan(ctx))
	require.Equal(t, StatusReady, execution.Status)

	// Step 5: Execute Stage 2 (UnrepostPrevious: true)
	require.NoError(t, service.execute(ctx, execution.ID))
	require.NoError(t, db.NewSelect().Model(&execution).Where("id = ?", execution.ID).Scan(ctx))
	require.Equal(t, StatusSucceeded, execution.Status)
	require.Equal(t, 2, execution.CurrentStage)
	require.Equal(t, "repost-2", execution.LastRepostExternalID)
	require.Equal(t, "repost-2", execution.ExternalID)
	require.False(t, execution.CompletedAt.IsZero())

	// Verify adapter received unrepost request for stage 1's repost ID
	require.Len(t, adapter.unrepostRequests, 1)
	require.Equal(t, "repost-1", adapter.unrepostRequests[0].RepostExternalID)
	require.Equal(t, "post-source-1", adapter.unrepostRequests[0].SourceExternalID)

	// Verify adapter received 2 total repost calls
	require.Len(t, adapter.requests, 2)

	// Verify stage history JSON
	require.NotEmpty(t, execution.StageHistoryJSON)
	require.Contains(t, execution.StageHistoryJSON, `"stage":1`)
	require.Contains(t, execution.StageHistoryJSON, `"stage":2`)
	require.Contains(t, execution.StageHistoryJSON, `"repost_external_id":"repost-1"`)
	require.Contains(t, execution.StageHistoryJSON, `"repost_external_id":"repost-2"`)

	var history []StageHistoryEntry
	require.NoError(t, json.Unmarshal([]byte(execution.StageHistoryJSON), &history))
	require.Len(t, history, 2)
	require.False(t, history[0].UnrepostedAt.IsZero(), "stage 1 history entry should have UnrepostedAt populated after stage 2 unrepost")
	require.True(t, history[1].UnrepostedAt.IsZero(), "stage 2 history entry should not have UnrepostedAt")
}

type errorUnrepostAdapter struct {
	platform.Adapter
	repostCount int
	unrepostErr error
}

func (a *errorUnrepostAdapter) Repost(_ context.Context, _, _ string, request platform.RepostRequest) (platform.RepostResult, error) {
	a.repostCount++
	id := fmt.Sprintf("repost-%d", a.repostCount)
	return platform.RepostResult{ExternalID: id, ExternalURL: "https://social.example/" + id}, nil
}

func (a *errorUnrepostAdapter) Unrepost(_ context.Context, _, _ string, _ platform.UnrepostRequest) error {
	if a.unrepostErr != nil {
		return a.unrepostErr
	}
	return nil
}

func TestMultiStageUnrepostTransientErrorBackoff(t *testing.T) {
	db := repostTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC().Add(-time.Hour)
	workspace := models.Workspace{ID: "workspace-1", OrganizationID: "organization-1", Name: "Launch"}
	user := models.User{ID: "user-1", Email: "user@example.com"}
	require.NoError(t, insertModels(ctx, db, &workspace, &user, &models.WorkspaceMember{WorkspaceID: workspace.ID, UserID: user.ID, Role: models.WorkspaceRoleAdmin}))
	source := models.SocialAccount{ID: "source", WorkspaceID: workspace.ID, Slug: "source", Platform: "x", AccountID: "source-provider", AccountUsername: "source", AccessTokenEnc: []byte("token"), IsActive: true}
	target := models.SocialAccount{ID: "target", WorkspaceID: workspace.ID, Slug: "target", Platform: "x", AccountID: "target-provider", AccountUsername: "target", AccessTokenEnc: []byte("token"), IsActive: true}
	require.NoError(t, insertModels(ctx, db, &source, &target))

	overrideJSON, err := EncodeOverride(Override{
		Mode: ModeCustom, TargetAccountIDs: []string{target.ID},
		Rule: Rule{
			EvaluationWindowSeconds: 86400,
			ThresholdMode:           ThresholdAll,
			MinLikes:                5,
			PlateauChecks:           2,
			Stages: []RepostStage{
				{DelaySeconds: 0, UnrepostPrevious: false},
				{DelaySeconds: 3600, UnrepostPrevious: true},
			},
		},
	})
	require.NoError(t, err)
	publication := models.Publication{
		ID: "publication-1", WorkspaceID: workspace.ID, CreatedByID: user.ID, Title: "MultiStage Backoff", Intent: models.PublishingIntentPost,
		ContentProfile: models.ContentProfileShortText, SourceText: "Launch", SourceContent: "Launch", Status: models.PublicationStatusPublished,
		RepostOverride: overrideJSON, ActualRunAt: now, CreatedAt: now, UpdatedAt: now,
	}
	rendition := models.Rendition{
		ID: "rendition-1", PublicationID: publication.ID, SocialAccountID: source.ID, Platform: "x", Profile: models.ContentProfileShortText,
		Status: models.RenditionStatusPublished, ExternalID: "post-source-1", ExternalURL: "https://x.com/source/status/post-source-1", CreatedAt: now, UpdatedAt: now,
	}
	require.NoError(t, insertModels(ctx, db, &publication, &rendition))
	state := models.AnalyticsSyncState{
		ID: "rendition:" + rendition.ID, WorkspaceID: workspace.ID, SubjectType: "rendition", SubjectID: rendition.ID,
		SocialAccountID: source.ID, Platform: "x", Status: string(platform.AnalyticsStatusOK), MetricsJSON: `{"likes":10}`,
		LastSuccessAt: time.Now().UTC(), CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	require.NoError(t, insertModels(ctx, db, &state))

	adapter := &errorUnrepostAdapter{}
	service := NewService(db, testTokenSource{})
	service.SetProvider("x", adapter)

	require.NoError(t, service.ScheduleForRendition(ctx, rendition.ID))
	var execution models.RepostExecution
	require.NoError(t, db.NewSelect().Model(&execution).Where("rendition_id = ?", rendition.ID).Scan(ctx))
	require.NoError(t, service.evaluate(ctx, execution.ID))
	require.NoError(t, service.execute(ctx, execution.ID))

	// Now Stage 2 is pending. Advance to Ready.
	require.NoError(t, service.evaluate(ctx, execution.ID))

	// Set unrepost failure (e.g. transient network error)
	adapter.unrepostErr = errors.New("temporary upstream network timeout")
	err = service.execute(ctx, execution.ID)
	require.Error(t, err)

	// Verify execution is rescheduled with pending status and ~5 min backoff, NOT permanently failed
	require.NoError(t, db.NewSelect().Model(&execution).Where("id = ?", execution.ID).Scan(ctx))
	require.Equal(t, StatusPending, execution.Status)
	require.Equal(t, StatusPending, execution.StageStatus)
	require.True(t, execution.NextCheckAt.After(time.Now().UTC().Add(4*time.Minute)))
}

func TestCrossWorkspaceOverrideRequiresGrant(t *testing.T) {
	db := repostTestDB(t)
	ctx := context.Background()
	user := models.User{ID: "user-1", Email: "user@example.com"}
	sourceWorkspace := models.Workspace{ID: "source-workspace", OrganizationID: "organization-1", Name: "Source"}
	targetWorkspace := models.Workspace{ID: "target-workspace", OrganizationID: "organization-1", Name: "Target"}
	require.NoError(t, insertModels(ctx, db, &user, &sourceWorkspace, &targetWorkspace,
		&models.WorkspaceMember{WorkspaceID: sourceWorkspace.ID, UserID: user.ID, Role: models.WorkspaceRoleEditor}))
	target := models.SocialAccount{ID: "target", WorkspaceID: targetWorkspace.ID, Slug: "target", Platform: "x", AccountID: "target-provider", AccessTokenEnc: []byte("token"), IsActive: true}
	require.NoError(t, insertModels(ctx, db, &target))
	service := NewService(db, testTokenSource{})
	service.SetProvider("x", &testRepostAdapter{})
	_, err := service.ValidateOverride(ctx, sourceWorkspace.ID, user.ID, RequestCredential{}, Override{
		Mode: ModeCustom, TargetAccountIDs: []string{target.ID}, Rule: Rule{EvaluationWindowSeconds: 900, ThresholdMode: ThresholdAll, PlateauChecks: 2},
	})
	require.ErrorContains(t, err, "requires a workspace grant")
}

func repostTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	for _, model := range []any{
		(*models.Organization)(nil), (*models.Workspace)(nil), (*models.User)(nil), (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil),
		(*models.Publication)(nil), (*models.Rendition)(nil), (*models.RepostPolicy)(nil), (*models.RepostPolicyAccount)(nil),
		(*models.RepostAccountGrant)(nil), (*models.RepostExecution)(nil), (*models.AnalyticsSyncState)(nil),
		(*models.UsageCounter)(nil),
		(*models.PublicationLifecycleEvent)(nil), (*models.Job)(nil), (*models.ProviderWriteAttempt)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.Organization{ID: "organization-1", Name: "Reposts", CreatedByID: "user-1", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}).Exec(ctx)
	require.NoError(t, err)
	return db
}

func insertModels(ctx context.Context, db *bun.DB, models ...any) error {
	for _, model := range models {
		if _, err := db.NewInsert().Model(model).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}
