package mediastore

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"path/filepath"
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
}

func (f *fakeS3Client) PutObject(_ context.Context, input *s3.PutObjectInput, _ ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
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
	return &s3.PutObjectOutput{}, nil
}

func (f *fakeS3Client) DeleteObject(_ context.Context, input *s3.DeleteObjectInput, _ ...func(*s3.Options)) (*s3.DeleteObjectOutput, error) {
	f.deleteBucket = aws.ToString(input.Bucket)
	f.deleteKey = aws.ToString(input.Key)
	return &s3.DeleteObjectOutput{}, nil
}

func (f *fakeS3Client) GetObject(_ context.Context, input *s3.GetObjectInput, _ ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
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
		_, err := storage.Save(key, bytes.NewBufferString("secret"))
		require.ErrorContains(t, err, "invalid local storage key", key)
		require.ErrorContains(t, storage.Delete(key), "invalid local storage key", key)
		_, err = storage.Open(key)
		require.ErrorContains(t, err, "invalid local storage key", key)
	}
}

func TestLocalStorageCreatesDirectoriesForSafeNestedKeys(t *testing.T) {
	baseDir := t.TempDir()
	storage := NewLocalStorage(baseDir, "/media")

	path, err := storage.Save("avatars/user-1.png", bytes.NewBufferString("image"))
	require.NoError(t, err)
	require.Equal(t, filepath.Join(baseDir, "avatars", "user-1.png"), path)
	reader, err := storage.Open("avatars/user-1.png")
	require.NoError(t, err)
	defer reader.Close()
	body, err := io.ReadAll(reader)
	require.NoError(t, err)
	require.Equal(t, "image", string(body))
}

func TestBlobStorageRangeReadersStartAtRequestedOffset(t *testing.T) {
	local := NewLocalStorage(t.TempDir(), "/media")
	_, err := local.Save("videos/clip.mp4", bytes.NewBufferString("0123456789"))
	require.NoError(t, err)
	localReader, err := local.OpenRange("videos/clip.mp4", 4)
	require.NoError(t, err)
	localBody, err := io.ReadAll(localReader)
	require.NoError(t, err)
	require.NoError(t, localReader.Close())
	require.Equal(t, "456789", string(localBody))

	client := &fakeS3Client{getBody: "456789"}
	remote := newS3StorageWithClient(client, S3Config{Bucket: "openpost-media"})
	remoteReader, err := remote.OpenRange("videos/clip.mp4", 4)
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

	savedPath, err := storage.Save("media/example.png", bytes.NewBufferString("uploaded-content"))
	require.NoError(t, err)
	require.Equal(t, "media/example.png", savedPath)
	require.Equal(t, "openpost-media", client.putBucket)
	require.Equal(t, "media/example.png", client.putKey)
	require.Equal(t, "uploaded-content", client.putBody)
	require.Equal(t, int64(len("uploaded-content")), client.putLength)
	require.True(t, client.putSeekable)
	require.Equal(t, "s3", storage.Driver())
	require.Equal(t, "https://media.openpost.social/media/example.png", storage.GetURL("media/example.png"))

	reader, err := storage.Open("media/example.png")
	require.NoError(t, err)
	defer reader.Close()
	body, err := io.ReadAll(reader)
	require.NoError(t, err)
	require.Equal(t, "stored-content", string(body))
	require.Equal(t, "openpost-media", client.getBucket)
	require.Equal(t, "media/example.png", client.getKey)

	require.NoError(t, storage.Delete("media/example.png"))
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

	savedPath, err := storage.SaveWithContentType("media/launch.mp4", bytes.NewReader(content), "video/mp4")

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

	_, err := storage.Save("media/launch.mp4", bytes.NewReader(content))

	require.ErrorContains(t, err, "upload part failed")
	require.True(t, client.aborted)
	require.Empty(t, client.completed)
}
