package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestCompatibilityPostMutationsRejectProcessingPublicationWorkBeforeMutation(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		method     string
		path       string
		body       string
		register   func(*PostHandler, huma.API)
		assertSame func(*testing.T, *bun.DB)
	}{
		{
			name:   "update post",
			method: http.MethodPatch,
			path:   "/api/v1/posts/post-atomic",
			body:   `{"content":"changed"}`,
			register: func(handler *PostHandler, api huma.API) {
				handler.UpdatePost(api)
			},
			assertSame: func(t *testing.T, db *bun.DB) {
				var content string
				require.NoError(t, db.NewSelect().Model((*models.Post)(nil)).Column("content").Where("id = ?", "post-atomic").Scan(t.Context(), &content))
				require.Equal(t, "before", content)
			},
		},
		{
			name:   "upsert variants",
			method: http.MethodPut,
			path:   "/api/v1/posts/post-atomic/variants",
			body:   `{"variants":[{"social_account_id":"account-atomic","content":"changed","is_unsynced":true}]}`,
			register: func(handler *PostHandler, api huma.API) {
				handler.UpsertVariants(api)
			},
			assertSame: func(t *testing.T, db *bun.DB) {
				var content string
				require.NoError(t, db.NewSelect().Model((*models.PostVariant)(nil)).Column("content").Where("post_id = ?", "post-atomic").Scan(t.Context(), &content))
				require.Equal(t, "variant-before", content)
			},
		},
		{
			name:   "delete variants",
			method: http.MethodDelete,
			path:   "/api/v1/posts/post-atomic/variants",
			register: func(handler *PostHandler, api huma.API) {
				handler.DeleteVariants(api)
			},
			assertSame: func(t *testing.T, db *bun.DB) {
				count, err := db.NewSelect().Model((*models.PostVariant)(nil)).Where("post_id = ?", "post-atomic").Count(t.Context())
				require.NoError(t, err)
				require.Equal(t, 1, count)
			},
		},
		{
			name:   "delete post",
			method: http.MethodDelete,
			path:   "/api/v1/posts/post-atomic",
			register: func(handler *PostHandler, api huma.API) {
				handler.DeletePost(api)
			},
			assertSame: func(t *testing.T, db *bun.DB) {
				postCount, err := db.NewSelect().Model((*models.Post)(nil)).Where("id = ?", "post-atomic").Count(t.Context())
				require.NoError(t, err)
				require.Equal(t, 1, postCount)
				jobCount, err := db.NewSelect().Model((*models.Job)(nil)).Where("id = ?", "job-atomic").Count(t.Context())
				require.NoError(t, err)
				require.Equal(t, 1, jobCount)
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			db := newLegacyPostMutationTestDB(t)
			seedLegacyPostMutationFixture(t, db, "processing")
			e := echo.New()
			api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
			testCase.register(NewPostHandler(db, testAuthenticator{}), api)
			req := httptest.NewRequestWithContext(t.Context(), testCase.method, testCase.path, strings.NewReader(testCase.body))
			req.Header.Set("Authorization", "Bearer web-token")
			if testCase.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)
			require.Equal(t, http.StatusInternalServerError, rec.Code, rec.Body.String())
			testCase.assertSame(t, db)
		})
	}
}

func TestCompatibilityUpdateAndDeleteRejectWorkerCompletionAfterFastPath(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		method   string
		body     string
		register func(*PostHandler, huma.API)
	}{
		{
			name: "update", method: http.MethodPatch, body: `{"content":"after"}`,
			register: func(handler *PostHandler, api huma.API) { handler.UpdatePost(api) },
		},
		{
			name: "delete", method: http.MethodDelete,
			register: func(handler *PostHandler, api huma.API) { handler.DeletePost(api) },
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			db := newLegacyPostMutationTestDB(t)
			seedLegacyPostMutationFixture(t, db, "pending")
			handler := NewPostHandler(db, testAuthenticator{})
			completionCount := 0
			handler.beforeLegacyMutationTransaction = func(ctx context.Context) error {
				completionCount++
				return markLegacyPostMutationFixturePublished(ctx, db)
			}
			e := echo.New()
			api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
			testCase.register(handler, api)
			req := httptest.NewRequestWithContext(t.Context(), testCase.method, "/api/v1/posts/post-atomic", strings.NewReader(testCase.body))
			req.Header.Set("Authorization", "Bearer web-token")
			if testCase.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)
			require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
			require.Equal(t, 1, completionCount)

			var post models.Post
			require.NoError(t, db.NewSelect().Model(&post).Where("id = ?", "post-atomic").Scan(t.Context()))
			require.Equal(t, "before", post.Content)
			require.Equal(t, models.PostStatusPublished, post.Status)
			var publication models.Publication
			require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", "publication-atomic").Scan(t.Context()))
			require.Equal(t, models.PublicationStatusPublished, publication.Status)
			var job models.Job
			require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", "job-atomic").Scan(t.Context()))
			require.Equal(t, "completed", job.Status)
		})
	}
}

