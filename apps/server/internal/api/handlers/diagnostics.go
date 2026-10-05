package handlers

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/diagnostics"
)

// maxDiagnosticsRequestBytes caps a single browser report. Reports are
// metadata only; anything larger is rejected before decoding.
const maxDiagnosticsRequestBytes = 64 << 10

// Huma treats reaching MaxBodyBytes as oversized, so add one byte to keep the
// application limit inclusive.
const maxDiagnosticsHumaBodyBytes = maxDiagnosticsRequestBytes + 1

// DiagnosticsHandler serves the instance-local diagnostics channel. Browsers
// report to their own OpenPost instance; the instance administrator owns the
// reporting switch, and only the sanitized diagnostic envelope may leave the
// instance. There is deliberately no direct browser-to-receiver path: when
// the backend is unavailable, browser reports are lost rather than silently
// rerouted.
type DiagnosticsHandler struct {
	reporter *diagnostics.Reporter
	auth     middleware.Authenticator
	limiter  *diagnosticsSubmitLimiter
}

func NewDiagnosticsHandler(
	reporter *diagnostics.Reporter,
	authenticator middleware.Authenticator,
) *DiagnosticsHandler {
	if reporter == nil {
		reporter = diagnostics.DisabledReporter()
	}
	return &DiagnosticsHandler{
		reporter: reporter,
		auth:     authenticator,
		limiter:  newDiagnosticsSubmitLimiter(10, time.Minute),
	}
}

type DiagnosticsConfigOutput struct {
	Body diagnostics.Status
}

// DiagnosticsFrame mirrors diagnostics.Frame for OpenAPI generation.
type DiagnosticsFrame struct {
	Module   string `json:"module" maxLength:"240" doc:"Normalized module path and file, never a URL or domain"`
	Function string `json:"function" maxLength:"160" doc:"Function name"`
	Line     int    `json:"line" minimum:"0" doc:"Source line"`
	Column   int    `json:"column,omitempty" minimum:"0" maximum:"1073741824" doc:"Source column, when available"`
}

// SubmitDiagnosticsInputBody is the allowlisted report shape. Only these
// fields are decoded; anything else in the payload is ignored and never
// forwarded. Timestamps the client cannot know (installation, build) are
// stamped by the reporter, not accepted here.
type SubmitDiagnosticsInputBody struct {
	Surface      string             `json:"surface" enum:"browser,backend,worker" doc:"Surface where the failure was observed"`
	Operation    string             `json:"operation" maxLength:"160" doc:"Route template, job type, or operation name"`
	ErrorCode    string             `json:"error_code" maxLength:"64" doc:"Normalized error code from the diagnostics catalog"`
	ErrorKind    string             `json:"error_kind,omitempty" enum:"deadline_exceeded,canceled,not_found,permission_denied,connection_refused,connection_reset,unexpected_eof,dns_error,network_timeout,runtime_error,type_error,reference_error,range_error,syntax_error,quota_exceeded,security_error,not_supported,invalid_state,abort_error,network_error" doc:"Allowlisted error type, never message text"`
	HTTPMethod   string             `json:"http_method,omitempty" enum:"GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS,CONNECT,TRACE" doc:"HTTP request method, when relevant"`
	Provider     string             `json:"provider,omitempty" maxLength:"32" doc:"First-party platform, when relevant"`
	HTTPStatus   int                `json:"http_status,omitempty" minimum:"0" maximum:"599" doc:"HTTP status, when relevant"`
	RetryCount   int                `json:"retry_count,omitempty" minimum:"0" doc:"Retry count, when relevant"`
	AttemptCount int                `json:"attempt_count,omitempty" minimum:"0" doc:"Attempt count, when relevant"`
	Frames       []DiagnosticsFrame `json:"frames,omitempty" maxItems:"24" doc:"Sanitized stack frames without domains or local paths"`
}

type SubmitDiagnosticsInput struct {
	Body SubmitDiagnosticsInputBody
}

type SubmitDiagnosticsOutput struct {
	Body struct {
		Accepted bool `json:"accepted"`
		Enabled  bool `json:"enabled"`
	}
}

