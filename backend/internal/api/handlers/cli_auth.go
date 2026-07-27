package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	cliauth "github.com/openpost/backend/internal/services/cli_auth"
	"github.com/openpost/backend/internal/services/ratelimit"
)

type CLIAuthHandler struct {
	auth          *cliauth.Service
	authenticator middleware.Authenticator
	limiter       *ratelimit.Limiter
	publicURL     string
}

func NewCLIAuthHandler(auth *cliauth.Service, authenticator middleware.Authenticator, publicURL string) *CLIAuthHandler {
	return &CLIAuthHandler{
		auth:          auth,
		authenticator: authenticator,
		limiter:       ratelimit.New(),
		publicURL:     strings.TrimRight(publicURL, "/"),
	}
}

type StartCLIAuthInput struct {
	Body struct {
		ClientName      string `json:"client_name" doc:"CLI client name"`
		ClientVersion   string `json:"client_version" doc:"CLI client version"`
		ClientOS        string `json:"client_os" doc:"CLI host operating system"`
		RequestedScopes string `json:"requested_scopes" doc:"Requested API token scopes"`
	}
}

type StartCLIAuthOutput struct {
	Body struct {
		DeviceCode      string `json:"device_code"`
		UserCode        string `json:"user_code"`
		VerificationURL string `json:"verification_url"`
		ExpiresIn       int    `json:"expires_in"`
		Interval        int    `json:"interval"`
	}
}

type PollCLIAuthInput struct {
	Body struct {
		DeviceCode string `json:"device_code"`
	}
}

type PollCLIAuthOutput struct {
	RetryAfter int `header:"Retry-After,omitempty"`
	Body       struct {
		Status     string `json:"status"`
		Token      string `json:"token,omitempty"`
		ExpiresIn  int    `json:"expires_in"`
		Interval   int    `json:"interval"`
		RetryAfter int    `json:"retry_after,omitempty"`
	}
}

type ApproveCLIAuthInput struct {
	Body struct {
		DeviceCode string `json:"device_code,omitempty"`
		UserCode   string `json:"user_code,omitempty"`
		Scopes     string `json:"scopes,omitempty"`
		Name       string `json:"name,omitempty"`
	}
}

type DenyCLIAuthInput struct {
	Body struct {
		DeviceCode string `json:"device_code,omitempty"`
		UserCode   string `json:"user_code,omitempty"`
	}
}

type CLIAuthDecisionOutput struct {
	Body struct {
		OK bool `json:"ok"`
	}
}

type GetCLIAuthSessionInput struct {
	UserCode string `query:"user_code"`
}

type GetCLIAuthSessionOutput struct {
	Body struct {
		ClientName      string `json:"client_name"`
		ClientVersion   string `json:"client_version"`
		ClientOS        string `json:"client_os"`
		RequestedScopes string `json:"requested_scopes"`
		ExpiresAt       string `json:"expires_at"`
	}
}

