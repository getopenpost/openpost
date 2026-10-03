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

func TestClassifyMetaFailuresUseDistinctRecoveryActions(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		kind      string
		retryable bool
		action    string
		message   string
	}{
		{"checkpoint", &platform.HTTPError{StatusCode: 401, Code: "meta:checkpoint:190:459", Subcode: "459"}, FailureReconnectRequired, false, FailureActionReconnect, "security check"},
		{"instagram checkpoint", &platform.HTTPError{StatusCode: 401, Code: "meta:checkpoint:instagram"}, FailureReconnectRequired, false, FailureActionReconnect, "instagram.com"},
		{"lost page role", &platform.HTTPError{StatusCode: 403, Code: "meta:missing_page_role:190:492", Subcode: "492"}, FailurePermission, false, FailureActionReconnect, "role on this Page"},
		{"missing object never retries", &platform.HTTPError{StatusCode: 400, Code: "meta:nonexistent:100:33", Subcode: "33"}, FailureValidation, false, FailureActionEdit, "no longer exists"},
		{"silent audio retries", &platform.HTTPError{StatusCode: 400, Code: "meta:media_silent_audio:2207082"}, FailureProviderProcessing, true, FailureActionRetry, "volume to 0"},
		{"format rejection", &platform.HTTPError{StatusCode: 400, Code: "meta:media_format:2207085"}, FailureValidation, false, FailureActionEdit, "format, duration"},
		{"daily limit", &platform.HTTPError{StatusCode: 400, Code: "meta:media_rejected:2207042"}, FailureValidation, false, FailureActionEdit, "25 posts per day"},
		{"outage retries", &platform.HTTPError{StatusCode: 503, Code: "meta:transient"}, FailureProviderServer, true, FailureActionRetry, "temporarily unavailable"},
		{"temporary posting block retries", &platform.HTTPError{StatusCode: 429, Code: "meta:rate_limit:368:1390008", Subcode: "1390008"}, FailureRateLimited, true, FailureActionRetry, "temporarily limited"},
		{"other policy block never retries", &platform.HTTPError{StatusCode: 400, Code: "meta:368", Subcode: "1390009"}, FailureValidation, false, FailureActionEdit, "destination settings"},
		{"rate limit retries", &platform.HTTPError{StatusCode: 429, Code: "meta:transient"}, FailureRateLimited, true, FailureActionRetry, "rate limiting"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			failure := ClassifyFailure(test.err)
			require.Equal(t, test.kind, failure.Kind)
			require.Equal(t, test.retryable, failure.Retryable)
			require.Equal(t, test.action, failure.Action)
			require.Contains(t, failure.Message, test.message)
			require.Equal(t, test.err.(*platform.HTTPError).Code, failure.Code)
		})
	}
}

func TestClassifyMetaFailuresPreserveBoundedDiagnostics(t *testing.T) {
	failure := ClassifyFailure(&platform.HTTPError{
		StatusCode: 401,
		Code:       "meta:checkpoint:190:459",
		Subcode:    "459",
		TraceID:    "A1b2C3d4",
	})
	require.Equal(t, "459", failure.Subcode)
	require.Equal(t, "A1b2C3d4", failure.TraceID)
}

func TestDiscordAttachmentPermissionFailureExplainsHowToPublish(t *testing.T) {
	failure := ClassifyFailure(&platform.HTTPError{
		StatusCode: http.StatusForbidden,
		Code:       "discord_attach_files_permission_lost",
	})
	require.Equal(t, FailurePermission, failure.Kind)
	require.False(t, failure.Retryable)
	require.Equal(t, FailureActionProvider, failure.Action)
	require.Contains(t, failure.Message, "Attach Files")
	require.Contains(t, failure.Message, "remove the attachments")
}

func TestPinterestBoardFailureIsTerminalAndNamesBoard(t *testing.T) {
	failure := ClassifyFailure(&platform.HTTPError{StatusCode: 403, Code: "pinterest:board_permission:29"})
	require.Equal(t, FailurePermission, failure.Kind)
	require.False(t, failure.Retryable)
	require.Equal(t, FailureActionEdit, failure.Action)
	require.Contains(t, failure.Message, "selected board")
}
