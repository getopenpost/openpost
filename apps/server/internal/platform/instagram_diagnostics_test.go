package platform

import (
	"bytes"
	"fmt"
	"log"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestInstagramPublishFailureLogsSafeRequestStage(t *testing.T) {
	original := httpClient
	t.Cleanup(func() { httpClient = original })
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(previous) })
	calls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		switch req.URL.Path {
		case "/v25.0/12345/media":
			return jsonResponse(req, `{"id":"67890"}`), nil
		case "/v25.0/67890":
			return jsonResponse(req, `{"status_code":"FINISHED"}`), nil
		case "/v25.0/12345/media_publish":
			return jsonResponseWithStatus(req, 400, `{"error":{"code":100,"error_subcode":33,"fbtrace_id":"trace-safe","message":"secret-provider-body"}}`), nil
		default:
			return nil, fmt.Errorf("unexpected request")
		}
	})}
	_, err := NewInstagramLoginAdapter("", "", "").Publish(t.Context(), "secret-token", "12345", &PublishRequest{
		Content: "secret-caption", PlatformMediaIDs: []string{"https://media.example/secret-file.jpg"}, Media: []MediaItem{{MimeType: "image/jpeg"}},
	})
	require.Error(t, err)
	require.Equal(t, 3, calls)
	for _, diagnostic := range []string{`host="graph.instagram.com"`, `operation="media_publish"`, `endpoint="/{ig_user_id}/media_publish"`, `object_id="67890"`, `status=400`, `subcode="33"`, `trace="trace-safe"`} {
		require.Contains(t, output.String(), diagnostic)
	}
	for _, secret := range []string{"secret-token", "secret-caption", "secret-provider-body", "secret-file"} {
		require.NotContains(t, output.String(), secret)
	}
}
