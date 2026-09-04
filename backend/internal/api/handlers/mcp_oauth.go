package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/externalapps"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/openpost/backend/internal/services/mcpoauth"
)

type MCPOAuthHandler struct {
	service       *mcpoauth.Service
	authenticator middleware.Authenticator
	publicURL     string
	identity      *identity.Service
	externalApps  *externalapps.Service
}

func (h *MCPOAuthHandler) SetExternalApplicationService(service *externalapps.Service) {
	h.externalApps = service
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
	e.POST("/oauth/revoke", h.revoke)
	e.POST("/oauth/register", h.registerExternalApplication)
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
			Actor:               workspaceActor(ctx, middleware.GetUserID(ctx)),
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
	metadata := map[string]any{
		"issuer":                                baseURL,
		"authorization_endpoint":                baseURL + "/oauth/authorize",
		"token_endpoint":                        baseURL + "/oauth/token",
		"revocation_endpoint":                   baseURL + "/oauth/revoke",
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported":      []string{mcpoauth.CodeChallengeMethodS256},
		"token_endpoint_auth_methods_supported": []string{"none", "client_secret_post", "client_secret_basic"},
		"scopes_supported":                      append([]string{mcpScopeRead, mcpScopeFull}, externalapps.SupportedScopes()...),
		"client_id_metadata_document_supported": true,
		"resource_indicators_supported":         true,
	}
	if h.externalApps != nil && h.externalApps.DynamicRegistrationEnabled() {
		metadata["registration_endpoint"] = baseURL + "/oauth/register"
	}
	return c.JSON(http.StatusOK, metadata)
}

type dynamicClientRegistrationRequest struct {
	ClientName              string   `json:"client_name"`
	RedirectURIs            []string `json:"redirect_uris"`
	TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
	Scope                   string   `json:"scope"`
}

func (h *MCPOAuthHandler) registerExternalApplication(c echo.Context) error {
	if h.externalApps == nil || !h.externalApps.DynamicRegistrationEnabled() {
		return h.oauthError(c, http.StatusForbidden, "access_denied", "Dynamic client registration is disabled")
	}
	var request dynamicClientRegistrationRequest
	decoder := json.NewDecoder(http.MaxBytesReader(c.Response().Writer, c.Request().Body, 64*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return h.oauthError(c, http.StatusBadRequest, "invalid_client_metadata", "Invalid client metadata")
	}
	clientType := externalapps.ClientTypePublic
	switch request.TokenEndpointAuthMethod {
	case "", "none":
		request.TokenEndpointAuthMethod = "none"
	case "client_secret_post", "client_secret_basic":
		clientType = externalapps.ClientTypeConfidential
	default:
		return h.oauthError(c, http.StatusBadRequest, "invalid_client_metadata", "Unsupported token endpoint authentication method")
	}
	registered, err := h.externalApps.RegisterDynamicApplication(c.Request().Context(), externalapps.RegisterApplicationInput{
		Name: request.ClientName, ClientType: clientType, RedirectURIs: request.RedirectURIs,
		AllowedScopes: strings.Fields(request.Scope),
	})
	if err != nil {
		return h.oauthError(c, http.StatusBadRequest, "invalid_client_metadata", "Invalid client metadata")
	}
	return c.JSON(http.StatusCreated, map[string]any{
		"client_id": registered.Application.ClientID, "client_secret": registered.ClientSecret,
		"client_id_issued_at": registered.Application.CreatedAt.Unix(),
		"client_name":         registered.Application.Name, "redirect_uris": request.RedirectURIs,
		"token_endpoint_auth_method": request.TokenEndpointAuthMethod,
		"grant_types":                []string{"authorization_code", "refresh_token"}, "response_types": []string{"code"},
		"scope": registered.Application.AllowedScopes,
	})
}

func (h *MCPOAuthHandler) token(c echo.Context) error {
	if err := c.Request().ParseForm(); err != nil {
		return h.oauthError(c, http.StatusBadRequest, "invalid_request", "Invalid form body")
	}
	grantType := c.FormValue("grant_type")
	if h.externalApps != nil && (grantType == "refresh_token" || strings.HasPrefix(c.FormValue("code"), "op_auth_")) {
		return h.externalApplicationToken(c, grantType)
	}
	result, err := h.service.ExchangeCode(c.Request().Context(), mcpoauth.TokenRequest{
		GrantType:        grantType,
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

func (h *MCPOAuthHandler) externalApplicationToken(c echo.Context, grantType string) error {
	clientID := c.FormValue("client_id")
	clientSecret := c.FormValue("client_secret")
	if basicID, basicSecret, ok := c.Request().BasicAuth(); ok {
		if clientID != "" && clientID != basicID {
			return h.oauthError(c, http.StatusBadRequest, "invalid_client", "Conflicting OAuth client credentials")
		}
		clientID = basicID
		clientSecret = basicSecret
	}
	var (
		result *externalapps.TokenResult
		err    error
	)
	if grantType == "refresh_token" {
		result, err = h.externalApps.Refresh(c.Request().Context(), externalapps.RefreshInput{
			ClientID: clientID, ClientSecret: clientSecret, RefreshToken: c.FormValue("refresh_token"),
		})
	} else {
		result, err = h.externalApps.ExchangeCode(c.Request().Context(), externalapps.ExchangeInput{
			Code: c.FormValue("code"), ClientID: clientID, ClientSecret: clientSecret,
			RedirectURI: c.FormValue("redirect_uri"), CodeVerifier: c.FormValue("code_verifier"),
		})
	}
	if err != nil {
		code := "invalid_grant"
		if errors.Is(err, externalapps.ErrInvalidClient) {
			code = "invalid_client"
		}
		if errors.Is(err, externalapps.ErrRefreshReplay) {
			code = "invalid_grant"
		}
		return h.oauthError(c, http.StatusBadRequest, code, "Invalid or expired external application grant")
	}
	return c.JSON(http.StatusOK, map[string]any{
		"access_token": result.AccessToken, "refresh_token": result.RefreshToken,
		"token_type": "Bearer", "expires_in": result.ExpiresIn, "scope": result.Scope, "resource": result.Resource,
	})
}

func (h *MCPOAuthHandler) revoke(c echo.Context) error {
	if err := c.Request().ParseForm(); err != nil {
		return h.oauthError(c, http.StatusBadRequest, "invalid_request", "Invalid form body")
	}
	if h.externalApps != nil {
		if err := h.externalApps.Revoke(c.Request().Context(), c.FormValue("token")); err != nil {
			return h.oauthError(c, http.StatusInternalServerError, "server_error", "Token revocation failed")
		}
	}
	return c.NoContent(http.StatusOK)
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
