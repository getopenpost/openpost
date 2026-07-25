package mediastore

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type S3Config struct {
	Endpoint        string
	Region          string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	PublicBaseURL   string
	ForcePathStyle  bool
}

type s3ObjectClient interface {
	PutObject(context.Context, *s3.PutObjectInput, ...func(*s3.Options)) (*s3.PutObjectOutput, error)
	DeleteObject(context.Context, *s3.DeleteObjectInput, ...func(*s3.Options)) (*s3.DeleteObjectOutput, error)
	GetObject(context.Context, *s3.GetObjectInput, ...func(*s3.Options)) (*s3.GetObjectOutput, error)
}

type s3PresignClient interface {
	PresignPutObject(context.Context, *s3.PutObjectInput, ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error)
}

type S3Storage struct {
	client        s3ObjectClient
	presignClient s3PresignClient
	bucket        string
	publicBaseURL string
}

func NewS3Storage(ctx context.Context, cfg S3Config) (*S3Storage, error) {
	if strings.TrimSpace(cfg.Bucket) == "" {
		return nil, fmt.Errorf("OPENPOST_S3_BUCKET is required when OPENPOST_STORAGE_DRIVER=s3")
	}
	if strings.TrimSpace(cfg.Region) == "" {
		return nil, fmt.Errorf("OPENPOST_S3_REGION is required when OPENPOST_STORAGE_DRIVER=s3")
	}
	if strings.TrimSpace(cfg.AccessKeyID) == "" {
		return nil, fmt.Errorf("OPENPOST_S3_ACCESS_KEY_ID is required when OPENPOST_STORAGE_DRIVER=s3")
	}
	if strings.TrimSpace(cfg.SecretAccessKey) == "" {
		return nil, fmt.Errorf("OPENPOST_S3_SECRET_ACCESS_KEY is required when OPENPOST_STORAGE_DRIVER=s3")
	}

	awsCfg := aws.Config{
		Region:      cfg.Region,
		Credentials: credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
	}
	client := s3.NewFromConfig(awsCfg, func(options *s3.Options) {
		options.UsePathStyle = cfg.ForcePathStyle
		if cfg.Endpoint != "" {
			options.BaseEndpoint = aws.String(cfg.Endpoint)
		}
	})

	storage := newS3StorageWithClients(client, s3.NewPresignClient(client), cfg)

	// Preserve the ctx parameter in the constructor signature so callers can
	// pass startup-scoped contexts when validation checks are added later.
	_ = ctx

	return storage, nil
}

func newS3StorageWithClient(client s3ObjectClient, cfg S3Config) *S3Storage {
	return newS3StorageWithClients(client, nil, cfg)
}

func newS3StorageWithClients(client s3ObjectClient, presignClient s3PresignClient, cfg S3Config) *S3Storage {
	return &S3Storage{
		client:        client,
		presignClient: presignClient,
		bucket:        cfg.Bucket,
		publicBaseURL: strings.TrimRight(cfg.PublicBaseURL, "/"),
	}
}

func (s *S3Storage) Driver() string {
	return "s3"
}

func (s *S3Storage) Save(id string, reader io.Reader) (string, error) {
	key := cleanObjectKey(id)
	if _, err := s.client.PutObject(context.Background(), &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
		Body:   reader,
	}); err != nil {
		return "", err
	}
	return key, nil
}

func (s *S3Storage) Delete(id string) error {
	_, err := s.client.DeleteObject(context.Background(), &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(cleanObjectKey(id)),
	})
	return err
}

func (s *S3Storage) GetURL(id string) string {
	key := cleanObjectKey(id)
	if s.publicBaseURL == "" {
		return key
	}
	return s.publicBaseURL + "/" + key
}

func (s *S3Storage) Open(id string) (io.ReadCloser, error) {
	out, err := s.client.GetObject(context.Background(), &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(cleanObjectKey(id)),
	})
	if err != nil {
		return nil, err
	}
	return out.Body, nil
}

func (s *S3Storage) CreateDirectUploadSession(ctx context.Context, input DirectUploadInput) (*DirectUploadSession, error) {
	if s.presignClient == nil {
		return nil, fmt.Errorf("direct upload presigner is not configured")
	}
	key := cleanObjectKey(input.Key)
	expiresIn := input.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 15 * time.Minute
	}
	put := &s3.PutObjectInput{
		Bucket:        aws.String(s.bucket),
		Key:           aws.String(key),
		ContentLength: aws.Int64(input.Size),
	}
	if strings.TrimSpace(input.ContentType) != "" {
		put.ContentType = aws.String(input.ContentType)
	}
	presigned, err := s.presignClient.PresignPutObject(ctx, put, func(options *s3.PresignOptions) {
		options.Expires = expiresIn
	})
	if err != nil {
		return nil, err
	}
	return &DirectUploadSession{
		Method:    presigned.Method,
		URL:       presigned.URL,
		Headers:   directUploadHeaders(presigned.SignedHeader),
		Key:       key,
		ExpiresAt: time.Now().UTC().Add(expiresIn),
	}, nil
}

func directUploadHeaders(header http.Header) map[string]string {
	headers := map[string]string{}
	for key, values := range header {
		if strings.EqualFold(key, "host") || len(values) == 0 {
			continue
		}
		headers[key] = strings.Join(values, ",")
	}
	return headers
}

func cleanObjectKey(id string) string {
	return strings.TrimLeft(strings.TrimSpace(id), "/")
}
