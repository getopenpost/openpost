package handlers

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/netguard"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/apitokens"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/drafts"
	engagementservice "github.com/openpost/backend/internal/services/engagement"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicationauth"
	publicationservice "github.com/openpost/backend/internal/services/publications"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/uptrace/bun"
)

const (
	mcpProtocolVersion    = "2025-06-18"
	mcpFallbackVersion    = "2025-03-26"
	mcpToolSearch         = "search_operations"
	mcpToolQuery          = "query_operation"
	mcpToolExecute        = "execute_operation"
	mcpLegacyToolSearch   = "search"
	mcpLegacyToolQuery    = "query"
	mcpLegacyToolExecute  = "execute"
	mcpToolWorkspaces     = "list_workspaces"
	mcpToolProviders      = "list_provider_catalog"
	mcpToolAccounts       = "list_accounts"
	mcpToolListMedia      = "list_media"
	mcpToolReadiness      = "get_provider_readiness"
	mcpToolCreatePub      = "create_publication"
	mcpToolListPubs       = "list_publications"
	mcpToolGetPub         = "get_publication"
	mcpToolUpdatePub      = "update_publication"
	mcpToolPubRenditions  = "set_publication_renditions"
	mcpToolReplyRendition = "reply_to_rendition"
	mcpToolValidatePub    = "validate_publication"
	mcpToolSchedulePub    = "schedule_publication"
	mcpToolCancelPub      = "cancel_publication"
	mcpToolPublishPubNow  = "publish_publication_now"
	mcpToolPubEvents      = "list_publication_events"
	mcpToolComments       = "list_rendition_comments"
	mcpToolReplyComment   = "reply_to_comment"
	mcpToolHideComment    = "hide_comment"
	mcpToolDeleteComment  = "delete_comment"
	mcpToolSuggestSlot    = "suggest_next_slot"
	mcpToolUploadURL      = "upload_media_from_url"
	mcpToolRenderWidget   = "render_scheduler_widget"
	mcpPromptPlanPost     = "plan_social_post"
	mcpPromptRenditions   = "adapt_platform_renditions"
	mcpPromptReviewQueue  = "review_schedule"
	mcpScopeRead          = apitokens.ScopeMCPRead
	mcpScopeFull          = apitokens.ScopeMCP
	maxRemoteMediaBytes   = 50 * 1024 * 1024
	maxMCPRequestBytes    = 2 * 1024 * 1024
	mcpAppWidgetURI       = "ui://widget/openpost-scheduler-v1.html"
	mcpAppWidgetMimeType  = "text/html;profile=mcp-app"
)

type MCPHandler struct {
	db                *bun.DB
	auth              middleware.Authenticator
	entitlement       entitlements.Service
	usage             *usage.Service
	mediaStorage      mediastore.BlobStorage
	mediaURLHTTP      *http.Client
	mediaURLValidator func(context.Context, *url.URL) error
	publicURL         string
	allowedOrigins    map[string]bool
	providers         map[string]platform.Adapter
	dynamicMastodon   bool
	tokenEncryptor    *servicecrypto.TokenEncryptor
	tokenSource       AccessTokenSource
	readiness         *providerreadiness.Service
	serverVersion     string
	featureGate       engagementservice.FeatureGate
}

func NewMCPHandler(db *bun.DB, authenticator middleware.Authenticator, entitlement ...entitlements.Service) *MCPHandler {
	platform.RegisterAllMediaValidators()
	entitlementService := entitlements.Service(entitlements.NewSelfHostedService())
	if len(entitlement) > 0 && entitlement[0] != nil {
		entitlementService = entitlement[0]
	}
	return &MCPHandler{
		db:            db,
		auth:          authenticator,
		entitlement:   entitlementService,
		usage:         usage.NewService(db),
		serverVersion: "dev",
	}
}

func (h *MCPHandler) SetServerVersion(version string) {
	version = strings.TrimSpace(version)
	if version == "" {
		version = "dev"
	}
	h.serverVersion = version
}

func (h *MCPHandler) SetMediaStorage(storage mediastore.BlobStorage) {
	h.mediaStorage = storage
}

func (h *MCPHandler) SetMediaURLHTTPClient(client *http.Client) {
	h.mediaURLHTTP = client
}

func (h *MCPHandler) SetMediaURLValidator(validator func(context.Context, *url.URL) error) {
	h.mediaURLValidator = validator
}

func (h *MCPHandler) SetPublicURL(publicURL string) {
	h.publicURL = strings.TrimRight(publicURL, "/")
}

func (h *MCPHandler) SetAllowedOrigins(origins []string) {
	h.allowedOrigins = make(map[string]bool, len(origins))
	for _, origin := range origins {
		if normalized := normalizeMCPOrigin(origin); normalized != "" {
			h.allowedOrigins[normalized] = true
		}
	}
}

func (h *MCPHandler) SetProviderCatalog(providers map[string]platform.Adapter, dynamicMastodon bool) {
	h.providers = providers
	h.dynamicMastodon = dynamicMastodon
}

func (h *MCPHandler) SetTokenEncryptor(encryptor *servicecrypto.TokenEncryptor) {
	h.tokenEncryptor = encryptor
}

func (h *MCPHandler) SetTokenSource(source AccessTokenSource) {
	h.tokenSource = source
}

func (h *MCPHandler) SetProviderReadiness(service *providerreadiness.Service) {
	h.readiness = service
}

func (h *MCPHandler) SetFeatureGate(g engagementservice.FeatureGate) {
	h.featureGate = g
}

func (h *MCPHandler) publicationHandler() *PublicationHandler {
	handler := NewPublicationHandler(h.db, nil, h.entitlement)
	if h.usage != nil {
		handler.SetUsage(h.usage)
	}
	handler.providers = h.providers
	handler.tokenSource = h.tokenSource
	handler.readiness = h.readiness
	return handler
}

func (h *MCPHandler) RegisterRoutes(e *echo.Echo) {
	e.POST("/mcp", h.handle)
	e.GET("/mcp", h.handleStreamGetUnsupported)
	e.GET("/.well-known/oauth-protected-resource", h.protectedResourceMetadata)
}

type mcpRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type mcpResponse struct {
	JSONRPC string    `json:"jsonrpc"`
	ID      any       `json:"id,omitempty"`
	Result  any       `json:"result,omitempty"`
	Error   *mcpError `json:"error,omitempty"`
}

type mcpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type mcpContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type mcpHTTPFailure struct {
	status int
	body   any
}

var errMCPInsufficientScope = errors.New("insufficient MCP scope")

func (h *MCPHandler) handle(c echo.Context) error {
	if failure := h.mcpPreflightFailure(c.Request()); failure != nil {
		return c.JSON(failure.status, failure.body)
	}
	principal, err := h.authenticate(c.Request())
	if err != nil {
		challenge := h.mcpWWWAuthenticate(c.Request())
		status := http.StatusUnauthorized
		responseError := "unauthorized"
		if errors.Is(err, errMCPInsufficientScope) {
			status = http.StatusForbidden
			responseError = "insufficient_scope"
			challenge += `, error="insufficient_scope"`
		}
		c.Response().Header().Set("WWW-Authenticate", challenge)
		return c.JSON(status, map[string]any{
			fieldError: responseError,
			"_meta": map[string]any{
				"mcp/www_authenticate": challenge,
			},
		})
	}
	req, body, failure := readMCPRequest(c)
	if failure != nil {
		return c.JSON(failure.status, failure.body)
	}
	return h.processMCPRequest(c, principal, req, body)
}

func (h *MCPHandler) mcpPreflightFailure(request *http.Request) *mcpHTTPFailure {
	if !h.mcpOriginAllowed(request) {
		return &mcpHTTPFailure{status: http.StatusForbidden, body: mcpResponse{
			JSONRPC: "2.0", Error: &mcpError{Code: -32000, Message: "request Origin is not allowed for this MCP server"},
		}}
	}
	contentType := strings.TrimSpace(strings.Split(request.Header.Get(echo.HeaderContentType), ";")[0])
	if contentType != echo.MIMEApplicationJSON {
		return &mcpHTTPFailure{status: http.StatusUnsupportedMediaType, body: mcpResponse{
			JSONRPC: "2.0", Error: &mcpError{Code: -32600, Message: "Content-Type must be application/json"},
		}}
	}
	return nil
}

func readMCPRequest(c echo.Context) (mcpRequest, []byte, *mcpHTTPFailure) {
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, maxMCPRequestBytes)
	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return mcpRequest{}, nil, &mcpHTTPFailure{status: http.StatusRequestEntityTooLarge, body: mcpResponse{
				JSONRPC: "2.0", Error: &mcpError{Code: -32600, Message: fmt.Sprintf("MCP request body exceeds %d-byte limit", maxMCPRequestBytes)},
			}}
		}
		return mcpRequest{}, nil, &mcpHTTPFailure{status: http.StatusBadRequest, body: mcpResponse{
			JSONRPC: "2.0", Error: &mcpError{Code: -32700, Message: "parse error"},
		}}
	}
	var req mcpRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return req, body, &mcpHTTPFailure{status: http.StatusBadRequest, body: mcpResponse{
			JSONRPC: "2.0", Error: &mcpError{Code: -32700, Message: "parse error"},
		}}
	}
	return req, body, nil
}

func (h *MCPHandler) processMCPRequest(c echo.Context, principal *middleware.Principal, req mcpRequest, body []byte) error {
	if req.JSONRPC != "2.0" || req.Method == "" {
		return c.JSON(http.StatusOK, mcpResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &mcpError{Code: -32600, Message: "invalid request"},
		})
	}
	if req.Method != "initialize" {
		if versionErr := validateMCPProtocolVersionHeader(c.Request()); versionErr != nil {
			return c.JSON(http.StatusBadRequest, mcpResponse{JSONRPC: "2.0", ID: req.ID, Error: versionErr})
		}
	}
	if !mcpRequestHasID(body) {
		if rpcErr := h.acceptNotification(req); rpcErr != nil {
			return c.JSON(http.StatusBadRequest, mcpResponse{
				JSONRPC: "2.0",
				Error:   rpcErr,
			})
		}
		return c.NoContent(http.StatusAccepted)
	}
	protocolVersion := mcpProtocolVersion
	if req.Method == "initialize" {
		var versionErr *mcpError
		protocolVersion, versionErr = negotiateMCPProtocolVersion(req.Params)
		if versionErr != nil {
			return c.JSON(http.StatusOK, mcpResponse{JSONRPC: "2.0", ID: req.ID, Error: versionErr})
		}
	}
	result, rpcErr := h.dispatch(c.Request().Context(), principal, req, protocolVersion)
	resp := mcpResponse{JSONRPC: "2.0", ID: req.ID}
	if rpcErr != nil {
		resp.Error = rpcErr
	} else {
		resp.Result = result
	}
	return c.JSON(http.StatusOK, resp)
}

func (h *MCPHandler) handleStreamGetUnsupported(c echo.Context) error {
	if !h.mcpOriginAllowed(c.Request()) {
		return c.NoContent(http.StatusForbidden)
	}
	c.Response().Header().Set(echo.HeaderAllow, http.MethodPost)
	return c.NoContent(http.StatusMethodNotAllowed)
}

func (h *MCPHandler) mcpOriginAllowed(r *http.Request) bool {
	origin := normalizeMCPOrigin(r.Header.Get(echo.HeaderOrigin))
	if origin == "" {
		return strings.TrimSpace(r.Header.Get(echo.HeaderOrigin)) == ""
	}
	if origin == normalizeMCPOrigin(h.externalBaseURL(r)) {
		return true
	}
	return h.allowedOrigins[origin]
}

func normalizeMCPOrigin(raw string) string {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	if raw == "" || raw == "*" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil {
		return ""
	}
	if parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return ""
	}
	return strings.ToLower(parsed.Scheme) + "://" + strings.ToLower(parsed.Host)
}

func validateMCPProtocolVersionHeader(r *http.Request) *mcpError {
	version := strings.TrimSpace(r.Header.Get("MCP-Protocol-Version"))
	if version == "" {
		version = mcpFallbackVersion
	}
	if mcpProtocolVersionSupported(version) {
		return nil
	}
	return &mcpError{
		Code:    -32600,
		Message: fmt.Sprintf("unsupported MCP-Protocol-Version %q; supported versions are %s and %s", version, mcpProtocolVersion, mcpFallbackVersion),
	}
}

func negotiateMCPProtocolVersion(raw json.RawMessage) (string, *mcpError) {
	var params struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	if err := json.Unmarshal(raw, &params); err != nil || strings.TrimSpace(params.ProtocolVersion) == "" {
		return "", &mcpError{Code: -32602, Message: "initialize params must include protocolVersion"}
	}
	requested := strings.TrimSpace(params.ProtocolVersion)
	if mcpProtocolVersionSupported(requested) {
		return requested, nil
	}
	return mcpProtocolVersion, nil
}

func mcpProtocolVersionSupported(version string) bool {
	return version == mcpProtocolVersion || version == mcpFallbackVersion
}

func (h *MCPHandler) protectedResourceMetadata(c echo.Context) error {
	baseURL := h.externalBaseURL(c.Request())
	resource := baseURL + "/mcp"
	return c.JSON(http.StatusOK, map[string]any{
		"resource":                 resource,
		"authorization_servers":    []string{baseURL},
		"scopes_supported":         []string{mcpScopeRead, mcpScopeFull},
		"bearer_methods_supported": []string{"header"},
		"resource_name":            "OpenPost MCP",
	})
}

func (h *MCPHandler) externalBaseURL(r *http.Request) string {
	return requestBaseURL(r, h.publicURL)
}

func requestBaseURL(r *http.Request, publicURL string) string {
	if publicURL != "" {
		return strings.TrimRight(publicURL, "/")
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if forwardedProto := r.Header.Get("X-Forwarded-Proto"); forwardedProto != "" {
		scheme = strings.Split(forwardedProto, ",")[0]
	}
	host := r.Host
	if forwardedHost := r.Header.Get("X-Forwarded-Host"); forwardedHost != "" {
		host = strings.Split(forwardedHost, ",")[0]
	}
	return strings.TrimRight(scheme+"://"+strings.TrimSpace(host), "/")
}

func (h *MCPHandler) mcpWWWAuthenticate(r *http.Request) string {
	baseURL := requestBaseURL(r, h.publicURL)
	return fmt.Sprintf(`Bearer realm="OpenPost MCP", resource_metadata="%s/.well-known/oauth-protected-resource", scope="%s"`, baseURL, mcpScopeFull)
}

func (h *MCPHandler) authenticate(r *http.Request) (*middleware.Principal, error) {
	authHeader := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(authHeader, "Bearer ")
	if !ok || strings.TrimSpace(token) == "" {
		return nil, fmt.Errorf("missing bearer token")
	}
	principal, err := h.auth.AuthenticateBearer(r.Context(), token)
	if err != nil {
		return nil, err
	}
	if principal.Audience != "" && strings.TrimRight(principal.Audience, "/") != h.externalBaseURL(r)+"/mcp" {
		return nil, fmt.Errorf("api token audience %q cannot access this mcp resource", principal.Audience)
	}
	if !mcpScopeAllowed(principal.Scope) {
		return nil, fmt.Errorf("%w: api token scope %q cannot access mcp", errMCPInsufficientScope, principal.Scope)
	}
	return principal, nil
}

func mcpScopeAllowed(scope string) bool {
	switch strings.TrimSpace(scope) {
	case "", apitokens.ScopeCLI, apitokens.ScopeMCPRead, apitokens.ScopeMCP:
		return true
	default:
		return false
	}
}

func mcpScopeIsReadOnly(scope string) bool {
	return strings.TrimSpace(scope) == apitokens.ScopeMCPRead
}

func mcpInstructions(scope string) string {
	const base = "OpenPost schedules social posts and format-first publications through a compact safety-aware tool surface. Call search_operations with a plain-language task to discover relevant operation names and schemas. Call query_operation only for guaranteed read-only operations. Search again when required fields are unclear. Use render_scheduler_widget directly when a visual summary helps. All delegated operations retain the same authorization, workspace scoping, schema validation, quota, and audit controls."
	if mcpScopeIsReadOnly(scope) {
		return base + " This connection is read-only: mutation operations are hidden from discovery and rejected by the server."
	}
	return base + " Call execute_operation only for operations that change state or interact with external systems, and only after the user approves the mutation."
}

type mcpWorkspaceScopeContextKey struct{}

func contextWithMCPPrincipal(ctx context.Context, principal *middleware.Principal) context.Context {
	if principal == nil {
		return ctx
	}
	ctx = context.WithValue(ctx, middleware.UserIDKey, principal.UserID)
	ctx = context.WithValue(ctx, middleware.EmailKey, principal.Email)
	if principal.WorkspaceID != "" {
		ctx = context.WithValue(ctx, middleware.WorkspaceIDKey, principal.WorkspaceID)
	}
	if principal.SessionID != "" {
		ctx = context.WithValue(ctx, middleware.SessionIDKey, principal.SessionID)
	}
	if principal.TokenID != "" {
		ctx = context.WithValue(ctx, middleware.TokenIDKey, principal.TokenID)
	}
	if principal.ClientID != "" {
		ctx = context.WithValue(ctx, middleware.ClientIDKey, principal.ClientID)
	}
	if principal.ClientName != "" {
		ctx = context.WithValue(ctx, middleware.ClientNameKey, principal.ClientName)
	}
	if principal.Scope != "" {
		ctx = context.WithValue(ctx, middleware.ScopeKey, principal.Scope)
	}
	return ctx
}

func contextWithMCPWorkspaceScope(ctx context.Context, workspaceID string) context.Context {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return ctx
	}
	return context.WithValue(ctx, mcpWorkspaceScopeContextKey{}, workspaceID)
}

func mcpWorkspaceScopeFromContext(ctx context.Context) string {
	if workspaceID, ok := ctx.Value(mcpWorkspaceScopeContextKey{}).(string); ok {
		return strings.TrimSpace(workspaceID)
	}
	return ""
}

func mcpRequestHasID(body []byte) bool {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return false
	}
	_, ok := raw["id"]
	return ok
}

func (h *MCPHandler) acceptNotification(req mcpRequest) *mcpError {
	if req.JSONRPC != "2.0" || strings.TrimSpace(req.Method) == "" {
		return &mcpError{Code: -32600, Message: "invalid notification"}
	}
	if strings.HasPrefix(req.Method, "notifications/") {
		return nil
	}
	return &mcpError{Code: -32600, Message: "notifications must use notifications/* methods"}
}