func TestCompatibilityVariantMutationsRejectPublishedAggregate(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		method   string
		body     string
		register func(*PostHandler, huma.API)
	}{
		{
			name: "upsert", method: http.MethodPut,
			body:     `{"variants":[{"social_account_id":"account-atomic","content":"after","is_unsynced":true}]}`,
			register: func(handler *PostHandler, api huma.API) { handler.UpsertVariants(api) },
		},
		{
			name: "delete", method: http.MethodDelete,
			register: func(handler *PostHandler, api huma.API) { handler.DeleteVariants(api) },
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			db := newLegacyPostMutationTestDB(t)
			seedLegacyPostMutationFixture(t, db, "completed")
			require.NoError(t, markLegacyPostMutationFixturePublished(t.Context(), db))
			e := echo.New()
			api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
			testCase.register(NewPostHandler(db, testAuthenticator{}), api)
			req := httptest.NewRequestWithContext(t.Context(), testCase.method, "/api/v1/posts/post-atomic/variants", strings.NewReader(testCase.body))
			req.Header.Set("Authorization", "Bearer web-token")
			if testCase.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)
			require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())

			var variant models.PostVariant
			require.NoError(t, db.NewSelect().Model(&variant).Where("id = ?", "variant-atomic").Scan(t.Context()))
			require.Equal(t, "variant-before", variant.Content)
			var publication models.Publication
			require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", "publication-atomic").Scan(t.Context()))
			require.Equal(t, models.PublicationStatusPublished, publication.Status)
		})
	}
}

func TestCompatibilityVariantMutationKeepsSafeFailedAggregateEditable(t *testing.T) {
	db := newLegacyPostMutationTestDB(t)
	seedLegacyPostMutationFixture(t, db, "failed")
	_, err := db.NewUpdate().Model((*models.Post)(nil)).Set("status = ?", models.PostStatusFailed).
		Where("id = ?", "post-atomic").Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.Publication)(nil)).Set("status = ?", models.PublicationStatusFailed).
		Where("id = ?", "publication-atomic").Exec(t.Context())
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPostHandler(db, testAuthenticator{}).UpsertVariants(api)
	req := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodPut,
		"/api/v1/posts/post-atomic/variants",
		strings.NewReader(`{"variants":[{"social_account_id":"account-atomic","content":"recovered","is_unsynced":true}]}`),
	)
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var variant models.PostVariant
	require.NoError(t, db.NewSelect().Model(&variant).Where("id = ?", "variant-atomic").Scan(t.Context()))
	require.Equal(t, "recovered", variant.Content)
}

func TestCompatibilityPartialPatchRecomputesRunAtFromLockedSchedule(t *testing.T) {
	db := newLegacyPostMutationTestDB(t)
	db.SetMaxOpenConns(1)
	seedLegacyPostMutationFixture(t, db, "pending")
	secondSchedule := time.Now().UTC().Add(4 * time.Hour).Truncate(time.Second)
	handler := NewPostHandler(db, testAuthenticator{})
	handler.beforeLegacyMutationTransaction = func(ctx context.Context) error {
		return db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			if _, err := tx.NewUpdate().Model((*models.Post)(nil)).
				Set("scheduled_at = ?", secondSchedule).
				Set("actual_run_at = ?", secondSchedule).
				Where("id = ?", "post-atomic").Exec(txCtx); err != nil {
				return err
			}
			if _, err := tx.NewUpdate().Model((*models.Publication)(nil)).
				Set("scheduled_at = ?", secondSchedule).
				Where("id = ?", "publication-atomic").Exec(txCtx); err != nil {
				return err
			}
			_, err := tx.NewUpdate().Model((*models.Job)(nil)).
				Set("run_at = ?", secondSchedule).
				Where("id = ?", "job-atomic").Exec(txCtx)
			return err
		})
	}

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.UpdatePost(api)
	req := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodPatch,
		"/api/v1/posts/post-atomic",
		strings.NewReader(`{"random_delay_minutes":0}`),
	)
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var post models.Post
	require.NoError(t, db.NewSelect().Model(&post).Where("id = ?", "post-atomic").Scan(t.Context()))
	require.Equal(t, secondSchedule, post.ScheduledAt)
	require.Equal(t, secondSchedule, post.ActualRunAt)
	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).
		Where("type = ? AND scope_id = ? AND status = ?", "publish_publication", "publication-atomic", "pending").
		Scan(t.Context()))
	require.Len(t, jobs, 1)
	require.Equal(t, secondSchedule, jobs[0].RunAt)
}

