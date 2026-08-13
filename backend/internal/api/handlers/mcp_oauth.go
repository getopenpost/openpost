package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/openpost/backend/internal/services/mcpoauth"
)

type MCPOAuthHandler struct {
	service       *mcpoauth.Service
	authenticator middleware.Authenticator
	publicURL     string
	identity      *identity.Service
}

func (h *MCPOAuthHandler) SetIdentityService(service *identity.Service) {
	h.identity = service
}

func NewMCPOAuthHandler(service *mcpoauth.Service, authenticator middleware.Authenticator, publicURL string) *MCPOAuthHandler {
	return &MCPOAuthHandler{
		service:       service,
		authenticator: authenticator,
		publicURL:     strings.TrimRight(publicURL, "/"),
	}
}

type CreateMCPOAuthAuthorizationInput struct {
	Body struct {
		Approved            bool   `json:"approved" doc:"Whether the user approved the MCP OAuth request"`
		WorkspaceID         string `json:"workspace_id,omitempty" doc:"Optional workspace ID the resulting MCP token is limited to"`
		ResponseType        string `json:"response_type" doc:"OAuth response type. Must be code."`
		ClientID            string `json:"client_id" doc:"OAuth client ID or client metadata URL"`
		RedirectURI         string `json:"redirect_uri" doc:"OAuth redirect URI"`
		Scope               string `json:"scope,omitempty" doc:"Requested OAuth scope. Supported values are mcp:read and mcp:full. Defaults to mcp:full."`
		State               string `json:"state,omitempty" doc:"Opaque client state to echo to the redirect URI"`
		CodeChallenge       string `json:"code_challenge,omitempty" doc:"PKCE S256 code challenge. Required when approved is true."`
		CodeChallengeMethod string `json:"code_challenge_method,omitempty" doc:"PKCE method. Must be S256 when approved is true."`
		Resource            string `json:"resource,omitempty" doc:"MCP protected resource URL"`
	}
}

type CreateMCPOAuthAuthorizationOutput struct {
	Body struct {
		RedirectURL string `json:"redirect_url" doc:"URL the browser should redirect to after authorization"`
	}
}

func (h *MCPOAuthHandler) RegisterRoutes(e *echo.Echo, api huma.API) {
	h.RegisterEchoRoutes(e)
	h.RegisterAPIRoutes(api)
}

func (h *MCPOAuthHandler) RegisterEchoRoutes(e *echo.Echo) {
	e.GET("/.well-known/oauth-authorization-server", h.authorizationServerMetadata)
	e.POST("/oauth/token", h.token)
}

func (h *MCPOAuthHandler) RegisterAPIRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "create-mcp-oauth-authorization",
		Method:      http.MethodPost,
		Path:        "/mcp/oauth/authorize",
		Summary:     "Create or deny an MCP OAuth authorization response",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authenticator), middleware.RequestMetadataMiddleware()},
		Errors:      []int{400, 401, 403},
	}, func(ctx context.Context, input *CreateMCPOAuthAuthorizationInput) (*CreateMCPOAuthAuthorizationOutput, error) {
		if strings.TrimSpace(middleware.GetSessionID(ctx)) == "" {
			return nil, huma.Error403Forbidden("a signed-in browser session is required to review MCP access")
		}
		request := mcpoauth.AuthorizationRequest{
			UserID:              middleware.GetUserID(ctx),
			WorkspaceID:         input.Body.WorkspaceID,
			ResponseType:        input.Body.ResponseType,
			ClientID:            input.Body.ClientID,
			RedirectURI:         input.Body.RedirectURI,
			Scope:               input.Body.Scope,
			State:               input.Body.State,
			CodeChallenge:       input.Body.CodeChallenge,
			CodeChallengeMethod: input.Body.CodeChallengeMethod,
			Resource:            input.Body.Resource,
			ExpectedResource:    h.resourceURLFromContext(ctx),
		}
		var (
			result *mcpoauth.AuthorizationResult
			err    error
		)
		if input.Body.Approved {
			if h.identity != nil && strings.TrimSpace(input.Body.WorkspaceID) != "" {
				decision, policyErr := h.identity.AuthorizeTokenCreation(
					ctx,
					middleware.GetUserID(ctx),
					middleware.GetSessionID(ctx),
					input.Body.WorkspaceID,
					time.Now().UTC().Add(apitokens.DefaultExpiration),
				)
				if policyErr != nil {
					return nil, mcpTokenPolicyError(policyErr)
				}
				request.OrganizationID = decision.OrganizationID
				request.IdentityProviderID = decision.ProviderID
				request.AssuredAt = decision.AssuredAt
				request.TokenExpiresAt = decision.ExpiresAt
			}
			result, err = h.service.CreateAuthorizationCode(ctx, request)
		} else {
			result, err = h.service.DenyRedirect(ctx, request)
		}
		if err != nil {
			return nil, mcpOAuthHumaError(err)
		}

		out := &CreateMCPOAuthAuthorizationOutput{}
		out.Body.RedirectURL = result.RedirectURL
		return out, nil
	})
}

