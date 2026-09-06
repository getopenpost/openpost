package handlers

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/externalapps"
	"github.com/uptrace/bun"
)

type ExternalApplicationHandler struct {
	service *externalapps.Service
	db      *bun.DB
	auth    middleware.Authenticator
}

func NewExternalApplicationHandler(service *externalapps.Service, db *bun.DB, auth middleware.Authenticator) *ExternalApplicationHandler {
	return &ExternalApplicationHandler{service: service, db: db, auth: auth}
}

type ExternalApplicationResponse struct {
	ID            string `json:"id"`
	ClientID      string `json:"client_id"`
	Name          string `json:"name"`
	ClientType    string `json:"client_type"`
	AllowedScopes string `json:"allowed_scopes"`
	CreatedAt     string `json:"created_at"`
	RevokedAt     string `json:"revoked_at,omitempty"`
}

type CreateExternalApplicationInput struct {
	Body struct {
		Name          string   `json:"name" minLength:"1" maxLength:"120"`
		ClientType    string   `json:"client_type" enum:"public,confidential"`
		RedirectURIs  []string `json:"redirect_uris" minItems:"1" uniqueItems:"true"`
		AllowedScopes []string `json:"allowed_scopes" minItems:"1" uniqueItems:"true"`
	}
}

type CreateExternalApplicationOutput struct {
	Body struct {
		Application  ExternalApplicationResponse `json:"application"`
		ClientSecret string                      `json:"client_secret,omitempty" doc:"Confidential client secret. Returned once."`
	}
}

type ListExternalApplicationsOutput struct{ Body []ExternalApplicationResponse }

type ExternalAuthorizationRequestInput struct {
	ClientID    string `query:"client_id"`
	RedirectURI string `query:"redirect_uri"`
}

type ExternalAuthorizationRequestOutput struct {
	Body struct {
		Application ExternalApplicationResponse `json:"application"`
	}
}

type AuthorizeExternalApplicationInput struct {
	Body struct {
		Approved        bool                               `json:"approved"`
		ClientID        string                             `json:"client_id"`
		RedirectURI     string                             `json:"redirect_uri"`
		Scope           string                             `json:"scope"`
		State           string                             `json:"state,omitempty"`
		CodeChallenge   string                             `json:"code_challenge"`
		WorkspaceGrants []externalapps.WorkspaceGrantInput `json:"workspace_grants"`
	}
}

type AuthorizeExternalApplicationOutput struct {
	Body struct {
		RedirectURL    string `json:"redirect_url"`
		InstallationID string `json:"installation_id,omitempty"`
	}
}

type ExternalInstallationResponse struct {
	ID              string   `json:"id"`
	ApplicationID   string   `json:"application_id"`
	ApplicationName string   `json:"application_name"`
	Scopes          string   `json:"scopes"`
	Status          string   `json:"status"`
	CreatedAt       string   `json:"created_at"`
	WorkspaceIDs    []string `json:"workspace_ids"`
}

type ListExternalInstallationsOutput struct {
	Body []ExternalInstallationResponse
}
type ExternalInstallationPathInput struct {
	ID string `path:"id"`
}
type ExternalWorkspaceGrantPathInput struct {
	ID          string `path:"id"`
	WorkspaceID string `path:"workspace_id"`
}
type ExternalRevocationOutput struct {
	Body struct {
		Revoked bool `json:"revoked"`
	}
}

type RotateExternalApplicationSecretOutput struct {
	Body struct {
		ClientSecret string `json:"client_secret" doc:"Replacement confidential client secret. Returned once."`
	}
}

