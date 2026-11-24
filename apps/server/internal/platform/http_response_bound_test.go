package platform

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// oversizedProviderBody returns a body one byte over the shared provider
// response bound.
func oversizedProviderBody() io.Reader {
	return strings.NewReader(strings.Repeat("x", maxProviderResponseBytes+1))
}

func oversizedStubResponse(_ *http.Request) (*http.Response, error) {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{},
		Body:       io.NopCloser(oversizedProviderBody()),
	}, nil
}

// withOversizedProviderClient swaps the shared provider client for a stub
// transport that serves a body over the bound.
func withOversizedProviderClient(t *testing.T) {
	t.Helper()
	original := httpClient
	httpClient = &http.Client{Transport: roundTripFunc(oversizedStubResponse)}
	t.Cleanup(func() { httpClient = original })
}

func TestPinterestVideoUploadRejectsOversizedResponse(t *testing.T) {
	withOversizedProviderClient(t)
	session := pinterestUploadSession{
		UploadURL:        "https://uploads.s3.amazonaws.com/bucket",
		UploadParameters: map[string]string{"key": "value"},
	}
	err := uploadPinterestVideo(context.Background(), session, UploadMediaRequest{}, strings.NewReader("video-bytes"))
	require.ErrorContains(t, err, "provider response exceeds")
}
