package middleware

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"net/url"
	"sort"
	"strings"

	"github.com/openpost/backend/internal/textutil"

	"github.com/danielgtaylor/huma/v2"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/automationcatalog"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/sessions"
)

type contextKey string

const (
	UserIDKey          contextKey = "user_id"
	EmailKey           contextKey = "email"
	WorkspaceIDKey     contextKey = "workspace_id"
	SessionIDKey       contextKey = "session_id"
	TokenIDKey         contextKey = "token_id"
	ClientIDKey        contextKey = "client_id"
	ClientNameKey      contextKey = "client_name"
	ScopeKey           contextKey = "scope"
	UserAgentKey       contextKey = "user_agent"
	ClientIPKey        contextKey = "client_ip"
	OriginKey          contextKey = "request_origin"
	SecureKey          contextKey = "secure_request"
	InstallationIDKey  contextKey = "external_app_installation_id"
	DelegatedScopesKey contextKey = "external_app_delegated_scopes"
	errorKey           contextKey = "error"

	// bearerPrefix is the canonical HTTP Authorization scheme this
	// middleware accepts. Centralised as a const to satisfy
	// golangci-lint's goconst rule across all three middleware
	// implementations (AuthMiddleware, JWTMiddleware, BearerMiddleware).
	bearerPrefix      = "Bearer"
	sessionCookieName = "openpost_session"

	// invalidTokenChallenge marks a 401 as a rejected session or token. Action
	// checks such as recent reauthentication also answer 401, so browser clients
	// clear local session state only for responses that carry this challenge.
	// RFC 9110 requires a challenge on every 401 response.
	invalidTokenChallenge = `Bearer error="invalid_token"`
)

var errAuthenticationUnavailable = errors.New("authentication unavailable")

type Principal struct {
	UserID          string
	Email           string
	Scope           string
	WorkspaceID     string
	Audience        string
	ClientID        string
	ClientName      string
	TokenPrefix     string
	SessionID       string
	TokenID         string
	InstallationID  string
	DelegatedScopes string
}

type Authenticator interface {
	AuthenticateBearer(ctx context.Context, token string) (*Principal, error)
}

const RESTOperationUploadMediaSessionContent = "upload-media-session-content"

