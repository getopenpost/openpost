package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/stretchr/testify/require"
)

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
	api := humaecho.NewV4WithGroup(restEcho, restEcho.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
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

func TestSchedulingRechecksQuotaInsideQueueTransaction(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	createIdempotencyRecordTable(t, srv.db)
	handler := srv.handler.publicationHandler()
	handler.entitlement = entitlements.NewStaticService(entitlements.PlanSnapshot{Limits: map[entitlements.LimitKey]int64{entitlements.LimitScheduledPostsMonthly: 1}})
	scheduledAt := time.Now().UTC().Add(time.Hour)
	publication, err := handler.publicationApplication().Create(t.Context(), "user-1", CreatePublicationBody{WorkspaceID: "ws-1", ContentProfile: models.ContentProfileShortText, SourceText: "Last available scheduled post", ScheduledAt: &scheduledAt, SocialAccountIDs: []string{"account-1"}})
	require.NoError(t, err)
	handler.beforeQueueTransaction = func(ctx context.Context) error {
		_, err := handler.usage.IncrementMonthly(ctx, "ws-1", entitlements.LimitScheduledPostsMonthly, 1, scheduledAt)
		return err
	}
	result, _, err := handler.publicationApplication().ScheduleIdempotent(t.Context(), "user-1", publication.ID, 1, providerreadiness.ExecutionIntentProduction, idempotency.Request{PrincipalID: "token:quota", WorkspaceID: "ws-1", OperationID: "schedule-publication", Key: "last-slot", ExpiresAt: time.Now().Add(time.Hour)})
	require.Error(t, err)
	require.Empty(t, result.JobID)
	count, err := srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", publication.ID).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
	value, err := handler.usage.CurrentMonthly(t.Context(), "ws-1", entitlements.LimitScheduledPostsMonthly, scheduledAt)
	require.NoError(t, err)
	require.Equal(t, int64(1), value)
}
