package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type postQuotaTestServer struct {
	echo  *echo.Echo
	db    *bun.DB
	usage *usage.Service
}

type postQuotaAuthenticator struct{}

func (postQuotaAuthenticator) AuthenticateBearer(_ context.Context, token string) (*middleware.Principal, error) {
	if token != "web-token" {
		return nil, fmt.Errorf("invalid token")
	}
	return &middleware.Principal{UserID: "user-1", Email: "user@example.com", SessionID: "session-1"}, nil
}

func newPostQuotaTestServer(t *testing.T, entitlement entitlements.Service) *postQuotaTestServer {
	t.Helper()

	db := createHandlerTestDB(
		t,
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.Job)(nil),
		(*models.ThreadDraft)(nil),
		(*models.UsageCounter)(nil),
		(*models.User)(nil),
		(*models.MediaAttachment)(nil),
		(*models.Publication)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "user@example.com", PasswordHash: "hash",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID:             "account-1",
		WorkspaceID:    "ws-1",
		Slug:           "main",
		Platform:       "x",
		AccountID:      "x-1",
		AccessTokenEnc: []byte("token"),
		IsActive:       true,
	}).Exec(ctx)
	require.NoError(t, err)

	usageSvc := usage.NewService(db)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewPostHandler(db, postQuotaAuthenticator{}, entitlement)
	handler.SetUsage(usageSvc)
	handler.CreatePost(api)
	handler.CreateThread(api)

	return &postQuotaTestServer{echo: e, db: db, usage: usageSvc}
}

func (s *postQuotaTestServer) createPost(t *testing.T, scheduledAt *time.Time) *httptest.ResponseRecorder {
	t.Helper()

	body := map[string]any{
		"workspace_id":       "ws-1",
		"content":            "Launch post",
		"social_account_ids": []string{"account-1"},
	}
	if scheduledAt != nil {
		body["scheduled_at"] = scheduledAt.Format(time.RFC3339)
	}

	var payload bytes.Buffer
	require.NoError(t, json.NewEncoder(&payload).Encode(body))
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/posts", &payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func (s *postQuotaTestServer) createThread(t *testing.T, scheduledAt *time.Time, posts int) *httptest.ResponseRecorder {
	t.Helper()

	threadPosts := make([]map[string]any, 0, posts)
	for i := 0; i < posts; i++ {
		threadPosts = append(threadPosts, map[string]any{"content": "Thread post"})
	}
	body := map[string]any{
		"workspace_id":       "ws-1",
		"social_account_ids": []string{"account-1"},
		"posts":              threadPosts,
	}
	if scheduledAt != nil {
		body["scheduled_at"] = scheduledAt.Format(time.RFC3339)
	}

	var payload bytes.Buffer
	require.NoError(t, json.NewEncoder(&payload).Encode(body))
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/posts/thread", &payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func TestCreatePostRejectsScheduledPostQuota(t *testing.T) {
	t.Parallel()

	scheduledAt := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second)
	srv := newPostQuotaTestServer(t, entitlements.NewStaticService(entitlements.PlanSnapshot{
		Limits: map[entitlements.LimitKey]int64{
			entitlements.LimitScheduledPostsMonthly: 1,
		},
	}))
	_, err := srv.usage.IncrementMonthly(context.Background(), "ws-1", entitlements.LimitScheduledPostsMonthly, 1, scheduledAt)
	require.NoError(t, err)

	resp := srv.createPost(t, &scheduledAt)

	require.Equal(t, http.StatusPaymentRequired, resp.Code)
	require.Contains(t, resp.Body.String(), "scheduled_posts_monthly limit exceeded")
	var count int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("posts").Scan(context.Background(), &count))
	require.Equal(t, 0, count)
}

func TestCreatePostIncrementsScheduledUsage(t *testing.T) {
	t.Parallel()

	scheduledAt := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second)
	srv := newPostQuotaTestServer(t, entitlements.NewSelfHostedService())

	resp := srv.createPost(t, &scheduledAt)
	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	current, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitScheduledPostsMonthly, scheduledAt)
	require.NoError(t, err)
	require.Equal(t, int64(1), current)
	var job models.Job
	require.NoError(t, srv.db.NewSelect().Model(&job).Where("type = ?", "publish_publication").Scan(t.Context()))
	require.NotEmpty(t, job.ScopeID)
	var payload map[string]any
	require.NoError(t, json.Unmarshal([]byte(job.Payload), &payload))
	batchID, ok := payload["authorization_batch_id"].(string)
	require.True(t, ok)
	require.NotEmpty(t, batchID)
	var receipt models.PublicationAuthorization
	require.NoError(t, srv.db.NewSelect().Model(&receipt).Where("batch_id = ?", batchID).Scan(t.Context()))
	require.Equal(t, "browser", receipt.ActorOrigin)
	require.Equal(t, "session-1", receipt.ActorSessionID)
	require.Equal(t, job.ID, receipt.JobID)
}

func TestCreateDraftDoesNotIncrementScheduledUsage(t *testing.T) {
	t.Parallel()

	srv := newPostQuotaTestServer(t, entitlements.NewSelfHostedService())

	resp := srv.createPost(t, nil)

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	current, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitScheduledPostsMonthly, time.Now())
	require.NoError(t, err)
	require.Equal(t, int64(0), current)
}

func TestCreateThreadRejectsScheduledPostQuotaForAllThreadPosts(t *testing.T) {
	t.Parallel()

	scheduledAt := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second)
	srv := newPostQuotaTestServer(t, entitlements.NewStaticService(entitlements.PlanSnapshot{
		Limits: map[entitlements.LimitKey]int64{
			entitlements.LimitScheduledPostsMonthly: 2,
		},
	}))

	resp := srv.createThread(t, &scheduledAt, 3)

	require.Equal(t, http.StatusPaymentRequired, resp.Code)
	require.Contains(t, resp.Body.String(), "scheduled_posts_monthly limit exceeded")
	var count int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("posts").Scan(context.Background(), &count))
	require.Equal(t, 0, count)
}

func TestCreateThreadIncrementsScheduledUsageForEachThreadPost(t *testing.T) {
	t.Parallel()

	scheduledAt := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second)
	srv := newPostQuotaTestServer(t, entitlements.NewSelfHostedService())

	resp := srv.createThread(t, &scheduledAt, 3)

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	current, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitScheduledPostsMonthly, scheduledAt)
	require.NoError(t, err)
	require.Equal(t, int64(3), current)
}
