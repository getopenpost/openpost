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
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/uptrace/bun/driver/sqliteshim"
)

var (
	ErrInvalidArchive    = errors.New("the file is not a valid OpenPost backup")
	ErrUnsupportedBackup = errors.New("this backup was made by an incompatible setup")
	ErrBackupTooNew      = errors.New("this backup was made by a newer version of OpenPost")
	ErrKeyMismatch       = errors.New("this backup was made with a different encryption key")
)

type pendingMarker struct {
	Manifest Manifest  `json:"manifest"`
	StagedAt time.Time `json:"staged_at"`
}

type Pending struct {
	Manifest Manifest
	StagedAt time.Time
}

func Stage(ctx context.Context, paths Paths, current Current, upload io.Reader, now time.Time) (Manifest, error) {
	pendingDir := paths.PendingDir()
	if err := os.RemoveAll(pendingDir); err != nil {
		return Manifest{}, fmt.Errorf("clear previous staged restore: %w", err)
	}
	if err := os.MkdirAll(pendingDir, 0o700); err != nil {
		return Manifest{}, fmt.Errorf("create staging directory: %w", err)
	}
	manifest, err := stageInto(ctx, pendingDir, current, upload, now)
	if err != nil {
		_ = os.RemoveAll(pendingDir)
		return Manifest{}, err
	}
	return manifest, nil
}

func stageInto(ctx context.Context, pendingDir string, current Current, upload io.Reader, now time.Time) (Manifest, error) {
	uploadPath := filepath.Join(pendingDir, pendingUploadName)
	uploadFile, err := os.OpenFile(uploadPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return Manifest{}, fmt.Errorf("save uploaded backup: %w", err)
	}
	if _, err := io.Copy(uploadFile, upload); err != nil {
		_ = uploadFile.Close()
		return Manifest{}, fmt.Errorf("save uploaded backup: %w", err)
	}
	if err := uploadFile.Close(); err != nil {
		return Manifest{}, err
	}

	reader, err := zip.OpenReader(uploadPath)
	if err != nil {
		return Manifest{}, ErrInvalidArchive
	}
	defer reader.Close()

	manifest, err := readManifest(reader)
	if err != nil {
		return Manifest{}, err
	}
	if err := checkCompatible(manifest, current); err != nil {
		return Manifest{}, err
	}
	if err := extractArchive(reader, pendingDir, manifest); err != nil {
		return Manifest{}, err
	}
	databasePath := filepath.Join(pendingDir, filepath.FromSlash(databaseEntry))
	if err := checkDatabase(ctx, databasePath, manifest); err != nil {
		return Manifest{}, err
	}
	if err := reader.Close(); err != nil {
		return Manifest{}, err
	}
	if err := os.Remove(uploadPath); err != nil {
		return Manifest{}, err
	}

	marker, err := json.Marshal(pendingMarker{Manifest: manifest, StagedAt: now.UTC()})
	if err != nil {
		return Manifest{}, err
	}
	if err := os.WriteFile(filepath.Join(pendingDir, pendingMarkerName), marker, 0o600); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func readManifest(reader *zip.ReadCloser) (Manifest, error) {
	for _, file := range reader.File {
		if file.Name != manifestEntry {
			continue
		}
		if file.UncompressedSize64 > 1<<20 {
			return Manifest{}, ErrInvalidArchive
		}
		handle, err := file.Open()
		if err != nil {
			return Manifest{}, ErrInvalidArchive
		}
		defer handle.Close()
		var manifest Manifest
		if err := json.NewDecoder(io.LimitReader(handle, 1<<20)).Decode(&manifest); err != nil {
			return Manifest{}, ErrInvalidArchive
		}
		return manifest, nil
	}
	return Manifest{}, ErrInvalidArchive
}

func checkCompatible(manifest Manifest, current Current) error {
	if manifest.FormatVersion != FormatVersion {
		return ErrUnsupportedBackup
	}
	if manifest.DatabaseDriver != current.DatabaseDriver || manifest.StorageDriver != current.StorageDriver {
		return ErrUnsupportedBackup
	}
	if manifest.SchemaVersion > current.SchemaVersion {
		return ErrBackupTooNew
	}
	if manifest.EncryptionKeyFingerprint != current.EncryptionKeyFingerprint {
		return ErrKeyMismatch
	}
	return nil
}

func extractArchive(reader *zip.ReadCloser, pendingDir string, manifest Manifest) error {
	var foundDatabase bool
	var mediaFiles int
	var mediaBytes int64
	for _, file := range reader.File {
		switch {
		case file.Name == manifestEntry:
		case file.Name == databaseEntry:
			foundDatabase = true
			target := filepath.Join(pendingDir, filepath.FromSlash(databaseEntry))
			written, digest, err := extractFile(file, target, manifest.DatabaseBytes)
			if err != nil {
				return err
			}
			if written != manifest.DatabaseBytes || digest != manifest.DatabaseSHA256 {
				return ErrInvalidArchive
			}
		case strings.HasPrefix(file.Name, mediaPrefix):
			if file.FileInfo().IsDir() {
				continue
			}
			relative, ok := safeRelativePath(strings.TrimPrefix(file.Name, mediaPrefix))
			if !ok {
				return ErrInvalidArchive
			}
			remaining := manifest.MediaBytes - mediaBytes
			target := filepath.Join(pendingDir, "media", filepath.FromSlash(relative))
			written, _, err := extractFile(file, target, remaining)
			if err != nil {
				return err
			}
			mediaFiles++
			mediaBytes += written
		default:
			return ErrInvalidArchive
		}
	}
	if !foundDatabase || mediaFiles != manifest.MediaFiles || mediaBytes != manifest.MediaBytes {
		return ErrInvalidArchive
	}
	return nil
}

func safeRelativePath(name string) (string, bool) {
	if name == "" || strings.Contains(name, "\\") || strings.Contains(name, "\x00") {
		return "", false
	}
	cleaned := path.Clean(name)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") || path.IsAbs(cleaned) {
		return "", false
	}
	return cleaned, true
}

