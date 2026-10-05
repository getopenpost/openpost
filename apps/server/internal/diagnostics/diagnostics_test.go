package diagnostics

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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

func TestValidateReportAcceptsAllowlistedPayload(t *testing.T) {
	if err := ValidateReport(validReport()); err != nil {
		t.Fatalf("expected valid report, got %v", err)
	}
}

func TestValidateReportRejectsUnknownErrorCode(t *testing.T) {
	report := validReport()
	report.ErrorCode = "something_broke_badly"
	if err := ValidateReport(report); err == nil {
		t.Fatal("expected unknown error_code to be rejected")
	}
}

func TestValidateReportAcceptsCanonicalProviders(t *testing.T) {
	providers := []string{
		"bluesky", "discord", "facebook", "instagram", "lemmy", "linkedin", "mastodon", "peertube",
		"piefed", "pinterest", "pixelfed", "telegram", "threads", "tiktok", "x", "youtube",
	}
	for _, provider := range providers {
		t.Run(provider, func(t *testing.T) {
			report := validReport()
			report.Provider = provider
			if err := ValidateReport(report); err != nil {
				t.Fatalf("expected canonical provider to be accepted: %v", err)
			}
		})
	}
}

func TestValidateReportRejectsUnknownProvider(t *testing.T) {
	report := validReport()
	report.Provider = "geocities"
	if err := ValidateReport(report); err == nil {
		t.Fatal("expected unknown provider to be rejected")
	}
}

func TestValidateReportRejectsFreeformOperation(t *testing.T) {
	for _, operation := range []string{
		"failed to publish https://example.com/post/1 great post!!",
		"/api/v1/publications?id=1&token=secret",
		"user clicked the red button",
		"",
	} {
		report := validReport()
		report.Operation = operation
		if err := ValidateReport(report); err == nil {
			t.Fatalf("expected operation %q to be rejected", operation)
		}
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

func TestSanitizeReportStripsDomainsAndHomeDirs(t *testing.T) {
	report := validReport()
	report.Frames = []Frame{
		{Module: "https://selfhost.example.com/builds/app/internal/api/routes.go", Function: "handler", Line: 7},
		{Module: "/home/operator/openpost/apps/server/main.go", Function: "main", Line: 9},
		{Module: `C:\Users\operator\openpost\main.go`, Function: "main", Line: 11},
	}
	SanitizeReport(&report)
	for _, frame := range report.Frames {
		if strings.Contains(frame.Module, "selfhost.example.com") ||
			strings.Contains(frame.Module, "operator") ||
			strings.Contains(strings.ToLower(frame.Module), "http") {
			t.Fatalf("sanitized module still leaks origin: %q", frame.Module)
		}
	}
	if err := ValidateReport(report); err != nil {
		t.Fatalf("sanitized report should validate: %v", err)
	}
}

func TestSanitizeReportNormalizesUnknownDrivers(t *testing.T) {
	report := validReport()
	report.DBDriver = "cockroachlabs-managed"
	report.StorageDriver = "ftp://files.internal"
	SanitizeReport(&report)
	if report.DBDriver != "other" || report.StorageDriver != "other" {
		t.Fatalf("expected drivers normalized to other, got %q/%q", report.DBDriver, report.StorageDriver)
	}
	if err := ValidateReport(report); err != nil {
		t.Fatalf("sanitized report should validate: %v", err)
	}
}

func TestDecodeStrictReportRejectsUnknownFields(t *testing.T) {
	payload := `{"installation_id":"0123456789abcdef0123456789abcdef","surface":"backend","operation":"x","error_code":"api_5xx","first_seen":"2026-01-01T00:00:00Z","last_seen":"2026-01-01T00:00:00Z","post_text":"hello world"}`
	if _, err := DecodeStrictReport([]byte(payload), maxReportBodyBytes); err == nil {
		t.Fatal("expected unknown field post_text to be rejected")
	}
}

func TestDecodeStrictReportRejectsOversizedBodies(t *testing.T) {
	if _, err := DecodeStrictReport([]byte(`{"a":1}`), 2); err == nil {
		t.Fatal("expected oversized body to be rejected")
	}
}

func TestLoadOrCreateInstallationIDPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "diagnostics-id")
	first, err := LoadOrCreateInstallationID(path)
	if err != nil {
		t.Fatalf("create installation ID: %v", err)
	}
	if !installationIDPattern.MatchString(first) {
		t.Fatalf("invalid installation ID %q", first)
	}
	second, err := LoadOrCreateInstallationID(path)
	if err != nil {
		t.Fatalf("reload installation ID: %v", err)
	}
	if first != second {
		t.Fatal("installation ID changed across loads")
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat installation ID file: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("installation ID file has permissions %o, want 0600", info.Mode().Perm())
	}
}

