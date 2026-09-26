package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/postimport"
	"github.com/uptrace/bun"
)

type PostImportHandler struct {
	db      *bun.DB
	service *postimport.Service
	auth    middleware.Authenticator
}

func NewPostImportHandler(db *bun.DB, service *postimport.Service, auth middleware.Authenticator) *PostImportHandler {
	return &PostImportHandler{db: db, service: service, auth: auth}
}

type ReadPostImportsInput struct {
	AccountID   string `path:"account_id" doc:"Connected account ID"`
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID"`
	Cursor      string `query:"cursor" doc:"Opaque cursor for older imported posts"`
	Limit       int    `query:"limit" default:"50" minimum:"1" maximum:"100" doc:"Imported posts per page"`
}

type SavePostImportsInput struct {
	AccountID string `path:"account_id" doc:"Connected account ID"`
	Body      struct {
		WorkspaceID string `json:"workspace_id" required:"true" doc:"Workspace ID"`
		Enabled     bool   `json:"enabled" required:"true" doc:"Whether native post imports are enabled"`
	}
}

type ImportedPostResponse struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Text        string    `json:"text"`
	ExternalURL string    `json:"external_url"`
	PublishedAt time.Time `json:"published_at"`
}

type PostImportOverviewResponse struct {
	AccountID         string                 `json:"account_id"`
	Platform          string                 `json:"platform"`
	Supported         bool                   `json:"supported"`
	UnavailableReason string                 `json:"unavailable_reason,omitempty"`
	Enabled           bool                   `json:"enabled"`
	Status            string                 `json:"status"`
	LastSuccessAt     *time.Time             `json:"last_success_at,omitempty"`
	NextEligibleAt    *time.Time             `json:"next_eligible_at,omitempty"`
	FailureMessage    string                 `json:"failure_message,omitempty"`
	Posts             []ImportedPostResponse `json:"posts"`
	NextCursor        string                 `json:"next_cursor,omitempty"`
}

type PostImportOverviewOutput struct {
	Body PostImportOverviewResponse
}

func (h *PostImportHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "read-post-imports", Method: http.MethodGet,
		Path: "/accounts/{account_id}/post-imports", Summary: "Read a connected account's native post imports",
		Tags: []string{tagAccounts}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors: []int{400, 403, 404},
	}, func(ctx context.Context, input *ReadPostImportsInput) (*PostImportOverviewOutput, error) {
		workspaceID := strings.TrimSpace(input.WorkspaceID)
		if workspaceID == "" {
			return nil, huma.Error400BadRequest("workspace_id is required")
		}
		allowed, err := workspaceReadAllowed(ctx, h.db, workspaceID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, huma.Error500InternalServerError("could not check workspace access")
		}
		if !allowed {
			return nil, huma.Error403Forbidden("workspace read denied")
		}
		return h.read(ctx, workspaceID, input.AccountID, input.Cursor, input.Limit)
	})

	huma.Register(api, huma.Operation{
		OperationID: "save-post-imports", Method: http.MethodPut,
		Path: "/accounts/{account_id}/post-imports", Summary: "Opt a connected account into or out of native post imports",
		Tags: []string{tagAccounts}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors: []int{400, 403, 404, 409},
	}, func(ctx context.Context, input *SavePostImportsInput) (*PostImportOverviewOutput, error) {
		workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
		if workspaceID == "" {
			return nil, huma.Error400BadRequest("workspace_id is required")
		}
		allowed, err := workspaceEditAllowed(ctx, h.db, workspaceID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, huma.Error500InternalServerError("could not check workspace access")
		}
		if !allowed {
			return nil, huma.Error403Forbidden("workspace edit denied")
		}
		current, err := h.service.ReadOverview(ctx, workspaceID, input.AccountID, "", 50)
		if errors.Is(err, postimport.ErrAccountNotFound) {
			return nil, huma.Error404NotFound("account not found")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("could not read post imports")
		}
		if input.Body.Enabled {
			if !current.Support.Supported {
				return nil, huma.Error409Conflict(current.Support.UnavailableReason)
			}
			_, err = h.service.Enable(ctx, workspaceID, input.AccountID)
		} else {
			err = h.service.Disable(ctx, workspaceID, input.AccountID)
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("could not save post import choice")
		}
		return h.read(ctx, workspaceID, input.AccountID, "", 50)
	})
}

func (h *PostImportHandler) read(ctx context.Context, workspaceID, accountID, cursor string, limit int) (*PostImportOverviewOutput, error) {
	overview, err := h.service.ReadOverview(ctx, workspaceID, accountID, cursor, limit)
	if errors.Is(err, postimport.ErrAccountNotFound) {
		return nil, huma.Error404NotFound("account not found")
	}
	if errors.Is(err, postimport.ErrInvalidCursor) {
		return nil, huma.Error400BadRequest("invalid cursor")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("could not read post imports")
	}
	response := PostImportOverviewResponse{
		AccountID: accountID, Platform: overview.Platform,
		Supported: overview.Support.Supported, UnavailableReason: overview.Support.UnavailableReason,
		Posts: make([]ImportedPostResponse, 0, len(overview.Posts)), NextCursor: overview.NextCursor,
	}
	if overview.State != nil {
		response.Enabled = overview.State.Enabled
		response.Status = overview.State.Status
		response.FailureMessage = overview.State.FailureMessage
		if !overview.State.LastSuccessAt.IsZero() {
			last := overview.State.LastSuccessAt
			response.LastSuccessAt = &last
		}
		if !overview.State.NextEligibleAt.IsZero() {
			next := overview.State.NextEligibleAt
			response.NextEligibleAt = &next
		}
	}
	for _, post := range overview.Posts {
		response.Posts = append(response.Posts, ImportedPostResponse{
			ID: post.ID, Title: post.Title, Text: post.Text,
			ExternalURL: post.ExternalURL, PublishedAt: post.PublishedAt,
		})
	}
	return &PostImportOverviewOutput{Body: response}, nil
}
