package middleware

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"sort"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/automationcatalog"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/auth"
)

type contextKey string

const (
	UserIDKey      contextKey = "user_id"
	EmailKey       contextKey = "email"
	WorkspaceIDKey contextKey = "workspace_id"
	SessionIDKey   contextKey = "session_id"
	TokenIDKey     contextKey = "token_id"
	ClientIDKey    contextKey = "client_id"
	ClientNameKey  contextKey = "client_name"
	ScopeKey       contextKey = "scope"
	UserAgentKey   contextKey = "user_agent"
	ClientIPKey    contextKey = "client_ip"
	SecureKey      contextKey = "secure_request"
	errorKey       contextKey = "error"

	// bearerPrefix is the canonical HTTP Authorization scheme this
	// middleware accepts. Centralised as a const to satisfy
	// golangci-lint's goconst rule across all three middleware
	// implementations (AuthMiddleware, JWTMiddleware, BearerMiddleware).
	bearerPrefix      = "Bearer"
	sessionCookieName = "openpost_session"
)

type Principal struct {
	UserID      string
	Email       string
	Scope       string
	WorkspaceID string
	Audience    string
	ClientID    string
	ClientName  string
	TokenPrefix string
	SessionID   string
	TokenID     string
}

type Authenticator interface {
	AuthenticateBearer(ctx context.Context, token string) (*Principal, error)
}

const RESTOperationUploadMediaSessionContent = "upload-media-session-content"

// PrincipalCanAccessREST applies the same scope and audience contract used by
// Huma and legacy Echo authentication. A legacy route with no operation ID is
// available only to browser sessions and cli:full credentials.
func PrincipalCanAccessREST(principal *Principal, operationID ...string) bool {
	if principal == nil || strings.TrimSpace(principal.Audience) != "" {
		return false
	}
	switch strings.TrimSpace(principal.Scope) {
	case "", apitokens.ScopeCLI:
		return true
	case apitokens.ScopeAPIRead:
		return catalogOperationAllowed(operationID, automationcatalog.AccessRead) ||
			operationAllowed(operationID, legacyRESTReadOperations)
	case apitokens.ScopeAPIWrite:
		return catalogOperationAllowed(operationID, automationcatalog.AccessRead, automationcatalog.AccessWrite) ||
			operationAllowed(operationID, legacyRESTReadOperations) ||
			operationAllowed(operationID, legacyRESTWriteOperations)
	default:
		return false
	}
}

func catalogOperationAllowed(operationIDs []string, allowed ...automationcatalog.Access) bool {
	if len(operationIDs) != 1 {
		return false
	}
	operation, ok := automationcatalog.Lookup(strings.TrimSpace(operationIDs[0]))
	if !ok {
		return false
	}
	for _, access := range allowed {
		if operation.Access == access {
			return true
		}
	}
	return false
}

func operationAllowed(operationIDs []string, allowed map[string]struct{}) bool {
	if len(operationIDs) != 1 {
		return false
	}
	_, ok := allowed[strings.TrimSpace(operationIDs[0])]
	return ok
}

// Legacy Echo routes remain denied to scoped REST tokens unless they are
// named here and register the same operation ID with BearerMiddleware. The
// instance-hosted upload content step is the one intentional exception because
// it is part of the Huma create -> content -> complete upload-session contract.
var legacyRESTReadOperations = operationSet()

var legacyRESTWriteOperations = operationSet(
	RESTOperationUploadMediaSessionContent,
)

// RESTScopeOperationCatalog returns stable snapshots of the curated REST
// operation allowlists. Keeping enumeration beside the authorization lookup
// lets contract tests compare every entry with the registered Huma surface.
func RESTScopeOperationCatalog() (read []string, write []string) {
	for _, operation := range automationcatalog.All() {
		switch operation.Access {
		case automationcatalog.AccessRead:
			read = append(read, operation.OperationID)
		case automationcatalog.AccessWrite:
			write = append(write, operation.OperationID)
		}
	}
	return read, write
}

// LegacyRESTScopeOperationCatalog returns the explicitly curated Echo-route
// operations. These IDs are kept separate from the registered Huma catalog so
// an unnamed legacy route cannot inherit api:read or api:write accidentally.
func LegacyRESTScopeOperationCatalog() (read []string, write []string) {
	read = operationIDs(legacyRESTReadOperations)
	write = operationIDs(legacyRESTWriteOperations)
	return read, write
}

func operationIDs(operations map[string]struct{}) []string {
	ids := make([]string, 0, len(operations))
	for operationID := range operations {
		ids = append(ids, operationID)
	}
	sort.Strings(ids)
	return ids
}

