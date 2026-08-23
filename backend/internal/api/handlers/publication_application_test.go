package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/providerreadiness"
	publicationservice "github.com/openpost/backend/internal/services/publications"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/stretchr/testify/require"
)

func TestPublicationApplicationReplaysEnqueueActionsWithoutCreatingAnotherJob(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name        string
		operationID string
		scheduled   bool
	}{
		{name: "schedule", operationID: "schedule-publication", scheduled: true},
		{name: "publish now", operationID: "publish-publication-now"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			srv := newMCPTestServer(t)
			createIdempotencyRecordTable(t, srv.db)
			ctx := context.Background()
			handler := srv.handler.publicationHandler()
			input := CreatePublicationBody{
				WorkspaceID: "ws-1", ContentProfile: models.ContentProfileShortText,
				SourceText: "One durable queue mutation", SocialAccountIDs: []string{"account-1"},
			}
			if test.scheduled {
				scheduledAt := time.Now().UTC().Add(2 * time.Hour)
				input.ScheduledAt = &scheduledAt
			}
			publication, err := handler.publicationApplication().Create(ctx, "user-1", input)
			require.NoError(t, err)

			request := idempotency.Request{
				PrincipalID: "token:workflow-token", WorkspaceID: "ws-1",
				OperationID: test.operationID, Key: "upstream-event-42",
				ExpiresAt: time.Now().UTC().Add(time.Hour),
			}
			commands := handler.publicationApplicationForTesting()
			var first, replay publicationEnqueueResult
			var replayed bool
			if test.scheduled {
				first, replayed, err = commands.ScheduleIdempotent(
					ctx, "user-1", publication.ID, 1, providerreadiness.ExecutionIntentProduction, request,
				)
				require.NoError(t, err)
				require.False(t, replayed)
				replay, replayed, err = commands.ScheduleIdempotent(
					ctx, "user-1", publication.ID, 1, providerreadiness.ExecutionIntentProduction, request,
				)
			} else {
				first, replayed, err = commands.PublishNowIdempotent(
					ctx, "user-1", publication.ID, 1, providerreadiness.ExecutionIntentProduction, request,
				)
				require.NoError(t, err)
				require.False(t, replayed)
				replay, replayed, err = commands.PublishNowIdempotent(
					ctx, "user-1", publication.ID, 1, providerreadiness.ExecutionIntentProduction, request,
				)
			}
			require.NoError(t, err)
			require.True(t, replayed)
			require.Equal(t, first, replay)
			require.NotEmpty(t, first.JobID)

			jobCount, err := srv.db.NewSelect().Model((*models.Job)(nil)).
				Where("scope_id = ?", publication.ID).Count(ctx)
			require.NoError(t, err)
			require.Equal(t, 1, jobCount)
		})
	}
}

