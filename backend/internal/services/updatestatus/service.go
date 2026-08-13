package updatestatus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	StateCurrent         = "current"
	StateUpdateAvailable = "update_available"
	StateStale           = "stale"
	StateUnavailable     = "unavailable"
	StateDisabled        = "disabled"
	StateDevelopment     = "development"

	latestReleaseURL = "https://api.github.com/repos/rodrgds/openpost/releases/latest"
	releaseURLPrefix = "/rodrgds/openpost/releases/tag/"
	maxResponseBytes = 64 << 10
	checkTimeout     = 3 * time.Second
	successCacheTTL  = 24 * time.Hour
	failureCacheTTL  = 15 * time.Minute
)

type Options struct {
	Enabled        bool
	DisabledReason string
	RunningVersion string
	RunningBuild   string
	HTTPClient     *http.Client
	Now            func() time.Time
}

type Status struct {
	State            string
	EffectiveEnabled bool
	DisabledReason   string
	RunningVersion   string
	RunningBuild     string
	LatestVersion    string
	ReleaseURL       string
	PublishedAt      time.Time
	CheckedAt        time.Time
}

type Service struct {
	enabled        bool
	disabledReason string
	runningVersion string
	runningBuild   string
	client         *http.Client
	now            func() time.Time

	mu          sync.Mutex
	cached      Status
	etag        string
	nextCheckAt time.Time
}

type githubRelease struct {
	TagName     string    `json:"tag_name"`
	HTMLURL     string    `json:"html_url"`
	PublishedAt time.Time `json:"published_at"`
	Draft       bool      `json:"draft"`
	Prerelease  bool      `json:"prerelease"`
}

func NewService(options Options) *Service {
	now := options.Now
	if now == nil {
		now = time.Now
	}

	client := http.DefaultClient
	if options.HTTPClient != nil {
		client = options.HTTPClient
	}
	boundedClient := *client
	boundedClient.CheckRedirect = sameHostRedirectPolicy

	runningVersion := strings.TrimSpace(options.RunningVersion)
	if runningVersion == "" {
		runningVersion = "dev"
	}
	runningBuild := strings.TrimSpace(options.RunningBuild)
	if runningBuild == "" {
		runningBuild = "unknown"
	}

	return &Service{
		enabled:        options.Enabled,
		disabledReason: strings.TrimSpace(options.DisabledReason),
		runningVersion: runningVersion,
		runningBuild:   runningBuild,
		client:         &boundedClient,
		now:            now,
	}
}

