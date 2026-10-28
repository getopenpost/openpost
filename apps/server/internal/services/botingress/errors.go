// Package botingress owns signed one-time bot connection credentials and the
// safe durable boundary between provider webhooks and background processing.
package botingress

type ErrorCode string

const (
	CodeInvalidNonce       ErrorCode = "invalid_nonce"
	CodeNonceExpired       ErrorCode = "nonce_expired"
	CodeNonceConsumed      ErrorCode = "nonce_consumed"
	CodeInvalidSignature   ErrorCode = "invalid_signature"
	CodeInvalidEvent       ErrorCode = "invalid_event"
	CodeEventTooLarge      ErrorCode = "event_too_large"
	CodeIngressUnavailable ErrorCode = "ingress_unavailable"
	CodeProcessorMissing   ErrorCode = "processor_unavailable"
	CodeProcessingFailed   ErrorCode = "processing_failed"
)

type SafeError struct {
	code ErrorCode
}

func (err *SafeError) Error() string   { return string(err.code) }
func (err *SafeError) Code() ErrorCode { return err.code }

var (
	ErrInvalidNonce       = &SafeError{code: CodeInvalidNonce}
	ErrNonceExpired       = &SafeError{code: CodeNonceExpired}
	ErrNonceConsumed      = &SafeError{code: CodeNonceConsumed}
	ErrInvalidSignature   = &SafeError{code: CodeInvalidSignature}
	ErrInvalidEvent       = &SafeError{code: CodeInvalidEvent}
	ErrEventTooLarge      = &SafeError{code: CodeEventTooLarge}
	ErrIngressUnavailable = &SafeError{code: CodeIngressUnavailable}
	ErrProcessorMissing   = &SafeError{code: CodeProcessorMissing}
	ErrProcessingFailed   = &SafeError{code: CodeProcessingFailed}
)
