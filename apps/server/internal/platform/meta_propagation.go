package platform

import (
	"context"
	"errors"
	"net/http"
	"time"
)

// Retry only a confirmed media-readiness rejection of this operation. Reuse
// its container IDs; replaying the whole publish can duplicate earlier posts.
func doMetaPropagationForm(ctx context.Context, endpoint string, payload map[string]string, rejection metaCodeKey) ([]byte, error) {
	const maxAttempts = 5
	const backoff = 2 * time.Second
	for attempt := 1; ; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		body, err := DoFormURLEncoded(ctx, http.MethodPost, endpoint, payload, nil)
		var providerErr *HTTPError
		if err == nil || attempt == maxAttempts || !errors.As(err, &providerErr) ||
			providerErr.StatusCode != http.StatusBadRequest || providerErr.Code != rejection.code || providerErr.Subcode != rejection.subcode {
			return body, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Duration(attempt) * backoff):
		}
	}
}