func extractFile(file *zip.File, target string, maxBytes int64) (int64, string, error) {
	if maxBytes < 0 || file.UncompressedSize64 > uint64(maxBytes) {
		return 0, "", ErrInvalidArchive
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return 0, "", err
	}
	source, err := file.Open()
	if err != nil {
		return 0, "", ErrInvalidArchive
	}
	defer source.Close()
	destination, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return 0, "", err
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(destination, hash), io.LimitReader(source, maxBytes+1))
	closeErr := destination.Close()
	if copyErr != nil {
		return 0, "", ErrInvalidArchive
	}
	if closeErr != nil {
		return 0, "", closeErr
	}
	if written > maxBytes {
		return 0, "", ErrInvalidArchive
	}
	return written, hex.EncodeToString(hash.Sum(nil)), nil
}

func checkDatabase(ctx context.Context, databasePath string, manifest Manifest) error {
	handle, err := sql.Open(sqliteshim.ShimName, "file:"+filepath.ToSlash(databasePath)+"?mode=ro")
	if err != nil {
		return ErrInvalidArchive
	}
	defer handle.Close()

	var integrity string
	if err := handle.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity); err != nil || integrity != "ok" {
		return ErrInvalidArchive
	}
	var schemaVersion sql.NullInt64
	if err := handle.QueryRowContext(ctx, "SELECT MAX(version) FROM schema_migrations").Scan(&schemaVersion); err != nil {
		return ErrInvalidArchive
	}
	if schemaVersion.Int64 != manifest.SchemaVersion {
		return ErrInvalidArchive
	}
	return nil
}

func ReadPending(paths Paths) (*Pending, error) {
	raw, err := os.ReadFile(filepath.Join(paths.PendingDir(), pendingMarkerName))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var marker pendingMarker
	if err := json.Unmarshal(raw, &marker); err != nil {
		return nil, err
	}
	return &Pending{Manifest: marker.Manifest, StagedAt: marker.StagedAt}, nil
}

func CancelPending(paths Paths) error {
	return os.RemoveAll(paths.PendingDir())
}
