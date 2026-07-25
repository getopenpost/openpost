package mediastore

import (
	"context"
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
