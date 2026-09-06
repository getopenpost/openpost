package migrations

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

func TestLegacyPublicationBackfillResumesAfterCancellationAndIsIdempotent(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := t.Context()
	createLegacyPublicationTestTables(t, db)
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	recreateLegacyPostTablesAfterRetirement(t, db)
	allowLegacyActiveUnscopedJobsForTest(t, db)

	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-backfill", Name: "Backfill"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-backfill", WorkspaceID: "workspace-backfill", Platform: "x",
		AccountID: "x-backfill", AccessTokenEnc: []byte("ciphertext"), IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Second)
	posts := []models.Post{
		{ID: "legacy-a", WorkspaceID: "workspace-backfill", CreatedByID: "user-1", Content: "Scheduled", Status: models.PostStatusScheduled, ScheduledAt: now.Add(time.Hour), ActualRunAt: now.Add(time.Hour), CreatedAt: now},
		{ID: "legacy-b", WorkspaceID: "workspace-backfill", CreatedByID: "user-1", Content: "Draft B", Status: models.PostStatusDraft, CreatedAt: now.Add(time.Second)},
		{ID: "legacy-c", WorkspaceID: "workspace-backfill", CreatedByID: "user-1", Content: "Draft C", Status: models.PostStatusDraft, CreatedAt: now.Add(2 * time.Second)},
	}
	_, err = db.NewInsert().Model(&posts).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PostDestination{
		ID: "destination-backfill", PostID: "legacy-a", SocialAccountID: "account-backfill", Status: "pending",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Job{
		ID: "legacy-job", Type: "publish_post", Payload: `{"post_id":"legacy-a"}`,
		Status: "pending", RunAt: now.Add(time.Hour), MaxAttempts: 3,
	}).Exec(ctx)
	require.NoError(t, err)

	restartLegacyBackfillStateForTest(t, db)
	done, err := runLegacyPublicationAuthoringBackfillBatch(ctx, db, 1)
	require.NoError(t, err)
	require.False(t, done)
	state, err := loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	require.Equal(t, legacyPublicationBackfillPhaseJobScopes, state.Phase)
	require.Equal(t, "legacy-job", state.CursorID)
	require.Equal(t, int64(1), state.ProcessedCount)

	canceled, cancel := context.WithCancel(ctx)
	cancel()
	_, err = runLegacyPublicationAuthoringBackfillBatch(canceled, db, 1)
	require.ErrorIs(t, err, context.Canceled)
	afterCancel, err := loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	require.Equal(t, state.Phase, afterCancel.Phase)
	require.Equal(t, state.CursorID, afterCancel.CursorID)
	require.Equal(t, state.ProcessedCount, afterCancel.ProcessedCount)

	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	for _, postID := range []string{"legacy-a", "legacy-b", "legacy-c"} {
		var post models.Post
		require.NoError(t, db.NewSelect().Model(&post).Where("id = ?", postID).Scan(ctx))
		require.NotEmpty(t, post.PublicationID)
	}
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", "legacy-job").Scan(ctx))
	require.Equal(t, "publish_publication", job.Type)
	require.Equal(t, "legacy-publication:legacy-a", job.ScopeID)
	var payload map[string]any
	require.NoError(t, json.Unmarshal([]byte(job.Payload), &payload))
	batchID, _ := payload["authorization_batch_id"].(string)
	require.NotEmpty(t, batchID)
	receiptCount, err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).
		Where("batch_id = ? AND job_id = ?", batchID, job.ID).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, receiptCount)

	state, err = loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	require.Equal(t, legacyPublicationBackfillPhaseComplete, state.Phase)
	require.False(t, state.CompletedAt.IsZero())
	publicationCount, err := db.NewSelect().Model((*models.Publication)(nil)).Count(ctx)
	require.NoError(t, err)
	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	require.NoError(t, runTestMigrations(t, db))
	recreateLegacyPostTablesAfterRetirement(t, db)
	stablePublicationCount, err := db.NewSelect().Model((*models.Publication)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, publicationCount, stablePublicationCount)
}

