package handlers

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/uptrace/bun"
)

type AppBootstrapInput struct {
	PreferredWorkspaceID string `query:"preferred_workspace_id" doc:"Workspace to select when it is accessible to the current credential"`
}

type AppBootstrapWorkspaceSettings struct {
	_                   struct{} `nullable:"true"`
	Name                string   `json:"name"`
	AvatarURL           string   `json:"avatar_url"`
	Color               string   `json:"color"`
	Timezone            string   `json:"timezone"`
	WeekStart           int      `json:"week_start"`
	MediaCleanupDays    int      `json:"media_cleanup_days" enum:"14" default:"14" deprecated:"true" doc:"Deprecated compatibility value. Always 14; temporary-media cleanup cannot be configured."`
	RandomDelayMinutes  int      `json:"random_delay_minutes"`
	SlotStartHour       int      `json:"slot_start_hour"`
	SlotEndHour         int      `json:"slot_end_hour"`
	SlotIntervalMinutes int      `json:"slot_interval_minutes"`
}

type AppBootstrapUserProfile struct {
	_ struct{} `nullable:"true"`
	UserProfile
}

type AppBootstrapOutput struct {
	Body struct {
		Authenticated             bool                           `json:"authenticated" doc:"Whether the request has a credential authorized for application bootstrap"`
		User                      *AppBootstrapUserProfile       `json:"user"`
		Workspaces                []WorkspaceResponse            `json:"workspaces" nullable:"false"`
		SelectedWorkspaceID       *string                        `json:"selected_workspace_id"`
		SelectedWorkspaceSettings *AppBootstrapWorkspaceSettings `json:"selected_workspace_settings"`
	}
}

type AppBootstrapHandler struct {
	db            *bun.DB
	auth          middleware.Authenticator
	accountPolicy AccountPolicy
	identity      *identity.Service
}

func NewAppBootstrapHandler(
	db *bun.DB,
	authenticator middleware.Authenticator,
	accountPolicy AccountPolicy,
	identityService *identity.Service,
) *AppBootstrapHandler {
	return &AppBootstrapHandler{
		db:            db,
		auth:          authenticator,
		accountPolicy: accountPolicy.normalized(),
		identity:      identityService,
	}
}

func (h *AppBootstrapHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-app-bootstrap",
		Method:      http.MethodGet,
		Path:        "/app/bootstrap",
		Summary:     "Get application bootstrap state",
		Description: "Returns an anonymous state when no credential authorized for application bootstrap is present.",
		Tags:        []string{tagAuth, tagWorkspaces},
		Middlewares: huma.Middlewares{middleware.OptionalAuthMiddleware(api, h.auth)},
		Errors:      []int{500, 503},
	}, h.handleBootstrap)
}

func (h *AppBootstrapHandler) handleBootstrap(
	ctx context.Context,
	input *AppBootstrapInput,
) (*AppBootstrapOutput, error) {
	out := &AppBootstrapOutput{}
	out.Body.Workspaces = []WorkspaceResponse{}
	userID := middleware.GetUserID(ctx)
	if userID == "" {
		return out, nil
	}

	reads := appReadModel{db: h.db, accountPolicy: h.accountPolicy, identity: h.identity}
	profile, err := reads.userProfile(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return out, nil
		}
		return nil, huma.Error500InternalServerError("failed to load session user")
	}
	workspaces, err := reads.workspaces(ctx, userID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to fetch workspaces")
	}

	out.Body.Authenticated = true
	out.Body.User = &AppBootstrapUserProfile{UserProfile: *profile}
	out.Body.Workspaces = workspaces
	selected := selectBootstrapWorkspace(workspaces, input.PreferredWorkspaceID)
	if selected == nil {
		return out, nil
	}
	out.Body.SelectedWorkspaceID = &selected.WorkspaceID
	if !selected.SSOAuthenticated {
		return out, nil
	}

	settings, allowed, err := reads.workspaceSettings(ctx, selected.WorkspaceID, userID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to fetch workspace settings")
	}
	if !allowed {
		return out, nil
	}
	out.Body.SelectedWorkspaceSettings = bootstrapWorkspaceSettings(settings)
	return out, nil
}

func selectBootstrapWorkspace(workspaces []WorkspaceResponse, preferredWorkspaceID string) *WorkspaceResponse {
	preferredWorkspaceID = strings.TrimSpace(preferredWorkspaceID)
	if preferredWorkspaceID != "" {
		for i := range workspaces {
			if workspaces[i].WorkspaceID == preferredWorkspaceID {
				return &workspaces[i]
			}
		}
	}
	if len(workspaces) == 0 {
		return nil
	}
	return &workspaces[0]
}

func bootstrapWorkspaceSettings(settings workspaceSettingsRead) *AppBootstrapWorkspaceSettings {
	return &AppBootstrapWorkspaceSettings{
		Name:                settings.Name,
		AvatarURL:           settings.AvatarURL,
		Color:               settings.Color,
		Timezone:            settings.Timezone,
		WeekStart:           settings.WeekStart,
		MediaCleanupDays:    settings.MediaCleanupDays,
		RandomDelayMinutes:  settings.RandomDelayMinutes,
		SlotStartHour:       settings.SlotStartHour,
		SlotEndHour:         settings.SlotEndHour,
		SlotIntervalMinutes: settings.SlotIntervalMinutes,
	}
}