func (h *MCPHandler) dispatch(ctx context.Context, principal *middleware.Principal, req mcpRequest, protocolVersion string) (any, *mcpError) {
	ctx = contextWithMCPPrincipal(ctx, principal)
	ctx = contextWithMCPWorkspaceScope(ctx, principal.WorkspaceID)
	switch req.Method {
	case "initialize":
		return map[string]any{
			"protocolVersion": protocolVersion,
			"serverInfo": map[string]string{
				"name":    "openpost",
				"version": h.serverVersion,
			},
			"instructions": mcpInstructions(principal.Scope),
			"capabilities": map[string]any{
				"tools":     map[string]any{"listChanged": false},
				"prompts":   map[string]any{"listChanged": false},
				"resources": map[string]any{"listChanged": false},
			},
		}, nil
	case "ping":
		return map[string]any{}, nil
	case "tools/list":
		return map[string]any{"tools": mcpAdvertisedToolsForScope(principal.Scope)}, nil
	case "resources/list":
		return h.listMCPResources(), nil
	case "resources/read":
		return h.readMCPResource(req.Params)
	case "prompts/list":
		return map[string]any{"prompts": mcpPromptsForScope(principal.Scope)}, nil
	case "prompts/get":
		return mcpGetPrompt(req.Params, mcpScopeIsReadOnly(principal.Scope))
	case "tools/call":
		return h.callTool(ctx, principal, req.Params)
	default:
		return nil, &mcpError{Code: -32601, Message: "method not found"}
	}
}

func mcpPromptsForScope(scope string) []map[string]any {
	if mcpScopeIsReadOnly(scope) {
		return []map[string]any{mcpReviewSchedulePrompt()}
	}
	return []map[string]any{
		mcpPlanSocialPostPrompt(),
		mcpAdaptPlatformRenditionsPrompt(),
		mcpReviewSchedulePrompt(),
	}
}

func mcpPlanSocialPostPrompt() map[string]any {
	return map[string]any{
		"name":        mcpPromptPlanPost,
		"title":       "Plan a publication",
		"description": "Turn an idea into a workspace-aware OpenPost Publication draft.",
		"arguments": []map[string]any{
			{"name": "idea", "description": "The source idea, note, link, or rough content to develop.", "required": true},
			{"name": "workspace_id", "description": "Optional workspace ID if already known.", "required": false},
			{"name": "platforms", "description": "Optional comma-separated destination platforms to consider.", "required": false},
		},
	}
}

func mcpAdaptPlatformRenditionsPrompt() map[string]any {
	return map[string]any{
		"name":        mcpPromptRenditions,
		"title":       "Adapt platform renditions",
		"description": "Rewrite a Publication in draft or scheduled state into platform-native destination copy.",
		"arguments": []map[string]any{
			{"name": "workspace_id", "description": "Workspace ID that owns the Publication.", "required": true},
			{"name": "publication_id", "description": "Draft or scheduled Publication ID to adapt.", "required": true},
			{"name": "goal", "description": "Optional campaign goal, audience, or tone guidance.", "required": false},
		},
	}
}

func mcpReviewSchedulePrompt() map[string]any {
	return map[string]any{
		"name":        mcpPromptReviewQueue,
		"title":       "Review publishing queue",
		"description": "Inspect upcoming scheduled Publications and recommend useful next actions.",
		"arguments": []map[string]any{
			{"name": "workspace_id", "description": "Workspace ID to inspect.", "required": true},
			{"name": "window", "description": "Optional time window, such as today, this week, or next 14 days.", "required": false},
		},
	}
}

func mcpGetPrompt(raw json.RawMessage, readOnly ...bool) (any, *mcpError) {
	var params struct {
		Name      string            `json:"name"`
		Arguments map[string]string `json:"arguments"`
	}
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid prompt params"}
	}
	if len(readOnly) > 0 && readOnly[0] && params.Name != mcpPromptReviewQueue {
		return nil, &mcpError{Code: -32602, Message: "this prompt requires mcp:full because it creates or changes OpenPost data"}
	}
	switch params.Name {
	case mcpPromptPlanPost:
		return mcpPromptResult("Plan an OpenPost Publication draft from an idea.", mcpPlanPostPromptText(params.Arguments)), nil
	case mcpPromptRenditions:
		return mcpPromptResult("Adapt a Publication into platform-native renditions.", mcpRenditionsPromptText(params.Arguments)), nil
	case mcpPromptReviewQueue:
		return mcpPromptResult("Review the scheduled publishing queue.", mcpReviewQueuePromptText(params.Arguments)), nil
	default:
		return nil, &mcpError{Code: -32602, Message: "unknown prompt"}
	}
}

func (h *MCPHandler) listMCPResources() any {
	return map[string]any{
		"resources": []map[string]any{{
			"uri":         mcpAppWidgetURI,
			"name":        "openpost_scheduler",
			"title":       "OpenPost Scheduler",
			"description": "Renders OpenPost workspaces, accounts, media, Publications, Renditions, schedules, and provider status in ChatGPT.",
			"mimeType":    mcpAppWidgetMimeType,
			"_meta":       h.mcpAppWidgetResourceMeta(),
		}},
	}
}

func (h *MCPHandler) readMCPResource(raw json.RawMessage) (any, *mcpError) {
	var params struct {
		URI string `json:"uri"`
	}
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid resource params"}
	}
	if params.URI != mcpAppWidgetURI {
		return nil, &mcpError{Code: -32602, Message: "unknown resource"}
	}
	return map[string]any{
		"contents": []map[string]any{{
			"uri":      mcpAppWidgetURI,
			"mimeType": mcpAppWidgetMimeType,
			"text":     mcpAppWidgetHTML(),
			"_meta":    h.mcpAppWidgetResourceMeta(),
		}},
	}, nil
}

func (h *MCPHandler) mcpAppWidgetResourceMeta() map[string]any {
	standardCSP, legacyCSP := mcpAppWidgetCSP()
	ui := map[string]any{
		"prefersBorder": true,
		"csp":           standardCSP,
	}
	meta := map[string]any{
		"ui":                         ui,
		"openai/widgetDescription":   "OpenPost scheduler view for workspaces, accounts, media, Publications, Renditions, schedules, and provider status.",
		"openai/widgetPrefersBorder": true,
		"openai/widgetCSP":           legacyCSP,
	}
	if domain := mcpWidgetDomain(h.publicURL); domain != "" {
		meta["openai/widgetDomain"] = domain
		ui["domain"] = domain
	}
	return meta
}

func mcpAppWidgetCSP() (map[string]any, map[string]any) {
	return map[string]any{
			"connectDomains":  []string{},
			"resourceDomains": []string{},
		}, map[string]any{
			"connect_domains":  []string{},
			"resource_domains": []string{},
		}
}

