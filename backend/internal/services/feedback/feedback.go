package feedback

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // Register the JPEG decoder used by screenshot validation.
	_ "image/png"  // Register the PNG decoder used by screenshot validation.
	"net"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/uptrace/bun"
)

const (
	JobType                   = jobregistry.TypeFeedbackDelivery
	maxMessageRunes           = 4000
	maxScreenshotBytes        = 1 << 20
	maxScreenshotDimension    = 4096
	maxScreenshotPixels       = 8_000_000
	maxNavigationBreadcrumbs  = 10
	maxFailedAPIBreadcrumbs   = 15
	maxClientErrorBreadcrumbs = 10
)

var (
	allowedCategories = []string{"bug", "idea", "question"}
	allowedMIMETypes  = []string{"image/png", "image/jpeg"}
	sensitiveValue    = regexp.MustCompile(`(?i)(bearer\s+\S+|authorization\s*[:=]\s*(?:bearer\s+)?\S+|(?:cookie|oauth|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[:=]\s*\S+)`)
	absoluteURL       = regexp.MustCompile(`(?i)https?://[^\s]+`)
	privateHost       = regexp.MustCompile(`(?i)\b(localhost|[a-z0-9.-]+\.local|(?:10|127|192\.168)\.\d{1,3}\.\d{1,3}(?:\.\d{1,3})?|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b`)
	localPath         = regexp.MustCompile(`(?:[A-Za-z]:\\|/(?:Users|home|var|tmp|private|opt)/)[^\s]+`)
	safeBrowser       = regexp.MustCompile(`^(?:(?:Chrome|Edge|Firefox|Safari) \d+(?:\.\d+)?|Other browser)$`)
	safeComponent     = regexp.MustCompile(`^/[A-Za-z0-9_+./()[\]=-]{0,79}$`)
	safeErrorName     = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_.-]{0,47}$`)
)

var safeClientErrorMessages = map[string]struct{}{
	"Client operation cancelled":     {},
	"Client operation timed out":     {},
	"Network request failed":         {},
	"Client permission check failed": {},
	"Client operation failed":        {},
}

type Config struct {
	Enabled    bool
	Recipient  string
	SupportURL string
	AppVersion string
}

type PublicConfig struct {
	Enabled              bool     `json:"enabled"`
	Recipient            string   `json:"recipient,omitempty"`
	SupportURL           string   `json:"support_url,omitempty"`
	AppVersion           string   `json:"app_version"`
	MaxMessageCharacters int      `json:"max_message_characters"`
	MaxScreenshotBytes   int      `json:"max_screenshot_bytes"`
	DiagnosticCategories []string `json:"diagnostic_categories"`
}

type Viewport struct {
	Width      int     `json:"width"`
	Height     int     `json:"height"`
	PixelRatio float64 `json:"pixel_ratio"`
}

type FailedAPIRequest struct {
	Method     string `json:"method"`
	Path       string `json:"path"`
	Status     int    `json:"status"`
	DurationMS int    `json:"duration_ms"`
	Timestamp  string `json:"timestamp"`
}

type ClientError struct {
	Name      string `json:"name"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

type Diagnostics struct {
	RoutePath      string             `json:"route_path"`
	Component      string             `json:"component,omitempty"`
	Viewport       Viewport           `json:"viewport"`
	Browser        string             `json:"browser"`
	Navigation     []string           `json:"navigation"`
	FailedRequests []FailedAPIRequest `json:"failed_requests"`
	Errors         []ClientError      `json:"errors"`
}

type Screenshot struct {
	MIMEType string `json:"mime_type"`
	Data     string `json:"data"`
}

type Report struct {
	Category    string       `json:"category"`
	Message     string       `json:"message"`
	UserID      string       `json:"user_id"`
	AppVersion  string       `json:"app_version"`
	Diagnostics *Diagnostics `json:"diagnostics,omitempty"`
	Screenshot  *Screenshot  `json:"screenshot,omitempty"`
	CreatedAt   string       `json:"created_at"`
}

type Destination interface {
	Deliver(context.Context, Report) error
}

