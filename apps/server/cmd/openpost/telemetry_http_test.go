package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/iotest"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/stretchr/testify/require"
)

func TestTelemetryErrorHandlerCapturesHandledServerErrorsWithoutRawURL(t *testing.T) {
	recorder := &telemetry.MemoryRecorder{}
	e := echo.New()
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		HandleError:   true,
		LogValuesFunc: func(echo.Context, middleware.RequestLoggerValues) error { return nil },
	}))
	installTelemetryErrorHandler(e, recorder, nil)
	e.GET("/things/:id", func(echo.Context) error {
		return errors.New("database unavailable")
	})

	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/things/secret-id?token=secret", nil)
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)

	require.Equal(t, http.StatusInternalServerError, response.Code)
	require.Len(t, recorder.Exceptions, 1)
	require.Equal(t, "/things/:id", recorder.Exceptions[0].Properties["route"])
	require.NotContains(t, recorder.Exceptions[0].Properties, "url")
	require.NotContains(t, recorder.Exceptions[0].Properties, "query")
}

func TestTelemetryPanicBoundaryCapturesOnceWithoutPanicValue(t *testing.T) {
	recorder := &telemetry.MemoryRecorder{}
	e := echo.New()
	e.Use(middleware.RecoverWithConfig(middleware.RecoverConfig{DisablePrintStack: true}))
	e.Use(capturePanics(recorder, nil))
	installTelemetryErrorHandler(e, recorder, nil)
	e.GET("/panic", func(echo.Context) error {
		panic("secret panic value")
	})

	response := httptest.NewRecorder()
	e.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/panic", nil))

	require.Equal(t, http.StatusInternalServerError, response.Code)
	require.Len(t, recorder.Exceptions, 1)
	require.Equal(t, "http_panic", recorder.Exceptions[0].Properties["error_boundary"])
	require.NotContains(t, recorder.Exceptions[0].Description, "secret panic value")
}

func TestTelemetryStreamingFailureUsesCommittedStatusAndRequestCancellation(t *testing.T) {
	cases := []struct {
		name           string
		requestError   error
		streamError    error
		wantExceptions int
	}{
		{name: "storage deadline with active request", streamError: context.DeadlineExceeded, wantExceptions: 1},
		{name: "storage failure", streamError: errors.New("storage unavailable"), wantExceptions: 1},
		{name: "cancelled request", requestError: context.Canceled, streamError: context.Canceled},
		{name: "expired request", requestError: context.DeadlineExceeded, streamError: context.DeadlineExceeded},
		{name: "independent storage failure on cancelled request", requestError: context.Canceled, streamError: errors.New("storage unavailable"), wantExceptions: 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			requestContext := t.Context()
			if tc.requestError == context.Canceled {
				ctx, cancel := context.WithCancel(requestContext)
				cancel()
				requestContext = ctx
			}
			if tc.requestError == context.DeadlineExceeded {
				ctx, cancel := context.WithDeadline(requestContext, time.Now().Add(-time.Second))
				defer cancel()
				requestContext = ctx
			}
			harness, reporter := newDiagnosticsHTTPHarness(t)
			recorder := &telemetry.MemoryRecorder{}
			e := echo.New()
			e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
				HandleError:   true,
				LogValuesFunc: func(echo.Context, middleware.RequestLoggerValues) error { return nil },
			}))
			e.Use(observeDiagnosticFailures(reporter))
			installTelemetryErrorHandler(e, recorder, reporter)
			e.GET("/media/:id", func(c echo.Context) error {
				return c.Stream(http.StatusOK, "video/mp4", iotest.ErrReader(tc.streamError))
			})
			response := httptest.NewRecorder()
			e.ServeHTTP(response, httptest.NewRequestWithContext(requestContext, http.MethodGet, "/media/fixture", nil))
			require.Equal(t, http.StatusOK, response.Code)
			require.Len(t, recorder.Exceptions, tc.wantExceptions)
			reporter.Flush()
			reports := harness.all()
			require.Len(t, reports, tc.wantExceptions)
			if tc.wantExceptions == 0 {
				return
			}
			require.Equal(t, "http_stream_failed", reports[0].ErrorCode)
			require.Equal(t, http.StatusOK, reports[0].HTTPStatus)
			require.Equal(t, "/media/:id", reports[0].Operation)
			require.Equal(t, "OpenPost HTTP response stream failed", recorder.Exceptions[0].Title)
			require.Equal(t, http.StatusOK, recorder.Exceptions[0].Properties["status"])
			require.Equal(t, "http_stream_error", recorder.Exceptions[0].Properties["error_boundary"])
			require.Equal(t, true, recorder.Exceptions[0].Properties["response_committed"])
			require.Equal(t, tc.requestError != nil, recorder.Exceptions[0].Properties["request_context_done"])
			require.Equal(t, "/media/:id", recorder.Exceptions[0].Properties["route"])
			require.NotContains(t, recorder.Exceptions[0].Description, "storage unavailable")
		})
	}
}

