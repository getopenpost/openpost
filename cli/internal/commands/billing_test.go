package commands

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBillingStatusCommand(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())

	var billingQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/workspaces":
			_, _ = w.Write([]byte(`[{"id":"ws-1","name":"Production","created_at":"2026-01-01T00:00:00Z"}]`))
		case "/api/v1/billing/status":
			billingQuery = r.URL.RawQuery
			_, _ = w.Write([]byte(`{
				"workspace_id":"ws-1",
				"provider":"polar",
				"status":"active",
				"plan_id":"creator",
				"limits":{"scheduled_posts_monthly":500},
				"usage":{"scheduled_posts_monthly":42},
				"period_start":"2026-07-01T00:00:00Z"
			}`))
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
		"billing", "status",
	)
	if err != nil {
		t.Fatalf("billing status returned error: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("decode json output: %v\noutput:\n%s", err, out)
	}
	if billingQuery != "workspace_id=ws-1" {
		t.Fatalf("billing query = %q, want workspace_id=ws-1", billingQuery)
	}
	if got["workspace_id"] != "ws-1" || got["plan_id"] != "creator" || got["status"] != "active" {
		t.Fatalf("billing status output = %#v", got)
	}
}

func TestBillingCheckoutCommand(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())

	var checkoutBody map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/workspaces":
			_, _ = w.Write([]byte(`[{"id":"ws-1","name":"Production","created_at":"2026-01-01T00:00:00Z"}]`))
		case "/api/v1/billing/checkout":
			if r.Method != http.MethodPost {
				t.Fatalf("checkout method = %s, want POST", r.Method)
			}
			if err := json.NewDecoder(r.Body).Decode(&checkoutBody); err != nil {
				t.Fatalf("decode checkout body: %v", err)
			}
			_, _ = w.Write([]byte(`{"id":"checkout_1","url":"https://polar.sh/checkout/checkout_1"}`))
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
		"billing", "checkout", "creator",
	)
	if err != nil {
		t.Fatalf("billing checkout returned error: %v", err)
	}

	if checkoutBody["workspace_id"] != "ws-1" || checkoutBody["plan_id"] != "creator" {
		t.Fatalf("checkout body = %#v", checkoutBody)
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("decode json output: %v\noutput:\n%s", err, out)
	}
	if got["id"] != "checkout_1" || got["url"] != "https://polar.sh/checkout/checkout_1" {
		t.Fatalf("checkout output = %#v", got)
	}
}

func TestBillingPortalCommand(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())

	var portalBody map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/workspaces":
			_, _ = w.Write([]byte(`[{"id":"ws-1","name":"Production","created_at":"2026-01-01T00:00:00Z"}]`))
		case "/api/v1/billing/portal":
			if r.Method != http.MethodPost {
				t.Fatalf("portal method = %s, want POST", r.Method)
			}
			if err := json.NewDecoder(r.Body).Decode(&portalBody); err != nil {
				t.Fatalf("decode portal body: %v", err)
			}
			_, _ = w.Write([]byte(`{"id":"portal_1","url":"https://polar.sh/portal/portal_1"}`))
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
		"billing", "portal",
	)
	if err != nil {
		t.Fatalf("billing portal returned error: %v", err)
	}

	if portalBody["workspace_id"] != "ws-1" {
		t.Fatalf("portal body = %#v", portalBody)
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("decode json output: %v\noutput:\n%s", err, out)
	}
	if got["id"] != "portal_1" || got["url"] != "https://polar.sh/portal/portal_1" {
		t.Fatalf("portal output = %#v", got)
	}
}
