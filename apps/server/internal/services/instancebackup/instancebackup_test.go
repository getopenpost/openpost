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
	for _, symlinked := range []bool{false, true} {
		name := "directory"
		if symlinked {
			name = "symlinked media root"
		}
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			if symlinked {
				target := f.paths.MediaDir + "-target"
				if err := os.MkdirAll(target, 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, f.paths.MediaDir); err != nil {
					t.Skipf("symlinks unavailable: %v", err)
				}
			}
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
			if err := instancebackup.ConfirmPending(f.paths); err != nil {
				t.Fatal(err)
			}
			applied, err := instancebackup.ApplyPending(f.paths, f.current, now.Add(time.Minute))
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
		})
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

func TestUploadedBackupRequiresConfirmationAcrossRestart(t *testing.T) {
	f := newFixture(t)
	archive := f.export(t)
	if _, err := instancebackup.Stage(t.Context(), f.paths, f.current, bytes.NewReader(archive), time.Now()); err != nil {
		t.Fatal(err)
	}
	applied, err := instancebackup.ApplyPending(f.paths, f.current, time.Now())
	if err != nil || applied {
		t.Fatalf("unconfirmed upload applied = %v, err = %v", applied, err)
	}
	pending, err := instancebackup.ReadPending(f.paths)
	if err != nil || pending == nil {
		t.Fatalf("unconfirmed upload lost: %v, %v", pending, err)
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

type deletingWriter struct {
	bytes.Buffer
	delete func()
}

func (w *deletingWriter) Write(p []byte) (int, error) {
	if w.delete != nil {
		w.delete()
		w.delete = nil
	}
	return w.Buffer.Write(p)
}

func TestExportKeepsMediaDeletedWhileStreaming(t *testing.T) {
	f := newFixture(t)
	writeMedia(t, f.paths.MediaDir, "photo.png", "original-photo")
	output := &deletingWriter{delete: func() {
		if err := os.Remove(filepath.Join(f.paths.MediaDir, "photo.png")); err != nil {
			t.Fatal(err)
		}
	}}
	manifest, err := instancebackup.WriteArchive(t.Context(), f.db, instancebackup.ExportOptions{
		AppVersion: "test", DatabaseDriver: "sqlite", StorageDriver: "local", Paths: f.paths,
		EncryptionKeyFingerprint: f.current.EncryptionKeyFingerprint,
	}, output)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.MediaFiles != 1 {
		t.Fatalf("export lost snapshotted media: %d files", manifest.MediaFiles)
	}
	if _, err := instancebackup.Stage(t.Context(), f.paths, f.current, bytes.NewReader(output.Bytes()), time.Now()); err != nil {
		t.Fatal(err)
	}
	assertFile(t, filepath.Join(f.paths.PendingDir(), "media", "photo.png"), "original-photo")
}

func TestFailedInstallRecoversCurrentDatabaseAndMedia(t *testing.T) {
	f := newFixture(t)
	if _, err := f.db.Exec("INSERT INTO backup_probe (value) VALUES ('backup')"); err != nil {
		t.Fatal(err)
	}
	writeMedia(t, f.paths.MediaDir, "photo.png", "backup-photo")
	archive := f.export(t)
	if _, err := f.db.Exec("UPDATE backup_probe SET value = 'current'"); err != nil {
		t.Fatal(err)
	}
	writeMedia(t, f.paths.MediaDir, "photo.png", "current-photo")
	if _, err := instancebackup.Stage(t.Context(), f.paths, f.current, bytes.NewReader(archive), time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := instancebackup.ConfirmPending(f.paths); err != nil {
		t.Fatal(err)
	}
	if err := f.db.Close(); err != nil {
		t.Fatal(err)
	}
	// A damaged staging tree makes media installation fail after database install.
	stagedMedia := filepath.Join(f.paths.PendingDir(), "media")
	if err := os.RemoveAll(stagedMedia); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stagedMedia, []byte("damaged"), 0o600); err != nil {
		t.Fatal(err)
	}
	if applied, err := instancebackup.ApplyPending(f.paths, f.current, time.Now()); err == nil || applied {
		t.Fatalf("applied = %v, err = %v", applied, err)
	}
	db, err := database.InitDB("file:" + filepath.ToSlash(f.paths.DatabaseFile) + "?mode=rwc")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var value string
	if err := db.QueryRow("SELECT value FROM backup_probe").Scan(&value); err != nil || value != "current" {
		t.Fatalf("recovered value = %q, err = %v", value, err)
	}
	assertFile(t, filepath.Join(f.paths.MediaDir, "photo.png"), "current-photo")
	pending, err := instancebackup.ReadPending(f.paths)
	if err != nil || pending == nil || pending.Confirmed {
		t.Fatalf("pending = %v, err = %v", pending, err)
	}
}

func TestStartupDoesNotRemoveUnownedRestoreDirectory(t *testing.T) {
	f := newFixture(t)
	f.paths.MediaDir = f.paths.PendingDir()
	writeMedia(t, f.paths.MediaDir, "photo.png", "live-media")
	if applied, err := instancebackup.ApplyPending(f.paths, f.current, time.Now()); err != nil || applied {
		t.Fatalf("startup = %v, %v", applied, err)
	}
	assertFile(t, filepath.Join(f.paths.MediaDir, "photo.png"), "live-media")
}

func TestConfirmedRestoreRechecksStartupCompatibility(t *testing.T) {
	f := newFixture(t)
	archive := f.export(t)
	if _, err := instancebackup.Stage(t.Context(), f.paths, f.current, bytes.NewReader(archive), time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := instancebackup.ConfirmPending(f.paths); err != nil {
		t.Fatal(err)
	}
	changed := f.current
	changed.EncryptionKeyFingerprint = instancebackup.KeyFingerprint("changed-after-upload")
	applied, err := instancebackup.ApplyPending(f.paths, changed, time.Now())
	if applied || !errors.Is(err, instancebackup.ErrKeyMismatch) {
		t.Fatalf("startup = %v, %v; want key mismatch", applied, err)
	}
	points, err := instancebackup.ListRestorePoints(f.paths)
	if err != nil || len(points) != 0 {
		t.Fatalf("incompatible restore touched current data: %v, %v", points, err)
	}
}

func TestEmptyBackupClearsCurrentMedia(t *testing.T) {
	f := newFixture(t)
	archive := f.export(t)
	writeMedia(t, f.paths.MediaDir, "extra.png", "current-media")
	if _, err := instancebackup.Stage(t.Context(), f.paths, f.current, bytes.NewReader(archive), time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := instancebackup.ConfirmPending(f.paths); err != nil {
		t.Fatal(err)
	}
	if err := f.db.Close(); err != nil {
		t.Fatal(err)
	}
	if applied, err := instancebackup.ApplyPending(f.paths, f.current, time.Now()); err != nil || !applied {
		t.Fatalf("applied = %v, err = %v", applied, err)
	}
	entries, err := os.ReadDir(f.paths.MediaDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("media = %v, %v; want empty directory", entries, err)
	}
}

func TestStageRejectsMediaInBackupWorkingDirectories(t *testing.T) {
	for _, name := range []string{"restore-pending", "pre-restore-20261025T120000Z", "backup-export-existing"} {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			archive := f.export(t)
			f.paths.MediaDir = filepath.Join(filepath.Dir(f.paths.DatabaseFile), name)
			writeMedia(t, f.paths.MediaDir, "photo.png", "live-media")
			if _, err := instancebackup.Stage(t.Context(), f.paths, f.current, bytes.NewReader(archive), time.Now()); err == nil {
				t.Fatal("unsafe media layout accepted")
			}
			assertFile(t, filepath.Join(f.paths.MediaDir, "photo.png"), "live-media")
		})
	}
}