func mcpWidgetDomain(publicURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(publicURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

func mcpAppWidgetHTML() string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenPost Scheduler</title>
<style>
:root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
body { margin: 0; background: #f8fafc; color: #102033; }
.shell { min-height: 100vh; padding: 16px; box-sizing: border-box; }
.panel { border: 1px solid #dce4ee; border-radius: 10px; background: #fff; box-shadow: 0 12px 32px rgba(15, 23, 42, .08); overflow: hidden; }
.header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px; border-bottom: 1px solid #e7edf4; background: linear-gradient(135deg, #f7fff9 0%, #ffffff 46%, #f6f8ff 100%); }
.brand { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.eyebrow { color: #0f8f5f; font-size: 11px; font-weight: 750; text-transform: uppercase; letter-spacing: .08em; }
h1 { margin: 0; font-size: 20px; line-height: 1.2; letter-spacing: 0; }
.workspace { color: #5a6b7d; font-size: 12px; white-space: nowrap; }
.content { padding: 14px; display: grid; gap: 10px; }
.grid { display: grid; gap: 10px; }
.card { border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; padding: 12px; display: grid; gap: 8px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid #eef2f7; padding-top: 8px; }
.row:first-child { border-top: 0; padding-top: 0; }
.title { color: #102033; font-size: 14px; font-weight: 750; overflow-wrap: anywhere; }
.muted { color: #64748b; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.pill { display: inline-flex; align-items: center; min-height: 22px; border-radius: 999px; padding: 0 8px; background: #ecfdf5; color: #067647; font-size: 11px; font-weight: 700; white-space: nowrap; }
.warn { background: #fff7ed; color: #b45309; }
.idle { background: #f1f5f9; color: #475569; }
.json { margin: 0; max-height: 280px; overflow: auto; border-radius: 8px; background: #0f172a; color: #e2e8f0; padding: 12px; font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.empty { border: 1px dashed #cbd5e1; border-radius: 8px; padding: 18px; text-align: center; color: #64748b; font-size: 13px; }
@media (min-width: 620px) { .grid.cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
</head>
<body>
<div class="shell"><main class="panel" id="root"><div class="content"><div class="empty">Waiting for OpenPost scheduler data.</div></div></main></div>
<script>
(function () {
  var root = document.getElementById("root");
  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[char];
    });
  }
  function array(value) { return Array.isArray(value) ? value : []; }
  function payloadFromBridge() {
    var bridge = window.openai || {};
    if (bridge.toolOutput) return bridge.toolOutput;
    if (bridge.structuredContent) return bridge.structuredContent;
    if (bridge.response && bridge.response.structuredContent) return bridge.response.structuredContent;
    if (bridge.toolInput) return bridge.toolInput;
    return {};
  }
  function normalizePayload(payload) {
    if (!payload) return {};
    if (payload.structuredContent) return payload.structuredContent;
    if (payload.toolOutput) return payload.toolOutput;
    return payload;
  }
  function inferView(data) {
    if (data.publication) return "publication";
    if (data.publications) return "publications";
    if (data.post) return "post";
    if (data.posts) return "posts";
    if (data.media) return "media";
    if (data.accounts) return "accounts";
    if (data.providers) return "providers";
    if (data.workspaces) return "workspaces";
    if (data.suggestion) return "suggestion";
    if (data.renditions) return "renditions";
    return "summary";
  }
  function statusClass(value) {
    var status = String(value || "").toLowerCase();
    if (status.indexOf("fail") >= 0 || status.indexOf("error") >= 0 || status.indexOf("needs") >= 0) return "pill warn";
    if (!status) return "pill idle";
    return "pill";
  }
  function itemTitle(item) {
    return item.title || item.name || item.content || item.slug || item.original_filename || item.display_name || item.id || "Item";
  }
  function itemStatus(item) {
    return item.status || item.role || item.platform || item.processing_status || item.provider || item.state || "";
  }
  function renderCards(items) {
    if (!items.length) return '<div class="empty">No items to show.</div>';
    return '<div class="grid cards">' + items.map(function (item) {
      var title = escapeHTML(itemTitle(item));
      var status = escapeHTML(itemStatus(item));
      var secondary = item.scheduled_at || item.created_at || item.account_username || item.mime_type || item.description || item.message || "";
      return '<section class="card"><div class="row"><div class="title">' + title + '</div><span class="' + statusClass(status) + '">' + (status || "ready") + '</span></div><div class="muted">' + escapeHTML(secondary) + '</div></section>';
    }).join("") + '</div>';
  }
  function renderPublication(publication) {
    if (!publication) return '<div class="empty">No Publication data to show.</div>';
    var renditions = array(publication.renditions || publication.destinations).map(function (rendition) {
      return '<div class="row"><span class="muted">' + escapeHTML(rendition.platform || rendition.social_account_id || "destination") + '</span><span class="' + statusClass(rendition.status) + '">' + escapeHTML(rendition.status || "pending") + '</span></div>';
    }).join("");
    var media = array(publication.media).map(function (item) {
      return '<div class="row"><span class="muted">' + escapeHTML(item.original_filename || item.media_id || "media") + '</span><span class="pill idle">' + escapeHTML(item.mime_type || "asset") + '</span></div>';
    }).join("");
    var title = publication.title || publication.source_text || publication.content || publication.id || "Publication";
    return '<section class="card"><div class="title">' + escapeHTML(title) + '</div><div class="muted">' + escapeHTML(publication.scheduled_at || publication.created_at || "") + '</div>' + renditions + media + '</section>';
  }
  function renderData(view, data) {
    if (view === "publication") return renderPublication(data.publication);
    if (view === "publications") return renderCards(array(data.publications));
    if (view === "post") return renderPublication(data.post);
    if (view === "posts") return renderCards(array(data.posts));
    if (view === "media") return renderCards(array(data.media));
    if (view === "accounts") return renderCards(array(data.accounts));
    if (view === "providers") return renderCards(array(data.providers));
    if (view === "workspaces") return renderCards(array(data.workspaces));
    if (view === "suggestion") return renderCards(data.suggestion ? [data.suggestion] : []);
    if (view === "renditions") return renderCards(array(data.renditions));
    return '<pre class="json">' + escapeHTML(JSON.stringify(data, null, 2)) + '</pre>';
  }
  function render(payload) {
    var state = normalizePayload(payload);
    var data = state.data || {};
    var view = state.view || inferView(data);
    var title = state.title || "OpenPost Scheduler";
    var workspace = state.workspace_id ? "Workspace " + state.workspace_id : "Agentic social scheduler";
    root.innerHTML = '<header class="header"><div class="brand"><div class="eyebrow">OpenPost</div><h1>' + escapeHTML(title) + '</h1></div><div class="workspace">' + escapeHTML(workspace) + '</div></header><section class="content">' + renderData(view, data) + '</section>';
  }
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var message = event.data || {};
    if (message.jsonrpc === "2.0" && message.method === "ui/notifications/tool-result") {
      render(message.params || {});
      return;
    }
    if (message.jsonrpc === "2.0" && message.method === "ui/notifications/tool-input") {
      render(message.params || {});
      return;
    }
    if (message.structuredContent || message.toolOutput) render(message);
  });
  render(payloadFromBridge());
}());
</script>
</body>
</html>`
}

func mcpPromptResult(description, text string) map[string]any {
	return map[string]any{
		"description": description,
		"messages": []map[string]any{{
			"role": "user",
			"content": map[string]string{
				"type": "text",
				"text": text,
			},
		}},
	}
}

func mcpPlanPostPromptText(args map[string]string) string {
	return strings.TrimSpace(fmt.Sprintf(`
Use OpenPost as an agentic social media scheduler.

Source idea:
%s

Workflow:
1. Call search_operations to load the schemas for list_workspaces, list_provider_catalog, list_accounts, list_media, upload_media_from_url, and create_publication as needed.
2. If workspace_id is missing, call query_operation with list_workspaces and ask which workspace to use.
3. Call query_operation with list_provider_catalog and list_accounts to choose available destinations matching these platform hints: %s.
4. Call query_operation with list_media if the idea needs existing media, or call execute_operation with upload_media_from_url if the user supplied a public media URL.
5. Call execute_operation with create_publication to create one concise draft and relevant media_ids. Do not schedule it until the user approves timing and destinations.
6. Explain what you created and suggest the next scheduling step.

workspace_id: %s
`, promptArg(args, "idea", "(missing idea)"), promptArg(args, "platforms", "any connected platforms"), promptArg(args, "workspace_id", "(choose with list_workspaces)")))
}

func mcpRenditionsPromptText(args map[string]string) string {
	return strings.TrimSpace(fmt.Sprintf(`
Adapt an existing OpenPost Publication into platform-native renditions.

workspace_id: %s
publication_id: %s
goal: %s

Workflow:
1. Call search_operations to load the get_publication and set_publication_renditions schemas.
2. Call query_operation with get_publication to inspect destinations and current state.
3. Write concise, platform-native copy for each destination account.
4. Call execute_operation with set_publication_renditions and one rendition per destination account.
5. Summarize what changed and mention any platforms that need media, hashtags, or shorter copy.
`, promptArg(args, "workspace_id", "(required)"), promptArg(args, "publication_id", "(required)"), promptArg(args, "goal", "match the source Publication and audience")))
}

func mcpReviewQueuePromptText(args map[string]string) string {
	return strings.TrimSpace(fmt.Sprintf(`
Review the OpenPost publishing queue and recommend useful next actions.

workspace_id: %s
window: %s

Workflow:
1. Call search_operations to load the list_publications and suggest_next_slot schemas.
2. Call query_operation with list_publications for the workspace and requested window. Use activity_bucket scheduled and calendar_from or calendar_before when the window can be expressed as timestamps.
3. Look for collisions, empty stretches, missing platform coverage, and Publications that need destination-specific Renditions.
4. Call query_operation with suggest_next_slot if a useful new slot is needed.
5. Recommend concrete actions without canceling or scheduling anything unless the user explicitly asks.
`, promptArg(args, "workspace_id", "(required)"), promptArg(args, "window", "upcoming queue")))
}

func promptArg(args map[string]string, name, fallback string) string {
	if args == nil {
		return fallback
	}
	value := strings.TrimSpace(args[name])
	if value == "" {
		return fallback
	}
	return value
}

func mcpAdvertisedTools() []map[string]any {
	return []map[string]any{
		mcpSearchTool(),
		mcpQueryTool(),
		mcpExecuteTool(),
		mcpRenderSchedulerWidgetTool(),
	}
}

func mcpAdvertisedToolsForScope(scope string) []map[string]any {
	tools := mcpAdvertisedTools()
	if !mcpScopeIsReadOnly(scope) {
		return tools
	}
	readOnlyTools := make([]map[string]any, 0, len(tools)-1)
	for _, tool := range tools {
		if tool["name"] != mcpToolExecute {
			readOnlyTools = append(readOnlyTools, tool)
		}
	}
	return readOnlyTools
}

type mcpOperationMode string

const (
	mcpOperationQuery   mcpOperationMode = mcpToolQuery
	mcpOperationExecute mcpOperationMode = mcpToolExecute
)

type mcpOperationDefinition struct {
	Descriptor map[string]any
	Mode       mcpOperationMode
}

func mcpOperationCatalog() []mcpOperationDefinition {
	return []mcpOperationDefinition{
		mcpListWorkspacesTool(),
		mcpListProviderCatalogTool(),
		mcpListAccountsTool(),
		mcpListMediaTool(),
		mcpProviderReadinessTool(),
		mcpCreatePublicationTool(),
		mcpListPublicationsTool(),
		mcpGetPublicationTool(),
		mcpUpdatePublicationTool(),
		mcpSetPublicationRenditionsTool(),
		mcpReplyToRenditionTool(),
		mcpValidatePublicationTool(),
		mcpSchedulePublicationTool(),
		mcpCancelPublicationTool(),
		mcpPublishPublicationNowTool(),
		mcpListPublicationEventsTool(),
		mcpListRenditionCommentsTool(),
		mcpReplyToCommentTool(),
		mcpHideCommentTool(),
		mcpDeleteCommentTool(),
		mcpSuggestNextSlotTool(),
		mcpUploadMediaFromURLTool(),
	}
}

func mcpSearchTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":  mcpToolSearch,
		"title": "Search OpenPost operations",
		"description": "Search the OpenPost capability catalog before a task when the exact operation or arguments are unknown. " +
			"Returns matching operation names, input and output schemas, safety annotations, and the required query_operation or execute_operation tool.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{
					"type":        "string",
					"description": "Plain-language capability or operation name to find, such as 'create and schedule a video publication' or 'list connected accounts'.",
				},
				"limit": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"maximum":     10,
					"description": "Maximum matching operation definitions to return. Defaults to 5.",
				},
			},
			"required":             []string{"query"},
			"additionalProperties": false,
		},
	}, mcpToolSafety{ReadOnly: true})
}

func mcpQueryTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolQuery,
		"title":       "Query OpenPost",
		"description": "Run one guaranteed read-only operation returned by search_operations; use it to inspect OpenPost without changing state. Returns that operation's structured result and rejects every mutation.",
		"inputSchema": mcpDelegatedOperationInputSchema(
			"Exact read-only operation name returned by search_operations.",
			"Arguments matching the read-only operation input schema returned by search_operations.",
		),
	}, mcpToolSafety{ReadOnly: true, OpenWorld: true})
}

func mcpExecuteTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolExecute,
		"title":       "Execute OpenPost mutation",
		"description": "Run one state-changing or external-action operation returned by search_operations; use it only after mutation approval. Returns that operation's structured result and rejects every read-only operation.",
		"inputSchema": mcpDelegatedOperationInputSchema(
			"Exact state-changing operation name returned by search_operations.",
			"Arguments matching the mutation input schema returned by search_operations.",
		),
	}, mcpToolSafety{Destructive: true, OpenWorld: true})
}

func mcpDelegatedOperationInputSchema(operationDescription, argumentsDescription string) map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"operation": map[string]any{
				"type":        "string",
				"description": operationDescription,
			},
			"arguments": map[string]any{
				"type":                 "object",
				"description":          argumentsDescription,
				"properties":           map[string]any{},
				"additionalProperties": true,
			},
		},
		"required":             []string{"operation", "arguments"},
		"additionalProperties": false,
	}
}

func mcpPrepareInputSchema(schema map[string]any) {
	if schema["type"] != "object" {
		return
	}
	properties, hasProperties := schema["properties"].(map[string]any)
	if !hasProperties {
		return
	}
	if _, ok := schema["required"]; !ok {
		schema["required"] = []string{}
	}
	if _, ok := schema["additionalProperties"]; !ok {
		schema["additionalProperties"] = false
	}
	for name, rawProperty := range properties {
		property, ok := rawProperty.(map[string]any)
		if !ok {
			continue
		}
		mcpPrepareNestedInputSchema(property)
		if _, ok := property["examples"]; !ok {
			if example, ok := mcpInputExample(name, property); ok {
				property["examples"] = []any{example}
			}
		}
	}
}

func mcpPrepareNestedInputSchema(schema map[string]any) {
	switch schema["type"] {
	case "object":
		mcpPrepareInputSchema(schema)
	case "array":
		if items, ok := schema["items"].(map[string]any); ok {
			mcpPrepareNestedInputSchema(items)
		}
	}
}

func mcpInputExample(name string, schema map[string]any) (any, bool) {
	if value, ok := mcpEnumInputExample(schema); ok {
		return value, true
	}
	switch schema["type"] {
	case "string":
		return mcpStringInputExample(name, schema), true
	case "integer":
		return mcpIntegerInputExample(name), true
	case "boolean":
		return true, true
	case "array":
		return mcpArrayInputExample(name, schema)
	case "object":
		return mcpObjectInputExample(name, schema), true
	}
	return nil, false
}

func mcpEnumInputExample(schema map[string]any) (any, bool) {
	if values, ok := schema["enum"].([]string); ok && len(values) > 0 {
		return values[0], true
	}
	if values, ok := schema["enum"].([]any); ok && len(values) > 0 {
		return values[0], true
	}
	return nil, false
}

func mcpIntegerInputExample(name string) int {
	examples := map[string]int{
		"limit": 20, "thumbnail_timestamp_ms": 1500, "random_delay_minutes": 10,
	}
	if example, ok := examples[name]; ok {
		return example
	}
	return 1
}

func mcpArrayInputExample(name string, schema map[string]any) (any, bool) {
	items, ok := schema["items"].(map[string]any)
	if !ok {
		return nil, false
	}
	example, ok := mcpInputExample(strings.TrimSuffix(name, "s"), items)
	if !ok {
		return nil, false
	}
	return []any{example}, true
}

func mcpObjectInputExample(name string, schema map[string]any) map[string]any {
	properties, ok := schema["properties"].(map[string]any)
	if !ok {
		return mcpOpenObjectInputExample(name)
	}
	required := map[string]bool{}
	if names, ok := schema["required"].([]string); ok {
		for _, requiredName := range names {
			required[requiredName] = true
		}
	}
	example := map[string]any{}
	for propertyName, rawProperty := range properties {
		if len(required) > 0 && !required[propertyName] {
			continue
		}
		property, ok := rawProperty.(map[string]any)
		if !ok {
			continue
		}
		if value, ok := mcpInputExample(propertyName, property); ok {
			example[propertyName] = value
		}
	}
	return example
}

func mcpOpenObjectInputExample(name string) map[string]any {
	examples := map[string]map[string]any{
		"arguments": {"workspace_id": "2f4aa6c2-3c8f-4e1f-91ac-43de2c2b67b1"},
		"data":      {"publications": []any{}},
		"metadata":  {"campaign": "spring-launch"},
	}
	if example, ok := examples[name]; ok {
		return example
	}
	return map[string]any{"privacy": "public"}
}

func mcpStringInputExample(name string, schema map[string]any) string {
	if example, ok := mcpStringInputExamples[name]; ok {
		return example
	}
	if schema["format"] == "date-time" {
		return "2026-08-01T09:30:00Z"
	}
	if schema["format"] == "uri" {
		return "https://example.com/resource"
	}
	return "example"
}

var mcpStringInputExamples = map[string]string{
	"workspace_id":      "2f4aa6c2-3c8f-4e1f-91ac-43de2c2b67b1",
	"social_account_id": "7a763db0-7c0f-4a81-b4aa-c4d5b44e786c",
	"publication_id":    "c66d7139-0549-4666-9374-124e988f97e7",
	"rendition_id":      "08ac072f-f39f-4583-8202-53f5ddf47eb6",
	"media_id":          "30454fbe-246c-4d9d-9289-13e2c8df7f1e",
	"comment_id":        "eyJyZW5kaXRpb25faWQiOiIuLi4ifQ",
	"operation":         mcpToolAccounts,
	"query":             "list connected social accounts",
	"content":           "A concise product update for our community.",
	"source_text":       "A concise product update for our community.",
	"body":              "A concise product update for our community.",
	"title":             "Spring launch",
	"description":       "Full product launch details.",
	"goal":              "Increase qualified sign-ups",
	"audience":          "Independent creators",
	"alt_text":          "Product dashboard showing the weekly publishing calendar",
	"filename":          "launch-demo.mp4",
	"role":              "attachment",
	"parent_id":         "provider-comment-123",
	"view":              "publications",
	"profile":           "short_text",
	"content_profile":   "short_text",
	"status":            "draft",
	"filter":            "all",
	"source_url":        "https://example.com/launch",
	"url":               "https://example.com/launch",
	"scheduled_at":      "2026-08-01T09:30:00Z",
	"run_at":            "2026-08-01T09:30:00Z",
	"after":             "2026-08-01T09:30:00Z",
	"from":              "2026-08-01T09:30:00Z",
	"to":                "2026-08-01T09:30:00Z",
}

func mcpListWorkspacesTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolWorkspaces,
		"title":       "List workspaces",
		"description": "List workspaces before any workspace-scoped task when no workspace ID is known. Returns each accessible workspace ID, name, role, and creation time.",
		"inputSchema": map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpListProviderCatalogTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolProviders,
		"title":       "List provider catalog",
		"description": "Inspect the provider catalog before choosing a social platform. Returns each provider's launch status, configuration state, capabilities, and availability notes.",
		"inputSchema": map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpListAccountsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolAccounts,
		"title":       "List social accounts",
		"description": "List connected destinations before drafting or scheduling for a workspace. Returns active social account IDs, platforms, slugs, usernames, and instance URLs.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
			},
			"required":             []string{"workspace_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpListMediaTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolListMedia,
		"title":       "List media",
		"description": "Find existing workspace assets before uploading or attaching media. Returns recent media IDs, file details, processing state, usage, and deletion eligibility.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
				"limit": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"maximum":     100,
					"description": "Maximum media items to return. Defaults to 20.",
				},
				"filter": map[string]any{
					"type":        "string",
					"enum":        []string{"all", "favorites", "used", "unused"},
					"description": "Optional media filter. Defaults to all.",
				},
			},
			"required":             []string{"workspace_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpProviderReadinessTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolReadiness,
		"title":       "Get provider readiness",
		"description": "Check whether configured providers are ready before scheduling or publishing. Returns provider app, account scope, public-media, quota, and audit readiness details.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
			},
			"required":             []string{"workspace_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}
func mcpCreatePublicationTool() mcpOperationDefinition {
	mediaSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"media_id":               map[string]any{"type": "string", "description": "Media attachment ID returned by list_media or upload_media_from_url."},
			"role":                   map[string]any{"type": "string", "description": "Media role such as attachment, cover, or thumbnail."},
			"alt_text":               map[string]any{"type": "string", "description": "Alt text override."},
			"thumbnail_timestamp_ms": map[string]any{"type": "integer", "description": "Video thumbnail timestamp in milliseconds."},
		},
		"required":             []string{"media_id"},
		"additionalProperties": false,
	}
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolCreatePub,
		"title":       "Create publication",
		"description": "Create a format-first publication when one source needs provider-specific outputs, such as a YouTube title and TikTok caption. Returns the publication ID, profile, state, schedule, and rendition count.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{"type": "string", "description": "Workspace ID returned by list_workspaces."},
				"content_profile": map[string]any{
					"type":        "string",
					"description": "OpenPost content profile: short_text, thread, link_share, image_post, carousel, story, short_video, or long_video.",
					"enum":        []string{"short_text", "thread", "link_share", "image_post", "carousel", "story", "short_video", "long_video"},
				},
				"title":       map[string]any{"type": "string", "description": "Internal publication title."},
				"source_text": map[string]any{"type": "string", "description": "Canonical source text. Compute from description, caption, or title; do not expose this term to users."},
				"source_url":  map[string]any{"type": "string", "description": "Optional source URL for link shares."},
				"scheduled_at": map[string]any{
					"type":        "string",
					"format":      "date-time",
					"description": "Optional desired schedule time. Call schedule_publication after create_publication to validate and enqueue.",
				},
				"random_delay_minutes": map[string]any{
					"type": "integer", "minimum": 0, "maximum": 60,
					"description": "Optional random schedule delay in minutes (±N). Omit to inherit the Workspace setting when scheduled.",
				},
				"social_account_ids": map[string]any{
					"type":        "array",
					"description": "Destination account IDs returned by list_accounts. Used to create default renditions when renditions is omitted.",
					"items":       map[string]any{"type": "string"},
				},
				"media_ids": map[string]any{
					"type":        "array",
					"description": "Optional simple media attachment IDs. Prefer media when role, alt text, or thumbnail timestamp matters.",
					"items":       map[string]any{"type": "string"},
				},
				"media": map[string]any{
					"type":        "array",
					"description": "Default ordered media used by renditions that do not provide their own media.",
					"items":       mediaSchema,
				},
				"renditions": map[string]any{
					"type":        "array",
					"description": "Explicit account/provider outputs. Use fields by output role: body/caption as body, YouTube title as title, YouTube description as description, provider settings such as privacy.",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"social_account_id": map[string]any{"type": "string", "description": "Destination account ID."},
							"profile":           map[string]any{"type": "string", "description": "Optional content profile override."},
							"body":              map[string]any{"type": "string", "description": "Post text or caption output."},
							"title":             map[string]any{"type": "string", "description": "Provider title output, especially YouTube video title."},
							"description":       map[string]any{"type": "string", "description": "Provider description output, especially YouTube video description."},
							"settings": map[string]any{
								"type":                 "object",
								"description":          "Provider-specific settings such as YouTube privacy, TikTok privacy_level, link_url, or post_type.",
								"additionalProperties": true,
							},
							"media": map[string]any{
								"type":        "array",
								"description": "Rendition-specific ordered media.",
								"items":       mediaSchema,
							},
						},
						"required":             []string{"social_account_id"},
						"additionalProperties": false,
					},
				},
			},
			"required":             []string{"workspace_id", "content_profile", "source_text"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, false, false)
}

func mcpListPublicationsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolListPubs,
		"title":       "List publications",
		"description": "Find format-first publications before reading, editing, validating, or scheduling one. Returns matching publication summaries in newest-first order.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id":    map[string]any{"type": "string", "description": "Workspace ID returned by list_workspaces."},
				"status":          map[string]any{"type": "string", "description": "Optional publication status filter."},
				"content_profile": map[string]any{"type": "string", "description": "Optional content profile filter."},
				"platform":        map[string]any{"type": "string", "description": "Optional destination platform filter, such as x, linkedin, or youtube."},
				"calendar_from":   map[string]any{"type": "string", "format": "date-time", "description": "Include calendar occurrences at or after this RFC3339 timestamp."},
				"calendar_before": map[string]any{"type": "string", "format": "date-time", "description": "Include calendar occurrences before this RFC3339 timestamp."},
				"activity_bucket": map[string]any{"type": "string", "enum": []string{"scheduled", "published", "failed", "draft"}, "description": "Optional calendar-compatible activity bucket."},
				"limit":           map[string]any{"type": "integer", "minimum": 1, "maximum": 100, "description": "Maximum publications to return. Defaults to 20."},
			},
			"required":             []string{"workspace_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpGetPublicationTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name": mcpToolGetPub, "title": "Get publication",
		"description": "Read one format-first publication when its full source and destination state is needed. Returns the publication, ordered media, renditions, and delivery fields.",
		"inputSchema": mcpPublicationIDSchema(),
	}, mcpOperationQuery, false, false)
}

func mcpUpdatePublicationTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name": mcpToolUpdatePub, "title": "Update publication",
		"description": "Edit a publication's source fields or proposed schedule while preserving omitted values. Returns the updated publication and does not enqueue it for publishing.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"publication_id": map[string]any{"type": "string", "description": "Publication ID returned by create_publication or list_publications."},
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_publication. Reload the publication after a conflict before retrying.",
				},
				"title": map[string]any{"type": "string", "description": "Optional replacement internal title used to identify the publication."},
				"content_profile": map[string]any{
					"type": "string", "description": "Optional replacement OpenPost content profile.",
					"enum": []string{"short_text", "thread", "link_share", "image_post", "carousel", "story", "short_video", "long_video"},
				},
				"source_text": map[string]any{"type": "string", "description": "Optional replacement canonical source copy used to derive destination outputs."},
				"source_url":  map[string]any{"type": "string", "format": "uri", "description": "Optional replacement absolute source URL, such as https://example.com/launch."},
				"goal":        map[string]any{"type": "string", "description": "Optional replacement publishing goal used as planning context."},
				"audience":    map[string]any{"type": "string", "description": "Optional replacement audience description used as planning context."},
				"scheduled_at": map[string]any{
					"type": "string", "format": "date-time", "description": "Optional replacement future schedule as an RFC3339 timestamp, such as 2026-08-01T09:30:00Z.",
				},
				"clear_schedule": map[string]any{
					"type":        "boolean",
					"description": "Clear the saved schedule and cancel its pending publication job. Do not combine with scheduled_at.",
				},
				"random_delay_minutes": map[string]any{
					"type": "integer", "minimum": 0, "maximum": 60,
					"description": "Optional replacement random schedule delay in minutes (±N).",
				},
				"inherit_random_delay": map[string]any{
					"type": "boolean", "description": "Use the current Workspace random-delay setting when this Publication is scheduled.",
				},
				"metadata": map[string]any{"type": "object", "description": "Optional replacement application metadata, e.g. {\"campaign\":\"spring-launch\"}.", "additionalProperties": true},
			},
			"required": []string{"publication_id", "expected_revision"}, "additionalProperties": false,
		},
	}, mcpOperationExecute, false, false)
}

func mcpSetPublicationRenditionsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name": mcpToolPubRenditions, "title": "Set publication renditions",
		"description": "Replace every destination output after publication accounts, provider fields, media roles, or captions change. Returns the publication with its complete replacement rendition set.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"publication_id": map[string]any{"type": "string", "description": "Publication ID returned by create_publication or list_publications."},
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_publication. Reload the publication after a conflict before retrying.",
				},
				"renditions": map[string]any{
					"type": "array", "minItems": 1,
					"description": "Complete replacement list of destination-specific publication outputs.",
					"items":       mcpPublicationRenditionSchema(),
				},
			},
			"required": []string{"publication_id", "expected_revision", "renditions"}, "additionalProperties": false,
		},
	}, mcpOperationExecute, false, false)
}

func mcpReplyToRenditionTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name": mcpToolReplyRendition, "title": "Reply to rendition",
		"description": "Queue a reply to an already published provider rendition, either now or at a future time. Returns the updated publication status and durable reply job ID.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"rendition_id": map[string]any{"type": "string", "description": "Published rendition ID returned by get_publication."},
				"body":         map[string]any{"type": "string", "description": "Reply text sent to the rendition's provider thread."},
				"parent_id":    map[string]any{"type": "string", "description": "Optional provider-native parent reply ID when replying below a specific reply."},
				"run_at": map[string]any{
					"type": "string", "format": "date-time", "description": "Optional future RFC3339 execution time, such as 2026-08-01T09:30:00Z. Omit to queue immediately.",
				},
				"settings": map[string]any{"type": "object", "description": "Optional provider reply settings, e.g. {\"visibility\":\"public\"}.", "additionalProperties": true},
				"media": map[string]any{
					"type": "array", "description": "Optional ordered media attachments for the reply.", "items": mcpPublicationMediaSchema(),
				},
			},
			"required": []string{"rendition_id", "body"}, "additionalProperties": false,
		},
	}, mcpOperationExecute, false, true)
}

func mcpPublicationIDSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"publication_id": map[string]any{"type": "string", "description": "Publication ID returned by create_publication or list_publications."},
		},
		"required": []string{"publication_id"}, "additionalProperties": false,
	}
}

func mcpPublicationMediaSchema() map[string]any {
	return map[string]any{
		"type": "object", "properties": map[string]any{
			"media_id": map[string]any{"type": "string", "description": "Media attachment ID returned by list_media or upload_media_from_url."},
			"role": map[string]any{
				"type": "string", "enum": []string{"attachment", "cover", "thumbnail"},
				"description": "Media purpose within the provider output.",
			},
			"alt_text":               map[string]any{"type": "string", "description": "Optional accessible text override for this use of the media."},
			"thumbnail_timestamp_ms": map[string]any{"type": "integer", "minimum": 0, "description": "Optional video thumbnail position in milliseconds from the start."},
		}, "required": []string{"media_id"}, "additionalProperties": false,
	}
}

func mcpPublicationRenditionSchema() map[string]any {
	return map[string]any{
		"type": "object", "properties": map[string]any{
			"id":                map[string]any{"type": "string", "description": "Optional existing rendition ID when replacing a previously stored output."},
			"social_account_id": map[string]any{"type": "string", "description": "Destination account ID returned by list_accounts."},
			"profile": map[string]any{
				"type": "string", "description": "Optional content profile override for this destination.",
				"enum": []string{"short_text", "thread", "link_share", "image_post", "carousel", "story", "short_video", "long_video"},
			},
			"body":        map[string]any{"type": "string", "description": "Provider-native post text or caption."},
			"title":       map[string]any{"type": "string", "description": "Provider-native title, especially for YouTube videos."},
			"description": map[string]any{"type": "string", "description": "Provider-native long description, especially for YouTube videos."},
			"settings":    map[string]any{"type": "object", "description": "Provider settings, e.g. {\"privacy\":\"public\"}.", "additionalProperties": true},
			"media":       map[string]any{"type": "array", "description": "Ordered media attachments for this destination output.", "items": mcpPublicationMediaSchema()},
		}, "required": []string{"social_account_id"}, "additionalProperties": false,
	}
}

func mcpValidatePublicationTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolValidatePub,
		"title":       "Validate publication",
		"description": "Validate a publication before scheduling or immediate publishing. Returns a valid flag plus actionable provider, media, account-scope, and processing issues.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"publication_id": map[string]any{"type": "string", "description": "Publication ID returned by create_publication or list_publications."},
			},
			"required":             []string{"publication_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpSchedulePublicationTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolSchedulePub,
		"title":       "Schedule publication",
		"description": "Validate and enqueue a publication after its future scheduled_at value is set. Returns the scheduled publication state and durable publishing job ID.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"publication_id": map[string]any{"type": "string", "description": "Publication ID returned by create_publication or list_publications."},
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_publication after the schedule time was saved.",
				},
				"execution_intent": map[string]any{
					"type": "string", "enum": []string{"production", "certification_test"},
					"description": "Optional typed readiness intent for this enqueue action. certification_test is restricted to an unscoped instance administrator.",
				},
			},
			"required":             []string{"publication_id", "expected_revision"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, false, true)
}

func mcpCancelPublicationTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolCancelPub,
		"title":       "Cancel publication",
		"description": "Cancel a scheduled publication and its pending durable delivery work.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"publication_id": map[string]any{"type": "string", "description": "Scheduled Publication ID."},
				"expected_revision": map[string]any{
					"type": "integer", "minimum": 1,
					"description": "Revision returned by get_publication immediately before cancellation.",
				},
			},
			"required": []string{"publication_id", "expected_revision"}, "additionalProperties": false,
		},
	}, mcpOperationExecute, false, true)
}

func mcpPublishPublicationNowTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolPublishPubNow,
		"title":       "Publish publication now",
		"description": "Validate and queue a publication when it should publish as soon as a worker is available. Returns the queued publication state and durable publishing job ID.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"publication_id": map[string]any{"type": "string", "description": "Publication ID returned by create_publication or list_publications."},
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_publication immediately before publishing.",
				},
				"execution_intent": map[string]any{
					"type": "string", "enum": []string{"production", "certification_test"},
					"description": "Optional typed readiness intent for this enqueue action. certification_test is restricted to an unscoped instance administrator.",
				},
			},
			"required":             []string{"publication_id", "expected_revision"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, false, true)
}

func mcpListPublicationEventsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolPubEvents,
		"title":       "List publication events",
		"description": "Inspect publication history when diagnosing delivery, retry, or moderation state. Returns ordered lifecycle events with status, message, metadata, and timestamps.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"publication_id": map[string]any{"type": "string", "description": "Publication ID returned by create_publication or list_publications."},
				"limit":          map[string]any{"type": "integer", "minimum": 1, "maximum": 200, "description": "Maximum events to return. Defaults to 100."},
			},
			"required":             []string{"publication_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpListRenditionCommentsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolComments,
		"title":       "List rendition comments",
		"description": "Read live comments before replying to or moderating a published rendition. Returns provider comments with opaque OpenPost comment IDs safe for follow-up actions.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"rendition_id": map[string]any{"type": "string", "description": "Rendition ID from a publication's destination-specific output."},
			},
			"required":             []string{"rendition_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, true)
}

func mcpReplyToCommentTool() mcpOperationDefinition {
	return mcpCommentActionTool(mcpToolReplyComment, "Reply to comment", "Queue a durable one-attempt provider reply after selecting an opaque ID from list_rendition_comments. Returns a confirmation message and job ID.", true, false)
}

func mcpHideCommentTool() mcpOperationDefinition {
	return mcpCommentActionTool(mcpToolHideComment, "Hide comment", "Queue a durable one-attempt hide action when moderation is supported and removal is not required. Returns a confirmation message and job ID.", false, true)
}

func mcpDeleteCommentTool() mcpOperationDefinition {
	return mcpCommentActionTool(mcpToolDeleteComment, "Delete comment", "Queue a durable one-attempt deletion of a provider comment only when irreversible moderation is intended. Returns a confirmation message and job ID.", false, true)
}

func mcpCommentActionTool(name, title, description string, requiresBody, destructive bool) mcpOperationDefinition {
	properties := map[string]any{"comment_id": map[string]any{"type": "string", "description": "Opaque comment ID returned by list_rendition_comments."}}
	required := []string{"comment_id"}
	if requiresBody {
		properties["body"] = map[string]any{"type": "string", "description": "Reply text to send to the provider comment."}
		required = append(required, "body")
	}
	return mcpOperationDescriptor(map[string]any{
		"name": name, "title": title, "description": description,
		"inputSchema": map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false},
	}, mcpOperationExecute, destructive, true)
}
func mcpSuggestNextSlotTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolSuggestSlot,
		"title":       "Suggest next slot",
		"description": "Find a free configured time before scheduling when the user has not chosen an exact timestamp. Returns the proposed slot, timezone, and matched schedule rule.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
				"after": map[string]any{
					"type":        "string",
					"format":      "date-time",
					"description": "Optional RFC3339 lower bound. Defaults to the current time.",
				},
			},
			"required":             []string{"workspace_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpUploadMediaFromURLTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolUploadURL,
		"title":       "Upload media from URL",
		"description": "Import an externally hosted asset when it is not already in the workspace media library. Returns the stored media ID, file metadata, processing state, and URLs.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
				"url": map[string]any{
					"type":        "string",
					"format":      "uri",
					"description": "Public http(s) URL to fetch.",
				},
				"filename": map[string]any{
					"type":        "string",
					"description": "Optional filename to store for display and extension detection.",
				},
				"alt_text": map[string]any{
					"type":        "string",
					"description": "Optional accessible alt text for the media.",
				},
			},
			"required":             []string{"workspace_id", "url"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, false, true)
}

func mcpRenderSchedulerWidgetTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolRenderWidget,
		"title":       "Render scheduler widget",
		"description": "Render structured results as an interactive scheduler view when a visual summary helps. Returns the chosen view, title, workspace ID, and unchanged data for the Apps widget.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"view": map[string]any{
					"type":        "string",
					"description": "Widget view to render. Defaults to a view inferred from the data keys.",
					"enum":        mcpSchedulerWidgetViews(),
				},
				"title": map[string]any{
					"type":        "string",
					"description": "Optional title shown at the top of the widget.",
				},
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Optional workspace ID for the rendered data.",
				},
				"data": map[string]any{
					"type":                 "object",
					"description":          "Structured data returned by another OpenPost MCP tool.",
					"additionalProperties": true,
				},
			},
			"required":             []string{"data"},
			"additionalProperties": false,
		},
	}, mcpToolSafety{ReadOnly: true})
}

type mcpToolSafety struct {
	ReadOnly    bool
	Destructive bool
	OpenWorld   bool
}

func mcpOperationDescriptor(tool map[string]any, mode mcpOperationMode, destructive, openWorld bool) mcpOperationDefinition {
	switch mode {
	case mcpOperationQuery:
		if destructive {
			panic("read-only MCP operations cannot be destructive")
		}
	case mcpOperationExecute:
	default:
		panic("invalid MCP operation mode: " + mode)
	}
	return mcpOperationDefinition{
		Descriptor: mcpToolDescriptor(tool, mcpToolSafety{
			ReadOnly:    mode == mcpOperationQuery,
			Destructive: destructive,
			OpenWorld:   openWorld,
		}),
		Mode: mode,
	}
}

func mcpToolDescriptor(tool map[string]any, safety mcpToolSafety) map[string]any {
	securitySchemes := []map[string]any{mcpOAuthSecurityScheme(safety.ReadOnly)}
	toolName, _ := tool["name"].(string)
	if inputSchema, ok := tool["inputSchema"].(map[string]any); ok {
		mcpPrepareInputSchema(inputSchema)
	}
	tool["securitySchemes"] = securitySchemes
	outputSchema := mcpToolOutputSchema(toolName)
	tool["outputSchema"] = outputSchema
	ensureMCPDescriptionStatesOutput(tool, outputSchema)
	tool["annotations"] = map[string]any{
		"readOnlyHint":    safety.ReadOnly,
		"destructiveHint": safety.Destructive,
		"openWorldHint":   safety.OpenWorld,
	}
	status := mcpToolInvocationStatus(toolName)
	meta := map[string]any{
		"securitySchemes":                securitySchemes,
		"openai/toolInvocation/invoking": status.Invoking,
		"openai/toolInvocation/invoked":  status.Invoked,
	}
	if mcpToolUsesAppWidget(toolName) {
		meta["ui"] = map[string]any{
			"resourceUri": mcpAppWidgetURI,
			"visibility":  []string{"model"},
		}
		meta["openai/outputTemplate"] = mcpAppWidgetURI
		meta["openai/widgetAccessible"] = false
	}
	tool["_meta"] = meta
	return tool
}

func ensureMCPDescriptionStatesOutput(tool, outputSchema map[string]any) {
	description, _ := tool["description"].(string)
	if strings.Contains(strings.ToLower(description), "return") {
		return
	}
	required, _ := outputSchema["required"].([]string)
	output := "structured operation data"
	if len(required) > 0 {
		output = strings.Join(required, ", ")
	}
	tool["description"] = strings.TrimSpace(description) + " Returns " + output + " in the structured result."
}

func mcpToolUsesAppWidget(toolName string) bool {
	return toolName == mcpToolRenderWidget
}

type mcpToolStatus struct {
	Invoking string
	Invoked  string
}

var mcpToolStatuses = map[string]mcpToolStatus{
	mcpToolSearch:         {Invoking: "Searching operations", Invoked: "Operations found"},
	mcpToolQuery:          {Invoking: "Querying OpenPost", Invoked: "OpenPost query complete"},
	mcpToolExecute:        {Invoking: "Running OpenPost mutation", Invoked: "OpenPost mutation complete"},
	mcpToolWorkspaces:     {Invoking: "Loading workspaces", Invoked: "Workspaces loaded"},
	mcpToolProviders:      {Invoking: "Loading providers", Invoked: "Providers loaded"},
	mcpToolAccounts:       {Invoking: "Loading accounts", Invoked: "Accounts loaded"},
	mcpToolListMedia:      {Invoking: "Loading media", Invoked: "Media loaded"},
	mcpToolReadiness:      {Invoking: "Checking provider readiness", Invoked: "Provider readiness loaded"},
	mcpToolCreatePub:      {Invoking: "Creating publication", Invoked: "Publication created"},
	mcpToolListPubs:       {Invoking: "Loading publications", Invoked: "Publications loaded"},
	mcpToolGetPub:         {Invoking: "Loading publication", Invoked: "Publication loaded"},
	mcpToolUpdatePub:      {Invoking: "Updating publication", Invoked: "Publication updated"},
	mcpToolPubRenditions:  {Invoking: "Updating publication outputs", Invoked: "Publication outputs updated"},
	mcpToolReplyRendition: {Invoking: "Queueing reply", Invoked: "Reply queued"},
	mcpToolValidatePub:    {Invoking: "Validating publication", Invoked: "Publication validated"},
	mcpToolSchedulePub:    {Invoking: "Scheduling publication", Invoked: "Publication scheduled"},
	mcpToolCancelPub:      {Invoking: "Cancelling publication", Invoked: "Publication cancelled"},
	mcpToolPublishPubNow:  {Invoking: "Queueing publication", Invoked: "Publication queued"},
	mcpToolPubEvents:      {Invoking: "Loading publication events", Invoked: "Publication events loaded"},
	mcpToolComments:       {Invoking: "Loading comments", Invoked: "Comments loaded"},
	mcpToolReplyComment:   {Invoking: "Queueing comment reply", Invoked: "Comment reply queued"},
	mcpToolHideComment:    {Invoking: "Queueing comment hide", Invoked: "Comment hide queued"},
	mcpToolDeleteComment:  {Invoking: "Queueing comment deletion", Invoked: "Comment deletion queued"},
	mcpToolSuggestSlot:    {Invoking: "Finding next slot", Invoked: "Next slot found"},
	mcpToolUploadURL:      {Invoking: "Uploading media", Invoked: "Media uploaded"},
	mcpToolRenderWidget:   {Invoking: "Rendering view", Invoked: "View rendered"},
}

func mcpToolInvocationStatus(toolName string) mcpToolStatus {
	if status, ok := mcpToolStatuses[toolName]; ok {
		return status
	}
	return mcpToolStatus{Invoking: "Running tool", Invoked: "Tool complete"}
}

func mcpToolOutputSchema(toolName string) map[string]any {
	if key, ok := mcpArrayOutputKey(toolName); ok {
		return mcpStructuredOutputSchema(map[string]any{
			key: mcpArraySchema(mcpOpenObjectSchema()),
		}, key)
	}
	switch toolName {
	case mcpToolCreatePub, mcpToolGetPub, mcpToolUpdatePub, mcpToolPubRenditions, mcpToolCancelPub:
		return mcpStructuredOutputSchema(map[string]any{
			"publication": mcpOpenObjectSchema(),
		}, "publication")
	case mcpToolSchedulePub, mcpToolPublishPubNow, mcpToolReplyRendition:
		return mcpStructuredOutputSchema(map[string]any{
			"publication": mcpOpenObjectSchema(),
			"job_id":      map[string]any{"type": "string"},
		}, "publication", "job_id")
	case mcpToolReplyComment, mcpToolHideComment, mcpToolDeleteComment:
		return mcpStructuredOutputSchema(map[string]any{
			"message": map[string]any{"type": "string"}, "id": map[string]any{"type": "string"},
		}, "message")
	case mcpToolValidatePub:
		return mcpStructuredOutputSchema(map[string]any{
			"valid":  map[string]any{"type": "boolean"},
			"issues": mcpArraySchema(mcpOpenObjectSchema()),
		}, "valid", "issues")
	case mcpToolSuggestSlot:
		return mcpStructuredOutputSchema(map[string]any{
			"suggestion": mcpOpenObjectSchema(),
		}, "suggestion")
	case mcpToolUploadURL:
		return mcpStructuredOutputSchema(map[string]any{
			"media": mcpOpenObjectSchema(),
		}, "media")
	case mcpToolRenderWidget:
		return mcpStructuredOutputSchema(map[string]any{
			"view":         map[string]any{"type": "string", "enum": mcpSchedulerWidgetViews()},
			"title":        map[string]any{"type": "string"},
			"workspace_id": map[string]any{"type": "string"},
			"data":         mcpOpenObjectSchema(),
		}, "view", "data")
	case mcpToolQuery, mcpToolExecute:
		return mcpOpenObjectSchema()
	default:
		return mcpStructuredOutputSchema(map[string]any{})
	}
}

func mcpArrayOutputKey(toolName string) (string, bool) {
	switch toolName {
	case mcpToolSearch:
		return "operations", true
	case mcpToolWorkspaces:
		return "workspaces", true
	case mcpToolProviders, mcpToolReadiness:
		return "providers", true
	case mcpToolAccounts:
		return "accounts", true
	case mcpToolListMedia:
		return "media", true
	case mcpToolListPubs:
		return "publications", true
	case mcpToolPubEvents:
		return "events", true
	case mcpToolComments:
		return "comments", true
	default:
		return "", false
	}
}

func mcpStructuredOutputSchema(properties map[string]any, required ...string) map[string]any {
	return map[string]any{
		"type":                 "object",
		"properties":           properties,
		"required":             required,
		"additionalProperties": false,
	}
}

func mcpArraySchema(items map[string]any) map[string]any {
	return map[string]any{
		"type":  "array",
		"items": items,
	}
}

func mcpOpenObjectSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"properties":           map[string]any{},
		"required":             []string{},
		"additionalProperties": true,
	}
}

func mcpOAuthSecurityScheme(readOnly bool) map[string]any {
	scopes := []string{mcpScopeFull}
	if readOnly {
		scopes = []string{mcpScopeRead, mcpScopeFull}
	}
	return map[string]any{
		"type":   "oauth2",
		"scopes": scopes,
	}
}

type mcpOperationMatch struct {
	index int
	score int
	doc   map[string]any
}

func searchMCPOperations(args map[string]any, allowedModes ...mcpOperationMode) (any, *mcpError) {
	var input struct {
		Query string `json:"query"`
		Limit int    `json:"limit"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid search arguments"}
	}
	input.Query = strings.TrimSpace(input.Query)
	if input.Query == "" {
		return nil, &mcpError{Code: -32602, Message: "query is required"}
	}
	if input.Limit == 0 {
		input.Limit = 5
	}
	if input.Limit < 1 || input.Limit > 10 {
		return nil, &mcpError{Code: -32602, Message: "limit must be between 1 and 10"}
	}

	query := strings.ToLower(input.Query)
	terms := mcpSearchTerms(query)
	matches := make([]mcpOperationMatch, 0, input.Limit)
	for index, operation := range mcpOperationCatalog() {
		if !mcpOperationModeAllowed(operation.Mode, allowedModes) {
			continue
		}
		doc := mcpOperationDocument(operation)
		name, _ := doc["name"].(string)
		title, _ := doc["title"].(string)
		description, _ := doc["description"].(string)
		schema, _ := json.Marshal(map[string]any{
			"input":  doc["inputSchema"],
			"output": doc["outputSchema"],
		})
		score := mcpOperationSearchScore(query, terms, strings.ToLower(name), strings.ToLower(title), strings.ToLower(description), strings.ToLower(string(schema)))
		if score > 0 {
			matches = append(matches, mcpOperationMatch{index: index, score: score, doc: doc})
		}
	}
	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].score == matches[j].score {
			return matches[i].index < matches[j].index
		}
		return matches[i].score > matches[j].score
	})
	if len(matches) > input.Limit {
		matches = matches[:input.Limit]
	}
	operations := make([]map[string]any, 0, len(matches))
	for _, match := range matches {
		operations = append(operations, match.doc)
	}
	message := fmt.Sprintf("Found %d OpenPost operation(s) for %q.", len(operations), input.Query)
	if len(operations) == 0 {
		message = "No matching OpenPost operations found. Try a focused capability phrase such as 'draft', 'scheduled publication', 'media', or 'connected accounts'."
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: message}},
		"structuredContent": map[string]any{
			"operations": operations,
		},
	}, nil
}

func mcpOperationModeAllowed(mode mcpOperationMode, allowed []mcpOperationMode) bool {
	if len(allowed) == 0 {
		return true
	}
	for _, candidate := range allowed {
		if mode == candidate {
			return true
		}
	}
	return false
}

func mcpOperationDocument(operation mcpOperationDefinition) map[string]any {
	tool := operation.Descriptor
	return map[string]any{
		"name":          tool["name"],
		"title":         tool["title"],
		"description":   tool["description"],
		"inputSchema":   tool["inputSchema"],
		"outputSchema":  tool["outputSchema"],
		"annotations":   tool["annotations"],
		"executionTool": string(operation.Mode),
	}
}

func mcpSearchTerms(query string) []string {
	stopWords := map[string]bool{
		"a": true, "an": true, "and": true, "for": true, "in": true, "my": true,
		"of": true, "openpost": true, "or": true, "the": true, "to": true, "with": true,
		"all": true, "any": true, "are": true, "be": true, "by": true, "can": true,
		"could": true, "from": true, "is": true, "it": true, "its": true, "me": true,
		"need": true, "on": true, "please": true, "that": true, "this": true,
		"want": true, "would": true,
	}
	parts := strings.FieldsFunc(query, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_'
	})
	terms := make([]string, 0, len(parts))
	for _, part := range parts {
		if !stopWords[part] {
			terms = append(terms, part)
		}
	}
	if len(terms) == 0 {
		return parts
	}
	return terms
}

func mcpOperationSearchScore(query string, terms []string, name, title, description, schema string) int {
	if query == name {
		return 1000
	}
	if !mcpOperationSearchRelevant(terms, name, title, description, schema) {
		return 0
	}
	score := 0
	if strings.Contains(name, query) {
		score += 200
	}
	if strings.Contains(title, query) {
		score += 100
	}
	if strings.Contains(description, query) {
		score += 50
	}
	for _, term := range terms {
		switch {
		case strings.Contains(name, term):
			score += 20
		case strings.Contains(title, term):
			score += 10
		case strings.Contains(description, term):
			score += 5
		case strings.Contains(schema, term):
			score++
		}
	}
	return score
}

func mcpOperationSearchRelevant(terms []string, name, title, description, schema string) bool {
	queryActions := make(map[string]bool)
	meaningfulTerms := make([]string, 0, len(terms))
	for _, term := range terms {
		if action := mcpSearchAction(term); action != "" {
			queryActions[action] = true
			continue
		}
		if !mcpSearchGenericTerm(term) {
			meaningfulTerms = append(meaningfulTerms, term)
		}
	}

	operationAction := mcpSearchAction(strings.SplitN(name, "_", 2)[0])
	if len(queryActions) > 0 && !queryActions[operationAction] {
		return false
	}
	// A bare action such as "delete" does not identify an OpenPost object. Refusing
	// it is safer than guessing a state-changing operation from the verb alone.
	if len(meaningfulTerms) == 0 {
		return false
	}

	document := name + " " + title + " " + description + " " + schema
	matched := 0
	for _, term := range meaningfulTerms {
		if strings.Contains(document, term) {
			matched++
		}
	}
	requiredMatches := len(meaningfulTerms)
	if requiredMatches >= 3 {
		requiredMatches = (requiredMatches*2 + 2) / 3
	}
	return matched >= requiredMatches
}

func mcpSearchAction(term string) string {
	switch term {
	case "find", "get", "inspect", "list", "read", "review", "search", "show":
		return "read"
	case "create", "make":
		return "create"
	case "edit", "set", "update":
		return "update"
	case "remove", "delete":
		return "delete"
	case "respond", "reply":
		return "reply"
	case "check", "validate":
		return "validate"
	case "recommend", "suggest":
		return "suggest"
	case "cancel", "hide", "publish", "render", "schedule", "upload":
		return term
	default:
		return ""
	}
}

func mcpSearchGenericTerm(term string) bool {
	switch term {
	case "data", "detail", "details", "id", "info", "information", "item", "items",
		"operation", "operations", "result", "results", "status", "tool", "tools":
		return true
	default:
		return false
	}
}

type mcpToolCallParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

func (h *MCPHandler) callTool(ctx context.Context, principal *middleware.Principal, raw json.RawMessage) (any, *mcpError) {
	params, rpcErr := parseMCPToolCallParams(raw)
	if rpcErr != nil {
		return nil, rpcErr
	}
	canonicalName := canonicalMCPToolName(params.Name)
	auditToolName, auditArgs := mcpToolAuditTarget(canonicalName, params.Arguments)
	start := time.Now()
	if mcpScopeIsReadOnly(principal.Scope) && mcpToolCallChangesState(canonicalName) {
		rpcErr := &mcpError{Code: -32602, Message: "this token has mcp:read scope and cannot run state-changing operations; authorize mcp:full access to make changes"}
		h.recordToolCall(ctx, principal, auditToolName, workspaceIDFromMCPArguments(auditArgs), time.Since(start), rpcErr)
		return nil, rpcErr
	}
	if rpcErr := validateMCPToolArguments(canonicalName, params.Arguments); rpcErr != nil {
		h.recordToolCall(ctx, principal, auditToolName, workspaceIDFromMCPArguments(auditArgs), time.Since(start), rpcErr)
		return nil, rpcErr
	}
	ctx = publicationauth.WithActor(ctx, publicationauth.Actor{
		Origin: publicationauth.OriginMCP, UserID: principal.UserID,
		SessionID: principal.SessionID, TokenID: principal.TokenID,
		ClientID: principal.ClientID, ClientName: principal.ClientName,
	})
	result, auditToolName, auditArgs, rpcErr := h.executeMCPTool(ctx, principal.UserID, principal.Scope, canonicalName, params.Arguments)
	if rpcErr == nil {
		rpcErr = validateMCPResult(canonicalName, auditToolName, result)
	}
	h.recordToolCall(ctx, principal, auditToolName, workspaceIDFromMCPArguments(auditArgs), time.Since(start), rpcErr)
	return result, rpcErr
}

func mcpToolCallChangesState(canonicalName string) bool {
	if canonicalName == mcpToolExecute {
		return true
	}
	if operation, ok := mcpOperationByName(canonicalName); ok {
		return operation.Mode == mcpOperationExecute
	}
	return false
}

func parseMCPToolCallParams(raw json.RawMessage) (mcpToolCallParams, *mcpError) {
	var params mcpToolCallParams
	if err := json.Unmarshal(raw, &params); err != nil {
		return params, &mcpError{Code: -32602, Message: "invalid tools/call params: name must be a string and arguments must be an object"}
	}
	params.Name = strings.TrimSpace(params.Name)
	if params.Name == "" {
		return params, &mcpError{Code: -32602, Message: "name is required in tools/call params"}
	}
	if params.Arguments == nil {
		params.Arguments = map[string]any{}
	}
	return params, nil
}

func mcpToolAuditTarget(canonicalName string, arguments map[string]any) (string, map[string]any) {
	auditToolName := canonicalName
	auditArgs := arguments
	if canonicalName == mcpToolQuery || canonicalName == mcpToolExecute {
		if operationName, ok := arguments["operation"].(string); ok && strings.TrimSpace(operationName) != "" {
			auditToolName = strings.TrimSpace(operationName)
		}
		if operationArgs, ok := arguments["arguments"].(map[string]any); ok {
			auditArgs = operationArgs
		}
	}
	return auditToolName, auditArgs
}

func (h *MCPHandler) executeMCPTool(ctx context.Context, userID, scope, canonicalName string, arguments map[string]any) (any, string, map[string]any, *mcpError) {
	auditToolName, auditArgs := mcpToolAuditTarget(canonicalName, arguments)
	var (
		result any
		rpcErr *mcpError
	)
	switch canonicalName {
	case mcpToolSearch:
		if mcpScopeIsReadOnly(scope) {
			result, rpcErr = searchMCPOperations(arguments, mcpOperationQuery)
		} else {
			result, rpcErr = searchMCPOperations(arguments)
		}
	case mcpToolQuery, mcpToolExecute:
		var input mcpDelegatedOperationInput
		if err := decodeMCPArguments(arguments, &input); err != nil {
			rpcErr = &mcpError{Code: -32602, Message: fmt.Sprintf("invalid %s arguments: %v", canonicalName, err)}
			break
		}
		input.Operation = strings.TrimSpace(input.Operation)
		auditToolName = input.Operation
		auditArgs = input.Arguments
		result, rpcErr = h.callDiscoveredMCPOperation(ctx, userID, mcpOperationMode(canonicalName), input.Operation, input.Arguments)
	default:
		// Keep previously advertised operation names callable for clients that
		// cached the legacy tool catalog before progressive discovery shipped.
		result, rpcErr = h.callMCPOperation(ctx, userID, canonicalName, arguments)
	}
	return result, auditToolName, auditArgs, rpcErr
}

func validateMCPResult(canonicalName, auditToolName string, result any) *mcpError {
	outputToolName := canonicalName
	if canonicalName == mcpToolQuery || canonicalName == mcpToolExecute {
		outputToolName = auditToolName
	}
	if outputErr := validateMCPToolOutput(outputToolName, result); outputErr != nil {
		log.Printf("MCP tool %s returned invalid structured output: %s", outputToolName, outputErr.Message)
		return &mcpError{Code: -32603, Message: "tool returned structured output that does not match its advertised output schema"}
	}
	return nil
}

func canonicalMCPToolName(name string) string {
	switch name {
	case mcpLegacyToolSearch:
		return mcpToolSearch
	case mcpLegacyToolQuery:
		return mcpToolQuery
	case mcpLegacyToolExecute:
		return mcpToolExecute
	default:
		return name
	}
}

func validateMCPToolArguments(toolName string, args map[string]any) *mcpError {
	tool, ok := mcpToolByName(toolName)
	if !ok {
		return &mcpError{Code: -32602, Message: fmt.Sprintf("unknown tool %q; call %s to discover supported operations", toolName, mcpToolSearch)}
	}
	inputSchema, ok := tool["inputSchema"].(map[string]any)
	if !ok {
		return &mcpError{Code: -32603, Message: fmt.Sprintf("tool %s has no valid input schema", toolName)}
	}
	if rpcErr := validateMCPValueAgainstSchema(toolName+" arguments", inputSchema, args, huma.ModeWriteToServer); rpcErr != nil {
		return rpcErr
	}
	if toolName != mcpToolQuery && toolName != mcpToolExecute {
		return nil
	}
	operationName, _ := args["operation"].(string)
	operation, ok := mcpOperationByName(strings.TrimSpace(operationName))
	if !ok {
		return &mcpError{Code: -32602, Message: fmt.Sprintf("unknown operation %q; call %s to discover supported operations", operationName, mcpToolSearch)}
	}
	expectedMode := mcpOperationMode(toolName)
	if operation.Mode != expectedMode {
		if operation.Mode == mcpOperationQuery {
			return &mcpError{Code: -32602, Message: fmt.Sprintf("%s is read-only; call %s with this operation", operationName, mcpToolQuery)}
		}
		return &mcpError{Code: -32602, Message: fmt.Sprintf("%s changes state or performs an external action; call %s with this operation", operationName, mcpToolExecute)}
	}
	operationArgs, _ := args["arguments"].(map[string]any)
	operationSchema, _ := operation.Descriptor["inputSchema"].(map[string]any)
	return validateMCPValueAgainstSchema(operationName+" arguments", operationSchema, operationArgs, huma.ModeWriteToServer)
}

func mcpToolByName(name string) (map[string]any, bool) {
	for _, tool := range mcpAdvertisedTools() {
		if tool["name"] == name {
			return tool, true
		}
	}
	if operation, ok := mcpOperationByName(name); ok {
		return operation.Descriptor, true
	}
	return nil, false
}

func validateMCPToolOutput(toolName string, result any) *mcpError {
	tool, ok := mcpToolByName(toolName)
	if !ok {
		return &mcpError{Code: -32603, Message: fmt.Sprintf("unknown output schema for tool %s", toolName)}
	}
	outputSchema, ok := tool["outputSchema"].(map[string]any)
	if !ok {
		return &mcpError{Code: -32603, Message: fmt.Sprintf("tool %s has no valid output schema", toolName)}
	}
	normalized, err := normalizeMCPJSONValue(result)
	if err != nil {
		return &mcpError{Code: -32603, Message: fmt.Sprintf("tool %s result is not JSON encodable", toolName)}
	}
	resultMap, ok := normalized.(map[string]any)
	if !ok {
		return &mcpError{Code: -32603, Message: fmt.Sprintf("tool %s result must be an object", toolName)}
	}
	structured, ok := resultMap["structuredContent"].(map[string]any)
	if !ok {
		return &mcpError{Code: -32603, Message: fmt.Sprintf("tool %s result is missing structuredContent", toolName)}
	}
	return validateMCPValueAgainstSchema(toolName+" output", outputSchema, structured, huma.ModeReadFromServer)
}

func normalizeMCPJSONValue(value any) (any, error) {
	payload, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var normalized any
	if err := json.Unmarshal(payload, &normalized); err != nil {
		return nil, err
	}
	return normalized, nil
}

func validateMCPValueAgainstSchema(label string, rawSchema map[string]any, value any, mode huma.ValidateMode) *mcpError {
	payload, err := json.Marshal(rawSchema)
	if err != nil {
		return &mcpError{Code: -32603, Message: fmt.Sprintf("failed to encode %s schema", label)}
	}
	var schema huma.Schema
	if err := json.Unmarshal(payload, &schema); err != nil {
		return &mcpError{Code: -32603, Message: fmt.Sprintf("failed to load %s schema", label)}
	}
	schema.PrecomputeMessages()
	result := &huma.ValidateResult{}
	path := huma.NewPathBuffer(make([]byte, 0, 128), 0)
	huma.Validate(huma.NewMapRegistry("#/components/schemas/", huma.DefaultSchemaNamer), &schema, path, mode, value, result)
	if len(result.Errors) == 0 {
		return nil
	}
	detail, ok := result.Errors[0].(*huma.ErrorDetail)
	if !ok {
		return &mcpError{Code: -32602, Message: fmt.Sprintf("invalid %s: %s", label, result.Errors[0])}
	}
	message := detail.Message
	if detail.Location != "" {
		message = detail.Location + ": " + message
	}
	return &mcpError{Code: -32602, Message: fmt.Sprintf("invalid %s: %s", label, message)}
}

type mcpDelegatedOperationInput struct {
	Operation string         `json:"operation"`
	Arguments map[string]any `json:"arguments"`
}

func mcpOperationByName(name string) (mcpOperationDefinition, bool) {
	for _, operation := range mcpOperationCatalog() {
		operationName, _ := operation.Descriptor["name"].(string)
		if operationName == name {
			return operation, true
		}
	}
	return mcpOperationDefinition{}, false
}

func (h *MCPHandler) callDiscoveredMCPOperation(ctx context.Context, userID string, mode mcpOperationMode, operationName string, args map[string]any) (any, *mcpError) {
	operation, ok := mcpOperationByName(operationName)
	if !ok {
		return nil, &mcpError{Code: -32602, Message: fmt.Sprintf("unknown operation %q; call %s to discover supported operations", operationName, mcpToolSearch)}
	}
	if operation.Mode != mode {
		if operation.Mode == mcpOperationQuery {
			return nil, &mcpError{Code: -32602, Message: fmt.Sprintf("%s is read-only; call %s with this operation", operationName, mcpToolQuery)}
		}
		return nil, &mcpError{Code: -32602, Message: fmt.Sprintf("%s changes state or performs an external action; call %s with this operation", operationName, mcpToolExecute)}
	}
	return h.callMCPOperation(ctx, userID, operationName, args)
}

func (h *MCPHandler) callMCPOperation(ctx context.Context, userID, operation string, args map[string]any) (any, *mcpError) {
	switch operation {
	case mcpToolWorkspaces, mcpToolProviders:
		return h.callReadOnlyGlobalTool(ctx, userID, operation)
	case mcpToolAccounts, mcpToolListMedia, mcpToolReadiness:
		return h.callReadOnlyWorkspaceTool(ctx, userID, operation, args)
	case mcpToolRenderWidget:
		return h.renderSchedulerWidget(args)
	case mcpToolCreatePub, mcpToolListPubs, mcpToolGetPub, mcpToolUpdatePub, mcpToolPubRenditions, mcpToolReplyRendition,
		mcpToolValidatePub, mcpToolSchedulePub, mcpToolCancelPub, mcpToolPublishPubNow, mcpToolPubEvents, mcpToolComments,
		mcpToolReplyComment, mcpToolHideComment, mcpToolDeleteComment, mcpToolSuggestSlot, mcpToolUploadURL:
		return h.callWorkspaceActionTool(ctx, userID, operation, args)
	default:
		return nil, &mcpError{Code: -32602, Message: fmt.Sprintf("unknown operation %q; call %s to discover supported operations", operation, mcpToolSearch)}
	}
}

func (h *MCPHandler) callWorkspaceActionTool(ctx context.Context, userID, toolName string, args map[string]any) (any, *mcpError) {
	switch toolName {
	case mcpToolCreatePub, mcpToolListPubs, mcpToolGetPub, mcpToolUpdatePub, mcpToolPubRenditions, mcpToolReplyRendition,
		mcpToolValidatePub, mcpToolSchedulePub, mcpToolCancelPub, mcpToolPublishPubNow, mcpToolPubEvents, mcpToolComments,
		mcpToolReplyComment, mcpToolHideComment, mcpToolDeleteComment:
		return h.callPublicationTool(ctx, userID, toolName, args)
	case mcpToolSuggestSlot:
		return h.suggestNextSlot(ctx, userID, args)
	case mcpToolUploadURL:
		return h.uploadMediaFromURL(ctx, userID, args)
	default:
		return nil, &mcpError{Code: -32602, Message: "unknown tool"}
	}
}

func (h *MCPHandler) callPublicationTool(ctx context.Context, userID, toolName string, args map[string]any) (any, *mcpError) {
	switch toolName {
	case mcpToolCreatePub:
		return h.createPublication(ctx, userID, args)
	case mcpToolListPubs:
		return h.listPublications(ctx, userID, args)
	case mcpToolGetPub:
		return h.getPublication(ctx, userID, args)
	case mcpToolUpdatePub:
		return h.updatePublication(ctx, userID, args)
	case mcpToolPubRenditions:
		return h.setPublicationRenditions(ctx, userID, args)
	case mcpToolReplyRendition:
		return h.replyToRendition(ctx, userID, args)
	case mcpToolValidatePub:
		return h.validatePublication(ctx, userID, args)
	case mcpToolSchedulePub:
		return h.schedulePublication(ctx, userID, args)
	case mcpToolCancelPub:
		return h.cancelPublication(ctx, userID, args)
	case mcpToolPublishPubNow:
		return h.publishPublicationNow(ctx, userID, args)
	case mcpToolPubEvents:
		return h.listPublicationEvents(ctx, userID, args)
	case mcpToolComments:
		return h.listRenditionComments(ctx, userID, args)
	case mcpToolReplyComment, mcpToolHideComment, mcpToolDeleteComment:
		return h.moderateComment(ctx, userID, toolName, args)
	default:
		return nil, &mcpError{Code: -32602, Message: "unknown tool"}
	}
}

func (h *MCPHandler) callReadOnlyWorkspaceTool(ctx context.Context, userID, toolName string, args map[string]any) (any, *mcpError) {
	switch toolName {
	case mcpToolAccounts:
		return h.listAccounts(ctx, userID, args)
	case mcpToolListMedia:
		return h.listMedia(ctx, userID, args)
	case mcpToolReadiness:
		return h.providerReadiness(ctx, userID, args)
	default:
		return nil, &mcpError{Code: -32602, Message: "unknown tool"}
	}
}

func (h *MCPHandler) callReadOnlyGlobalTool(ctx context.Context, userID, toolName string) (any, *mcpError) {
	switch toolName {
	case mcpToolWorkspaces:
		return h.listWorkspaces(ctx, userID)
	case mcpToolProviders:
		return h.listProviderCatalog(ctx), nil
	default:
		return nil, &mcpError{Code: -32602, Message: "unknown tool"}
	}
}

type mcpSchedulerWidgetInput struct {
	View        string         `json:"view"`
	Title       string         `json:"title"`
	WorkspaceID string         `json:"workspace_id"`
	Data        map[string]any `json:"data"`
}

func (h *MCPHandler) renderSchedulerWidget(args map[string]any) (any, *mcpError) {
	var input mcpSchedulerWidgetInput
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid render_scheduler_widget arguments"}
	}
	if input.Data == nil {
		return nil, &mcpError{Code: -32602, Message: "data is required"}
	}
	view := strings.TrimSpace(input.View)
	if view == "" {
		view = mcpInferSchedulerWidgetView(input.Data)
	}
	if !mcpValidSchedulerWidgetView(view) {
		return nil, &mcpError{Code: -32602, Message: "unsupported widget view"}
	}
	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: "Rendered OpenPost scheduler view.",
		}},
		"structuredContent": map[string]any{
			"view":         view,
			"title":        strings.TrimSpace(input.Title),
			"workspace_id": strings.TrimSpace(input.WorkspaceID),
			"data":         input.Data,
		},
	}, nil
}