func TestPublicationApplicationKeepsRESTAndMCPUpdateParity(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := context.Background()
	handler := NewPublicationHandler(srv.db, testAuthenticator{}, nil)

	create := func(title string) PublicationResponse {
		t.Helper()
		publication, err := handler.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{
			WorkspaceID:      "ws-1",
			Title:            title,
			ContentProfile:   models.ContentProfileShortText,
			SourceText:       "Initial copy",
			SocialAccountIDs: []string{"account-1"},
		})
		require.NoError(t, err)
		return publication
	}
	restPublication := create("REST publication")
	mcpPublication := create("MCP publication")

	restEcho := echo.New()
	api := humaecho.NewWithGroup(restEcho, restEcho.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.RegisterRoutes(api)

	scheduledAt := time.Now().UTC().Add(3 * time.Hour).Truncate(time.Second)
	restUpdateBody := map[string]any{
		"expected_revision": 1,
		"title":             "Shared title",
		"source_text":       "Shared source",
		"scheduled_at":      scheduledAt,
		"metadata":          map[string]any{"campaign": "launch"},
	}
	restUpdate := publicationApplicationRequest(ctx, t, restEcho, http.MethodPut, "/api/v1/publications/"+restPublication.ID, restUpdateBody)
	require.Equal(t, http.StatusOK, restUpdate.Code, restUpdate.Body.String())

	_, rpcErr := srv.handler.updatePublication(ctx, "user-1", map[string]any{
		"publication_id":    mcpPublication.ID,
		"expected_revision": 1,
		"title":             "Shared title",
		"source_text":       "Shared source",
		"scheduled_at":      scheduledAt,
		"metadata":          map[string]any{"campaign": "launch"},
	})
	require.Nil(t, rpcErr)

	assertPublicationStateParity(t, srv, restPublication.ID, mcpPublication.ID, 2)

	renditions := []map[string]any{{
		"social_account_id": "account-1",
		"profile":           models.ContentProfileShortText,
		"body":              "Destination copy",
		"settings":          map[string]any{"reply_control": "everyone"},
	}}
	restRenditions := publicationApplicationRequest(ctx, t, restEcho, http.MethodPut, "/api/v1/publications/"+restPublication.ID, map[string]any{
		"expected_revision": 2,
		"renditions":        renditions,
	})
	require.Equal(t, http.StatusOK, restRenditions.Code, restRenditions.Body.String())

	_, rpcErr = srv.handler.setPublicationRenditions(ctx, "user-1", map[string]any{
		"publication_id":    mcpPublication.ID,
		"expected_revision": 2,
		"renditions":        renditions,
	})
	require.Nil(t, rpcErr)

	assertPublicationStateParity(t, srv, restPublication.ID, mcpPublication.ID, 3)
	var restRenditionsStored, mcpRenditionsStored []models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&restRenditionsStored).Where("publication_id = ?", restPublication.ID).Scan(ctx))
	require.NoError(t, srv.db.NewSelect().Model(&mcpRenditionsStored).Where("publication_id = ?", mcpPublication.ID).Scan(ctx))
	require.Len(t, restRenditionsStored, 1)
	require.Len(t, mcpRenditionsStored, 1)
	require.Equal(t, restRenditionsStored[0].SocialAccountID, mcpRenditionsStored[0].SocialAccountID)
	require.Equal(t, restRenditionsStored[0].Profile, mcpRenditionsStored[0].Profile)
	require.Equal(t, restRenditionsStored[0].OutputProfile, mcpRenditionsStored[0].OutputProfile)
	require.Equal(t, restRenditionsStored[0].Body, mcpRenditionsStored[0].Body)
	require.JSONEq(t, restRenditionsStored[0].SettingsJSON, mcpRenditionsStored[0].SettingsJSON)
}

func TestPublicationApplicationUsesOneMutationTimestamp(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := context.Background()
	handler := srv.handler.publicationHandler()
	application := handler.publicationApplicationForTesting()
	createdAt := time.Date(2026, time.August, 9, 8, 0, 0, 0, time.UTC)
	application.now = func() time.Time { return createdAt }
	publication, err := application.Create(ctx, "user-1", CreatePublicationBody{
		WorkspaceID:      "ws-1",
		ContentProfile:   models.ContentProfileShortText,
		SourceText:       "Initial copy",
		SocialAccountIDs: []string{"account-1"},
	})
	require.NoError(t, err)

	updatedAt := createdAt.Add(time.Hour)
	application.now = func() time.Time { return updatedAt }
	updatedCopy := "Updated once"
	require.NoError(t, application.Update(ctx, "user-1", publication.ID, PublicationUpdateBody{
		ExpectedRevision: 1,
		SourceText:       &updatedCopy,
	}))

	var stored models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", publication.ID).Scan(ctx))
	require.Equal(t, 2, stored.Revision)
	require.True(t, stored.UpdatedAt.Equal(updatedAt))
}

func TestPublicationApplicationValidatesBeforeQueueMutation(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := context.Background()
	handler := srv.handler.publicationHandler()
	publication, err := handler.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{
		WorkspaceID:      "ws-1",
		ContentProfile:   models.ContentProfileShortText,
		SourceText:       strings.Repeat("x", 281),
		SocialAccountIDs: []string{"account-1"},
	})
	require.NoError(t, err)
	scheduledAt := time.Now().UTC().Add(time.Hour)
	_, err = srv.db.NewUpdate().Model((*models.Publication)(nil)).
		Set("scheduled_at = ?", scheduledAt).Where("id = ?", publication.ID).Exec(ctx)
	require.NoError(t, err)

	commands := handler.publicationApplication()
	for _, run := range []func() (publicationEnqueueResult, error){
		func() (publicationEnqueueResult, error) {
			return commands.Schedule(ctx, "user-1", publication.ID, 1, providerreadiness.ExecutionIntentProduction)
		},
		func() (publicationEnqueueResult, error) {
			return commands.PublishNow(ctx, "user-1", publication.ID, 1, providerreadiness.ExecutionIntentProduction)
		},
	} {
		result, runErr := run()
		require.Empty(t, result.JobID)
		require.ErrorIs(t, runErr, errPublicationValidationBlocked)
	}

	jobCount, err := srv.db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, jobCount)
	var stored models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", publication.ID).Scan(ctx))
	require.Equal(t, models.PublicationStatusDraft, stored.Status)
}

