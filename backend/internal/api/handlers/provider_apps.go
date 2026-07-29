package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/providerapps"
	"github.com/uptrace/bun"
)

type ProviderAppHandler struct {
	service *providerapps.Service
	db      *bun.DB
	auth    middleware.Authenticator
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

func NewProviderAppHandler(service *providerapps.Service, db *bun.DB, authenticator middleware.Authenticator) *ProviderAppHandler {
	return &ProviderAppHandler{service: service, db: db, auth: authenticator}
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
	out := make([]ProviderAppResponse, 0, len(apps))
	for _, app := range apps {
		out = append(out, providerAppResponse(app))
	}
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
	app, existed, err := h.service.UpsertProviderApp(ctx, providerapps.UpsertInput{
		Provider:     input.Body.Provider,
		Name:         input.Body.Name,
		ClientID:     input.Body.ClientID,
		ClientSecret: input.Body.ClientSecret,
		RedirectURI:  input.Body.RedirectURI,
		InstanceURL:  input.Body.InstanceURL,
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
	userID := middleware.GetUserID(ctx)
	if userID == "" {
		return huma.Error401Unauthorized("unauthorized")
	}
	if middleware.GetWorkspaceID(ctx) != "" {
		return huma.Error403Forbidden("instance admin API requires unscoped credentials")
	}
	var user models.User
	if err := h.db.NewSelect().Model(&user).Where("id = ?", userID).Scan(ctx); err != nil {
		return huma.Error500InternalServerError("failed to load user")
	}
	if !user.IsAdmin {
		return huma.Error403Forbidden("instance admin role required")
	}
	return nil
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
	}
}

func formatProviderAppTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}
