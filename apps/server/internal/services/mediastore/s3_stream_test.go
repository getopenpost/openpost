package mediastore

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/stretchr/testify/require"
)

func TestS3DownloadOutlivesObjectOperationTimeout(t *testing.T) {
	for _, ranged := range []bool{false, true} {
		name := "full"
		if ranged {
			name = "range"
		}
		t.Run(name, func(t *testing.T) {
			finish := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Length", "11")
				if ranged {
					w.Header().Set("Content-Range", "bytes 2-12/13")
					w.WriteHeader(http.StatusPartialContent)
				}
				_, _ = io.WriteString(w, "hello ")
				w.(http.Flusher).Flush()
				select {
				case <-finish:
					_, _ = io.WriteString(w, "world")
				case <-r.Context().Done():
				}
			}))
			defer server.Close()
			client := s3.NewFromConfig(aws.Config{
				Region: "us-east-1", Credentials: credentials.NewStaticCredentialsProvider("test", "test", ""), HTTPClient: s3HTTPClient(),
			}, func(options *s3.Options) {
				options.BaseEndpoint = aws.String(server.URL)
				options.UsePathStyle = true
			})
			storage := newS3StorageWithClients(client, nil, S3Config{Bucket: "test", RequestTimeout: 200 * time.Millisecond})
			var reader io.ReadCloser
			var err error
			if ranged {
				reader, err = storage.OpenRange(t.Context(), "video.mp4", 2)
			} else {
				reader, err = storage.Open(t.Context(), "video.mp4")
			}
			require.NoError(t, err)
			defer reader.Close()
			// Hold a real HTTP body beyond the metadata operation's allowance.
			<-time.After(400 * time.Millisecond)
			close(finish)
			body, err := io.ReadAll(reader)
			require.NoError(t, err)
			require.Equal(t, "hello world", string(body))
		})
	}
}

func TestS3DownloadStopsWhenCallerCancels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "100")
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	client := s3.NewFromConfig(aws.Config{
		Region: "us-east-1", Credentials: credentials.NewStaticCredentialsProvider("test", "test", ""), HTTPClient: s3HTTPClient(),
	}, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(server.URL)
		options.UsePathStyle = true
	})
	storage := newS3StorageWithClients(client, nil, S3Config{Bucket: "test"})
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	reader, err := storage.Open(ctx, "video.mp4")
	require.NoError(t, err)
	defer reader.Close()
	cancel()
	_, err = io.ReadAll(reader)
	require.ErrorIs(t, err, context.Canceled)
}
