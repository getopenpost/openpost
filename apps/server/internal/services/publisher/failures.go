package publisher

import (
	"context"
	"errors"
	"math"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerwrite"
)

const (
	FailureValidation         = "validation"
	FailureAuthExpired        = "auth_expired"
	FailureReconnectRequired  = "reconnect_required"
	FailurePermission         = "permission"
	FailureBillingRequired    = "billing_required"
	FailureDuplicateContent   = "duplicate_content"
	FailureRateLimited        = "rate_limited"
	FailureNetwork            = "network"
	FailureProviderServer     = "provider_server"
	FailureProviderProcessing = "provider_processing"
	FailureUnknown            = "unknown"
)

const (
	FailureActionEdit      = "edit"
	FailureActionReconnect = "reconnect"
	FailureActionBilling   = "billing"
	FailureActionRetry     = "retry"
	FailureActionProvider  = "open_provider"
)

type Failure struct {
	Subcode    string
	TraceID    string
	Kind       string
	Message    string
	Code       string
	HTTPStatus int
	Retryable  bool
	RetryAfter time.Duration
	Action     string
}

type RetryableError struct {
	Provider    string
	RenditionID string
	Failure     Failure
}

func (e *RetryableError) Error() string {
	return e.Failure.Message
}

// A provider-write receipt already holds the accepted result. Retry the same
// authorization so local state and its event can finish without another send.
type renditionCompletionError struct{ cause error }

func (e *renditionCompletionError) Error() string {
	return "finalizing accepted publication: " + e.cause.Error()
}
func (e *renditionCompletionError) Unwrap() error { return e.cause }

func ClassifyFailure(err error) Failure {
	if err == nil {
		return Failure{}
	}
	var completion *renditionCompletionError
	if errors.As(err, &completion) {
		return Failure{Kind: FailureUnknown, Code: "publication_finalization_pending", Retryable: true, Action: FailureActionRetry, Message: "The provider accepted this post. OpenPost will retry saving its result without sending it again."}
	}
	if retryAfter, pending := providerwrite.IsPending(err); pending {
		failure := failureForKind(FailureProviderProcessing, "provider_submission_pending", 0, retryAfter)
		failure.Message = "The provider is still processing this publish. OpenPost will check its status without sending it again."
		return failure
	}
	if providerwrite.IsAmbiguous(err) {
		return classifyAmbiguousWrite(err)
	}
	if retryClass, ok := platform.MediaRetryClassificationForError(err); ok {
		failure := failureForKind(FailureProviderProcessing, "", 0, 0)
		if retryClass == platform.MediaRetryTerminal {
			failure.Message = "The provider rejected or could not process this media. Replace the media before publishing again."
			failure.Retryable = false
			failure.Action = FailureActionEdit
		}
		return failure
	}
	lower := strings.ToLower(err.Error())
	if strings.Contains(lower, "processing") &&
		(strings.Contains(lower, "failed") || strings.Contains(lower, "timeout")) {
		return failureForKind(FailureProviderProcessing, "", 0, 0)
	}
	if failure, ok := classifyProviderHTTPFailure(err); ok {
		return failure
	}

	var statusErr huma.StatusError
	if errors.As(err, &statusErr) && statusErr.GetStatus() == http.StatusPaymentRequired {
		return failureForKind(FailureBillingRequired, "", http.StatusPaymentRequired, 0)
	}
	var networkErr net.Error
	if errors.As(err, &networkErr) || errors.Is(err, context.DeadlineExceeded) {
		return failureForKind(FailureNetwork, "", 0, 0)
	}
	return classifyFailureMessage(lower)
}

func classifyAmbiguousWrite(err error) Failure {
	if retryAfter, retryable := providerwrite.IsRetryable(err); retryable {
		failure := failureForKind(FailureProviderProcessing, "idempotent_provider_retry", 0, retryAfter)
		failure.Message = "The provider result was interrupted. OpenPost will retry with the same provider idempotency key."
		return failure
	}
	failure := failureForKind(FailureUnknown, "ambiguous_provider_write", 0, 0)
	failure.Message = "The provider may have accepted this publish. OpenPost did not send it again. Check the provider before retrying manually."
	failure.Action = FailureActionProvider
	failure.Retryable = false
	return failure
}

func classifyProviderHTTPFailure(err error) (Failure, bool) {
	var providerErr *platform.HTTPError
	if !errors.As(err, &providerErr) {
		return Failure{}, false
	}
	if failure, ok := classifyMetaFailure(providerErr); ok {
		return failure, true
	}
	code := strings.ToLower(providerErr.Code)
	kind := providerFailureKindByStatus(providerErr.StatusCode, code)
	if kind == "" {
		return Failure{}, false
	}
	failure := failureForKind(kind, providerErr.Code, providerErr.StatusCode, providerErr.RetryAfter)
	if kind == FailurePermission && code == "discord_attach_files_permission_lost" {
		failure.Message = "Allow Attach Files for the bot in this Discord channel, or remove the attachments."
	}
	failure.Subcode = providerErr.Subcode
	failure.TraceID = providerErr.TraceID
	return failure, true
}

func providerFailureKindByStatus(status int, code string) string {
	switch {
	case strings.Contains(code, "duplicate") || status == http.StatusConflict:
		return FailureDuplicateContent
	case strings.Contains(code, "expired"):
		return FailureAuthExpired
	case status == http.StatusUnauthorized:
		return FailureReconnectRequired
	case status == http.StatusForbidden:
		return FailurePermission
	case status == http.StatusPaymentRequired:
		return FailureBillingRequired
	case status == http.StatusTooManyRequests:
		return FailureRateLimited
	case status == http.StatusBadRequest || status == http.StatusUnprocessableEntity:
		return FailureValidation
	case status >= 500:
		return FailureProviderServer
	default:
		return ""
	}
}

