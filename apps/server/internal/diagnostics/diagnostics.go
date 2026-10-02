// Package diagnostics implements OpenPost's maintainer diagnostics channel.
//
// Maintainer diagnostics are separate from product analytics. An operator's own
// PostHog project remains theirs: diagnostic reports never inherit user
// identities, sessions, or product events. Reports answer "what broke, in
// which build, under what technical conditions" and are built from an explicit
// allowlist of fields. Arbitrary authored content, credentials, request or
// response bodies, cookies, headers, and client IPs are never accepted.
//
// Delivery goes to a configurable receiver URL (empty means disabled) and
// never blocks application work: collection uses a bounded in-memory queue
// with drop-when-full semantics, short timeouts, and backoff. The
// application database is intentionally not involved, so database failures
// themselves remain diagnosable.
//
// These are privacy-limited diagnostic reports, not anonymous telemetry: each
// installation generates a random installation ID, and the receiving
// infrastructure necessarily observes the connecting server's IP.
package diagnostics

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// Normalized error codes. Reports must use one of these codes so the receiver
// can aggregate without inspecting free-form text.
const (
	CodeAPI5xx                    = "api_5xx"
	CodeHTTPStreamFailed          = "http_stream_failed"
	CodeHTTPPanic                 = "http_panic"
	CodeWorkerPanic               = "worker_panic"
	CodeWorkerFailed              = "worker_failed"
	CodePublishFailed             = "publish_failed"
	CodeMediaFailed               = "media_failed"
	CodeExportFailed              = "export_failed"
	CodeStartupFailed             = "startup_failed"
	CodeBrowserUncaught           = "browser_uncaught"
	CodeBrowserUnhandledRejection = "browser_unhandled_rejection"
	CodeProviderAuthExpired       = "provider_auth_expired"
	CodeProviderRateLimited       = "provider_rate_limited"
	CodeProviderOutage            = "provider_outage"
)

var allowedErrorCodes = map[string]struct{}{
	CodeAPI5xx:                    {},
	CodeHTTPStreamFailed:          {},
	CodeHTTPPanic:                 {},
	CodeWorkerPanic:               {},
	CodeWorkerFailed:              {},
	CodePublishFailed:             {},
	CodeMediaFailed:               {},
	CodeExportFailed:              {},
	CodeStartupFailed:             {},
	CodeBrowserUncaught:           {},
	CodeBrowserUnhandledRejection: {},
	CodeProviderAuthExpired:       {},
	CodeProviderRateLimited:       {},
	CodeProviderOutage:            {},
}

// ExpectedFailureCodes are structured failure codes for anticipated
// conditions (expired credentials, rate limits, temporary provider outages).
// They are aggregated as counts rather than urgent bug alerts.
var ExpectedFailureCodes = map[string]struct{}{
	CodeProviderAuthExpired: {},
	CodeProviderRateLimited: {},
	CodeProviderOutage:      {},
}

// Surfaces identify where the failure was observed.
const (
	SurfaceBrowser = "browser"
	SurfaceBackend = "backend"
	SurfaceWorker  = "worker"
)

var allowedSurfaces = map[string]struct{}{
	SurfaceBrowser: {},
	SurfaceBackend: {},
	SurfaceWorker:  {},
}

// allowedProviders mirrors the first-party platform allowlist used for
// product telemetry. Only these values may appear in a report.
var allowedProviders = map[string]struct{}{
	"bluesky": {}, "discord": {}, "facebook": {}, "instagram": {},
	"lemmy": {}, "linkedin": {}, "mastodon": {}, "peertube": {},
	"piefed": {}, "pinterest": {}, "pixelfed": {}, "telegram": {},
	"threads": {}, "tiktok": {}, "x": {}, "youtube": {},
}

// allowedDBDrivers and allowedStorageDrivers keep driver identification
// low-cardinality. Unknown drivers are normalized to "other".
var allowedDBDrivers = map[string]struct{}{
	"sqlite": {}, "postgres": {}, "other": {},
}

