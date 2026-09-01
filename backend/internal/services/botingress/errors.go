// Package botingress owns signed one-time bot connection credentials and the
// safe durable boundary between provider webhooks and background processing.
package botingress

import (
	"errors"
	"net/http"
)

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
	code       ErrorCode
	httpStatus int
}

func (err *SafeError) Error() string   { return string(err.code) }
func (err *SafeError) Code() ErrorCode { return err.code }
func (err *SafeError) HTTPStatus() int { return err.httpStatus }

var (
	ErrInvalidNonce       = &SafeError{code: CodeInvalidNonce, httpStatus: http.StatusBadRequest}
	ErrNonceExpired       = &SafeError{code: CodeNonceExpired, httpStatus: http.StatusGone}
	ErrNonceConsumed      = &SafeError{code: CodeNonceConsumed, httpStatus: http.StatusConflict}
	ErrInvalidSignature   = &SafeError{code: CodeInvalidSignature, httpStatus: http.StatusUnauthorized}
	ErrInvalidEvent       = &SafeError{code: CodeInvalidEvent, httpStatus: http.StatusBadRequest}
	ErrEventTooLarge      = &SafeError{code: CodeEventTooLarge, httpStatus: http.StatusRequestEntityTooLarge}
	ErrIngressUnavailable = &SafeError{code: CodeIngressUnavailable, httpStatus: http.StatusServiceUnavailable}
	ErrProcessorMissing   = &SafeError{code: CodeProcessorMissing, httpStatus: http.StatusServiceUnavailable}
	ErrProcessingFailed   = &SafeError{code: CodeProcessingFailed, httpStatus: http.StatusInternalServerError}
)

func CodeOf(err error) ErrorCode {
	var safe *SafeError
	if errors.As(err, &safe) {
		return safe.Code()
	}
	return CodeProcessingFailed
}

func HTTPStatusOf(err error) int {
	var safe *SafeError
	if errors.As(err, &safe) {
		return safe.HTTPStatus()
	}
	return http.StatusInternalServerError
}
