package diagnostics

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func validReport() Report {
	now := time.Now().UTC()
	return Report{
		InstallationID: "0123456789abcdef0123456789abcdef",
		Version:        "1.2.3",
		Revision:       "abc123",
		Surface:        SurfaceBackend,
		Operation:      "/api/v1/publications",
		ErrorCode:      CodeAPI5xx,
		HTTPStatus:     500,
		Frames: []Frame{
			{Module: "openpost/backend/internal/api/routes.go", Function: "api.RegisterHumaRoutes", Line: 42},
		},
		FirstSeen: now,
		LastSeen:  now,
	}
}

func TestValidateReportRejectsUnknownProvider(t *testing.T) {
	report := validReport()
	report.Provider = "geocities"
	if err := ValidateReport(report); err == nil {
		t.Fatal("expected unknown provider to be rejected")
	}
}

func TestValidateReportRejectsSensitiveFrames(t *testing.T) {
	report := validReport()
	report.Frames = []Frame{{Module: "https://selfhost.example.com/app/main.go", Function: "main", Line: 1}}
	if err := ValidateReport(report); err == nil {
		t.Fatal("expected frame with custom domain to be rejected before sanitization")
	}
	report.Frames = []Frame{{Module: "app", Function: "run authorization: Bearer secret", Line: 1}}
	if err := ValidateReport(report); err == nil {
		t.Fatal("expected frame with credential text to be rejected")
	}
}

func TestDecodeStrictReportRejectsUnknownFields(t *testing.T) {
	payload := `{"installation_id":"0123456789abcdef0123456789abcdef","surface":"backend","operation":"x","error_code":"api_5xx","first_seen":"2026-01-01T00:00:00Z","last_seen":"2026-01-01T00:00:00Z","post_text":"hello world"}`
	if _, err := DecodeStrictReport([]byte(payload), maxReportBodyBytes); err == nil {
		t.Fatal("expected unknown field post_text to be rejected")
	}
}

func TestDedupeWindowSummaryCountsOccurrences(t *testing.T) {
	dedupe := NewDeduplicator()
	current := time.Now().UTC()
	dedupe.now = func() time.Time { return current }

	decision, first := dedupe.Observe(validReport())
	if decision != DedupeSend || first.OccurrenceCount != 1 {
		t.Fatalf("expected first occurrence to send, got decision=%v count=%d", decision, first.OccurrenceCount)
	}
	decision, _ = dedupe.Observe(validReport())
	if decision != DedupeAggregate {
		t.Fatalf("expected repeat to aggregate, got %v", decision)
	}
	current = current.Add(dedupeWindow + time.Second)
	decision, summary := dedupe.Observe(validReport())
	if decision != DedupeWindowSummary {
		t.Fatalf("expected window summary, got %v", decision)
	}
	if summary.OccurrenceCount != 2 {
		t.Fatalf("expected occurrence_count=2, got %d", summary.OccurrenceCount)
	}
}

func TestReporterEnvKillSwitchWins(t *testing.T) {
	reporter := NewReporter(Config{
		Enabled:            true,
		EnvDisabled:        true,
		ReceiverURL:        "http://127.0.0.1:1",
		InstallationIDFile: filepath.Join(t.TempDir(), "id"),
	})
	defer reporter.Close()
	if reporter.Enabled() {
		t.Fatal("environment kill-switch must win over the enabled flag")
	}
}

func TestReporterDoesNotSendWithoutDecision(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	// Empty installation file path: the decision cannot be established.
	reporter := NewReporter(Config{Enabled: true, ReceiverURL: server.URL})
	defer reporter.Close()
	if reporter.Enabled() {
		t.Fatal("reporter must not be enabled without installation ID persistence")
	}
	reporter.Report(validReport())
	reporter.ReportStartupFailureSync("db_init", CodeStartupFailed)
	time.Sleep(100 * time.Millisecond)
	if calls.Load() != 0 {
		t.Fatalf("expected no diagnostic egress, got %d calls", calls.Load())
	}
}
