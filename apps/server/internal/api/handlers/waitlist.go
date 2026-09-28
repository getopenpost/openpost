package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/waitlist"
)

type JoinWaitlistInput struct {
	Body struct {
		Email string `json:"email" minLength:"3" maxLength:"254" doc:"Email address to notify when Hosted registration opens"`
	}
}

type JoinWaitlistOutput struct {
	Body struct {
		Joined bool `json:"joined"`
	}
}

func (h *AuthHandler) SetWaitlist(service *waitlist.Service) {
	h.waitlist = service
}

func (h *AuthHandler) JoinWaitlist(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID:  "join-hosted-waitlist",
		Method:       http.MethodPost,
		Path:         "/auth/waitlist",
		Summary:      "Join the Hosted launch waitlist",
		Tags:         []string{tagAuth},
		MaxBodyBytes: 4096,
		Middlewares:  huma.Middlewares{middleware.RequestMetadataMiddleware()},
		Errors:       []int{400, 403, 429, 503},
	}, func(ctx context.Context, input *JoinWaitlistInput) (*JoinWaitlistOutput, error) {
		if h.waitlist == nil {
			return nil, huma.Error403Forbidden("the Hosted waitlist is closed")
		}
		if !h.allowAuthAttempt(clientIP(ctx), "waitlist:ip", 10, time.Hour) {
			return nil, huma.Error429TooManyRequests("too many waitlist attempts; try again later")
		}
		if err := h.waitlist.Join(ctx, input.Body.Email); err != nil {
			if errors.Is(err, waitlist.ErrInvalidEmail) {
				return nil, huma.Error400BadRequest(err.Error())
			}
			return nil, huma.Error503ServiceUnavailable("could not save your email; please try again")
		}
		out := &JoinWaitlistOutput{}
		out.Body.Joined = true
		return out, nil
	})
}
