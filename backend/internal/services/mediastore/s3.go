package mediastore

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

const (
	s3MultipartPartSize    = 8 * 1024 * 1024
	defaultS3CallTimeout   = 2 * time.Minute
	defaultS3ReadyTimeout  = 5 * time.Second
	defaultS3ReadyCacheTTL = 30 * time.Second
	failedS3ReadyCacheTTL  = 5 * time.Second
)

type S3Config struct {
	Endpoint          string
	Region            string
	Bucket            string
	AccessKeyID       string
	SecretAccessKey   string
	PublicBaseURL     string
	ForcePathStyle    bool
	RequestTimeout    time.Duration
	ReadinessTimeout  time.Duration
	ReadinessCacheTTL time.Duration
}

type s3ObjectClient interface {
	PutObject(context.Context, *s3.PutObjectInput, ...func(*s3.Options)) (*s3.PutObjectOutput, error)
	DeleteObject(context.Context, *s3.DeleteObjectInput, ...func(*s3.Options)) (*s3.DeleteObjectOutput, error)
	GetObject(context.Context, *s3.GetObjectInput, ...func(*s3.Options)) (*s3.GetObjectOutput, error)
}

type s3PresignClient interface {
	PresignPutObject(context.Context, *s3.PutObjectInput, ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error)
}

type s3MultipartClient interface {
	CreateMultipartUpload(context.Context, *s3.CreateMultipartUploadInput, ...func(*s3.Options)) (*s3.CreateMultipartUploadOutput, error)
	UploadPart(context.Context, *s3.UploadPartInput, ...func(*s3.Options)) (*s3.UploadPartOutput, error)
	CompleteMultipartUpload(context.Context, *s3.CompleteMultipartUploadInput, ...func(*s3.Options)) (*s3.CompleteMultipartUploadOutput, error)
	AbortMultipartUpload(context.Context, *s3.AbortMultipartUploadInput, ...func(*s3.Options)) (*s3.AbortMultipartUploadOutput, error)
}

type S3Storage struct {
	client             s3ObjectClient
	presignClient      s3PresignClient
	multipartClient    s3MultipartClient
	bucket             string
	publicBaseURL      string
	requestTimeout     time.Duration
	readinessTimeout   time.Duration
	readinessCacheTTL  time.Duration
	readinessMu        sync.Mutex
	readinessCheckedAt time.Time
	readinessErr       error
	readinessInFlight  chan struct{}
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
		HTTPClient:  s3HTTPClient(),
	}
	client := s3.NewFromConfig(awsCfg, func(options *s3.Options) {
		options.UsePathStyle = cfg.ForcePathStyle
		if cfg.Endpoint != "" {
			options.BaseEndpoint = aws.String(cfg.Endpoint)
		}
	})

	storage := newS3StorageWithClients(client, s3.NewPresignClient(client), cfg)
	if err := storage.CheckReady(ctx); err != nil {
		return nil, fmt.Errorf("verify S3 bucket capabilities: %w", err)
	}

	return storage, nil
}

func newS3StorageWithClient(client s3ObjectClient, cfg S3Config) *S3Storage {
	return newS3StorageWithClients(client, nil, cfg)
}

func newS3StorageWithClients(client s3ObjectClient, presignClient s3PresignClient, cfg S3Config) *S3Storage {
	storage := &S3Storage{
		client:            client,
		presignClient:     presignClient,
		bucket:            cfg.Bucket,
		publicBaseURL:     strings.TrimRight(cfg.PublicBaseURL, "/"),
		requestTimeout:    cfg.RequestTimeout,
		readinessTimeout:  cfg.ReadinessTimeout,
		readinessCacheTTL: cfg.ReadinessCacheTTL,
	}
	if storage.requestTimeout <= 0 {
		storage.requestTimeout = defaultS3CallTimeout
	}
	if storage.readinessTimeout <= 0 {
		storage.readinessTimeout = defaultS3ReadyTimeout
	}
	if storage.readinessCacheTTL <= 0 {
		storage.readinessCacheTTL = defaultS3ReadyCacheTTL
	}
	if multipartClient, ok := client.(s3MultipartClient); ok {
		storage.multipartClient = multipartClient
	}
	return storage
}