func (s *Service) Check(ctx context.Context) Status {
	base := Status{
		EffectiveEnabled: s.enabled,
		DisabledReason:   s.disabledReason,
		RunningVersion:   s.runningVersion,
		RunningBuild:     s.runningBuild,
	}
	if !s.enabled {
		base.State = StateDisabled
		return base
	}
	if _, ok := parseStableVersion(s.runningVersion); !ok {
		base.State = StateDevelopment
		return base
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now().UTC()
	if !s.nextCheckAt.IsZero() && now.Before(s.nextCheckAt) {
		return s.cached
	}

	release, etag, notModified, err := s.fetchLatest(ctx)
	if err != nil {
		s.cached = s.failedStatus(base, now)
		s.nextCheckAt = now.Add(failureCacheTTL)
		return s.cached
	}
	if notModified {
		if s.cached.LatestVersion == "" {
			s.cached = s.failedStatus(base, now)
			s.nextCheckAt = now.Add(failureCacheTTL)
			return s.cached
		}
		s.cached.State = compareState(s.runningVersion, s.cached.LatestVersion)
		s.cached.CheckedAt = now
		s.nextCheckAt = now.Add(successCacheTTL)
		return s.cached
	}

	s.etag = etag
	s.cached = Status{
		State:            compareState(s.runningVersion, release.TagName),
		EffectiveEnabled: s.enabled,
		DisabledReason:   s.disabledReason,
		RunningVersion:   s.runningVersion,
		RunningBuild:     s.runningBuild,
		LatestVersion:    release.TagName,
		ReleaseURL:       release.HTMLURL,
		PublishedAt:      release.PublishedAt.UTC(),
		CheckedAt:        now,
	}
	s.nextCheckAt = now.Add(successCacheTTL)
	return s.cached
}

func (s *Service) failedStatus(base Status, checkedAt time.Time) Status {
	if s.cached.LatestVersion != "" {
		stale := s.cached
		stale.State = StateStale
		stale.CheckedAt = checkedAt
		return stale
	}
	base.State = StateUnavailable
	base.CheckedAt = checkedAt
	return base
}

func (s *Service) fetchLatest(ctx context.Context) (githubRelease, string, bool, error) {
	requestCtx, cancel := context.WithTimeout(ctx, checkTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, latestReleaseURL, nil)
	if err != nil {
		return githubRelease{}, "", false, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2026-03-10")
	req.Header.Set("User-Agent", "openpost-update-checker")
	if s.etag != "" {
		req.Header.Set("If-None-Match", s.etag)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return githubRelease{}, "", false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		return githubRelease{}, s.etag, true, nil
	}
	if resp.StatusCode != http.StatusOK {
		return githubRelease{}, "", false, fmt.Errorf("release lookup returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return githubRelease{}, "", false, err
	}
	if len(body) > maxResponseBytes {
		return githubRelease{}, "", false, errors.New("release lookup response is too large")
	}

	var release githubRelease
	if err := json.Unmarshal(body, &release); err != nil {
		return githubRelease{}, "", false, errors.New("release lookup response is invalid")
	}
	if release.Draft || release.Prerelease {
		return githubRelease{}, "", false, errors.New("release lookup did not return a stable release")
	}
	if _, ok := parseStableVersion(release.TagName); !ok {
		return githubRelease{}, "", false, errors.New("release tag is invalid")
	}
	if !validReleaseURL(release.HTMLURL, release.TagName) {
		return githubRelease{}, "", false, errors.New("release URL is invalid")
	}

	return release, strings.TrimSpace(resp.Header.Get("ETag")), false, nil
}

func sameHostRedirectPolicy(req *http.Request, via []*http.Request) error {
	if len(via) > 3 {
		return errors.New("release lookup stopped after three redirects")
	}
	if len(via) == 0 ||
		req.URL.Scheme != "https" ||
		req.URL.Port() != "" ||
		!strings.EqualFold(req.URL.Hostname(), via[0].URL.Hostname()) {
		return errors.New("release lookup refused a cross-host redirect")
	}
	return nil
}

func validReleaseURL(raw, tagName string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	return parsed.Scheme == "https" &&
		strings.EqualFold(parsed.Hostname(), "github.com") &&
		parsed.Port() == "" &&
		parsed.User == nil &&
		parsed.RawQuery == "" &&
		parsed.Fragment == "" &&
		parsed.EscapedPath() == releaseURLPrefix+url.PathEscape(tagName)
}

type stableVersion [3]uint64

func parseStableVersion(raw string) (stableVersion, bool) {
	value := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(raw), "v"))
	if value == "" || strings.ContainsAny(value, "-+") {
		return stableVersion{}, false
	}
	parts := strings.Split(value, ".")
	if len(parts) != 3 {
		return stableVersion{}, false
	}

	var parsed stableVersion
	for i, part := range parts {
		if part == "" || (len(part) > 1 && part[0] == '0') {
			return stableVersion{}, false
		}
		number, err := strconv.ParseUint(part, 10, 64)
		if err != nil {
			return stableVersion{}, false
		}
		parsed[i] = number
	}
	return parsed, true
}

func compareState(runningRaw, latestRaw string) string {
	running, runningOK := parseStableVersion(runningRaw)
	latest, latestOK := parseStableVersion(latestRaw)
	if !runningOK || !latestOK {
		return StateUnavailable
	}
	for i := range running {
		if latest[i] > running[i] {
			return StateUpdateAvailable
		}
		if latest[i] < running[i] {
			return StateCurrent
		}
	}
	return StateCurrent
}