func TestCompatibilityScheduleCancellationPreservesCompletedAndFailedJobHistory(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		cancel func(*testing.T, *bun.DB)
	}{
		{
			name: "REST unschedule",
			cancel: func(t *testing.T, db *bun.DB) {
				e := echo.New()
				api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
				NewPostHandler(db, testAuthenticator{}).UpdatePost(api)
				req := httptest.NewRequestWithContext(
					t.Context(), http.MethodPatch, "/api/v1/posts/post-atomic", strings.NewReader(`{"scheduled_at":""}`),
				)
				req.Header.Set("Authorization", "Bearer web-token")
				req.Header.Set("Content-Type", "application/json")
				rec := httptest.NewRecorder()
				e.ServeHTTP(rec, req)
				require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			},
		},
		{
			name: "MCP cancel",
			cancel: func(t *testing.T, db *bun.DB) {
				_, rpcErr := NewMCPHandler(db, testAuthenticator{}).cancelPost(
					t.Context(),
					"user-1",
					map[string]any{
						"workspace_id":      "workspace-atomic",
						"post_id":           "post-atomic",
						"expected_revision": 1,
					},
				)
				require.Nil(t, rpcErr)
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			db := newLegacyPostMutationTestDB(t)
			seedLegacyPostMutationFixture(t, db, "pending")
			now := time.Now().UTC()
			_, err := db.NewInsert().Model(&[]models.Job{
				{
					ID: "legacy-history-completed", Type: jobTypePublishPost, ScopeID: "post-atomic",
					Payload: `{"post_id":"post-atomic"}`, Status: "completed", RunAt: now.Add(-time.Hour), MaxAttempts: 3,
				},
				{
					ID: "legacy-history-failed", Type: jobTypePublishPost, ScopeID: "post-atomic",
					Payload: `{"post_id":"post-atomic"}`, Status: "failed", RunAt: now.Add(-time.Hour), MaxAttempts: 3,
				},
			}).Exec(t.Context())
			require.NoError(t, err)

			testCase.cancel(t, db)
			for _, jobID := range []string{"legacy-history-completed", "legacy-history-failed"} {
				count, err := db.NewSelect().Model((*models.Job)(nil)).Where("id = ?", jobID).Count(t.Context())
				require.NoError(t, err)
				require.Equal(t, 1, count, "%s must remain queryable", jobID)
			}
		})
	}
}

func TestDeletePostPreservesPendingProtectedProviderRecovery(t *testing.T) {
	db := newLegacyPostMutationTestDB(t)
	seedLegacyPostMutationFixture(t, db, "pending")
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.ProviderWriteAttempt{
		ID: "attempt-delete-protected", OperationID: "legacy:job-atomic:destination-atomic:publish", AttemptNumber: 1,
		JobID: "job-atomic", WorkspaceID: "workspace-atomic", SocialAccountID: "account-atomic",
		TargetKey: "x", Provider: "x", Operation: "publish", PayloadFingerprint: "sha256:protected",
		Status: "ambiguous", SubmissionState: "unknown", RetrySafety: "never", CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPostHandler(db, testAuthenticator{}).DeletePost(api)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodDelete, "/api/v1/posts/post-atomic", nil)
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusInternalServerError, rec.Code, rec.Body.String())

	for label, model := range map[string]any{
		"post":    (*models.Post)(nil),
		"job":     (*models.Job)(nil),
		"attempt": (*models.ProviderWriteAttempt)(nil),
	} {
		count, err := db.NewSelect().Model(model).Count(t.Context())
		require.NoError(t, err, label)
		require.Positive(t, count, label)
	}
}