func s3HTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext
	transport.TLSHandshakeTimeout = 10 * time.Second
	transport.ResponseHeaderTimeout = 30 * time.Second
	transport.ExpectContinueTimeout = time.Second
	return &http.Client{Transport: transport}
}

func (s *S3Storage) Driver() string {
	return "s3"
}

func (s *S3Storage) CheckReady(ctx context.Context) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}

		s.readinessMu.Lock()
		now := time.Now().UTC()
		cacheTTL := s.readinessCacheTTL
		if s.readinessErr != nil && cacheTTL > failedS3ReadyCacheTTL {
			cacheTTL = failedS3ReadyCacheTTL
		}
		if !s.readinessCheckedAt.IsZero() && now.Sub(s.readinessCheckedAt) < cacheTTL {
			cachedErr := s.readinessErr
			s.readinessMu.Unlock()
			return cachedErr
		}
		if inFlight := s.readinessInFlight; inFlight != nil {
			s.readinessMu.Unlock()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-inFlight:
				continue
			}
		}
		s.readinessInFlight = make(chan struct{})
		s.readinessMu.Unlock()

		probeCtx, cancel := context.WithTimeout(ctx, s.readinessTimeout)
		probeErr := s.probeCapabilities(probeCtx)
		cancel()

		s.readinessMu.Lock()
		if ctx.Err() == nil {
			s.readinessErr = probeErr
			s.readinessCheckedAt = time.Now().UTC()
		}
		close(s.readinessInFlight)
		s.readinessInFlight = nil
		s.readinessMu.Unlock()
		return probeErr
	}
}

func (s *S3Storage) probeCapabilities(ctx context.Context) error {
	var randomSuffix [8]byte
	if _, err := rand.Read(randomSuffix[:]); err != nil {
		return fmt.Errorf("create readiness object key: %w", err)
	}
	key := ".openpost-readiness/" + hex.EncodeToString(randomSuffix[:])
	content := []byte("openpost-storage-ready")
	cleanupRequired := true
	defer func() {
		if !cleanupRequired {
			return
		}
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.readinessTimeout)
		defer cancel()
		_ = s.Delete(cleanupCtx, key)
	}()

	if _, err := s.Save(ctx, key, bytes.NewReader(content)); err != nil {
		return fmt.Errorf("write readiness object: %w", err)
	}
	reader, err := s.Open(ctx, key)
	if err != nil {
		return fmt.Errorf("read readiness object: %w", err)
	}
	stored, readErr := io.ReadAll(io.LimitReader(reader, int64(len(content)+1)))
	closeErr := reader.Close()
	if readErr != nil {
		return fmt.Errorf("read readiness object content: %w", readErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close readiness object: %w", closeErr)
	}
	if !bytes.Equal(stored, content) {
		return fmt.Errorf("readiness object content did not match")
	}
	if err := s.Delete(ctx, key); err != nil {
		return fmt.Errorf("delete readiness object: %w", err)
	}
	cleanupRequired = false
	return nil
}

func (s *S3Storage) Save(ctx context.Context, id string, reader io.Reader) (string, error) {
	return s.save(ctx, id, reader, "")
}

func (s *S3Storage) SaveWithContentType(ctx context.Context, id string, reader io.Reader, contentType string) (string, error) {
	return s.save(ctx, id, reader, strings.TrimSpace(contentType))
}

func (s *S3Storage) save(ctx context.Context, id string, reader io.Reader, contentType string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	reader = &contextReader{ctx: ctx, reader: reader}
	key := cleanObjectKey(id)
	prefix := make([]byte, s3MultipartPartSize)
	read, readErr := io.ReadFull(reader, prefix)
	if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
		return "", readErr
	}
	if read < s3MultipartPartSize || s.multipartClient == nil {
		input := &s3.PutObjectInput{
			Bucket: aws.String(s.bucket),
			Key:    aws.String(key),
			Body:   io.MultiReader(bytes.NewReader(prefix[:read]), reader),
		}
		if read < s3MultipartPartSize {
			// io.ReadFull only returns a short read after reaching EOF. Use a
			// seekable body with an explicit size so S3-compatible services do
			// not reject small uploads with MissingContentLength.
			input.Body = bytes.NewReader(prefix[:read])
			input.ContentLength = aws.Int64(int64(read))
		}
		if contentType != "" {
			input.ContentType = aws.String(contentType)
		}
		putCtx := ctx
		cancel := func() {}
		if read < s3MultipartPartSize {
			putCtx, cancel = s.callContext(ctx)
		}
		defer cancel()
		if _, err := s.client.PutObject(putCtx, input); err != nil {
			return "", err
		}
		return key, nil
	}

	if err := s.saveMultipart(ctx, key, contentType, prefix, reader); err != nil {
		return "", err
	}
	return key, nil
}