func mcpSchedulerWidgetViews() []string {
	return []string{"summary", "workspaces", "providers", "accounts", "media", "publication", "publications", "post", "posts", "suggestion", "renditions"}
}

func mcpValidSchedulerWidgetView(view string) bool {
	for _, candidate := range mcpSchedulerWidgetViews() {
		if view == candidate {
			return true
		}
	}
	return false
}

func mcpInferSchedulerWidgetView(data map[string]any) string {
	switch {
	case data["publication"] != nil:
		return "publication"
	case data["publications"] != nil:
		return "publications"
	case data["post"] != nil:
		return "post"
	case data["posts"] != nil:
		return "posts"
	case data["media"] != nil:
		return "media"
	case data["accounts"] != nil:
		return "accounts"
	case data["providers"] != nil:
		return "providers"
	case data["workspaces"] != nil:
		return "workspaces"
	case data["suggestion"] != nil:
		return "suggestion"
	case data["renditions"] != nil:
		return "renditions"
	default:
		return "summary"
	}
}

func decodeMCPArguments(args map[string]any, dest any) error {
	payload, err := json.Marshal(args)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	return decoder.Decode(dest)
}

func (h *MCPHandler) recordToolCall(ctx context.Context, principal *middleware.Principal, toolName, workspaceID string, duration time.Duration, rpcErr *mcpError) {
	status := "success"
	errorMessage := ""
	if rpcErr != nil {
		status = "error"
		errorMessage = rpcErr.Message
	}
	if _, err := h.db.NewInsert().Model(&models.MCPToolCall{
		ID:                newUUID(),
		UserID:            principal.UserID,
		WorkspaceID:       workspaceID,
		ClientID:          principal.ClientID,
		ClientName:        principal.ClientName,
		ClientScope:       principal.Scope,
		ClientTokenPrefix: principal.TokenPrefix,
		ToolName:          toolName,
		Status:            status,
		ErrorMessage:      errorMessage,
		DurationMs:        duration.Milliseconds(),
		CreatedAt:         time.Now().UTC(),
	}).Exec(ctx); err != nil {
		log.Printf("[MCP] failed to record tool call %s: %v", toolName, err)
	}
}

