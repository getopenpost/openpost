package commands

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestMediaDeleteJSONRequiresYes(t *testing.T) {
	_, err := executeRootCaptureStdout(
		t,
		"--instance", "https://openpost.invalid",
		"--token", "op_cli_test",
		"--json",
		"media", "delete", "media-1",
	)
	if err == nil || !strings.Contains(err.Error(), "--yes is required") {
		t.Fatalf("error = %v, want explicit --yes requirement", err)
	}
}

func TestMediaUpdateSendsAltText(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.EscapedPath() != "/api/v1/media/media%2F1" {
			t.Fatalf("request = %s %s", r.Method, r.URL.EscapedPath())
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"message":"media updated successfully"}`))
	}))
	defer srv.Close()

	_, err := executeRootCaptureStdout(
		t,
		"--instance", srv.URL,
		"--token", "op_cli_test",
		"--json",
		"media", "update", "media/1",
		"--alt", "A product screenshot",
	)
	if err != nil {
		t.Fatalf("media update returned error: %v", err)
	}
	if body["alt_text"] != "A product screenshot" {
		t.Fatalf("body = %#v", body)
	}
}

func TestMediaUploadUsesStreamingSession(t *testing.T) {
	content := []byte("media payload")
	filePath := filepath.Join(t.TempDir(), "upload.bin")
	if err := os.WriteFile(filePath, content, 0o600); err != nil {
		t.Fatal(err)
	}
	var steps []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/workspaces":
			steps = append(steps, "workspace")
			_, _ = w.Write([]byte(`[{"id":"ws-1","name":"Team"}]`))
		case "/api/v1/media/upload-session":
			steps = append(steps, "reserve")
			var request struct {
				WorkspaceID string `json:"workspace_id"`
				Filename    string `json:"filename"`
				Size        int64  `json:"size"`
				AltText     string `json:"alt_text"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode reservation: %v", err)
			}
			if request.WorkspaceID != "ws-1" || request.Filename != "upload.bin" || request.Size != int64(len(content)) || request.AltText != "an upload" {
				t.Errorf("reservation = %+v", request)
			}
			_, _ = w.Write([]byte(`{"media_id":"media-1","deduped":false,"complete_url":"/api/v1/media/upload-session/media-1/complete","upload":{"method":"PUT","url":"/api/v1/media/upload-session/media-1/content","headers":{"Content-Type":"application/octet-stream"}}}`))
		case "/api/v1/media/upload-session/media-1/content":
			steps = append(steps, "upload")
			if r.Method != http.MethodPut || r.ContentLength != int64(len(content)) {
				t.Errorf("upload = %s content-length %d", r.Method, r.ContentLength)
			}
			if got := r.Header.Get("Authorization"); got != "Bearer op_cli_test" {
				t.Errorf("upload authorization = %q", got)
			}
			body, err := io.ReadAll(r.Body)
			if err != nil || string(body) != string(content) {
				t.Errorf("uploaded body = %q, err = %v", body, err)
			}
			w.WriteHeader(http.StatusNoContent)
		case "/api/v1/media/upload-session/media-1/complete":
			steps = append(steps, "complete")
			_, _ = w.Write([]byte(`{"id":"media-1","url":"/media/media-1","size":13,"original_filename":"upload.bin","alt_text":"an upload"}`))
		case "/api/v1/media/upload":
			t.Errorf("legacy multipart endpoint used")
			http.Error(w, "legacy upload", http.StatusBadRequest)
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	_, err := executeRootCaptureStdout(t,
		"--instance", srv.URL,
		"--token", "op_cli_test",
		"--workspace", "Team",
		"--json",
		"media", "upload", filePath,
		"--alt", "an upload",
	)
	if err != nil {
		t.Fatalf("media upload returned error: %v", err)
	}
	if got, want := strings.Join(steps, ","), "workspace,reserve,upload,complete"; got != want {
		t.Fatalf("upload steps = %q, want %q", got, want)
	}
}

func TestMediaUploadDoesNotFollowUploadRedirect(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "upload.bin")
	if err := os.WriteFile(filePath, []byte("media payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	var redirectRequests atomic.Int32
	var leakedAuthorization atomic.Bool
	redirectTarget := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirectRequests.Add(1)
		if r.Header.Get("Authorization") != "" {
			leakedAuthorization.Store(true)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer redirectTarget.Close()

	var completed atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/workspaces":
			_, _ = w.Write([]byte(`[{"id":"ws-1","name":"Team"}]`))
		case "/api/v1/media/upload-session":
			_, _ = w.Write([]byte(`{"media_id":"media-1","deduped":false,"complete_url":"/api/v1/media/upload-session/media-1/complete","upload":{"method":"PUT","url":"/api/v1/media/upload-session/media-1/content","headers":{"Content-Type":"application/octet-stream"}}}`))
		case "/api/v1/media/upload-session/media-1/content":
			http.Redirect(w, r, redirectTarget.URL+"/capture", http.StatusFound)
		case "/api/v1/media/upload-session/media-1/complete":
			completed.Store(true)
			_, _ = w.Write([]byte(`{"id":"media-1"}`))
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	_, err := executeRootCaptureStdout(t,
		"--instance", srv.URL,
		"--token", "op_cli_test",
		"--workspace", "Team",
		"--json",
		"media", "upload", filePath,
	)
	if err == nil {
		t.Fatal("media upload followed redirect and succeeded")
	}
	if completed.Load() {
		t.Fatal("media upload completed after its upload target redirected")
	}
	if redirectRequests.Load() != 0 {
		t.Fatalf("redirect target received %d requests", redirectRequests.Load())
	}
	if leakedAuthorization.Load() {
		t.Fatal("API bearer token reached the redirect target")
	}
}
