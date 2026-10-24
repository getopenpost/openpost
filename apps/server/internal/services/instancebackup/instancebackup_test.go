package instancebackup_test

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/database/migrations"
	"github.com/openpost/backend/internal/services/instancebackup"
	"github.com/uptrace/bun"
)

type fixture struct {
	db      *bun.DB
	paths   instancebackup.Paths
	current instancebackup.Current
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	root := t.TempDir()
	paths := instancebackup.Paths{
		DatabaseFile: filepath.Join(root, "db", "openpost.db"),
		MediaDir:     filepath.Join(root, "media"),
	}
	db, err := database.InitDB("file:" + filepath.ToSlash(paths.DatabaseFile) + "?mode=rwc")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := database.CreateSchema(db); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TABLE backup_probe (value TEXT)"); err != nil {
		t.Fatal(err)
	}
	latest, err := migrations.LatestVersion()
	if err != nil {
		t.Fatal(err)
	}
	return fixture{
		db:    db,
		paths: paths,
		current: instancebackup.Current{
			DatabaseDriver:           "sqlite",
			StorageDriver:            "local",
			SchemaVersion:            latest,
			EncryptionKeyFingerprint: instancebackup.KeyFingerprint("test-key"),
		},
	}
}

func (f fixture) export(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	_, err := instancebackup.WriteArchive(context.Background(), f.db, instancebackup.ExportOptions{
		AppVersion:               "test",
		DatabaseDriver:           f.current.DatabaseDriver,
		StorageDriver:            f.current.StorageDriver,
		EncryptionKeyFingerprint: f.current.EncryptionKeyFingerprint,
		Paths:                    f.paths,
	}, &buffer)
	if err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func writeMedia(t *testing.T, dir, name, content string) {
	t.Helper()
	path := filepath.Join(dir, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestBackupRoundTripRestoresDatabaseAndMedia(t *testing.T) {
	f := newFixture(t)
	if _, err := f.db.Exec("INSERT INTO backup_probe (value) VALUES ('before')"); err != nil {
		t.Fatal(err)
	}
	writeMedia(t, f.paths.MediaDir, "a.png", "original-a")
	writeMedia(t, f.paths.MediaDir, "nested/b.png", "original-b")
	archive := f.export(t)

	if _, err := f.db.Exec("UPDATE backup_probe SET value = 'after'"); err != nil {
		t.Fatal(err)
	}
	writeMedia(t, f.paths.MediaDir, "a.png", "changed-a")
	writeMedia(t, f.paths.MediaDir, "extra.png", "extra")

	now := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	manifest, err := instancebackup.Stage(context.Background(), f.paths, f.current, bytes.NewReader(archive), now)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.MediaFiles != 2 {
		t.Fatalf("media files = %d, want 2", manifest.MediaFiles)
	}
	pending, err := instancebackup.ReadPending(f.paths)
	if err != nil || pending == nil {
		t.Fatalf("pending = %v, err = %v", pending, err)
	}

	if err := f.db.Close(); err != nil {
		t.Fatal(err)
	}
	applied, err := instancebackup.ApplyPending(f.paths, now.Add(time.Minute))
	if err != nil || !applied {
		t.Fatalf("applied = %v, err = %v", applied, err)
	}

	restored, err := database.InitDB("file:" + filepath.ToSlash(f.paths.DatabaseFile) + "?mode=rwc")
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	var value string
	if err := restored.QueryRow("SELECT value FROM backup_probe").Scan(&value); err != nil || value != "before" {
		t.Fatalf("value = %q, err = %v", value, err)
	}
	assertFile(t, filepath.Join(f.paths.MediaDir, "a.png"), "original-a")
	assertFile(t, filepath.Join(f.paths.MediaDir, "nested", "b.png"), "original-b")
	if _, err := os.Stat(filepath.Join(f.paths.MediaDir, "extra.png")); !os.IsNotExist(err) {
		t.Fatalf("extra media survived the restore: %v", err)
	}

	points, err := instancebackup.ListRestorePoints(f.paths)
	if err != nil || len(points) != 1 {
		t.Fatalf("restore points = %v, err = %v", points, err)
	}
	assertFile(t, filepath.Join(filepath.Dir(f.paths.DatabaseFile), points[0].Name, "media", "extra.png"), "extra")
	if _, err := os.Stat(f.paths.PendingDir()); !os.IsNotExist(err) {
		t.Fatalf("staging directory was not cleaned up: %v", err)
	}

	if err := instancebackup.DeleteRestorePoint(f.paths, points[0].Name); err != nil {
		t.Fatal(err)
	}
}

func TestStageRejectsIncompatibleBackups(t *testing.T) {
	f := newFixture(t)
	archive := f.export(t)

	tests := []struct {
		name   string
		mutate func(*instancebackup.Current)
		want   error
	}{
		{"different encryption key", func(c *instancebackup.Current) { c.EncryptionKeyFingerprint = instancebackup.KeyFingerprint("other") }, instancebackup.ErrKeyMismatch},
		{"older application", func(c *instancebackup.Current) { c.SchemaVersion-- }, instancebackup.ErrBackupTooNew},
		{"different storage driver", func(c *instancebackup.Current) { c.StorageDriver = "s3" }, instancebackup.ErrUnsupportedBackup},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			current := f.current
			test.mutate(&current)
			_, err := instancebackup.Stage(context.Background(), f.paths, current, bytes.NewReader(archive), time.Now())
			if !errors.Is(err, test.want) {
				t.Fatalf("err = %v, want %v", err, test.want)
			}
			if _, statErr := os.Stat(f.paths.PendingDir()); !os.IsNotExist(statErr) {
				t.Fatalf("failed staging left files behind: %v", statErr)
			}
		})
	}
}

func TestStageRejectsMalformedArchives(t *testing.T) {
	f := newFixture(t)
	valid := f.export(t)

	var traversal bytes.Buffer
	writer := zip.NewWriter(&traversal)
	entry, _ := writer.Create("media/../../escape.txt")
	_, _ = entry.Write([]byte("x"))
	_ = writer.Close()

	tests := map[string][]byte{
		"not a zip":         []byte("plain text"),
		"empty archive":     emptyZip(t),
		"path traversal":    traversal.Bytes(),
		"truncated archive": valid[:len(valid)/2],
	}
	for name, archive := range tests {
		t.Run(name, func(t *testing.T) {
			_, err := instancebackup.Stage(context.Background(), f.paths, f.current, bytes.NewReader(archive), time.Now())
			if !errors.Is(err, instancebackup.ErrInvalidArchive) {
				t.Fatalf("err = %v, want ErrInvalidArchive", err)
			}
		})
	}
}

func TestApplyPendingWithoutStagedRestoreDoesNothing(t *testing.T) {
	f := newFixture(t)
	applied, err := instancebackup.ApplyPending(f.paths, time.Now())
	if err != nil || applied {
		t.Fatalf("applied = %v, err = %v", applied, err)
	}
}

func TestDeleteRestorePointRejectsOtherNames(t *testing.T) {
	f := newFixture(t)
	if err := instancebackup.DeleteRestorePoint(f.paths, "../db"); err == nil {
		t.Fatal("expected an error for a name outside the restore point pattern")
	}
}

func emptyZip(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	if err := zip.NewWriter(&buffer).Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func assertFile(t *testing.T, path, want string) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil || string(got) != want {
		t.Fatalf("%s = %q, err = %v; want %q", path, got, err, want)
	}
}
