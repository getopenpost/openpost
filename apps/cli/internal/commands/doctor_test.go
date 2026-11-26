package commands

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDoctorReportsReadyConfigWithoutNetwork(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())
	t.Setenv("OPENPOST_TOKEN", "secret-token-value")

	out, err := executeRootCaptureStdout(t,
		"--instance", "https://openpost.example",
		"--workspace", "ws-1",
		"--json", "doctor",
	)
	if err != nil {
		t.Fatalf("doctor returned error: %v", err)
	}
	if strings.Contains(out, "secret-token-value") {
		t.Fatalf("doctor output leaked the token value:\n%s", out)
	}
	var report doctorReport
	if err := json.Unmarshal([]byte(out), &report); err != nil {
		t.Fatalf("decode doctor output: %v\noutput:\n%s", err, out)
	}
	if !report.Ready || !report.InstanceConfigured || !report.TokenConfigured {
		t.Fatalf("doctor report = %#v, want ready", report)
	}
	if report.TokenSource == "" {
		t.Fatalf("doctor report omits the token source: %#v", report)
	}
}

func TestDoctorTableOutputHidesTokenMaterial(t *testing.T) {
	t.Setenv("OPENPOST_CONFIG_DIR", t.TempDir())
	t.Setenv("OPENPOST_TOKEN", "secret-token-value")

	out, err := executeRootCaptureStdout(t,
		"--instance", "https://openpost.example",
		"--workspace", "ws-1",
		"doctor",
	)
	if err != nil {
		t.Fatalf("doctor returned error: %v", err)
	}
	if strings.Contains(out, "secret-token-value") {
		t.Fatalf("doctor table output leaked the token value:\n%s", out)
	}
	if !strings.Contains(out, "Ready") {
		t.Fatalf("doctor table output missing readiness row:\n%s", out)
	}
}