func TestLoadOrCreateInstallationIDWithoutPathIsUnknown(t *testing.T) {
	if _, err := LoadOrCreateInstallationID(""); err == nil {
		t.Fatal("expected empty path to report unknown decision")
	}
}

func TestDedupeFirstSendsThenAggregates(t *testing.T) {
	dedupe := NewDeduplicator()
	fixed := time.Now().UTC()
	dedupe.now = func() time.Time { return fixed }

	decision, first := dedupe.Observe(validReport())
	if decision != DedupeSend || first.OccurrenceCount != 1 {
		t.Fatalf("expected first occurrence to send, got decision=%v count=%d", decision, first.OccurrenceCount)
	}
	decision, _ = dedupe.Observe(validReport())
	if decision != DedupeAggregate {
		t.Fatalf("expected repeat to aggregate, got %v", decision)
	}
}

func TestDedupeKeepsDifferentDiagnosticCausesSeparate(t *testing.T) {
	dedupe := NewDeduplicator()
	for _, details := range []struct{ kind, method string }{
		{"deadline_exceeded", http.MethodGet},
		{"permission_denied", http.MethodGet},
		{"deadline_exceeded", http.MethodPost},
	} {
		report := validReport()
		report.ErrorKind = details.kind
		report.HTTPMethod = details.method
		decision, _ := dedupe.Observe(report)
		if decision != DedupeSend {
			t.Fatalf("distinct cause %s / %s was hidden by aggregation", details.kind, details.method)
		}
		decision, _ = dedupe.Observe(report)
		if decision != DedupeAggregate {
			t.Fatal("the same cause should still aggregate")
		}
	}
}

func TestDedupeWindowSummaryCountsOccurrences(t *testing.T) {
	dedupe := NewDeduplicator()
	current := time.Now().UTC()
	dedupe.now = func() time.Time { return current }

	_, _ = dedupe.Observe(validReport())
	_, _ = dedupe.Observe(validReport())
	current = current.Add(dedupeWindow + time.Second)
	decision, summary := dedupe.Observe(validReport())
	if decision != DedupeWindowSummary {
		t.Fatalf("expected window summary, got %v", decision)
	}
	if summary.OccurrenceCount != 2 {
		t.Fatalf("expected occurrence_count=2, got %d", summary.OccurrenceCount)
	}
}

func TestReporterDisabledByDefault(t *testing.T) {
	reporter := NewReporter(Config{})
	defer reporter.Close()
	if reporter.Enabled() {
		t.Fatal("reporter must be disabled without explicit opt-in")
	}
	reporter.Report(validReport())
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

func TestReporterDeliversFirstOccurrence(t *testing.T) {
	received := make(chan Report, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		report, err := DecodeStrictReport(readBody(t, r), maxReportBodyBytes)
		if err != nil {
			t.Errorf("receiver rejected envelope: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		received <- report
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	reporter := NewReporter(Config{
		Enabled:            true,
		ReceiverURL:        server.URL,
		InstallationIDFile: filepath.Join(t.TempDir(), "id"),
		Version:            "9.9.9",
		SendsPerHour:       10,
	})
	defer reporter.Close()
	if !reporter.Enabled() {
		t.Fatal("reporter should be enabled with explicit opt-in and receiver")
	}
	report := validReport()
	report.Operation = "publication_publish"
	report.ErrorCode = CodePublishFailed
	report.Version = ""
	reporter.Report(report)
	reporter.flush()
	select {
	case delivered := <-received:
		if delivered.ErrorCode != CodePublishFailed || delivered.OccurrenceCount != 1 {
			t.Fatalf("unexpected delivered report: %+v", delivered)
		}
		if delivered.Version != "9.9.9" {
			t.Fatalf("expected build version stamped by reporter, got %q", delivered.Version)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected first occurrence to be delivered")
	}
}

func TestReporterDisablingClearsPending(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	reporter := NewReporter(Config{
		Enabled:            true,
		ReceiverURL:        server.URL,
		InstallationIDFile: filepath.Join(t.TempDir(), "id"),
	})
	defer reporter.Close()
	reporter.Report(validReport())
	reporter.SetEnabled(false)
	if reporter.Enabled() {
		t.Fatal("reporter should be disabled after opt-out")
	}
	reporter.mu.Lock()
	pending := len(reporter.queue)
	reporter.mu.Unlock()
	if pending != 0 {
		t.Fatalf("expected pending reports cleared on disable, got %d", pending)
	}
}

func readBody(t *testing.T, r *http.Request) []byte {
	t.Helper()
	body, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatalf("read request body: %v", err)
	}
	return body
}
