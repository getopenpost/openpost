package commands

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMediaCommandExposesAttachmentLifecycle(t *testing.T) {
	cmd := newMediaCmd()
	want := map[string]bool{
		"upload": true, "list": true, "update": true,
		"usage": true, "storage": true, "delete": true,
	}
	for _, child := range cmd.Commands() {
		delete(want, child.Name())
	}
	if len(want) != 0 {
		t.Fatalf("missing media commands: %v", want)
	}
}

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
