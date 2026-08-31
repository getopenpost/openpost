package mediastore

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/stretchr/testify/require"
)

type fakeS3Client struct {
	putBucket     string
	putKey        string
	putBody       string
	putType       string
	putLength     int64
	putSeekable   bool
	deleteBucket  string
	deleteKey     string
	getBucket     string
	getKey        string
	getRange      string
	getBody       string
	multipartID   string
	multipartType string
	uploadParts   [][]byte
	completed     []s3types.CompletedPart
	aborted       bool
	uploadErrAt   int
	putCalls      int
	deleteCalls   int
	getCalls      int
}

type cancellationS3Client struct{}

type contextInspectS3Client struct {
	fakeS3Client
	sawDeadline bool
}

type stalledReadS3Client struct {
	fakeS3Client
}

type contextBoundReadCloser struct {
	ctx context.Context
}

func (r *contextBoundReadCloser) Read(_ []byte) (int, error) {
	<-r.ctx.Done()
	return 0, r.ctx.Err()
}

func (*contextBoundReadCloser) Close() error { return nil }

func (c *stalledReadS3Client) GetObject(ctx context.Context, _ *s3.GetObjectInput, _ ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
	return &s3.GetObjectOutput{Body: &contextBoundReadCloser{ctx: ctx}}, nil
}

func (c *contextInspectS3Client) PutObject(ctx context.Context, input *s3.PutObjectInput, options ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	_, c.sawDeadline = ctx.Deadline()
	return c.fakeS3Client.PutObject(ctx, input, options...)
}

type delayedMultipartS3Client struct {
	fakeS3Client
	delay time.Duration
}

type ambiguousPutS3Client struct {
	fakeS3Client
}

func (c *ambiguousPutS3Client) PutObject(ctx context.Context, input *s3.PutObjectInput, options ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	if _, err := c.fakeS3Client.PutObject(ctx, input, options...); err != nil {
		return nil, err
	}
	return nil, errors.New("transport failed after upload")
}