var allowedStorageDrivers = map[string]struct{}{
	"local": {}, "s3": {}, "r2": {}, "gcs": {}, "other": {},
}

// Frame is one sanitized stack frame: module path, function name, and line
// only. Absolute local paths, URLs, and custom domains are stripped during
// sanitization.
type Frame struct {
	Module   string `json:"module"`
	Function string `json:"function"`
	Line     int    `json:"line"`
}

// Report is the typed diagnostic payload. Every field is allowlisted; the
// HTTP boundary additionally rejects unknown JSON fields.
type Report struct {
	InstallationID  string    `json:"installation_id"`
	Version         string    `json:"version"`
	Revision        string    `json:"revision"`
	Surface         string    `json:"surface"`
	Operation       string    `json:"operation"`
	ErrorCode       string    `json:"error_code"`
	Provider        string    `json:"provider,omitempty"`
	HTTPStatus      int       `json:"http_status,omitempty"`
	RetryCount      int       `json:"retry_count,omitempty"`
	AttemptCount    int       `json:"attempt_count,omitempty"`
	DBDriver        string    `json:"db_driver,omitempty"`
	StorageDriver   string    `json:"storage_driver,omitempty"`
	Frames          []Frame   `json:"frames,omitempty"`
	OccurrenceCount int       `json:"occurrence_count,omitempty"`
	FirstSeen       time.Time `json:"first_seen"`
	LastSeen        time.Time `json:"last_seen"`
}

var (
	installationIDPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)
	versionPattern        = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$`)
	revisionPattern       = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$`)
	// operationPattern permits route templates ("/api/v1/publications"),
	// job types ("publication_publish"), and dotted operation names. It
	// rejects whitespace, query strings, and arbitrary text.
	operationPattern = regexp.MustCompile(`^[A-Za-z0-9_/.:-]{1,160}$`)
	// modulePattern permits normalized Go/JS module paths after domain and
	// user-directory stripping.
	modulePattern   = regexp.MustCompile(`^[A-Za-z0-9_@./~+-]{1,240}$`)
	functionPattern = regexp.MustCompile(`^[A-Za-z0-9_.$#/()\[\]*,-]{1,160}$`)
	sensitiveValue  = regexp.MustCompile(`(?i)(bearer\s+\S+|authorization\s*[:=]\s*(?:bearer\s+)?\S+|(?:cookie|oauth|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|api[_-]?key)\s*[:=]\s*\S+)`)
	// moduleVersionSuffix matches Go module version suffixes
	// ("testify@v1.11.1"). They are public dependency versions, safe to
	// drop for low-cardinality aggregation.
	moduleVersionSuffix = regexp.MustCompile(`@[A-Za-z0-9._~+-]+`)
)

const (
	maxFrames       = 24
	maxOperationLen = 160
	maxProviderLen  = 32
	maxDriverLen    = 16
	maxVersionLen   = 64
	maxRevisionLen  = 128
	maxOccurrences  = 1 << 30
	maxHTTPStatus   = 599
	maxRetryCount   = 1 << 20
	maxAttemptCount = 1 << 20
)

// ValidateReport rejects reports with unknown, missing, or sensitive fields.
// It is called both at the local HTTP boundary (after strict JSON decoding)
// and immediately before sending, so a disabled-then-enabled queue cannot
// smuggle unvalidated payloads.
func ValidateReport(report Report) error {
	if err := validateReportIdentity(report); err != nil {
		return err
	}
	if err := validateReportBounds(report); err != nil {
		return err
	}
	if err := validateReportFrames(report.Frames); err != nil {
		return err
	}
	return validateReportTimes(report.FirstSeen, report.LastSeen)
}