func workspaceIDFromMCPArguments(args map[string]any) string {
	if args == nil {
		return ""
	}
	if workspaceID, ok := args["workspace_id"].(string); ok {
		return strings.TrimSpace(workspaceID)
	}
	return ""
}

func (h *MCPHandler) ensureWorkspaceAccess(ctx context.Context, userID, workspaceID string) *mcpError {
	workspaceID = strings.TrimSpace(workspaceID)
	if strings.TrimSpace(workspaceID) == "" {
		return &mcpError{Code: -32602, Message: "workspace_id is required"}
	}
	if scopedWorkspaceID := mcpWorkspaceScopeFromContext(ctx); scopedWorkspaceID != "" && scopedWorkspaceID != workspaceID {
		return &mcpError{Code: -32602, Message: "workspace outside token scope"}
	}
	allowed, err := workspaceReadAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return &mcpError{Code: -32603, Message: "failed to check workspace access"}
	}
	if !allowed {
		return &mcpError{Code: -32602, Message: "workspace not accessible"}
	}
	return nil
}

func (h *MCPHandler) ensureWorkspaceEditAccess(ctx context.Context, userID, workspaceID string) *mcpError {
	workspaceID = strings.TrimSpace(workspaceID)
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, workspaceID); rpcErr != nil {
		return rpcErr
	}
	allowed, err := workspaceEditAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return &mcpError{Code: -32603, Message: "failed to check workspace access"}
	}
	if !allowed {
		return &mcpError{Code: -32602, Message: "workspace editor role required"}
	}
	return nil
}

