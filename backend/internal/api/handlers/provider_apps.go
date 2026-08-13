package handlers

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerapps"
	"github.com/uptrace/bun"
)

type ProviderAppHandler struct {
	service         *providerapps.Service
	db              *bun.DB
	auth            middleware.Authenticator
	environmentApps map[string]platform.AppConfig
	frontendURL     string
}

type ProviderAppResponse struct {
	ID               string `json:"id" doc:"Provider app ID"`
	Provider         string `json:"provider" doc:"Provider key"`
	Name             string `json:"name,omitempty" doc:"Optional provider app display name"`
	ClientID         string `json:"client_id" doc:"OAuth client ID"`
	RedirectURI      string `json:"redirect_uri,omitempty" doc:"OAuth redirect URI"`
	InstanceURL      string `json:"instance_url,omitempty" doc:"Federated provider instance URL"`
	IsActive         bool   `json:"is_active" doc:"Whether this app is active"`
	SecretConfigured bool   `json:"secret_configured" doc:"Whether an encrypted client secret is stored"`
	CreatedAt        string `json:"created_at" doc:"Creation time"`
	UpdatedAt        string `json:"updated_at" doc:"Last update time"`
	Source           string `json:"source" enum:"environment,database" doc:"Configuration source"`
	Editable         bool   `json:"editable" doc:"Whether the row can be changed through the admin API"`
	Deletable        bool   `json:"deletable" doc:"Whether the database row can be deleted through the admin API"`
	Shadowed         bool   `json:"shadowed_by_environment" doc:"Whether an environment app currently takes precedence over this database row"`
}

type ListProviderAppsOutput struct {
	Body []ProviderAppResponse
}

type SaveProviderAppInput struct {
	Body struct {
		Provider     string  `json:"provider" doc:"Provider key"`
		Name         string  `json:"name,omitempty" doc:"Optional provider app display name"`
		ClientID     string  `json:"client_id" doc:"OAuth client ID"`
		ClientSecret *string `json:"client_secret,omitempty" doc:"OAuth client secret. Omit to preserve the existing secret when updating."`
		RedirectURI  string  `json:"redirect_uri,omitempty" doc:"OAuth redirect URI"`
		InstanceURL  string  `json:"instance_url,omitempty" doc:"Federated provider instance URL"`
		IsActive     *bool   `json:"is_active,omitempty" doc:"Whether this app should be active. Defaults to true."`
	}
}

type SaveProviderAppResponse struct {
	App             ProviderAppResponse `json:"app"`
	Existed         bool                `json:"existed" doc:"Whether an existing provider app row was updated"`
	RequiresRestart bool                `json:"requires_restart" doc:"Whether the server must restart before adapter changes apply"`
}

type SaveProviderAppOutput struct {
	Body SaveProviderAppResponse
}

type DeleteProviderAppInput struct {
	ID string `path:"id" doc:"Provider app ID"`
}

type DeleteProviderAppResponse struct {
	RequiresRestart bool `json:"requires_restart" doc:"Whether the server must restart before adapter changes apply"`
}

type DeleteProviderAppOutput struct {
	Body DeleteProviderAppResponse
}

type ProviderAppHandlerOption func(*ProviderAppHandler)

func WithEnvironmentProviderApps(apps []platform.AppConfig) ProviderAppHandlerOption {
	return func(handler *ProviderAppHandler) {
		for _, app := range apps {
			app = platform.NormalizeAppConfig(app)
			if app.Provider == "bluesky" || app.Provider == "discord" || app.ClientID == "" {
				continue
			}
			handler.environmentApps[platform.AppConfigMergeKey(app)] = app
		}
	}
}

func WithProviderAppFrontendURL(frontendURL string) ProviderAppHandlerOption {
	return func(handler *ProviderAppHandler) {
		handler.frontendURL = strings.TrimRight(strings.TrimSpace(frontendURL), "/")
	}
}

func NewProviderAppHandler(service *providerapps.Service, db *bun.DB, authenticator middleware.Authenticator, options ...ProviderAppHandlerOption) *ProviderAppHandler {
	handler := &ProviderAppHandler{
		service:         service,
		db:              db,
		auth:            authenticator,
		environmentApps: make(map[string]platform.AppConfig),
	}
	for _, option := range options {
		option(handler)
	}
	return handler
}

func (h *ProviderAppHandler) RegisterRoutes(api huma.API) {
	authMiddleware := middleware.AuthMiddleware(api, h.auth)
	huma.Register(api, huma.Operation{
		OperationID: "list-provider-apps",
		Method:      http.MethodGet,
		Path:        "/admin/provider-apps",
		Summary:     "List configured provider apps",
		Tags:        []string{"Admin"},
		Middlewares: huma.Middlewares{authMiddleware},
	}, h.listProviderApps)

	huma.Register(api, huma.Operation{
		OperationID: "save-provider-app",
		Method:      http.MethodPost,
		Path:        "/admin/provider-apps",
		Summary:     "Create or update a provider app",
		Tags:        []string{"Admin"},
		Middlewares: huma.Middlewares{authMiddleware},
	}, h.saveProviderApp)

	huma.Register(api, huma.Operation{
		OperationID: "delete-provider-app",
		Method:      http.MethodDelete,
		Path:        "/admin/provider-apps/{id}",
		Summary:     "Delete a provider app",
		Tags:        []string{"Admin"},
		Middlewares: huma.Middlewares{authMiddleware},
	}, h.deleteProviderApp)
}

