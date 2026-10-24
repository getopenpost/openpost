package instancebackup

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"github.com/uptrace/bun"
)

type ExportOptions struct {
	AppVersion               string
	DatabaseDriver           string
	StorageDriver            string
	EncryptionKeyFingerprint string
	Paths                    Paths
	Now                      func() time.Time
}

func WriteArchive(ctx context.Context, db *bun.DB, options ExportOptions, output io.Writer) (Manifest, error) {
	snapshotDir, err := os.MkdirTemp(options.Paths.dataDir(), "backup-export-")
	if err != nil {
		return Manifest{}, fmt.Errorf("create backup workspace: %w", err)
	}
	defer os.RemoveAll(snapshotDir)

	snapshotPath := filepath.Join(snapshotDir, "openpost.db")
	if _, err := db.ExecContext(ctx, "VACUUM INTO ?", snapshotPath); err != nil {
		return Manifest{}, fmt.Errorf("snapshot database: %w", err)
	}

	var schemaVersion sql.NullInt64
	if err := db.NewRaw("SELECT MAX(version) FROM schema_migrations").Scan(ctx, &schemaVersion); err != nil {
		return Manifest{}, fmt.Errorf("read schema version: %w", err)
	}

	now := time.Now
	if options.Now != nil {
		now = options.Now
	}
	manifest := Manifest{
		FormatVersion:            FormatVersion,
		CreatedAt:                now().UTC(),
		AppVersion:               options.AppVersion,
		DatabaseDriver:           options.DatabaseDriver,
		StorageDriver:            options.StorageDriver,
		SchemaVersion:            schemaVersion.Int64,
		EncryptionKeyFingerprint: options.EncryptionKeyFingerprint,
	}

	archive := zip.NewWriter(output)
	if err := writeDatabaseEntry(archive, snapshotPath, &manifest); err != nil {
		return Manifest{}, err
	}
	if err := writeMediaEntries(ctx, archive, options.Paths.MediaDir, &manifest); err != nil {
		return Manifest{}, err
	}
	manifestWriter, err := archive.CreateHeader(&zip.FileHeader{Name: manifestEntry, Method: zip.Deflate, Modified: manifest.CreatedAt})
	if err != nil {
		return Manifest{}, err
	}
	if err := json.NewEncoder(manifestWriter).Encode(manifest); err != nil {
		return Manifest{}, err
	}
	if err := archive.Close(); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func writeDatabaseEntry(archive *zip.Writer, snapshotPath string, manifest *Manifest) error {
	file, err := os.Open(snapshotPath)
	if err != nil {
		return fmt.Errorf("open database snapshot: %w", err)
	}
	defer file.Close()

	writer, err := archive.CreateHeader(&zip.FileHeader{Name: databaseEntry, Method: zip.Deflate, Modified: manifest.CreatedAt})
	if err != nil {
		return err
	}
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(writer, hash), file)
	if err != nil {
		return fmt.Errorf("write database snapshot: %w", err)
	}
	manifest.DatabaseBytes = size
	manifest.DatabaseSHA256 = hex.EncodeToString(hash.Sum(nil))
	return nil
}

func writeMediaEntries(ctx context.Context, archive *zip.Writer, mediaDir string, manifest *Manifest) error {
	if mediaDir == "" {
		return nil
	}
	err := filepath.WalkDir(mediaDir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if errors.Is(walkErr, fs.ErrNotExist) {
				return nil
			}
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		relative, err := filepath.Rel(mediaDir, path)
		if err != nil {
			return err
		}
		size, err := copyFileIntoArchive(archive, path, mediaPrefix+filepath.ToSlash(relative))
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		manifest.MediaFiles++
		manifest.MediaBytes += size
		return nil
	})
	if err != nil {
		return fmt.Errorf("write media files: %w", err)
	}
	return nil
}

func copyFileIntoArchive(archive *zip.Writer, path, name string) (int64, error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return 0, err
	}
	writer, err := archive.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store, Modified: info.ModTime()})
	if err != nil {
		return 0, err
	}
	return io.Copy(writer, file)
}
