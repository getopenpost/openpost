package commands

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestScheduleCommandExposesSlotLifecycle(t *testing.T) {
	cmd := newScheduleCmd()
	want := map[string]bool{
		"list": true, "create": true, "update": true,
		"delete": true, "suggest": true, "next": true,
	}
	for _, child := range cmd.Commands() {
		delete(want, child.Name())
	}
	if len(want) != 0 {
		t.Fatalf("missing schedule commands: %v", want)
	}
}

func TestScheduleCreateUsesWorkspaceLocalFields(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/workspaces":
			_, _ = w.Write([]byte(`[{"id":"ws-1","name":"Production"}]`))
		case "/api/v1/posting-schedules":
			if r.Method != http.MethodPost {
				t.Fatalf("method = %s, want POST", r.Method)
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			_, _ = w.Write([]byte(`{"id":"slot-1","workspace_id":"ws-1","local_day_of_week":1,"local_hour":9,"local_minute":30,"label":"Morning","is_active":true}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	_, err := executeRootCaptureStdout(
		t,
		"--instance", srv.URL,
		"--token", "op_cli_test",
		"--workspace", "Production",
		"--json",
		"schedule", "create",
		"--day", "1",
		"--hour", "9",
		"--minute", "30",
		"--label", "Morning",
	)
	if err != nil {
		t.Fatalf("schedule create returned error: %v", err)
	}
	if body["workspace_id"] != "ws-1" ||
		body["local_day_of_week"] != float64(1) ||
		body["local_hour"] != float64(9) ||
		body["local_minute"] != float64(30) {
		t.Fatalf("body = %#v, want workspace-local schedule fields", body)
	}
}

func TestScheduleSuggestRequiresExplicitConfirmationInAutomation(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/workspaces":
			_, _ = w.Write([]byte(`[{"id":"ws-1","name":"Production"}]`))
		case "/api/v1/posting-schedules/suggest":
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			_, _ = w.Write([]byte(`{"schedules":[],"message":"Created 14 schedule slots"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	_, err := executeRootCaptureStdout(
		t,
		"--instance", srv.URL,
		"--token", "op_cli_test",
		"--workspace", "Production",
		"--yes",
		"schedule", "suggest",
		"--posts-per-day", "2",
	)
	if err != nil {
		t.Fatalf("schedule suggest returned error: %v", err)
	}
	if body["posts_per_day"] != float64(2) {
		t.Fatalf("body = %#v, want posts_per_day 2", body)
	}
}
