package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/externalwebhooks"
	"github.com/uptrace/bun"
)

type ExternalWebhookHandler struct {
	service *externalwebhooks.Service
	db      *bun.DB
	auth    middleware.Authenticator
}

func NewExternalWebhookHandler(service *externalwebhooks.Service, db *bun.DB, auth middleware.Authenticator) *ExternalWebhookHandler {
	return &ExternalWebhookHandler{service: service, db: db, auth: auth}
}

type CreateExternalWebhookInput struct {
	Body struct {
		InstallationID string   `json:"installation_id,omitempty"`
		WorkspaceID    string   `json:"workspace_id"`
		URL            string   `json:"url" format:"uri"`
		EventTypes     []string `json:"event_types" minItems:"1" uniqueItems:"true"`
	}
}

type ExternalWebhookResponse struct {
	ID             string `json:"id"`
	InstallationID string `json:"installation_id"`
	WorkspaceID    string `json:"workspace_id"`
	URL            string `json:"url"`
	EventTypes     string `json:"event_types"`
	Status         string `json:"status"`
	CreatedAt      string `json:"created_at"`
}

type CreateExternalWebhookOutput struct {
	Body struct {
		Subscription  ExternalWebhookResponse `json:"subscription"`
		SigningSecret string                  `json:"signing_secret" doc:"Webhook signing secret. Returned once."`
	}
}

type ListExternalWebhooksInput struct {
	InstallationID string `query:"installation_id"`
}
type ListExternalWebhooksOutput struct{ Body []ExternalWebhookResponse }
type ExternalWebhookPathInput struct {
	ID string `path:"id"`
}
type ListExternalWebhookDeliveriesInput struct {
	InstallationID string `query:"installation_id"`
	Limit          int    `query:"limit" default:"100" minimum:"1" maximum:"200"`
}
type ListExternalWebhookDeliveriesOutput struct {
	Body []models.ExternalWebhookDelivery
}

func (h *ExternalWebhookHandler) RegisterRoutes(api huma.API) {
	auth := huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}
	huma.Register(api, huma.Operation{OperationID: "create-external-webhook", Method: http.MethodPost, Path: "/external-webhooks", Summary: "Create a signed publication webhook", Tags: []string{"Integrations"}, Middlewares: auth, DefaultStatus: http.StatusCreated, Errors: []int{400, 403}}, h.create)
	huma.Register(api, huma.Operation{OperationID: "list-external-webhooks", Method: http.MethodGet, Path: "/external-webhooks", Summary: "List external application webhooks", Tags: []string{"Integrations"}, Middlewares: auth}, h.list)
	huma.Register(api, huma.Operation{OperationID: "list-external-webhook-deliveries", Method: http.MethodGet, Path: "/external-webhooks/deliveries", Summary: "List external webhook delivery attempts", Tags: []string{"Integrations"}, Middlewares: auth}, h.listDeliveries)
	huma.Register(api, huma.Operation{OperationID: "delete-external-webhook", Method: http.MethodDelete, Path: "/external-webhooks/{id}", Summary: "Revoke an external application webhook", Tags: []string{"Integrations"}, Middlewares: auth, Errors: []int{404}}, h.revoke)
}

func (h *ExternalWebhookHandler) create(ctx context.Context, input *CreateExternalWebhookInput) (*CreateExternalWebhookOutput, error) {
	installationID, err := h.authorizedInstallation(ctx, input.Body.InstallationID)
	if err != nil {
		return nil, err
	}
	created, err := h.service.Create(ctx, externalwebhooks.CreateInput{InstallationID: installationID, WorkspaceID: input.Body.WorkspaceID, URL: input.Body.URL, EventTypes: input.Body.EventTypes})
	if err != nil {
		if errors.Is(err, externalwebhooks.ErrInvalidSubscription) {
			return nil, huma.Error400BadRequest("invalid webhook subscription")
		}
		return nil, huma.Error500InternalServerError("failed to create webhook")
	}
	out := &CreateExternalWebhookOutput{}
	out.Body.Subscription = externalWebhookResponse(created.Subscription)
	out.Body.SigningSecret = created.Secret
	return out, nil
}

func (h *ExternalWebhookHandler) list(ctx context.Context, input *ListExternalWebhooksInput) (*ListExternalWebhooksOutput, error) {
	installationID, err := h.authorizedInstallation(ctx, input.InstallationID)
	if err != nil {
		return nil, err
	}
	rows, err := h.service.List(ctx, installationID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to list webhooks")
	}
	out := make([]ExternalWebhookResponse, 0, len(rows))
	for _, row := range rows {
		out = append(out, externalWebhookResponse(row))
	}
	return &ListExternalWebhooksOutput{Body: out}, nil
}

func (h *ExternalWebhookHandler) listDeliveries(ctx context.Context, input *ListExternalWebhookDeliveriesInput) (*ListExternalWebhookDeliveriesOutput, error) {
	installationID, err := h.authorizedInstallation(ctx, input.InstallationID)
	if err != nil {
		return nil, err
	}
	rows, err := h.service.ListDeliveries(ctx, installationID, input.Limit)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to list webhook deliveries")
	}
	return &ListExternalWebhookDeliveriesOutput{Body: rows}, nil
}

func (h *ExternalWebhookHandler) revoke(ctx context.Context, input *ExternalWebhookPathInput) (*ExternalRevocationOutput, error) {
	var subscription models.ExternalWebhookSubscription
	if err := h.db.NewSelect().Model(&subscription).Where("id = ?", input.ID).Scan(ctx); err != nil {
		return nil, huma.Error404NotFound("webhook not found")
	}
	installationID, err := h.authorizedInstallation(ctx, subscription.InstallationID)
	if err != nil {
		return nil, err
	}
	if err := h.service.Revoke(ctx, installationID, input.ID); err != nil {
		return nil, huma.Error404NotFound("webhook not found")
	}
	return revokedExternalOutput(), nil
}

func (h *ExternalWebhookHandler) authorizedInstallation(ctx context.Context, requested string) (string, error) {
	credentialInstallation := middleware.GetInstallationID(ctx)
	if credentialInstallation != "" {
		if requested != "" && requested != credentialInstallation {
			return "", huma.Error403Forbidden("token belongs to another external application installation")
		}
		return credentialInstallation, nil
	}
	requested = strings.TrimSpace(requested)
	if middleware.GetSessionID(ctx) == "" || requested == "" {
		return "", huma.Error403Forbidden("external application installation is required")
	}
	count, err := h.db.NewSelect().Model((*models.ExternalAppInstallation)(nil)).Where("id = ? AND sponsor_user_id = ? AND revoked_at IS NULL", requested, middleware.GetUserID(ctx)).Count(ctx)
	if err != nil {
		return "", huma.Error500InternalServerError("failed to verify connected application")
	}
	if count != 1 {
		return "", huma.Error403Forbidden("connected application is not accessible")
	}
	return requested, nil
}

func externalWebhookResponse(row models.ExternalWebhookSubscription) ExternalWebhookResponse {
	status := "active"
	if !row.RevokedAt.IsZero() {
		status = "revoked"
	}
	return ExternalWebhookResponse{ID: row.ID, InstallationID: row.InstallationID, WorkspaceID: row.WorkspaceID, URL: row.URL, EventTypes: row.EventTypes, Status: status, CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339)}
}
