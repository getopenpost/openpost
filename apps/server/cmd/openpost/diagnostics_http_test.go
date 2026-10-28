package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/diagnostics"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/stretchr/testify/require"
)

type diagnosticsHTTPHarness struct {
	mu      sync.Mutex
	reports []diagnostics.Report
	server  *httptest.Server
}

func newDiagnosticsHTTPHarness(t *testing.T) (*diagnosticsHTTPHarness, *diagnostics.Reporter) {
	t.Helper()
	harness := &diagnosticsHTTPHarness{}
	harness.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var report diagnostics.Report
		if err := json.NewDecoder(r.Body).Decode(&report); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		harness.mu.Lock()
		harness.reports = append(harness.reports, report)
		harness.mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(harness.server.Close)
	reporter := diagnostics.NewReporter(diagnostics.Config{
		Enabled:            true,
		ReceiverURL:        harness.server.URL,
		InstallationIDFile: t.TempDir() + "/diagnostics-id",
		Version:            "test",
		SendsPerHour:       100,
	})
	t.Cleanup(func() { _ = reporter.Close() })
	return harness, reporter
}

func (h *diagnosticsHTTPHarness) all() []diagnostics.Report {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]diagnostics.Report(nil), h.reports...)
}

// TestDiagnosticsObserverDedupesAgainstErrorHandler ensures a handler that
// returns an error (the classic error-hook path) produces exactly one
// diagnostic report, not one per capture layer.
func TestDiagnosticsObserverDedupesAgainstErrorHandler(t *testing.T) {
	harness, reporter := newDiagnosticsHTTPHarness(t)
	e := echo.New()
	e.Use(observeHTTPFailures(nil, reporter))
	installTelemetryErrorHandler(e, &telemetry.MemoryRecorder{}, reporter)
	e.GET("/things/:id", func(echo.Context) error {
		return errors.Join(errors.New("private content and token=secret"), context.DeadlineExceeded)
	})

	response := httptest.NewRecorder()
	e.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/things/secret-id?token=secret", nil))
	require.Equal(t, http.StatusInternalServerError, response.Code)

	reporter.Flush()
	reports := harness.all()
	require.Len(t, reports, 1)
	require.Equal(t, diagnostics.CodeAPI5xx, reports[0].ErrorCode)
	require.Equal(t, "/things/:id", reports[0].Operation, "route template, never the concrete path")
	payload, err := json.Marshal(reports[0])
	require.NoError(t, err)
	require.Contains(t, string(payload), `"error_kind":"deadline_exceeded"`)
	require.NotContains(t, string(payload), "private content")
	require.NotContains(t, string(payload), "token=secret")
}

// TestDiagnosticsObserverIgnoresClientErrors ensures validation errors,
// 404s, and successful responses never reach the channel.
func TestDiagnosticsObserverIgnoresClientErrors(t *testing.T) {
	harness, reporter := newDiagnosticsHTTPHarness(t)
	e := echo.New()
	e.Use(observeHTTPFailures(nil, reporter))
	e.GET("/ok", func(c echo.Context) error {
		return c.String(http.StatusOK, "fine")
	})
	e.GET("/missing", func(_ echo.Context) error {
		return echo.ErrNotFound
	})

	for _, path := range []string{"/ok", "/missing", "/no-route"} {
		response := httptest.NewRecorder()
		e.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil))
	}
	reporter.Flush()
	require.Empty(t, harness.all())
}
