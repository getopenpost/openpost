package platform

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

// Engagement sync treats 401 and 403 provider errors as "reconnect this
// account", so YouTube's non-authorization 403 reasons must not surface as 403.
func TestYouTubeListCommentsClassifiesForbiddenReasons(t *testing.T) {
	tests := []struct {
		name       string
		reason     string
		wantStatus int
	}{
		{name: "comments disabled on the video", reason: "commentsDisabled", wantStatus: http.StatusNotFound},
		{name: "daily quota exhausted", reason: "quotaExceeded", wantStatus: http.StatusTooManyRequests},
		{name: "missing permission still asks for reconnect", reason: "insufficientPermissions", wantStatus: http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			originalClient := httpClient
			defer func() { httpClient = originalClient }()

			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				require.Equal(t, "/youtube/v3/commentThreads", req.URL.Path)
				return jsonResponseWithStatus(req, http.StatusForbidden, `{"error":{"code":403,"message":"forbidden","errors":[{"domain":"youtube.commentThread","reason":"`+tt.reason+`"}]}}`), nil
			})}

			_, err := (&YouTubeAdapter{}).ListComments(context.Background(), "token", "channel-1", "video-1")

			var providerErr *HTTPError
			require.True(t, errors.As(err, &providerErr), "expected a provider HTTP error, got %v", err)
			require.Equal(t, tt.wantStatus, providerErr.StatusCode)
			if tt.wantStatus != http.StatusForbidden {
				require.Equal(t, tt.reason, providerErr.Code)
			}
		})
	}
}
