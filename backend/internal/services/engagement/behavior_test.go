package engagement

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
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type staticTokenSource struct{}

func (staticTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	return "access-token", nil
}

type alwaysEnabledGate struct{}

func (alwaysEnabledGate) IsEffectiveEnabled(context.Context, string, string) (bool, error) {
	return true, nil
}

type fakeCommenter struct {
	platform.Adapter
	accountIDs             []string
	comments               []platform.Comment
	contentURL             string
	likedIDs               []string
	unlikedIDs             []string
	replyCalls             int
	replyID                string
	replyErr               error
	incrementalRequests    []platform.IncrementalCommentRequest
	incrementalExternalIDs []string
	incrementalPages       []platform.IncrementalCommentPage
	incrementalErrors      []error
}

func (*fakeCommenter) EngagementSupport() platform.EngagementSupport {
	return platform.EngagementSupport{Enabled: true, CanReply: true, CanDelete: true}
}

func (f *fakeCommenter) ListComments(_ context.Context, _ string, accountID, _ string) ([]platform.Comment, error) {
	f.accountIDs = append(f.accountIDs, accountID)
	return f.comments, nil
}

func (f *fakeCommenter) ListCommentPage(
	_ context.Context,
	_, accountID, externalID string,
	request platform.IncrementalCommentRequest,
) (platform.IncrementalCommentPage, error) {
	f.accountIDs = append(f.accountIDs, accountID)
	f.incrementalRequests = append(f.incrementalRequests, request)
	f.incrementalExternalIDs = append(f.incrementalExternalIDs, externalID)
	index := len(f.incrementalRequests) - 1
	if index < len(f.incrementalErrors) && f.incrementalErrors[index] != nil {
		return platform.IncrementalCommentPage{}, f.incrementalErrors[index]
	}
	if index < len(f.incrementalPages) {
		return f.incrementalPages[index], nil
	}
	return platform.IncrementalCommentPage{Comments: f.comments}, nil
}

func (f *fakeCommenter) ReplyToComment(context.Context, string, string, string, string) (string, error) {
	f.replyCalls++
	return f.replyID, f.replyErr
}

func (*fakeCommenter) HideComment(context.Context, string, string, string) error {
	return nil
}

func (*fakeCommenter) DeleteComment(context.Context, string, string, string) error {
	return nil
}

func (f *fakeCommenter) LikeComment(_ context.Context, _, _, commentID string) error {
	f.likedIDs = append(f.likedIDs, commentID)
	return nil
}

func (f *fakeCommenter) UnlikeComment(_ context.Context, _, _, commentID string) error {
	f.unlikedIDs = append(f.unlikedIDs, commentID)
	return nil
}

func (f *fakeCommenter) ResolveContentURL(context.Context, string, string, string) (string, error) {
	return f.contentURL, nil
}

func TestQueuedProviderCommentActionUsesAcceptedFenceAndIdempotentLifecycle(t *testing.T) {
	db := engagementBehaviorTestDB(t)
	seedProviderCommentAction(t, db)
	commenter := &fakeCommenter{replyID: "provider-reply-1"}
	service := NewService(db, staticTokenSource{}, nil)
	service.SetFeatureGate(alwaysEnabledGate{})
	service.SetProvider("x", commenter)

	jobID, err := QueueProviderCommentAction(t.Context(), db, alwaysEnabledGate{}, ProviderCommentActionInput{
		Actor:       Actor{UserID: "user-1"},
		WorkspaceID: "workspace-1", PublicationID: "publication-1",
		RenditionID: "rendition-1", SocialAccountID: "account-1",
		ProviderCommentID: "comment-1", Action: "reply",
		Message: "A private reply body",
	})
	require.NoError(t, err)
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", jobID).Scan(t.Context()))
	require.Equal(t, 1, job.MaxAttempts)
	ctx := providerwrite.WithJobExecution(t.Context(), job.ID, 1, time.Now().UTC())
	require.NoError(t, service.HandleJob(ctx, job.Type, job.Payload))

	// Simulate a crash after provider acceptance and the lifecycle write but
	// before the queue marks the job complete.
	require.NoError(t, service.HandleJob(ctx, job.Type, job.Payload))
	require.Equal(t, 1, commenter.replyCalls)
	var attempt models.ProviderWriteAttempt
	require.NoError(t, db.NewSelect().Model(&attempt).
		Where("operation_id = ?", "provider-comment:"+job.ID).Scan(t.Context()))
	require.Equal(t, providerwrite.StatusAccepted, attempt.Status)
	require.NotContains(t, attempt.PayloadFingerprint, "private reply")
	var events []models.PublicationLifecycleEvent
	require.NoError(t, db.NewSelect().Model(&events).
		Where("idempotency_key = ?", "provider-comment:"+job.ID+":succeeded").Scan(t.Context()))
	require.Len(t, events, 1)
}

