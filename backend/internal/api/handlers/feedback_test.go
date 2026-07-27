package handlers

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/feedback"
	"github.com/stretchr/testify/require"
)

type feedbackTestDestination struct{}

func (feedbackTestDestination) Deliver(context.Context, feedback.Report) error {
	return nil
}

func TestFeedbackHandlerRequiresAuthenticationAndConfiguredDestination(t *testing.T) {
	e := echo.New()
	group := e.Group("/api/v1")
	group.Use(FeedbackBodyLimitMiddleware)
	api := humaecho.NewWithGroup(e, group, huma.DefaultConfig("Test", "1.0.0"))
	NewFeedbackHandler(feedback.NewService(nil, feedback.Config{
		SupportURL: "https://github.com/rodrgds/openpost/issues/new",
	}, nil), testAuthenticator{}).RegisterRoutes(api)

	anonymous := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/feedback/config", nil)
	anonymousRec := httptest.NewRecorder()
	e.ServeHTTP(anonymousRec, anonymous)
	require.Equal(t, http.StatusUnauthorized, anonymousRec.Code)

	submit := httptest.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		"/api/v1/feedback",
		bytes.NewBufferString(`{"category":"bug","message":"Save failed."}`),
	)
	submit.Header.Set("Authorization", "Bearer web-token")
	submit.Header.Set("Content-Type", "application/json")
	submitRec := httptest.NewRecorder()
	e.ServeHTTP(submitRec, submit)
	require.Equal(t, http.StatusServiceUnavailable, submitRec.Code, submitRec.Body.String())
}

func TestFeedbackHandlerQueuesOptionalReportAndRateLimits(t *testing.T) {
	db := createHandlerTestDB(t, (*models.Job)(nil), (*models.User)(nil))
	_, err := db.ExecContext(context.Background(), `
		CREATE TABLE feedback_rate_limit_windows (
			user_id TEXT NOT NULL,
			window_start TIMESTAMP NOT NULL,
			request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
			PRIMARY KEY (user_id, window_start),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)
	`)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "user@example.com", PasswordHash: "test",
	}).Exec(context.Background())
	require.NoError(t, err)
	service := feedback.NewService(db, feedback.Config{
		Enabled:    true,
		Recipient:  "OpenPost team",
		AppVersion: "1.2.3",
	}, feedbackTestDestination{})
	e := echo.New()
	group := e.Group("/api/v1")
	group.Use(FeedbackBodyLimitMiddleware)
	api := humaecho.NewWithGroup(e, group, huma.DefaultConfig("Test", "1.0.0"))
	NewFeedbackHandler(service, testAuthenticator{}).RegisterRoutes(api)

	for attempt := 0; attempt < feedbackRateLimit; attempt++ {
		submit := httptest.NewRequestWithContext(
			context.Background(),
			http.MethodPost,
			"/api/v1/feedback",
			bytes.NewBufferString(`{"category":"idea","message":"Show destination status sooner."}`),
		)
		submit.Header.Set("Authorization", "Bearer web-token")
		submit.Header.Set("Content-Type", "application/json")
		submitRec := httptest.NewRecorder()
		e.ServeHTTP(submitRec, submit)
		require.Equal(t, http.StatusOK, submitRec.Code, submitRec.Body.String())
		require.Contains(t, submitRec.Body.String(), `"recipient":"OpenPost team"`)
	}

	limited := httptest.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		"/api/v1/feedback",
		bytes.NewBufferString(`{"category":"bug","message":"One too many."}`),
	)
	limited.Header.Set("Authorization", "Bearer web-token")
	limited.Header.Set("Content-Type", "application/json")
	limitedRec := httptest.NewRecorder()
	e.ServeHTTP(limitedRec, limited)
	require.Equal(t, http.StatusTooManyRequests, limitedRec.Code, limitedRec.Body.String())
	allowedAfterRestart, err := feedback.NewService(db, feedback.Config{
		Enabled: true, Recipient: "OpenPost team", AppVersion: "1.2.3",
	}, feedbackTestDestination{}).AllowSubmission(context.Background(), "user-1", feedbackRateLimit, time.Minute)
	require.NoError(t, err)
	require.False(t, allowedAfterRestart)

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Order("run_at ASC").Scan(context.Background()))
	require.Len(t, jobs, feedbackRateLimit)
	for _, job := range jobs {
		require.Equal(t, feedback.JobType, job.Type)
		require.NotContains(t, job.Payload, "authorization")
		require.NotContains(t, job.Payload, "screenshot")
		require.NotContains(t, job.Payload, "diagnostics")
	}
}

func TestFeedbackBodyLimitRejectsOversizedReportsBeforeDecoding(t *testing.T) {
	e := echo.New()
	group := e.Group("/api/v1")
	group.Use(FeedbackBodyLimitMiddleware)
	group.POST("/feedback", func(c echo.Context) error {
		return c.NoContent(http.StatusNoContent)
	})

	request := httptest.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		"/api/v1/feedback",
		bytes.NewReader(make([]byte, maxFeedbackRequestBytes+1)),
	)
	recorder := httptest.NewRecorder()
	e.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusRequestEntityTooLarge, recorder.Code, recorder.Body.String())
}
