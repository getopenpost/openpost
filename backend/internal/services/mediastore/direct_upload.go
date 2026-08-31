package mediastore

import (
	"context"
	"io"
	"strings"
	"time"
)

type DirectUploadInput struct {
	Key         string
	ContentType string
	Size        int64
	ExpiresIn   time.Duration
}

type DirectUploadSession struct {
	Method    string
	URL       string
	Headers   map[string]string
	Key       string
	ExpiresAt time.Time
}

type DirectUploadStorage interface {
	BlobStorage
	CreateDirectUploadSession(context.Context, DirectUploadInput) (*DirectUploadSession, error)
}

type ContentTypeStorage interface {
	BlobStorage
	SaveWithContentType(context.Context, string, io.Reader, string) (string, error)
}

func SaveWithContentType(ctx context.Context, storage BlobStorage, id string, reader io.Reader, contentType string) (string, error) {
	if typedStorage, ok := storage.(ContentTypeStorage); ok && strings.TrimSpace(contentType) != "" {
		return typedStorage.SaveWithContentType(ctx, id, reader, contentType)
	}
	return storage.Save(ctx, id, reader)
}