func operationSet(operationIDs ...string) map[string]struct{} {
	set := make(map[string]struct{}, len(operationIDs))
	for _, operationID := range operationIDs {
		set[operationID] = struct{}{}
	}
	return set
}

type SessionValidator interface {
	ValidateSession(ctx context.Context, userID, sessionID string) (*models.UserSession, error)
}

type JWTAuthenticator struct {
	service  *auth.Service
	sessions SessionValidator
}

func NewJWTAuthenticator(service *auth.Service) *JWTAuthenticator {
	return &JWTAuthenticator{service: service}
}

func NewJWTAuthenticatorWithSessions(service *auth.Service, sessionValidator SessionValidator) *JWTAuthenticator {
	return &JWTAuthenticator{service: service, sessions: sessionValidator}
}

func (a *JWTAuthenticator) AuthenticateBearer(ctx context.Context, token string) (*Principal, error) {
	claims, err := a.service.ValidateToken(token)
	if err != nil {
		return nil, err
	}
	if claims.SessionID != "" && a.sessions != nil {
		if _, err := a.sessions.ValidateSession(ctx, claims.UserID, claims.SessionID); err != nil {
			return nil, err
		}
	}
	return &Principal{UserID: claims.UserID, Email: claims.Email, SessionID: claims.SessionID}, nil
}

type CompositeService struct {
	jwt       Authenticator
	apiTokens *apitokens.Service
}

func NewCompositeServiceWithSessions(
	jwtService *auth.Service,
	apiTokenService *apitokens.Service,
	sessionValidator SessionValidator,
) *CompositeService {
	return &CompositeService{
		jwt:       NewJWTAuthenticatorWithSessions(jwtService, sessionValidator),
		apiTokens: apiTokenService,
	}
}

func (s *CompositeService) AuthenticateBearer(ctx context.Context, token string) (*Principal, error) {
	principal, err := s.jwt.AuthenticateBearer(ctx, token)
	if err == nil {
		return principal, nil
	}
	if s.apiTokens == nil {
		return nil, err
	}

	apiPrincipal, apiErr := s.apiTokens.ValidateToken(ctx, token)
	if apiErr != nil {
		return nil, err
	}
	return &Principal{
		UserID:      apiPrincipal.UserID,
		Email:       apiPrincipal.Email,
		Scope:       apiPrincipal.Scope,
		WorkspaceID: apiPrincipal.WorkspaceID,
		Audience:    apiPrincipal.Audience,
		ClientID:    firstNonEmpty(apiPrincipal.ClientID, apiPrincipal.TokenID),
		TokenID:     apiPrincipal.TokenID,
		ClientName:  apiPrincipal.TokenName,
		TokenPrefix: apiPrincipal.TokenPrefix,
	}, nil
}

func AuthMiddleware(api huma.API, authenticator Authenticator) func(ctx huma.Context, next func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		authHeader := ctx.Header("Authorization")
		token, cookieAuth := requestAuthToken(authHeader, ctx.Header("Cookie"))
		if token == "" {
			_ = huma.WriteErr(api, ctx, http.StatusUnauthorized, "missing authorization header")
			return
		}
		if cookieAuth && !cookieRequestAllowed(ctx.Method(), ctx.Header("Origin"), ctx.Host()) {
			_ = huma.WriteErr(api, ctx, http.StatusForbidden, "cross-site session request rejected")
			return
		}
		principal, err := authenticator.AuthenticateBearer(ctx.Context(), token)
		if err != nil {
			if ctx.Context().Err() != nil {
				return
			}
			if isAuthenticationUnavailable(err) {
				_ = huma.WriteErr(api, ctx, http.StatusServiceUnavailable, "authentication is temporarily unavailable")
				return
			}
			_ = huma.WriteErr(api, ctx, http.StatusUnauthorized, "invalid or expired token")
			return
		}
		if !PrincipalCanAccessREST(principal, contextOperationID(ctx)) {
			_ = huma.WriteErr(api, ctx, http.StatusForbidden, "token is not authorized for this API resource")
			return
		}

		ctx = huma.WithValue(ctx, UserIDKey, principal.UserID)
		ctx = huma.WithValue(ctx, EmailKey, principal.Email)
		if principal.WorkspaceID != "" {
			ctx = huma.WithValue(ctx, WorkspaceIDKey, principal.WorkspaceID)
		}
		if principal.SessionID != "" {
			ctx = huma.WithValue(ctx, SessionIDKey, principal.SessionID)
		}
		if principal.TokenID != "" {
			ctx = huma.WithValue(ctx, TokenIDKey, principal.TokenID)
		}
		if principal.ClientID != "" {
			ctx = huma.WithValue(ctx, ClientIDKey, principal.ClientID)
		}
		if principal.ClientName != "" {
			ctx = huma.WithValue(ctx, ClientNameKey, principal.ClientName)
		}
		if principal.Scope != "" {
			ctx = huma.WithValue(ctx, ScopeKey, principal.Scope)
		}
		next(ctx)
	}
}

