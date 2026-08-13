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
	"github.com/openpost/backend/internal/services/identity"
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
	ID                 string  `json:"id" doc:"API token ID"`
	Name               string  `json:"name" doc:"User-visible token name"`
	TokenPrefix        string  `json:"token_prefix" doc:"First 8 hex characters of the token secret hash"`
	Scope              string  `json:"scope" doc:"Token scope"`
	WorkspaceID        string  `json:"workspace_id,omitempty" doc:"Optional workspace ID this token is limited to"`
	OrganizationID     string  `json:"organization_id,omitempty" doc:"Organization this token is bound to by SSO policy"`
	IdentityProviderID string  `json:"identity_provider_id,omitempty" doc:"Identity provider assurance bound to this token"`
	ExpiresAt          *string `json:"expires_at,omitempty" doc:"Token expiry time"`
	LastUsedAt         *string `json:"last_used_at,omitempty" doc:"Last successful authentication time"`
	RevokedAt          *string `json:"revoked_at,omitempty" doc:"Revocation time"`
	CreatedAt          string  `json:"created_at" doc:"Creation time"`
	Status             string  `json:"status" enum:"active,expired,revoked" doc:"Current token status"`
}

type ListAPITokensOutput struct {
	Body []APITokenResponse
}

type CreateAPITokenInput struct {
	Body struct {
		Name        string     `json:"name" minLength:"1" maxLength:"120" doc:"Required user-visible token name"`
		Scope       string     `json:"scope,omitempty" enum:"cli:full,mcp:read,mcp:full,api:read,api:write" doc:"Token scope. Defaults to cli:full."`
		WorkspaceID string     `json:"workspace_id,omitempty" doc:"Optional workspace ID this token is limited to"`
		ExpiresAt   *time.Time `json:"expires_at,omitempty" nullable:"true" doc:"Expiry time. Omitted or null defaults to 90 days; the maximum lifetime is one year."`
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
	h.registerListRoute(api)
	h.registerCreateRoute(api)
	h.registerRevokeRoute(api)
}

func (h *APITokenHandler) registerListRoute(api huma.API) {
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
}

func (h *APITokenHandler) registerCreateRoute(api huma.API) {
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
		return h.createToken(ctx, input)
	})
}

func (h *APITokenHandler) createToken(ctx context.Context, input *CreateAPITokenInput) (*CreateAPITokenOutput, error) {
	userID := middleware.GetUserID(ctx)
	workspaceID, err := h.resolveTokenWorkspace(ctx, userID, input.Body.WorkspaceID)
	if err != nil {
		return nil, err
	}
	policyDecision, err := h.authorizeTokenCreation(ctx, userID, workspaceID, input.Body.ExpiresAt)
	if err != nil {
		return nil, err
	}

	expiresAt := input.Body.ExpiresAt
	if !policyDecision.ExpiresAt.IsZero() {
		expiresAt = &policyDecision.ExpiresAt
	}
	generated, err := h.tokens.GenerateTokenWithOptions(
		ctx,
		userID,
		input.Body.Name,
		input.Body.Scope,
		apitokens.GenerateOptions{
			ExpiresAt:          expiresAt,
			WorkspaceID:        workspaceID,
			OrganizationID:     policyDecision.OrganizationID,
			IdentityProviderID: policyDecision.ProviderID,
			AssuredAt:          policyDecision.AssuredAt,
		},
	)
	if err != nil {
		return nil, apiTokenCreationError(err)
	}

	output := &CreateAPITokenOutput{}
	output.Body.Token = generated.Token
	output.Body.Item = apiTokenResponse(*generated.Model)
	return output, nil
}

func (h *APITokenHandler) resolveTokenWorkspace(ctx context.Context, userID, requestedWorkspaceID string) (string, error) {
	workspaceID := strings.TrimSpace(requestedWorkspaceID)
	if workspaceID == "" {
		workspaceID = middleware.GetWorkspaceID(ctx)
	}
	if workspaceID == "" {
		return "", nil
	}
	if h.db == nil {
		return "", huma.Error500InternalServerError("failed to check workspace access")
	}
	ok, err := middleware.CheckWorkspaceAccess(ctx, h.db, workspaceID, userID)
	if err != nil {
		return "", huma.Error500InternalServerError("failed to check workspace access")
	}
	if !ok {
		return "", huma.Error403Forbidden("workspace not accessible")
	}
	return workspaceID, nil
}

func (h *APITokenHandler) authorizeTokenCreation(
	ctx context.Context,
	userID,
	workspaceID string,
	expiresAt *time.Time,
) (identity.TokenPolicyDecision, error) {
	var requestedExpiry time.Time
	if expiresAt != nil {
		requestedExpiry = expiresAt.UTC()
	}
	decision, err := identity.AuthorizeTokenCreation(
		ctx,
		h.db,
		userID,
		middleware.GetSessionID(ctx),
		workspaceID,
		requestedExpiry,
	)
	switch {
	case errors.Is(err, identity.ErrTokenPolicyDenied):
		return decision, huma.Error403Forbidden("organization policy does not allow API tokens")
	case errors.Is(err, identity.ErrReauthRequired), errors.Is(err, identity.ErrSSOAssuranceRequired):
		return decision, huma.Error403Forbidden("sign in with the organization identity provider before creating this token")
	case err != nil:
		return decision, huma.Error500InternalServerError("failed to evaluate API token policy")
	default:
		return decision, nil
	}
}

func apiTokenCreationError(err error) error {
	switch {
	case errors.Is(err, apitokens.ErrInvalidScope):
		return huma.Error400BadRequest("invalid api token scope")
	case errors.Is(err, apitokens.ErrInvalidName):
		return huma.Error400BadRequest("api token name is required and must be at most 120 characters")
	case errors.Is(err, apitokens.ErrInvalidExpiry):
		return huma.Error400BadRequest("api token expiration must be in the future and no more than one year away")
	default:
		return huma.Error500InternalServerError("failed to create api token")
	}
}

func (h *APITokenHandler) registerRevokeRoute(api huma.API) {
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
	status := "active"
	if !token.RevokedAt.IsZero() {
		status = "revoked"
	} else if !token.ExpiresAt.IsZero() && !token.ExpiresAt.After(time.Now().UTC()) {
		status = "expired"
	}
	return APITokenResponse{
		ID:                 token.ID,
		Name:               token.Name,
		TokenPrefix:        token.TokenPrefix,
		Scope:              token.Scope,
		WorkspaceID:        token.WorkspaceID,
		OrganizationID:     token.OrganizationID,
		IdentityProviderID: token.IdentityProviderID,
		ExpiresAt:          optionalTime(token.ExpiresAt),
		LastUsedAt:         optionalTime(token.LastUsedAt),
		RevokedAt:          optionalTime(token.RevokedAt),
		CreatedAt:          token.CreatedAt.UTC().Format(time.RFC3339),
		Status:             status,
	}
}

func optionalTime(t time.Time) *string {
	if t.IsZero() {
		return nil
	}
	formatted := t.UTC().Format(time.RFC3339)
	return &formatted
}