func TestTelemetryServerDeadlineWithActiveRequestRemainsFailure(t *testing.T) {
	recorder := &telemetry.MemoryRecorder{}
	e := echo.New()
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		HandleError:   true,
		LogValuesFunc: func(echo.Context, middleware.RequestLoggerValues) error { return nil },
	}))
	installTelemetryErrorHandler(e, recorder, nil)
	e.GET("/media/:id", func(echo.Context) error { return context.DeadlineExceeded })
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/media/fixture", nil)
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)
	require.NoError(t, request.Context().Err())
	require.Equal(t, http.StatusInternalServerError, response.Code)
	require.Len(t, recorder.Exceptions, 1)
	require.Equal(t, "OpenPost HTTP 500", recorder.Exceptions[0].Title)
	require.Equal(t, http.StatusInternalServerError, recorder.Exceptions[0].Properties["status"])
}

func TestTelemetryIndependentStreamFailureSurvivesCancelledRequestWithRealSDK(t *testing.T) {
	batches := make(chan []map[string]any, 1)
	sink := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Batch []map[string]any `json:"batch"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode telemetry batch: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		batches <- body.Batch
		w.WriteHeader(http.StatusOK)
	}))
	defer sink.Close()
	recorder, err := telemetry.New(telemetry.Config{
		Enabled:         true,
		ProjectToken:    "test-public-project-token",
		Endpoint:        sink.URL,
		BrowserEndpoint: sink.URL,
		Environment:     "test",
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = recorder.Close() })
	e := echo.New()
	e.Use(echo.WrapMiddleware(recorder.WrapHTTP))
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		HandleError:   true,
		LogValuesFunc: func(echo.Context, middleware.RequestLoggerValues) error { return nil },
	}))
	installTelemetryErrorHandler(e, recorder, nil)
	e.GET("/media/:id", func(c echo.Context) error {
		ctx, cancel := context.WithCancel(c.Request().Context())
		cancel()
		c.SetRequest(c.Request().WithContext(ctx))
		return c.Stream(http.StatusOK, "video/mp4", iotest.ErrReader(errors.New("storage unavailable")))
	})
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/media/private-id?token=secret", nil)
	const sessionID = "0198a123-4567-7abc-8def-0123456789ab"
	request.Header.Set("X-PostHog-Session-Id", sessionID)
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code)
	require.NoError(t, recorder.Close())
	select {
	case batch := <-batches:
		require.Len(t, batch, 1)
		require.Equal(t, "$exception", batch[0]["event"])
		properties, ok := batch[0]["properties"].(map[string]any)
		require.True(t, ok)
		require.Equal(t, sessionID, properties["$session_id"])
		require.Equal(t, "/media/:id", properties["route"])
		require.Equal(t, float64(http.StatusOK), properties["status"])
		require.Equal(t, true, properties["response_committed"])
		require.Equal(t, true, properties["request_context_done"])
		for _, privateKey := range []string{"url", "query", "$current_url", "$ip", "$user_agent"} {
			require.NotContains(t, properties, privateKey)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("queued stream failure did not reach the local telemetry receiver")
	}
}
