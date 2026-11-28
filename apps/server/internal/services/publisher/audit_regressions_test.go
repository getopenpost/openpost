package publisher

import (
	"net/http"
	"testing"

	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestAuditProviderFailureClassifications(t *testing.T) {
	t.Run("pinterest code 21 timeout is non-retryable and instructs provider check", func(t *testing.T) {
		failure := ClassifyFailure(&platform.HTTPError{StatusCode: http.StatusBadRequest, Code: "pinterest:create_timeout:21"})
		require.Equal(t, FailureProviderProcessing, failure.Kind)
		require.False(t, failure.Retryable)
		require.Equal(t, FailureActionProvider, failure.Action)
		require.Contains(t, failure.Message, "Check Pinterest")
	})

	t.Run("pinterest code 1 refusal is retryable", func(t *testing.T) {
		failure := ClassifyFailure(&platform.HTTPError{StatusCode: http.StatusBadRequest, Code: "pinterest:temporarily_refused:1"})
		require.Equal(t, FailureProviderServer, failure.Kind)
		require.True(t, failure.Retryable)
		require.Equal(t, FailureActionRetry, failure.Action)
	})

	t.Run("linkedin duplicate content is non-retryable duplicate", func(t *testing.T) {
		failure := ClassifyFailure(&platform.HTTPError{StatusCode: http.StatusUnprocessableEntity, Code: "linkedin:duplicate_content"})
		require.Equal(t, FailureDuplicateContent, failure.Kind)
		require.False(t, failure.Retryable)
		require.Equal(t, FailureActionEdit, failure.Action)
		require.Contains(t, failure.Message, "Check LinkedIn")
	})

	t.Run("threads invalid link attachment 4279047 is non-retryable validation", func(t *testing.T) {
		failure := ClassifyFailure(&platform.HTTPError{StatusCode: http.StatusBadRequest, Code: "meta:invalid_link_attachment:4279047", Subcode: "4279047"})
		require.Equal(t, FailureValidation, failure.Kind)
		require.False(t, failure.Retryable)
		require.Contains(t, failure.Message, "invalid link attachment")
	})

	t.Run("facebook robots.txt media crawler block is actionable validation error", func(t *testing.T) {
		failure := ClassifyFailure(&platform.HTTPError{StatusCode: http.StatusBadRequest, Code: "meta:media_url_blocked_by_robots"})
		require.Equal(t, FailureValidation, failure.Kind)
		require.False(t, failure.Retryable)
		require.Contains(t, failure.Message, "meta-externalfetcher")
	})
}