type mcpWorkspace struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at"`
}

func (h *MCPHandler) listWorkspaces(ctx context.Context, userID string) (any, *mcpError) {
	var rows []struct {
		models.Workspace `bun:",extend"`
		Role             string `bun:"role"`
	}
	query := h.db.NewSelect().
		Model(&rows).
		ColumnExpr("workspace.*").
		ColumnExpr("wm.role").
		Join("JOIN workspace_members AS wm ON wm.workspace_id = workspace.id").
		Where("wm.user_id = ? AND wm.status = ?", userID, models.WorkspaceMemberStatusActive)
	if workspaceID := mcpWorkspaceScopeFromContext(ctx); workspaceID != "" {
		query = query.Where("workspace.id = ?", workspaceID)
	}
	err := query.OrderExpr("workspace.created_at ASC").Scan(ctx)
	if err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to list workspaces"}
	}

	workspaces := make([]mcpWorkspace, 0, len(rows))
	names := make([]string, 0, len(rows))
	for _, row := range rows {
		allowed, accessErr := workspaceReadAllowed(ctx, h.db, row.ID, userID)
		if accessErr != nil {
			return nil, &mcpError{Code: -32603, Message: "failed to check workspace access"}
		}
		if !allowed {
			continue
		}
		workspaces = append(workspaces, mcpWorkspace{
			ID:        row.ID,
			Name:      row.Name,
			Role:      row.Role,
			CreatedAt: row.CreatedAt.Format(time.RFC3339),
		})
		names = append(names, row.Name)
	}
	text := "No workspaces available."
	if len(names) > 0 {
		text = "Available workspaces: " + strings.Join(names, ", ")
	}

	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: text,
		}},
		"structuredContent": map[string]any{
			"workspaces": workspaces,
		},
	}, nil
}

func (h *MCPHandler) listProviderCatalog(ctx context.Context) any {
	providers := applyProviderAvailabilityReadiness(
		ctx,
		h.readiness,
		providerAvailability(h.providers, h.dynamicMastodon),
	)
	available := make([]string, 0)
	needsConfiguration := make([]string, 0)
	planned := make([]string, 0)
	for _, provider := range providers {
		switch provider.Status {
		case providerStatusAvailable:
			available = append(available, provider.DisplayName)
		case providerStatusNeedsConfiguration:
			needsConfiguration = append(needsConfiguration, provider.DisplayName)
		case providerStatusPlanned:
			planned = append(planned, provider.DisplayName)
		default:
			needsConfiguration = append(needsConfiguration, provider.DisplayName+" ("+provider.Status+")")
		}
	}
	parts := []string{}
	if len(available) > 0 {
		parts = append(parts, "available: "+strings.Join(available, ", "))
	}
	if len(needsConfiguration) > 0 {
		parts = append(parts, "needs configuration: "+strings.Join(needsConfiguration, ", "))
	}
	if len(planned) > 0 {
		parts = append(parts, "planned: "+strings.Join(planned, ", "))
	}
	text := "Provider catalog is empty."
	if len(parts) > 0 {
		text = "Provider catalog: " + strings.Join(parts, "; ")
	}
	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: text,
		}},
		"structuredContent": map[string]any{
			"providers": providers,
		},
	}
}

type mcpAccount struct {
	ID              string `json:"id"`
	Platform        string `json:"platform"`
	Slug            string `json:"slug"`
	AccountID       string `json:"account_id"`
	AccountUsername string `json:"account_username,omitempty"`
	InstanceURL     string `json:"instance_url,omitempty"`
}

func (h *MCPHandler) listAccounts(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID string `json:"workspace_id"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid list_accounts arguments"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}

	var rows []models.SocialAccount
	err := h.db.NewSelect().
		Model(&rows).
		Where("workspace_id = ?", input.WorkspaceID).
		Where("is_active = ?", true).
		OrderExpr("platform ASC, slug ASC").
		Scan(ctx)
	if err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to list accounts"}
	}

	accounts := make([]mcpAccount, 0, len(rows))
	labels := make([]string, 0, len(rows))
	for _, row := range rows {
		accounts = append(accounts, mcpAccount{
			ID:              row.ID,
			Platform:        row.Platform,
			Slug:            row.Slug,
			AccountID:       row.AccountID,
			AccountUsername: row.AccountUsername,
			InstanceURL:     row.InstanceURL,
		})
		labels = append(labels, row.Platform+":"+row.Slug)
	}

	text := "No active social accounts connected."
	if len(labels) > 0 {
		text = "Active social accounts: " + strings.Join(labels, ", ")
	}
	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: text,
		}},
		"structuredContent": map[string]any{
			"accounts": accounts,
		},
	}, nil
}

type mcpCreatePublicationInput struct {
	WorkspaceID        string                  `json:"workspace_id"`
	ContentProfile     string                  `json:"content_profile"`
	Title              string                  `json:"title"`
	SourceText         string                  `json:"source_text"`
	SourceURL          string                  `json:"source_url"`
	ScheduledAt        *time.Time              `json:"scheduled_at"`
	RandomDelayMinutes *int                    `json:"random_delay_minutes"`
	SocialAccountIDs   []string                `json:"social_account_ids"`
	MediaIDs           []string                `json:"media_ids"`
	Media              []PublicationMediaInput `json:"media"`
	Renditions         []RenditionInput        `json:"renditions"`
}

type mcpPublicationStatus struct {
	ID                   string `json:"id"`
	WorkspaceID          string `json:"workspace_id"`
	Title                string `json:"title"`
	ContentProfile       string `json:"content_profile"`
	Status               string `json:"status"`
	Revision             int    `json:"revision"`
	SourceText           string `json:"source_text"`
	SourceURL            string `json:"source_url,omitempty"`
	ScheduledAt          string `json:"scheduled_at,omitempty"`
	RandomDelayMinutes   int    `json:"random_delay_minutes"`
	RandomDelayInherited bool   `json:"random_delay_inherited"`
	CreatedAt            string `json:"created_at"`
	UpdatedAt            string `json:"updated_at"`
	RenditionCount       int    `json:"rendition_count"`
}

func (h *MCPHandler) createPublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input mcpCreatePublicationInput
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid create_publication arguments"}
	}
	now := time.Now().UTC()
	if rpcErr := validateMCPCreatePublicationInput(input, now); rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}

	defaultMedia, rpcErr := mcpDefaultPublicationMedia(input)
	if rpcErr != nil {
		return nil, rpcErr
	}
	accountIDs, rpcErr := normalizeMCPIDs(input.SocialAccountIDs, "social_account_ids")
	if rpcErr != nil {
		return nil, rpcErr
	}
	publication, err := h.publicationHandler().publicationApplication().Create(ctx, userID, CreatePublicationBody{
		WorkspaceID:        input.WorkspaceID,
		Title:              input.Title,
		ContentProfile:     input.ContentProfile,
		SourceText:         input.SourceText,
		SourceURL:          input.SourceURL,
		ScheduledAt:        input.ScheduledAt,
		RandomDelayMinutes: input.RandomDelayMinutes,
		Metadata:           map[string]interface{}{"created_from": "mcp"},
		SocialAccountIDs:   accountIDs,
		Media:              defaultMedia,
		Renditions:         input.Renditions,
	})
	if err != nil {
		return nil, mcpPublicationCreateError(err)
	}
	status, rpcErr := h.loadMCPPublicationStatus(ctx, publication.ID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: "Publication created: " + publication.ID}},
		"structuredContent": map[string]any{
			"publication": status,
		},
	}, nil
}

func mcpPublicationCreateError(err error) *mcpError {
	var statusErr huma.StatusError
	if errors.As(err, &statusErr) && statusErr.GetStatus() < http.StatusInternalServerError {
		return &mcpError{Code: -32602, Message: statusErr.Error()}
	}
	return &mcpError{Code: -32603, Message: "failed to create publication"}
}

func validateMCPCreatePublicationInput(input mcpCreatePublicationInput, now time.Time) *mcpError {
	if strings.TrimSpace(input.ContentProfile) == "" {
		return &mcpError{Code: -32602, Message: "content_profile is required"}
	}
	if strings.TrimSpace(input.SourceText) == "" {
		return &mcpError{Code: -32602, Message: "source_text is required"}
	}
	if input.ScheduledAt != nil {
		if err := validateFuturePublicationSchedule(*input.ScheduledAt, now); err != nil {
			return &mcpError{Code: -32602, Message: err.Error()}
		}
	}
	return nil
}

func mcpDefaultPublicationMedia(input mcpCreatePublicationInput) ([]PublicationMediaInput, *mcpError) {
	mediaIDs, rpcErr := normalizeMCPIDs(input.MediaIDs, "media_ids")
	if rpcErr != nil {
		return nil, rpcErr
	}
	defaultMedia := append([]PublicationMediaInput{}, input.Media...)
	for _, mediaID := range mediaIDs {
		defaultMedia = append(defaultMedia, PublicationMediaInput{MediaID: mediaID, Role: "attachment"})
	}
	return defaultMedia, nil
}

func (h *MCPHandler) listPublications(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID    string `json:"workspace_id"`
		Status         string `json:"status"`
		ActivityBucket string `json:"activity_bucket"`
		ContentProfile string `json:"content_profile"`
		Platform       string `json:"platform"`
		CalendarFrom   string `json:"calendar_from"`
		CalendarBefore string `json:"calendar_before"`
		Limit          int    `json:"limit"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid list_publications arguments"}
	}
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	page, err := h.publicationHandler().publicationApplication().List(ctx, userID, ListPublicationsInput{
		WorkspaceID: input.WorkspaceID, Status: input.Status, ActivityBucket: input.ActivityBucket,
		ContentProfile: input.ContentProfile, Platform: input.Platform,
		CalendarFrom: input.CalendarFrom, CalendarBefore: input.CalendarBefore, Limit: limit,
	})
	if err != nil {
		return nil, publicationMutationMCPError(err, "failed to list publications")
	}
	publications := make([]mcpPublicationStatus, 0, len(page.Publications))
	for _, publication := range page.Publications {
		publications = append(publications, mcpPublicationStatus{
			ID: publication.ID, WorkspaceID: publication.WorkspaceID, Title: publication.Title,
			ContentProfile: publication.ContentProfile, Status: publication.Status, Revision: publication.Revision,
			SourceText: publication.SourceText, SourceURL: publication.SourceURL, ScheduledAt: publication.ScheduledAt,
			RandomDelayMinutes: publication.RandomDelayMinutes, RandomDelayInherited: publication.RandomDelayInherited,
			CreatedAt: publication.CreatedAt,
			UpdatedAt: publication.UpdatedAt, RenditionCount: len(publication.Renditions),
		})
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: fmt.Sprintf("Found %d publications.", len(publications))}},
		"structuredContent": map[string]any{
			"publications": publications,
		},
	}, nil
}

