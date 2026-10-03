package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/ratelimit"
	"github.com/openpost/backend/internal/services/repurpose"
)

type RepurposeHandler struct {
	service *repurpose.Service
	auth    middleware.Authenticator
	limiter *ratelimit.Limiter
}

func NewRepurposeHandler(service *repurpose.Service, auth middleware.Authenticator) *RepurposeHandler {
	return &RepurposeHandler{service: service, auth: auth, limiter: ratelimit.New()}
}

type CreateRepurposeSuggestionsInput struct {
	IdempotencyKey string `header:"Idempotency-Key" required:"true" minLength:"8" maxLength:"160"`
	Body           repurpose.SuggestionRequest
}
type RepurposeSuggestionsPath struct {
	ID string `path:"id" maxLength:"200"`
}
type RepurposeSuggestionsRevisionInput struct {
	ID   string `path:"id" maxLength:"200"`
	Body struct {
		Revision int `json:"revision" minimum:"1"`
	}
}
type RepurposeSuggestionsOutput struct{ Body repurpose.ClipSuggestions }

func (h *RepurposeHandler) RegisterRoutes(api huma.API) {
	operation := func(id, method, path, summary string) huma.Operation {
		return huma.Operation{OperationID: id, Method: method, Path: path, Summary: summary, Tags: []string{"Repurpose"}, MaxBodyBytes: 2 * 1024 * 1024, Errors: []int{400, 403, 404, 409, 429, 503}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}}
	}
	huma.Register(api, operation("create-repurpose-suggestions", http.MethodPost, "/repurpose-suggestions", "Suggest up to three source-grounded clips for review"), h.create)
	huma.Register(api, operation("get-repurpose-suggestions", http.MethodGet, "/repurpose-suggestions/{id}", "Read clip suggestion progress and candidates"), h.get)
	huma.Register(api, operation("cancel-repurpose-suggestions", http.MethodPost, "/repurpose-suggestions/{id}/cancel", "Cancel the current clip suggestion revision"), h.cancel)
	huma.Register(api, operation("retry-repurpose-suggestions", http.MethodPost, "/repurpose-suggestions/{id}/retry", "Retry a failed or cancelled clip suggestion revision"), h.retry)
}

func (h *RepurposeHandler) create(ctx context.Context, input *CreateRepurposeSuggestionsInput) (*RepurposeSuggestionsOutput, error) {
	if h.service == nil {
		return nil, repurposeHTTPError(repurpose.ErrUnavailable)
	}
	userID := middleware.GetUserID(ctx)
	if !h.limiter.Allow("repurpose:"+userID, 12, time.Minute) {
		return nil, repurposeHTTPError(repurpose.ErrCapacity)
	}
	result, err := h.service.Create(ctx, workspaceActor(ctx, userID), input.IdempotencyKey, input.Body)
	return &RepurposeSuggestionsOutput{Body: result}, repurposeHTTPError(err)
}
func (h *RepurposeHandler) get(ctx context.Context, input *RepurposeSuggestionsPath) (*RepurposeSuggestionsOutput, error) {
	if h.service == nil {
		return nil, repurposeHTTPError(repurpose.ErrUnavailable)
	}
	result, err := h.service.Get(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), input.ID)
	return &RepurposeSuggestionsOutput{Body: result}, repurposeHTTPError(err)
}
func (h *RepurposeHandler) cancel(ctx context.Context, input *RepurposeSuggestionsRevisionInput) (*RepurposeSuggestionsOutput, error) {
	if h.service == nil {
		return nil, repurposeHTTPError(repurpose.ErrUnavailable)
	}
	result, err := h.service.Cancel(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), input.ID, input.Body.Revision)
	return &RepurposeSuggestionsOutput{Body: result}, repurposeHTTPError(err)
}
func (h *RepurposeHandler) retry(ctx context.Context, input *RepurposeSuggestionsRevisionInput) (*RepurposeSuggestionsOutput, error) {
	if h.service == nil {
		return nil, repurposeHTTPError(repurpose.ErrUnavailable)
	}
	userID := middleware.GetUserID(ctx)
	if !h.limiter.Allow("repurpose:"+userID, 12, time.Minute) {
		return nil, repurposeHTTPError(repurpose.ErrCapacity)
	}
	result, err := h.service.Retry(ctx, workspaceActor(ctx, userID), input.ID, input.Body.Revision)
	return &RepurposeSuggestionsOutput{Body: result}, repurposeHTTPError(err)
}
func repurposeHTTPError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, repurpose.ErrInvalid):
		return huma.Error400BadRequest("The transcript, source identity or clip preferences are not valid")
	case errors.Is(err, repurpose.ErrAccess):
		return huma.Error403Forbidden("The workspace or source is not available for this action")
	case errors.Is(err, repurpose.ErrNotFound):
		return huma.Error404NotFound("Clip suggestions not found")
	case errors.Is(err, repurpose.ErrConflict):
		return huma.Error409Conflict("This review changed. Refresh before trying again")
	case errors.Is(err, repurpose.ErrCapacity):
		return huma.Error429TooManyRequests("Clip analysis is busy. Wait for an active request to finish")
	case errors.Is(err, repurpose.ErrUnavailable):
		return huma.Error503ServiceUnavailable("AI clip suggestions are not configured")
	default:
		return huma.Error503ServiceUnavailable("Clip suggestions could not be loaded. Try again")
	}
}