func (h *ExternalApplicationHandler) RegisterRoutes(api huma.API) {
	auth := huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}
	huma.Register(api, huma.Operation{OperationID: "list-external-applications", Method: http.MethodGet, Path: "/admin/external-applications", Summary: "List registered external applications", Tags: []string{"Admin"}, Middlewares: auth}, h.listApplications)
	huma.Register(api, huma.Operation{OperationID: "create-external-application", Method: http.MethodPost, Path: "/admin/external-applications", Summary: "Register an external application", Tags: []string{"Admin"}, Middlewares: auth, DefaultStatus: http.StatusCreated, Errors: []int{400, 403}}, h.createApplication)
	huma.Register(api, huma.Operation{OperationID: "revoke-external-application", Method: http.MethodDelete, Path: "/admin/external-applications/{id}", Summary: "Revoke an external application", Tags: []string{"Admin"}, Middlewares: auth, Errors: []int{403, 404}}, h.revokeApplication)
	huma.Register(api, huma.Operation{OperationID: "rotate-external-application-secret", Method: http.MethodPost, Path: "/admin/external-applications/{id}/rotate-secret", Summary: "Rotate a confidential application secret", Tags: []string{"Admin"}, Middlewares: auth, Errors: []int{400, 403, 404}}, h.rotateApplicationSecret)
	huma.Register(api, huma.Operation{OperationID: "get-external-authorization-request", Method: http.MethodGet, Path: "/external-applications/oauth/request", Summary: "Inspect an external application authorization request", Tags: []string{tagAuth}, Middlewares: auth, Errors: []int{400}}, h.authorizationRequest)
	huma.Register(api, huma.Operation{OperationID: "authorize-external-application", Method: http.MethodPost, Path: "/external-applications/oauth/authorize", Summary: "Approve an external application connection", Tags: []string{tagAuth}, Middlewares: auth, Errors: []int{400, 403}}, h.authorize)
	huma.Register(api, huma.Operation{OperationID: "list-external-app-installations", Method: http.MethodGet, Path: "/external-applications/installations", Summary: "List connected external applications", Tags: []string{tagAuth}, Middlewares: auth}, h.listInstallations)
	huma.Register(api, huma.Operation{OperationID: "revoke-external-app-installation", Method: http.MethodDelete, Path: "/external-applications/installations/{id}", Summary: "Disconnect an external application", Tags: []string{tagAuth}, Middlewares: auth, Errors: []int{404}}, h.revokeInstallation)
	huma.Register(api, huma.Operation{OperationID: "revoke-external-app-workspace-grant", Method: http.MethodDelete, Path: "/external-applications/installations/{id}/workspaces/{workspace_id}", Summary: "Remove one workspace from an external application", Tags: []string{tagAuth}, Middlewares: auth, Errors: []int{404}}, h.revokeWorkspaceGrant)
}

func (h *ExternalApplicationHandler) revokeApplication(ctx context.Context, input *ExternalInstallationPathInput) (*ExternalRevocationOutput, error) {
	if err := requireBrowserSessionInstanceAdmin(ctx, h.db); err != nil {
		return nil, err
	}
	if err := h.service.RevokeApplication(ctx, input.ID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("external application not found")
		}
		return nil, huma.Error500InternalServerError("failed to revoke external application")
	}
	return revokedExternalOutput(), nil
}

func (h *ExternalApplicationHandler) rotateApplicationSecret(ctx context.Context, input *ExternalInstallationPathInput) (*RotateExternalApplicationSecretOutput, error) {
	if err := requireBrowserSessionInstanceAdmin(ctx, h.db); err != nil {
		return nil, err
	}
	secret, err := h.service.RotateClientSecret(ctx, input.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("external application not found")
		}
		if errors.Is(err, externalapps.ErrInvalidClient) {
			return nil, huma.Error400BadRequest("public applications do not have client secrets")
		}
		return nil, huma.Error500InternalServerError("failed to rotate client secret")
	}
	out := &RotateExternalApplicationSecretOutput{}
	out.Body.ClientSecret = secret
	return out, nil
}

func (h *ExternalApplicationHandler) authorizationRequest(ctx context.Context, input *ExternalAuthorizationRequestInput) (*ExternalAuthorizationRequestOutput, error) {
	if middleware.GetSessionID(ctx) == "" {
		return nil, huma.Error403Forbidden("a signed-in browser session is required to review an external application")
	}
	app, err := h.service.ApplicationForAuthorization(ctx, input.ClientID, input.RedirectURI)
	if err != nil {
		return nil, externalApplicationError(err)
	}
	out := &ExternalAuthorizationRequestOutput{}
	out.Body.Application = externalApplicationResponse(*app)
	return out, nil
}

func (h *ExternalApplicationHandler) createApplication(ctx context.Context, input *CreateExternalApplicationInput) (*CreateExternalApplicationOutput, error) {
	if err := requireBrowserSessionInstanceAdmin(ctx, h.db); err != nil {
		return nil, err
	}
	result, err := h.service.RegisterApplication(ctx, externalapps.RegisterApplicationInput{
		Name: input.Body.Name, ClientType: input.Body.ClientType, RedirectURIs: input.Body.RedirectURIs,
		AllowedScopes: input.Body.AllowedScopes, CreatedByUserID: middleware.GetUserID(ctx),
	})
	if err != nil {
		return nil, externalApplicationError(err)
	}
	out := &CreateExternalApplicationOutput{}
	out.Body.Application = externalApplicationResponse(result.Application)
	out.Body.ClientSecret = result.ClientSecret
	return out, nil
}

func (h *ExternalApplicationHandler) listApplications(ctx context.Context, _ *struct{}) (*ListExternalApplicationsOutput, error) {
	if err := requireBrowserSessionInstanceAdmin(ctx, h.db); err != nil {
		return nil, err
	}
	apps, err := h.service.ListApplications(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to list external applications")
	}
	out := make([]ExternalApplicationResponse, 0, len(apps))
	for _, app := range apps {
		out = append(out, externalApplicationResponse(app))
	}
	return &ListExternalApplicationsOutput{Body: out}, nil
}

