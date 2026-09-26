package platform

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestSignedUploadHelpersSanitizeTransportErrors(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	failingTransport := func(secretURL string) *http.Client {
		return &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			return nil, &url.Error{Op: req.Method, URL: secretURL, Err: errors.New("connection refused")}
		})}
	}

	t.Run("linkedin signed upload URL", func(t *testing.T) {
		secretURL := "https://api.linkedin.com/signed-upload?upload_token=secret-token"
		httpClient = failingTransport(secretURL)

		_, err := doRequestWithHeaders(context.Background(), http.MethodPut, secretURL, bytes.NewReader([]byte("bytes")), map[string]string{
			headerContentType: contentTypeOctet,
		})
		if err == nil {
			t.Fatal("expected transport error")
		}
		if strings.Contains(err.Error(), "secret-token") {
			t.Fatalf("transport error disclosed the signed upload URL: %v", err)
		}
		var transportErr *TransportError
		if !errors.As(err, &transportErr) {
			t.Fatalf("expected TransportError, got %T", err)
		}
	})

	t.Run("peertube resumable session URL", func(t *testing.T) {
		secretURL := "https://peertube.example/upload-resumable/secret-session"
		httpClient = failingTransport(secretURL)

		_, err := peertubeRawRequest(context.Background(), http.MethodPut, secretURL, map[string]string{
			headerContentType: contentTypeOctet,
		}, bytes.NewReader([]byte("bytes")))
		if err == nil {
			t.Fatal("expected transport error")
		}
		if strings.Contains(err.Error(), "secret-session") {
			t.Fatalf("transport error disclosed the resumable session URL: %v", err)
		}
		var transportErr *TransportError
		if !errors.As(err, &transportErr) {
			t.Fatalf("expected TransportError, got %T", err)
		}
	})

	t.Run("pinterest signed upload URL", func(t *testing.T) {
		secretURL := "https://uploads.s3-accelerate.amazonaws.com/key?x-amz-credential=secret-credential"
		httpClient = failingTransport(secretURL)

		err := uploadPinterestVideo(context.Background(), pinterestUploadSession{
			UploadURL:        secretURL,
			UploadParameters: map[string]string{"key": "value"},
		}, UploadMediaRequest{}, bytes.NewReader([]byte("bytes")))
		if err == nil {
			t.Fatal("expected transport error")
		}
		if strings.Contains(err.Error(), "secret-credential") {
			t.Fatalf("transport error disclosed the signed upload URL: %v", err)
		}
		var transportErr *TransportError
		if !errors.As(err, &transportErr) {
			t.Fatalf("expected TransportError, got %T", err)
		}
	})
}

func TestXSignedRequestSanitizesTransportErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	secretURL := server.URL + "/1.1/media/upload.json?oauth_token=secret-marker"
	server.Close()

	adapter := NewXAdapter("consumer-key", "consumer-secret", "")
	defer close(adapter.cleanupDone)

	_, err := adapter.doSignedRequest(context.Background(), "access-token|access-secret", http.MethodGet, secretURL, nil, nil)
	if err == nil {
		t.Fatal("expected transport error")
	}
	if strings.Contains(err.Error(), "secret-marker") {
		t.Fatalf("transport error disclosed the request URL: %v", err)
	}
	var transportErr *TransportError
	if !errors.As(err, &transportErr) {
		t.Fatalf("expected TransportError, got %T", err)
	}
}
