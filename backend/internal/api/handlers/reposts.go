package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	repostservice "github.com/openpost/backend/internal/services/reposts"
	"github.com/uptrace/bun"
)

type RepostHandler struct {
	service *repostservice.Service
	db      *bun.DB
	auth    middleware.Authenticator
}

func NewRepostHandler(db *bun.DB, service *repostservice.Service, auth middleware.Authenticator) *RepostHandler {
	return &RepostHandler{db: db, service: service, auth: auth}
}

type GetRepostSettingsInput struct {
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID"`
}

type SaveRepostSettingsInput struct {
	Body struct {
		WorkspaceID string                      `json:"workspace_id" doc:"Workspace ID"`
		Policies    []repostservice.PolicyInput `json:"policies" doc:"Complete replacement set of workspace repost rules"`
	}
}

type RevokeRepostGrantInput struct {
	GrantID     string `path:"grant_id" doc:"Grant ID"`
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace requesting revocation"`
}

type RepostSettingsOutput struct {
	Body repostservice.SettingsResponse
}

type RepostGrantOutput struct {
	Body struct {
		Message string `json:"message"`
	}
}

func (h *RepostHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-repost-automation",
		Method:      http.MethodGet,
		Path:        "/repost-automation",
		Summary:     "Get workspace repost rules and available accounts",
		Tags:        []string{tagReposts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403},
	}, func(ctx context.Context, input *GetRepostSettingsInput) (*RepostSettingsOutput, error) {
		userID := middleware.GetUserID(ctx)
		if err := h.checkWorkspaceAccess(ctx, input.WorkspaceID, userID); err != nil {
			return nil, err
		}
		settings, err := h.service.Settings(ctx, input.WorkspaceID, userID, repostRequestCredential(ctx))
		if err != nil {
			return nil, repostHTTPError(err)
		}
		return &RepostSettingsOutput{Body: settings}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "save-repost-automation",
		Method:      http.MethodPut,
		Path:        "/repost-automation",
		Summary:     "Replace workspace repost rules",
		Tags:        []string{tagReposts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *SaveRepostSettingsInput) (*RepostSettingsOutput, error) {
		userID := middleware.GetUserID(ctx)
		if err := h.checkWorkspaceAdminAccess(ctx, input.Body.WorkspaceID, userID); err != nil {
			return nil, err
		}
		settings, err := h.service.ReplacePolicies(
			ctx,
			input.Body.WorkspaceID,
			userID,
			input.Body.Policies,
			repostRequestCredential(ctx),
		)
		if err != nil {
			return nil, repostHTTPError(err)
		}
		return &RepostSettingsOutput{Body: settings}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "revoke-repost-account-grant",
		Method:      http.MethodDelete,
		Path:        "/repost-account-grants/{grant_id}",
		Summary:     "Revoke a cross-workspace repost account grant",
		Tags:        []string{tagReposts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *RevokeRepostGrantInput) (*RepostGrantOutput, error) {
		userID := middleware.GetUserID(ctx)
		if err := h.checkWorkspaceAdminAccess(ctx, input.WorkspaceID, userID); err != nil {
			return nil, err
		}
		if err := h.service.RevokeGrant(ctx, input.GrantID, input.WorkspaceID, userID); err != nil {
			return nil, repostHTTPError(err)
		}
		output := &RepostGrantOutput{}
		output.Body.Message = "Repost account grant revoked"
		return output, nil
	})
}

func repostRequestCredential(ctx context.Context) repostservice.RequestCredential {
	return repostservice.RequestCredential{
		SessionID:   middleware.GetSessionID(ctx),
		TokenID:     middleware.GetTokenID(ctx),
		WorkspaceID: middleware.GetWorkspaceID(ctx),
	}
}

func (h *RepostHandler) checkWorkspaceAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := middleware.CheckWorkspaceAccess(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	return nil
}

func (h *RepostHandler) checkWorkspaceAdminAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := middleware.CheckWorkspaceAdminAccess(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden("workspace admin role required")
	}
	return nil
}

func repostHTTPError(err error) error {
	switch {
	case errors.Is(err, repostservice.ErrWorkspaceAdmin), errors.Is(err, repostservice.ErrWorkspaceAccess):
		return huma.Error403Forbidden(err.Error())
	case errors.Is(err, repostservice.ErrGrantNotFound):
		return huma.Error404NotFound(err.Error())
	case errors.Is(err, repostservice.ErrInvalidInput):
		return huma.Error400BadRequest(err.Error())
	default:
		return huma.Error500InternalServerError("Repost automation could not complete the request")
	}
}
