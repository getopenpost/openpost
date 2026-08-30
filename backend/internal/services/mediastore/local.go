package mediastore

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const blobCleanupTimeout = 30 * time.Second

// BlobStorage exposes the S3-compatible interface for all media handles.
type BlobStorage interface {
	Driver() string
	Save(context.Context, string, io.Reader) (string, error)
	Delete(context.Context, string) error
	GetURL(id string) string
	Open(context.Context, string) (io.ReadCloser, error)
}

// RangeBlobStorage is an optional extension for provider resumable uploads.
// It avoids downloading or reading bytes that the provider already committed.
type RangeBlobStorage interface {
	OpenRange(context.Context, string, int64) (io.ReadCloser, error)
}

// ReadinessStorage proves that a required remote storage dependency can perform
// the object lifecycle OpenPost relies on. Implementations should cache the
// result so a health poll does not become one remote operation per request.
type ReadinessStorage interface {
	CheckReady(context.Context) error
}

type Config struct {
	Driver string

	LocalPath string
	BaseURL   string

	S3 S3Config
}

func New(ctx context.Context, cfg Config) (BlobStorage, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.Driver)) {
	case "", "local":
		if err := os.MkdirAll(filepath.Clean(cfg.LocalPath), 0755); err != nil {
			return nil, err
		}
		return NewLocalStorage(cfg.LocalPath, cfg.BaseURL), nil
	case "s3":
		return NewS3Storage(ctx, cfg.S3)
	default:
		return nil, fmt.Errorf("unsupported storage driver %q", cfg.Driver)
	}
}

type LocalStorage struct {
	baseDir string
	baseURL string
}

func NewLocalStorage(baseDir string, baseURL string) *LocalStorage {
	return &LocalStorage{
		baseDir: baseDir,
		baseURL: baseURL,
	}
}

func (s *LocalStorage) Driver() string {
	return "local"
}

func (s *LocalStorage) Save(ctx context.Context, id string, reader io.Reader) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	path, err := s.resolvePath(id)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return "", err
	}

	outFile, err := os.CreateTemp(filepath.Dir(path), ".openpost-upload-*")
	if err != nil {
		return "", err
	}
	temporaryPath := outFile.Name()
	defer os.Remove(temporaryPath)

	if _, err := io.Copy(outFile, contextReader{ctx: ctx, reader: reader}); err != nil {
		_ = outFile.Close()
		return "", err
	}
	if err := ctx.Err(); err != nil {
		_ = outFile.Close()
		return "", err
	}
	if err := outFile.Chmod(0o644); err != nil {
		_ = outFile.Close()
		return "", err
	}
	if err := outFile.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return "", err
	}

	return path, nil
}

// DeleteForCleanup completes a compensating delete after its request was
// canceled. Cleanup stays bounded and does not change normal Delete semantics.
func DeleteForCleanup(ctx context.Context, storage BlobStorage, id string) error {
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), blobCleanupTimeout)
	defer cancel()
	return storage.Delete(cleanupCtx, id)
}

func (s *LocalStorage) Delete(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	path, err := s.resolvePath(id)
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

// GetURL returns the accessible URL for the media asset.
// Example: baseURL could be "/media" mapping to a static Echo route.
func (s *LocalStorage) GetURL(id string) string {
	return s.baseURL + "/" + id
}

func (s *LocalStorage) Open(ctx context.Context, id string) (io.ReadCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	path, err := s.resolvePath(id)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	return &contextFile{File: file, ctx: ctx}, nil
}

func (s *LocalStorage) OpenRange(ctx context.Context, id string, offset int64) (io.ReadCloser, error) {
	if offset < 0 {
		return nil, fmt.Errorf("invalid media offset %d", offset)
	}
	path, err := s.resolvePath(id)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		_ = file.Close()
		return nil, err
	}
	return &contextFile{File: file, ctx: ctx}, nil
}

type contextFile struct {
	*os.File
	ctx context.Context
}

func (f *contextFile) Read(buffer []byte) (int, error) {
	if err := f.ctx.Err(); err != nil {
		return 0, err
	}
	return f.File.Read(buffer)
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(buffer []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(buffer)
}

func (s *LocalStorage) resolvePath(id string) (string, error) {
	if strings.TrimSpace(id) == "" || filepath.IsAbs(id) {
		return "", fmt.Errorf("invalid local storage key %q", id)
	}
	cleaned := filepath.Clean(filepath.FromSlash(id))
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid local storage key %q", id)
	}
	baseDir, err := filepath.Abs(s.baseDir)
	if err != nil {
		return "", fmt.Errorf("resolve local storage directory: %w", err)
	}
	path := filepath.Join(baseDir, cleaned)
	relative, err := filepath.Rel(baseDir, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid local storage key %q", id)
	}
	return path, nil
}
