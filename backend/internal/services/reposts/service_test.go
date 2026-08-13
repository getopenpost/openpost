package reposts

import (
	"context"
	"database/sql"
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
	requests []platform.RepostRequest
}

func (a *testRepostAdapter) Repost(_ context.Context, _, _ string, request platform.RepostRequest) (platform.RepostResult, error) {
	a.requests = append(a.requests, request)
	return platform.RepostResult{ExternalID: "repost-1", ExternalURL: "https://social.example/repost-1"}, nil
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
	workspace := models.Workspace{ID: "workspace-1", Name: "Launch"}
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
	require.NoError(t, service.evaluate(ctx, execution.ID))
	require.NoError(t, service.execute(ctx, execution.ID))
	require.NoError(t, db.NewSelect().Model(&execution).Where("id = ?", execution.ID).Scan(ctx))
	require.Equal(t, StatusSucceeded, execution.Status)
	require.Equal(t, "repost-1", execution.ExternalID)
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

func TestCrossWorkspaceOverrideRequiresGrant(t *testing.T) {
	db := repostTestDB(t)
	ctx := context.Background()
	user := models.User{ID: "user-1", Email: "user@example.com"}
	sourceWorkspace := models.Workspace{ID: "source-workspace", Name: "Source"}
	targetWorkspace := models.Workspace{ID: "target-workspace", Name: "Target"}
	require.NoError(t, insertModels(ctx, db, &user, &sourceWorkspace, &targetWorkspace,
		&models.WorkspaceMember{WorkspaceID: sourceWorkspace.ID, UserID: user.ID, Role: models.WorkspaceRoleEditor}))
	target := models.SocialAccount{ID: "target", WorkspaceID: targetWorkspace.ID, Slug: "target", Platform: "x", AccountID: "target-provider", AccessTokenEnc: []byte("token"), IsActive: true}
	require.NoError(t, insertModels(ctx, db, &target))
	service := NewService(db, testTokenSource{})
	service.SetProvider("x", &testRepostAdapter{})
	_, err := service.ValidateOverride(ctx, sourceWorkspace.ID, user.ID, Override{
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
		(*models.Workspace)(nil), (*models.User)(nil), (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil),
		(*models.Publication)(nil), (*models.Rendition)(nil), (*models.RepostPolicy)(nil), (*models.RepostPolicyAccount)(nil),
		(*models.RepostAccountGrant)(nil), (*models.RepostExecution)(nil), (*models.AnalyticsSyncState)(nil),
		(*models.UsageCounter)(nil),
		(*models.PublicationLifecycleEvent)(nil), (*models.Job)(nil), (*models.ProviderWriteAttempt)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
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