func mcpTokenPolicyError(err error) error {
	switch {
	case errors.Is(err, identity.ErrTokenPolicyDenied):
		return huma.Error403Forbidden("organization policy does not allow MCP tokens")
	case errors.Is(err, identity.ErrReauthRequired), errors.Is(err, identity.ErrSSOAssuranceRequired):
		return huma.Error403Forbidden("sign in with the organization identity provider before approving this MCP client")
	default:
		return huma.Error500InternalServerError("failed to evaluate MCP token policy")
	}
}

func (h *MCPOAuthHandler) authorizationServerMetadata(c echo.Context) error {
	baseURL := requestBaseURL(c.Request(), h.publicURL)
	return c.JSON(http.StatusOK, map[string]any{
		"issuer":                                baseURL,
		"authorization_endpoint":                baseURL + "/oauth/authorize",
		"token_endpoint":                        baseURL + "/oauth/token",
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code"},
		"code_challenge_methods_supported":      []string{mcpoauth.CodeChallengeMethodS256},
		"token_endpoint_auth_methods_supported": []string{"none"},
		"scopes_supported":                      []string{mcpScopeRead, mcpScopeFull},
		"client_id_metadata_document_supported": true,
		"resource_indicators_supported":         true,
	})
}

func (h *MCPOAuthHandler) token(c echo.Context) error {
	if err := c.Request().ParseForm(); err != nil {
		return h.oauthError(c, http.StatusBadRequest, "invalid_request", "Invalid form body")
	}
	result, err := h.service.ExchangeCode(c.Request().Context(), mcpoauth.TokenRequest{
		GrantType:        c.FormValue("grant_type"),
		Code:             c.FormValue("code"),
		RedirectURI:      c.FormValue("redirect_uri"),
		ClientID:         c.FormValue("client_id"),
		CodeVerifier:     c.FormValue("code_verifier"),
		Resource:         c.FormValue("resource"),
		ExpectedResource: requestBaseURL(c.Request(), h.publicURL) + "/mcp",
	})
	if err != nil {
		status, code, description := mcpOAuthError(err)
		return h.oauthError(c, status, code, description)
	}
	return c.JSON(http.StatusOK, map[string]any{
		"access_token": result.AccessToken,
		"token_type":   "Bearer",
		"expires_in":   result.ExpiresIn,
		"scope":        result.Scope,
		"resource":     result.Resource,
	})
}

func (h *MCPOAuthHandler) oauthError(c echo.Context, status int, code, description string) error {
	return c.JSON(status, map[string]string{
		fieldError:          code,
		"error_description": description,
	})
}

func (h *MCPOAuthHandler) resourceURLFromContext(_ context.Context) string {
	if h.publicURL == "" {
		return ""
	}
	return h.publicURL + "/mcp"
}

func mcpOAuthHumaError(err error) error {
	status, _, description := mcpOAuthError(err)
	if status == http.StatusForbidden {
		return huma.Error403Forbidden(description)
	}
	if status == http.StatusInternalServerError {
		return huma.Error500InternalServerError(description)
	}
	return huma.Error400BadRequest(description)
}

func mcpOAuthError(err error) (int, string, string) {
	switch {
	case errors.Is(err, mcpoauth.ErrInvalidClient):
		return http.StatusBadRequest, "invalid_client", "Invalid OAuth client"
	case errors.Is(err, mcpoauth.ErrInvalidGrant):
		return http.StatusBadRequest, "invalid_grant", "Invalid or expired authorization code"
	case errors.Is(err, mcpoauth.ErrUnsupportedGrant):
		return http.StatusBadRequest, "unsupported_grant_type", "Unsupported grant type"
	case errors.Is(err, mcpoauth.ErrUnsupportedPKCE):
		return http.StatusBadRequest, "invalid_request", "PKCE S256 is required"
	case errors.Is(err, mcpoauth.ErrUnsupportedScope):
		return http.StatusBadRequest, "invalid_scope", "Only mcp:read and mcp:full are supported"
	case errors.Is(err, mcpoauth.ErrUnsupportedResource):
		return http.StatusBadRequest, "invalid_target", "Unsupported MCP resource"
	case errors.Is(err, mcpoauth.ErrWorkspaceNotAllowed):
		return http.StatusForbidden, "access_denied", "Workspace not accessible"
	case errors.Is(err, mcpoauth.ErrInvalidRequest):
		return http.StatusBadRequest, "invalid_request", "Invalid OAuth request"
	default:
		return http.StatusInternalServerError, "server_error", "OAuth request failed"
	}
}