func TestCompletedLegacyPublicationBackfillDoesNotReopenForUnrepairableHistory(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := t.Context()
	createLegacyPublicationTestTables(t, db)
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	recreateLegacyPostTablesAfterRetirement(t, db)

	before, err := loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	require.Equal(t, legacyPublicationBackfillPhaseComplete, before.Phase)
	_, err = db.NewInsert().Model(&models.Job{
		ID: "malformed-historical-job", Type: "publish_post", Payload: `{broken`,
		Status: "completed", RunAt: time.Now().UTC(), MaxAttempts: 3,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Post{
		ID: "orphan-historical-post", WorkspaceID: "missing-workspace", CreatedByID: "missing-user",
		Content: "orphan", Status: models.PostStatusDraft, CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	require.NoError(t, resumeLegacyPublicationAuthoringBackfill(ctx, db))
	after, err := loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	require.Equal(t, legacyPublicationBackfillPhaseComplete, after.Phase)
	require.Equal(t, before.ProcessedCount, after.ProcessedCount)
	require.Equal(t, before.UpdatedAt, after.UpdatedAt)

	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", "malformed-historical-job").Scan(ctx))
	require.Empty(t, job.ScopeID)
	var post models.Post
	require.NoError(t, db.NewSelect().Model(&post).Where("id = ?", "orphan-historical-post").Scan(ctx))
	require.Empty(t, post.PublicationID)
}

func TestLegacyPublicationRequestRechecksWorkerClaimInsideTransaction(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := t.Context()
	createLegacyPublicationTestTables(t, db)
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	recreateLegacyPostTablesAfterRetirement(t, db)

	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-claim-race", Name: "Claim race"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-claim-race", WorkspaceID: "workspace-claim-race", Platform: "x",
		AccountID: "x-claim-race", AccessTokenEnc: []byte("ciphertext"), IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Second)
	post := &models.Post{
		ID: "post-claim-race", WorkspaceID: "workspace-claim-race", CreatedByID: "user-1",
		Content: "Do not race the worker", Status: models.PostStatusScheduled,
		ScheduledAt: now.Add(time.Hour), ActualRunAt: now.Add(time.Hour), CreatedAt: now,
	}
	_, err = db.NewInsert().Model(post).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PostDestination{
		ID: "destination-claim-race", PostID: post.ID, SocialAccountID: "account-claim-race", Status: "pending",
	}).Exec(ctx)
	require.NoError(t, err)
	job := &models.Job{
		ID: "job-claim-race", Type: "publish_post", ScopeID: post.ID,
		Payload: `{"post_id":"post-claim-race"}`, Status: "pending", RunAt: now.Add(time.Hour),
	}
	_, err = db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)

	protected, err := legacyPublicationAggregateHasProtectedWrite(ctx, db, post.ID)
	require.NoError(t, err)
	require.False(t, protected, "the request's initial check observes unclaimed work")
	_, err = db.NewUpdate().Model((*models.Job)(nil)).
		Set("status = ?", "processing").Set("locked_at = ?", now).Set("locked_by = ?", "worker-race").
		Where("id = ?", job.ID).Exec(ctx)
	require.NoError(t, err)

	err = migrateLegacyPost(ctx, db, *post, publicationauth.Actor{
		Origin: publicationauth.OriginBrowser, UserID: "user-1", SessionID: "session-claim-race",
	})
	require.ErrorIs(t, err, errLegacyPublicationProviderRecovery)
	require.NoError(t, db.NewSelect().Model(post).Where("id = ?", post.ID).Scan(ctx))
	require.Empty(t, post.PublicationID, "the transactional recheck must roll back canonicalization")
	require.NoError(t, db.NewSelect().Model(job).Where("id = ?", job.ID).Scan(ctx))
	require.Equal(t, "publish_post", job.Type)
	require.Equal(t, "processing", job.Status)
	publicationCount, err := db.NewSelect().Model((*models.Publication)(nil)).
		Where("id = ?", "legacy-publication:"+post.ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, publicationCount)
}