func (h *ExternalApplicationHandler) authorize(ctx context.Context, input *AuthorizeExternalApplicationInput) (*AuthorizeExternalApplicationOutput, error) {
	if middleware.GetSessionID(ctx) == "" {
		return nil, huma.Error403Forbidden("a signed-in browser session is required to approve an external application")
	}
	request := externalapps.AuthorizeInput{
		UserID: middleware.GetUserID(ctx), SessionID: middleware.GetSessionID(ctx), ClientID: input.Body.ClientID, RedirectURI: input.Body.RedirectURI,
		Scopes: strings.Fields(input.Body.Scope), State: input.Body.State, CodeChallenge: input.Body.CodeChallenge,
		WorkspaceGrants: input.Body.WorkspaceGrants,
	}
	var result *externalapps.AuthorizationResult
	var err error
	if input.Body.Approved {
		result, err = h.service.Authorize(ctx, request)
	} else {
		result, err = h.service.Deny(ctx, request)
	}
	if err != nil {
		return nil, externalApplicationError(err)
	}
	out := &AuthorizeExternalApplicationOutput{}
	out.Body.RedirectURL = result.RedirectURL
	out.Body.InstallationID = result.InstallationID
	return out, nil
}

func (h *ExternalApplicationHandler) listInstallations(ctx context.Context, _ *struct{}) (*ListExternalInstallationsOutput, error) {
	installations, err := h.service.ListInstallations(ctx, middleware.GetUserID(ctx))
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to list connected applications")
	}
	out := make([]ExternalInstallationResponse, 0, len(installations))
	for _, installation := range installations {
		var app models.ExternalApplication
		if err := h.db.NewSelect().Model(&app).Where("id = ?", installation.ApplicationID).Scan(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to list connected applications")
		}
		var grants []models.ExternalAppWorkspaceGrant
		if err := h.db.NewSelect().Model(&grants).Where("installation_id = ? AND revoked_at IS NULL", installation.ID).Scan(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to list connected applications")
		}
		workspaceIDs := make([]string, 0, len(grants))
		for _, grant := range grants {
			workspaceIDs = append(workspaceIDs, grant.WorkspaceID)
		}
		status := "active"
		if !installation.RevokedAt.IsZero() {
			status = "revoked"
		}
		out = append(out, ExternalInstallationResponse{ID: installation.ID, ApplicationID: app.ID, ApplicationName: app.Name, Scopes: installation.Scopes, Status: status, CreatedAt: installation.CreatedAt.UTC().Format(time.RFC3339), WorkspaceIDs: workspaceIDs})
	}
	return &ListExternalInstallationsOutput{Body: out}, nil
}

func (h *ExternalApplicationHandler) revokeInstallation(ctx context.Context, input *ExternalInstallationPathInput) (*ExternalRevocationOutput, error) {
	if err := h.service.RevokeInstallation(ctx, middleware.GetUserID(ctx), input.ID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("connected application not found")
		}
		return nil, huma.Error500InternalServerError("failed to disconnect application")
	}
	return revokedExternalOutput(), nil
}

func (h *ExternalApplicationHandler) revokeWorkspaceGrant(ctx context.Context, input *ExternalWorkspaceGrantPathInput) (*ExternalRevocationOutput, error) {
	if err := h.service.RevokeWorkspaceGrant(ctx, middleware.GetUserID(ctx), input.ID, input.WorkspaceID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("workspace grant not found")
		}
		return nil, huma.Error500InternalServerError("failed to remove workspace grant")
	}
	return revokedExternalOutput(), nil
}

func externalApplicationResponse(app models.ExternalApplication) ExternalApplicationResponse {
	response := ExternalApplicationResponse{ID: app.ID, ClientID: app.ClientID, Name: app.Name, ClientType: app.ClientType, AllowedScopes: app.AllowedScopes, CreatedAt: app.CreatedAt.UTC().Format(time.RFC3339)}
	if !app.RevokedAt.IsZero() {
		response.RevokedAt = app.RevokedAt.UTC().Format(time.RFC3339)
	}
	return response
}

func revokedExternalOutput() *ExternalRevocationOutput {
	return &ExternalRevocationOutput{Body: struct {
		Revoked bool `json:"revoked"`
	}{Revoked: true}}
}

func externalApplicationError(err error) error {
	switch {
	case errors.Is(err, externalapps.ErrWorkspaceNotAllowed), errors.Is(err, externalapps.ErrAccountNotAllowed):
		return huma.Error403Forbidden(err.Error())
	case errors.Is(err, externalapps.ErrInvalidClient), errors.Is(err, externalapps.ErrInvalidGrant), errors.Is(err, externalapps.ErrInvalidScope), errors.Is(err, externalapps.ErrInvalidRequest):
		return huma.Error400BadRequest(err.Error())
	default:
		return huma.Error500InternalServerError("external application authorization failed")
	}
}