func validateReportIdentity(report Report) error {
	if !installationIDPattern.MatchString(report.InstallationID) {
		return fmt.Errorf("diagnostics report requires a valid installation_id")
	}
	if _, ok := allowedErrorCodes[report.ErrorCode]; !ok {
		return fmt.Errorf("diagnostics report has an unknown error_code")
	}
	if _, ok := allowedSurfaces[report.Surface]; !ok {
		return fmt.Errorf("diagnostics report has an unknown surface")
	}
	if report.Provider != "" {
		if _, ok := allowedProviders[report.Provider]; !ok {
			return fmt.Errorf("diagnostics report has an unknown provider")
		}
	}
	if report.Version != "" && !versionPattern.MatchString(report.Version) {
		return fmt.Errorf("diagnostics report has an invalid version")
	}
	if report.Revision != "" && !revisionPattern.MatchString(report.Revision) {
		return fmt.Errorf("diagnostics report has an invalid revision")
	}
	if !operationPattern.MatchString(report.Operation) {
		return fmt.Errorf("diagnostics report has an invalid operation")
	}
	if report.DBDriver != "" {
		if _, ok := allowedDBDrivers[report.DBDriver]; !ok {
			return fmt.Errorf("diagnostics report has an unknown db_driver")
		}
	}
	if report.StorageDriver != "" {
		if _, ok := allowedStorageDrivers[report.StorageDriver]; !ok {
			return fmt.Errorf("diagnostics report has an unknown storage_driver")
		}
	}
	return nil
}

func validateReportBounds(report Report) error {
	if report.HTTPStatus < 0 || report.HTTPStatus > maxHTTPStatus {
		return fmt.Errorf("diagnostics report has an invalid http_status")
	}
	if report.RetryCount < 0 || report.RetryCount > maxRetryCount {
		return fmt.Errorf("diagnostics report has an invalid retry_count")
	}
	if report.AttemptCount < 0 || report.AttemptCount > maxAttemptCount {
		return fmt.Errorf("diagnostics report has an invalid attempt_count")
	}
	if report.OccurrenceCount < 0 || report.OccurrenceCount > maxOccurrences {
		return fmt.Errorf("diagnostics report has an invalid occurrence_count")
	}
	return nil
}

func validateReportFrames(frames []Frame) error {
	if len(frames) > maxFrames {
		return fmt.Errorf("diagnostics report has too many frames")
	}
	for _, frame := range frames {
		if err := validateFrame(frame); err != nil {
			return err
		}
	}
	return nil
}

func validateReportTimes(firstSeen, lastSeen time.Time) error {
	if firstSeen.IsZero() || lastSeen.IsZero() {
		return fmt.Errorf("diagnostics report requires first_seen and last_seen")
	}
	if lastSeen.Before(firstSeen) {
		return fmt.Errorf("diagnostics report has last_seen before first_seen")
	}
	return nil
}

func validateFrame(frame Frame) error {
	if !modulePattern.MatchString(frame.Module) {
		return fmt.Errorf("diagnostics report has an invalid frame module %q", frame.Module)
	}
	if !functionPattern.MatchString(frame.Function) {
		return fmt.Errorf("diagnostics report has an invalid frame function %q", frame.Function)
	}
	if frame.Line < 0 || frame.Line > 1<<30 {
		return fmt.Errorf("diagnostics report has an invalid frame line")
	}
	if containsSensitiveString(frame.Module) || containsSensitiveString(frame.Function) {
		return fmt.Errorf("diagnostics report frame contains a sensitive value")
	}
	return nil
}

