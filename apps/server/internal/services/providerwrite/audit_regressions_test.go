package providerwrite

import (
	"context"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestPinterestCode21TimeoutRemainsAmbiguousAndNeverReplays(t *testing.T) {
	db := newProviderWriteTestDB(t)
	service := New(db)
	input := providerWriteTestInput(t, "pinterest-code-21")
	var calls atomic.Int32

	send := func(_ context.Context, control *Control) (platform.PublishResult, error) {
		calls.Add(1)
		require.NoError(t, control.Begin(platform.PublishResult{ProviderState: "create_pin", RetrySafety: platform.PublishRetryNever}))
		return platform.PublishResult{ProviderState: "create_pin", RetrySafety: platform.PublishRetryNever}, &platform.HTTPError{
			StatusCode: http.StatusBadRequest,
			Code:       "pinterest:create_timeout:21",
		}
	}

	_, err := service.Execute(t.Context(), input, send, nil)
	require.Error(t, err)
	require.True(t, IsAmbiguous(err), "Pinterest code 21 timeout must be treated as ambiguous, never definite rejection")

	_, err = service.Execute(t.Context(), input, send, nil)
	require.Error(t, err)
	require.True(t, IsAmbiguous(err))
	require.Equal(t, int32(1), calls.Load(), "ambiguous Pinterest code 21 write must never replay POST /v5/pins")

	attempt := latestProviderWriteAttempt(t, db, input.OperationID)
	require.Equal(t, StatusAmbiguous, attempt.Status)
	require.Equal(t, string(platform.PublishRetryNever), attempt.RetrySafety)
	require.Equal(t, "provider_unknown", attempt.SafeErrorClass)
	require.Equal(t, "pinterest:create_timeout:21", attempt.SafeErrorCode)
}

func TestLinkedInTextPost401IsDefiniteRejectionAndRetrySafeAfterRefresh(t *testing.T) {
	db := newProviderWriteTestDB(t)
	service := New(db)
	input := providerWriteTestInput(t, "linkedin-401-refresh")
	var calls atomic.Int32

	_, err := service.Execute(t.Context(), input, func(_ context.Context, control *Control) (platform.PublishResult, error) {
		calls.Add(1)
		require.NoError(t, control.Begin(platform.PublishResult{ProviderState: "create_post", RetrySafety: platform.PublishRetryNever}))
		return platform.PublishResult{ProviderState: "create_post", RetrySafety: platform.PublishRetryNever}, &platform.HTTPError{
			StatusCode: http.StatusUnauthorized,
			Code:       "EXPIRED_ACCESS_TOKEN",
		}
	}, nil)
	require.Error(t, err)
	require.False(t, IsAmbiguous(err), "HTTP 401 on LinkedIn create_post is a confirmed auth rejection")

	attempt := latestProviderWriteAttempt(t, db, input.OperationID)
	require.Equal(t, StatusDefiniteFailure, attempt.Status)
	require.Equal(t, string(platform.PublishRetrySafe), attempt.RetrySafety)

	// A retry after refreshing the token must be allowed to execute cleanly.
	result, err := service.Execute(t.Context(), input, func(_ context.Context, control *Control) (platform.PublishResult, error) {
		calls.Add(1)
		require.NoError(t, control.Begin(platform.PublishResult{ProviderState: "create_post", RetrySafety: platform.PublishRetryNever}))
		accepted := platform.AcceptedPublishResult("urn:li:share:999")
		require.NoError(t, control.Checkpoint(accepted))
		return accepted, nil
	}, nil)
	require.NoError(t, err)
	require.Equal(t, "urn:li:share:999", result.ExternalID)
	require.Equal(t, int32(2), calls.Load())
}