func (h *CLIAuthHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "start-cli-auth",
		Method:      http.MethodPost,
		Path:        "/cli/auth/start",
		Summary:     "Start CLI device authorization",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware()},
		Errors:      []int{400, 429},
	}, func(ctx context.Context, input *StartCLIAuthInput) (*StartCLIAuthOutput, error) {
		if !h.allow(ctx, "cli-auth:start", 20, time.Minute) {
			return nil, huma.Error429TooManyRequests("too many cli auth start attempts")
		}
		started, err := h.auth.StartSession(ctx, cliauth.StartInput{
			ClientName:      input.Body.ClientName,
			ClientVersion:   input.Body.ClientVersion,
			ClientOS:        input.Body.ClientOS,
			RequestedScopes: input.Body.RequestedScopes,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to start cli authorization")
		}
		out := &StartCLIAuthOutput{}
		out.Body.DeviceCode = started.DeviceCode
		out.Body.UserCode = started.UserCode
		out.Body.VerificationURL = h.verificationURL(started.UserCode)
		out.Body.ExpiresIn = started.ExpiresIn
		out.Body.Interval = started.Model.IntervalSeconds
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "poll-cli-auth",
		Method:      http.MethodPost,
		Path:        "/cli/auth/poll",
		Summary:     "Poll CLI device authorization",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware()},
		Errors:      []int{400, 404, 429},
	}, func(ctx context.Context, input *PollCLIAuthInput) (*PollCLIAuthOutput, error) {
		if !h.allow(ctx, "cli-auth:poll", 120, time.Minute) {
			return nil, huma.Error429TooManyRequests("too many cli auth poll attempts")
		}
		result, err := h.auth.PollSession(ctx, input.Body.DeviceCode)
		return pollOutput(result, err)
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-cli-auth-session",
		Method:      http.MethodGet,
		Path:        "/cli/auth/session",
		Summary:     "Get pending CLI authorization details",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{404},
	}, func(ctx context.Context, input *GetCLIAuthSessionInput) (*GetCLIAuthSessionOutput, error) {
		session, err := h.auth.GetPendingByUserCode(ctx, input.UserCode)
		if err != nil {
			return nil, cliAuthError(err)
		}
		out := &GetCLIAuthSessionOutput{}
		out.Body.ClientName = session.ClientName
		out.Body.ClientVersion = session.ClientVersion
		out.Body.ClientOS = session.ClientOS
		out.Body.RequestedScopes = session.RequestedScopes
		out.Body.ExpiresAt = session.ExpiresAt.UTC().Format(time.RFC3339)
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "approve-cli-auth",
		Method:      http.MethodPost,
		Path:        "/cli/auth/approve",
		Summary:     "Approve CLI device authorization",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{400, 404, 409},
	}, func(ctx context.Context, input *ApproveCLIAuthInput) (*CLIAuthDecisionOutput, error) {
		if err := h.auth.ApproveSession(ctx, middleware.GetUserID(ctx), decisionCode(input.Body.DeviceCode, input.Body.UserCode), input.Body.Scopes, input.Body.Name); err != nil {
			return nil, cliAuthError(err)
		}
		return decisionOutput(true), nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "deny-cli-auth",
		Method:      http.MethodPost,
		Path:        "/cli/auth/deny",
		Summary:     "Deny CLI device authorization",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator)},
		Errors:      []int{400, 404, 409},
	}, func(ctx context.Context, input *DenyCLIAuthInput) (*CLIAuthDecisionOutput, error) {
		if err := h.auth.DenySession(ctx, decisionCode(input.Body.DeviceCode, input.Body.UserCode)); err != nil {
			return nil, cliAuthError(err)
		}
		return decisionOutput(true), nil
	})
}

func (h *CLIAuthHandler) allow(ctx context.Context, action string, limit int, window time.Duration) bool {
	ip := middleware.GetClientIP(ctx)
	if ip == "" {
		ip = "unknown"
	}
	return h.limiter.Allow(action+":"+ip, limit, window)
}

func (h *CLIAuthHandler) verificationURL(userCode string) string {
	path := "/cli/authorize?user_code=" + userCode
	if h.publicURL == "" {
		return path
	}
	return h.publicURL + path
}

func pollOutput(result *cliauth.PollResult, err error) (*PollCLIAuthOutput, error) {
	if result == nil {
		return nil, cliAuthError(err)
	}
	out := &PollCLIAuthOutput{RetryAfter: result.RetryAfter}
	out.Body.Status = result.Status
	out.Body.Token = result.Token
	out.Body.ExpiresIn = result.ExpiresIn
	out.Body.Interval = result.Interval
	out.Body.RetryAfter = result.RetryAfter

	switch {
	case errors.Is(err, cliauth.ErrAuthorizationPending):
		out.Body.Status = "authorization_pending"
		return out, nil
	case errors.Is(err, cliauth.ErrDenied):
		out.Body.Status = "access_denied"
		return out, nil
	case errors.Is(err, cliauth.ErrExpired):
		out.Body.Status = "expired_token"
		return out, nil
	case errors.Is(err, cliauth.ErrSlowDown):
		out.Body.Status = "authorization_pending"
		return out, huma.Error429TooManyRequests("polling too quickly")
	case err != nil:
		return nil, cliAuthError(err)
	default:
		return out, nil
	}
}

func cliAuthError(err error) error {
	switch {
	case errors.Is(err, cliauth.ErrNotFound):
		return huma.Error404NotFound("cli auth session not found")
	case errors.Is(err, cliauth.ErrExpired):
		return huma.Error400BadRequest("expired_token")
	case errors.Is(err, cliauth.ErrDenied):
		return huma.Error400BadRequest("access_denied")
	case errors.Is(err, cliauth.ErrAlreadyUsed):
		return huma.Error409Conflict("cli auth session already completed")
	case err == nil:
		return nil
	default:
		return huma.Error500InternalServerError("cli auth request failed")
	}
}

func decisionCode(deviceCode, userCode string) string {
	if strings.TrimSpace(deviceCode) != "" {
		return deviceCode
	}
	return userCode
}

func decisionOutput(ok bool) *CLIAuthDecisionOutput {
	return &CLIAuthDecisionOutput{Body: struct {
		OK bool `json:"ok"`
	}{OK: ok}}
}
