package reposts

import (
	"context"
	"database/sql"
	"encoding/json"
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
	db                *bun.DB
	executionID       string
	requests          []platform.RepostRequest
	unrepostRequests  []platform.UnrepostRequest
	unrepostErr       error
	secondWriteChecks func(models.RepostExecution, []StageHistoryEntry)
}

func (a *testRepostAdapter) Repost(_ context.Context, _, _ string, request platform.RepostRequest) (platform.RepostResult, error) {
	a.requests = append(a.requests, request)
	if len(a.requests) == 2 && a.secondWriteChecks != nil {
		var execution models.RepostExecution
		if err := a.db.NewSelect().Model(&execution).Where("id = ?", a.executionID).Scan(context.Background()); err != nil {
			panic(err)
		}
		var history []StageHistoryEntry
		if err := json.Unmarshal([]byte(execution.StageHistoryJSON), &history); err != nil {
			panic(err)
		}
		a.secondWriteChecks(execution, history)
	}
	id := fmt.Sprintf("repost-%d", len(a.requests))
	return platform.RepostResult{ExternalID: id, ExternalURL: "https://social.example/" + id}, nil
}

func (a *testRepostAdapter) Unrepost(_ context.Context, _, _ string, request platform.UnrepostRequest) error {
	a.unrepostRequests = append(a.unrepostRequests, request)
	return a.unrepostErr
}

func TestNormalizeRuleStagesAndRejectsOverflow(t *testing.T) {
	legacy := Rule{DelaySeconds: 3600, EvaluationWindowSeconds: 7200, ThresholdMode: ThresholdAll}
	normalized, err := NormalizeRule(legacy)
	require.NoError(t, err)
	require.Equal(t, []Stage{{DelaySeconds: 3600}}, normalized.Stages)

	legacyAtBoundary := Rule{DelaySeconds: 3600, EvaluationWindowSeconds: 3600, ThresholdMode: ThresholdAll}
	normalized, err = NormalizeRule(legacyAtBoundary)
	require.NoError(t, err)
	require.Equal(t, 3600, normalized.DelaySeconds)
	require.Equal(t, 4500, normalized.EvaluationWindowSeconds)
	require.Equal(t, []Stage{{DelaySeconds: 3600}}, normalized.Stages)

	legacyAtMaximum := Rule{
		DelaySeconds: maxDelaySeconds, EvaluationWindowSeconds: maxWindowSeconds,
		ThresholdMode: ThresholdAll,
	}
	normalized, err = NormalizeRule(legacyAtMaximum)
	require.NoError(t, err)
	require.Equal(t, maxDelaySeconds, normalized.DelaySeconds)
	require.Equal(t, maxWindowSeconds, normalized.EvaluationWindowSeconds)
	require.Equal(t, []Stage{{DelaySeconds: maxDelaySeconds}}, normalized.Stages)
	encoded, err := json.Marshal(normalized)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), `"stages"`)

	maximumBoundaryDB, maximumBoundaryService, maximumBoundaryAdapter, maximumBoundaryExecution := preparedRepostExecutionWithRule(
		t,
		Rule{
			DelaySeconds: maxDelaySeconds, EvaluationWindowSeconds: maxWindowSeconds,
			ThresholdMode: ThresholdAll, PlateauChecks: 2,
		},
		time.Now().UTC(),
	)
	require.NotNil(t, maximumBoundaryDB)
	require.NotNil(t, maximumBoundaryService)
	require.NotNil(t, maximumBoundaryAdapter)
	require.Equal(t, checkInterval, maximumBoundaryExecution.DeadlineAt.Sub(maximumBoundaryExecution.EligibleAfter))

	_, err = NormalizeRule(Rule{
		EvaluationWindowSeconds: maxWindowSeconds,
		ThresholdMode:           ThresholdAll,
		Stages:                  []Stage{{DelaySeconds: maxDelaySeconds}},
	})
	require.ErrorContains(t, err, "must end after its final stage")

	multi := Rule{
		EvaluationWindowSeconds: 86400,
		ThresholdMode:           ThresholdAll,
		Stages: []Stage{
			{DelaySeconds: 3600, UnrepostPrevious: true},
			{DelaySeconds: 7200, UnrepostPrevious: true},
		},
	}
	normalized, err = NormalizeRule(multi)
	require.NoError(t, err)
	require.False(t, normalized.Stages[0].UnrepostPrevious)
	require.True(t, normalized.Stages[1].UnrepostPrevious)
	require.Equal(t, 3600, normalized.DelaySeconds)

	_, err = NormalizeRule(Rule{
		EvaluationWindowSeconds: 86400,
		ThresholdMode:           ThresholdAll,
		Stages:                  []Stage{{DelaySeconds: 7200}, {DelaySeconds: 7200}},
	})
	require.ErrorContains(t, err, "strictly increase")

	_, err = NormalizeRule(Rule{
		EvaluationWindowSeconds: 7200,
		ThresholdMode:           ThresholdAll,
		Stages:                  []Stage{{DelaySeconds: 3600}, {DelaySeconds: 7200}},
	})
	require.ErrorContains(t, err, "after its final stage")

	_, err = NormalizeRule(Rule{
		DelaySeconds:            int(^uint(0) >> 1),
		EvaluationWindowSeconds: 900,
		ThresholdMode:           ThresholdAll,
	})
	require.ErrorContains(t, err, "between 0 and 30 days")
}