type Service struct {
	db          *bun.DB
	config      Config
	destination Destination
	now         func() time.Time
}

func NewService(db *bun.DB, config Config, destination Destination) *Service {
	config.Recipient = strings.TrimSpace(config.Recipient)
	config.SupportURL = safeSupportURL(config.SupportURL)
	config.AppVersion = strings.TrimSpace(config.AppVersion)
	if config.AppVersion == "" {
		config.AppVersion = "dev"
	}
	config.Enabled = config.Enabled && destination != nil && config.Recipient != ""
	return &Service{
		db: db, config: config, destination: destination,
		now: func() time.Time { return time.Now().UTC() },
	}
}

type rateLimitWindow struct {
	bun.BaseModel `bun:"table:feedback_rate_limit_windows"`

	UserID       string    `bun:"user_id,pk"`
	WindowStart  time.Time `bun:"window_start,pk"`
	RequestCount int       `bun:"request_count,notnull"`
}

// AllowSubmission uses a fixed database window so the feedback limit survives
// restarts and is shared by every hosted application instance.
func (s *Service) AllowSubmission(ctx context.Context, userID string, limit int, window time.Duration) (bool, error) {
	if s == nil || s.db == nil {
		return false, errors.New("feedback rate limiter is unavailable")
	}
	userID = strings.TrimSpace(userID)
	if userID == "" || limit <= 0 || window <= 0 {
		return false, errors.New("invalid feedback rate limit")
	}
	windowStart := s.now().UTC().Truncate(window)
	row := &rateLimitWindow{UserID: userID, WindowStart: windowStart, RequestCount: 1}
	result, err := s.db.NewInsert().Model(row).
		// bun aliases the model as `rate_limit_window`. Qualify the existing-row
		// references so Postgres can resolve them: with a table alias in place,
		// an unqualified `request_count` in ON CONFLICT DO UPDATE is ambiguous.
		On("CONFLICT (user_id, window_start) DO UPDATE").
		Set("request_count = rate_limit_window.request_count + 1").
		Where("rate_limit_window.request_count < ?", limit).
		Exec(ctx)
	if err != nil {
		return false, fmt.Errorf("apply feedback rate limit: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read feedback rate limit result: %w", err)
	}
	if affected > 0 {
		_, _ = s.db.NewDelete().Model((*rateLimitWindow)(nil)).
			Where("window_start < ?", windowStart.Add(-24*time.Hour)).
			Exec(ctx)
	}
	return affected > 0, nil
}

func (s *Service) PublicConfig() PublicConfig {
	if s == nil {
		return PublicConfig{
			AppVersion:           "dev",
			MaxMessageCharacters: maxMessageRunes,
			MaxScreenshotBytes:   maxScreenshotBytes,
			DiagnosticCategories: diagnosticCategories(),
		}
	}
	return PublicConfig{
		Enabled:              s.config.Enabled,
		Recipient:            s.config.Recipient,
		SupportURL:           s.config.SupportURL,
		AppVersion:           s.config.AppVersion,
		MaxMessageCharacters: maxMessageRunes,
		MaxScreenshotBytes:   maxScreenshotBytes,
		DiagnosticCategories: diagnosticCategories(),
	}
}

func diagnosticCategories() []string {
	return []string{
		"app version and page path",
		"viewport and browser",
		"recent page paths",
		"failed OpenPost API request metadata",
		"sanitized client errors",
	}
}

func (s *Service) Enqueue(ctx context.Context, report Report) (string, error) {
	if s == nil || !s.config.Enabled || s.destination == nil {
		return "", errors.New("feedback destination is not configured")
	}
	report.AppVersion = s.config.AppVersion
	report.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := SanitizeReport(&report); err != nil {
		return "", err
	}
	payload, err := json.Marshal(report)
	if err != nil {
		return "", errors.New("failed to encode feedback report")
	}
	job, err := jobregistry.NewJob(JobType, string(payload), time.Now().UTC())
	if err != nil {
		return "", errors.New("failed to queue feedback report")
	}
	if _, err := s.db.NewInsert().Model(job).Exec(ctx); err != nil {
		return "", errors.New("failed to queue feedback report")
	}
	return job.ID, nil
}