func (s *S3Storage) saveMultipart(ctx context.Context, key, contentType string, firstPart []byte, reader io.Reader) error {
	createInput := &s3.CreateMultipartUploadInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}
	if contentType != "" {
		createInput.ContentType = aws.String(contentType)
	}
	createCtx, cancelCreate := s.callContext(ctx)
	created, err := s.multipartClient.CreateMultipartUpload(createCtx, createInput)
	cancelCreate()
	if err != nil {
		return err
	}
	uploadID := aws.ToString(created.UploadId)
	if uploadID == "" {
		return fmt.Errorf("S3 multipart upload did not return an upload ID")
	}

	completed := false
	defer func() {
		if completed {
			return
		}
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), blobCleanupTimeout)
		defer cancel()
		_, _ = s.multipartClient.AbortMultipartUpload(cleanupCtx, &s3.AbortMultipartUploadInput{
			Bucket:   aws.String(s.bucket),
			Key:      aws.String(key),
			UploadId: aws.String(uploadID),
		})
	}()

	buffer := firstPart
	parts := make([]s3types.CompletedPart, 0, 8)
	for partNumber := int32(1); ; partNumber++ {
		uploadCtx, cancelUpload := s.callContext(ctx)
		uploaded, uploadErr := s.multipartClient.UploadPart(uploadCtx, &s3.UploadPartInput{
			Bucket:        aws.String(s.bucket),
			Key:           aws.String(key),
			UploadId:      aws.String(uploadID),
			PartNumber:    aws.Int32(partNumber),
			ContentLength: aws.Int64(int64(len(buffer))),
			Body:          bytes.NewReader(buffer),
		})
		cancelUpload()
		if uploadErr != nil {
			return uploadErr
		}
		parts = append(parts, s3types.CompletedPart{
			ETag:       uploaded.ETag,
			PartNumber: aws.Int32(partNumber),
		})

		next := buffer[:s3MultipartPartSize]
		read, readErr := io.ReadFull(reader, next)
		switch readErr {
		case nil:
			buffer = next
		case io.EOF:
			buffer = nil
		case io.ErrUnexpectedEOF:
			buffer = next[:read]
		default:
			return readErr
		}
		if len(buffer) == 0 {
			break
		}
	}

	completeCtx, cancelComplete := s.callContext(ctx)
	_, err = s.multipartClient.CompleteMultipartUpload(completeCtx, &s3.CompleteMultipartUploadInput{
		Bucket:   aws.String(s.bucket),
		Key:      aws.String(key),
		UploadId: aws.String(uploadID),
		MultipartUpload: &s3types.CompletedMultipartUpload{
			Parts: parts,
		},
	})
	cancelComplete()
	if err != nil {
		return err
	}
	completed = true
	return nil
}

func (s *S3Storage) Delete(ctx context.Context, id string) error {
	deleteCtx, cancel := s.callContext(ctx)
	defer cancel()
	_, err := s.client.DeleteObject(deleteCtx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(cleanObjectKey(id)),
	})
	return err
}

func (s *S3Storage) callContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, s.requestTimeout)
}

func (s *S3Storage) GetURL(id string) string {
	key := cleanObjectKey(id)
	if s.publicBaseURL == "" {
		return key
	}
	return s.publicBaseURL + "/" + key
}

func (s *S3Storage) Open(ctx context.Context, id string) (io.ReadCloser, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(cleanObjectKey(id)),
	})
	if err != nil {
		return nil, err
	}
	return out.Body, nil
}

func (s *S3Storage) OpenRange(ctx context.Context, id string, offset int64) (io.ReadCloser, error) {
	if offset < 0 {
		return nil, fmt.Errorf("invalid media offset %d", offset)
	}
	input := &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(cleanObjectKey(id)),
	}
	if offset > 0 {
		input.Range = aws.String(fmt.Sprintf("bytes=%d-", offset))
	}
	out, err := s.client.GetObject(ctx, input)
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
