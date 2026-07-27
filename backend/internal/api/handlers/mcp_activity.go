package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const (
	defaultMCPActivityLimit = 20
	maxMCPActivityLimit     = 100
)

type MCPActivityHandler struct {
	db   *bun.DB
	auth middleware.Authenticator
}

func NewMCPActivityHandler(db *bun.DB, authenticator middleware.Authenticator) *MCPActivityHandler {
	return &MCPActivityHandler{db: db, auth: authenticator}
}

type ListMCPActivityInput struct {
	WorkspaceID string `query:"workspace_id" doc:"Optional workspace ID to filter activity"`
	Limit       int    `query:"limit" doc:"Maximum number of recent calls to return. Defaults to 20 and caps at 100."`
}

type MCPActivityItem struct {
	ID                string `json:"id" doc:"Tool call ID"`
	WorkspaceID       string `json:"workspace_id,omitempty" doc:"Workspace associated with the call, when provided"`
	ClientID          string `json:"client_id,omitempty" doc:"API token ID associated with the call, when available"`
	ClientName        string `json:"client_name,omitempty" doc:"API token name associated with the call, when available"`
	ClientScope       string `json:"client_scope,omitempty" doc:"API token scope associated with the call, when available"`
	ClientTokenPrefix string `json:"client_token_prefix,omitempty" doc:"API token prefix associated with the call, when available"`
	ToolName          string `json:"tool_name" doc:"MCP tool name"`
	Status            string `json:"status" doc:"Tool call status"`
	ErrorMessage      string `json:"error_message,omitempty" doc:"Error text for failed calls"`
	DurationMs        int64  `json:"duration_ms" doc:"Call duration in milliseconds"`
	CreatedAt         string `json:"created_at" doc:"Call creation time"`
}

type ListMCPActivityOutput struct {
	Body []MCPActivityItem
}

func (h *MCPActivityHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-mcp-activity",
		Method:      http.MethodGet,
		Path:        "/mcp/activity",
		Summary:     "List recent MCP tool calls",
		Tags:        []string{tagMCP},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *ListMCPActivityInput) (*ListMCPActivityOutput, error) {
		userID := middleware.GetUserID(ctx)
		limit := input.Limit
		if limit == 0 {
			limit = defaultMCPActivityLimit
		}
		if limit < 0 {
			return nil, huma.Error400BadRequest("limit must be positive")
		}
		if limit > maxMCPActivityLimit {
			limit = maxMCPActivityLimit
		}

		if input.WorkspaceID != "" {
			if err := h.checkWorkspaceAccess(ctx, input.WorkspaceID, userID); err != nil {
				return nil, err
			}
		}

		var calls []models.MCPToolCall
		query := h.db.NewSelect().
			Model(&calls).
			Where("user_id = ?", userID).
			Order("created_at DESC").
			Limit(limit)
		if input.WorkspaceID != "" {
			query.Where("workspace_id = ?", input.WorkspaceID)
		} else if workspaceID := middleware.GetWorkspaceID(ctx); workspaceID != "" {
			query.Where("workspace_id = ?", workspaceID)
		}
		if err := query.Scan(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to list mcp activity")
		}

		return &ListMCPActivityOutput{Body: mcpActivityItems(calls)}, nil
	})
}

func (h *MCPActivityHandler) checkWorkspaceAccess(ctx context.Context, workspaceID, userID string) error {
	if !middleware.WorkspaceScopeAllows(ctx, workspaceID) {
		return huma.Error403Forbidden("workspace not accessible")
	}
	count, err := h.db.NewSelect().
		Model((*models.WorkspaceMember)(nil)).
		Where("workspace_id = ? AND user_id = ?", workspaceID, userID).
		Count(ctx)
	if err != nil {
		return huma.Error500InternalServerError("failed to check workspace access")
	}
	if count == 0 {
		return huma.Error403Forbidden("workspace not accessible")
	}
	return nil
}

func mcpActivityItems(calls []models.MCPToolCall) []MCPActivityItem {
	out := make([]MCPActivityItem, 0, len(calls))
	for _, call := range calls {
		out = append(out, MCPActivityItem{
			ID:                call.ID,
			WorkspaceID:       call.WorkspaceID,
			ClientID:          call.ClientID,
			ClientName:        call.ClientName,
			ClientScope:       call.ClientScope,
			ClientTokenPrefix: call.ClientTokenPrefix,
			ToolName:          call.ToolName,
			Status:            call.Status,
			ErrorMessage:      call.ErrorMessage,
			DurationMs:        call.DurationMs,
			CreatedAt:         call.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	return out
}