// OptionalAuthMiddleware attaches a valid REST principal when one is present
// and otherwise continues anonymously. Use it only for read-only endpoints
// whose response explicitly supports an unauthenticated state.
func OptionalAuthMiddleware(authenticator Authenticator) func(ctx huma.Context, next func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		authHeader := ctx.Header("Authorization")
		token, cookieAuth := requestAuthToken(authHeader, ctx.Header("Cookie"))
		if token == "" {
			next(ctx)
			return
		}
		if cookieAuth && !cookieRequestAllowed(ctx.Method(), ctx.Header("Origin"), ctx.Host()) {
			next(ctx)
			return
		}
		principal, err := authenticator.AuthenticateBearer(ctx.Context(), token)
		if err != nil || !PrincipalCanAccessREST(principal, contextOperationID(ctx)) {
			next(ctx)
			return
		}

		ctx = huma.WithValue(ctx, UserIDKey, principal.UserID)
		ctx = huma.WithValue(ctx, EmailKey, principal.Email)
		if principal.WorkspaceID != "" {
			ctx = huma.WithValue(ctx, WorkspaceIDKey, principal.WorkspaceID)
		}
		if principal.SessionID != "" {
			ctx = huma.WithValue(ctx, SessionIDKey, principal.SessionID)
		}
		if principal.TokenID != "" {
			ctx = huma.WithValue(ctx, TokenIDKey, principal.TokenID)
		}
		if principal.ClientID != "" {
			ctx = huma.WithValue(ctx, ClientIDKey, principal.ClientID)
		}
		if principal.ClientName != "" {
			ctx = huma.WithValue(ctx, ClientNameKey, principal.ClientName)
		}
		if principal.Scope != "" {
			ctx = huma.WithValue(ctx, ScopeKey, principal.Scope)
		}
		next(ctx)
	}
}

func contextOperationID(ctx huma.Context) string {
	if operation := ctx.Operation(); operation != nil {
		return operation.OperationID
	}
	return ""
}

func GetUserID(ctx context.Context) string {
	if v, ok := ctx.Value(UserIDKey).(string); ok {
		return v
	}
	return ""
}

func GetWorkspaceID(ctx context.Context) string {
	if v, ok := ctx.Value(WorkspaceIDKey).(string); ok {
		return v
	}
	return ""
}

func GetSessionID(ctx context.Context) string {
	if v, ok := ctx.Value(SessionIDKey).(string); ok {
		return v
	}
	return ""
}

func GetTokenID(ctx context.Context) string {
	if v, ok := ctx.Value(TokenIDKey).(string); ok {
		return v
	}
	return ""
}

func GetClientID(ctx context.Context) string {
	if v, ok := ctx.Value(ClientIDKey).(string); ok {
		return v
	}
	return ""
}

func GetClientName(ctx context.Context) string {
	if v, ok := ctx.Value(ClientNameKey).(string); ok {
		return v
	}
	return ""
}

func GetUserAgent(ctx context.Context) string {
	if v, ok := ctx.Value(UserAgentKey).(string); ok {
		return v
	}
	return ""
}

func GetClientIP(ctx context.Context) string {
	if v, ok := ctx.Value(ClientIPKey).(string); ok {
		return v
	}
	return ""
}

func RequestMetadataMiddleware() func(ctx huma.Context, next func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		ctx = huma.WithValue(ctx, ClientIPKey, requestClientIP(ctx))
		ctx = huma.WithValue(ctx, UserAgentKey, strings.TrimSpace(ctx.Header("User-Agent")))
		ctx = huma.WithValue(ctx, SecureKey, ctx.TLS() != nil || strings.EqualFold(strings.TrimSpace(ctx.Header("X-Forwarded-Proto")), "https"))
		next(ctx)
	}
}

func IsSecureRequest(ctx context.Context) bool {
	secure, _ := ctx.Value(SecureKey).(bool)
	return secure
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func JWTMiddleware(authService *auth.Service) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			authHeader := c.Request().Header.Get("Authorization")
			if authHeader == "" {
				return c.JSON(http.StatusUnauthorized, map[string]string{string(errorKey): "missing authorization header"})
			}

			tokenParts := strings.Split(authHeader, " ")
			if len(tokenParts) != 2 || tokenParts[0] != bearerPrefix {
				return c.JSON(http.StatusUnauthorized, map[string]string{string(errorKey): "invalid authorization header format"})
			}

			claims, err := authService.ValidateToken(tokenParts[1])
			if err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{string(errorKey): "invalid or expired token"})
			}

			c.Set(string(UserIDKey), claims.UserID)
			c.Set(string(EmailKey), claims.Email)
			if claims.SessionID != "" {
				c.Set(string(SessionIDKey), claims.SessionID)
			}

			return next(c)
		}
	}
}