// classifyMetaFailure maps normalized Meta error codes to failure kinds with
// distinct recovery actions: checkpoint and expired credentials reconnect,
// a lost Page role reconnects after an admin grants it back, terminal media
// or missing objects ask for an edit, and transient outages retry.
func classifyMetaFailure(providerErr *platform.HTTPError) (Failure, bool) {
	var kind string
	var retryable bool
	switch code := providerErr.Code; {
	case code == "meta:checkpoint:190:459" || code == "meta:checkpoint:instagram":
		kind = FailureReconnectRequired
	case code == "meta:missing_page_role:190:492":
		kind = FailurePermission
	case code == "meta:nonexistent:100:33":
		kind = FailureValidation
	case code == "meta:media_silent_audio:2207082":
		kind = FailureProviderProcessing
		retryable = true
	case code == "meta:media_format:2207085" || strings.HasPrefix(code, "meta:media_rejected:"):
		kind = FailureValidation
	default:
		return Failure{}, false
	}
	failure := failureForKind(kind, providerErr.Code, providerErr.StatusCode, providerErr.RetryAfter)
	failure.Retryable = retryable
	if message := platform.MetaFailureMessage(providerErr.Code); message != "" {
		failure.Message = message
	}
	if providerErr.Code == "meta:missing_page_role:190:492" {
		// The fix happens in the provider (Page admin grants a role) and
		// completes with a reconnect, not by opening the provider post.
		failure.Action = FailureActionReconnect
	}
	failure.Subcode = providerErr.Subcode
	failure.TraceID = providerErr.TraceID
	return failure, true
}

func classifyFailureMessage(lower string) Failure {
	switch {
	case strings.Contains(lower, "quota exceeded"):
		return failureForKind(FailureBillingRequired, "", http.StatusPaymentRequired, 0)
	case strings.Contains(lower, "refresh") || strings.Contains(lower, "auth error") ||
		strings.Contains(lower, "token"):
		return failureForKind(FailureReconnectRequired, "", 0, 0)
	case strings.Contains(lower, "duplicate"):
		return failureForKind(FailureDuplicateContent, "", 0, 0)
	case strings.Contains(lower, "permission") || strings.Contains(lower, "scope"):
		return failureForKind(FailurePermission, "", 0, 0)
	case strings.Contains(lower, "validation") || strings.Contains(lower, "required") ||
		strings.Contains(lower, "unsupported"):
		return failureForKind(FailureValidation, "", 0, 0)
	}
	return failureForKind(FailureUnknown, "", 0, 0)
}

func failureForKind(kind, code string, status int, retryAfter time.Duration) Failure {
	failure := Failure{
		Kind:       kind,
		Code:       code,
		HTTPStatus: status,
		RetryAfter: retryAfter,
	}
	switch kind {
	case FailureValidation:
		failure.Message = "Fix the content or destination settings, then publish again."
		failure.Action = FailureActionEdit
	case FailureAuthExpired:
		failure.Message = "The provider session expired. Reconnect this account, then publish again."
		failure.Action = FailureActionReconnect
	case FailureReconnectRequired:
		failure.Message = "Reconnect this account, then publish again."
		failure.Action = FailureActionReconnect
	case FailurePermission:
		failure.Message = "The provider refused this publish. Check the account permissions."
		failure.Action = FailureActionProvider
	case FailureBillingRequired:
		failure.Message = "Publishing is unavailable for the current plan."
		failure.Action = FailureActionBilling
	case FailureDuplicateContent:
		failure.Message = "The provider rejected this as duplicate content."
		failure.Action = FailureActionEdit
	case FailureRateLimited:
		failure.Message = "The provider is rate limiting this account. OpenPost will retry."
		failure.Action = FailureActionRetry
		failure.Retryable = true
	case FailureNetwork:
		failure.Message = "OpenPost could not reach the provider. It will retry."
		failure.Action = FailureActionRetry
		failure.Retryable = true
	case FailureProviderServer:
		failure.Message = "The provider is temporarily unavailable. OpenPost will retry."
		failure.Action = FailureActionRetry
		failure.Retryable = true
	case FailureProviderProcessing:
		failure.Message = "The provider did not finish processing the media. OpenPost will retry."
		failure.Action = FailureActionRetry
		failure.Retryable = true
	default:
		failure.Kind = FailureUnknown
		failure.Message = "The provider could not publish this destination."
		failure.Action = FailureActionEdit
	}
	return failure
}

// RetryDelay returns bounded exponential backoff with caller-supplied jitter.
// jitterFraction is clamped to [-0.2, 0.2] for a predictable retry window.
func RetryDelay(attempt int, retryAfter time.Duration, jitterFraction float64) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	base := 30 * time.Second * time.Duration(math.Pow(2, float64(attempt-1)))
	if base > 15*time.Minute {
		base = 15 * time.Minute
	}
	if retryAfter > base {
		base = retryAfter
	}
	if base > 30*time.Minute {
		base = 30 * time.Minute
	}
	jitterFraction = max(-0.2, min(0.2, jitterFraction))
	return time.Duration(float64(base) * (1 + jitterFraction))
}
