package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	analyticsservice "github.com/openpost/backend/internal/services/analytics"
	"github.com/uptrace/bun"
)

type AnalyticsFeatureGate interface {
	IsEffectiveEnabled(ctx context.Context, accountID, feature string) (bool, error)
}

type AnalyticsHandler struct {
	db          *bun.DB
	auth        middleware.Authenticator
	service     *analyticsservice.Service
	featureGate AnalyticsFeatureGate
}

func NewAnalyticsHandler(db *bun.DB, auth middleware.Authenticator, service *analyticsservice.Service) *AnalyticsHandler {
	return &AnalyticsHandler{db: db, auth: auth, service: service}
}

func (h *AnalyticsHandler) SetFeatureGate(g AnalyticsFeatureGate) {
	h.featureGate = g
}

type GetAnalyticsOverviewInput struct {
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID"`
	Days        int    `query:"days" default:"30" doc:"Reporting window in days (7, 30, or 90)"`
	AccountID   string `query:"account_id" doc:"Optional social account ID used to filter results and content totals"`
	Source      string `query:"source" default:"all" enum:"all,openpost,external" doc:"Content source filter; account growth remains account-wide"`
	Sort        string `query:"sort" default:"engagement" enum:"engagement,views,newest" doc:"Stored result ordering"`
	Cursor      string `query:"cursor" doc:"Opaque source-bound content cursor"`
	Limit       int    `query:"limit" default:"50" minimum:"1" maximum:"100" doc:"Content results per page"`
}

type GetAnalyticsOverviewOutput struct {
	Body analyticsservice.Overview
}

type RefreshAnalyticsInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" required:"true" doc:"Workspace ID"`
	}
}

type RefreshAnalyticsOutput struct {
	Body struct {
		Queued  int    `json:"queued"`
		Message string `json:"message"`
	}
}

type RepurposeAnalyticsInput struct {
	Body struct {
		WorkspaceID string                            `json:"workspace_id" required:"true" doc:"Workspace ID"`
		Reference   analyticsservice.ContentReference `json:"reference" doc:"Opaque discriminated analytics content reference"`
		Range       analyticsservice.RepurposeRange   `json:"range" doc:"Reporting range used to recompute private evidence"`
	}
}

type RepurposeAnalyticsOutput struct {
	Body analyticsservice.RepurposeSource
}

func (h *AnalyticsHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-analytics-overview",
		Method:      http.MethodGet,
		Path:        "/analytics",
		Summary:     "Get stored whole-account content analytics",
		Tags:        []string{tagAnalytics},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 500},
	}, func(ctx context.Context, input *GetAnalyticsOverviewInput) (*GetAnalyticsOverviewOutput, error) {
		if err := h.requireWorkspaceAccess(ctx, input.WorkspaceID, false); err != nil {
			return nil, err
		}
		if input.Days != 7 && input.Days != 30 && input.Days != 90 {
			return nil, huma.Error400BadRequest("days must be 7, 30, or 90")
		}
		overview, err := h.service.OverviewWithOptions(ctx, input.WorkspaceID, input.Days, analyticsservice.OverviewOptions{
			AccountID: input.AccountID,
			Source:    input.Source,
			Sort:      input.Sort,
			Cursor:    input.Cursor,
			Limit:     input.Limit,
		})
		if errors.Is(err, analyticsservice.ErrInvalidOverviewCursor) {
			return nil, huma.Error400BadRequest("invalid analytics cursor")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load analytics")
		}
		return &GetAnalyticsOverviewOutput{Body: overview}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "prepare-analytics-repurpose",
		Method:      http.MethodPost,
		Path:        "/analytics/repurpose",
		Summary:     "Prepare a fresh local repurpose handoff",
		Description: "Resolves bounded stored source fields and private evidence without creating or changing a Publication, Rendition, provider item, or AI build.",
		Tags:        []string{tagAnalytics},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 410, 422, 500},
	}, func(ctx context.Context, input *RepurposeAnalyticsInput) (*RepurposeAnalyticsOutput, error) {
		if err := h.requireWorkspaceAccess(ctx, input.Body.WorkspaceID, true); err != nil {
			return nil, err
		}
		handoff, err := h.service.ResolveRepurposeSource(ctx, input.Body.WorkspaceID, input.Body.Reference, input.Body.Range)
		switch {
		case errors.Is(err, analyticsservice.ErrInvalidRepurposeReference):
			return nil, huma.Error400BadRequest("invalid repurpose source")
		case errors.Is(err, analyticsservice.ErrRepurposeSourceNotFound):
			return nil, huma.Error404NotFound("repurpose source not found")
		case errors.Is(err, analyticsservice.ErrRepurposeSourceUnavailable):
			return nil, huma.NewError(http.StatusGone, "This source is no longer available to repurpose.")
		case errors.Is(err, analyticsservice.ErrRepurposeSourceUnsupported):
			return nil, huma.NewError(http.StatusUnprocessableEntity, "This content format cannot be repurposed.")
		case err != nil:
			return nil, huma.Error500InternalServerError("failed to prepare repurpose source")
		}
		return &RepurposeAnalyticsOutput{Body: handoff}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "refresh-analytics",
		Method:      http.MethodPost,
		Path:        "/analytics/refresh",
		Summary:     "Queue analytics collection for a workspace",
		Tags:        []string{tagAnalytics},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 500},
	}, func(ctx context.Context, input *RefreshAnalyticsInput) (*RefreshAnalyticsOutput, error) {
		if err := h.requireWorkspaceAccess(ctx, input.Body.WorkspaceID, true); err != nil {
			return nil, err
		}
		queued, err := h.service.RefreshWorkspace(ctx, input.Body.WorkspaceID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to queue analytics refresh")
		}
		output := &RefreshAnalyticsOutput{}
		output.Body.Queued = queued
		output.Body.Message = "Analytics refresh queued."
		return output, nil
	})
}

func (h *AnalyticsHandler) requireWorkspaceAccess(ctx context.Context, workspaceID string, edit bool) error {
	if h.db == nil || h.service == nil {
		return huma.Error500InternalServerError("analytics service is unavailable")
	}
	var (
		ok  bool
		err error
	)
	if edit {
		ok, err = workspaceEditAllowed(ctx, h.db, workspaceID, middleware.GetUserID(ctx))
	} else {
		ok, err = workspaceReadAllowed(ctx, h.db, workspaceID, middleware.GetUserID(ctx))
	}
	if err != nil {
		return huma.Error500InternalServerError("failed to verify workspace access")
	}
	if !ok {
		return huma.Error403Forbidden("workspace access denied")
	}
	return nil
}
