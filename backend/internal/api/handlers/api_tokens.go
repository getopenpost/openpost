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
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/uptrace/bun"
)

type APITokenHandler struct {
	tokens *apitokens.Service
	auth   middleware.Authenticator
	db     *bun.DB
}

func NewAPITokenHandler(tokens *apitokens.Service, authenticator middleware.Authenticator, db *bun.DB) *APITokenHandler {
	return &APITokenHandler{tokens: tokens, auth: authenticator, db: db}
}

type APITokenResponse struct {
	ID          string  `json:"id" doc:"API token ID"`
	Name        string  `json:"name" doc:"User-visible token name"`
	TokenPrefix string  `json:"token_prefix" doc:"First 8 hex characters of the token secret hash"`
	Scope       string  `json:"scope" doc:"Token scope"`
	WorkspaceID string  `json:"workspace_id,omitempty" doc:"Optional workspace ID this token is limited to"`
	ExpiresAt   *string `json:"expires_at,omitempty" doc:"Token expiry time"`
	LastUsedAt  *string `json:"last_used_at,omitempty" doc:"Last successful use time"`
	RevokedAt   *string `json:"revoked_at,omitempty" doc:"Revocation time"`
	CreatedAt   string  `json:"created_at" doc:"Creation time"`
}

type ListAPITokensOutput struct {
	Body []APITokenResponse
}

type CreateAPITokenInput struct {
	Body struct {
		Name        string     `json:"name" doc:"User-visible token name"`
		Scope       string     `json:"scope,omitempty" doc:"Token scope. Supported values: cli:full, mcp:read, mcp:full. Defaults to cli:full."`
		WorkspaceID string     `json:"workspace_id,omitempty" doc:"Optional workspace ID this token is limited to"`
		ExpiresAt   *time.Time `json:"expires_at,omitempty" doc:"Explicit expiry. Null means never expires."`
	}
}

type CreateAPITokenOutput struct {
	Body struct {
		Token string           `json:"token" doc:"Raw API token. Returned once and never stored in plaintext."`
		Item  APITokenResponse `json:"item"`
	}
}

type RevokeAPITokenInput struct {
	ID string `path:"id" doc:"API token ID"`
}

type RevokeAPITokenOutput struct {
	Body struct {
		Revoked bool `json:"revoked"`
	}
}

func (h *APITokenHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-api-tokens",
		Method:      http.MethodGet,
		Path:        "/api-tokens",
		Summary:     "List API tokens",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, _ *struct{}) (*ListAPITokensOutput, error) {
		tokens, err := h.tokens.ListTokens(ctx, middleware.GetUserID(ctx))
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to list api tokens")
		}
		return &ListAPITokensOutput{Body: apiTokenResponses(tokens)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "create-api-token",
		Method:        http.MethodPost,
		Path:          "/api-tokens",
		Summary:       "Create an API token",
		Tags:          []string{tagAuth},
		DefaultStatus: http.StatusCreated,
		Middlewares:   huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:        []int{400, 403},
	}, func(ctx context.Context, input *CreateAPITokenInput) (*CreateAPITokenOutput, error) {
		userID := middleware.GetUserID(ctx)
		workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
		if workspaceID == "" {
			workspaceID = middleware.GetWorkspaceID(ctx)
		}
		if workspaceID != "" {
			if h.db == nil {
				return nil, huma.Error500InternalServerError("failed to check workspace access")
			}
			ok, err := middleware.CheckWorkspaceAccess(ctx, h.db, workspaceID, userID)
			if err != nil {
				return nil, huma.Error500InternalServerError("failed to check workspace access")
			}
			if !ok {
				return nil, huma.Error403Forbidden("workspace not accessible")
			}
		}

		generated, err := h.tokens.GenerateTokenWithOptions(
			ctx,
			userID,
			input.Body.Name,
			input.Body.Scope,
			apitokens.GenerateOptions{
				ExpiresAt:   input.Body.ExpiresAt,
				WorkspaceID: workspaceID,
			},
		)
		if err != nil {
			if errors.Is(err, apitokens.ErrInvalidScope) {
				return nil, huma.Error400BadRequest("invalid api token scope")
			}
			return nil, huma.Error500InternalServerError("failed to create api token")
		}

		output := &CreateAPITokenOutput{}
		output.Body.Token = generated.Token
		output.Body.Item = apiTokenResponse(*generated.Model)
		return output, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "revoke-api-token",
		Method:      http.MethodDelete,
		Path:        "/api-tokens/{id}",
		Summary:     "Revoke an API token",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{404},
	}, func(ctx context.Context, input *RevokeAPITokenInput) (*RevokeAPITokenOutput, error) {
		err := h.tokens.RevokeToken(ctx, middleware.GetUserID(ctx), input.ID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("api token not found")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to revoke api token")
		}
		return &RevokeAPITokenOutput{Body: struct {
			Revoked bool `json:"revoked"`
		}{Revoked: true}}, nil
	})
}

func apiTokenResponses(tokens []models.APIToken) []APITokenResponse {
	out := make([]APITokenResponse, 0, len(tokens))
	for _, token := range tokens {
		out = append(out, apiTokenResponse(token))
	}
	return out
}

func apiTokenResponse(token models.APIToken) APITokenResponse {
	return APITokenResponse{
		ID:          token.ID,
		Name:        token.Name,
		TokenPrefix: token.TokenPrefix,
		Scope:       token.Scope,
		WorkspaceID: token.WorkspaceID,
		ExpiresAt:   optionalTime(token.ExpiresAt),
		LastUsedAt:  optionalTime(token.LastUsedAt),
		RevokedAt:   optionalTime(token.RevokedAt),
		CreatedAt:   token.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func optionalTime(t time.Time) *string {
	if t.IsZero() {
		return nil
	}
	formatted := t.UTC().Format(time.RFC3339)
	return &formatted
}
