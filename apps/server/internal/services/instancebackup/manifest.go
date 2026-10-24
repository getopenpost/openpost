package instancebackup

import (
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"regexp"
	"time"
)

const (
	FormatVersion = 1

	manifestEntry = "manifest.json"
	databaseEntry = "database/openpost.db"
	mediaPrefix   = "media/"

	pendingDirName     = "restore-pending"
	pendingMarkerName  = "pending.json"
	pendingUploadName  = "upload.zip"
	restorePointPrefix = "pre-restore-"
)

var restorePointNamePattern = regexp.MustCompile(`^pre-restore-\d{8}T\d{6}Z$`)

type Manifest struct {
	FormatVersion            int       `json:"format_version"`
	CreatedAt                time.Time `json:"created_at"`
	AppVersion               string    `json:"app_version"`
	DatabaseDriver           string    `json:"database_driver"`
	StorageDriver            string    `json:"storage_driver"`
	SchemaVersion            int64     `json:"schema_version"`
	DatabaseBytes            int64     `json:"database_bytes"`
	DatabaseSHA256           string    `json:"database_sha256"`
	MediaFiles               int       `json:"media_files"`
	MediaBytes               int64     `json:"media_bytes"`
	EncryptionKeyFingerprint string    `json:"encryption_key_fingerprint"`
}

type Paths struct {
	DatabaseFile string
	MediaDir     string
}

func (p Paths) dataDir() string {
	return filepath.Dir(p.DatabaseFile)
}

func (p Paths) PendingDir() string {
	return filepath.Join(p.dataDir(), pendingDirName)
}

type Current struct {
	DatabaseDriver           string
	StorageDriver            string
	SchemaVersion            int64
	EncryptionKeyFingerprint string
}

func KeyFingerprint(key string) string {
	if key == "" {
		return ""
	}
	sum := sha256.Sum256([]byte("openpost-backup-key:" + key))
	return hex.EncodeToString(sum[:8])
}
