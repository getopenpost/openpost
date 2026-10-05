package diagnostics

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"net"
	"net/http"
	"runtime"
	"syscall"
)

// ErrorKind identifies known error types without reading messages, URLs, or
// paths. Unknown errors stay unclassified rather than sending private text.
func ErrorKind(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "deadline_exceeded"
	case errors.Is(err, context.Canceled):
		return "canceled"
	case errors.Is(err, fs.ErrNotExist):
		return "not_found"
	case errors.Is(err, fs.ErrPermission):
		return "permission_denied"
	case errors.Is(err, syscall.ECONNREFUSED):
		return "connection_refused"
	case errors.Is(err, syscall.ECONNRESET):
		return "connection_reset"
	case errors.Is(err, io.ErrUnexpectedEOF):
		return "unexpected_eof"
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return "dns_error"
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return "network_timeout"
	}
	var runtimeErr runtime.Error
	if errors.As(err, &runtimeErr) {
		return "runtime_error"
	}
	return ""
}

func validErrorKind(kind string) bool {
	switch kind {
	case "", "deadline_exceeded", "canceled", "not_found", "permission_denied",
		"connection_refused", "connection_reset", "unexpected_eof", "dns_error",
		"network_timeout", "runtime_error", "type_error", "reference_error",
		"range_error", "syntax_error", "quota_exceeded", "security_error",
		"not_supported", "invalid_state", "abort_error", "network_error":
		return true
	default:
		return false
	}
}

func validHTTPMethod(method string) bool {
	switch method {
	case "", http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut,
		http.MethodPatch, http.MethodDelete, http.MethodOptions, http.MethodConnect, http.MethodTrace:
		return true
	default:
		return false
	}
}