// SanitizeReport normalizes a report in place: it strips domains and user
// directories from frame modules, normalizes unknown drivers to "other",
// clamps counters, and truncates frame lists. It never invents content.
// Validation must still run after sanitization.
func SanitizeReport(report *Report) {
	report.ErrorCode = strings.TrimSpace(report.ErrorCode)
	report.Surface = strings.TrimSpace(report.Surface)
	report.Operation = normalizeOperation(report.Operation)
	report.Provider = strings.ToLower(strings.TrimSpace(report.Provider))
	if len(report.Provider) > maxProviderLen {
		report.Provider = report.Provider[:maxProviderLen]
	}
	report.Version = truncateRunes(strings.TrimSpace(report.Version), maxVersionLen)
	report.Revision = truncateRunes(strings.TrimSpace(report.Revision), maxRevisionLen)
	report.DBDriver = normalizeDriver(strings.TrimSpace(report.DBDriver), allowedDBDrivers)
	report.StorageDriver = normalizeDriver(strings.TrimSpace(report.StorageDriver), allowedStorageDrivers)
	report.HTTPStatus = clampInt(report.HTTPStatus, maxHTTPStatus)
	report.RetryCount = clampInt(report.RetryCount, maxRetryCount)
	report.AttemptCount = clampInt(report.AttemptCount, maxAttemptCount)
	report.OccurrenceCount = clampInt(report.OccurrenceCount, maxOccurrences)
	if len(report.Frames) > maxFrames {
		report.Frames = report.Frames[:maxFrames]
	}
	for i := range report.Frames {
		report.Frames[i].Module = normalizeModule(report.Frames[i].Module)
		report.Frames[i].Function = truncateRunes(strings.TrimSpace(report.Frames[i].Function), 160)
		report.Frames[i].Line = clampInt(report.Frames[i].Line, 1<<30)
	}
	if report.FirstSeen.IsZero() {
		report.FirstSeen = report.LastSeen
	}
	if report.LastSeen.IsZero() {
		report.LastSeen = report.FirstSeen
	}
	report.FirstSeen = report.FirstSeen.UTC()
	report.LastSeen = report.LastSeen.UTC()
}

// normalizeOperation keeps route templates and job-type identifiers while
// rejecting anything that looks like free-form text, URLs, or query strings.
func normalizeOperation(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if strings.ContainsAny(value, " \t\n?#@") || strings.Contains(value, "://") {
		return ""
	}
	if len(value) > maxOperationLen {
		value = value[:maxOperationLen]
	}
	return value
}

// normalizeModule strips URL origins and user home directories from a frame
// module so a self-hoster's domain or username can never leave the instance.
// What remains is a module path plus file base name.
func normalizeModule(value string) string {
	value = stripModuleOrigin(strings.TrimSpace(value))
	segments := sanitizeModuleSegments(strings.Split(strings.ReplaceAll(value, "\\", "/"), "/"))
	return boundModuleTail(strings.Join(segments, "/"))
}

func stripModuleOrigin(value string) string {
	idx := strings.Index(value, "://")
	if idx < 0 {
		return value
	}
	rest := value[idx+3:]
	if slash := strings.Index(rest, "/"); slash >= 0 {
		return rest[slash+1:]
	}
	return ""
}

func sanitizeModuleSegments(segments []string) []string {
	kept := make([]string, 0, len(segments))
	skipNext := false
	for i, segment := range segments {
		if skipNext {
			skipNext = false
			continue
		}
		segment = moduleVersionSuffix.ReplaceAllString(segment, "")
		if strings.Contains(segment, "@") || segment == "" || (i == 0 && len(segment) == 2 && segment[1] == ':') {
			continue
		}
		if isSensitiveModuleRoot(segment) {
			skipNext = true
			continue
		}
		kept = append(kept, segment)
	}
	if len(kept) > 4 {
		return kept[len(kept)-4:]
	}
	return kept
}

func isSensitiveModuleRoot(segment string) bool {
	switch strings.ToLower(segment) {
	case "home", "users", "private", "var", "tmp", "opt":
		return true
	default:
		return false
	}
}

func boundModuleTail(value string) string {
	if len(value) <= 240 {
		return value
	}
	value = value[len(value)-240:]
	if slash := strings.Index(value, "/"); slash >= 0 {
		return value[slash+1:]
	}
	return value
}