func TestPublicationApplicationPersistsInheritedRandomDelayAndExactAuthorizationRunAt(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := context.Background()
	_, err := srv.db.NewUpdate().Model((*models.Workspace)(nil)).
		Set("random_delay_minutes = ?", 15).
		Where("id = ?", "ws-1").Exec(ctx)
	require.NoError(t, err)

	handler := srv.handler.publicationHandler()
	scheduledAt := time.Now().UTC().Add(2 * time.Hour).Truncate(time.Second)
	publication, err := handler.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{
		WorkspaceID:      "ws-1",
		ContentProfile:   models.ContentProfileShortText,
		SourceText:       "Delayed publication",
		ScheduledAt:      &scheduledAt,
		SocialAccountIDs: []string{"account-1"},
	})
	require.NoError(t, err)

	result, err := handler.publicationApplication().Schedule(
		ctx, "user-1", publication.ID, 1, providerreadiness.ExecutionIntentProduction,
	)
	require.NoError(t, err)

	var stored models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", publication.ID).Scan(ctx))
	require.Equal(t, 15, stored.RandomDelayMinutes)
	require.False(t, stored.ActualRunAt.IsZero())
	require.WithinDuration(t, scheduledAt, stored.ActualRunAt, 15*time.Minute)

	var job models.Job
	require.NoError(t, srv.db.NewSelect().Model(&job).Where("id = ?", result.JobID).Scan(ctx))
	require.True(t, job.RunAt.Equal(stored.ActualRunAt))
	var authorization models.PublicationAuthorization
	require.NoError(t, srv.db.NewSelect().Model(&authorization).Where("job_id = ?", job.ID).Scan(ctx))
	require.True(t, authorization.ScheduledAt.Equal(job.RunAt))
	scheduledUsage, err := handler.usage.CurrentMonthly(ctx, "ws-1", entitlements.LimitScheduledPostsMonthly, scheduledAt)
	require.NoError(t, err)
	require.Equal(t, int64(1), scheduledUsage, "one Publication counts once regardless of its segments or renditions")
}

func TestPublicationApplicationPersistsExplicitZeroRandomDelay(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := context.Background()
	_, err := srv.db.NewUpdate().Model((*models.Workspace)(nil)).
		Set("random_delay_minutes = ?", 15).
		Where("id = ?", "ws-1").Exec(ctx)
	require.NoError(t, err)

	delay := 0
	scheduledAt := time.Now().UTC().Add(2 * time.Hour).Truncate(time.Second)
	handler := srv.handler.publicationHandler()
	publication, err := handler.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{
		WorkspaceID:        "ws-1",
		ContentProfile:     models.ContentProfileShortText,
		SourceText:         "Exact publication",
		ScheduledAt:        &scheduledAt,
		RandomDelayMinutes: &delay,
		SocialAccountIDs:   []string{"account-1"},
	})
	require.NoError(t, err)
	_, err = handler.publicationApplication().Schedule(
		ctx, "user-1", publication.ID, 1, providerreadiness.ExecutionIntentProduction,
	)
	require.NoError(t, err)

	var stored models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", publication.ID).Scan(ctx))
	require.Equal(t, 0, stored.RandomDelayMinutes)
	require.True(t, stored.ActualRunAt.Equal(scheduledAt))

	delay = 10
	require.NoError(t, handler.publicationApplication().Update(ctx, "user-1", publication.ID, PublicationUpdateBody{
		ExpectedRevision:   1,
		RandomDelayMinutes: &delay,
	}))
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", publication.ID).Scan(ctx))
	require.Equal(t, 10, stored.RandomDelayMinutes)
	require.WithinDuration(t, scheduledAt, stored.ActualRunAt, 10*time.Minute)
	var job models.Job
	require.NoError(t, srv.db.NewSelect().Model(&job).Where("scope_id = ?", publication.ID).Scan(ctx))
	require.True(t, job.RunAt.Equal(stored.ActualRunAt))

	require.NoError(t, handler.publicationApplication().Update(ctx, "user-1", publication.ID, PublicationUpdateBody{
		ExpectedRevision:   2,
		InheritRandomDelay: true,
	}))
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", publication.ID).Scan(ctx))
	require.False(t, stored.RandomDelayExplicit)
	require.Equal(t, 15, stored.RandomDelayMinutes)
	view, err := handler.publicationApplication().Get(ctx, "user-1", publication.ID)
	require.NoError(t, err)
	require.True(t, view.RandomDelayInherited)
}

