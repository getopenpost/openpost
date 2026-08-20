package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	growthservice "github.com/openpost/backend/internal/services/growth"
	"github.com/openpost/backend/internal/services/workspaceaccess"
)

const tagGrowth = "Growth"

type GrowthHandler struct {
	service *growthservice.Service
	auth    middleware.Authenticator
}

func NewGrowthHandler(service *growthservice.Service, auth middleware.Authenticator) *GrowthHandler {
	return &GrowthHandler{service: service, auth: auth}
}

func (h *GrowthHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-growth-recommendations",
		Method:      http.MethodGet,
		Path:        "/growth",
		Summary:     "List growth recommendations",
		Description: "Returns DB-only growth recommendations for one connected social account. Growth recommendations belong to one social_account_id, not merely a workspace.",
		Tags:        []string{tagGrowth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 500},
	}, h.list)

	huma.Register(api, huma.Operation{
		OperationID: "refresh-growth-recommendations",
		Method:      http.MethodPost,
		Path:        "/growth/refresh",
		Summary:     "Queue growth discovery refresh",
		Description: "Queues a durable discovery job for one social account. Uses provider reads with retry/requeue. Does not block on provider.",
		Tags:        []string{tagGrowth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 500},
	}, h.refresh)

	huma.Register(api, huma.Operation{
		OperationID: "dismiss-growth-recommendation",
		Method:      http.MethodPost,
		Path:        "/growth/{recommendation_id}/dismiss",
		Summary:     "Dismiss a growth recommendation",
		Description: "Locally dismisses a recommendation. Dismissed items never reappear after refresh.",
		Tags:        []string{tagGrowth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 500},
	}, h.dismiss)

	huma.Register(api, huma.Operation{
		OperationID: "follow-growth-recommendation",
		Method:      http.MethodPost,
		Path:        "/growth/{recommendation_id}/follow",
		Summary:     "Follow a recommended account",
		Description: "Queues a one-attempt provider write through the durable providerwrite fence. Never retries ambiguous writes.",
		Tags:        []string{tagGrowth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409, 500},
	}, h.follow)
}

type ListGrowthInput struct {
	WorkspaceID     string `query:"workspace_id" required:"true" doc:"Workspace ID"`
	SocialAccountID string `query:"account_id" required:"true" doc:"Connected social account ID"`
}

type ListGrowthOutput struct {
	Body growthservice.ListResult `json:"body"`
}

func (h *GrowthHandler) list(ctx context.Context, input *ListGrowthInput) (*ListGrowthOutput, error) {
	if h.service == nil {
		return nil, huma.Error500InternalServerError("growth service is unavailable")
	}
	actor := actorFromContext(ctx)
	result, err := h.service.List(ctx, actor, input.WorkspaceID, input.SocialAccountID)
	if err != nil {
		return nil, mapGrowthError(err)
	}
	return &ListGrowthOutput{Body: result}, nil
}

type RefreshGrowthInput struct {
	Body struct {
		WorkspaceID     string `json:"workspace_id" required:"true" doc:"Workspace ID"`
		SocialAccountID string `json:"account_id" required:"true" doc:"Connected social account ID"`
	}
}

type RefreshGrowthOutput struct {
	Body struct {
		JobID   string `json:"job_id" doc:"Queued job ID"`
		Status  string `json:"status" doc:"Queued status"`
		Message string `json:"message" doc:"Human readable message"`
	}
}

func (h *GrowthHandler) refresh(ctx context.Context, input *RefreshGrowthInput) (*RefreshGrowthOutput, error) {
	if h.service == nil {
		return nil, huma.Error500InternalServerError("growth service is unavailable")
	}
	actor := actorFromContext(ctx)
	jobID, err := h.service.QueueRefresh(ctx, actor, input.Body.WorkspaceID, input.Body.SocialAccountID)
	if err != nil {
		return nil, mapGrowthError(err)
	}
	out := &RefreshGrowthOutput{}
	out.Body.JobID = jobID
	out.Body.Status = "queued"
	out.Body.Message = "Growth refresh queued."
	return out, nil
}

type DismissGrowthInput struct {
	RecommendationID string `path:"recommendation_id" doc:"Growth recommendation ID"`
	Body             struct {
		WorkspaceID string `json:"workspace_id" required:"true" doc:"Workspace ID"`
	}
}

type DismissGrowthOutput struct {
	Body struct {
		Status string `json:"status" doc:"Dismiss status"`
	}
}

func (h *GrowthHandler) dismiss(ctx context.Context, input *DismissGrowthInput) (*DismissGrowthOutput, error) {
	if h.service == nil {
		return nil, huma.Error500InternalServerError("growth service is unavailable")
	}
	actor := actorFromContext(ctx)
	if err := h.service.Dismiss(ctx, actor, input.Body.WorkspaceID, input.RecommendationID); err != nil {
		return nil, mapGrowthError(err)
	}
	out := &DismissGrowthOutput{}
	out.Body.Status = "dismissed"
	return out, nil
}

type FollowGrowthInput struct {
	RecommendationID string `path:"recommendation_id" doc:"Growth recommendation ID"`
	Body             struct {
		WorkspaceID string `json:"workspace_id" required:"true" doc:"Workspace ID"`
	}
}

type FollowGrowthOutput struct {
	Body struct {
		JobID   string `json:"job_id" doc:"Queued job ID"`
		Status  string `json:"status" doc:"Pending follow status"`
		Message string `json:"message" doc:"Human readable message"`
	}
}

func (h *GrowthHandler) follow(ctx context.Context, input *FollowGrowthInput) (*FollowGrowthOutput, error) {
	if h.service == nil {
		return nil, huma.Error500InternalServerError("growth service is unavailable")
	}
	actor := actorFromContext(ctx)
	jobID, err := h.service.QueueFollow(ctx, actor, input.Body.WorkspaceID, input.RecommendationID)
	if err != nil {
		return nil, mapGrowthError(err)
	}
	out := &FollowGrowthOutput{}
	out.Body.JobID = jobID
	out.Body.Status = "pending"
	out.Body.Message = "Follow queued."
	return out, nil
}

func actorFromContext(ctx context.Context) workspaceaccess.ActorFacts {
	return workspaceaccess.ActorFacts{
		UserID:                middleware.GetUserID(ctx),
		SessionID:             middleware.GetSessionID(ctx),
		TokenID:               middleware.GetTokenID(ctx),
		ClientID:              middleware.GetClientID(ctx),
		CredentialWorkspaceID: middleware.GetWorkspaceID(ctx),
	}
}

func mapGrowthError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, growthservice.ErrAccessDenied):
		return huma.Error403Forbidden("workspace access denied")
	case errors.Is(err, growthservice.ErrNotFound):
		return huma.Error404NotFound("not found")
	case errors.Is(err, growthservice.ErrInvalid):
		return huma.Error400BadRequest(err.Error())
	case errors.Is(err, growthservice.ErrConflict):
		return huma.Error409Conflict(err.Error())
	case errors.Is(err, growthservice.ErrUnsupported):
		return huma.Error400BadRequest("growth is not supported for this account")
	case errors.Is(err, growthservice.ErrAccountNotActive):
		return huma.Error400BadRequest("social account is not active")
	default:
		// Do not leak provider payloads
		return huma.Error500InternalServerError("growth operation failed")
	}
}