// PrincipalCanAccessREST applies the same scope and audience contract used by
// Huma and legacy Echo authentication. A legacy route with no operation ID is
// available only to browser sessions and cli:full credentials.
func PrincipalCanAccessREST(principal *Principal, operationID ...string) bool {
	if principal == nil {
		return false
	}
	if principal.Scope == apitokens.ScopeExternalApp {
		return strings.TrimSpace(principal.Audience) != "" && externalAppOperationAllowed(principal, operationID)
	}
	if strings.TrimSpace(principal.Audience) != "" {
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

func externalAppOperationAllowed(principal *Principal, operationIDs []string) bool {
	if strings.TrimSpace(principal.InstallationID) == "" || len(operationIDs) != 1 {
		return false
	}
	return delegatedOperationAllowed(principal.DelegatedScopes, operationIDs[0])
}

func delegatedOperationAllowed(scopeSet, operationID string) bool {
	scopes := make(map[string]struct{})
	for _, scope := range strings.Fields(scopeSet) {
		scopes[scope] = struct{}{}
	}
	required := map[string]string{
		"list-workspaces":                      "workspace:read",
		"list-accounts":                        "accounts:read",
		"lookup-account-mentions":              "accounts:read",
		"list-media":                           "media:read",
		"list-publications":                    "publications:read",
		"get-publication":                      "publications:read",
		"list-publication-events":              "publications:read",
		"validate-publication":                 "publications:read",
		"preview-text-card":                    "publications:read",
		"create-publication":                   "drafts:write",
		"update-publication":                   "drafts:write",
		"upsert-publication-renditions":        "drafts:write",
		"create-media-upload-session":          "media:write",
		RESTOperationUploadMediaSessionContent: "media:write",
		"complete-media-upload-session":        "media:write",
		"prepare-media-image":                  "media:write",
		"optimize-media-image":                 "media:write",
		"schedule-publication":                 "publications:schedule",
		"publish-publication-now":              "publications:publish",
		"cancel-publication":                   "publications:cancel",
		"create-external-webhook":              "events:subscribe",
		"list-external-webhooks":               "events:subscribe",
		"list-external-webhook-deliveries":     "events:subscribe",
		"delete-external-webhook":              "events:subscribe",
	}
	requiredScope, ok := required[strings.TrimSpace(operationID)]
	if !ok {
		return false
	}
	_, ok = scopes[requiredScope]
	return ok
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
			if isInvalidSessionError(err) {
				return nil, err
			}
			return nil, authenticationUnavailableError(err)
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
	if s.apiTokens == nil || !strings.HasPrefix(strings.TrimSpace(token), apitokens.TokenPrefix+"_") {
		return nil, err
	}

	apiPrincipal, apiErr := s.apiTokens.ValidateToken(ctx, token)
	if apiErr != nil {
		if isInvalidAPITokenError(apiErr) {
			return nil, apiErr
		}
		return nil, authenticationUnavailableError(apiErr)
	}
	return &Principal{
		UserID:          apiPrincipal.UserID,
		Email:           apiPrincipal.Email,
		Scope:           apiPrincipal.Scope,
		WorkspaceID:     apiPrincipal.WorkspaceID,
		Audience:        apiPrincipal.Audience,
		ClientID:        textutil.FirstNonEmpty(apiPrincipal.ClientID, apiPrincipal.TokenID),
		TokenID:         apiPrincipal.TokenID,
		ClientName:      apiPrincipal.TokenName,
		TokenPrefix:     apiPrincipal.TokenPrefix,
		InstallationID:  apiPrincipal.InstallationID,
		DelegatedScopes: apiPrincipal.DelegatedScopes,
	}, nil
}

// writeUnauthorized reports a rejected credential with the challenge that marks
// session invalidity, so clients do not treat an action-level 401 as a sign-out.
func writeUnauthorized(api huma.API, ctx huma.Context, message string) {
	ctx.SetHeader("WWW-Authenticate", invalidTokenChallenge)
	_ = huma.WriteErr(api, ctx, http.StatusUnauthorized, message)
}

func echoUnauthorized(c echo.Context, message string) error {
	c.Response().Header().Set("WWW-Authenticate", invalidTokenChallenge)
	return c.JSON(http.StatusUnauthorized, map[string]string{string(errorKey): message})
}

func AuthMiddleware(api huma.API, authenticator Authenticator) func(ctx huma.Context, next func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		authHeader := ctx.Header("Authorization")
		token, cookieAuth := requestAuthToken(authHeader, ctx.Header("Cookie"))
		if token == "" {
			writeUnauthorized(api, ctx, "missing authorization header")
			return
		}
		if cookieAuth && !cookieRequestAllowed(ctx.Method(), ctx.Header("Origin"), ctx.Host(), requestScheme(ctx)) {
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
			writeUnauthorized(api, ctx, "invalid or expired token")
			return
		}
		if SessionOriginRejected(principal, ctx.Header("Origin"), ctx.Host(), requestScheme(ctx)) {
			_ = huma.WriteErr(api, ctx, http.StatusForbidden, "cross-site session request rejected")
			return
		}
		if !PrincipalCanAccessREST(principal, contextOperationID(ctx)) {
			_ = huma.WriteErr(api, ctx, http.StatusForbidden, "token is not authorized for this API resource")
			return
		}

		next(withHumaPrincipal(ctx, principal))
	}
}

// OptionalAuthMiddleware attaches a valid REST principal when one is present.
// Missing and invalid credentials continue anonymously. Availability errors
// return 503 so clients do not mistake an outage for a signed-out user.
func OptionalAuthMiddleware(api huma.API, authenticator Authenticator) func(ctx huma.Context, next func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		authHeader := ctx.Header("Authorization")
		token, cookieAuth := requestAuthToken(authHeader, ctx.Header("Cookie"))
		if token == "" {
			next(ctx)
			return
		}
		if cookieAuth && !cookieRequestAllowed(ctx.Method(), ctx.Header("Origin"), ctx.Host(), requestScheme(ctx)) {
			next(ctx)
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
			next(ctx)
			return
		}
		if SessionOriginRejected(principal, ctx.Header("Origin"), ctx.Host(), requestScheme(ctx)) {
			next(ctx)
			return
		}
		if !PrincipalCanAccessREST(principal, contextOperationID(ctx)) {
			next(ctx)
			return
		}

		next(withHumaPrincipal(ctx, principal))
	}
}

