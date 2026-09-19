package platform

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestDoRequestSanitizesTransportErrors(t *testing.T) {
	secretURL := "https://graph.example/resource?access_token=secret-token"
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return nil, &url.Error{Op: req.Method, URL: req.URL.String(), Err: context.DeadlineExceeded}
	})}

	_, err := doRequestWithClient(t.Context(), client, http.MethodGet, secretURL, nil, nil)
	if err == nil {
		t.Fatal("expected transport error")
	}
	if strings.Contains(err.Error(), "secret-token") || strings.Contains(err.Error(), "graph.example") {
		t.Fatalf("transport error disclosed the request URL: %v", err)
	}
	var transportErr *TransportError
	if !errors.As(err, &transportErr) {
		t.Fatalf("expected TransportError, got %T", err)
	}
	if transportErr.Kind != TransportFailureTimeout {
		t.Fatalf("expected timeout kind, got %q", transportErr.Kind)
	}
}
