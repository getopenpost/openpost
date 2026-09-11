package commands

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPostUpdateUsesPublicationRevision(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())
	var saveBody map[string]any
	saved := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/workspaces":
			_, _ = w.Write([]byte(`[{"id":"ws-1","name":"Production"}]`))
		case "/api/v1/workspaces/ws-1/settings":
			_, _ = w.Write([]byte(`{"timezone":"Europe/Lisbon"}`))
		case "/api/v1/publications/post-1":
			if r.Method == http.MethodGet {
				if saved {
					_, _ = w.Write([]byte(`{"id":"post-1","workspace_id":"ws-1","created_by":"user-1","title":"Updated","content_profile":"short_text","source_text":"Updated","status":"draft","revision":8,"created_at":"2026-07-25T12:00:00Z","updated_at":"2026-07-25T12:00:00Z","renditions":[{"id":"rendition-1","social_account_id":"account-1","platform":"x","profile":"short_text","body":"Updated","status":"pending"}],"media":[]}`))
					return
				}
				_, _ = w.Write([]byte(`{"id":"post-1","workspace_id":"ws-1","created_by":"user-1","title":"Original","content_profile":"short_text","source_text":"Original","status":"draft","revision":7,"created_at":"2026-07-25T12:00:00Z","updated_at":"2026-07-25T12:00:00Z","renditions":[{"id":"rendition-1","social_account_id":"account-1","platform":"x","profile":"short_text","body":"Original","status":"pending"}],"media":[]}`))
				return
			}
			if r.Method != http.MethodPut {
				t.Fatalf("method = %s, want PUT", r.Method)
			}
			if err := json.NewDecoder(r.Body).Decode(&saveBody); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			saved = true
			_, _ = w.Write([]byte(`{"id":"post-1","workspace_id":"ws-1","created_by":"user-1","title":"Updated","content_profile":"short_text","source_text":"Updated","status":"draft","revision":8,"created_at":"2026-07-25T12:00:00Z","updated_at":"2026-07-25T12:00:00Z","renditions":[{"id":"rendition-1","social_account_id":"account-1","platform":"x","profile":"short_text","body":"Updated","status":"pending"}],"media":[]}`))
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
		"post", "update", "post-1",
		"--content", "Updated",
	)
	if err != nil {
		t.Fatalf("post update returned error: %v", err)
	}
	if saveBody["expected_revision"] != float64(7) || saveBody["source_text"] != "Updated" {
		t.Fatalf("save body = %#v", saveBody)
	}
	if !strings.Contains(out, "post-1") || !strings.Contains(out, "draft") {
		t.Fatalf("output = %q", out)
	}
}

func TestResolveMediaInputsPreservesExistingCommaFilenameAndOriginalAltIndex(t *testing.T) {
	path := filepath.Join(t.TempDir(), "launch,final.png")
	if err := os.WriteFile(path, []byte("image"), 0o600); err != nil {
		t.Fatal(err)
	}

	got := resolveMediaInputs([]string{path}, []string{"Launch card"})
	if len(got) != 1 || got[0].value != path || got[0].alt != "Launch card" || !got[0].localFile {
		t.Fatalf("inputs = %#v", got)
	}
}

func TestResolveMediaInputsExpandsCSVMediaIDsWithoutBorrowingOriginalAlt(t *testing.T) {
	got := resolveMediaInputs([]string{"med_one, med_two"}, []string{"not for expanded IDs"})
	if len(got) != 2 || got[0].value != "med_one" || got[1].value != "med_two" {
		t.Fatalf("inputs = %#v", got)
	}
	if got[0].alt != "" || got[1].alt != "" || got[0].localFile || got[1].localFile {
		t.Fatalf("expanded inputs must remain ID-only without alt text: %#v", got)
	}
}

