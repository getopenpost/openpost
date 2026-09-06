// Package publications defines transport-neutral Publication application contracts.
package publications

import (
	"errors"
	"fmt"
)

// ErrorCategory is stable across HTTP, MCP, CLI, and in-process callers.
type ErrorCategory string

const (
	ErrorInvalidInput          ErrorCategory = "invalid_input"
	ErrorAccessDenied          ErrorCategory = "access_denied"
	ErrorNotFound              ErrorCategory = "not_found"
	ErrorRevisionConflict      ErrorCategory = "revision_conflict"
	ErrorInvalidLifecycleState ErrorCategory = "invalid_lifecycle_state"
	ErrorProviderReadiness     ErrorCategory = "provider_readiness"
	ErrorTemporaryUnavailable  ErrorCategory = "temporary_unavailable"
)

// Error preserves the owning application category while retaining the cause
// for internal reconciliation and transport-specific presentation.
type Error struct {
	Category ErrorCategory
	Cause    error
}

func (e *Error) Error() string {
	if e == nil || e.Cause == nil {
		return string(e.Category)
	}
	return e.Cause.Error()
}

func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func NewError(category ErrorCategory, cause error) error {
	if cause == nil {
		return nil
	}
	var current *Error
	if errors.As(cause, &current) {
		return cause
	}
	if category == "" {
		return fmt.Errorf("publication error category is required: %w", cause)
	}
	return &Error{Category: category, Cause: cause}
}

func CategoryOf(err error) (ErrorCategory, bool) {
	var applicationError *Error
	if !errors.As(err, &applicationError) {
		return "", false
	}
	return applicationError.Category, true
}