func (h *MCPHandler) getPublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	publicationID, rpcErr := decodeMCPPublicationID(args, "invalid get_publication arguments")
	if rpcErr != nil {
		return nil, rpcErr
	}
	publication, err := h.publicationHandler().publicationApplication().Get(ctx, userID, publicationID)
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: "publication not found or unavailable"}
	}
	return map[string]any{
		"content":           []mcpContent{{Type: "text", Text: "Publication loaded: " + publication.ID}},
		"structuredContent": map[string]any{"publication": publication},
	}, nil
}

type mcpPublicationUpdateInput struct {
	PublicationID      string                  `json:"publication_id"`
	ExpectedRevision   int                     `json:"expected_revision"`
	Title              *string                 `json:"title"`
	ContentProfile     *string                 `json:"content_profile"`
	SourceText         *string                 `json:"source_text"`
	SourceURL          *string                 `json:"source_url"`
	Goal               *string                 `json:"goal"`
	Audience           *string                 `json:"audience"`
	ScheduledAt        *time.Time              `json:"scheduled_at"`
	ClearSchedule      bool                    `json:"clear_schedule"`
	RandomDelayMinutes *int                    `json:"random_delay_minutes"`
	InheritRandomDelay bool                    `json:"inherit_random_delay"`
	Metadata           *map[string]interface{} `json:"metadata"`
}

func (h *MCPHandler) updatePublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input mcpPublicationUpdateInput
	if err := decodeMCPArguments(args, &input); err != nil ||
		strings.TrimSpace(input.PublicationID) == "" ||
		input.ExpectedRevision < 1 {
		return nil, &mcpError{Code: -32602, Message: "invalid update_publication arguments"}
	}
	if err := h.publicationHandler().publicationApplication().Update(ctx, userID, input.PublicationID, PublicationUpdateBody{
		ExpectedRevision:   input.ExpectedRevision,
		Title:              input.Title,
		ContentProfile:     input.ContentProfile,
		SourceText:         input.SourceText,
		SourceURL:          input.SourceURL,
		Goal:               input.Goal,
		Audience:           input.Audience,
		ScheduledAt:        input.ScheduledAt,
		ClearSchedule:      input.ClearSchedule,
		RandomDelayMinutes: input.RandomDelayMinutes,
		InheritRandomDelay: input.InheritRandomDelay,
		Metadata:           mcpMetadataValue(input.Metadata),
	}); err != nil {
		return nil, publicationMutationMCPError(err, "failed to update publication")
	}
	return h.getPublication(ctx, userID, map[string]any{"publication_id": input.PublicationID})
}

func mcpMetadataValue(metadata *map[string]interface{}) map[string]interface{} {
	if metadata == nil {
		return nil
	}
	return *metadata
}

func publicationMutationMCPError(err error, fallback string) *mcpError {
	if category, ok := publicationservice.CategoryOf(err); ok {
		switch category {
		case publicationservice.ErrorInvalidInput, publicationservice.ErrorAccessDenied,
			publicationservice.ErrorNotFound, publicationservice.ErrorRevisionConflict,
			publicationservice.ErrorInvalidLifecycleState, publicationservice.ErrorProviderReadiness:
			return &mcpError{Code: -32602, Message: err.Error()}
		case publicationservice.ErrorTemporaryUnavailable:
			return &mcpError{Code: -32603, Message: fallback}
		}
	}
	var notReady *providerreadiness.NotReadyError
	var statusErr huma.StatusError
	switch {
	case isDraftRevisionConflict(err):
		return &mcpError{Code: -32602, Message: err.Error()}
	case errors.As(err, &statusErr) && statusErr.GetStatus() < http.StatusInternalServerError:
		return &mcpError{Code: -32602, Message: statusErr.Error()}
	case errors.Is(err, errPublicationNotFound),
		errors.Is(err, errPublicationAlreadyProcessing),
		errors.Is(err, errPublicationNotEditable),
		errors.Is(err, errPublicationNotScheduled),
		errors.Is(err, errPublicationScheduleConflict),
		errors.Is(err, errPublicationScheduleFuture),
		errors.Is(err, errPublicationValidationBlocked),
		errors.Is(err, errPublicationScheduleRequired):
		return &mcpError{Code: -32602, Message: err.Error()}
	case errors.As(err, &notReady):
		return &mcpError{Code: -32602, Message: err.Error()}
	default:
		return &mcpError{Code: -32603, Message: fallback}
	}
}

func isDraftRevisionConflict(err error) bool {
	if errors.Is(err, drafts.ErrRevisionConflict) {
		return true
	}
	var conflict *drafts.ConflictError
	return errors.As(err, &conflict)
}

func (h *MCPHandler) setPublicationRenditions(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		PublicationID    string           `json:"publication_id"`
		ExpectedRevision int              `json:"expected_revision"`
		Renditions       []RenditionInput `json:"renditions"`
	}
	if err := decodeMCPArguments(args, &input); err != nil ||
		strings.TrimSpace(input.PublicationID) == "" ||
		input.ExpectedRevision < 1 ||
		len(input.Renditions) == 0 {
		return nil, &mcpError{Code: -32602, Message: "invalid set_publication_renditions arguments"}
	}
	if err := h.publicationHandler().publicationApplication().ReplaceRenditions(
		ctx, userID, input.PublicationID, input.ExpectedRevision, input.Renditions,
	); err != nil {
		return nil, publicationMutationMCPError(err, "failed to update publication renditions")
	}
	return h.getPublication(ctx, userID, map[string]any{"publication_id": input.PublicationID})
}

func (h *MCPHandler) replyToRendition(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		RenditionID string                  `json:"rendition_id"`
		Body        string                  `json:"body"`
		ParentID    string                  `json:"parent_id"`
		Settings    map[string]interface{}  `json:"settings"`
		Media       []PublicationMediaInput `json:"media"`
		RunAt       *time.Time              `json:"run_at"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.RenditionID) == "" || strings.TrimSpace(input.Body) == "" {
		return nil, &mcpError{Code: -32602, Message: "invalid reply_to_rendition arguments"}
	}
	rendition, publication, _, rpcErr := h.loadMCPCommentContext(ctx, userID, input.RenditionID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, publication.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	runAt := time.Now().UTC()
	if input.RunAt != nil {
		runAt = input.RunAt.UTC()
	}
	jobID, err := (&PublicationHandler{db: h.db}).queueRenditionReply(
		ctx, rendition, publication, input.Body, input.ParentID, input.Settings, input.Media, runAt,
	)
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to enqueue reply"}
	}
	status, statusErr := h.loadMCPPublicationStatus(ctx, publication.ID)
	if statusErr != nil {
		return nil, statusErr
	}
	return mcpPublicationActionResult("Reply queued: "+rendition.ID, jobID, status), nil
}

func decodeMCPPublicationID(args map[string]any, invalid string) (string, *mcpError) {
	var input struct {
		PublicationID string `json:"publication_id"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.PublicationID) == "" {
		return "", &mcpError{Code: -32602, Message: invalid}
	}
	return strings.TrimSpace(input.PublicationID), nil
}

func (h *MCPHandler) validatePublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		PublicationID string `json:"publication_id"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid validate_publication arguments"}
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	if input.PublicationID == "" {
		return nil, &mcpError{Code: -32602, Message: "publication_id is required"}
	}
	issues, err := h.publicationHandler().publicationApplication().Validate(ctx, userID, input.PublicationID)
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to validate publication"}
	}
	valid := !hasBlockingIssues(issues)
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: fmt.Sprintf("Publication validation found %d issue(s).", len(issues))}},
		"structuredContent": map[string]any{
			"valid":  valid,
			"issues": issues,
		},
	}, nil
}

func (h *MCPHandler) schedulePublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	publicationID, expectedRevision, intent, rpcErr := h.loadMCPPublicationAction(ctx, args, "invalid schedule_publication arguments")
	if rpcErr != nil {
		return nil, rpcErr
	}
	handler := h.publicationHandler()
	result, err := handler.publicationApplication().Schedule(ctx, userID, publicationID, expectedRevision, intent)
	if err != nil {
		return nil, publicationMutationMCPError(err, "failed to schedule publication")
	}
	status, rpcErr := h.loadMCPPublicationStatus(ctx, publicationID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	return mcpPublicationActionResult("Publication scheduled: "+publicationID, result.JobID, status), nil
}

func (h *MCPHandler) cancelPublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		PublicationID    string `json:"publication_id"`
		ExpectedRevision int    `json:"expected_revision"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.PublicationID) == "" || input.ExpectedRevision < 1 {
		return nil, &mcpError{Code: -32602, Message: "invalid cancel_publication arguments"}
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	if err := h.publicationHandler().publicationApplication().Cancel(
		ctx, userID, input.PublicationID, input.ExpectedRevision,
	); err != nil {
		return nil, publicationMutationMCPError(err, "failed to cancel publication")
	}
	return h.getPublication(ctx, userID, map[string]any{"publication_id": input.PublicationID})
}

func (h *MCPHandler) publishPublicationNow(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	publicationID, expectedRevision, intent, rpcErr := h.loadMCPPublicationAction(ctx, args, "invalid publish_publication_now arguments")
	if rpcErr != nil {
		return nil, rpcErr
	}
	handler := h.publicationHandler()
	result, err := handler.publicationApplication().PublishNow(ctx, userID, publicationID, expectedRevision, intent)
	if err != nil {
		return nil, publicationMutationMCPError(err, "failed to queue publication")
	}
	status, rpcErr := h.loadMCPPublicationStatus(ctx, publicationID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	return mcpPublicationActionResult("Publication queued: "+publicationID, result.JobID, status), nil
}

func (h *MCPHandler) loadMCPPublicationAction(ctx context.Context, args map[string]any, invalidMessage string) (string, int, providerreadiness.ExecutionIntent, *mcpError) {
	var input struct {
		PublicationID    string `json:"publication_id"`
		ExpectedRevision int    `json:"expected_revision"`
		ExecutionIntent  string `json:"execution_intent"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return "", 0, "", &mcpError{Code: -32602, Message: invalidMessage}
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	if input.PublicationID == "" || input.ExpectedRevision < 1 {
		return "", 0, "", &mcpError{Code: -32602, Message: "publication_id and expected_revision are required"}
	}
	intent, err := providerReadinessExecutionIntent(ctx, h.db, input.ExecutionIntent)
	if err != nil {
		return "", 0, "", &mcpError{Code: -32602, Message: err.Error()}
	}
	return input.PublicationID, input.ExpectedRevision, intent, nil
}

func mcpPublicationActionResult(message, jobID string, status mcpPublicationStatus) map[string]any {
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: message}},
		"structuredContent": map[string]any{
			"publication": status,
			"job_id":      jobID,
		},
	}
}

func (h *MCPHandler) listPublicationEvents(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		PublicationID string `json:"publication_id"`
		Limit         int    `json:"limit"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid list_publication_events arguments"}
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	if input.PublicationID == "" {
		return nil, &mcpError{Code: -32602, Message: "publication_id is required"}
	}
	page, err := h.publicationHandler().publicationApplication().History(
		ctx, userID, input.PublicationID, input.Limit, "",
	)
	if err != nil {
		return nil, publicationMutationMCPError(err, "failed to list publication events")
	}
	out := page.Events
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: fmt.Sprintf("Found %d publication events.", len(out))}},
		"structuredContent": map[string]any{
			"events": out,
		},
	}, nil
}

func (h *MCPHandler) listRenditionComments(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		RenditionID string `json:"rendition_id"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid list_rendition_comments arguments"}
	}
	input.RenditionID = strings.TrimSpace(input.RenditionID)
	if input.RenditionID == "" {
		return nil, &mcpError{Code: -32602, Message: "rendition_id is required"}
	}
	rendition, publication, account, rpcErr := h.loadMCPCommentContext(ctx, userID, input.RenditionID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	commenter, accessToken, rpcErr := h.commentAdapter(ctx, account)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if strings.TrimSpace(rendition.ExternalID) == "" {
		return nil, &mcpError{Code: -32602, Message: "rendition has no provider post ID"}
	}
	comments, err := commenter.ListComments(ctx, accessToken, account.AccountID, rendition.ExternalID)
	if err != nil {
		if errors.Is(err, platform.ErrUnsupportedCommentAction) {
			return nil, &mcpError{Code: -32603, Message: "provider does not support list provider comments"}
		}
		return nil, &mcpError{Code: -32603, Message: "failed to list provider comments"}
	}
	out := make([]CommentResponse, 0, len(comments))
	for _, comment := range comments {
		ref, err := encodeCommentReference(commentReference{RenditionID: rendition.ID, ProviderCommentID: comment.ID})
		if err != nil {
			return nil, &mcpError{Code: -32603, Message: "failed to encode comment ID"}
		}
		out = append(out, commentResponse(rendition.ID, ref, comment))
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: fmt.Sprintf("Found %d comments for %s.", len(out), publication.Title)}},
		"structuredContent": map[string]any{
			"comments": out,
		},
	}, nil
}

func (h *MCPHandler) moderateComment(ctx context.Context, userID, operation string, args map[string]any) (any, *mcpError) {
	var input struct {
		CommentID string `json:"comment_id"`
		Body      string `json:"body"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.CommentID) == "" {
		return nil, &mcpError{Code: -32602, Message: "invalid comment action arguments"}
	}
	ref, err := decodeCommentReference(input.CommentID)
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid comment ID"}
	}
	rendition, publication, account, rpcErr := h.loadMCPCommentContext(ctx, userID, ref.RenditionID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, publication.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	if _, rpcErr := h.commentProvider(account); rpcErr != nil {
		return nil, rpcErr
	}
	message, action := "", ""
	switch operation {
	case mcpToolReplyComment:
		if strings.TrimSpace(input.Body) == "" {
			return nil, &mcpError{Code: -32602, Message: "reply body is required"}
		}
		action = "reply"
		message = "comment reply queued"
	case mcpToolHideComment:
		action = "hide"
		message = "comment hide queued"
	case mcpToolDeleteComment:
		action = "delete"
		message = "comment deletion queued"
	default:
		return nil, &mcpError{Code: -32602, Message: "unknown comment action"}
	}
	jobID, err := engagementservice.QueueProviderCommentAction(ctx, h.db, h.featureGate, engagementservice.ProviderCommentActionInput{
		Actor:       workspaceActor(ctx, userID),
		WorkspaceID: publication.WorkspaceID, PublicationID: publication.ID,
		RenditionID: rendition.ID, SocialAccountID: account.ID,
		ProviderCommentID: ref.ProviderCommentID, Action: action,
		Message: input.Body,
	})
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to queue provider comment action"}
	}
	return map[string]any{
		"content":           []mcpContent{{Type: "text", Text: message}},
		"structuredContent": map[string]any{"message": message, "id": jobID},
	}, nil
}