func TestCompatibilityReschedulePreservesFailedAmbiguousProviderRecovery(t *testing.T) {
	db := newLegacyPostMutationTestDB(t)
	seedLegacyPostMutationFixture(t, db, "failed")
	now := time.Now().UTC()
	attempt := &models.ProviderWriteAttempt{
		ID: "attempt-reschedule-failed", OperationID: "legacy:job-atomic:destination-atomic:publish", AttemptNumber: 1,
		JobID: "job-atomic", WorkspaceID: "workspace-atomic", SocialAccountID: "account-atomic",
		TargetKey: "x", Provider: "x", Operation: "publish", PayloadFingerprint: "sha256:failed-ambiguous",
		Status: "ambiguous", SubmissionState: "unknown", RetrySafety: "never", CreatedAt: now, UpdatedAt: now,
	}
	_, err := db.NewInsert().Model(attempt).Exec(t.Context())
	require.NoError(t, err)
	var before models.Post
	require.NoError(t, db.NewSelect().Model(&before).Where("id = ?", "post-atomic").Scan(t.Context()))

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPostHandler(db, testAuthenticator{}).UpdatePost(api)
	requested := now.Add(3 * time.Hour).Format(time.RFC3339)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/api/v1/posts/post-atomic", strings.NewReader(`{"scheduled_at":"`+requested+`"}`))
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusInternalServerError, rec.Code, rec.Body.String())

	var after models.Post
	require.NoError(t, db.NewSelect().Model(&after).Where("id = ?", before.ID).Scan(t.Context()))
	require.Equal(t, before.ScheduledAt, after.ScheduledAt)
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", "job-atomic").Scan(t.Context()))
	require.Equal(t, "failed", job.Status)
	require.Equal(t, "job-atomic", job.ID)
}

func TestNativePublicationDeleteAndReschedulePreserveProtectedProviderRecovery(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		mutate func(context.Context, *PublicationHandler, bun.Tx) error
	}{
		{
			name: "delete",
			mutate: func(ctx context.Context, handler *PublicationHandler, tx bun.Tx) error {
				current, err := handler.loadEditablePublicationTx(ctx, tx, "publication-atomic")
				if err != nil {
					return err
				}
				_, err = tx.NewDelete().Model((*models.Publication)(nil)).Where("id = ?", current.ID).Exec(ctx)
				return err
			},
		},
		{
			name: "reschedule",
			mutate: func(ctx context.Context, handler *PublicationHandler, tx bun.Tx) error {
				_, err := handler.replacePublicationJobTx(ctx, tx, "publication-atomic", time.Now().UTC().Add(2*time.Hour))
				return err
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			db := newLegacyPostMutationTestDB(t)
			seedLegacyPostMutationFixture(t, db, "pending")
			now := time.Now().UTC()
			attempt := &models.ProviderWriteAttempt{
				ID: "attempt-native-protected", OperationID: "legacy:job-atomic:rendition-atomic:publish", AttemptNumber: 1,
				JobID: "job-atomic", WorkspaceID: "workspace-atomic",
				SocialAccountID: "account-atomic", TargetKey: "x", Provider: "x", Operation: "publish",
				PayloadFingerprint: "sha256:native-protected", Status: "ambiguous", SubmissionState: "unknown",
				RetrySafety: "never", CreatedAt: now, UpdatedAt: now,
			}
			_, err := db.NewInsert().Model(attempt).Exec(t.Context())
			require.NoError(t, err)
			handler := NewPublicationHandler(db, testAuthenticator{}, nil)
			err = db.RunInTx(t.Context(), &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
				return testCase.mutate(txCtx, handler, tx)
			})
			require.ErrorIs(t, err, errPublicationAlreadyProcessing)

			jobCount, err := db.NewSelect().Model((*models.Job)(nil)).Where("id = ?", "job-atomic").Count(t.Context())
			require.NoError(t, err)
			require.Equal(t, 1, jobCount)
			publicationCount, err := db.NewSelect().Model((*models.Publication)(nil)).Where("id = ?", "publication-atomic").Count(t.Context())
			require.NoError(t, err)
			require.Equal(t, 1, publicationCount)
			attemptCount, err := db.NewSelect().Model((*models.ProviderWriteAttempt)(nil)).Where("id = ?", attempt.ID).Count(t.Context())
			require.NoError(t, err)
			require.Equal(t, 1, attemptCount)
		})
	}
}

