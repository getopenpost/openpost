package publisher

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestClassifyFailureUsesStableTaxonomyAndRetryPolicy(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		kind      string
		retryable bool
		action    string
	}{
		{"validation", &platform.HTTPError{StatusCode: 422, Code: "invalid_media"}, FailureValidation, false, FailureActionEdit},
		{"expired auth", &platform.HTTPError{StatusCode: 401, Code: "token_expired"}, FailureAuthExpired, false, FailureActionReconnect},
		{"reconnect", &platform.HTTPError{StatusCode: 401}, FailureReconnectRequired, false, FailureActionReconnect},
		{"permission", &platform.HTTPError{StatusCode: 403}, FailurePermission, false, FailureActionProvider},
		{"billing", &platform.HTTPError{StatusCode: 402}, FailureBillingRequired, false, FailureActionBilling},
		{"duplicate", &platform.HTTPError{StatusCode: 409}, FailureDuplicateContent, false, FailureActionEdit},
		{"rate limit", &platform.HTTPError{StatusCode: 429, RetryAfter: time.Minute}, FailureRateLimited, true, FailureActionRetry},
		{"network", context.DeadlineExceeded, FailureNetwork, true, FailureActionRetry},
		{"provider server", &platform.HTTPError{StatusCode: 503}, FailureProviderServer, true, FailureActionRetry},
		{"provider processing", errors.New("provider processing timeout"), FailureProviderProcessing, true, FailureActionRetry},
		{"media reconcile", &platform.MediaUploadError{RetryClassification: platform.MediaRetryReconcile, Err: errors.New("processing pending")}, FailureProviderProcessing, true, FailureActionRetry},
		{"media terminal", &platform.MediaUploadError{RetryClassification: platform.MediaRetryTerminal, Err: errors.New("processing failed")}, FailureProviderProcessing, false, FailureActionEdit},
		{"unknown", errors.New("unexpected adapter failure"), FailureUnknown, false, FailureActionEdit},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			failure := ClassifyFailure(test.err)
			require.Equal(t, test.kind, failure.Kind)
			require.Equal(t, test.retryable, failure.Retryable)
			require.Equal(t, test.action, failure.Action)
			require.NotEmpty(t, failure.Message)
		})
	}
	require.Equal(t, http.StatusTooManyRequests, ClassifyFailure(&platform.HTTPError{StatusCode: 429}).HTTPStatus)
}

func TestRetryDelayIsBoundedAndHonorsRetryAfter(t *testing.T) {
	require.Equal(t, 30*time.Second, RetryDelay(1, 0, 0))
	require.Equal(t, 2*time.Minute, RetryDelay(1, 2*time.Minute, 0))
	require.Equal(t, 24*time.Minute, RetryDelay(20, 2*time.Hour, -0.2))
	require.Equal(t, 36*time.Second, RetryDelay(1, 0, 0.9))
}