func normalizeDriver(value string, allowed map[string]struct{}) string {
	value = strings.ToLower(value)
	if len(value) > maxDriverLen {
		value = value[:maxDriverLen]
	}
	if value == "" {
		return ""
	}
	if _, ok := allowed[value]; ok {
		return value
	}
	return "other"
}

func containsSensitiveString(value string) bool {
	if sensitiveValue.MatchString(value) {
		return true
	}
	lowered := strings.ToLower(value)
	if strings.Contains(lowered, "://") || strings.Contains(lowered, "@") {
		return true
	}
	if strings.HasPrefix(value, "eyJ") && strings.Count(value, ".") == 2 {
		return true
	}
	return false
}

func clampInt(value, high int) int {
	if value < 0 {
		return 0
	}
	if value > high {
		return high
	}
	return value
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return value
}

// CaptureFrames records the current goroutine's stack as sanitized frames,
// skipping skip caller frames plus the runtime and this package's own
// capture frames. The result describes where the failure was observed, not
// application content.
func CaptureFrames(skip int) []Frame {
	const depth = maxFrames + 8
	programCounters := make([]uintptr, depth)
	n := runtime.Callers(skip+2, programCounters)
	programCounters = programCounters[:n]
	frames := runtime.CallersFrames(programCounters)
	var result []Frame
	for {
		frame, more := frames.Next()
		if frame.PC == 0 {
			break
		}
		if isCaptureFrame(frame.Function) {
			if !more {
				break
			}
			continue
		}
		result = append(result, Frame{
			Module:   normalizeModule(frame.File),
			Function: truncateRunes(frame.Function, 160),
			Line:     frame.Line,
		})
		if !more || len(result) >= maxFrames {
			break
		}
	}
	return result
}

func isCaptureFrame(function string) bool {
	return strings.Contains(function, "openpost/backend/internal/diagnostics.CaptureFrames") ||
		strings.HasPrefix(function, "runtime.")
}

// NewInstallationID generates a random 128-bit installation identifier. It is
// random, not derived from any machine, user, or instance attribute.
func NewInstallationID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("generate diagnostics installation ID: %w", err)
	}
	return hex.EncodeToString(raw[:]), nil
}

// LoadOrCreateInstallationID reads the persisted installation ID, creating
// and persisting one when absent. It operates on a plain file so it works
// without the application database. An empty path disables persistence: the
// caller must then treat the reporting decision as unknown and not send.
func LoadOrCreateInstallationID(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", fmt.Errorf("diagnostics installation ID file is not configured")
	}
	if data, err := os.ReadFile(path); err == nil {
		id := strings.TrimSpace(string(data))
		if installationIDPattern.MatchString(id) {
			return id, nil
		}
		// An unparseable file is replaced below; it never authorizes sending
		// until a valid ID is persisted.
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("read diagnostics installation ID: %w", err)
	}
	id, err := NewInstallationID()
	if err != nil {
		return "", err
	}
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return "", fmt.Errorf("create diagnostics state directory: %w", err)
		}
	}
	if err := os.WriteFile(path, []byte(id+"\n"), 0o600); err != nil {
		return "", fmt.Errorf("persist diagnostics installation ID: %w", err)
	}
	return id, nil
}

// DecodeStrictReport decodes a report payload while rejecting unknown JSON
// fields, oversized bodies, and trailing data. Unknown fields are rejected
// because the receiver treats them as untrusted.
func DecodeStrictReport(data []byte, limit int64) (Report, error) {
	var report Report
	if int64(len(data)) > limit {
		return report, fmt.Errorf("diagnostics report exceeds %d bytes", limit)
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&report); err != nil {
		return report, fmt.Errorf("decode diagnostics report: %w", err)
	}
	if decoder.More() {
		return report, fmt.Errorf("diagnostics report has trailing data")
	}
	return report, nil
}
