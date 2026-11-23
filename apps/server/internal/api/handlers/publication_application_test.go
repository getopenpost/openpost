package handlers

import (
	"bytes"
	"context"
	"encoding/json"

	"net/http/httptest"

	"testing"
	"time"

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