func (h *ProviderAppHandler) listProviderApps(ctx context.Context, _ *struct{}) (*ListProviderAppsOutput, error) {
	if err := h.requireInstanceAdmin(ctx); err != nil {
		return nil, err
	}
	apps, err := h.service.ListProviderApps(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to list provider apps")
	}
	out := make([]ProviderAppResponse, 0, len(apps)+len(h.environmentApps))
	for _, app := range apps {
		key := platform.AppConfigMergeKey(platform.AppConfig{Provider: app.Provider, InstanceURL: app.InstanceURL})
		response := providerAppResponse(app)
		_, response.Shadowed = h.environmentApps[key]
		response.Editable = !response.Shadowed
		out = append(out, response)
	}
	for key, app := range h.environmentApps {
		out = append(out, ProviderAppResponse{
			ID:               "environment:" + key,
			Provider:         app.Provider,
			Name:             app.Name,
			ClientID:         app.ClientID,
			RedirectURI:      app.RedirectURI,
			InstanceURL:      app.InstanceURL,
			IsActive:         true,
			SecretConfigured: app.ClientSecret != "",
			Source:           "environment",
			Editable:         false,
			Deletable:        false,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		left := out[i].Provider + "\x00" + out[i].InstanceURL + "\x00" + out[i].Source
		right := out[j].Provider + "\x00" + out[j].InstanceURL + "\x00" + out[j].Source
		return left < right
	})
	return &ListProviderAppsOutput{Body: out}, nil
}

func (h *ProviderAppHandler) saveProviderApp(ctx context.Context, input *SaveProviderAppInput) (*SaveProviderAppOutput, error) {
	if err := h.requireInstanceAdmin(ctx); err != nil {
		return nil, err
	}
	isActive := true
	if input.Body.IsActive != nil {
		isActive = *input.Body.IsActive
	}
	appConfig := platform.NormalizeAppConfig(platform.AppConfig{
		Provider:    input.Body.Provider,
		Name:        input.Body.Name,
		ClientID:    input.Body.ClientID,
		RedirectURI: input.Body.RedirectURI,
		InstanceURL: input.Body.InstanceURL,
	})
	if _, managed := h.environmentApps[platform.AppConfigMergeKey(appConfig)]; managed {
		return nil, huma.Error409Conflict("provider app is managed by the environment")
	}
	if appConfig.RedirectURI == "" && h.frontendURL != "" {
		if appConfig.Provider == "mastodon" {
			appConfig.RedirectURI = "urn:ietf:wg:oauth:2.0:oob"
		} else {
			appConfig.RedirectURI = h.frontendURL + "/api/v1/accounts/" + appConfig.Provider + "/callback"
		}
	}
	app, existed, err := h.service.UpsertProviderApp(ctx, providerapps.UpsertInput{
		Provider:     appConfig.Provider,
		Name:         appConfig.Name,
		ClientID:     appConfig.ClientID,
		ClientSecret: input.Body.ClientSecret,
		RedirectURI:  appConfig.RedirectURI,
		InstanceURL:  appConfig.InstanceURL,
		IsActive:     isActive,
	})
	if err != nil {
		return nil, providerAppServiceError(err)
	}
	return &SaveProviderAppOutput{Body: SaveProviderAppResponse{
		App:             providerAppResponse(app),
		Existed:         existed,
		RequiresRestart: true,
	}}, nil
}

func (h *ProviderAppHandler) deleteProviderApp(ctx context.Context, input *DeleteProviderAppInput) (*DeleteProviderAppOutput, error) {
	if err := h.requireInstanceAdmin(ctx); err != nil {
		return nil, err
	}
	if err := h.service.DeleteProviderApp(ctx, input.ID); err != nil {
		return nil, providerAppServiceError(err)
	}
	return &DeleteProviderAppOutput{Body: DeleteProviderAppResponse{RequiresRestart: true}}, nil
}

func (h *ProviderAppHandler) requireInstanceAdmin(ctx context.Context) error {
	return requireBrowserSessionInstanceAdmin(ctx, h.db)
}

func providerAppServiceError(err error) error {
	var validationErr providerapps.ValidationError
	if errors.As(err, &validationErr) {
		return huma.Error400BadRequest(validationErr.Error())
	}
	if errors.Is(err, providerapps.ErrNotFound) {
		return huma.Error404NotFound("provider app not found")
	}
	return huma.Error500InternalServerError("failed to save provider app")
}

func providerAppResponse(app models.ProviderApp) ProviderAppResponse {
	return ProviderAppResponse{
		ID:               app.ID,
		Provider:         app.Provider,
		Name:             app.Name,
		ClientID:         app.ClientID,
		RedirectURI:      app.RedirectURI,
		InstanceURL:      app.InstanceURL,
		IsActive:         app.IsActive,
		SecretConfigured: len(app.ClientSecretEnc) > 0,
		CreatedAt:        formatProviderAppTime(app.CreatedAt),
		UpdatedAt:        formatProviderAppTime(app.UpdatedAt),
		Source:           "database",
		Editable:         true,
		Deletable:        true,
	}
}

func formatProviderAppTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}
