package main

import (
	"encoding/json"

	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/openpost/backend/internal/diagnostics"
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