func TestEvaluateDoesNotRepostAfterDeadline(t *testing.T) {
	db, service, _, execution := preparedRepostExecution(t, []Stage{{DelaySeconds: 0}}, time.Now().UTC().Add(-10*time.Minute), 900)
	_, err := db.NewUpdate().Model((*models.RepostExecution)(nil)).
		Set("deadline_at = ?", time.Now().UTC().Add(-time.Minute)).
		Where("id = ?", execution.ID).Exec(t.Context())
	require.NoError(t, err)

	require.NoError(t, service.evaluate(t.Context(), execution.ID))
	require.NoError(t, db.NewSelect().Model(&execution).Where("id = ?", execution.ID).Scan(t.Context()))
	require.Equal(t, StatusSkipped, execution.Status)
	require.Equal(t, "evaluation_window_expired", execution.ErrorCode)

	count, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", JobTypeExecute).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestLegacySingleStageBoundaryRemainsUsable(t *testing.T) {
	publishedAt := time.Now().UTC().Add(-61 * time.Minute)
	db, service, adapter, execution := preparedRepostExecution(t, []Stage{{DelaySeconds: 0}}, publishedAt, 7200)
	legacyRule := Rule{
		DelaySeconds: 3600, EvaluationWindowSeconds: 3600,
		ThresholdMode: ThresholdAll, PlateauChecks: 2,
	}
	legacySnapshot, err := json.Marshal(ruleSnapshot{Rule: legacyRule})
	require.NoError(t, err)
	boundary := publishedAt.Add(time.Hour)
	_, err = db.NewUpdate().Model((*models.RepostExecution)(nil)).
		Set("rule_snapshot_json = ?", string(legacySnapshot)).
		Set("eligible_after = ?", boundary).
		Set("deadline_at = ?", boundary).
		Set("next_check_at = ?", boundary).
		Where("id = ?", execution.ID).Exec(t.Context())
	require.NoError(t, err)

	require.NoError(t, service.evaluate(t.Context(), execution.ID))
	require.NoError(t, service.execute(t.Context(), execution.ID))
	require.Len(t, adapter.requests, 1)
	require.NoError(t, db.NewSelect().Model(&execution).Where("id = ?", execution.ID).Scan(t.Context()))
	require.Equal(t, StatusSucceeded, execution.Status)

	now := time.Now().UTC()
	_, err = db.NewInsert().Model(&models.RepostPolicy{
		ID: "legacy-policy", WorkspaceID: "workspace-1", Name: "Legacy boundary",
		Enabled: true, DelaySeconds: 3600, EvaluationWindowSeconds: 3600,
		ThresholdMode: ThresholdAll, PlateauChecks: 2, StagesJSON: "[]",
		CreatedByID: "user-1", UpdatedByID: "user-1", CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	policies, err := service.listPolicies(t.Context(), "workspace-1")
	require.NoError(t, err)
	require.Len(t, policies, 1)
	require.Equal(t, 4500, policies[0].Rule.EvaluationWindowSeconds)
}

func TestMultiStageRepostPersistsUnrepostBeforeNextWrite(t *testing.T) {
	db, service, adapter, execution := preparedRepostExecution(t, []Stage{
		{DelaySeconds: 0},
		{DelaySeconds: 3600, UnrepostPrevious: true},
	}, time.Now().UTC().Add(-2*time.Hour), 86400)
	adapter.db = db
	adapter.executionID = execution.ID
	adapter.secondWriteChecks = func(current models.RepostExecution, history []StageHistoryEntry) {
		require.Empty(t, current.ExternalID)
		require.Len(t, history, 1)
		require.False(t, history[0].UnrepostedAt.IsZero())
	}

	require.NoError(t, service.evaluate(t.Context(), execution.ID))
	require.NoError(t, service.execute(t.Context(), execution.ID))
	require.NoError(t, service.evaluate(t.Context(), execution.ID))
	require.NoError(t, service.execute(t.Context(), execution.ID))

	require.NoError(t, db.NewSelect().Model(&execution).Where("id = ?", execution.ID).Scan(t.Context()))
	require.Equal(t, StatusSucceeded, execution.Status)
	require.Equal(t, 2, execution.CurrentStage)
	require.Equal(t, "repost-2", execution.ExternalID)
	require.Len(t, adapter.requests, 2)
	require.Len(t, adapter.unrepostRequests, 1)
	require.Equal(t, "repost-1", adapter.unrepostRequests[0].RepostExternalID)

	var history []StageHistoryEntry
	require.NoError(t, json.Unmarshal([]byte(execution.StageHistoryJSON), &history))
	require.Len(t, history, 2)
	require.False(t, history[0].UnrepostedAt.IsZero())
	require.True(t, history[1].UnrepostedAt.IsZero())
}

func TestUnrepostFailureClassificationAndDeadline(t *testing.T) {
	t.Run("transient failure is durably rescheduled", func(t *testing.T) {
		db, service, adapter, execution := preparedAtSecondStage(t)
		adapter.unrepostErr = &platform.HTTPError{StatusCode: 503}

		err := service.execute(t.Context(), execution.ID)
		retryAfter, continuation := IsExecutionContinuation(err)
		require.True(t, continuation)
		require.Positive(t, retryAfter)
		require.NoError(t, db.NewSelect().Model(&execution).Where("id = ?", execution.ID).Scan(t.Context()))
		require.Equal(t, StatusReady, execution.Status)
		require.Equal(t, 1, execution.UnrepostAttempts)
		require.True(t, execution.NextCheckAt.After(time.Now().UTC()))
		require.True(t, execution.NextCheckAt.Before(execution.DeadlineAt) || execution.NextCheckAt.Equal(execution.DeadlineAt))
		require.Len(t, adapter.requests, 1)
	})

	t.Run("permanent failure ends the cycle", func(t *testing.T) {
		db, service, adapter, execution := preparedAtSecondStage(t)
		adapter.unrepostErr = &platform.HTTPError{StatusCode: 400, Code: "InvalidRequest"}

		require.NoError(t, service.execute(t.Context(), execution.ID))
		require.NoError(t, db.NewSelect().Model(&execution).Where("id = ?", execution.ID).Scan(t.Context()))
		require.Equal(t, StatusFailed, execution.Status)
		require.Equal(t, "provider_unrepost_failed", execution.ErrorCode)
		require.Len(t, adapter.requests, 1)
	})

	t.Run("transient failure at deadline ends the cycle", func(t *testing.T) {
		db, service, adapter, execution := preparedAtSecondStage(t)
		adapter.unrepostErr = &platform.HTTPError{StatusCode: 503, RetryAfter: time.Hour}
		_, err := db.NewUpdate().Model((*models.RepostExecution)(nil)).
			Set("deadline_at = ?", time.Now().UTC().Add(time.Second)).
			Where("id = ?", execution.ID).Exec(t.Context())
		require.NoError(t, err)

		require.NoError(t, service.execute(t.Context(), execution.ID))
		require.NoError(t, db.NewSelect().Model(&execution).Where("id = ?", execution.ID).Scan(t.Context()))
		require.Equal(t, StatusFailed, execution.Status)
		require.Equal(t, "provider_unrepost_deadline", execution.ErrorCode)
	})
}

func TestStaleWorkerCannotOverwriteCompletedExecution(t *testing.T) {
	for _, test := range []struct {
		name string
		run  func(context.Context, *Service, *models.RepostExecution) error
	}{
		{
			name: "skip",
			run: func(ctx context.Context, service *Service, execution *models.RepostExecution) error {
				return service.finishExecution(ctx, execution, "late", "A stale worker tried to skip the execution.")
			},
		},
		{
			name: "fail",
			run: func(ctx context.Context, service *Service, execution *models.RepostExecution) error {
				return service.failExecution(ctx, execution, "late", "A stale worker tried to fail the execution.")
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			db, service, _, execution := preparedRepostExecution(t, []Stage{{DelaySeconds: 0}}, time.Now().UTC(), 3600)
			_, err := db.NewUpdate().Model((*models.RepostExecution)(nil)).
				Set("status = ?", StatusSucceeded).
				Where("id = ?", execution.ID).Exec(t.Context())
			require.NoError(t, err)

			require.NoError(t, test.run(t.Context(), service, &execution))
			require.NoError(t, db.NewSelect().Model(&execution).Where("id = ?", execution.ID).Scan(t.Context()))
			require.Equal(t, StatusSucceeded, execution.Status)
			require.Empty(t, execution.ErrorCode)
		})
	}
}

func preparedAtSecondStage(t *testing.T) (*bun.DB, *Service, *testRepostAdapter, models.RepostExecution) {
	t.Helper()
	db, service, adapter, execution := preparedRepostExecution(t, []Stage{
		{DelaySeconds: 0},
		{DelaySeconds: 3600, UnrepostPrevious: true},
	}, time.Now().UTC().Add(-2*time.Hour), 86400)
	require.NoError(t, service.evaluate(t.Context(), execution.ID))
	require.NoError(t, service.execute(t.Context(), execution.ID))
	require.NoError(t, service.evaluate(t.Context(), execution.ID))
	require.NoError(t, db.NewSelect().Model(&execution).Where("id = ?", execution.ID).Scan(t.Context()))
	require.Equal(t, StatusReady, execution.Status)
	return db, service, adapter, execution
}

func preparedRepostExecution(t *testing.T, stages []Stage, publishedAt time.Time, windowSeconds int) (*bun.DB, *Service, *testRepostAdapter, models.RepostExecution) {
	t.Helper()
	rule := Rule{EvaluationWindowSeconds: windowSeconds, ThresholdMode: ThresholdAll, PlateauChecks: 2, Stages: stages}
	if len(stages) > 0 {
		rule.DelaySeconds = stages[0].DelaySeconds
	}
	return preparedRepostExecutionWithRule(t, rule, publishedAt)
}

func preparedRepostExecutionWithRule(t *testing.T, rule Rule, publishedAt time.Time) (*bun.DB, *Service, *testRepostAdapter, models.RepostExecution) {
	t.Helper()
	db := repostTestDB(t)
	workspace := models.Workspace{ID: "workspace-1", OrganizationID: "organization-1", Name: "Launch"}
	user := models.User{ID: "user-1", Email: "user@example.com"}
	source := models.SocialAccount{ID: "source", WorkspaceID: workspace.ID, Slug: "source", Platform: "x", AccountID: "source-provider", AccountUsername: "source", AccessTokenEnc: []byte("token"), IsActive: true}
	target := models.SocialAccount{ID: "target", WorkspaceID: workspace.ID, Slug: "target", Platform: "x", AccountID: "target-provider", AccountUsername: "target", AccessTokenEnc: []byte("token"), IsActive: true}
	require.NoError(t, insertModels(t.Context(), db, &workspace, &user, &models.WorkspaceMember{WorkspaceID: workspace.ID, UserID: user.ID, Role: models.WorkspaceRoleAdmin}, &source, &target))

	overrideJSON, err := EncodeOverride(Override{
		Mode: ModeCustom, TargetAccountIDs: []string{target.ID},
		Rule: rule,
	})
	require.NoError(t, err)
	publication := models.Publication{
		ID: "publication-1", WorkspaceID: workspace.ID, CreatedByID: user.ID, Title: "Launch", Intent: models.PublishingIntentPost,
		ContentProfile: models.ContentProfileShortText, SourceText: "Launch", SourceContent: "Launch", Status: models.PublicationStatusPublished,
		RepostOverride: overrideJSON, ActualRunAt: publishedAt, CreatedAt: publishedAt, UpdatedAt: publishedAt,
	}
	rendition := models.Rendition{
		ID: "rendition-1", PublicationID: publication.ID, SocialAccountID: source.ID, Platform: "x", Profile: models.ContentProfileShortText,
		Status: models.RenditionStatusPublished, ExternalID: "post-1", ExternalURL: "https://x.com/source/status/post-1", CreatedAt: publishedAt, UpdatedAt: publishedAt,
	}
	state := models.AnalyticsSyncState{
		ID: "rendition:" + rendition.ID, WorkspaceID: workspace.ID, SubjectType: "rendition", SubjectID: rendition.ID,
		SocialAccountID: source.ID, Platform: "x", Status: string(platform.AnalyticsStatusOK), MetricsJSON: `{}`,
		LastSuccessAt: time.Now().UTC(), CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	require.NoError(t, insertModels(t.Context(), db, &publication, &rendition, &state))

	adapter := &testRepostAdapter{}
	service := NewService(db, testTokenSource{})
	service.SetProvider("x", adapter)
	require.NoError(t, service.ScheduleForRendition(t.Context(), rendition.ID))

	var execution models.RepostExecution
	require.NoError(t, db.NewSelect().Model(&execution).Where("rendition_id = ?", rendition.ID).Scan(t.Context()))
	return db, service, adapter, execution
}

func repostTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	for _, model := range []any{
		(*models.Organization)(nil), (*models.Workspace)(nil), (*models.User)(nil), (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil),
		(*models.Publication)(nil), (*models.Rendition)(nil), (*models.RepostPolicy)(nil), (*models.RepostPolicyAccount)(nil),
		(*models.RepostAccountGrant)(nil), (*models.RepostExecution)(nil), (*models.AnalyticsSyncState)(nil), (*models.UsageCounter)(nil),
		(*models.PublicationLifecycleEvent)(nil), (*models.Job)(nil), (*models.ProviderWriteAttempt)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
	require.NoError(t, insertModels(t.Context(), db, &models.Organization{ID: "organization-1", Name: "Reposts", CreatedByID: "user-1", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}))
	return db
}

func insertModels(ctx context.Context, db *bun.DB, values ...any) error {
	for _, value := range values {
		if _, err := db.NewInsert().Model(value).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}