func TestPublicationApplicationReturnsStableLifecycleErrorCategory(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := context.Background()
	publication, err := srv.handler.publicationHandler().publicationApplication().Create(ctx, "user-1", CreatePublicationBody{
		WorkspaceID: "ws-1", ContentProfile: models.ContentProfileShortText,
		SourceText: "Draft", SocialAccountIDs: []string{"account-1"},
	})
	require.NoError(t, err)

	err = srv.handler.publicationHandler().publicationApplication().Cancel(ctx, "user-1", publication.ID, 1)
	require.Error(t, err)
	category, ok := publicationservice.CategoryOf(err)
	require.True(t, ok)
	require.Equal(t, publicationservice.ErrorInvalidLifecycleState, category)
}

func TestPublicationApplicationCancelsScheduledWork(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := context.Background()
	handler := srv.handler.publicationHandler()
	scheduledAt := time.Now().UTC().Add(2 * time.Hour)
	publication, err := handler.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{
		WorkspaceID: "ws-1", ContentProfile: models.ContentProfileShortText,
		SourceText: "Cancel me", ScheduledAt: &scheduledAt, SocialAccountIDs: []string{"account-1"},
	})
	require.NoError(t, err)
	_, err = handler.publicationApplication().Schedule(
		ctx, "user-1", publication.ID, 1, providerreadiness.ExecutionIntentProduction,
	)
	require.NoError(t, err)

	require.NoError(t, handler.publicationApplication().Cancel(ctx, "user-1", publication.ID, 1))
	var stored models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", publication.ID).Scan(ctx))
	require.Equal(t, models.PublicationStatusDraft, stored.Status)
	require.Equal(t, 2, stored.Revision)
	require.True(t, stored.ScheduledAt.IsZero())
	jobs, err := srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", publication.ID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, jobs)
}

func TestPublicationApplicationActivatesWorkspaceOnceAfterFirstEnqueue(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := context.Background()
	handler := srv.handler.publicationHandler()
	recorder := &telemetry.MemoryRecorder{}
	handler.SetTelemetry(recorder)
	publication, err := handler.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{
		WorkspaceID:      "ws-1",
		ContentProfile:   models.ContentProfileShortText,
		SourceText:       "Activation copy",
		SocialAccountIDs: []string{"account-1"},
	})
	require.NoError(t, err)

	activationCount, err := srv.db.NewSelect().Model((*models.WorkspaceActivation)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, activationCount, "saving a draft must not activate its Workspace")

	scheduledAt := time.Now().UTC().Add(time.Hour)
	_, err = srv.db.NewUpdate().Model((*models.Publication)(nil)).
		Set("scheduled_at = ?", scheduledAt).Where("id = ?", publication.ID).Exec(ctx)
	require.NoError(t, err)
	commands := handler.publicationApplication()
	first, err := commands.Schedule(ctx, "user-1", publication.ID, 1, providerreadiness.ExecutionIntentProduction)
	require.NoError(t, err)
	require.True(t, first.NewlyActivated)
	second, err := commands.Schedule(ctx, "user-1", publication.ID, 1, providerreadiness.ExecutionIntentProduction)
	require.NoError(t, err)
	require.False(t, second.NewlyActivated)
	require.Equal(t, publication.ID, first.ActivationPublicationID)
	require.Equal(t, publication.ID, second.ActivationPublicationID)

	var activations []models.WorkspaceActivation
	require.NoError(t, srv.db.NewSelect().Model(&activations).Scan(ctx))
	require.Len(t, activations, 1)
	require.Equal(t, "ws-1", activations[0].WorkspaceID)
	require.Equal(t, publication.ID, activations[0].PublicationID)
	var analyticsEvents []models.ProductAnalyticsEvent
	require.NoError(t, srv.db.NewSelect().Model(&analyticsEvents).Scan(ctx))
	require.Len(t, analyticsEvents, 1)
	require.Equal(t, telemetry.EventWorkspaceActivated, analyticsEvents[0].Name)
	require.Len(t, recorder.Events, 1)
	require.Equal(t, telemetry.EventWorkspaceActivated, recorder.Events[0].Name)
	require.Equal(t, activations[0].ID, recorder.Events[0].UUID)
}

