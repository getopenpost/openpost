package publicurl

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

type Result struct {
	Ready      bool
	StatusCode int
	Error      string
	CheckedAt  time.Time
}

type Verifier interface {
	Verify(context.Context, string) Result
}

type HTTPVerifier struct {
	Client *http.Client
}

func (v HTTPVerifier) Verify(ctx context.Context, rawURL string) Result {
	now := time.Now().UTC()
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return Result{CheckedAt: now, Error: "public media URL must use HTTPS"}
	}
	client := v.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, rawURL, nil)
	if err != nil {
		return Result{CheckedAt: now, Error: err.Error()}
	}
	resp, err := client.Do(req)
	if err != nil {
		return Result{CheckedAt: now, Error: err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return Result{CheckedAt: now, StatusCode: resp.StatusCode, Error: fmt.Sprintf("public media URL returned %d", resp.StatusCode)}
	}
	return Result{Ready: true, StatusCode: resp.StatusCode, CheckedAt: now}
}