func TestLegacyPostMutationKeepsJobUnclaimableUntilAuthorizationCommits(t *testing.T) {
	db := newLegacyPostMutationTestDB(t)
	seedLegacyPostMutationFixture(t, db, "pending")
	ctx := context.WithValue(t.Context(), middleware.UserIDKey, "user-atomic")
	actor := publicationAuthorizationActor(ctx, "user-atomic")
	require.NoError(t, publicationauth.AuthorizeLegacyJobs(ctx, db, publicationauth.LegacyJobsInput{
		JobID: "job-atomic",
		Actor: actor,
	}))

	tx, err := db.BeginTx(ctx, &sql.TxOptions{})
	require.NoError(t, err)
	defer func() { _ = tx.Rollback() }()
	handler := NewPostHandler(db, testAuthenticator{})
	require.NoError(t, handler.prepareLegacyPostMutationTx(ctx, tx, "post-atomic"))
	_, err = tx.NewUpdate().Model((*models.Post)(nil)).Set("content = ?", "after").Where("id = ?", "post-atomic").Exec(ctx)
	require.NoError(t, err)

	var prematurelyClaimed models.Job
	err = db.NewRaw(`UPDATE jobs SET status = 'processing' WHERE id = ? AND status = 'pending' RETURNING *`, "job-atomic").Scan(ctx, &prematurelyClaimed)
	require.Error(t, err, "a competing worker must not claim the job while the request transaction is open")
	require.NoError(t, handler.finishLegacyPostMutationTx(ctx, tx, "post-atomic"))
	require.NoError(t, tx.Commit())

	var claimed models.Job
	require.NoError(t, db.NewRaw(`UPDATE jobs SET status = 'processing' WHERE id = ? AND status = 'pending' RETURNING *`, "job-atomic").Scan(ctx, &claimed))
	require.Equal(t, "publish_publication", claimed.Type)
	payload := map[string]any{}
	require.NoError(t, json.Unmarshal([]byte(claimed.Payload), &payload))
	require.NotEmpty(t, payload["authorization_batch_id"])
	var content string
	require.NoError(t, db.NewSelect().Model((*models.Post)(nil)).Column("content").Where("id = ?", "post-atomic").Scan(ctx, &content))
	require.Equal(t, "after", content)
}

func TestRESTCompatibilityMutationRollsBackWhenAuthorizationBindingFails(t *testing.T) {
	db := newLegacyPostMutationTestDB(t)
	seedLegacyPostMutationFixture(t, db, "pending")
	ctx := context.WithValue(t.Context(), middleware.UserIDKey, "user-atomic")
	actor := publicationAuthorizationActor(ctx, "user-atomic")
	require.NoError(t, publicationauth.AuthorizeLegacyJobs(ctx, db, publicationauth.LegacyJobsInput{JobID: "job-atomic", Actor: actor}))
	_, err := db.ExecContext(ctx, `
		CREATE TRIGGER fail_rest_replacement_authorization
		BEFORE INSERT ON publication_authorizations
		BEGIN
			SELECT RAISE(ABORT, 'forced REST replacement authorization failure');
		END
	`)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPostHandler(db, testAuthenticator{}).UpdatePost(api)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/api/v1/posts/post-atomic", strings.NewReader(`{"content":"rest-after"}`))
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusInternalServerError, rec.Code, rec.Body.String())

	var post models.Post
	require.NoError(t, db.NewSelect().Model(&post).Where("id = ?", "post-atomic").Scan(ctx))
	require.Equal(t, "before", post.Content)
}

func TestMCPCompatibilityMutationRollsBackWhenAuthorizationBindingFails(t *testing.T) {
	db := newLegacyPostMutationTestDB(t)
	seedLegacyPostMutationFixture(t, db, "pending")
	ctx := context.WithValue(t.Context(), middleware.UserIDKey, "user-atomic")
	actor := publicationAuthorizationActor(ctx, "user-atomic")
	require.NoError(t, publicationauth.AuthorizeLegacyJobs(ctx, db, publicationauth.LegacyJobsInput{JobID: "job-atomic", Actor: actor}))
	_, err := db.ExecContext(ctx, `
		CREATE TRIGGER fail_replacement_authorization
		BEFORE INSERT ON publication_authorizations
		BEGIN
			SELECT RAISE(ABORT, 'forced replacement authorization failure');
		END
	`)
	require.NoError(t, err)

	mcp := NewMCPHandler(db, testAuthenticator{})
	err = db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		mutation, err := mcp.lockMCPTextPostMutation(txCtx, tx, "post-atomic", 1)
		if err != nil {
			return err
		}
		mutation.Post.Content = "mcp-after"
		mutation.Post.Revision = mutation.NextRevision
		mutation.Post.UpdatedAt = mutation.UpdatedAt
		if _, err := tx.NewUpdate().Model(mutation.Post).
			Column("content", "revision", "updated_at").
			Where("id = ? AND revision = ?", mutation.Post.ID, mutation.ExpectedRevision).
			Exec(txCtx); err != nil {
			return err
		}
		return mcp.finishMCPTextPostMutation(txCtx, tx, mutation, "user-atomic", []string{"content"})
	})
	require.ErrorContains(t, err, "forced replacement authorization failure")

	var post models.Post
	require.NoError(t, db.NewSelect().Model(&post).Where("id = ?", "post-atomic").Scan(ctx))
	require.Equal(t, "before", post.Content)
	require.Equal(t, 1, post.Revision)
}

