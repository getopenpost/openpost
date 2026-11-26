package commands

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAuthTokenListShowsNeverForTokensWithoutExpiry(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())

	listed := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/api-tokens" {
			http.NotFound(w, r)
			return
		}
		listed = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
			{"id":"tok-open","name":"Home server","token_prefix":"aaaa1111","scope":"api:read","created_at":"2026-11-01T00:00:00Z","status":"active"},
			{"id":"tok-dated","name":"CI","token_prefix":"bbbb2222","scope":"api:write","expires_at":"2027-02-01T00:00:00Z","created_at":"2026-11-01T00:00:00Z","status":"active"}
		]`))
	}))
	defer srv.Close()

	out, err := executeRootCaptureStdout(t, "--instance", srv.URL, "--token", "op_cli_test", "auth", "token", "list")
	if err != nil {
		t.Fatalf("auth token list returned error: %v", err)
	}
	if !listed {
		t.Fatal("auth token list did not request /api/v1/api-tokens")
	}
	rows := map[string]string{}
	for line := range strings.SplitSeq(out, "\n") {
		if fields := strings.Fields(line); len(fields) > 0 {
			rows[fields[0]] = line
		}
	}
	if !strings.Contains(rows["tok-open"], "never") {
		t.Fatalf("token without expiry row = %q, want it to show never\noutput:\n%s", rows["tok-open"], out)
	}
	if !strings.Contains(rows["tok-dated"], "2027-02-01T00:00:00Z") || strings.Contains(rows["tok-dated"], "never") {
		t.Fatalf("dated token row = %q, want its expiry date\noutput:\n%s", rows["tok-dated"], out)
	}
}
