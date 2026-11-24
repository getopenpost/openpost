package handlers

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/apitokens"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	engagementservice "github.com/openpost/backend/internal/services/engagement"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicurl"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/uptrace/bun"
)

//go:embed mcp_ui.css
var mcpUIStyles string

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
	mcpToolCreatePub      = "create_post"
	mcpToolListPubs       = "list_posts"
	mcpToolGetPub         = "get_post"
	mcpToolUpdatePub      = "update_post"
	mcpToolPubRenditions  = "set_post_variants"
	mcpToolReplyRendition = "reply_to_variant"
	mcpToolValidatePub    = "validate_post"
	mcpToolSchedulePub    = "schedule_post"
	mcpToolCancelPub      = "cancel_post"
	mcpToolPublishPubNow  = "publish_post_now"
	mcpToolDeletePub      = "delete_post"
	mcpToolRetryFailed    = "retry_failed_variants"
	mcpToolRetryOne       = "retry_variant"
	mcpToolDeleteMedia    = "delete_media"
	mcpToolUpdateMedia    = "update_media"
	mcpToolGetMedia       = "get_media"
	mcpToolPubEvents      = "list_post_events"
	mcpToolComments       = "list_variant_comments"
	mcpToolReplyComment   = "reply_to_comment"
	mcpToolHideComment    = "hide_comment"
	mcpToolDeleteComment  = "delete_comment"
	mcpToolSuggestSlot    = "suggest_next_slot"
	mcpToolUploadURL      = "upload_media_from_url"
	mcpToolPostMetrics    = "get_post_metrics"
	mcpToolDashboardLink  = "get_dashboard_link"
	mcpToolSearchDocs     = "search_docs"
	mcpToolRenderWidget   = "render_scheduler_widget"
	mcpToolRenderUpload   = "render_local_media_upload"
	mcpToolCreateTicket   = "create_local_media_upload_ticket"
	mcpPromptPlanPost     = "plan_social_post"
	mcpPromptRenditions   = "adapt_post_variants"
	mcpPromptReviewQueue  = "review_schedule"
	mcpScopeRead          = apitokens.ScopeMCPRead
	mcpScopeFull          = apitokens.ScopeMCP
	maxRemoteMediaBytes   = 50 * 1024 * 1024
	maxMCPRequestBytes    = 12 * 1024 * 1024
	mcpAppWidgetURI       = "ui://widget/openpost-scheduler-v1.html"
	mcpUploadWidgetURI    = "ui://widget/openpost-local-upload-v1.html"
	mcpAppWidgetMimeType  = "text/html;profile=mcp-app"
	mcpMediaUploadTTL     = 10 * time.Minute
)

// mcpOperationAliases maps retired MCP operation names to their canonical
// replacements. tools/list and search_operations advertise the canonical names
// only; every alias below remains callable through tools/call, query_operation,
// and execute_operation so cached clients keep working. Aliases are permanent
// until a documented sunset removes them; see docs/development/mcp.md.
var mcpOperationAliases = map[string]string{
	"create_publication":         "create_post",
	"list_publications":          "list_posts",
	"get_publication":            "get_post",
	"update_publication":         "update_post",
	"set_publication_renditions": "set_post_variants",
	"reply_to_rendition":         "reply_to_variant",
	"validate_publication":       "validate_post",
	"schedule_publication":       "schedule_post",
	"cancel_publication":         "cancel_post",
	"publish_publication_now":    "publish_post_now",
	"list_publication_events":    "list_post_events",
	"list_rendition_comments":    "list_variant_comments",
}

// mcpPromptAliases maps retired MCP prompt names to their canonical
// replacements. prompts/list advertises the canonical names only.
var mcpPromptAliases = map[string]string{
	"adapt_platform_renditions": "adapt_post_variants",
}

// mcpArgumentAliases maps retired MCP argument keys to their canonical
// replacements. Calls may send either form; when both are present the
// canonical key wins. Structured output uses the canonical keys only, except
// for the documented top-level publication/publications keys which are
// unchanged.
var mcpArgumentAliases = map[string]string{
	"publication_id":         "post_id",
	"rendition_id":           "variant_id",
	"renditions":             "variants",
	"failed_rendition_count": "failed_variant_count",
}

