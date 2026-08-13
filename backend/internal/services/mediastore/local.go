package mediastore

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// BlobStorage exposes the S3-compatible interface for all media handles.
type BlobStorage interface {
	Driver() string
	Save(id string, reader io.Reader) (string, error)
	Delete(id string) error
	GetURL(id string) string
	Open(id string) (io.ReadCloser, error)
}

// RangeBlobStorage is an optional extension for provider resumable uploads.
// It avoids downloading or reading bytes that the provider already committed.
type RangeBlobStorage interface {
	OpenRange(id string, offset int64) (io.ReadCloser, error)
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

func (s *LocalStorage) Save(id string, reader io.Reader) (string, error) {
	path, err := s.resolvePath(id)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return "", err
	}

	outFile, err := os.Create(path)
	if err != nil {
		return "", err
	}
	defer outFile.Close()

	if _, err := io.Copy(outFile, reader); err != nil {
		return "", err
	}

	return path, nil
}

func (s *LocalStorage) Delete(id string) error {
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

func (s *LocalStorage) Open(id string) (io.ReadCloser, error) {
	path, err := s.resolvePath(id)
	if err != nil {
		return nil, err
	}
	return os.Open(path)
}

func (s *LocalStorage) OpenRange(id string, offset int64) (io.ReadCloser, error) {
	if offset < 0 {
		return nil, fmt.Errorf("invalid media offset %d", offset)
	}
	reader, err := s.Open(id)
	if err != nil {
		return nil, err
	}
	file, ok := reader.(*os.File)
	if !ok {
		_ = reader.Close()
		return nil, fmt.Errorf("local media reader does not support seeking")
	}
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		_ = file.Close()
		return nil, err
	}
	return file, nil
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