func (s *Service) HandleDeliveryJob(ctx context.Context, payload string) error {
	if s == nil || !s.config.Enabled || s.destination == nil {
		return errors.New("feedback destination is not configured")
	}
	var report Report
	if err := json.Unmarshal([]byte(payload), &report); err != nil {
		return errors.New("invalid feedback job payload")
	}
	report.AppVersion = s.config.AppVersion
	if err := SanitizeReport(&report); err != nil {
		return err
	}
	deliverCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return s.destination.Deliver(deliverCtx, report)
}

func SanitizeReport(report *Report) error {
	report.Category = strings.ToLower(strings.TrimSpace(report.Category))
	if !slices.Contains(allowedCategories, report.Category) {
		return errors.New("category must be bug, idea, or question")
	}
	report.Message = strings.TrimSpace(report.Message)
	if report.Message == "" {
		return errors.New("message is required")
	}
	if len([]rune(report.Message)) > maxMessageRunes {
		return fmt.Errorf("message must be at most %d characters", maxMessageRunes)
	}
	report.Message = sanitizeUserMessage(report.Message)
	report.UserID = boundedPlainText(report.UserID, 96)
	report.AppVersion = boundedPlainText(report.AppVersion, 64)
	if report.Diagnostics != nil {
		sanitizeDiagnostics(report.Diagnostics)
	}
	if report.Screenshot != nil {
		if err := validateScreenshot(report.Screenshot); err != nil {
			return err
		}
	}
	return nil
}

func sanitizeDiagnostics(diagnostics *Diagnostics) {
	diagnostics.RoutePath = safePath(diagnostics.RoutePath, false)
	diagnostics.Component = safeComponentName(diagnostics.Component)
	diagnostics.Browser = safeBrowserName(diagnostics.Browser)
	diagnostics.Viewport.Width = max(0, min(diagnostics.Viewport.Width, maxScreenshotDimension))
	diagnostics.Viewport.Height = max(0, min(diagnostics.Viewport.Height, maxScreenshotDimension))
	diagnostics.Viewport.PixelRatio = max(0, min(diagnostics.Viewport.PixelRatio, 2))

	navigation := make([]string, 0, min(len(diagnostics.Navigation), maxNavigationBreadcrumbs))
	for _, path := range diagnostics.Navigation {
		if safe := safePath(path, false); safe != "" {
			navigation = append(navigation, safe)
		}
		if len(navigation) == maxNavigationBreadcrumbs {
			break
		}
	}
	diagnostics.Navigation = navigation

	requests := make([]FailedAPIRequest, 0, min(len(diagnostics.FailedRequests), maxFailedAPIBreadcrumbs))
	for _, request := range diagnostics.FailedRequests {
		path := safePath(request.Path, true)
		if path == "" {
			continue
		}
		request.Method = strings.ToUpper(boundedPlainText(request.Method, 8))
		if !slices.Contains([]string{"GET", "POST", "PUT", "PATCH", "DELETE"}, request.Method) {
			continue
		}
		request.Path = path
		request.Status = max(0, min(request.Status, 599))
		request.DurationMS = max(0, min(request.DurationMS, 60_000))
		request.Timestamp = safeTimestamp(request.Timestamp)
		requests = append(requests, request)
		if len(requests) == maxFailedAPIBreadcrumbs {
			break
		}
	}
	diagnostics.FailedRequests = requests

	clientErrors := make([]ClientError, 0, min(len(diagnostics.Errors), maxClientErrorBreadcrumbs))
	for _, clientError := range diagnostics.Errors {
		clientError.Name = strings.TrimSpace(clientError.Name)
		if !safeErrorName.MatchString(clientError.Name) {
			clientError.Name = "Error"
		}
		clientError.Message = sanitizeErrorMessage(clientError.Message)
		clientError.Timestamp = safeTimestamp(clientError.Timestamp)
		if clientError.Name == "" && clientError.Message == "" {
			continue
		}
		clientErrors = append(clientErrors, clientError)
		if len(clientErrors) == maxClientErrorBreadcrumbs {
			break
		}
	}
	diagnostics.Errors = clientErrors
}