func withHumaPrincipal(ctx huma.Context, principal *Principal) huma.Context {
	ctx = huma.WithValue(ctx, UserIDKey, principal.UserID)
	ctx = huma.WithValue(ctx, EmailKey, principal.Email)
	values := []struct {
		key   contextKey
		value string
	}{
		{WorkspaceIDKey, principal.WorkspaceID},
		{SessionIDKey, principal.SessionID},
		{TokenIDKey, principal.TokenID},
		{ClientIDKey, principal.ClientID},
		{ClientNameKey, principal.ClientName},
		{ScopeKey, principal.Scope},
		{InstallationIDKey, principal.InstallationID},
		{DelegatedScopesKey, principal.DelegatedScopes},
	}
	for _, value := range values {
		if value.value != "" {
			ctx = huma.WithValue(ctx, value.key, value.value)
		}
	}
	return ctx
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

func GetInstallationID(ctx context.Context) string {
	if v, ok := ctx.Value(InstallationIDKey).(string); ok {
		return v
	}
	return ""
}

func GetDelegatedScopes(ctx context.Context) string {
	if v, ok := ctx.Value(DelegatedScopesKey).(string); ok {
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
		browserOrigin := strings.TrimSpace(ctx.Header("Origin"))
		if browserOrigin == "" && ctx.Header("Sec-Fetch-Site") != "" {
			browserOrigin = "browser"
		}
		ctx = huma.WithValue(ctx, OriginKey, browserOrigin)
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

func JWTMiddleware(authService *auth.Service) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			authHeader := c.Request().Header.Get("Authorization")
			if authHeader == "" {
				return echoUnauthorized(c, "missing authorization header")
			}

			tokenParts := strings.Split(authHeader, " ")
			if len(tokenParts) != 2 || tokenParts[0] != bearerPrefix {
				return echoUnauthorized(c, "invalid authorization header format")
			}

			claims, err := authService.ValidateToken(tokenParts[1])
			if err != nil {
				return echoUnauthorized(c, "invalid or expired token")
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
				return echoUnauthorized(c, "missing authorization header")
			}
			if cookieAuth && !cookieRequestAllowed(c.Request().Method, c.Request().Header.Get("Origin"), c.Request().Host, c.Scheme()) {
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
				return echoUnauthorized(c, "invalid or expired token")
			}
			if SessionOriginRejected(principal, c.Request().Header.Get("Origin"), c.Request().Host, c.Scheme()) {
				return c.JSON(http.StatusForbidden, map[string]string{string(errorKey): "cross-site session request rejected"})
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
	if principal.InstallationID != "" {
		c.Set(string(InstallationIDKey), principal.InstallationID)
		requestCtx = context.WithValue(requestCtx, InstallationIDKey, principal.InstallationID)
	}
	if principal.DelegatedScopes != "" {
		c.Set(string(DelegatedScopesKey), principal.DelegatedScopes)
		requestCtx = context.WithValue(requestCtx, DelegatedScopesKey, principal.DelegatedScopes)
	}
	c.SetRequest(c.Request().WithContext(requestCtx))
}

func isAuthenticationUnavailable(err error) bool {
	return errors.Is(err, errAuthenticationUnavailable) ||
		errors.Is(err, context.Canceled) ||
		errors.Is(err, context.DeadlineExceeded)
}

func authenticationUnavailableError(err error) error {
	return fmt.Errorf("%w: %w", errAuthenticationUnavailable, err)
}

func isInvalidSessionError(err error) bool {
	return errors.Is(err, sessions.ErrInvalidSession) ||
		errors.Is(err, sessions.ErrExpiredSession) ||
		errors.Is(err, sessions.ErrRevokedSession)
}

func isInvalidAPITokenError(err error) bool {
	return errors.Is(err, apitokens.ErrInvalidToken) ||
		errors.Is(err, apitokens.ErrExpiredToken) ||
		errors.Is(err, apitokens.ErrRevokedToken)
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

func requestScheme(ctx huma.Context) string {
	if ctx.TLS() != nil || strings.EqualFold(ctx.Header("X-Forwarded-Proto"), "https") {
		return "https"
	}
	return "http"
}

func SessionOriginRejected(principal *Principal, origin, host, scheme string) bool {
	return principal != nil && (principal.SessionID != "" || principal.Scope == "") && origin != "" && !cookieRequestAllowed(http.MethodPost, origin, host, scheme)
}

func HasBrowserOrigin(ctx context.Context) bool {
	origin, _ := ctx.Value(OriginKey).(string)
	return origin != ""
}

func cookieRequestAllowed(method, origin, host string, schemes ...string) bool {
	if origin == "" {
		return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
	}
	originURL, err := url.Parse(strings.TrimSpace(origin))
	if err != nil || originURL.Host == "" || originURL.User != nil || originURL.RawQuery != "" || originURL.Fragment != "" || originURL.Path != "" {
		return false
	}
	scheme := "https"
	if len(schemes) > 0 {
		scheme = schemes[0]
	}
	return strings.EqualFold(originURL.Scheme, scheme) && strings.EqualFold(originURL.Host, strings.TrimSpace(host))
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