func TestConcurrentFirstPublicationsRecordOneWorkspaceActivation(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.User)(nil), (*models.Workspace)(nil), (*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil), (*models.Publication)(nil), (*models.Rendition)(nil),
		(*models.Job)(nil), (*models.UsageCounter)(nil), (*models.WorkspaceActivation)(nil), (*models.ProductAnalyticsEvent)(nil),
	)
	// SQLite serializes writers in production; concurrent requests still race
	// for the same canonical transition at the application boundary.
	db.SetMaxOpenConns(1)
	ctx := context.Background()
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.User{ID: "user-1", Email: "concurrent@example.com"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Concurrent"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(ctx)
	require.NoError(t, err)
	seedHandlerAccount(t, db, "account-1", "x")
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("workspace_id = ?", "ws-1").Where("id = ?", "account-1").Exec(ctx)
	require.NoError(t, err)
	publications := []models.Publication{
		{ID: "publication-1", WorkspaceID: "ws-1", CreatedByID: "user-1", SourceText: "One", SourceContent: "One", Status: models.PublicationStatusDraft, Revision: 1, MetadataJSON: "{}", ReleasePlanJSON: "{}", ScheduledAt: now.Add(time.Hour)},
		{ID: "publication-2", WorkspaceID: "ws-1", CreatedByID: "user-1", SourceText: "Two", SourceContent: "Two", Status: models.PublicationStatusDraft, Revision: 1, MetadataJSON: "{}", ReleasePlanJSON: "{}", ScheduledAt: now.Add(2 * time.Hour)},
	}
	_, err = db.NewInsert().Model(&publications).Exec(ctx)
	require.NoError(t, err)
	for _, publication := range publications {
		_, err = db.NewInsert().Model(&models.Rendition{
			ID: "rendition:" + publication.ID, PublicationID: publication.ID, SocialAccountID: "account-1",
			Platform: "x", Profile: models.ContentProfileShortText, Body: publication.SourceText,
			SettingsJSON: "{}", Status: models.RenditionStatusDraft,
		}).Exec(ctx)
		require.NoError(t, err)
	}
	handler := newReadyPublicationHandler(t, db, testAuthenticator{})
	start := make(chan struct{})
	errors := make(chan error, len(publications))
	var wait sync.WaitGroup
	for _, publication := range publications {
		wait.Add(1)
		go func(publicationID string) {
			defer wait.Done()
			<-start
			_, runErr := handler.publicationApplication().Schedule(ctx, "user-1", publicationID, 1, providerreadiness.ExecutionIntentProduction)
			errors <- runErr
		}(publication.ID)
	}
	close(start)
	wait.Wait()
	close(errors)
	for runErr := range errors {
		require.NoError(t, runErr)
	}

	activationCount, err := db.NewSelect().Model((*models.WorkspaceActivation)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, activationCount)
	eventCount, err := db.NewSelect().Model((*models.ProductAnalyticsEvent)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, eventCount)
}