func (c *delayedMultipartS3Client) wait(ctx context.Context) error {
	timer := time.NewTimer(c.delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (c *delayedMultipartS3Client) CreateMultipartUpload(ctx context.Context, input *s3.CreateMultipartUploadInput, options ...func(*s3.Options)) (*s3.CreateMultipartUploadOutput, error) {
	if err := c.wait(ctx); err != nil {
		return nil, err
	}
	return c.fakeS3Client.CreateMultipartUpload(ctx, input, options...)
}

func (c *delayedMultipartS3Client) UploadPart(ctx context.Context, input *s3.UploadPartInput, options ...func(*s3.Options)) (*s3.UploadPartOutput, error) {
	if err := c.wait(ctx); err != nil {
		return nil, err
	}
	return c.fakeS3Client.UploadPart(ctx, input, options...)
}

func (c *delayedMultipartS3Client) CompleteMultipartUpload(ctx context.Context, input *s3.CompleteMultipartUploadInput, options ...func(*s3.Options)) (*s3.CompleteMultipartUploadOutput, error) {
	if err := c.wait(ctx); err != nil {
		return nil, err
	}
	return c.fakeS3Client.CompleteMultipartUpload(ctx, input, options...)
}

func (c *delayedMultipartS3Client) AbortMultipartUpload(ctx context.Context, input *s3.AbortMultipartUploadInput, options ...func(*s3.Options)) (*s3.AbortMultipartUploadOutput, error) {
	return c.fakeS3Client.AbortMultipartUpload(ctx, input, options...)
}

type singleProbeS3Client struct {
	fakeS3Client
	putCalls atomic.Int32
	started  chan struct{}
	release  chan struct{}
}

func (c *singleProbeS3Client) PutObject(ctx context.Context, input *s3.PutObjectInput, options ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	if c.putCalls.Add(1) > 1 {
		return nil, errors.New("concurrent readiness probe")
	}
	close(c.started)
	select {
	case <-c.release:
		return c.fakeS3Client.PutObject(ctx, input, options...)
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

type failingReader struct {
	read bool
}

func (r *failingReader) Read(buffer []byte) (int, error) {
	if r.read {
		return 0, errors.New("source read failed")
	}
	r.read = true
	return copy(buffer, "partial"), nil
}

type cancelAfterWrite struct {
	cancel context.CancelFunc
}

func (w cancelAfterWrite) Write(buffer []byte) (int, error) {
	w.cancel()
	return len(buffer), nil
}

type cleanupStorage struct {
	deleteContextErr error
}

func (*cleanupStorage) Driver() string { return "test" }
func (*cleanupStorage) Save(context.Context, string, io.Reader) (string, error) {
	return "", nil
}
func (s *cleanupStorage) Delete(ctx context.Context, _ string) error {
	s.deleteContextErr = ctx.Err()
	return nil
}
func (*cleanupStorage) GetURL(string) string { return "" }
func (*cleanupStorage) Open(context.Context, string) (io.ReadCloser, error) {
	return nil, errors.New("not implemented")
}

func (cancellationS3Client) PutObject(ctx context.Context, _ *s3.PutObjectInput, _ ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func (cancellationS3Client) DeleteObject(ctx context.Context, _ *s3.DeleteObjectInput, _ ...func(*s3.Options)) (*s3.DeleteObjectOutput, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func (cancellationS3Client) GetObject(ctx context.Context, _ *s3.GetObjectInput, _ ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func (f *fakeS3Client) PutObject(_ context.Context, input *s3.PutObjectInput, _ ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	f.putCalls++
	body, err := io.ReadAll(input.Body)
	if err != nil {
		return nil, err
	}
	f.putBucket = aws.ToString(input.Bucket)
	f.putKey = aws.ToString(input.Key)
	f.putBody = string(body)
	f.putType = aws.ToString(input.ContentType)
	f.putLength = aws.ToInt64(input.ContentLength)
	_, f.putSeekable = input.Body.(io.Seeker)
	if f.getBody == "" {
		f.getBody = f.putBody
	}
	return &s3.PutObjectOutput{}, nil
}

func (f *fakeS3Client) DeleteObject(_ context.Context, input *s3.DeleteObjectInput, _ ...func(*s3.Options)) (*s3.DeleteObjectOutput, error) {
	f.deleteCalls++
	f.deleteBucket = aws.ToString(input.Bucket)
	f.deleteKey = aws.ToString(input.Key)
	return &s3.DeleteObjectOutput{}, nil
}

func (f *fakeS3Client) GetObject(_ context.Context, input *s3.GetObjectInput, _ ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
	f.getCalls++
	f.getBucket = aws.ToString(input.Bucket)
	f.getKey = aws.ToString(input.Key)
	f.getRange = aws.ToString(input.Range)
	return &s3.GetObjectOutput{Body: io.NopCloser(bytes.NewBufferString(f.getBody))}, nil
}

func (f *fakeS3Client) CreateMultipartUpload(_ context.Context, input *s3.CreateMultipartUploadInput, _ ...func(*s3.Options)) (*s3.CreateMultipartUploadOutput, error) {
	f.multipartID = "multipart-1"
	f.multipartType = aws.ToString(input.ContentType)
	return &s3.CreateMultipartUploadOutput{UploadId: aws.String(f.multipartID)}, nil
}

func (f *fakeS3Client) UploadPart(_ context.Context, input *s3.UploadPartInput, _ ...func(*s3.Options)) (*s3.UploadPartOutput, error) {
	if f.uploadErrAt > 0 && int(aws.ToInt32(input.PartNumber)) == f.uploadErrAt {
		return nil, errors.New("upload part failed")
	}
	body, err := io.ReadAll(input.Body)
	if err != nil {
		return nil, err
	}
	f.uploadParts = append(f.uploadParts, body)
	return &s3.UploadPartOutput{ETag: aws.String("etag")}, nil
}

func (f *fakeS3Client) CompleteMultipartUpload(_ context.Context, input *s3.CompleteMultipartUploadInput, _ ...func(*s3.Options)) (*s3.CompleteMultipartUploadOutput, error) {
	f.completed = append([]s3types.CompletedPart(nil), input.MultipartUpload.Parts...)
	return &s3.CompleteMultipartUploadOutput{}, nil
}

func (f *fakeS3Client) AbortMultipartUpload(_ context.Context, _ *s3.AbortMultipartUploadInput, _ ...func(*s3.Options)) (*s3.AbortMultipartUploadOutput, error) {
	f.aborted = true
	return &s3.AbortMultipartUploadOutput{}, nil
}

type fakeS3PresignClient struct {
	bucket      string
	key         string
	contentType string
	size        int64
	expires     time.Duration
}

func (f *fakeS3PresignClient) PresignPutObject(_ context.Context, input *s3.PutObjectInput, optFns ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error) {
	options := s3.PresignOptions{}
	for _, optFn := range optFns {
		optFn(&options)
	}
	f.bucket = aws.ToString(input.Bucket)
	f.key = aws.ToString(input.Key)
	f.contentType = aws.ToString(input.ContentType)
	f.size = aws.ToInt64(input.ContentLength)
	f.expires = options.Expires
	return &v4.PresignedHTTPRequest{
		URL:    "https://uploads.openpost.test/" + f.key,
		Method: http.MethodPut,
		SignedHeader: http.Header{
			"Content-Type": []string{f.contentType},
			"Host":         []string{"uploads.openpost.test"},
		},
	}, nil
}

func TestLocalStorageReportsDriver(t *testing.T) {
	storage := NewLocalStorage(t.TempDir(), "/media")

	require.Equal(t, "local", storage.Driver())
}

func TestLocalStorageRejectsPathsOutsideItsDirectory(t *testing.T) {
	storage := NewLocalStorage(t.TempDir(), "/media")

	for _, key := range []string{"", "../secret", "media/../../secret", "/tmp/secret"} {
		_, err := storage.Save(t.Context(), key, bytes.NewBufferString("secret"))
		require.ErrorContains(t, err, "invalid local storage key", key)
		require.ErrorContains(t, storage.Delete(t.Context(), key), "invalid local storage key", key)
		_, err = storage.Open(t.Context(), key)
		require.ErrorContains(t, err, "invalid local storage key", key)
	}
}

func TestLocalStorageCreatesDirectoriesForSafeNestedKeys(t *testing.T) {
	baseDir := t.TempDir()
	storage := NewLocalStorage(baseDir, "/media")

	path, err := storage.Save(t.Context(), "avatars/user-1.png", bytes.NewBufferString("image"))
	require.NoError(t, err)
	require.Equal(t, filepath.Join(baseDir, "avatars", "user-1.png"), path)
	reader, err := storage.Open(t.Context(), "avatars/user-1.png")
	require.NoError(t, err)
	defer reader.Close()
	body, err := io.ReadAll(reader)
	require.NoError(t, err)
	require.Equal(t, "image", string(body))
}

func TestLocalStorageDoesNotPublishPartialWrites(t *testing.T) {
	storage := NewLocalStorage(t.TempDir(), "/media")
	_, err := storage.Save(t.Context(), "media/object.txt", bytes.NewBufferString("complete"))
	require.NoError(t, err)

	_, err = storage.Save(t.Context(), "media/object.txt", &failingReader{})
	require.ErrorContains(t, err, "source read failed")

	reader, err := storage.Open(t.Context(), "media/object.txt")
	require.NoError(t, err)
	defer reader.Close()
	content, err := io.ReadAll(reader)
	require.NoError(t, err)
	require.Equal(t, "complete", string(content))
}

func TestLocalStorageReadsHonorCancellationAfterOpen(t *testing.T) {
	storage := NewLocalStorage(t.TempDir(), "/media")
	_, err := storage.Save(t.Context(), "media/object.txt", bytes.NewBufferString("content"))
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(t.Context())
	reader, err := storage.Open(ctx, "media/object.txt")
	require.NoError(t, err)
	defer reader.Close()
	cancel()

	_, err = io.ReadAll(reader)
	require.ErrorIs(t, err, context.Canceled)
}

func TestLocalStorageCopyStopsAfterCancellation(t *testing.T) {
	storage := NewLocalStorage(t.TempDir(), "/media")
	content := bytes.Repeat([]byte("a"), 1024*1024)
	_, err := storage.Save(t.Context(), "media/object.bin", bytes.NewReader(content))
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(t.Context())
	t.Cleanup(cancel)
	reader, err := storage.Open(ctx, "media/object.bin")
	require.NoError(t, err)
	defer reader.Close()

	copied, err := io.Copy(cancelAfterWrite{cancel: cancel}, reader)

	require.ErrorIs(t, err, context.Canceled)
	require.Positive(t, copied)
	require.Less(t, copied, int64(len(content)))
}

func TestCompensatingDeleteSurvivesRequestCancellation(t *testing.T) {
	storage := &cleanupStorage{}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()

	require.NoError(t, DeleteForCleanup(ctx, storage, "new-object"))
	require.NoError(t, storage.deleteContextErr)
}

func TestBlobStorageRangeReadersStartAtRequestedOffset(t *testing.T) {
	local := NewLocalStorage(t.TempDir(), "/media")
	_, err := local.Save(t.Context(), "videos/clip.mp4", bytes.NewBufferString("0123456789"))
	require.NoError(t, err)
	localReader, err := local.OpenRange(t.Context(), "videos/clip.mp4", 4)
	require.NoError(t, err)
	localBody, err := io.ReadAll(localReader)
	require.NoError(t, err)
	require.NoError(t, localReader.Close())
	require.Equal(t, "456789", string(localBody))

	client := &fakeS3Client{getBody: "456789"}
	remote := newS3StorageWithClient(client, S3Config{Bucket: "openpost-media"})
	remoteReader, err := remote.OpenRange(t.Context(), "videos/clip.mp4", 4)
	require.NoError(t, err)
	remoteBody, err := io.ReadAll(remoteReader)
	require.NoError(t, err)
	require.NoError(t, remoteReader.Close())
	require.Equal(t, "bytes=4-", client.getRange)
	require.Equal(t, "456789", string(remoteBody))
}

func TestNewStorageRejectsUnsupportedDriver(t *testing.T) {
	storage, err := New(context.Background(), Config{Driver: "gcs"})

	require.Nil(t, storage)
	require.ErrorContains(t, err, "unsupported storage driver")
}

func TestS3StorageUsesBlobStorageContract(t *testing.T) {
	client := &fakeS3Client{getBody: "stored-content"}
	storage := newS3StorageWithClient(client, S3Config{
		Bucket:        "openpost-media",
		PublicBaseURL: "https://media.openpost.social/",
	})

	savedPath, err := storage.Save(t.Context(), "media/example.png", bytes.NewBufferString("uploaded-content"))
	require.NoError(t, err)
	require.Equal(t, "media/example.png", savedPath)
	require.Equal(t, "openpost-media", client.putBucket)
	require.Equal(t, "media/example.png", client.putKey)
	require.Equal(t, "uploaded-content", client.putBody)
	require.Equal(t, int64(len("uploaded-content")), client.putLength)
	require.True(t, client.putSeekable)
	require.Equal(t, "s3", storage.Driver())
	require.Equal(t, "https://media.openpost.social/media/example.png", storage.GetURL("media/example.png"))

	reader, err := storage.Open(t.Context(), "media/example.png")
	require.NoError(t, err)
	defer reader.Close()
	body, err := io.ReadAll(reader)
	require.NoError(t, err)
	require.Equal(t, "stored-content", string(body))
	require.Equal(t, "openpost-media", client.getBucket)
	require.Equal(t, "media/example.png", client.getKey)

	require.NoError(t, storage.Delete(t.Context(), "media/example.png"))
	require.Equal(t, "openpost-media", client.deleteBucket)
	require.Equal(t, "media/example.png", client.deleteKey)
}

func TestS3StorageCreatesDirectUploadSession(t *testing.T) {
	presigner := &fakeS3PresignClient{}
	storage := newS3StorageWithClients(&fakeS3Client{}, presigner, S3Config{
		Bucket: "openpost-media",
	})

	session, err := storage.CreateDirectUploadSession(context.Background(), DirectUploadInput{
		Key:         "/media/direct.png",
		ContentType: "image/png",
		Size:        1234,
		ExpiresIn:   10 * time.Minute,
	})

	require.NoError(t, err)
	require.Equal(t, "openpost-media", presigner.bucket)
	require.Equal(t, "media/direct.png", presigner.key)
	require.Equal(t, "image/png", presigner.contentType)
	require.Equal(t, int64(1234), presigner.size)
	require.Equal(t, 10*time.Minute, presigner.expires)
	require.Equal(t, http.MethodPut, session.Method)
	require.Equal(t, "https://uploads.openpost.test/media/direct.png", session.URL)
	require.Equal(t, "media/direct.png", session.Key)
	require.Equal(t, map[string]string{"Content-Type": "image/png"}, session.Headers)
	require.True(t, session.ExpiresAt.After(time.Now().UTC()))
}

func TestS3StorageUsesMultipartUploadsForLargeStreams(t *testing.T) {
	client := &fakeS3Client{}
	storage := newS3StorageWithClient(client, S3Config{Bucket: "openpost-media"})
	content := bytes.Repeat([]byte("a"), s3MultipartPartSize+17)

	savedPath, err := storage.SaveWithContentType(t.Context(), "media/launch.mp4", bytes.NewReader(content), "video/mp4")

	require.NoError(t, err)
	require.Equal(t, "media/launch.mp4", savedPath)
	require.Empty(t, client.putBody)
	require.Equal(t, "multipart-1", client.multipartID)
	require.Equal(t, "video/mp4", client.multipartType)
	require.Len(t, client.uploadParts, 2)
	require.Len(t, client.uploadParts[0], s3MultipartPartSize)
	require.Len(t, client.uploadParts[1], 17)
	require.Equal(t, content, append(client.uploadParts[0], client.uploadParts[1]...))
	require.Len(t, client.completed, 2)
	require.False(t, client.aborted)
}

func TestS3StorageAbortsFailedMultipartUploads(t *testing.T) {
	client := &fakeS3Client{uploadErrAt: 2}
	storage := newS3StorageWithClient(client, S3Config{Bucket: "openpost-media"})
	content := bytes.Repeat([]byte("a"), s3MultipartPartSize+17)

	_, err := storage.Save(t.Context(), "media/launch.mp4", bytes.NewReader(content))

	require.ErrorContains(t, err, "upload part failed")
	require.True(t, client.aborted)
	require.Empty(t, client.completed)
}

func TestS3StorageOperationsHonorCallerCancellation(t *testing.T) {
	storage := newS3StorageWithClient(cancellationS3Client{}, S3Config{Bucket: "openpost-media"})
	ctx, cancel := context.WithCancel(t.Context())
	cancel()

	_, err := storage.Save(ctx, "media/cancelled.png", bytes.NewBufferString("content"))
	require.ErrorIs(t, err, context.Canceled)
	require.ErrorIs(t, storage.Delete(ctx, "media/cancelled.png"), context.Canceled)
	_, err = storage.Open(ctx, "media/cancelled.png")
	require.ErrorIs(t, err, context.Canceled)
	_, err = storage.OpenRange(ctx, "media/cancelled.png", 2)
	require.ErrorIs(t, err, context.Canceled)
}

func TestS3StorageBoundsSmallRemoteRequests(t *testing.T) {
	client := &contextInspectS3Client{}
	storage := newS3StorageWithClient(client, S3Config{Bucket: "openpost-media"})

	_, err := storage.Save(context.Background(), "media/long-upload.bin", bytes.NewBufferString("content"))
	require.NoError(t, err)
	require.True(t, client.sawDeadline)
}

func TestS3StorageBoundsResponseBodyReads(t *testing.T) {
	for _, test := range []struct {
		name string
		open func(context.Context, *S3Storage) (io.ReadCloser, error)
	}{
		{
			name: "full object",
			open: func(ctx context.Context, storage *S3Storage) (io.ReadCloser, error) {
				return storage.Open(ctx, "media/stalled.bin")
			},
		},
		{
			name: "range",
			open: func(ctx context.Context, storage *S3Storage) (io.ReadCloser, error) {
				return storage.OpenRange(ctx, "media/stalled.bin", 1)
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			storage := newS3StorageWithClient(&stalledReadS3Client{}, S3Config{
				Bucket:         "openpost-media",
				RequestTimeout: 25 * time.Millisecond,
			})
			callerCtx, cancel := context.WithTimeout(t.Context(), 500*time.Millisecond)
			defer cancel()
			reader, err := test.open(callerCtx, storage)
			require.NoError(t, err)
			defer reader.Close()

			startedAt := time.Now()
			_, err = reader.Read(make([]byte, 1))

			require.ErrorIs(t, err, context.DeadlineExceeded)
			require.Less(t, time.Since(startedAt), 250*time.Millisecond)
		})
	}
}

func TestS3MultipartUploadCanOutliveOneRemoteCallBudget(t *testing.T) {
	client := &delayedMultipartS3Client{delay: 100 * time.Millisecond}
	storage := newS3StorageWithClient(client, S3Config{
		Bucket:         "openpost-media",
		RequestTimeout: 250 * time.Millisecond,
	})
	content := bytes.Repeat([]byte("a"), s3MultipartPartSize+17)
	startedAt := time.Now()

	_, err := storage.Save(context.Background(), "media/long-upload.bin", bytes.NewReader(content))

	require.NoError(t, err)
	require.Greater(t, time.Since(startedAt), 250*time.Millisecond)
}

func TestS3StorageDoesNotCacheCallerCancellation(t *testing.T) {
	client := &fakeS3Client{}
	storage := newS3StorageWithClient(client, S3Config{Bucket: "openpost-media"})
	canceledCtx, cancel := context.WithCancel(t.Context())
	cancel()

	require.ErrorIs(t, storage.CheckReady(canceledCtx), context.Canceled)
	require.NoError(t, storage.CheckReady(t.Context()))
	require.Equal(t, 1, client.putCalls)
}

func TestS3ReadinessCleansUpAfterAmbiguousWriteFailure(t *testing.T) {
	client := &ambiguousPutS3Client{}
	storage := newS3StorageWithClient(client, S3Config{Bucket: "openpost-media"})

	err := storage.CheckReady(t.Context())

	require.ErrorContains(t, err, "transport failed after upload")
	require.Equal(t, 1, client.deleteCalls)
	require.Contains(t, client.deleteKey, ".openpost-readiness/")
}

func TestS3StorageCoalescesConcurrentCapabilityChecks(t *testing.T) {
	client := &singleProbeS3Client{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	storage := newS3StorageWithClient(client, S3Config{Bucket: "openpost-media"})
	results := make(chan error, 2)

	go func() { results <- storage.CheckReady(t.Context()) }()
	<-client.started
	secondStarted := make(chan struct{})
	go func() {
		close(secondStarted)
		results <- storage.CheckReady(t.Context())
	}()
	<-secondStarted
	select {
	case err := <-results:
		t.Fatalf("readiness check completed while the first probe was blocked: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	close(client.release)

	require.NoError(t, <-results)
	require.NoError(t, <-results)
	require.Equal(t, int32(1), client.putCalls.Load())
}

func TestS3StorageCachesSuccessfulCapabilityChecks(t *testing.T) {
	client := &fakeS3Client{}
	storage := newS3StorageWithClient(client, S3Config{Bucket: "openpost-media"})

	require.NoError(t, storage.CheckReady(t.Context()))
	require.NoError(t, storage.CheckReady(t.Context()))

	require.Equal(t, 1, client.putCalls)
	require.Equal(t, 1, client.getCalls)
	require.Equal(t, 1, client.deleteCalls)
}