func newLegacyPostMutationTestDB(t *testing.T) *bun.DB {
	t.Helper()
	return createHandlerTestDB(
		t,
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.User)(nil),
		(*models.SocialAccount)(nil),
		(*models.MediaAttachment)(nil),
		(*models.RenditionMedia)(nil),
		(*models.Job)(nil),
		(*models.Publication)(nil),
		(*models.ProviderWriteAttempt)(nil),
	)
}

func seedLegacyPostMutationFixture(t *testing.T, db *bun.DB, jobStatus string) {
	t.Helper()
	ctx := t.Context()
	now := time.Now().UTC().Truncate(time.Second)
	runAt := now.Add(time.Hour)
	for _, model := range []any{
		&models.Workspace{ID: "workspace-atomic", Name: "Atomic"},
		&models.WorkspaceMember{WorkspaceID: "workspace-atomic", UserID: "user-1", Role: models.WorkspaceRoleAdmin},
		&models.User{ID: "user-atomic", Email: "atomic@example.com", PasswordHash: "hash"},
		&models.SocialAccount{ID: "account-atomic", WorkspaceID: "workspace-atomic", Platform: "x", AccountID: "x-atomic", AccessTokenEnc: []byte("ciphertext"), IsActive: true},
		&models.Post{ID: "post-atomic", PublicationID: "publication-atomic", WorkspaceID: "workspace-atomic", CreatedByID: "user-atomic", Content: "before", Status: models.PostStatusScheduled, ScheduledAt: runAt, ActualRunAt: runAt, Revision: 1, CreatedAt: now, UpdatedAt: now},
		&models.PostDestination{ID: "destination-atomic", PostID: "post-atomic", SocialAccountID: "account-atomic", Status: "pending"},
		&models.PostVariant{ID: "variant-atomic", PostID: "post-atomic", SocialAccountID: "account-atomic", Content: "variant-before", MediaIDs: "[]", CreatedAt: now, UpdatedAt: now},
		&models.Publication{ID: "publication-atomic", WorkspaceID: "workspace-atomic", CreatedByID: "user-atomic", Title: "Before", SourceText: "before", SourceContent: "before", Status: models.PublicationStatusScheduled, ScheduledAt: runAt, Revision: 1, CreatedAt: now, UpdatedAt: now},
		&models.Rendition{ID: "rendition-atomic", PublicationID: "publication-atomic", SocialAccountID: "account-atomic", Platform: "x", Profile: models.ContentProfileShortText, Body: "before", Status: models.RenditionStatusScheduled, CreatedAt: now, UpdatedAt: now},
		&models.Job{ID: "job-atomic", Type: "publish_publication", ScopeID: "publication-atomic", Payload: `{"publication_id":"publication-atomic"}`, Status: jobStatus, RunAt: runAt, MaxAttempts: 3},
	} {
		_, err := db.NewInsert().Model(model).Exec(ctx)
		require.NoError(t, err)
	}
}

func markLegacyPostMutationFixturePublished(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewUpdate().Model((*models.Post)(nil)).
			Set("status = ?", models.PostStatusPublished).
			Where("id = ?", "post-atomic").Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewUpdate().Model((*models.Publication)(nil)).
			Set("status = ?", models.PublicationStatusPublished).
			Where("id = ?", "publication-atomic").Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewUpdate().Model((*models.Rendition)(nil)).
			Set("status = ?", models.RenditionStatusPublished).
			Where("id = ?", "rendition-atomic").Exec(txCtx); err != nil {
			return err
		}
		_, err := tx.NewUpdate().Model((*models.Job)(nil)).
			Set("status = ?", "completed").
			Where("id = ?", "job-atomic").Exec(txCtx)
		return err
	})
}