func validateScreenshot(screenshot *Screenshot) error {
	screenshot.MIMEType = strings.ToLower(strings.TrimSpace(screenshot.MIMEType))
	if !slices.Contains(allowedMIMETypes, screenshot.MIMEType) {
		return errors.New("screenshot must be a PNG or JPEG")
	}
	data, err := base64.StdEncoding.DecodeString(screenshot.Data)
	if err != nil || len(data) == 0 {
		return errors.New("screenshot data is invalid")
	}
	if len(data) > maxScreenshotBytes {
		return fmt.Errorf("screenshot must be at most %d bytes", maxScreenshotBytes)
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return errors.New("screenshot data is invalid")
	}
	expectedFormat := map[string]string{"image/png": "png", "image/jpeg": "jpeg"}[screenshot.MIMEType]
	if format != expectedFormat {
		return errors.New("screenshot MIME type does not match its contents")
	}
	if config.Width <= 0 || config.Height <= 0 ||
		config.Width > maxScreenshotDimension || config.Height > maxScreenshotDimension ||
		config.Width*config.Height > maxScreenshotPixels {
		return errors.New("screenshot dimensions are too large")
	}
	screenshot.Data = base64.StdEncoding.EncodeToString(data)
	return nil
}

func safePath(value string, requireAPI bool) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if parsed, err := url.Parse(value); err == nil {
		value = parsed.EscapedPath()
	}
	if value == "" || sensitiveValue.MatchString(value) ||
		!strings.HasPrefix(value, "/") || strings.Contains(value, "\\") {
		return ""
	}
	if requireAPI && !strings.HasPrefix(value, "/api/v1/") {
		return ""
	}
	if len(value) > 240 {
		value = value[:240]
	}
	return value
}

func sanitizeErrorMessage(value string) string {
	value = strings.TrimSpace(value)
	if _, ok := safeClientErrorMessages[value]; ok {
		return value
	}
	return "Client operation failed"
}

func sanitizeUserMessage(value string) string {
	value = sensitiveValue.ReplaceAllString(value, "[sensitive value removed]")
	value = absoluteURL.ReplaceAllStringFunc(value, func(raw string) string {
		parsed, err := url.Parse(strings.TrimRight(raw, ".,;:)"))
		if err != nil || parsed.Hostname() == "" {
			return "[url removed]"
		}
		host := strings.ToLower(parsed.Hostname())
		ip := net.ParseIP(host)
		if host == "localhost" || strings.HasSuffix(host, ".local") ||
			(ip != nil && (ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast())) {
			return "[private address removed]"
		}
		parsed.User = nil
		parsed.RawQuery = ""
		parsed.Fragment = ""
		return parsed.String()
	})
	value = privateHost.ReplaceAllString(value, "[private address removed]")
	return localPath.ReplaceAllString(value, "[path removed]")
}

func safeBrowserName(value string) string {
	value = strings.TrimSpace(value)
	if safeBrowser.MatchString(value) {
		return value
	}
	return "Other browser"
}

func safeComponentName(value string) string {
	value = strings.TrimSpace(value)
	if safeComponent.MatchString(value) {
		return value
	}
	return ""
}

func boundedPlainText(value string, limit int) string {
	value = strings.TrimSpace(strings.Map(func(r rune) rune {
		if r < 32 && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, value))
	runes := []rune(value)
	if len(runes) > limit {
		value = string(runes[:limit])
	}
	return value
}

func safeTimestamp(value string) string {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return ""
	}
	return parsed.UTC().Format(time.RFC3339)
}

func safeSupportURL(value string) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return ""
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func NewDiscordDestination(webhookURL string) (Destination, error) {
	parsed, err := url.Parse(strings.TrimSpace(webhookURL))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return nil, errors.New("feedback destination URL must be an HTTPS webhook URL")
	}
	return &DiscordDestination{
		webhookURL: parsed.String(),
		client:     &http.Client{Timeout: 8 * time.Second},
	}, nil
}
