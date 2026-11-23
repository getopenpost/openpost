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
	t.Parallel()
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
		{"discord bot token invalid", &platform.HTTPError{StatusCode: 401, Code: "discord:bot_token_invalid"}, FailurePermission, false, FailureActionProvider},
		{"permission", &platform.HTTPError{StatusCode: 403}, FailurePermission, false, FailureActionProvider},
		{"youtube thumbnail verification", &platform.HTTPError{StatusCode: 403, Code: "youtube:thumbnail_channel_verification_required"}, FailurePermission, false, FailureActionProvider},
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
	require.Contains(t, ClassifyFailure(&platform.HTTPError{StatusCode: 403, Code: "youtube:thumbnail_channel_verification_required"}).Message, "youtube.com/verify")
}

func TestClassifyMetaFailuresPreserveBoundedDiagnostics(t *testing.T) {
	t.Parallel()
	failure := ClassifyFailure(&platform.HTTPError{
		StatusCode: 401,
		Code:       "meta:checkpoint:190:459",
		Subcode:    "459",
		TraceID:    "A1b2C3d4",
	})
	require.Equal(t, "459", failure.Subcode)
	require.Equal(t, "A1b2C3d4", failure.TraceID)
}

func TestProviderPrerequisiteFailuresGiveProviderGuidance(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		code    string
		status  int
		message string
	}{{"x:credits_depleted", 402, "X developer account"}, {"bluesky:unconfirmed_email", 403, "Verify your email"}, {"google:invalid_rapt", 401, "Workspace administrator"}, {"devnull:signature_rejected", 401, "SSH key on your GitHub account"}, {"devnull:commit_rejected", 422, "exceed 4000 characters"}} {
		failure := ClassifyFailure(&platform.HTTPError{StatusCode: test.status, Code: test.code})
		require.Contains(t, failure.Message, test.message)
		require.False(t, failure.Retryable)
		require.NotEqual(t, FailureActionBilling, failure.Action)
	}
}
