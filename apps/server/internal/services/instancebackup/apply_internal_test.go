package instancebackup

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestApplyPendingRollsBackAndKeepsStagedRestoreWhenMediaInstallFails(t *testing.T) {
	root := t.TempDir()
	paths := Paths{DatabaseFile: filepath.Join(root, "db", "openpost.db"), MediaDir: filepath.Join(root, "media")}
	writeTestFile(t, paths.DatabaseFile, "current-db")
	writeTestFile(t, filepath.Join(paths.MediaDir, "current.png"), "current-media")
	writeTestFile(t, filepath.Join(paths.PendingDir(), filepath.FromSlash(databaseEntry)), "staged-db")
	writeTestFile(t, filepath.Join(paths.PendingDir(), "media", "staged.png"), "staged-media")
	writeTestFile(t, filepath.Join(paths.PendingDir(), pendingMarkerName), `{"manifest":{"format_version":1}}`)

	original := installMedia
	installMedia = func(string, string) ([]movedEntry, error) { return nil, errors.New("disk full") }
	t.Cleanup(func() { installMedia = original })

	applied, err := ApplyPending(paths, time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC))
	if err == nil || applied {
		t.Fatalf("applied = %v, err = %v; want a failure", applied, err)
	}
	assertTestFile(t, paths.DatabaseFile, "current-db")
	assertTestFile(t, filepath.Join(paths.MediaDir, "current.png"), "current-media")
	assertTestFile(t, filepath.Join(paths.PendingDir(), filepath.FromSlash(databaseEntry)), "staged-db")
	assertTestFile(t, filepath.Join(paths.PendingDir(), "media", "staged.png"), "staged-media")
	if _, err := os.Stat(filepath.Join(paths.PendingDir(), pendingMarkerName)); err != nil {
		t.Fatalf("pending marker was removed: %v", err)
	}
	if points, err := ListRestorePoints(paths); err != nil || len(points) != 0 {
		t.Fatalf("restore points = %v, err = %v; want none after rollback", points, err)
	}

	installMedia = original
	applied, err = ApplyPending(paths, time.Date(2026, 10, 24, 12, 1, 0, 0, time.UTC))
	if err != nil || !applied {
		t.Fatalf("retry applied = %v, err = %v", applied, err)
	}
	assertTestFile(t, paths.DatabaseFile, "staged-db")
	assertTestFile(t, filepath.Join(paths.MediaDir, "staged.png"), "staged-media")
}

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func assertTestFile(t *testing.T, path, want string) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil || string(got) != want {
		t.Fatalf("%s = %q, err = %v; want %q", path, got, err, want)
	}
}
