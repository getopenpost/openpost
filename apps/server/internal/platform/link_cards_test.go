package platform

import (
	"context"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFacebookFallsBackToTextOnlyOnScrapeFailure(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	calls := 0
	var bodies []string
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		raw, _ := io.ReadAll(req.Body)
		bodies = append(bodies, string(raw))
		if calls == 1 {
			return jsonResponseWithStatus(req, http.StatusBadRequest, `{"error":{"message":"link scrape failed","code":1609005}}`), nil
		}
		return jsonResponse(req, `{"id":"post-1"}`), nil
	})}

	adapter := &FacebookAdapter{graphVersion: "v25.0"}
	result, err := adapter.Publish(context.Background(), "token", "page-1", &PublishRequest{
		Content:  "Read https://example.com/blocked",
		Settings: map[string]interface{}{},
	})
	require.NoError(t, err)
	require.Equal(t, "post-1", result.ExternalID)
	require.Len(t, bodies, 2, "scrape failure must retry once text-only")
	require.Contains(t, bodies[0], "link=", "first attempt attaches the native card")
	require.NotContains(t, bodies[1], "link=", "retry must drop the card parameter")
}