// normalizeMCPOperationName returns the canonical operation name for a retired
// alias, or the input unchanged when it is already canonical.
func normalizeMCPOperationName(name string) string {
	if canonical, ok := mcpOperationAliases[strings.TrimSpace(name)]; ok {
		return canonical
	}
	return name
}

// normalizeMCPArgumentKeys rewrites retired argument keys in place. When both
// the retired and canonical forms are present, the canonical value wins.
func normalizeMCPArgumentKeys(args map[string]any) {
	for oldKey, newKey := range mcpArgumentAliases {
		oldValue, ok := args[oldKey]
		if !ok {
			continue
		}
		if _, exists := args[newKey]; !exists {
			args[newKey] = oldValue
		}
		delete(args, oldKey)
	}
}

// normalizeMCPDelegatedArguments rewrites a retired delegated operation name
// and retired argument keys inside query_operation/execute_operation envelopes.
func normalizeMCPDelegatedArguments(args map[string]any) {
	operation, _ := args["operation"].(string)
	if strings.TrimSpace(operation) != "" {
		args["operation"] = normalizeMCPOperationName(operation)
	}
	if inner, ok := args["arguments"].(map[string]any); ok {
		normalizeMCPArgumentKeys(inner)
	}
}

// mcpIdempotencyKeySchema describes the optional replay key accepted by every
// execute-mode mutation. It routes into the existing REST idempotency path
// (mutationIdempotencyRequest/idempotency.Execute).
func mcpIdempotencyKeySchema() map[string]any {
	return map[string]any{
		"type": "string", "minLength": 1, "maxLength": 200,
		"description": "Optional replay key scoped to the caller, workspace, and operation. Repeating a call with the same key returns the stored result instead of running the mutation again.",
	}
}

func mcpIdempotencyKeyFromArgs(args map[string]any) string {
	if args == nil {
		return ""
	}
	key, _ := args["idempotency_key"].(string)
	return strings.TrimSpace(key)
}

// mcpDetailSchema selects the post result shape. Summary is the default for
// mutations; full returns the complete post with ordered media and variants.
func mcpDetailSchema() map[string]any {
	return map[string]any{
		"type": "string", "enum": []string{"summary", "full"},
		"description": "Post result shape. Defaults to summary; use full when ordered media, variants, and delivery fields are needed.",
	}
}

func mcpPostDetail(args map[string]any) string {
	if args == nil {
		return "summary"
	}
	detail, _ := args["detail"].(string)
	if strings.TrimSpace(detail) == "full" {
		return "full"
	}
	return "summary"
}

// mcpConfirmSchema declares the machine-enforceable confirmation gate for
// irreversible tools. The handler rejects calls without confirm=true; prose
// approval alone is not sufficient.
func mcpConfirmSchema(description string) map[string]any {
	return map[string]any{
		"type":        "boolean",
		"description": description,
	}
}

func mcpRequireConfirm(args map[string]any, operation string) *mcpError {
	confirm, _ := args["confirm"].(bool)
	if !confirm {
		return &mcpError{Code: -32602, Message: operation + " is irreversible; repeat the call with confirm=true to proceed"}
	}
	return nil
}

func mcpDryRunFromArgs(args map[string]any) bool {
	if args == nil {
		return false
	}
	dryRun, _ := args["dry_run"].(bool)
	return dryRun
}

// mcpBuildIdempotencyRequest returns the REST idempotency request for an
// execute-mode mutation when the caller supplied idempotency_key. The second
// return is false when no key was supplied and the caller should run the
// mutation directly.
func mcpBuildIdempotencyRequest(ctx context.Context, workspaceID, operationID string, args map[string]any) (idempotency.Request, bool, *mcpError) {
	key := mcpIdempotencyKeyFromArgs(args)
	if key == "" {
		return idempotency.Request{}, false, nil
	}
	request, err := mutationIdempotencyRequest(ctx, workspaceID, operationID, key)
	if err != nil {
		return idempotency.Request{}, false, &mcpError{Code: -32602, Message: err.Error()}
	}
	return request, true, nil
}

func mcpIdempotencyError(err error, fallback string) *mcpError {
	if errors.Is(err, idempotency.ErrConflict) {
		return &mcpError{Code: -32602, Message: "idempotency key was already used with a different request"}
	}
	if errors.Is(err, idempotency.ErrInProgress) {
		return &mcpError{Code: -32603, Message: "idempotent request is still in progress"}
	}
	if errors.Is(err, idempotency.ErrInvalid) {
		return &mcpError{Code: -32602, Message: "invalid idempotency_key"}
	}
	return &mcpError{Code: -32603, Message: fallback}
}

