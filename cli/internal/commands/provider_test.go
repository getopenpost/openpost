package commands

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProviderCommandExposesOperationalChecks(t *testing.T) {
	cmd := newProviderCmd()
	want := map[string]bool{"list": true, "readiness": true, "capabilities": true}
	for _, child := range cmd.Commands() {
		delete(want, child.Name())
	}
	if len(want) != 0 {
		t.Fatalf("missing provider commands: %v", want)
	}
}

func TestProviderReadinessUsesActiveWorkspace(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/workspaces":
			_, _ = w.Write([]byte(`[{"id":"ws-1","name":"Production"}]`))
		case "/api/v1/provider-readiness":
			if got := r.URL.Query().Get("workspace_id"); got != "ws-1" {
				t.Fatalf("workspace_id = %q, want ws-1", got)
			}
			_, _ = w.Write([]byte(`{"providers":[{"provider":"threads","state":"needs_configuration","configured_app_state":"missing","connected_accounts":0,"blocking_issues":["missing_configuration"]}]}`))
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
		"provider", "readiness",
	)
	if err != nil {
		t.Fatalf("provider readiness returned error: %v", err)
	}
	for _, value := range []string{"threads", "needs_configuration", "missing_configuration", "Configure provider credentials for threads"} {
		if !strings.Contains(out, value) {
			t.Fatalf("output %q missing %q", out, value)
		}
	}
}

func TestProviderCapabilitiesJSONKeepsProfilesAndSettings(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/capabilities" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"profiles":[{"key":"short_video","name":"Short video","description":"Short-form video."}],"capabilities":[{"provider":"tiktok","profile":"short_video","output_profile":"tiktok_video","intents":["short_video"],"media_shapes":["video"],"label":"TikTok video","native_scheduling":false,"openpost_queued":true,"requires_app_review":true,"requires_public_media":true,"media":{"min_count":1,"max_count":1,"allowed_mimes":["video/mp4"],"requires_public_url":true,"requires_https_fetchable":true},"settings":[{"key":"privacy_level","label":"Privacy","scope":"destination"}],"capability_revision":"2026-07"}]}`))
	}))
	defer srv.Close()

	out, err := executeRootCaptureStdout(t, "--instance", srv.URL, "--token", "op_cli_test", "--json", "provider", "capabilities", "--provider", "tiktok")
	if err != nil {
		t.Fatalf("provider capabilities returned error: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if len(got["profiles"].([]any)) != 1 {
		t.Fatalf("profiles = %#v", got["profiles"])
	}
	capability := got["capabilities"].([]any)[0].(map[string]any)
	if capability["provider"] != "tiktok" || len(capability["settings"].([]any)) != 1 {
		t.Fatalf("capability = %#v", capability)
	}
}