func TestQueuedProviderCommentActionPreservesCredentialWorkspaceBoundary(t *testing.T) {
	db := engagementBehaviorTestDB(t)
	seedProviderCommentAction(t, db)

	_, err := QueueProviderCommentAction(t.Context(), db, alwaysEnabledGate{}, ProviderCommentActionInput{
		Actor:       Actor{UserID: "user-1", CredentialWorkspaceID: "another-workspace"},
		WorkspaceID: "workspace-1", PublicationID: "publication-1",
		RenditionID: "rendition-1", SocialAccountID: "account-1",
		ProviderCommentID: "comment-1", Action: "hide",
	})
	require.ErrorIs(t, err, ErrAccessDenied)
	count, countErr := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", JobTypeEngagementAct).Count(t.Context())
	require.NoError(t, countErr)
	require.Zero(t, count)
}

func TestQueuedProviderCommentActionNeverReplaysAmbiguousWrite(t *testing.T) {
	db := engagementBehaviorTestDB(t)
	seedProviderCommentAction(t, db)
	commenter := &fakeCommenter{replyErr: context.DeadlineExceeded}
	service := NewService(db, staticTokenSource{}, nil)
	service.SetFeatureGate(alwaysEnabledGate{})
	service.SetProvider("x", commenter)
	jobID, err := QueueProviderCommentAction(t.Context(), db, alwaysEnabledGate{}, ProviderCommentActionInput{
		Actor:       Actor{UserID: "user-1"},
		WorkspaceID: "workspace-1", PublicationID: "publication-1",
		RenditionID: "rendition-1", SocialAccountID: "account-1",
		ProviderCommentID: "comment-1", Action: "reply", Message: "Thanks",
	})
	require.NoError(t, err)
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", jobID).Scan(t.Context()))
	ctx := providerwrite.WithJobExecution(t.Context(), job.ID, 1, time.Now().UTC())
	require.Error(t, service.HandleJob(ctx, job.Type, job.Payload))
	require.Error(t, service.HandleJob(ctx, job.Type, job.Payload))
	require.Equal(t, 1, commenter.replyCalls)
	var attempt models.ProviderWriteAttempt
	require.NoError(t, db.NewSelect().Model(&attempt).
		Where("operation_id = ?", "provider-comment:"+job.ID).Scan(t.Context()))
	require.Equal(t, providerwrite.StatusAmbiguous, attempt.Status)
}

func seedProviderCommentAction(t *testing.T, db *bun.DB) {
	t.Helper()
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "x",
		AccountID: "x-account", Slug: "x-account", AccessTokenEnc: []byte("encrypted"),
		IsActive: true, CreatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		Title: "Launch", ContentProfile: models.ContentProfileShortText,
		SourceText: "Launch", SourceContent: "Launch", Status: models.PublicationStatusPublished,
		Revision: 1, CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: "account-1",
		Platform: "x", Profile: models.ContentProfileShortText, Body: "Launch",
		Status: models.RenditionStatusPublished, ExternalID: "external-1",
		CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
}

func engagementBehaviorTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	for _, model := range []any{
		(*models.Organization)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.PublicationLifecycleEvent)(nil),
		(*models.EngagementItem)(nil),
		(*models.XEngagementReadBudget)(nil),
		(*models.Job)(nil),
		(*models.ProviderWriteAttempt)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	now := time.Now().UTC()
	_, err = db.NewInsert().Model(&models.Organization{ID: "organization-1", Name: "Studio", CreatedByID: "user-1", CreatedAt: now, UpdatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.Workspace{
		{ID: "workspace-1", OrganizationID: "organization-1", Name: "Primary", CreatedAt: now},
		{ID: "workspace-2", OrganizationID: "organization-1", Name: "Secondary", CreatedAt: now},
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleEditor,
		Status: models.WorkspaceMemberStatusActive, CreatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
CREATE TABLE conversations (
	id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, social_account_id TEXT NOT NULL,
	platform TEXT NOT NULL, remote_conversation_id TEXT NOT NULL,
	counterpart_remote_id TEXT NOT NULL DEFAULT '', counterpart_name TEXT NOT NULL DEFAULT '',
	counterpart_handle TEXT NOT NULL DEFAULT '', counterpart_avatar_url TEXT NOT NULL DEFAULT '',
	last_message_at TIMESTAMP, last_message_preview TEXT NOT NULL DEFAULT '',
	last_remote_message_id TEXT NOT NULL DEFAULT '', unread_count INTEGER NOT NULL DEFAULT 0,
	read_at TIMESTAMP, archived_at TIMESTAMP, messaging_window_expires_at TIMESTAMP,
	created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NOT NULL,
	UNIQUE (social_account_id, remote_conversation_id)
);
CREATE TABLE direct_messages (
	id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
	remote_message_id TEXT NOT NULL DEFAULT '', direction TEXT NOT NULL,
	author_remote_id TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
	attachments_json TEXT NOT NULL DEFAULT '[]', send_status TEXT NOT NULL DEFAULT 'received',
	error_message TEXT NOT NULL DEFAULT '', remote_created_at TIMESTAMP,
	created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX direct_messages_remote_test_idx
	ON direct_messages (conversation_id, remote_message_id) WHERE remote_message_id <> '';
CREATE UNIQUE INDEX engagement_items_remote_test_idx
	ON engagement_items (social_account_id, remote_id);
CREATE TABLE engagement_sync_states (
	id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, rendition_id TEXT NOT NULL, social_account_id TEXT NOT NULL,
	platform TEXT NOT NULL, status TEXT NOT NULL, error_code TEXT NOT NULL DEFAULT '',
	error_message TEXT NOT NULL DEFAULT '', cursor TEXT NOT NULL DEFAULT '',
	backfill_complete BOOLEAN NOT NULL DEFAULT FALSE,
	last_attempted_at TIMESTAMP, last_success_at TIMESTAMP, next_sync_at TIMESTAMP,
	empty_streak INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NOT NULL
)`)
	require.NoError(t, err)
	return db
}

func TestScheduledXEngagementDoesNotRepeatFullConversationSearch(t *testing.T) {
	db := engagementBehaviorTestDB(t)
	seedProviderCommentAction(t, db)
	ctx := t.Context()
	now := time.Now().UTC().Truncate(time.Second)
	commenter := &fakeCommenter{comments: []platform.Comment{{ID: "reply-1", Text: "Hello"}}}
	service := NewService(db, staticTokenSource{}, nil)
	service.SetFeatureGate(alwaysEnabledGate{})
	service.SetProvider("x", commenter)
	service.now = func() time.Time { return now }

	runScheduledSync := func() {
		require.NoError(t, service.HandleJob(ctx, JobTypeSweep, `{}`))
		var jobs []models.Job
		require.NoError(t, db.NewSelect().Model(&jobs).
			Where("type = ?", JobTypeEngagementSync).
			Order("created_at ASC").Scan(ctx))
		require.NotEmpty(t, jobs)
		for _, job := range jobs {
			require.NoError(t, service.HandleJob(ctx, job.Type, job.Payload))
		}
		_, err := db.NewDelete().Model((*models.Job)(nil)).Where("type = ?", JobTypeEngagementSync).Exec(ctx)
		require.NoError(t, err)
	}

	runScheduledSync()
	now = now.Add(30 * time.Minute)
	runScheduledSync()

	require.Len(t, commenter.incrementalRequests, 2)
	require.Empty(t, commenter.incrementalRequests[0].SinceID)
	require.Equal(t, "reply-1", commenter.incrementalRequests[1].SinceID,
		"the second scheduled X run must use the committed high-water mark instead of repeating a full search")
}

func TestXIncrementalPagesCommitContinuationAndSurviveRetry(t *testing.T) {
	db := engagementBehaviorTestDB(t)
	seedProviderCommentAction(t, db)
	ctx := t.Context()
	now := time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC)
	commenter := &fakeCommenter{
		incrementalPages: []platform.IncrementalCommentPage{
			{Comments: []platform.Comment{{ID: "101", Text: "Newest"}}, NextToken: "page-2", HighestID: "101"},
			{},
			{Comments: []platform.Comment{{ID: "100", Text: "Older"}}, HighestID: "101"},
			{},
		},
		incrementalErrors: []error{nil, &platform.HTTPError{StatusCode: 503, Code: "temporarily_unavailable"}, nil, nil},
	}
	service := NewService(db, staticTokenSource{}, nil)
	service.SetFeatureGate(alwaysEnabledGate{})
	service.SetProvider("x", commenter)
	service.now = func() time.Time { return now }

	require.NoError(t, service.syncEngagement(ctx, "rendition-1"))
	var state models.EngagementSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("rendition_id = ?", "rendition-1").Scan(ctx))
	cursor := decodeXCommentCursor(&state)
	require.Empty(t, cursor.SinceID)
	require.Equal(t, "page-2", cursor.NextToken, "a committed page must not be reread after the next request fails")

	now = now.Add(30 * time.Minute)
	require.NoError(t, service.syncEngagement(ctx, "rendition-1"))
	require.Equal(t, "page-2", commenter.incrementalRequests[1].NextToken)
	require.NoError(t, db.NewSelect().Model(&state).Where("rendition_id = ?", "rendition-1").Scan(ctx))
	cursor = decodeXCommentCursor(&state)
	require.Equal(t, "page-2", cursor.NextToken, "a failed continuation request must leave the committed page cursor intact")

	now = now.Add(time.Hour)
	require.NoError(t, service.syncEngagement(ctx, "rendition-1"))
	require.Equal(t, "page-2", commenter.incrementalRequests[2].NextToken)
	require.Empty(t, commenter.incrementalRequests[2].SinceID)
	require.NoError(t, db.NewSelect().Model(&state).Where("rendition_id = ?", "rendition-1").Scan(ctx))
	cursor = decodeXCommentCursor(&state)
	require.Equal(t, "101", cursor.SinceID)
	require.Empty(t, cursor.NextToken)

	now = now.Add(30 * time.Minute)
	require.NoError(t, service.syncEngagement(ctx, "rendition-1"))
	require.Equal(t, "101", commenter.incrementalRequests[3].SinceID)
	count, err := db.NewSelect().Model((*models.EngagementItem)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 2, count, "retry and the next incremental run must neither skip nor duplicate replies")
}

func TestXAccountReadBudgetIsDurableFairAndSharedWithManualRefresh(t *testing.T) {
	db := engagementBehaviorTestDB(t)
	ctx := t.Context()
	now := time.Date(2026, 9, 7, 8, 0, 0, 0, time.UTC)
	seedEngagementRenditions(t, db, "x", 7, now)
	commenter := &fakeCommenter{}
	service := NewService(db, staticTokenSource{}, nil)
	service.SetFeatureGate(alwaysEnabledGate{})
	service.SetProvider("x", commenter)
	service.SetXDailyReadBudget(3)
	service.now = func() time.Time { return now }

	runQueuedEngagementSyncs(t, db, service, func() (int, error) {
		return service.refreshWorkspace(ctx, "workspace-1", false)
	})
	require.Equal(t, []string{"external-00", "external-01", "external-02"}, commenter.incrementalExternalIDs)
	var budget models.XEngagementReadBudget
	require.NoError(t, db.NewSelect().Model(&budget).Where("social_account_id = ?", "account-1").Scan(ctx))
	require.Equal(t, 3, budget.AttemptsUsed)

	queued, err := service.RefreshWorkspace(ctx, Actor{UserID: "user-1"}, "workspace-1", true)
	require.NoError(t, err)
	require.Zero(t, queued, "manual refresh must share the same exhausted account budget")
	require.Len(t, commenter.incrementalRequests, 3)

	now = now.Add(24 * time.Hour)
	runQueuedEngagementSyncs(t, db, service, func() (int, error) {
		return service.RefreshWorkspace(ctx, Actor{UserID: "user-1"}, "workspace-1", true)
	})
	require.Equal(t, []string{"external-03", "external-04", "external-05"}, commenter.incrementalExternalIDs[3:],
		"renditions deferred by the budget must be first on the next UTC day")
	require.NoError(t, db.NewSelect().Model(&budget).Where("social_account_id = ?", "account-1").Scan(ctx))
	require.Equal(t, 3, budget.AttemptsUsed)
}

func TestXProviderBackoffFencesSiblingRenditions(t *testing.T) {
	for _, test := range []struct {
		name        string
		providerErr *platform.HTTPError
		wantDelay   time.Duration
		wantCode    string
	}{
		{name: "Retry-After", providerErr: &platform.HTTPError{StatusCode: 429, Code: "rate_limit", RetryAfter: 2 * time.Hour}, wantDelay: 2 * time.Hour, wantCode: "rate_limit"},
		{name: "depleted credits", providerErr: &platform.HTTPError{StatusCode: 402, Code: "credits_depleted", RetryAfter: 24 * time.Hour}, wantDelay: 24 * time.Hour, wantCode: "credits_depleted"},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := engagementBehaviorTestDB(t)
			ctx := t.Context()
			now := time.Date(2026, 9, 8, 8, 0, 0, 0, time.UTC)
			seedEngagementRenditions(t, db, "x", 2, now)
			commenter := &fakeCommenter{incrementalErrors: []error{test.providerErr}}
			service := NewService(db, staticTokenSource{}, nil)
			service.SetFeatureGate(alwaysEnabledGate{})
			service.SetProvider("x", commenter)
			service.now = func() time.Time { return now }

			require.NoError(t, service.syncEngagement(ctx, "rendition-00"))
			require.NoError(t, service.syncEngagement(ctx, "rendition-01"))
			require.Len(t, commenter.incrementalRequests, 1, "stored account backoff must prevent sibling provider calls")
			var budget models.XEngagementReadBudget
			require.NoError(t, db.NewSelect().Model(&budget).Where("social_account_id = ?", "account-1").Scan(ctx))
			require.Equal(t, now.Add(test.wantDelay), budget.BlockedUntil)
			require.Equal(t, test.wantCode, budget.BlockCode)
			queued, err := service.RefreshWorkspace(ctx, Actor{UserID: "user-1"}, "workspace-1", true)
			require.NoError(t, err)
			require.Zero(t, queued, "manual refresh must not override stored provider backoff")
			require.Len(t, commenter.incrementalRequests, 1)
		})
	}
}

func TestNonXEngagementKeepsGenericProviderPathAndCadence(t *testing.T) {
	db := engagementBehaviorTestDB(t)
	ctx := t.Context()
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	seedEngagementRenditions(t, db, "mastodon", 1, now)
	commenter := &fakeCommenter{comments: []platform.Comment{{ID: "reply-1", Text: "Hello"}}}
	service := NewService(db, staticTokenSource{}, nil)
	service.SetFeatureGate(alwaysEnabledGate{})
	service.SetProvider("mastodon:", commenter)
	service.now = func() time.Time { return now }

	require.NoError(t, service.syncEngagement(ctx, "rendition-00"))
	require.Len(t, commenter.accountIDs, 1)
	require.Empty(t, commenter.incrementalRequests, "non-X adapters must remain on their existing ListComments behavior")
	var state models.EngagementSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("rendition_id = ?", "rendition-00").Scan(ctx))
	require.Equal(t, now.Add(5*time.Minute), state.NextSyncAt)
	budgetCount, err := db.NewSelect().Model((*models.XEngagementReadBudget)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, budgetCount)
}

func TestXCadenceDefaultsAndNonXBehaviorRemainDistinct(t *testing.T) {
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	require.Equal(t, 30*time.Minute, xEngagementCadence(now.Add(-time.Hour), now, true))
	require.Equal(t, 4*time.Hour, xEngagementCadence(now.Add(-2*24*time.Hour), now, true))
	require.Equal(t, 24*time.Hour, xEngagementCadence(now.Add(-8*24*time.Hour), now, true))
	require.Equal(t, 7*24*time.Hour, xEngagementCadence(now.Add(-31*24*time.Hour), now, true))
	require.Equal(t, 24*time.Hour, xEngagementCadence(now.Add(-31*24*time.Hour), now, false))

	// The generic cadence remains unchanged for every non-X provider.
	require.Equal(t, 5*time.Minute, engagementCadence(now.Add(-time.Hour), now, true))
	require.Equal(t, 30*time.Minute, engagementCadence(now.Add(-2*24*time.Hour), now, true))
	require.Equal(t, 6*time.Hour, engagementCadence(now.Add(-8*24*time.Hour), now, true))
}

func seedEngagementRenditions(t *testing.T, db *bun.DB, provider string, count int, now time.Time) {
	t.Helper()
	ctx := t.Context()
	_, err := db.NewInsert().Model(&models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: provider,
		AccountID: "remote-account", Slug: "account-1", AccessTokenEnc: []byte("encrypted"),
		IsActive: true, CreatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	for index := range count {
		publicationID := fmt.Sprintf("publication-%02d", index)
		renditionID := fmt.Sprintf("rendition-%02d", index)
		_, err = db.NewInsert().Model(&models.Publication{
			ID: publicationID, WorkspaceID: "workspace-1", CreatedByID: "user-1",
			Title: "Launch", SourceContent: "Launch", Status: models.PublicationStatusPublished,
			ActualRunAt: now.Add(-time.Hour), CreatedAt: now.Add(-time.Hour), UpdatedAt: now,
		}).Exec(ctx)
		require.NoError(t, err)
		_, err = db.NewInsert().Model(&models.Rendition{
			ID: renditionID, PublicationID: publicationID, SocialAccountID: "account-1",
			Platform: provider, Profile: "short_text", Status: models.RenditionStatusPublished,
			ExternalID: fmt.Sprintf("external-%02d", index), CreatedAt: now, UpdatedAt: now,
		}).Exec(ctx)
		require.NoError(t, err)
	}
}

func runQueuedEngagementSyncs(
	t *testing.T,
	db *bun.DB,
	service *Service,
	enqueue func() (int, error),
) {
	t.Helper()
	queued, err := enqueue()
	require.NoError(t, err)
	require.Positive(t, queued)
	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).
		Where("type = ?", JobTypeEngagementSync).
		Order("run_at ASC", "id ASC").Scan(t.Context()))
	for _, job := range jobs {
		require.NoError(t, service.HandleJob(t.Context(), job.Type, job.Payload))
	}
	_, err = db.NewDelete().Model((*models.Job)(nil)).Where("type = ?", JobTypeEngagementSync).Exec(t.Context())
	require.NoError(t, err)
}

func TestProviderPostURLUsesStableProviderIdentifiers(t *testing.T) {
	tests := []struct {
		name      string
		rendition models.Rendition
		account   models.SocialAccount
		want      string
	}{
		{
			name:      "x",
			rendition: models.Rendition{Platform: "x", ExternalID: "123"},
			account:   models.SocialAccount{AccountUsername: "openpost"},
			want:      "https://x.com/openpost/status/123",
		},
		{
			name:      "mastodon instance",
			rendition: models.Rendition{Platform: "mastodon", ExternalID: "456"},
			account: models.SocialAccount{
				AccountUsername: "openpost@social.example",
				InstanceURL:     "https://social.example",
			},
			want: "https://social.example/@openpost/456",
		},
		{
			name: "bluesky did and record key",
			rendition: models.Rendition{
				Platform:   "bluesky",
				ExternalID: `{"uri":"at://did:plc:openpost/app.bsky.feed.post/3abc","cid":"cid"}`,
			},
			want: "https://bsky.app/profile/did:plc:openpost/post/3abc",
		},
		{
			name:      "stored canonical URL wins",
			rendition: models.Rendition{Platform: "threads", ExternalURL: "https://www.threads.net/@openpost/post/abc"},
			want:      "https://www.threads.net/@openpost/post/abc",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Equal(t, test.want, providerPostURL(test.rendition, test.account))
		})
	}
}

func TestHistoricalRenditionUsesActiveReplacementAfterReconnect(t *testing.T) {
	db := engagementBehaviorTestDB(t)
	ctx := context.Background()
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	original := &models.SocialAccount{
		ID: "account-original", WorkspaceID: "workspace-1", Platform: "x",
		AccountID: "remote-account", AccountUsername: "openpost",
		AccessTokenEnc: []byte("old-encrypted"), IsActive: true,
		CreatedAt: now.Add(-24 * time.Hour),
	}
	replacement := *original
	replacement.ID = "account-reconnected"
	replacement.Slug = "openpost-reconnected"
	replacement.AccessTokenEnc = []byte("new-encrypted")
	replacement.IsActive = true
	replacement.CreatedAt = now
	_, err := db.NewInsert().Model(original).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().
		Model((*models.SocialAccount)(nil)).
		Set("is_active = ?", false).
		Where("id = ?", original.ID).
		Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&replacement).Exec(ctx)
	require.NoError(t, err)
	publication := &models.Publication{
		ID: "publication-1", WorkspaceID: original.WorkspaceID, CreatedByID: "user-1",
		Title: "Launch", SourceContent: "Launch", Status: models.PublicationStatusPublished,
		ActualRunAt: now.Add(-time.Hour), CreatedAt: now.Add(-2 * time.Hour), UpdatedAt: now.Add(-time.Hour),
	}
	_, err = db.NewInsert().Model(publication).Exec(ctx)
	require.NoError(t, err)
	rendition := &models.Rendition{
		ID: "rendition-1", PublicationID: publication.ID, SocialAccountID: original.ID,
		Platform: "x", Profile: "short_text", Status: models.RenditionStatusPublished,
		ExternalID: "provider-post-1", CreatedAt: now, UpdatedAt: now,
	}
	_, err = db.NewInsert().Model(rendition).Exec(ctx)
	require.NoError(t, err)

	commenter := &fakeCommenter{
		contentURL: "https://x.com/openpost/status/provider-post-1",
		comments: []platform.Comment{{
			ID: "comment-1", Text: "Hello", CreatedAt: now.Format(time.RFC3339),
		}},
	}
	service := NewService(db, staticTokenSource{}, nil)
	service.SetFeatureGate(alwaysEnabledGate{})
	service.now = func() time.Time { return now }
	service.SetProvider("x", commenter)

	queued, err := service.refreshWorkspace(ctx, original.WorkspaceID, true)
	require.NoError(t, err)
	require.Equal(t, 1, queued)
	require.NoError(t, service.syncEngagement(ctx, rendition.ID))
	require.Equal(t, []string{replacement.AccountID}, commenter.accountIDs)

	var item models.EngagementItem
	require.NoError(t, db.NewSelect().Model(&item).Where("remote_id = ?", "comment-1").Scan(ctx))
	require.Equal(t, replacement.ID, item.SocialAccountID)
	require.NoError(t, db.NewSelect().Model(rendition).WherePK().Scan(ctx))
	require.Equal(t, commenter.contentURL, rendition.ExternalURL)
}

func TestEngagementPersistenceTracksEditsDeletionAttachmentsAndLocalReadState(t *testing.T) {
	db := engagementBehaviorTestDB(t)
	ctx := context.Background()
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	account := models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "mastodon",
		AccountID: "remote-account", AccessTokenEnc: []byte("encrypted"), IsActive: true,
	}
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(&account).Exec(ctx)
		return err
	}())
	rendition := models.Rendition{ID: "rendition-1", PublicationID: "publication-1"}
	publication := models.Publication{ID: "publication-1", CreatedByID: "user-1"}
	service := NewService(db, staticTokenSource{}, nil)

	initial := platform.Comment{
		ID: "comment-1", AuthorID: "reader-1", AuthorName: "Reader",
		AuthorHandle: "@reader", AuthorAvatarURL: "https://cdn.example/avatar.png",
		Text: "First", CreatedAt: now.Format(time.RFC3339),
		CanReply: true, CanLike: true, LikeStateKnown: true,
		Attachments: []platform.CommentAttachment{
			{Type: "image", URL: "https://cdn.example/image.png", AltText: "Preview"},
			{Type: "image", URL: "http://private.example/image.png"},
		},
	}
	newItems, err := service.persistEngagementComments(ctx, rendition, account, publication, []platform.Comment{initial}, now)
	require.NoError(t, err)
	require.Len(t, newItems, 1)

	readAt := now.Add(time.Minute)
	_, err = db.NewUpdate().Model((*models.EngagementItem)(nil)).
		Set("read_at = ?", readAt).
		Where("remote_id = ?", initial.ID).
		Exec(ctx)
	require.NoError(t, err)

	edited := initial
	edited.Text = "Edited"
	edited.UpdatedAt = now.Add(2 * time.Minute).Format(time.RFC3339)
	edited.Liked = true
	edited.CanUnlike = true
	_, err = service.persistEngagementComments(ctx, rendition, account, publication, []platform.Comment{edited}, now.Add(2*time.Minute))
	require.NoError(t, err)

	var item models.EngagementItem
	require.NoError(t, db.NewSelect().Model(&item).Where("remote_id = ?", initial.ID).Scan(ctx))
	require.Equal(t, "Edited", item.Body)
	require.True(t, item.Liked)
	require.True(t, item.CanUnlike)
	require.Equal(t, readAt, item.ReadAt)
	require.False(t, item.EditedAt.IsZero())
	require.JSONEq(t, `[{"type":"image","url":"https://cdn.example/image.png","alt_text":"Preview"}]`, item.AttachmentsJSON)

	unknownLikeState := edited
	unknownLikeState.LikeStateKnown = false
	unknownLikeState.Liked = false
	unknownLikeState.CanLike = true
	unknownLikeState.CanUnlike = true
	_, err = service.persistEngagementComments(
		ctx,
		rendition,
		account,
		publication,
		[]platform.Comment{unknownLikeState},
		now.Add(3*time.Minute),
	)
	require.NoError(t, err)
	require.NoError(t, db.NewSelect().Model(&item).Where("remote_id = ?", initial.ID).Scan(ctx))
	require.True(t, item.Liked)
	require.False(t, item.CanLike)
	require.True(t, item.CanUnlike)

	edited.Deleted = true
	_, err = service.persistEngagementComments(ctx, rendition, account, publication, []platform.Comment{edited}, now.Add(4*time.Minute))
	require.NoError(t, err)
	require.NoError(t, db.NewSelect().Model(&item).Where("remote_id = ?", initial.ID).Scan(ctx))
	require.Empty(t, item.Body)
	require.JSONEq(t, `[]`, item.AttachmentsJSON)
	require.Empty(t, item.AuthorRemoteID)
	require.Empty(t, item.AuthorName)
	require.Empty(t, item.AuthorHandle)
	require.Empty(t, item.AuthorAvatarURL)
	require.False(t, item.CanReply)
	require.False(t, item.CanLike)
	require.False(t, item.DeletedAt.IsZero())
}

func TestEngagementPersistenceIgnoresRepliesFromConnectedAccount(t *testing.T) {
	db := engagementBehaviorTestDB(t)
	ctx := context.Background()
	now := time.Date(2026, 8, 11, 13, 21, 0, 0, time.UTC)
	account := models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "mastodon",
		AccountID: "remote-account", AccessTokenEnc: []byte("encrypted"), IsActive: true,
	}
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(&account).Exec(ctx)
		return err
	}())
	publication := models.Publication{
		ID: "publication-1", WorkspaceID: account.WorkspaceID, CreatedByID: "user-1",
		Title: "VPN ad differences", SourceText: "The difference in ads is insane.",
		Status: models.PublicationStatusPublished, CreatedAt: now, UpdatedAt: now,
	}
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(&publication).Exec(ctx)
		return err
	}())
	rendition := models.Rendition{
		ID: "rendition-1", PublicationID: publication.ID, SocialAccountID: account.ID,
		Platform: account.Platform, Status: models.RenditionStatusPublished,
		ExternalID: "status-1", CreatedAt: now, UpdatedAt: now,
	}
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(&rendition).Exec(ctx)
		return err
	}())
	_, err := db.NewInsert().Model(&models.EngagementItem{
		ID: "previously-stored-own-reply", WorkspaceID: account.WorkspaceID, RenditionID: rendition.ID,
		SocialAccountID: account.ID, Platform: account.Platform, RemoteID: "reply-by-connected-account",
		AuthorRemoteID: account.AccountID, Body: "Previously stored own reply", IsOurs: true,
		LastSeenAt: now, CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	service := NewService(db, staticTokenSource{}, nil)

	newItems, err := service.persistEngagementComments(
		ctx,
		rendition,
		account,
		publication,
		[]platform.Comment{
			{
				ID: "reply-by-connected-account", AuthorID: account.AccountID,
				AuthorName: "Rodrigo Dias", AuthorHandle: "@rgo",
				Text: "@PJFDF Yeah haha", CreatedAt: now.Format(time.RFC3339), IsOurs: true,
			},
			{
				ID: "reply-by-someone-else", AuthorID: "remote-reader",
				AuthorName: "A reader", AuthorHandle: "@reader",
				Text: "Same here", CreatedAt: now.Add(time.Minute).Format(time.RFC3339),
			},
		},
		now,
	)
	require.NoError(t, err)
	require.Len(t, newItems, 1)
	require.Equal(t, "reply-by-someone-else", newItems[0].RemoteID)

	count, err := db.NewSelect().Model((*models.EngagementItem)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count, "replies from the connected account must not be stored as engagement")

	_, err = db.NewInsert().Model(&models.EngagementItem{
		ID: "legacy-own-reply", WorkspaceID: account.WorkspaceID, RenditionID: rendition.ID,
		SocialAccountID: account.ID, Platform: account.Platform, RemoteID: "legacy-own-reply",
		AuthorRemoteID: account.AccountID, Body: "An own reply stored before the fix", IsOurs: true,
		LastSeenAt: now, CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)

	page, err := service.listEngagement(ctx, Query{WorkspaceID: account.WorkspaceID, Limit: 50})
	require.NoError(t, err)
	require.Equal(t, 1, page.Total, "previously stored own replies must be hidden from Engagement")
	require.Len(t, page.Items, 1)
	require.Equal(t, "reply-by-someone-else", page.Items[0].RemoteID)
}

func TestEngagementReactionUpdatesAvailableInverseAction(t *testing.T) {
	db := engagementBehaviorTestDB(t)
	ctx := context.Background()
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	item := &models.EngagementItem{
		ID: "item-1", WorkspaceID: "workspace-1", RenditionID: "rendition-1",
		SocialAccountID: "account-1", Platform: "x", RemoteID: "comment-1",
		CanLike: true, LastSeenAt: now, CreatedAt: now, UpdatedAt: now,
	}
	_, err := db.NewInsert().Model(item).Exec(ctx)
	require.NoError(t, err)
	commenter := &fakeCommenter{}
	service := NewService(db, staticTokenSource{}, nil)
	service.now = func() time.Time { return now.Add(time.Minute) }

	require.NoError(t, service.executeEngagementAction(
		ctx,
		commenter,
		"token",
		models.SocialAccount{ID: "account-1", WorkspaceID: "workspace-1", Platform: "x", AccountID: "remote-account"},
		item,
		engagementActionJob{ItemID: item.ID, Action: "like", UserID: "user-1"},
	))
	require.Equal(t, []string{"comment-1"}, commenter.likedIDs)

	var stored models.EngagementItem
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", item.ID).Scan(ctx))
	require.True(t, stored.Liked)
	require.False(t, stored.CanLike)
	require.True(t, stored.CanUnlike)
	require.True(t, stored.CanUnlike)
}

func TestListEngagementCursorReachesEveryRecordWithoutGapsOrDuplicates(t *testing.T) {
	db := engagementBehaviorTestDB(t)
	ctx := t.Context()
	createdAt := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	items := make([]models.EngagementItem, 0, 235)
	for index := range 235 {
		items = append(items, models.EngagementItem{
			ID: fmt.Sprintf("engagement-%03d", index), WorkspaceID: "workspace-1",
			RenditionID: "rendition-1", SocialAccountID: "account-1", Platform: "x",
			RemoteID: fmt.Sprintf("remote-%03d", index), Body: "Reply", LastSeenAt: createdAt,
			RemoteCreatedAt: createdAt, CreatedAt: createdAt, UpdatedAt: createdAt,
		})
	}
	_, err := db.NewInsert().Model(&items).Exec(ctx)
	require.NoError(t, err)
	service := NewService(db, staticTokenSource{}, nil)

	seen := make([]string, 0, len(items))
	var cursor *Cursor
	for {
		page, err := service.listEngagement(ctx, Query{
			WorkspaceID: "workspace-1", Limit: 37, Cursor: cursor,
		})
		require.NoError(t, err)
		for _, item := range page.Items {
			seen = append(seen, item.ID)
		}
		if cursor == nil {
			_, err = db.NewInsert().Model(&models.EngagementItem{
				ID: "engagement-new", WorkspaceID: "workspace-1", RenditionID: "rendition-1",
				SocialAccountID: "account-1", Platform: "x", RemoteID: "remote-new", Body: "New reply",
				LastSeenAt: createdAt.Add(time.Hour), RemoteCreatedAt: createdAt.Add(time.Hour),
				CreatedAt: createdAt.Add(time.Hour), UpdatedAt: createdAt.Add(time.Hour),
			}).Exec(ctx)
			require.NoError(t, err)
		}
		cursor = page.NextCursor
		if cursor == nil {
			break
		}
	}

	require.Len(t, seen, 235)
	require.Equal(t, len(seen), len(uniqueStrings(seen)))
	require.NotContains(t, seen, "engagement-new")
	for index, id := range seen {
		require.Equal(t, fmt.Sprintf("engagement-%03d", 234-index), id)
	}
}

func uniqueStrings(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}