type MCPHandler struct {
	db                *bun.DB
	auth              middleware.Authenticator
	entitlement       entitlements.Service
	usage             *usage.Service
	mediaStorage      mediastore.BlobStorage
	mediaHandler      *MediaHandler
	publicMedia       *publicurl.MediaVerifier
	mediaURLHTTP      *http.Client
	mediaURLValidator func(context.Context, *url.URL) error
	publicURL         string
	allowedOrigins    map[string]bool
	providers         map[string]platform.Adapter
	providersMu       sync.RWMutex
	dynamicMastodon   bool
	tokenEncryptor    *servicecrypto.TokenEncryptor
	tokenSource       AccessTokenSource
	readiness         *providerreadiness.Service
	serverVersion     string
	featureGate       engagementservice.FeatureGate
	engagement        *engagementservice.Service
	toolMode          mcpToolMode
}

func NewMCPHandler(db *bun.DB, authenticator middleware.Authenticator, entitlement ...entitlements.Service) *MCPHandler {
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

func (h *MCPHandler) SetMediaHandler(handler *MediaHandler) {
	h.mediaHandler = handler
}

func (h *MCPHandler) SetPublicMediaVerifier(verifier *publicurl.MediaVerifier) {
	h.publicMedia = verifier
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
	h.providersMu.Lock()
	defer h.providersMu.Unlock()
	h.providers = cloneProviderAdapters(providers)
	h.dynamicMastodon = dynamicMastodon
}

func (h *MCPHandler) SetProvider(name string, adapter platform.Adapter) {
	h.providersMu.Lock()
	defer h.providersMu.Unlock()
	if h.providers == nil {
		h.providers = map[string]platform.Adapter{}
	}
	h.providers[name] = adapter
}

func (h *MCPHandler) providerMapSnapshot() map[string]platform.Adapter {
	h.providersMu.RLock()
	defer h.providersMu.RUnlock()
	snapshot := make(map[string]platform.Adapter, len(h.providers))
	for name, adapter := range h.providers {
		snapshot[name] = adapter
	}
	return snapshot
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
	handler.SetTextCardStorage(h.mediaStorage)
	if h.usage != nil {
		handler.SetUsage(h.usage)
	}
	handler.providers = h.providerMapSnapshot()
	handler.tokenSource = h.tokenSource
	handler.readiness = h.readiness
	handler.SetPublicMediaVerifier(h.publicMedia)
	return handler
}

func (h *MCPHandler) RegisterRoutes(e *echo.Echo) {
	e.POST("/mcp", h.handle)
	e.GET("/mcp", h.handleStreamGetUnsupported)
	e.POST("/mcp/code", h.handleCodeMode)
	e.GET("/mcp/code", h.handleStreamGetUnsupported)
	e.PUT("/mcp/media-upload", h.handleLocalMediaUpload)
	e.GET("/.well-known/oauth-protected-resource", h.protectedResourceMetadata)
	e.HEAD("/.well-known/oauth-protected-resource", h.protectedResourceMetadata)
	e.GET("/.well-known/oauth-protected-resource/mcp", h.protectedResourceMetadata)
	e.HEAD("/.well-known/oauth-protected-resource/mcp", h.protectedResourceMetadata)
	e.GET("/.well-known/oauth-protected-resource/mcp/code", h.protectedResourceMetadata)
	e.HEAD("/.well-known/oauth-protected-resource/mcp/code", h.protectedResourceMetadata)
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
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	Data     string `json:"data,omitempty"`
	MimeType string `json:"mimeType,omitempty"`
}

type mcpHTTPFailure struct {
	status int
	body   any
}

var errMCPInsufficientScope = errors.New("insufficient MCP scope")

func (h *MCPHandler) handle(c echo.Context) error {
	return h.handleWithMode(c, h.mcpActiveToolMode())
}

func (h *MCPHandler) handleCodeMode(c echo.Context) error {
	return h.handleWithMode(c, mcpToolModeSearch)
}

func (h *MCPHandler) handleWithMode(c echo.Context, mode mcpToolMode) error {
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
	return h.processMCPRequest(c, principal, req, body, mode)
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

func (h *MCPHandler) processMCPRequest(c echo.Context, principal *middleware.Principal, req mcpRequest, body []byte, mode mcpToolMode) error {
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
	result, rpcErr := h.dispatch(c.Request().Context(), principal, req, protocolVersion, mode)
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
	if c.Request().Method == http.MethodHead {
		c.Response().Header().Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		return c.NoContent(http.StatusOK)
	}
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
	expectedOrigin, err := url.Parse(h.externalBaseURL(r))
	if err != nil || middleware.SessionOriginRejected(principal, r.Header.Get("Origin"), expectedOrigin.Host, expectedOrigin.Scheme) {
		return nil, fmt.Errorf("cross-site session request rejected")
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

// mcpToolMode selects which tool surface tools/list advertises. The mode is
// process-level (OPENPOST_MCP_MODE) so the visible set never varies
// per-connection except by caller auth scope; enforcement is identical in
// every mode and every advertised or cached name stays callable.
type mcpToolMode string

const (
	mcpToolModeDirect mcpToolMode = "direct"
	mcpToolModeSearch mcpToolMode = "search"
	mcpToolModeBoth   mcpToolMode = "both"
)

// SetToolMode selects the advertised MCP tool surface. Unknown values fall
// back to the direct default.
func (h *MCPHandler) SetToolMode(mode string) {
	switch mcpToolMode(strings.ToLower(strings.TrimSpace(mode))) {
	case mcpToolModeSearch:
		h.toolMode = mcpToolModeSearch
	case mcpToolModeBoth:
		h.toolMode = mcpToolModeBoth
	default:
		h.toolMode = mcpToolModeDirect
	}
}

func (h *MCPHandler) mcpActiveToolMode() mcpToolMode {
	if h.toolMode == mcpToolModeSearch || h.toolMode == mcpToolModeBoth {
		return h.toolMode
	}
	return mcpToolModeDirect
}

func (h *MCPHandler) mcpInstructions(scope string, mode mcpToolMode) string {
	const shared = " Connected Image and Video Editors expose editor_sessions, editor_context, structure and media inspection, and guarded live edits. Call editor_sessions first, then inspect stable IDs and the authored revision. A local project is available only while its browser editor remains connected. Each edit needs an explicit project ID, expected revision, and retry key. All delegated operations retain the same authorization, workspace scoping, schema validation, quota, and audit controls."
	var base string
	switch mode {
	case mcpToolModeSearch:
		base = "OpenPost schedules social posts and format-first posts through a compact safety-aware tool surface. Call search_operations with a plain-language task to discover relevant operation names and schemas. Call query_operation only for guaranteed read-only operations. Search again when required fields are unclear. Use render_scheduler_widget directly when a visual summary helps." + shared
	case mcpToolModeBoth:
		base = "OpenPost schedules social posts and format-first posts through a compact safety-aware tool surface. The listed operation tools are callable directly with their own arguments; alternatively, call search_operations with a plain-language task to discover relevant operation names and schemas, then query_operation for guaranteed read-only operations. Search again when required fields are unclear. Use render_scheduler_widget directly when a visual summary helps." + shared
	default:
		base = "OpenPost schedules social posts and format-first posts through a compact safety-aware tool surface. The listed operation tools are callable directly with their own arguments. Call query_operation only for guaranteed read-only operations. Use render_scheduler_widget directly when a visual summary helps." + shared
	}
	if mcpScopeIsReadOnly(scope) {
		return base + " This connection is read-only: mutation operations are hidden from discovery and rejected by the server."
	}
	if mode == mcpToolModeDirect {
		return base + " Run tools that change state or interact with external systems only after the user approves the mutation."
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

func (h *MCPHandler) dispatch(ctx context.Context, principal *middleware.Principal, req mcpRequest, protocolVersion string, mode mcpToolMode) (any, *mcpError) {
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
			"instructions": h.mcpInstructions(principal.Scope, mode),
			"capabilities": map[string]any{
				"tools":     map[string]any{"listChanged": false},
				"prompts":   map[string]any{"listChanged": false},
				"resources": map[string]any{"listChanged": false},
			},
		}, nil
	case "ping":
		return map[string]any{}, nil
	case "tools/list":
		return map[string]any{"tools": h.mcpAdvertisedToolsForScope(principal.Scope, mode)}, nil
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
	return append(mcpInboxTools(), []mcpOperationDefinition{
		mcpListWorkspacesTool(),
		mcpListProviderCatalogTool(),
		mcpListAccountsTool(),
		mcpLookupMentionsTool(),
		mcpListMediaTool(),
		mcpProviderReadinessTool(),
		mcpCreatePublicationTool(),
		mcpListPublicationsTool(),
		mcpGetPublicationTool(),
		mcpPreviewTextCardTool(),
		mcpUpdatePublicationTool(),
		mcpSetPublicationRenditionsTool(),
		mcpReplyToRenditionTool(),
		mcpValidatePublicationTool(),
		mcpSchedulePublicationTool(),
		mcpCancelPublicationTool(),
		mcpPublishPublicationNowTool(),
		mcpDeletePublicationTool(),
		mcpRetryFailedVariantsTool(),
		mcpRetryVariantTool(),
		mcpListPublicationEventsTool(),
		mcpListRenditionCommentsTool(),
		mcpReplyToCommentTool(),
		mcpHideCommentTool(),
		mcpDeleteCommentTool(),
		mcpSuggestNextSlotTool(),
		mcpUploadMediaFromURLTool(),
		mcpUploadMediaBase64Tool(),
		mcpPrepareMediaImageTool(),
		mcpPostMetricsTool(),
		mcpDashboardLinkTool(),
		mcpSearchDocsTool(),
		mcpGetMediaTool(),
		mcpUpdateMediaTool(),
		mcpDeleteMediaTool(),
		mcpEditorSessionsTool(),
		mcpEditorReferenceTool(),
		mcpEditorContextTool(),
		mcpEditorLibraryTool("library_search"),
		mcpEditorLibraryTool("library_inspect"),
		mcpEditorLibraryTool("library_apply"),
		mcpEditorLibraryTool("library_save"),
		mcpEditorLibraryTool("style_capture"),
		mcpEditorLibraryTool("style_preview"),
		mcpEditorPersonalizationTool("style_list"),
		mcpEditorPersonalizationTool("style_inspect"),
		mcpEditorPersonalizationTool("style_save"),
		mcpEditorPersonalizationTool("style_archive"),
		mcpEditorPersonalizationTool("preferences_get"),
		mcpEditorPersonalizationTool("preferences_set"),
		mcpEditorPersonalizationTool("preferences_remove"),
		mcpTimelineInspectTool(),
		mcpImageInspectTool(),
		mcpMediaSearchEditorTool(),
		mcpMediaInspectEditorTool(),
		mcpMediaLibraryTool(),
		mcpMediaAnalyzeTool(),
		mcpMediaAnalysisStatusTool(),
		mcpMediaAnalysisCancelTool(),
		mcpMediaFrameTool(),
		mcpMediaStoryboardTool(),
		mcpSceneAnalyzeTool(),
		mcpSceneAnalysisStatusTool(),
		mcpSceneAnalysisCancelTool(),
		mcpSceneSearchTool(),
		mcpSceneInspectTool(),
		mcpEditorPreviewTool(),
		mcpEditorAudioPreviewTool(),
		mcpEditorExportStartTool(),
		mcpEditorExportStatusTool(),
		mcpEditorExportCancelTool(),
		mcpEditorRevealTool(),
		mcpVideoEditTool(),
		mcpImageEditTool(),
		mcpEditorWorkStatusTool(),
		mcpEditorWorkCancelTool(),
		mcpEditorHistoryInspectTool(),
		mcpEditorHistoryUndoTool(),
		mcpEditorHistoryRedoTool(),
	}...)
}

// stringFromMap stays strict on purpose (issue #414): it reads internal
// upload-result maps ("id", "deduped"), not stored settings_json, and the
// public MCP surface accepts no new coercion. Values of an unexpected type
// read as "" rather than being coerced.
func stringFromMap(values map[string]interface{}, key string) string {
	if value, ok := values[key].(string); ok {
		return value
	}
	return ""
}

// boolFromMap stays strict on purpose (issue #414): it reads internal
// upload-result maps ("deduped"), not stored settings_json, and the public
// MCP surface accepts no new coercion. Only a bare bool reads true.
func boolFromMap(values map[string]interface{}, key string) bool {
	if value, ok := values[key].(bool); ok {
		return value
	}
	return false
}
