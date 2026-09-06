package mediastore

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/stretchr/testify/require"
)

func TestS3CompatibleStorageIntegration(t *testing.T) {
	endpoint := os.Getenv("OPENPOST_TEST_S3_ENDPOINT")
	if endpoint == "" {
		t.Skip("OPENPOST_TEST_S3_ENDPOINT is not configured")
	}

	region := os.Getenv("OPENPOST_TEST_S3_REGION")
	if region == "" {
		region = "us-east-1"
	}
	accessKeyID := os.Getenv("OPENPOST_TEST_S3_ACCESS_KEY_ID")
	secretAccessKey := os.Getenv("OPENPOST_TEST_S3_SECRET_ACCESS_KEY")
	bucket := os.Getenv("OPENPOST_TEST_S3_BUCKET")
	require.NotEmpty(t, accessKeyID)
	require.NotEmpty(t, secretAccessKey)
	require.NotEmpty(t, bucket)

	awsConfig := aws.Config{
		Region:      region,
		Credentials: credentials.NewStaticCredentialsProvider(accessKeyID, secretAccessKey, ""),
		HTTPClient:  s3HTTPClient(),
	}
	client := s3.NewFromConfig(awsConfig, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(endpoint)
		options.UsePathStyle = true
	})
	_, err := client.CreateBucket(t.Context(), &s3.CreateBucketInput{Bucket: aws.String(bucket)})
	require.NoError(t, err)
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = client.DeleteBucket(cleanupCtx, &s3.DeleteBucketInput{Bucket: aws.String(bucket)})
	})

	storage, err := NewS3Storage(t.Context(), S3Config{
		Endpoint:        endpoint,
		Region:          region,
		Bucket:          bucket,
		AccessKeyID:     accessKeyID,
		SecretAccessKey: secretAccessKey,
		ForcePathStyle:  true,
	})
	require.NoError(t, err, "startup must prove write, read, and delete access to the configured bucket")

	const smallKey = "integration/small.txt"
	const smallContent = "representative object content"
	_, err = storage.SaveWithContentType(t.Context(), smallKey, bytes.NewBufferString(smallContent), "text/plain")
	require.NoError(t, err)
	reader, err := storage.Open(t.Context(), smallKey)
	require.NoError(t, err)
	stored, err := io.ReadAll(reader)
	require.NoError(t, err)
	require.NoError(t, reader.Close())
	require.Equal(t, smallContent, string(stored))

	rangeReader, err := storage.OpenRange(t.Context(), smallKey, 15)
	require.NoError(t, err)
	ranged, err := io.ReadAll(rangeReader)
	require.NoError(t, err)
	require.NoError(t, rangeReader.Close())
	require.Equal(t, "object content", string(ranged))

	const directKey = "integration/direct.txt"
	const directContent = "presigned upload"
	session, err := storage.CreateDirectUploadSession(t.Context(), DirectUploadInput{
		Key:         directKey,
		ContentType: "text/plain",
		Size:        int64(len(directContent)),
		ExpiresIn:   time.Minute,
	})
	require.NoError(t, err)
	request, err := http.NewRequestWithContext(t.Context(), session.Method, session.URL, bytes.NewBufferString(directContent))
	require.NoError(t, err)
	request.ContentLength = int64(len(directContent))
	for name, value := range session.Headers {
		request.Header.Set(name, value)
	}
	response, err := (&http.Client{Timeout: 10 * time.Second}).Do(request)
	require.NoError(t, err)
	_, copyErr := io.Copy(io.Discard, response.Body)
	require.NoError(t, copyErr)
	require.NoError(t, response.Body.Close())
	require.Less(t, response.StatusCode, http.StatusMultipleChoices)
	directReader, err := storage.Open(t.Context(), directKey)
	require.NoError(t, err)
	directStored, err := io.ReadAll(directReader)
	require.NoError(t, err)
	require.NoError(t, directReader.Close())
	require.Equal(t, directContent, string(directStored))

	const largeKey = "integration/multipart.bin"
	largeContent := bytes.Repeat([]byte("m"), s3MultipartPartSize+17)
	_, err = storage.Save(t.Context(), largeKey, bytes.NewReader(largeContent))
	require.NoError(t, err)
	largeTail, err := storage.OpenRange(t.Context(), largeKey, s3MultipartPartSize)
	require.NoError(t, err)
	tail, err := io.ReadAll(largeTail)
	require.NoError(t, err)
	require.NoError(t, largeTail.Close())
	require.Equal(t, bytes.Repeat([]byte("m"), 17), tail)

	for _, key := range []string{smallKey, directKey, largeKey} {
		require.NoError(t, storage.Delete(t.Context(), key))
	}
	_, err = storage.Open(t.Context(), smallKey)
	require.Error(t, err)
}
