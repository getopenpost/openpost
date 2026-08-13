package updatestatus

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestCheckIsDisabledWithoutNetworkAccess(t *testing.T) {
	t.Parallel()

	requests := 0
	service := NewService(Options{
		Enabled:        false,
		DisabledReason: "managed_edition",
		RunningVersion: "v1.2.3",
		RunningBuild:   "abc123",
		HTTPClient: &http.Client{Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
			requests++
			return nil, errors.New("unexpected request")
		})},
	})

	status := service.Check(t.Context())

	require.Equal(t, StateDisabled, status.State)
	require.Equal(t, "v1.2.3", status.RunningVersion)
	require.Equal(t, "abc123", status.RunningBuild)
	require.False(t, status.EffectiveEnabled)
	require.Equal(t, "managed_edition", status.DisabledReason)
	require.Zero(t, requests)
}

func TestCheckReportsAndCachesLatestStableRelease(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	requests := 0
	service := NewService(Options{
		Enabled:        true,
		RunningVersion: "v1.2.3",
		RunningBuild:   "abc123",
		Now:            func() time.Time { return now },
		HTTPClient: &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			requests++
			require.Equal(t, latestReleaseURL, req.URL.String())
			require.Equal(t, "openpost-update-checker", req.Header.Get("User-Agent"))
			require.Equal(t, "2026-03-10", req.Header.Get("X-GitHub-Api-Version"))
			require.Empty(t, req.Header.Get("Authorization"))
			return releaseResponse(http.StatusOK, `{
				"tag_name":"v1.3.0",
				"html_url":"https://github.com/rodrgds/openpost/releases/tag/v1.3.0",
				"published_at":"2026-07-26T10:00:00Z",
				"draft":false,
				"prerelease":false
			}`, `"release-v1.3.0"`), nil
		})},
	})

	first := service.Check(t.Context())
	second := service.Check(t.Context())

	require.Equal(t, StateUpdateAvailable, first.State)
	require.Equal(t, "v1.3.0", first.LatestVersion)
	require.Equal(t, "https://github.com/rodrgds/openpost/releases/tag/v1.3.0", first.ReleaseURL)
	require.Equal(t, first, second)
	require.Equal(t, 1, requests)
}

func TestCheckUsesETagAndKeepsCachedRelease(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	requests := 0
	service := NewService(Options{
		Enabled:        true,
		RunningVersion: "v1.2.3",
		Now:            func() time.Time { return now },
		HTTPClient: &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			requests++
			if requests == 1 {
				return releaseResponse(http.StatusOK, `{
					"tag_name":"v1.3.0",
					"html_url":"https://github.com/rodrgds/openpost/releases/tag/v1.3.0",
					"published_at":"2026-07-26T10:00:00Z"
				}`, `"etag-1"`), nil
			}
			require.Equal(t, `"etag-1"`, req.Header.Get("If-None-Match"))
			return releaseResponse(http.StatusNotModified, "", ""), nil
		})},
	})

	first := service.Check(t.Context())
	now = now.Add(successCacheTTL)
	second := service.Check(t.Context())

	require.Equal(t, StateUpdateAvailable, first.State)
	require.Equal(t, StateUpdateAvailable, second.State)
	require.Equal(t, first.LatestVersion, second.LatestVersion)
	require.Equal(t, 2, requests)
}

func TestCheckReturnsStaleCacheAfterBoundedFailure(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	requests := 0
	service := NewService(Options{
		Enabled:        true,
		RunningVersion: "v1.2.3",
		Now:            func() time.Time { return now },
		HTTPClient: &http.Client{Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
			requests++
			if requests == 1 {
				return releaseResponse(http.StatusOK, `{
					"tag_name":"v1.3.0",
					"html_url":"https://github.com/rodrgds/openpost/releases/tag/v1.3.0",
					"published_at":"2026-07-26T10:00:00Z"
				}`, ""), nil
			}
			return nil, errors.New("network unavailable")
		})},
	})

	require.Equal(t, StateUpdateAvailable, service.Check(t.Context()).State)
	now = now.Add(successCacheTTL)
	stale := service.Check(t.Context())
	cachedFailure := service.Check(t.Context())

	require.Equal(t, StateStale, stale.State)
	require.Equal(t, "v1.3.0", stale.LatestVersion)
	require.Equal(t, stale, cachedFailure)
	require.Equal(t, 2, requests)
}

func TestCheckRejectsUntrustedReleaseLinks(t *testing.T) {
	t.Parallel()

	service := NewService(Options{
		Enabled:        true,
		RunningVersion: "v1.2.3",
		HTTPClient: &http.Client{Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
			return releaseResponse(http.StatusOK, `{
				"tag_name":"v1.3.0",
				"html_url":"https://example.com/download/openpost",
				"published_at":"2026-07-26T10:00:00Z"
			}`, ""), nil
		})},
	})

	require.Equal(t, StateUnavailable, service.Check(t.Context()).State)
}

func TestCheckRejectsMismatchedReleaseLinks(t *testing.T) {
	t.Parallel()

	service := NewService(Options{
		Enabled:        true,
		RunningVersion: "v1.2.3",
		HTTPClient: &http.Client{Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
			return releaseResponse(http.StatusOK, `{
				"tag_name":"v1.3.0",
				"html_url":"https://github.com/rodrgds/openpost/releases/tag/v9.9.9",
				"published_at":"2026-07-26T10:00:00Z"
			}`, ""), nil
		})},
	})

	require.Equal(t, StateUnavailable, service.Check(t.Context()).State)
}

func TestCheckRejectsOversizedResponses(t *testing.T) {
	t.Parallel()

	service := NewService(Options{
		Enabled:        true,
		RunningVersion: "v1.2.3",
		HTTPClient: &http.Client{Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
			return releaseResponse(http.StatusOK, strings.Repeat("x", maxResponseBytes+1), ""), nil
		})},
	})

	require.Equal(t, StateUnavailable, service.Check(t.Context()).State)
}

func TestRedirectPolicyRejectsDowngradesAndNonDefaultPorts(t *testing.T) {
	original, err := http.NewRequestWithContext(t.Context(), http.MethodGet, latestReleaseURL, nil)
	require.NoError(t, err)
	downgrade, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "http://api.github.com/releases/latest", nil)
	require.NoError(t, err)
	alternatePort, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "https://api.github.com:8443/releases/latest", nil)
	require.NoError(t, err)
	sameHost, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "https://api.github.com/repositories/releases/latest", nil)
	require.NoError(t, err)

	require.Error(t, sameHostRedirectPolicy(downgrade, []*http.Request{original}))
	require.Error(t, sameHostRedirectPolicy(alternatePort, []*http.Request{original}))
	require.NoError(t, sameHostRedirectPolicy(sameHost, []*http.Request{original}))
}

func TestDevelopmentBuildDoesNotCheckForReleases(t *testing.T) {
	t.Parallel()

	service := NewService(Options{
		Enabled:        true,
		RunningVersion: "dev",
		HTTPClient: &http.Client{Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
			return nil, errors.New("unexpected request")
		})},
	})

	require.Equal(t, StateDevelopment, service.Check(context.Background()).State)
}

func releaseResponse(status int, body, etag string) *http.Response {
	header := make(http.Header)
	if etag != "" {
		header.Set("ETag", etag)
	}
	return &http.Response{
		StatusCode: status,
		Header:     header,
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}
