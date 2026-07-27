package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/updatestatus"
	"github.com/uptrace/bun"
)

type UpdateStatusHandler struct {
	db      *bun.DB
	auth    middleware.Authenticator
	service *updatestatus.Service
}

type UpdateStatusResponse struct {
	State          string `json:"state" doc:"Release comparison state" enum:"current,update_available,stale,unavailable,disabled,development"`
	RunningVersion string `json:"running_version" doc:"Version embedded in the running server"`
	RunningBuild   string `json:"running_build" doc:"Source revision embedded in or detected from the running server"`
	LatestVersion  string `json:"latest_version,omitempty" doc:"Latest stable OpenPost release tag"`
	ReleaseURL     string `json:"release_url,omitempty" doc:"Validated GitHub release page"`
	PublishedAt    string `json:"published_at,omitempty" doc:"Latest release publication time"`
	CheckedAt      string `json:"checked_at,omitempty" doc:"Last bounded release-check attempt"`
}

type UpdateStatusOutput struct {
	Body UpdateStatusResponse
}

func NewUpdateStatusHandler(
	db *bun.DB,
	authenticator middleware.Authenticator,
	service *updatestatus.Service,
) *UpdateStatusHandler {
	return &UpdateStatusHandler{db: db, auth: authenticator, service: service}
}

func (h *UpdateStatusHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-instance-update-status",
		Method:      http.MethodGet,
		Path:        "/admin/update-status",
		Summary:     "Get instance update status",
		Description: "Returns a cached, read-only stable release comparison. This endpoint never installs updates.",
		Tags:        []string{"Admin"},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{401, 403, 503},
	}, h.getStatus)
}

func (h *UpdateStatusHandler) getStatus(ctx context.Context, _ *struct{}) (*UpdateStatusOutput, error) {
	if err := h.requireInstanceAdmin(ctx); err != nil {
		return nil, err
	}
	if h.service == nil {
		return nil, huma.Error503ServiceUnavailable("update status is not configured")
	}

	status := h.service.Check(ctx)
	return &UpdateStatusOutput{Body: UpdateStatusResponse{
		State:          status.State,
		RunningVersion: status.RunningVersion,
		RunningBuild:   status.RunningBuild,
		LatestVersion:  status.LatestVersion,
		ReleaseURL:     status.ReleaseURL,
		PublishedAt:    formatUpdateStatusTime(status.PublishedAt),
		CheckedAt:      formatUpdateStatusTime(status.CheckedAt),
	}}, nil
}

func (h *UpdateStatusHandler) requireInstanceAdmin(ctx context.Context) error {
	userID := middleware.GetUserID(ctx)
	if userID == "" {
		return huma.Error401Unauthorized("unauthorized")
	}
	if middleware.GetWorkspaceID(ctx) != "" {
		return huma.Error403Forbidden("instance admin API requires unscoped credentials")
	}

	var user models.User
	if err := h.db.NewSelect().Model(&user).Column("is_admin").Where("id = ?", userID).Scan(ctx); err != nil {
		return huma.Error500InternalServerError("failed to load user")
	}
	if !user.IsAdmin {
		return huma.Error403Forbidden("instance admin role required")
	}
	return nil
}

func formatUpdateStatusTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}