func TestLegacyPublicationAuthorizationBackfillRollsBackAndResumesAtomically(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := t.Context()
	createLegacyPublicationTestTables(t, db)
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	recreateLegacyPostTablesAfterRetirement(t, db)

	now := time.Now().UTC().Truncate(time.Microsecond)
	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-auth", Name: "Authorization"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-auth", WorkspaceID: "workspace-auth", Platform: "x", AccountID: "x-auth",
		AccessTokenEnc: []byte("ciphertext"), IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-auth", WorkspaceID: "workspace-auth", CreatedByID: "user-1", Title: "Authorization",
		SourceText: "Atomic authorization", SourceContent: "Atomic authorization", Status: models.PublicationStatusScheduled,
		ScheduledAt: now.Add(time.Hour), CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-auth", PublicationID: "publication-auth", SocialAccountID: "account-auth",
		Platform: "x", Profile: models.ContentProfileShortText, Body: "Atomic authorization",
		Status: models.RenditionStatusScheduled, CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	job := &models.Job{
		ID: "job-auth", Type: "publish_publication", ScopeID: "publication-auth",
		Payload: `{"publication_id":"publication-auth"}`, Status: "pending", RunAt: now.Add(time.Hour),
	}
	_, err = db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*legacyPublicationBackfillState)(nil)).
		Set("phase = ?", legacyPublicationBackfillPhaseAuth).
		Set("cursor_id = ''").
		Set("completed_at = NULL").
		Where("key = ?", legacyPublicationBackfillKey).
		Exec(ctx)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `CREATE TRIGGER fail_legacy_authorization_bind
		BEFORE UPDATE OF payload ON jobs
		WHEN OLD.id = 'job-auth' AND instr(NEW.payload, 'authorization_batch_id') > 0
		BEGIN
			SELECT RAISE(ABORT, 'injected authorization bind failure');
		END`)
	require.NoError(t, err)
	done, err := runLegacyPublicationAuthoringBackfillBatch(ctx, db, 1)
	require.ErrorContains(t, err, "injected authorization bind failure")
	require.False(t, done)

	state, err := loadLegacyPublicationBackfillState(ctx, db)
	require.NoError(t, err)
	require.Equal(t, legacyPublicationBackfillPhaseAuth, state.Phase)
	require.Empty(t, state.CursorID)
	receiptCount, err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).
		Where("job_id = ?", job.ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, receiptCount, "the failed payload bind must roll back its receipt")
	eventCount, err := db.NewSelect().Model((*models.PublicationLifecycleEvent)(nil)).
		Where("publication_id = ?", "publication-auth").Count(ctx)
	require.NoError(t, err)
	require.Zero(t, eventCount, "the failed payload bind must roll back its lifecycle event")
	require.NoError(t, db.NewSelect().Model(job).Where("id = ?", job.ID).Scan(ctx))
	require.NotContains(t, job.Payload, "authorization_batch_id")

	_, err = db.ExecContext(ctx, "DROP TRIGGER fail_legacy_authorization_bind")
	require.NoError(t, err)
	done, err = runLegacyPublicationAuthoringBackfillBatch(ctx, db, 1)
	require.NoError(t, err)
	require.False(t, done)
	require.NoError(t, db.NewSelect().Model(job).Where("id = ?", job.ID).Scan(ctx))
	require.Contains(t, job.Payload, "authorization_batch_id")
	receiptCount, err = db.NewSelect().Model((*models.PublicationAuthorization)(nil)).
		Where("job_id = ?", job.ID).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, receiptCount)

	linkedPost := &models.Post{
		ID: "post-auth-linked", WorkspaceID: "workspace-auth", CreatedByID: "user-1",
		PublicationID: "publication-auth", Content: "Linked authorization",
		Status: models.PostStatusScheduled, ScheduledAt: now.Add(2 * time.Hour), ActualRunAt: now.Add(2 * time.Hour),
	}
	_, err = db.NewInsert().Model(linkedPost).Exec(ctx)
	require.NoError(t, err)
	linkedJob := &models.Job{
		ID: "job-auth-linked", Type: "publish_publication", ScopeID: "publication-auth",
		Payload: `{"publication_id":"publication-auth"}`, Status: "pending", RunAt: now.Add(2 * time.Hour),
	}
	_, err = db.NewInsert().Model(linkedJob).Exec(ctx)
	require.NoError(t, err)
	eventsBefore, err := db.NewSelect().Model((*models.PublicationLifecycleEvent)(nil)).
		Where("publication_id = ?", "publication-auth").Count(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `CREATE TRIGGER fail_linked_legacy_authorization_bind
		BEFORE UPDATE OF payload ON jobs
		WHEN OLD.id = 'job-auth-linked' AND instr(NEW.payload, 'authorization_batch_id') > 0
		BEGIN
			SELECT RAISE(ABORT, 'injected linked authorization bind failure');
		END`)
	require.NoError(t, err)
	err = MigrateLegacyPublicationAuthoringForActor(ctx, db, linkedPost.ID, publicationauth.Actor{
		Origin: publicationauth.OriginBrowser, UserID: "user-1", SessionID: "session-linked-auth",
	})
	require.ErrorContains(t, err, "injected linked authorization bind failure")
	linkedReceiptCount, err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).
		Where("job_id = ?", linkedJob.ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, linkedReceiptCount, "already-linked authorization must roll back its receipt")
	linkedEventsAfter, err := db.NewSelect().Model((*models.PublicationLifecycleEvent)(nil)).
		Where("publication_id = ?", "publication-auth").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, eventsBefore, linkedEventsAfter, "already-linked authorization must roll back its event")
	require.NoError(t, db.NewSelect().Model(linkedJob).Where("id = ?", linkedJob.ID).Scan(ctx))
	require.NotContains(t, linkedJob.Payload, "authorization_batch_id")
	_, err = db.ExecContext(ctx, "DROP TRIGGER fail_linked_legacy_authorization_bind")
	require.NoError(t, err)
}