func TestPublicationTransportsRejectViewerMutations(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := context.Background()
	publication, rpcErr := srv.handler.createPublication(ctx, "user-1", map[string]any{
		"workspace_id":       "ws-1",
		"content_profile":    models.ContentProfileShortText,
		"source_text":        "Viewer-safe draft",
		"social_account_ids": []string{"account-1"},
	})
	require.Nil(t, rpcErr)
	publicationID := publication.(map[string]any)["structuredContent"].(map[string]any)["publication"].(mcpPublicationStatus).ID
	_, err := srv.db.NewUpdate().
		Model((*models.WorkspaceMember)(nil)).
		Set("role = ?", models.WorkspaceRoleViewer).
		Where("workspace_id = ? AND user_id = ?", "ws-1", "user-1").
		Exec(ctx)
	require.NoError(t, err)

	restEcho := echo.New()
	api := humaecho.NewWithGroup(restEcho, restEcho.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicationHandler(srv.db, testAuthenticator{}, nil).RegisterRoutes(api)
	restUpdate := publicationApplicationRequest(ctx, t, restEcho, http.MethodPut, "/api/v1/publications/"+publicationID, map[string]any{
		"expected_revision": 1,
		"title":             "Forbidden update",
	})
	require.Equal(t, http.StatusForbidden, restUpdate.Code, restUpdate.Body.String())

	mutations := []func() (any, *mcpError){
		func() (any, *mcpError) {
			return srv.handler.updatePublication(ctx, "user-1", map[string]any{
				"publication_id": publicationID, "expected_revision": 1, "title": "Forbidden update",
			})
		},
		func() (any, *mcpError) {
			return srv.handler.setPublicationRenditions(ctx, "user-1", map[string]any{
				"publication_id": publicationID, "expected_revision": 1,
				"renditions": []map[string]any{{"social_account_id": "account-1", "body": "Forbidden update"}},
			})
		},
		func() (any, *mcpError) {
			return srv.handler.schedulePublication(ctx, "user-1", map[string]any{
				"publication_id": publicationID, "expected_revision": 1,
			})
		},
		func() (any, *mcpError) {
			return srv.handler.publishPublicationNow(ctx, "user-1", map[string]any{
				"publication_id": publicationID, "expected_revision": 1,
			})
		},
	}
	for _, mutate := range mutations {
		result, mutationErr := mutate()
		require.Nil(t, result)
		require.NotNil(t, mutationErr)
		require.Equal(t, -32602, mutationErr.Code)
		require.Equal(t, "workspace editor role required", mutationErr.Message)
	}

	var stored models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", publicationID).Scan(ctx))
	require.Equal(t, 1, stored.Revision)
	require.NotEqual(t, "Forbidden update", stored.Title)
	jobCount, err := srv.db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, jobCount)
}

func TestMCPPublicationCreateHonorsWorkspaceTokenScope(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := contextWithMCPWorkspaceScope(context.Background(), "ws-1")
	result, rpcErr := srv.handler.createPublication(ctx, "user-1", map[string]any{
		"workspace_id":       "ws-2",
		"content_profile":    models.ContentProfileShortText,
		"source_text":        "Must remain scoped",
		"social_account_ids": []string{"account-other-workspace"},
	})
	require.Nil(t, result)
	require.NotNil(t, rpcErr)
	require.Equal(t, -32602, rpcErr.Code)
	require.Equal(t, "workspace outside token scope", rpcErr.Message)

	count, err := srv.db.NewSelect().
		Model((*models.Publication)(nil)).
		Where("workspace_id = ?", "ws-2").
		Where("source_text = ?", "Must remain scoped").
		Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
}

func publicationApplicationRequest(
	ctx context.Context,
	t *testing.T,
	server *echo.Echo,
	method string,
	path string,
	body any,
) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	require.NoError(t, json.NewEncoder(&payload).Encode(body))
	request := httptest.NewRequestWithContext(ctx, method, path, &payload)
	request.Header.Set("Authorization", "Bearer web-token")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	return response
}

func assertPublicationStateParity(t *testing.T, srv *mcpTestServer, restID, mcpID string, revision int) {
	t.Helper()
	ctx := context.Background()
	var restPublication, mcpPublication models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&restPublication).Where("id = ?", restID).Scan(ctx))
	require.NoError(t, srv.db.NewSelect().Model(&mcpPublication).Where("id = ?", mcpID).Scan(ctx))
	require.Equal(t, revision, restPublication.Revision)
	require.Equal(t, revision, mcpPublication.Revision)
	require.Equal(t, restPublication.Title, mcpPublication.Title)
	require.Equal(t, restPublication.ContentProfile, mcpPublication.ContentProfile)
	require.Equal(t, restPublication.SourceText, mcpPublication.SourceText)
	require.Equal(t, restPublication.SourceContent, mcpPublication.SourceContent)
	require.True(t, restPublication.ScheduledAt.Equal(mcpPublication.ScheduledAt))
	require.JSONEq(t, restPublication.MetadataJSON, mcpPublication.MetadataJSON)
	require.JSONEq(t, restPublication.ReleasePlanJSON, mcpPublication.ReleasePlanJSON)
}
