package commands

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/openpost/cli/internal/api"
)

func TestInstanceHealthChecksLivenessAndReadiness(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())

	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/health":
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		case "/api/v1/ready":
			_, _ = w.Write([]byte(`{"status":"ready","database":"ok"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	out, err := executeRootCaptureStdout(t, "--instance", srv.URL, "--json", "instance", "health")
	if err != nil {
		t.Fatalf("instance health returned error: %v", err)
	}

	var got map[string]string
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("decode json output: %v\noutput:\n%s", err, out)
	}
	if got["instance"] != srv.URL {
		t.Fatalf("instance = %q, want %q", got["instance"], srv.URL)
	}
	if got["health"] != "ok" || got["ready"] != "ready" || got["database"] != "ok" {
		t.Fatalf("health output = %#v, want ok/ready/ok", got)
	}
	wantPaths := []string{"/api/v1/health", "/api/v1/ready"}
	if !reflect.DeepEqual(paths, wantPaths) {
		t.Fatalf("paths = %#v, want %#v", paths, wantPaths)
	}
}

func TestInstanceHealthFailsWhenReadinessIsNotReady(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/health":
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		case "/api/v1/ready":
			_, _ = w.Write([]byte(`{"status":"starting","database":"ok"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	_, err := executeRootCaptureStdout(t, "--instance", srv.URL, "instance", "health")
	if err == nil {
		t.Fatal("instance health returned nil error, want readiness failure")
	}
	if !strings.Contains(err.Error(), `readiness: unexpected status "starting"`) {
		t.Fatalf("error = %v, want readiness failure", err)
	}
}

func TestInstanceDiagnosticsWithoutTokenUsesPublicProbes(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())

	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/health":
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		case "/api/v1/ready":
			_, _ = w.Write([]byte(`{"status":"ready","database":"ok"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	out, err := executeRootCaptureStdout(t, "--instance", srv.URL, "--json", "instance", "diagnostics")
	if err != nil {
		t.Fatalf("instance diagnostics returned error: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("decode json output: %v\noutput:\n%s", err, out)
	}
	if got["token"] != false || got["authenticated"] != false {
		t.Fatalf("diagnostics auth fields = %#v", got)
	}
	if got["health"] != "ok" || got["ready"] != "ready" || got["database"] != "ok" {
		t.Fatalf("diagnostics probes = %#v, want ok/ready/ok", got)
	}
	wantPaths := []string{"/api/v1/health", "/api/v1/ready"}
	if !reflect.DeepEqual(paths, wantPaths) {
		t.Fatalf("paths = %#v, want %#v", paths, wantPaths)
	}
}

func TestInstanceDiagnosticsWithTokenIncludesAuthSummary(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())

	var authHeaders []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/health":
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		case "/api/v1/ready":
			_, _ = w.Write([]byte(`{"status":"ready","database":"ok"}`))
		case "/api/v1/auth/me":
			authHeaders = append(authHeaders, r.Header.Get("Authorization"))
			_, _ = w.Write([]byte(`{"id":"user-1","email":"operator@example.com","created_at":"2026-01-01T00:00:00Z"}`))
		case "/api/v1/workspaces":
			authHeaders = append(authHeaders, r.Header.Get("Authorization"))
			_, _ = w.Write([]byte(`[{"id":"ws-1","name":"Production","created_at":"2026-01-01T00:00:00Z"}]`))
		case "/api/v1/accounts/providers":
			authHeaders = append(authHeaders, r.Header.Get("Authorization"))
			_, _ = w.Write([]byte(`[]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	out, err := executeRootCaptureStdout(t, "--instance", srv.URL, "--token", "op_cli_test", "--json", "instance", "diagnostics")
	if err != nil {
		t.Fatalf("instance diagnostics returned error: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("decode json output: %v\noutput:\n%s", err, out)
	}
	if got["token"] != true || got["token_source"] != "flag/env" || got["authenticated"] != true {
		t.Fatalf("diagnostics auth fields = %#v", got)
	}
	if got["user_email"] != "operator@example.com" || got["workspace_count"] != float64(1) {
		t.Fatalf("diagnostics user/workspaces = %#v", got)
	}
	for _, header := range authHeaders {
		if header != "Bearer op_cli_test" {
			t.Fatalf("authorization header = %q, want bearer token", header)
		}
	}
}

func TestInstanceDiagnosticsIncludesProviderCatalog(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/health":
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		case "/api/v1/ready":
			_, _ = w.Write([]byte(`{"status":"ready","database":"ok"}`))
		case "/api/v1/auth/me":
			_, _ = w.Write([]byte(`{"id":"user-1","email":"operator@example.com","created_at":"2026-01-01T00:00:00Z"}`))
		case "/api/v1/workspaces":
			_, _ = w.Write([]byte(`[{"id":"ws-1","name":"Production","created_at":"2026-01-01T00:00:00Z"}]`))
		case "/api/v1/accounts/providers":
			_, _ = w.Write([]byte(`[
				{"platform":"bluesky","display_name":"Bluesky","auth_mode":"app_password","configured":true,"status":"available"},
				{"platform":"youtube","display_name":"YouTube","auth_mode":"oauth","configured":false,"status":"needs_configuration"},
				{"platform":"pinterest","display_name":"Pinterest","auth_mode":"oauth","configured":false,"status":"planned"}
			]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	out, err := executeRootCaptureStdout(
		t,
		"--instance", srv.URL,
		"--token", "op_cli_test",
		"--json",
		"instance", "diagnostics",
		"--provider", "youtube",
	)
	if err != nil {
		t.Fatalf("instance diagnostics returned error: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("decode json output: %v\noutput:\n%s", err, out)
	}
	if got["provider_summary"] != "available=1 needs_configuration=1 planned=1" {
		t.Fatalf("provider_summary = %#v", got["provider_summary"])
	}
	if got["provider_status"] != "YouTube: needs_configuration (not configured)" {
		t.Fatalf("provider_status = %#v", got["provider_status"])
	}
	catalog, ok := got["provider_catalog"].([]any)
	if !ok || len(catalog) != 3 {
		t.Fatalf("provider_catalog = %#v, want 3 entries", got["provider_catalog"])
	}
}

func TestInstanceDiagnosticsIncludesBillingSnapshot(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())

	var billingQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/health":
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		case "/api/v1/ready":
			_, _ = w.Write([]byte(`{"status":"ready","database":"ok"}`))
		case "/api/v1/auth/me":
			_, _ = w.Write([]byte(`{"id":"user-1","email":"operator@example.com","created_at":"2026-01-01T00:00:00Z"}`))
		case "/api/v1/workspaces":
			_, _ = w.Write([]byte(`[{"id":"ws-1","name":"Production","created_at":"2026-01-01T00:00:00Z"}]`))
		case "/api/v1/billing/status":
			billingQuery = r.URL.RawQuery
			_, _ = w.Write([]byte(`{
				"workspace_id":"ws-1",
				"provider":"polar",
				"status":"active",
				"plan_id":"creator",
				"cancel_at_period_end":false,
				"limits":{"scheduled_posts_monthly":500,"social_accounts":6},
				"usage":{"scheduled_posts_monthly":42,"social_accounts":3},
				"period_start":"2026-07-01T00:00:00Z"
			}`))
		case "/api/v1/accounts/providers":
			_, _ = w.Write([]byte(`[]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	out, err := executeRootCaptureStdout(
		t,
		"--instance", srv.URL,
		"--token", "op_cli_test",
		"--workspace", "Production",
		"--json",
		"instance", "diagnostics",
	)
	if err != nil {
		t.Fatalf("instance diagnostics returned error: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("decode json output: %v\noutput:\n%s", err, out)
	}
	if billingQuery != "workspace_id=ws-1" {
		t.Fatalf("billing query = %q, want workspace_id=ws-1", billingQuery)
	}
	if got["billing_workspace_id"] != "ws-1" {
		t.Fatalf("billing_workspace_id = %#v", got["billing_workspace_id"])
	}
	if got["billing_summary"] != "creator; active; scheduled_posts_monthly=42/500, social_accounts=3/6" {
		t.Fatalf("billing_summary = %#v", got["billing_summary"])
	}
	billing, ok := got["billing"].(map[string]any)
	if !ok || billing["plan_id"] != "creator" || billing["status"] != "active" {
		t.Fatalf("billing = %#v", got["billing"])
	}
}

func TestBillingSummaryHelpers(t *testing.T) {
	status := api.BillingStatus{
		Status:            "active",
		PlanID:            "pro",
		CancelAtPeriodEnd: true,
		Limits: map[string]int64{
			"social_accounts":         15,
			"scheduled_posts_monthly": 2500,
		},
		Usage: map[string]int64{
			"social_accounts":         4,
			"scheduled_posts_monthly": 125,
		},
	}

	got := summarizeBillingStatus(status)
	want := "pro; active; canceling; scheduled_posts_monthly=125/2500, social_accounts=4/15"
	if got != want {
		t.Fatalf("summarizeBillingStatus() = %q, want %q", got, want)
	}
}

func TestProviderCatalogSummaryAndLookupHelpers(t *testing.T) {
	providers := []api.ProviderInfo{
		{Platform: "x", DisplayName: "X", Configured: true, Status: "available"},
		{Platform: "youtube", DisplayName: "YouTube", Configured: false, Status: "needs_configuration"},
		{Platform: "pinterest", DisplayName: "Pinterest", Configured: false, Status: "planned"},
		{Platform: "instagram", DisplayName: "Instagram", Configured: false, Status: "disabled"},
	}

	if got := summarizeProviderCatalog(providers); got != "available=1 needs_configuration=1 planned=1 disabled=1" {
		t.Fatalf("summarizeProviderCatalog() = %q", got)
	}
	if got := providerStatusFor(providers, "twitter"); got != "X: available (configured)" {
		t.Fatalf("providerStatusFor(twitter) = %q", got)
	}
	if got := providerStatusFor(providers, "not-a-provider"); got != "not-a-provider: not found" {
		t.Fatalf("providerStatusFor(not-a-provider) = %q", got)
	}
}

func TestInstanceDiagnosticsIncludesRedactedContextAndLogTail(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/health":
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		case "/api/v1/ready":
			_, _ = w.Write([]byte(`{"status":"ready","database":"ok"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	var logs strings.Builder
	for i := 1; i <= 105; i++ {
		_, _ = fmt.Fprintf(&logs, "line %03d\n", i)
	}
	logs.WriteString(`Authorization: Bearer supersecret OPENPOST_JWT_SECRET=abc access_token=tok`)

	logPath := t.TempDir() + "/openpost.log"
	if err := os.WriteFile(logPath, []byte(logs.String()), 0o600); err != nil {
		t.Fatalf("write log fixture: %v", err)
	}

	out, err := executeRootCaptureStdout(
		t,
		"--instance", srv.URL,
		"--json",
		"instance", "diagnostics",
		"--deployment", "docker-compose",
		"--provider", "youtube",
		"--logs-file", logPath,
	)
	if err != nil {
		t.Fatalf("instance diagnostics returned error: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("decode json output: %v\noutput:\n%s", err, out)
	}
	if got["deployment_method"] != "docker-compose" || got["provider"] != "youtube" {
		t.Fatalf("diagnostics context = %#v", got)
	}
	if got["log_tail_line_cap"] != float64(100) {
		t.Fatalf("log_tail_line_cap = %#v, want 100", got["log_tail_line_cap"])
	}
	tail, ok := got["redacted_log_tail"].([]any)
	if !ok || len(tail) != 100 {
		t.Fatalf("redacted_log_tail length = %#v, want 100", got["redacted_log_tail"])
	}
	joinedTail := fmt.Sprint(tail)
	for _, secret := range []string{"supersecret", "OPENPOST_JWT_SECRET=abc", "access_token=tok"} {
		if strings.Contains(joinedTail, secret) {
			t.Fatalf("redacted log tail leaked %q: %s", secret, joinedTail)
		}
	}
	if !strings.Contains(joinedTail, "[redacted]") {
		t.Fatalf("redacted log tail = %s, want redaction marker", joinedTail)
	}
}

func executeRootCaptureStdout(t *testing.T, args ...string) (string, error) {
	t.Helper()

	oldStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("create stdout pipe: %v", err)
	}
	os.Stdout = w
	defer func() {
		os.Stdout = oldStdout
		_ = r.Close()
	}()

	done := make(chan string, 1)
	go func() {
		var buf bytes.Buffer
		_, _ = io.Copy(&buf, r)
		done <- buf.String()
	}()

	root := NewRoot("test")
	root.SetArgs(args)
	execErr := root.Execute()

	_ = w.Close()
	out := <-done
	return out, execErr
}
