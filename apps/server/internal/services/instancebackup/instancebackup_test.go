package instancebackup_test

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/database/migrations"
	"github.com/openpost/backend/internal/services/instancebackup"
	"github.com/openpost/backend/internal/testdb"
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
	db, err := testdb.Open("file:" + filepath.ToSlash(paths.DatabaseFile) + "?mode=rwc")
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
