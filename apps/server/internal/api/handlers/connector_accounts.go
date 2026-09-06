package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/connectors"
	"github.com/openpost/backend/internal/services/providerreadiness"
)

type ConnectConnectorInput struct {
	InstallationID string `path:"installation_id" doc:"Operator connector installation ID"`
	Body           struct {
		WorkspaceID string `json:"workspace_id" doc:"Workspace receiving the connected destinations"`
	}
}

type ConnectConnectorOutput struct {
	Body AccountConnectionResponse
}

func (h *OAuthHandler) connectorProviderAvailability(workspaceID string) []ProviderInfo {
	entries := h.connectorRegistry.ForWorkspace(workspaceID)
	infos := make([]ProviderInfo, 0, len(entries))
	for _, entry := range entries {
		description := strings.TrimSpace(entry.Manifest.Provider.Description)
		if description == "" {
			description = "Published by an operator-installed connector."
		}
		decision := providerreadiness.UnavailableDecision(providerreadiness.OperationConnect)
		if entry.Available {
			decision = providerreadiness.Decision{
				State: providerreadiness.EffectiveStateHealthy, Executable: true,
				Connectable: true, Advertisable: true,
			}
		}
		capabilityLabels := []string{"publishing", "text"}
		infos = append(infos, ProviderInfo{
			Platform: entry.Manifest.Provider.ID, InstallationID: entry.InstallationID,
			DisplayName: entry.Manifest.Provider.DisplayName, AuthMode: "preconfigured",
			Configured: entry.Available, Status: entry.Status, Description: description,
			Capabilities: capabilityLabels, Readiness: decision,
		})
	}
	return infos
}

func (h *OAuthHandler) ConnectConnector(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "connect-operator-connector",
		Method:      http.MethodPost,
		Path:        "/accounts/connectors/{installation_id}/connections",
		Summary:     "Connect destinations from an operator-installed connector",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409, 502, 503},
	}, func(ctx context.Context, input *ConnectConnectorInput) (*ConnectConnectorOutput, error) {
		if h.connectorRegistry == nil || h.connectorStore == nil {
			return nil, huma.Error404NotFound("operator-installed connectors are not configured")
		}
		workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
		if workspaceID == "" {
			return nil, huma.Error400BadRequest("workspace_id is required")
		}
		userID := middleware.GetUserID(ctx)
		if err := h.ensureCanStartAccountConnection(ctx, workspaceID, userID); err != nil {
			return nil, err
		}
		client, _, err := h.connectorRegistry.ClientForWorkspace(input.InstallationID, workspaceID)
		if err != nil {
			return nil, huma.Error409Conflict("connector installation is not available for this Workspace")
		}
		session, err := h.connectorStore.BeginConnection(ctx, workspaceID, input.InstallationID, 10*time.Minute)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to begin connector connection")
		}
		response, err := client.Connect(ctx, connectors.ConnectionRequest{WorkspaceID: workspaceID})
		if err != nil {
			_ = h.connectorStore.FailConnection(ctx, session.ID, connectorConnectionErrorKind(err))
			return nil, huma.Error502BadGateway("connector could not load its configured destinations")
		}
		if err := h.accountSaver.CheckSocialAccountQuotaAmount(ctx, userID, workspaceID, int64(len(response.Accounts))); err != nil {
			_ = h.connectorStore.FailConnection(ctx, session.ID, "quota_rejected")
			return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
		}
		accounts, err := h.connectorStore.SaveConnectionAccounts(ctx, session.ID, response)
		if err != nil {
			_ = h.connectorStore.FailConnection(ctx, session.ID, "persistence_failed")
			return nil, huma.Error500InternalServerError("failed to save connector destinations")
		}
		openFreshComposer := len(accounts) > 0 && accounts[0].ClaimedFirst
		return &ConnectConnectorOutput{Body: h.normalizedAccountConnectionResponse(
			workspaceID, accounts, openFreshComposer,
		)}, nil
	})
}

func connectorConnectionErrorKind(err error) string {
	var connectorError *connectors.HTTPError
	if errors.As(err, &connectorError) {
		if kind := strings.TrimSpace(connectorError.Problem.Kind); kind != "" {
			return kind
		}
		return "connector_http_error"
	}
	return "connector_transport_error"
}
