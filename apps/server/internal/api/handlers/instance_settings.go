package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/instancesettings"
	"github.com/uptrace/bun"
)

type InstanceSettingsHandler struct {
	service *instancesettings.Service
	db      *bun.DB
	auth    middleware.Authenticator
}

type InstanceSettingOptionResponse struct {
	Value string `json:"value" doc:"Stored option value"`
	Label string `json:"label" doc:"Human-readable option label"`
}

type InstanceSettingResponse struct {
	Key                  string                          `json:"key" doc:"Canonical environment variable name"`
	Group                string                          `json:"group" doc:"Configuration group"`
	Label                string                          `json:"label" doc:"Human-readable setting name"`
	Description          string                          `json:"description" doc:"Setting purpose and effect"`
	Type                 string                          `json:"type" enum:"boolean,integer,string,secret,url,email,enum,list" doc:"Input type"`
	Secret               bool                            `json:"secret" doc:"Whether the value is sensitive and always redacted"`
	Optional             bool                            `json:"optional" doc:"Whether an empty value is valid"`
	EnvironmentVariables []string                        `json:"environment_variables" doc:"Supported direct environment variable names"`
	Options              []InstanceSettingOptionResponse `json:"options,omitempty" doc:"Allowed values for enum settings"`
	Value                string                          `json:"value,omitempty" doc:"Desired non-secret value. Secret values are never returned."`
	Source               string                          `json:"source" enum:"environment,database,default" doc:"Layer that supplies the desired value after administrator overrides are applied"`
	ManagedBy            string                          `json:"managed_by,omitempty" doc:"Direct or file-backed environment variable that supplies a configured value or fallback"`
	Configured           bool                            `json:"configured" doc:"Whether the desired value is non-empty"`
	SecretConfigured     bool                            `json:"secret_configured" doc:"Whether a redacted secret value is configured"`
	DatabaseOverride     bool                            `json:"database_override_configured" doc:"Whether an encrypted administrator override exists"`
	Editable             bool                            `json:"editable" doc:"Whether the administrator can save an encrypted database override"`
	RequiresRestart      bool                            `json:"requires_restart" doc:"Whether the saved value differs from the running process"`
	UpdatedAt            string                          `json:"updated_at,omitempty" doc:"Last database update time"`
}

type InstanceSettingsResponse struct {
	Settings        []InstanceSettingResponse `json:"settings"`
	RequiresRestart bool                      `json:"requires_restart" doc:"Whether any saved setting needs a server restart"`
}

type ListInstanceSettingsOutput struct {
	Body InstanceSettingsResponse
}

type InstanceSettingUpdateInput struct {
	Key   string  `json:"key" doc:"Canonical setting key"`
	Value *string `json:"value,omitempty" doc:"Replacement value. Secret values are write-only."`
	Unset bool    `json:"unset,omitempty" doc:"Remove the database override and fall back to the environment or default"`
}

type SaveInstanceSettingsInput struct {
	Body struct {
		Settings []InstanceSettingUpdateInput `json:"settings" minItems:"1" doc:"Settings to update atomically"`
	}
}

type SaveInstanceSettingsOutput struct {
	Body InstanceSettingsResponse
}

func NewInstanceSettingsHandler(service *instancesettings.Service, db *bun.DB, authenticator middleware.Authenticator) *InstanceSettingsHandler {
	return &InstanceSettingsHandler{service: service, db: db, auth: authenticator}
}

func (h *InstanceSettingsHandler) RegisterRoutes(api huma.API) {
	authMiddleware := middleware.AuthMiddleware(api, h.auth)
	huma.Register(api, huma.Operation{
		OperationID: "list-instance-settings",
		Method:      http.MethodGet,
		Path:        "/admin/instance-settings",
		Summary:     "List administrator-managed instance settings",
		Description: "Returns the typed optional configuration registry. Secrets are redacted. Administrator overrides take precedence over environment values after restart, while the configured environment source remains visible as the fallback.",
		Tags:        []string{"Admin"},
		Middlewares: huma.Middlewares{authMiddleware},
	}, h.list)
	huma.Register(api, huma.Operation{
		OperationID: "save-instance-settings",
		Method:      http.MethodPut,
		Path:        "/admin/instance-settings",
		Summary:     "Save administrator-managed instance settings",
		Description: "Validates and encrypts optional instance settings atomically. Changes apply after the server restarts.",
		Tags:        []string{"Admin"},
		Middlewares: huma.Middlewares{authMiddleware},
	}, h.save)
}

func (h *InstanceSettingsHandler) list(ctx context.Context, _ *struct{}) (*ListInstanceSettingsOutput, error) {
	if err := h.requireInstanceAdmin(ctx); err != nil {
		return nil, err
	}
	states, err := h.service.List(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to list instance settings")
	}
	return &ListInstanceSettingsOutput{Body: instanceSettingsResponse(states)}, nil
}

func (h *InstanceSettingsHandler) save(ctx context.Context, input *SaveInstanceSettingsInput) (*SaveInstanceSettingsOutput, error) {
	if err := h.requireInstanceAdmin(ctx); err != nil {
		return nil, err
	}
	updates := make([]instancesettings.Update, 0, len(input.Body.Settings))
	for _, update := range input.Body.Settings {
		updates = append(updates, instancesettings.Update{Key: update.Key, Value: update.Value, Unset: update.Unset})
	}
	if _, err := h.service.Save(ctx, middleware.GetUserID(ctx), updates); err != nil {
		var validationErr instancesettings.ValidationError
		switch {
		case errors.As(err, &validationErr):
			return nil, huma.Error400BadRequest(validationErr.Error())
		default:
			return nil, huma.Error500InternalServerError("failed to save instance settings")
		}
	}
	states, err := h.service.List(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("settings were saved but could not be reloaded")
	}
	return &SaveInstanceSettingsOutput{Body: instanceSettingsResponse(states)}, nil
}

func (h *InstanceSettingsHandler) requireInstanceAdmin(ctx context.Context) error {
	return requireBrowserSessionInstanceAdmin(ctx, h.db)
}

func instanceSettingsResponse(states []instancesettings.State) InstanceSettingsResponse {
	response := InstanceSettingsResponse{Settings: make([]InstanceSettingResponse, 0, len(states))}
	for _, state := range states {
		options := make([]InstanceSettingOptionResponse, 0, len(state.Definition.Options))
		for _, option := range state.Definition.Options {
			options = append(options, InstanceSettingOptionResponse{Value: option.Value, Label: option.Label})
		}
		item := InstanceSettingResponse{
			Key:                  state.Definition.Key,
			Group:                state.Definition.Group,
			Label:                state.Definition.Label,
			Description:          state.Definition.Description,
			Type:                 string(state.Definition.Kind),
			Secret:               state.Definition.Secret,
			Optional:             state.Definition.Optional,
			EnvironmentVariables: state.Definition.EnvVars,
			Options:              options,
			Value:                state.Value,
			Source:               state.Source,
			ManagedBy:            state.EnvironmentSource,
			Configured:           state.Configured,
			SecretConfigured:     state.SecretConfigured,
			DatabaseOverride:     state.DatabaseOverride,
			Editable:             true,
			RequiresRestart:      state.RestartPending,
		}
		if !state.UpdatedAt.IsZero() {
			item.UpdatedAt = state.UpdatedAt.Format(time.RFC3339)
		}
		if item.RequiresRestart {
			response.RequiresRestart = true
		}
		response.Settings = append(response.Settings, item)
	}
	return response
}
