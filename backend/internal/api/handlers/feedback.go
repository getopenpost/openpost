package handlers

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/feedback"
)

const feedbackRateLimit = 5
const maxFeedbackRequestBytes = 2 << 20

// FeedbackBodyLimitMiddleware bounds the only API request that may include an
// encoded image before Huma allocates or decodes the request body.
func FeedbackBodyLimitMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		request := c.Request()
		if request.Method != http.MethodPost || request.URL.Path != "/api/v1/feedback" {
			return next(c)
		}
		body, err := io.ReadAll(io.LimitReader(request.Body, maxFeedbackRequestBytes+1))
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "failed to read feedback report")
		}
		if len(body) > maxFeedbackRequestBytes {
			return echo.NewHTTPError(http.StatusRequestEntityTooLarge, "feedback report is too large")
		}
		request.Body = io.NopCloser(bytes.NewReader(body))
		return next(c)
	}
}

type FeedbackHandler struct {
	service *feedback.Service
	auth    middleware.Authenticator
}

func NewFeedbackHandler(
	service *feedback.Service,
	authenticator middleware.Authenticator,
) *FeedbackHandler {
	return &FeedbackHandler{
		service: service,
		auth:    authenticator,
	}
}

type FeedbackConfigOutput struct {
	Body feedback.PublicConfig
}

type SubmitFeedbackInput struct {
	Body struct {
		Category    string                `json:"category" enum:"bug,idea,question" doc:"Report category"`
		Message     string                `json:"message" minLength:"1" maxLength:"4000" doc:"User-written report"`
		Screenshot  *feedback.Screenshot  `json:"screenshot,omitempty" doc:"Optional user-approved PNG or JPEG screenshot"`
		Diagnostics *feedback.Diagnostics `json:"diagnostics,omitempty" doc:"Optional allowlisted diagnostics"`
	}
}

type SubmitFeedbackOutput struct {
	Body struct {
		Queued    bool   `json:"queued"`
		JobID     string `json:"job_id"`
		Recipient string `json:"recipient"`
	}
}

func (h *FeedbackHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-feedback-config",
		Method:      http.MethodGet,
		Path:        "/feedback/config",
		Summary:     "Get feedback privacy and destination settings",
		Tags:        []string{"Feedback"},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(_ context.Context, _ *struct{}) (*FeedbackConfigOutput, error) {
		config := h.service.PublicConfig()
		return &FeedbackConfigOutput{Body: config}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "submit-feedback",
		Method:      http.MethodPost,
		Path:        "/feedback",
		Summary:     "Queue a user-approved feedback report",
		Description: "Only the message and optional screenshot and diagnostics selected by the user are queued.",
		Tags:        []string{"Feedback"},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 413, 429, 503},
	}, func(ctx context.Context, input *SubmitFeedbackInput) (*SubmitFeedbackOutput, error) {
		userID := middleware.GetUserID(ctx)
		config := h.service.PublicConfig()
		if !config.Enabled {
			return nil, huma.Error503ServiceUnavailable("feedback delivery is not configured")
		}
		allowed, err := h.service.AllowSubmission(ctx, userID, feedbackRateLimit, time.Minute)
		if err != nil {
			return nil, huma.Error503ServiceUnavailable("feedback submission is temporarily unavailable")
		}
		if !allowed {
			return nil, huma.Error429TooManyRequests("feedback limit reached; wait a minute and try again")
		}
		jobID, err := h.service.Enqueue(ctx, feedback.Report{
			Category:    input.Body.Category,
			Message:     input.Body.Message,
			UserID:      userID,
			Diagnostics: input.Body.Diagnostics,
			Screenshot:  input.Body.Screenshot,
		})
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				return nil, huma.Error503ServiceUnavailable("feedback delivery is unavailable")
			}
			return nil, huma.Error400BadRequest(err.Error())
		}
		output := &SubmitFeedbackOutput{}
		output.Body.Queued = true
		output.Body.JobID = jobID
		output.Body.Recipient = config.Recipient
		return output, nil
	})
}
