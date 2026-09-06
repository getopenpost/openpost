package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/instancesettings"
	"github.com/openpost/backend/internal/services/updatestatus"
	"github.com/uptrace/bun"
)

type UpdateStatusHandler struct {
	db       *bun.DB
	auth     middleware.Authenticator
	service  *updatestatus.Service
	settings *instancesettings.Service
}

type UpdateStatusResponse struct {
	State               string `json:"state" doc:"Release comparison state" enum:"current,update_available,stale,unavailable,disabled,development"`
	RunningVersion      string `json:"running_version" doc:"Version embedded in the running server"`
	RunningBuild        string `json:"running_build" doc:"Source revision embedded in or detected from the running server"`
	LatestVersion       string `json:"latest_version,omitempty" doc:"Latest stable OpenPost release tag"`
	ReleaseURL          string `json:"release_url,omitempty" doc:"Validated GitHub release page"`
	PublishedAt         string `json:"published_at,omitempty" doc:"Latest release publication time"`
	CheckedAt           string `json:"checked_at,omitempty" doc:"Last bounded release-check attempt"`
	ConfiguredEnabled   bool   `json:"configured_enabled" doc:"Configured OPENPOST_UPDATE_CHECK_ENABLED value"`
	EffectiveEnabled    bool   `json:"effective_enabled" doc:"Whether release checks run in this process"`
	ConfigurationSource string `json:"configuration_source" doc:"Source of the configured value" enum:"default,environment,database"`
	RequiresRestart     bool   `json:"requires_restart" doc:"Whether the configured value differs from the running process"`
	DisabledReason      string `json:"disabled_reason,omitempty" doc:"Reason the configured value is not effective" enum:"managed_edition,configuration"`
}

type UpdateStatusOutput struct {
	Body UpdateStatusResponse
}

func NewUpdateStatusHandler(
	db *bun.DB,
	authenticator middleware.Authenticator,
	service *updatestatus.Service,
	settings *instancesettings.Service,
) *UpdateStatusHandler {
	return &UpdateStatusHandler{db: db, auth: authenticator, service: service, settings: settings}
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
	configuredEnabled := status.EffectiveEnabled
	configurationSource := "default"
	requiresRestart := false
	if h.settings != nil {
		states, err := h.settings.List(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load update-check configuration")
		}
		for _, state := range states {
			if state.Definition.Key != "OPENPOST_UPDATE_CHECK_ENABLED" {
				continue
			}
			configuredEnabled = strings.EqualFold(strings.TrimSpace(state.Value), "true")
			configurationSource = state.Source
			requiresRestart = state.RestartPending
			break
		}
	}
	return &UpdateStatusOutput{Body: UpdateStatusResponse{
		State:               status.State,
		RunningVersion:      status.RunningVersion,
		RunningBuild:        status.RunningBuild,
		LatestVersion:       status.LatestVersion,
		ReleaseURL:          status.ReleaseURL,
		PublishedAt:         formatUpdateStatusTime(status.PublishedAt),
		CheckedAt:           formatUpdateStatusTime(status.CheckedAt),
		ConfiguredEnabled:   configuredEnabled,
		EffectiveEnabled:    status.EffectiveEnabled,
		ConfigurationSource: configurationSource,
		RequiresRestart:     requiresRestart,
		DisabledReason:      status.DisabledReason,
	}}, nil
}

func (h *UpdateStatusHandler) requireInstanceAdmin(ctx context.Context) error {
	return requireBrowserSessionInstanceAdmin(ctx, h.db)
}

func formatUpdateStatusTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}