func createLegacyPublicationTestTables(t *testing.T, db *bun.DB) {
	t.Helper()
	for _, model := range []any{
		(*models.PostDestination)(nil), (*models.PostMedia)(nil), (*models.Job)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
}

// recreateLegacyPostTablesAfterRetirement restores the Post authoring tables
// after the full migration set has retired them at the finalize boundary. The
// backfill functions under test still read and translate these rows.
func recreateLegacyPostTablesAfterRetirement(t *testing.T, db *bun.DB) {
	t.Helper()
	for _, model := range []any{
		(*models.Post)(nil),
		(*models.PostDestination)(nil), (*models.PostMedia)(nil), (*models.PostVariant)(nil),
		(*models.ThreadDraft)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
}

func restartLegacyBackfillStateForTest(t *testing.T, db *bun.DB) {
	t.Helper()
	_, err := db.NewUpdate().Model((*legacyPublicationBackfillState)(nil)).
		Set("phase = ?", legacyPublicationBackfillPhaseJobScopes).
		Set("cursor_id = ''").
		Set("processed_count = 0").
		Set("completed_at = NULL").
		Where("key = ? OR key LIKE ?", legacyPublicationBackfillKey, legacyPublicationProtectedScopeKeyPrefix+"%").
		Exec(t.Context())
	require.NoError(t, err)
}

func allowLegacyActiveUnscopedJobsForTest(t *testing.T, db *bun.DB) {
	t.Helper()
	ctx := t.Context()
	switch db.Dialect().Name() {
	case dialect.SQLite:
		_, err := db.ExecContext(ctx, "DROP TRIGGER IF EXISTS jobs_active_publication_scope_insert")
		require.NoError(t, err)
		_, err = db.ExecContext(ctx, "DROP TRIGGER IF EXISTS jobs_active_publication_scope_update")
		require.NoError(t, err)
	case dialect.PG:
		_, err := db.ExecContext(ctx, "DROP TRIGGER IF EXISTS jobs_active_publication_scope_bind ON jobs")
		require.NoError(t, err)
		_, err = db.ExecContext(ctx, "ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_active_publication_scope_check")
		require.NoError(t, err)
	}
}