func (h *DiagnosticsHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-diagnostics-config",
		Method:      http.MethodGet,
		Path:        "/diagnostics/config",
		Summary:     "Get maintainer diagnostics reporting settings",
		Description: "Whether this instance sends privacy-limited diagnostic reports to OpenPost. No receiver URL, token, or installation identifier is exposed.",
		Tags:        []string{"Diagnostics"},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(_ context.Context, _ *struct{}) (*DiagnosticsConfigOutput, error) {
		return &DiagnosticsConfigOutput{Body: h.reporter.PublicConfig()}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:  "submit-diagnostics",
		Method:       http.MethodPost,
		Path:         "/diagnostics/report",
		Summary:      "Submit a sanitized diagnostic report to this instance",
		Description:  "Only the allowlisted diagnostic envelope is accepted. User content, credentials, and request bodies are rejected during validation.",
		Tags:         []string{"Diagnostics"},
		MaxBodyBytes: maxDiagnosticsHumaBodyBytes,
		Middlewares:  huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:       []int{400, 413, 429},
	}, func(ctx context.Context, input *SubmitDiagnosticsInput) (*SubmitDiagnosticsOutput, error) {
		userID := middleware.GetUserID(ctx)
		if !h.limiter.allow(userID) {
			return nil, huma.Error429TooManyRequests("diagnostics limit reached; wait a minute and try again")
		}
		frames := make([]diagnostics.Frame, 0, len(input.Body.Frames))
		for _, frame := range input.Body.Frames {
			frames = append(frames, diagnostics.Frame{
				Module:   frame.Module,
				Function: frame.Function,
				Line:     frame.Line,
				Column:   frame.Column,
			})
		}
		now := time.Now().UTC()
		report := diagnostics.Report{
			Surface:      input.Body.Surface,
			Operation:    input.Body.Operation,
			ErrorCode:    input.Body.ErrorCode,
			ErrorKind:    input.Body.ErrorKind,
			HTTPMethod:   input.Body.HTTPMethod,
			Provider:     input.Body.Provider,
			HTTPStatus:   input.Body.HTTPStatus,
			RetryCount:   input.Body.RetryCount,
			AttemptCount: input.Body.AttemptCount,
			Frames:       frames,
			FirstSeen:    now,
			LastSeen:     now,
		}
		diagnostics.SanitizeReport(&report)
		// The reporter stamps installation, build, and driver context, then
		// revalidates before queueing. Surface "backend" is never accepted
		// from the browser: backend failures are observed server-side.
		if report.Surface != diagnostics.SurfaceBrowser {
			return nil, huma.Error400BadRequest("surface must be browser")
		}
		if err := diagnostics.ValidateReport(reportWithoutIdentity(report)); err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		h.reporter.Report(report)
		output := &SubmitDiagnosticsOutput{}
		output.Body.Accepted = true
		output.Body.Enabled = h.reporter.Enabled()
		return output, nil
	})
}

// reportWithoutIdentity fills the reporter-stamped fields with placeholders
// so the handler can pre-validate the client-controlled portion before
// queueing. The reporter replaces these values and revalidates.
func reportWithoutIdentity(report diagnostics.Report) diagnostics.Report {
	report.InstallationID = "0123456789abcdef0123456789abcdef"
	report.Version = "0.0.0"
	return report
}

// diagnosticsSubmitLimiter is a small in-memory per-principal rate limiter.
// It intentionally avoids the application database: diagnostics must keep
// working (and stay bounded) when the database is the thing failing.
type diagnosticsSubmitLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	hits   map[string][]time.Time
}

func newDiagnosticsSubmitLimiter(limit int, window time.Duration) *diagnosticsSubmitLimiter {
	return &diagnosticsSubmitLimiter{limit: limit, window: window, hits: make(map[string][]time.Time)}
}

func (l *diagnosticsSubmitLimiter) allow(principal string) bool {
	if l == nil {
		return true
	}
	now := time.Now().UTC()
	l.mu.Lock()
	defer l.mu.Unlock()
	if principal == "" {
		principal = "anonymous"
	}
	cutoff := now.Add(-l.window)
	kept := l.hits[principal][:0]
	for _, hit := range l.hits[principal] {
		if hit.After(cutoff) {
			kept = append(kept, hit)
		}
	}
	if len(kept) >= l.limit {
		l.hits[principal] = kept
		return false
	}
	l.hits[principal] = append(kept, now)
	if len(l.hits) > 4096 {
		l.hits = make(map[string][]time.Time, 1024)
	}
	return true
}
