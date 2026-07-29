package middleware

import (
	"context"
	"database/sql"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/uptrace/bun"
)

type contextKey string

const (
	UserIDKey      contextKey = "user_id"
	EmailKey       contextKey = "email"
	WorkspaceIDKey contextKey = "workspace_id"
	SessionIDKey   contextKey = "session_id"
	TokenIDKey     contextKey = "token_id"
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

func principalCanAccessREST(principal *Principal) bool {
	if principal == nil || strings.TrimSpace(principal.Audience) != "" {
		return false
	}
	switch strings.TrimSpace(principal.Scope) {
	case "", apitokens.ScopeCLI:
		return true
	default:
		return false
	}
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

func NewCompositeService(jwtService *auth.Service, apiTokenService *apitokens.Service) *CompositeService {
	return NewCompositeServiceWithSessions(jwtService, apiTokenService, nil)
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
		ClientID:    apiPrincipal.TokenID,
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
			_ = huma.WriteErr(api, ctx, http.StatusUnauthorized, "invalid or expired token")
			return
		}
		if !principalCanAccessREST(principal) {
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
		if err != nil || !principalCanAccessREST(principal) {
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
		next(ctx)
	}
}

func GetUserID(ctx context.Context) string {
	if v, ok := ctx.Value(UserIDKey).(string); ok {
		return v
	}
	return ""
}

func GetUserEmail(ctx context.Context) string {
	if v, ok := ctx.Value(EmailKey).(string); ok {
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

// WorkspaceAccessMiddleware validates that the user has access to the workspace specified in the request.
// This should be used after AuthMiddleware.
func WorkspaceAccessMiddleware(api huma.API, _ *bun.DB) func(ctx huma.Context, next func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		userID := GetUserID(ctx.Context())
		if userID == "" {
			_ = huma.WriteErr(api, ctx, http.StatusUnauthorized, "unauthorized")
			return
		}

		// Get workspace_id from query or body - this is a simplified version
		// In practice, you'd need to extract it from the specific input structure
		// This middleware serves as a pattern that handlers can follow
		next(ctx)
	}
}

// CheckWorkspaceAccess is a helper function to verify workspace access.
func CheckWorkspaceAccess(ctx context.Context, db *bun.DB, workspaceID, userID string) (bool, error) {
	_, ok, err := WorkspaceRole(ctx, db, workspaceID, userID)
	return ok, err
}

// WorkspaceRole returns the authenticated user's role in a workspace while
// preserving an API token's optional workspace boundary.
func WorkspaceRole(ctx context.Context, db *bun.DB, workspaceID, userID string) (string, bool, error) {
	if !WorkspaceScopeAllows(ctx, workspaceID) {
		return "", false, nil
	}
	var member models.WorkspaceMember
	err := db.NewSelect().Model(&member).
		Where("workspace_id = ? AND user_id = ?", workspaceID, userID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return member.Role, true, nil
}

// CheckWorkspaceEditAccess permits workspace administrators and editors to
// mutate editorial content. Viewers remain read-only.
func CheckWorkspaceEditAccess(ctx context.Context, db *bun.DB, workspaceID, userID string) (bool, error) {
	role, ok, err := WorkspaceRole(ctx, db, workspaceID, userID)
	if err != nil || !ok {
		return false, err
	}
	return role == models.WorkspaceRoleAdmin || role == models.WorkspaceRoleEditor, nil
}

// CheckWorkspaceAdminAccess restricts workspace configuration and team
// administration to workspace administrators.
func CheckWorkspaceAdminAccess(ctx context.Context, db *bun.DB, workspaceID, userID string) (bool, error) {
	role, ok, err := WorkspaceRole(ctx, db, workspaceID, userID)
	if err != nil || !ok {
		return false, err
	}
	return role == models.WorkspaceRoleAdmin, nil
}

func WorkspaceScopeAllows(ctx context.Context, workspaceID string) bool {
	scopedWorkspaceID := strings.TrimSpace(GetWorkspaceID(ctx))
	if scopedWorkspaceID == "" {
		return true
	}
	return scopedWorkspaceID == strings.TrimSpace(workspaceID)
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
func BearerMiddleware(authenticator Authenticator) echo.MiddlewareFunc {
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
				return c.JSON(http.StatusUnauthorized, map[string]string{string(errorKey): "invalid or expired token"})
			}
			if !principalCanAccessREST(principal) {
				return c.JSON(http.StatusForbidden, map[string]string{string(errorKey): "token is not authorized for this API resource"})
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

			return next(c)
		}
	}
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