// BearerMiddleware is the Echo-shaped counterpart of AuthMiddleware.
// It accepts a JWT session token OR an API/CLI token (op_cli_...) via
// the unified Authenticator, and exposes the resolved principal on the
// Echo context. Use it on legacy Echo routes (e.g. /api/v1/media/upload)
// that need to support CLI tokens but cannot be expressed as Huma ops.
func BearerMiddleware(authenticator Authenticator, operationID ...string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			authHeader := c.Request().Header.Get("Authorization")
			token, cookieAuth := requestAuthToken(authHeader, c.Request().Header.Get("Cookie"))
			if token == "" {
				return c.JSON(http.StatusUnauthorized, map[string]string{string(errorKey): "missing authorization header"})
			}
			if cookieAuth && !cookieRequestAllowed(c.Request().Method, c.Request().Header.Get("Origin"), c.Request().Host) {
				return c.JSON(http.StatusForbidden, map[string]string{string(errorKey): "cross-site session request rejected"})
			}

			principal, err := authenticator.AuthenticateBearer(c.Request().Context(), token)
			if err != nil {
				if c.Request().Context().Err() != nil {
					return nil
				}
				if isAuthenticationUnavailable(err) {
					return c.JSON(http.StatusServiceUnavailable, map[string]string{string(errorKey): "authentication is temporarily unavailable"})
				}
				return c.JSON(http.StatusUnauthorized, map[string]string{string(errorKey): "invalid or expired token"})
			}
			if !PrincipalCanAccessREST(principal, operationID...) {
				return c.JSON(http.StatusForbidden, map[string]string{string(errorKey): "token is not authorized for this API resource"})
			}

			AttachPrincipal(c, principal)

			return next(c)
		}
	}
}

// AttachPrincipal makes a resolved credential available to Echo handlers and
// to policy checks reached through the request context.
func AttachPrincipal(c echo.Context, principal *Principal) {
	if c == nil || principal == nil {
		return
	}
	c.Set(string(UserIDKey), principal.UserID)
	c.Set(string(EmailKey), principal.Email)
	requestCtx := context.WithValue(c.Request().Context(), UserIDKey, principal.UserID)
	requestCtx = context.WithValue(requestCtx, EmailKey, principal.Email)
	if principal.WorkspaceID != "" {
		c.Set(string(WorkspaceIDKey), principal.WorkspaceID)
		requestCtx = context.WithValue(requestCtx, WorkspaceIDKey, principal.WorkspaceID)
	}
	if principal.SessionID != "" {
		c.Set(string(SessionIDKey), principal.SessionID)
		requestCtx = context.WithValue(requestCtx, SessionIDKey, principal.SessionID)
	}
	if principal.TokenID != "" {
		c.Set(string(TokenIDKey), principal.TokenID)
		requestCtx = context.WithValue(requestCtx, TokenIDKey, principal.TokenID)
	}
	c.SetRequest(c.Request().WithContext(requestCtx))
}

func isAuthenticationUnavailable(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

func requestAuthToken(authHeader, cookieHeader string) (string, bool) {
	if authHeader != "" {
		parts := strings.Fields(authHeader)
		if len(parts) == 2 && parts[0] == bearerPrefix {
			return parts[1], false
		}
		return "", false
	}
	req := &http.Request{Header: http.Header{"Cookie": []string{cookieHeader}}}
	cookie, err := req.Cookie(sessionCookieName)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return "", false
	}
	return strings.TrimSpace(cookie.Value), true
}

func cookieRequestAllowed(method, origin, host string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}
	originURL, err := url.Parse(strings.TrimSpace(origin))
	if err != nil || originURL.Hostname() == "" {
		return false
	}
	hostname := strings.TrimSpace(host)
	if parsedHost, _, splitErr := net.SplitHostPort(hostname); splitErr == nil {
		hostname = parsedHost
	}
	return strings.EqualFold(originURL.Hostname(), strings.Trim(hostname, "[]"))
}

func requestClientIP(ctx huma.Context) string {
	if forwarded := strings.TrimSpace(strings.Split(ctx.Header("X-Forwarded-For"), ",")[0]); forwarded != "" {
		return forwarded
	}
	if realIP := strings.TrimSpace(ctx.Header("X-Real-Ip")); realIP != "" {
		return realIP
	}
	if addr, err := netip.ParseAddrPort(ctx.RemoteAddr()); err == nil {
		return addr.Addr().String()
	}
	return ctx.RemoteAddr()
}