func TestResolveMediaInputsClassifiesCSVLocalFilesWithoutAlt(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(dir, "first.png")
	second := filepath.Join(dir, "second.png")
	for _, path := range []string{first, second} {
		if err := os.WriteFile(path, []byte("image"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	got := resolveMediaInputs([]string{first + "," + second}, []string{"not for expanded files"})
	if len(got) != 2 || got[0].value != first || got[1].value != second {
		t.Fatalf("inputs = %#v", got)
	}
	if !got[0].localFile || !got[1].localFile || got[0].alt != "" || got[1].alt != "" {
		t.Fatalf("expanded local files must not receive alt text: %#v", got)
	}
}

func TestParseThreadMarkdown(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantFM   threadFrontMatter
		wantBody []string
		wantErr  string
	}{
		{
			name:  "front-matter plus three posts",
			input: "---\nworkspace: personal\naccounts: x,linkedin\nschedule: tomorrow 2pm\nrandom_delay: 7\n---\nOne\n---\nTwo\n---\nThree\n",
			wantFM: threadFrontMatter{
				Workspace:   "personal",
				Accounts:    "x,linkedin",
				Schedule:    "tomorrow 2pm",
				RandomDelay: 7,
			},
			wantBody: []string{"One", "Two", "Three"},
		},
		{
			name:     "no front-matter plus two posts",
			input:    "One\n---\nTwo\n",
			wantBody: []string{"One", "Two"},
		},
		{
			name:     "embedded dashes inside post body",
			input:    "One --- still one\n---\nTwo\n",
			wantBody: []string{"One --- still one", "Two"},
		},
		{
			name:    "empty segment rejected",
			input:   "One\n---\n \n---\nThree\n",
			wantErr: "thread segment 2 is empty",
		},
		{
			name:     "mixed CRLF and LF",
			input:    "One\r\n---\nTwo\r\n---\nThree",
			wantBody: []string{"One", "Two", "Three"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotFM, gotBody, err := parseThreadMarkdown(tt.input)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("error = %v, want containing %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if gotFM != tt.wantFM {
				t.Fatalf("frontmatter = %#v, want %#v", gotFM, tt.wantFM)
			}
			if strings.Join(gotBody, "\n---\n") != strings.Join(tt.wantBody, "\n---\n") {
				t.Fatalf("segments = %#v, want %#v", gotBody, tt.wantBody)
			}
		})
	}
}

func TestPostCreateScheduleFailureRecovery(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())
	creates, schedules := 0, 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.Path {
		case "GET /api/v1/workspaces":
			_, _ = w.Write([]byte(`[{"id":"ws-1","name":"Production"}]`))
		case "GET /api/v1/workspaces/ws-1/settings":
			_, _ = w.Write([]byte(`{"timezone":"Europe/Lisbon"}`))
		case "GET /api/v1/media":
			_, _ = w.Write([]byte(`[]`))
		case "POST /api/v1/publications":
			creates++
			_, _ = w.Write([]byte(`{"id":"post-1","revision":1,"status":"draft"}`))
		case "POST /api/v1/publications/post-1/schedule":
			schedules++
			if schedules == 1 {
				http.Error(w, `{"detail":"queue unavailable"}`, http.StatusServiceUnavailable)
				return
			}
			_, _ = w.Write([]byte(`{"message":"Scheduled","job_id":"job-1"}`))
		case "GET /api/v1/publications/post-1":
			_, _ = w.Write([]byte(`{"id":"post-1","revision":1,"status":"draft"}`))
		case "PUT /api/v1/publications/post-1":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["scheduled_at"] != "2099-01-02T12:00:00Z" {
				t.Errorf("recovery time = %v", body["scheduled_at"])
			}
			_, _ = w.Write([]byte(`{"id":"post-1","revision":2,"status":"draft"}`))
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	args := []string{"--instance", srv.URL, "--token", "op_cli_test", "--workspace", "Production"}
	_, err := executeRootCaptureStdout(t, append(args, "post", "create", "--content", "Hello", "--schedule", "2099-01-02T12:00:00Z")...)
	recovery := "openpost post schedule post-1 --at 2099-01-02T12:00:00Z"
	if err == nil || !strings.Contains(err.Error(), "draft created") || !strings.Contains(err.Error(), recovery) || !strings.Contains(err.Error(), "queue unavailable") {
		t.Fatalf("expected partial success and recovery command, got %v", err)
	}
	_, err = executeRootCaptureStdout(t, append(args, strings.Fields(strings.TrimPrefix(recovery, "openpost "))...)...)
	if err != nil {
		t.Fatalf("recovery failed: %v", err)
	}
	if creates != 1 || schedules != 2 {
		t.Fatalf("creates=%d schedules=%d", creates, schedules)
	}
}

func TestPostCreateReportsAcceptedScheduleWhenStatusLookupFails(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.Path {
		case "GET /api/v1/workspaces":
			_, _ = w.Write([]byte(`[{"id":"ws-1","name":"Production"}]`))
		case "GET /api/v1/workspaces/ws-1/settings":
			_, _ = w.Write([]byte(`{"timezone":"Europe/Lisbon"}`))
		case "GET /api/v1/media":
			_, _ = w.Write([]byte(`[]`))
		case "POST /api/v1/publications":
			_, _ = w.Write([]byte(`{"id":"post-1","revision":1,"status":"draft"}`))
		case "POST /api/v1/publications/post-1/schedule":
			_, _ = w.Write([]byte(`{"message":"Scheduled","job_id":"job-1"}`))
		case "GET /api/v1/publications/post-1":
			http.Error(w, `{"detail":"status unavailable"}`, http.StatusServiceUnavailable)
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	_, err := executeRootCaptureStdout(t, "--instance", srv.URL, "--token", "op_cli_test", "--workspace", "Production", "post", "create", "--content", "Hello", "--schedule", "2099-01-02T12:00:00Z")
	if err == nil || !strings.Contains(err.Error(), "created and scheduling accepted") || !strings.Contains(err.Error(), "openpost post view post-1") || !strings.Contains(err.Error(), "status unavailable") {
		t.Fatalf("expected accepted schedule and status recovery command, got %v", err)
	}
}