func (h *MCPHandler) loadMCPCommentContext(ctx context.Context, userID, renditionID string) (*models.Rendition, *models.Publication, *models.SocialAccount, *mcpError) {
	var rendition models.Rendition
	if err := h.db.NewSelect().Model(&rendition).Where("id = ?", renditionID).Scan(ctx); err != nil {
		return nil, nil, nil, &mcpError{Code: -32602, Message: "rendition not found"}
	}
	var publication models.Publication
	if err := h.db.NewSelect().Model(&publication).Where("id = ?", rendition.PublicationID).Scan(ctx); err != nil {
		return nil, nil, nil, &mcpError{Code: -32602, Message: "publication not found"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, publication.WorkspaceID); rpcErr != nil {
		return nil, nil, nil, rpcErr
	}
	var account models.SocialAccount
	if err := h.db.NewSelect().
		Model(&account).
		Where("id = ? AND workspace_id = ? AND is_active = ?", rendition.SocialAccountID, publication.WorkspaceID, true).
		Scan(ctx); err != nil {
		return nil, nil, nil, &mcpError{Code: -32602, Message: "social account not found"}
	}
	return &rendition, &publication, &account, nil
}

func (h *MCPHandler) commentAdapter(ctx context.Context, account *models.SocialAccount) (platform.CommentAdapter, string, *mcpError) {
	commenter, rpcErr := h.commentProvider(account)
	if rpcErr != nil {
		return nil, "", rpcErr
	}
	if h.tokenSource != nil {
		token, err := h.tokenSource.GetValidAccessToken(ctx, account.ID)
		if err != nil {
			return nil, "", &mcpError{Code: -32603, Message: "failed to load account token"}
		}
		return commenter, token, nil
	}
	if h.tokenEncryptor == nil {
		return nil, "", &mcpError{Code: -32603, Message: "comment provider tokens are unavailable"}
	}
	token, err := h.tokenEncryptor.Decrypt(account.AccessTokenEnc)
	if err != nil {
		return nil, "", &mcpError{Code: -32603, Message: "failed to decrypt account token"}
	}
	return commenter, token, nil
}

func (h *MCPHandler) commentProvider(account *models.SocialAccount) (platform.CommentAdapter, *mcpError) {
	provider := h.providers[account.Platform]
	commenter, ok := provider.(platform.CommentAdapter)
	if !ok || commenter == nil {
		return nil, &mcpError{Code: -32603, Message: fmt.Sprintf("comments are not supported for %s", account.Platform)}
	}
	return commenter, nil
}

func (h *MCPHandler) loadMCPPublicationStatus(ctx context.Context, publicationID string) (mcpPublicationStatus, *mcpError) {
	var publication models.Publication
	if err := h.db.NewSelect().Model(&publication).Where("id = ?", publicationID).Scan(ctx); err != nil {
		return mcpPublicationStatus{}, &mcpError{Code: -32603, Message: "failed to load publication"}
	}
	count, err := h.db.NewSelect().Model((*models.Rendition)(nil)).Where("publication_id = ?", publicationID).Count(ctx)
	if err != nil {
		return mcpPublicationStatus{}, &mcpError{Code: -32603, Message: "failed to load publication renditions"}
	}
	return mcpPublicationStatus{
		ID:                   publication.ID,
		WorkspaceID:          publication.WorkspaceID,
		Title:                publication.Title,
		ContentProfile:       publication.ContentProfile,
		Status:               publication.Status,
		Revision:             publication.Revision,
		SourceText:           publication.SourceText,
		SourceURL:            publication.SourceURL,
		ScheduledAt:          formatOptionalTime(publication.ScheduledAt),
		RandomDelayMinutes:   publication.RandomDelayMinutes,
		RandomDelayInherited: !publication.RandomDelayExplicit,
		CreatedAt:            publication.CreatedAt.Format(time.RFC3339),
		UpdatedAt:            publication.UpdatedAt.Format(time.RFC3339),
		RenditionCount:       count,
	}, nil
}
func (h *MCPHandler) loadMCPWorkspace(ctx context.Context, workspaceID string) (models.Workspace, *mcpError) {
	var workspace models.Workspace
	err := h.db.NewSelect().
		Model(&workspace).
		Where("id = ?", workspaceID).
		Scan(ctx)
	if err != nil {
		if err == sql.ErrNoRows {
			return workspace, &mcpError{Code: -32602, Message: "workspace not found"}
		}
		return workspace, &mcpError{Code: -32603, Message: "failed to load workspace"}
	}
	return workspace, nil
}

type mcpSlotSuggestion struct {
	WorkspaceID string                   `json:"workspace_id"`
	Timezone    string                   `json:"timezone"`
	SlotTime    string                   `json:"slot_time,omitempty"`
	SlotTimeUTC string                   `json:"slot_time_utc,omitempty"`
	Slot        *PostingScheduleResponse `json:"slot,omitempty"`
	Message     string                   `json:"message"`
}

type mcpSuggestNextSlotInput struct {
	WorkspaceID string `json:"workspace_id"`
	After       string `json:"after"`
}

func (h *MCPHandler) suggestNextSlot(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input mcpSuggestNextSlotInput
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid suggest_next_slot arguments"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	workspace, rpcErr := h.loadMCPWorkspace(ctx, input.WorkspaceID)
	if rpcErr != nil {
		return nil, rpcErr
	}

	loc, err := time.LoadLocation(workspace.Timezone)
	if err != nil {
		loc = time.UTC
		workspace.Timezone = "UTC"
	}
	now := time.Now().In(loc)
	if strings.TrimSpace(input.After) != "" {
		after, err := time.Parse(time.RFC3339, input.After)
		if err != nil {
			return nil, &mcpError{Code: -32602, Message: "after must be an RFC3339 timestamp"}
		}
		now = after.In(loc)
	}

	var schedules []models.PostingSchedule
	query := h.db.NewSelect().
		Model(&schedules).
		Where("workspace_id = ?", input.WorkspaceID).
		Where("is_active = ?", true)
	if err := query.Scan(ctx); err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to load posting schedules"}
	}

	if len(schedules) == 0 {
		suggestion := mcpSlotSuggestion{
			WorkspaceID: input.WorkspaceID,
			Timezone:    workspace.Timezone,
			Message:     "No posting schedules configured for this workspace.",
		}
		return mcpSlotToolResult(suggestion), nil
	}

	var scheduledPublications []models.Publication
	publicationQuery := h.db.NewSelect().
		Model(&scheduledPublications).
		Where("workspace_id = ?", input.WorkspaceID).
		Where("status = ?", models.PublicationStatusScheduled).
		Where("scheduled_at >= ?", now.UTC().Add(-24*time.Hour)).
		Order("scheduled_at ASC")
	if err := publicationQuery.Scan(ctx); err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to load scheduled publications"}
	}

	nextSlot, nextSlotTime := findNextConfiguredScheduleSlotTime(now, loc, schedules, scheduledPublications, workspace.RandomDelayMinutes)
	suggestion := mcpSlotSuggestion{
		WorkspaceID: input.WorkspaceID,
		Timezone:    workspace.Timezone,
		Message:     "No available slots found in the next month.",
	}
	if !nextSlotTime.IsZero() {
		suggestion.SlotTime = nextSlotTime.Format(time.RFC3339)
		suggestion.SlotTimeUTC = nextSlotTime.UTC().Format(time.RFC3339)
		suggestion.Message = "Next available slot found."
		if nextSlot != nil {
			slot := postingScheduleResponseForWorkspace(nextSlotTime, loc, *nextSlot)
			suggestion.Slot = &slot
		}
	}
	return mcpSlotToolResult(suggestion), nil
}

type mcpMedia struct {
	ID                 string  `json:"id"`
	WorkspaceID        string  `json:"workspace_id,omitempty"`
	MimeType           string  `json:"mime_type"`
	URL                string  `json:"url"`
	ThumbnailURL       string  `json:"thumbnail_url,omitempty"`
	Size               int64   `json:"size"`
	Deduped            bool    `json:"deduped"`
	Filename           string  `json:"filename"`
	OriginalFilename   string  `json:"original_filename,omitempty"`
	AltText            string  `json:"alt_text,omitempty"`
	SourceURL          string  `json:"source_url,omitempty"`
	Width              int     `json:"width,omitempty"`
	Height             int     `json:"height,omitempty"`
	DurationMS         int64   `json:"duration_ms,omitempty"`
	FrameRate          float64 `json:"frame_rate,omitempty"`
	AspectRatio        string  `json:"aspect_ratio,omitempty"`
	DominantType       string  `json:"dominant_type,omitempty"`
	AnalysisStatus     string  `json:"analysis_status,omitempty"`
	AnalysisError      string  `json:"analysis_error,omitempty"`
	PublicURLReady     bool    `json:"public_url_ready,omitempty"`
	PublicURLCheckedAt string  `json:"public_url_checked_at,omitempty"`
	PublicURLStatus    int     `json:"public_url_status,omitempty"`
	PublicURLError     string  `json:"public_url_error,omitempty"`
	IsFavorite         bool    `json:"is_favorite,omitempty"`
	CreatedAt          string  `json:"created_at,omitempty"`
	ProcessingStatus   string  `json:"processing_status,omitempty"`
	UsageCount         int     `json:"usage_count,omitempty"`
	CanDelete          bool    `json:"can_delete"`
}

type mcpListMediaInput struct {
	WorkspaceID string `json:"workspace_id"`
	Limit       int    `json:"limit"`
	Filter      string `json:"filter"`
}

func (h *MCPHandler) listMedia(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input mcpListMediaInput
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid list_media arguments"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	limit := input.Limit
	if limit == 0 {
		limit = 20
	}
	if limit < 1 || limit > 100 {
		return nil, &mcpError{Code: -32602, Message: "limit must be between 1 and 100"}
	}

	var rows []models.MediaAttachment
	query := h.db.NewSelect().
		Model(&rows).
		Where("workspace_id = ?", input.WorkspaceID)
	switch strings.TrimSpace(input.Filter) {
	case "", "all":
	case "favorites":
		query = query.Where("is_favorite = ?", true)
	case "used":
		query = query.Where("id IN (SELECT media_id FROM post_media)")
	case "unused":
		query = query.Where("id NOT IN (SELECT media_id FROM post_media)")
	default:
		return nil, &mcpError{Code: -32602, Message: "filter must be one of all, favorites, used, or unused"}
	}

	err := query.Order("created_at DESC").Limit(limit).Scan(ctx, &rows)
	if err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to list media"}
	}
	mediaHandler := &MediaHandler{db: h.db}
	media := make([]mcpMedia, 0, len(rows))
	for _, row := range rows {
		usage, err := mediaHandler.mediaUsageSummary(ctx, row.WorkspaceID, row.ID)
		if err != nil {
			return nil, &mcpError{Code: -32603, Message: "failed to check media usage"}
		}
		media = append(media, mcpMediaFromAttachment(row, usage.Total, usage.Blocking == 0))
	}

	text := fmt.Sprintf("Found %d media items.", len(media))
	if len(media) == 0 {
		text = "No media attachments found."
	}
	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: text,
		}},
		"structuredContent": map[string]any{
			"media": media,
		},
	}, nil
}

func (h *MCPHandler) providerReadiness(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID string `json:"workspace_id"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid get_provider_readiness arguments"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	handler := &ProviderReadinessHandler{db: h.db, providers: h.providers, readiness: h.readiness}
	accounts, err := handler.loadReadinessAccounts(ctx, input.WorkspaceID)
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to load connected accounts"}
	}
	providers := make([]ProviderReadinessItem, 0, len(readinessProviders()))
	for _, provider := range readinessProviders() {
		providers = append(providers, handler.buildProviderReadiness(ctx, provider, accounts[provider]))
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: fmt.Sprintf("Loaded provider readiness for %d providers.", len(providers))}},
		"structuredContent": map[string]any{
			"providers": providers,
		},
	}, nil
}

func mcpMediaFromAttachment(media models.MediaAttachment, usageCount int, canDelete bool) mcpMedia {
	thumbnailURL := "/media/" + media.ID + "/thumb"
	if mcpHasSmallThumbnail(media.ThumbnailsJSON) {
		thumbnailURL = "/media/" + media.ID + "/thumb/sm"
	}
	out := mcpMedia{
		ID:               media.ID,
		WorkspaceID:      media.WorkspaceID,
		MimeType:         media.MimeType,
		URL:              "/media/" + media.ID,
		ThumbnailURL:     thumbnailURL,
		Size:             media.Size,
		Filename:         media.OriginalFilename,
		OriginalFilename: media.OriginalFilename,
		AltText:          media.AltText,
		Width:            media.Width,
		Height:           media.Height,
		DurationMS:       media.DurationMS,
		FrameRate:        media.FrameRate,
		AspectRatio:      media.AspectRatio,
		DominantType:     media.DominantType,
		AnalysisStatus:   media.AnalysisStatus,
		AnalysisError:    media.AnalysisError,
		PublicURLReady:   media.PublicURLReady,
		PublicURLStatus:  media.PublicURLStatus,
		PublicURLError:   media.PublicURLError,
		IsFavorite:       media.IsFavorite,
		CreatedAt:        media.CreatedAt.Format(time.RFC3339),
		ProcessingStatus: media.ProcessingStatus,
		UsageCount:       usageCount,
		CanDelete:        canDelete,
	}
	if !media.PublicURLCheckedAt.IsZero() {
		out.PublicURLCheckedAt = media.PublicURLCheckedAt.UTC().Format(time.RFC3339)
	}
	return out
}

func mcpHasSmallThumbnail(raw string) bool {
	if strings.TrimSpace(raw) == "" {
		return false
	}
	var thumbnails Thumbnails
	if err := json.Unmarshal([]byte(raw), &thumbnails); err != nil {
		return false
	}
	return thumbnails.SM != ""
}

func (h *MCPHandler) uploadMediaFromURL(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID string `json:"workspace_id"`
		URL         string `json:"url"`
		Filename    string `json:"filename"`
		AltText     string `json:"alt_text"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid upload_media_from_url arguments"}
	}
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	if h.mediaStorage == nil {
		return nil, &mcpError{Code: -32603, Message: "media storage is not configured"}
	}

	remote, filename, declaredMimeType, content, rpcErr := h.fetchRemoteMedia(ctx, input.URL, input.Filename)
	if rpcErr != nil {
		return nil, rpcErr
	}
	mediaHandler := &MediaHandler{
		db:      h.db,
		storage: h.mediaStorage,
		quota:   h.entitlement,
		usage:   h.usage,
	}
	result, err := mediaHandler.processUploadBytes(ctx, mediaUploadBytesInput{
		WorkspaceID:      input.WorkspaceID,
		Filename:         filename,
		DeclaredMimeType: declaredMimeType,
		Size:             int64(len(content)),
		Content:          content,
		AltText:          input.AltText,
	})
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: err.Error()}
	}

	media := mcpMedia{
		ID:        stringFromMap(result, "id"),
		MimeType:  stringFromMap(result, "mime_type"),
		URL:       stringFromMap(result, "url"),
		Size:      int64FromMap(result, "size"),
		Deduped:   boolFromMap(result, "deduped"),
		Filename:  filename,
		AltText:   input.AltText,
		SourceURL: remote.String(),
	}
	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: "Media uploaded: " + media.ID,
		}},
		"structuredContent": map[string]any{
			"media": media,
		},
	}, nil
}

func (h *MCPHandler) fetchRemoteMedia(ctx context.Context, rawURL, requestedFilename string) (*url.URL, string, string, []byte, *mcpError) {
	remote, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || remote == nil || remote.Host == "" {
		return nil, "", "", nil, &mcpError{Code: -32602, Message: "url must be an absolute http(s) URL"}
	}
	if rpcErr := h.validateMediaURL(ctx, remote); rpcErr != nil {
		return nil, "", "", nil, rpcErr
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, remote.String(), nil)
	if err != nil {
		return nil, "", "", nil, &mcpError{Code: -32602, Message: "invalid url"}
	}
	req.Header.Set("User-Agent", "openpost-mcp-media/"+h.serverVersion)
	resp, err := h.remoteMediaHTTPClient().Do(req)
	if err != nil {
		return nil, "", "", nil, &mcpError{Code: -32602, Message: "failed to fetch media url"}
	}
	defer func() { _ = resp.Body.Close() }()
	finalURL, content, rpcErr := h.readRemoteMediaResponse(ctx, resp)
	if rpcErr != nil {
		return nil, "", "", nil, rpcErr
	}

	filename := remoteMediaFilename(requestedFilename, finalURL)
	return finalURL, filename, resp.Header.Get("Content-Type"), content, nil
}

func (h *MCPHandler) readRemoteMediaResponse(ctx context.Context, resp *http.Response) (*url.URL, []byte, *mcpError) {
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, nil, &mcpError{Code: -32602, Message: fmt.Sprintf("media url returned HTTP %d", resp.StatusCode)}
	}
	finalURL := resp.Request.URL
	if rpcErr := h.validateMediaURL(ctx, finalURL); rpcErr != nil {
		return nil, nil, rpcErr
	}
	content, err := io.ReadAll(io.LimitReader(resp.Body, maxRemoteMediaBytes+1))
	if err != nil {
		return nil, nil, &mcpError{Code: -32603, Message: "failed to read remote media"}
	}
	if len(content) == 0 {
		return nil, nil, &mcpError{Code: -32602, Message: "remote media is empty"}
	}
	if len(content) > maxRemoteMediaBytes {
		return nil, nil, &mcpError{Code: -32602, Message: "file size exceeds 50MB limit"}
	}
	return finalURL, content, nil
}

func remoteMediaFilename(requestedFilename string, finalURL *url.URL) string {
	filename := cleanRemoteMediaFilename(requestedFilename)
	if filename == "" {
		filename = cleanRemoteMediaFilename(path.Base(finalURL.Path))
	}
	if filename == "" || filename == "." || filename == "/" {
		filename = "remote-media"
	}
	return filename
}

func (h *MCPHandler) remoteMediaHTTPClient() *http.Client {
	if h.mediaURLHTTP != nil {
		return h.mediaURLHTTP
	}
	client := netguard.NewHTTPClient(30*time.Second, mediaURLPolicy())
	client.CheckRedirect = func(req *http.Request, _ []*http.Request) error {
		validator := h.mediaURLValidator
		if validator == nil {
			validator = h.defaultValidateMediaURL
		}
		return validator(req.Context(), req.URL)
	}
	return client
}

func (h *MCPHandler) validateMediaURL(ctx context.Context, remote *url.URL) *mcpError {
	validator := h.mediaURLValidator
	if validator == nil {
		validator = h.defaultValidateMediaURL
	}
	if err := validator(ctx, remote); err != nil {
		return &mcpError{Code: -32602, Message: err.Error()}
	}
	return nil
}

func (h *MCPHandler) defaultValidateMediaURL(ctx context.Context, remote *url.URL) error {
	return netguard.ValidateURL(ctx, remote, mediaURLPolicy())
}

func mediaURLPolicy() netguard.URLPolicy {
	return netguard.URLPolicy{
		Label:            "url",
		AllowedSchemes:   []string{"http", "https"},
		AllowCustomPorts: true,
	}
}
func mcpSlotToolResult(suggestion mcpSlotSuggestion) map[string]any {
	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: suggestion.Message,
		}},
		"structuredContent": map[string]any{
			"suggestion": suggestion,
		},
	}
}
func normalizeMCPIDs(ids []string, field string) ([]string, *mcpError) {
	unique := make([]string, 0, len(ids))
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			return nil, &mcpError{Code: -32602, Message: field + " cannot contain empty values"}
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	return unique, nil
}

func cleanRemoteMediaFilename(filename string) string {
	filename = strings.TrimSpace(filename)
	filename = strings.Trim(filename, `/\`)
	if filename == "" || filename == "." {
		return ""
	}
	filename = path.Base(filename)
	filename = strings.ReplaceAll(filename, "\x00", "")
	return filename
}

func stringFromMap(values map[string]interface{}, key string) string {
	if value, ok := values[key].(string); ok {
		return value
	}
	return ""
}

func boolFromMap(values map[string]interface{}, key string) bool {
	if value, ok := values[key].(bool); ok {
		return value
	}
	return false
}

func int64FromMap(values map[string]interface{}, key string) int64 {
	switch value := values[key].(type) {
	case int64:
		return value
	case int:
		return int64(value)
	case float64:
		return int64(value)
	default:
		return 0
	}
}

func newUUID() string {
	return uuid.New().String()
}
