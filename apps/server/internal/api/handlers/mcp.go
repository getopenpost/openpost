package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
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
	"sync"
	"time"
	"unicode"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/idempotency"
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
	maxMCPRequestBytes    = 2 * 1024 * 1024
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
	toolMode          mcpToolMode
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

func (h *MCPHandler) SetMediaHandler(handler *MediaHandler) {
	h.mediaHandler = handler
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
	if h.usage != nil {
		handler.SetUsage(h.usage)
	}
	handler.providers = h.providerMapSnapshot()
	handler.tokenSource = h.tokenSource
	handler.readiness = h.readiness
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
	Type string `json:"type"`
	Text string `json:"text"`
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
	const shared = " All delegated operations retain the same authorization, workspace scoping, schema validation, quota, and audit controls."
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
		"title":       "Plan a post",
		"description": "Turn an idea into a workspace-aware OpenPost Post draft.",
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
		"title":       "Adapt post variants",
		"description": "Rewrite a Post in draft or scheduled state into platform-native destination copy.",
		"arguments": []map[string]any{
			{"name": "workspace_id", "description": "Workspace ID that owns the Post.", "required": true},
			{"name": "post_id", "description": "Draft or scheduled Post ID to adapt.", "required": true},
			{"name": "goal", "description": "Optional campaign goal, audience, or tone guidance.", "required": false},
		},
	}
}

func mcpReviewSchedulePrompt() map[string]any {
	return map[string]any{
		"name":        mcpPromptReviewQueue,
		"title":       "Review publishing queue",
		"description": "Inspect upcoming scheduled Posts and recommend useful next actions.",
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
	params.Name = strings.TrimSpace(params.Name)
	if canonical, ok := mcpPromptAliases[params.Name]; ok {
		params.Name = canonical
	}
	if params.Arguments != nil {
		normalized := make(map[string]string, len(params.Arguments))
		for key, value := range params.Arguments {
			normalized[key] = value
		}
		if _, ok := normalized["post_id"]; !ok {
			if legacy, ok := normalized["publication_id"]; ok {
				normalized["post_id"] = legacy
			}
		}
		delete(normalized, "publication_id")
		params.Arguments = normalized
	}
	if len(readOnly) > 0 && readOnly[0] && params.Name != mcpPromptReviewQueue {
		return nil, &mcpError{Code: -32602, Message: "this prompt requires mcp:full because it creates or changes OpenPost data"}
	}
	switch params.Name {
	case mcpPromptPlanPost:
		return mcpPromptResult("Plan an OpenPost Post draft from an idea.", mcpPlanPostPromptText(params.Arguments)), nil
	case mcpPromptRenditions:
		return mcpPromptResult("Adapt a Post into platform-native variants.", mcpRenditionsPromptText(params.Arguments)), nil
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
			"description": "Renders OpenPost workspaces, accounts, media, Posts, Variants, schedules, and provider status in ChatGPT.",
			"mimeType":    mcpAppWidgetMimeType,
			"_meta":       h.mcpAppWidgetResourceMeta(),
		}, {
			"uri":         mcpUploadWidgetURI,
			"name":        "openpost_local_media_upload",
			"title":       "OpenPost local media upload",
			"description": "Lets a person choose a local image or video and add it to an OpenPost workspace without exposing the upload credential to the model.",
			"mimeType":    mcpAppWidgetMimeType,
			"_meta":       h.mcpUploadWidgetResourceMeta(),
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
	switch params.URI {
	case mcpAppWidgetURI:
		return map[string]any{
			"contents": []map[string]any{{
				"uri":      mcpAppWidgetURI,
				"mimeType": mcpAppWidgetMimeType,
				"text":     mcpAppWidgetHTML(),
				"_meta":    h.mcpAppWidgetResourceMeta(),
			}},
		}, nil
	case mcpUploadWidgetURI:
		return map[string]any{
			"contents": []map[string]any{{
				"uri":      mcpUploadWidgetURI,
				"mimeType": mcpAppWidgetMimeType,
				"text":     mcpUploadWidgetHTML(),
				"_meta":    h.mcpUploadWidgetResourceMeta(),
			}},
		}, nil
	default:
		return nil, &mcpError{Code: -32602, Message: "unknown resource"}
	}
}

func (h *MCPHandler) mcpUploadWidgetResourceMeta() map[string]any {
	domain := mcpWidgetDomain(h.publicURL)
	connectDomains := []string{}
	if domain != "" {
		connectDomains = append(connectDomains, domain)
	}
	standardCSP := map[string]any{"connectDomains": connectDomains, "resourceDomains": []string{}}
	legacyCSP := map[string]any{"connect_domains": connectDomains, "resource_domains": []string{}}
	ui := map[string]any{"prefersBorder": true, "csp": standardCSP}
	meta := map[string]any{
		"ui":                         ui,
		"openai/widgetDescription":   "Choose a local file and upload it to the selected OpenPost workspace.",
		"openai/widgetPrefersBorder": true,
		"openai/widgetCSP":           legacyCSP,
	}
	if domain != "" {
		meta["openai/widgetDomain"] = domain
		ui["domain"] = domain
	}
	return meta
}

func (h *MCPHandler) mcpAppWidgetResourceMeta() map[string]any {
	standardCSP, legacyCSP := mcpAppWidgetCSP()
	ui := map[string]any{
		"prefersBorder": true,
		"csp":           standardCSP,
	}
	meta := map[string]any{
		"ui":                         ui,
		"openai/widgetDescription":   "OpenPost scheduler view for workspaces, accounts, media, Posts, Variants, schedules, and provider status.",
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
    if (data.variants) return "variants";
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
    if (!publication) return '<div class="empty">No Post data to show.</div>';
    var renditions = array(publication.renditions || publication.destinations).map(function (rendition) {
      return '<div class="row"><span class="muted">' + escapeHTML(rendition.platform || rendition.social_account_id || "destination") + '</span><span class="' + statusClass(rendition.status) + '">' + escapeHTML(rendition.status || "pending") + '</span></div>';
    }).join("");
    var media = array(publication.media).map(function (item) {
      return '<div class="row"><span class="muted">' + escapeHTML(item.original_filename || item.media_id || "media") + '</span><span class="pill idle">' + escapeHTML(item.mime_type || "asset") + '</span></div>';
    }).join("");
    var title = publication.title || publication.source_text || publication.content || publication.id || "Post";
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
    if (view === "variants") return renderCards(array(data.variants));
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

func mcpUploadWidgetHTML() string {
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upload media to OpenPost</title>
<style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}body{margin:0;padding:16px;background:Canvas;color:CanvasText}.panel{display:grid;gap:14px;padding:16px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:12px}h1{font-size:18px;margin:0}p{margin:0;color:color-mix(in srgb,CanvasText 70%,transparent);line-height:1.45}.field{display:grid;gap:6px}label{font-size:13px;font-weight:650}input{font:inherit;min-height:44px}button{min-height:44px;border:0;border-radius:8px;padding:0 16px;background:#0f8f5f;color:#fff;font:inherit;font-weight:700;cursor:pointer}button:disabled{cursor:not-allowed;opacity:.55}.status{min-height:22px;font-size:13px}.error{color:#c2413b}.success{color:#0f8f5f}
</style></head><body><main class="panel"><div><h1>Add local media</h1><p>Choose an image or video from this device. OpenPost validates it and adds it to your media library.</p></div><div class="field"><label for="file">Media file</label><input id="file" type="file" accept="image/*,video/*"></div><div class="field"><label for="alt">Alt text <span aria-hidden="true">(optional)</span></label><input id="alt" type="text" maxlength="2000"></div><button id="upload" type="button">Upload to OpenPost</button><div id="status" class="status" role="status" aria-live="polite"></div></main>
<script>
(function(){var file=document.getElementById('file'),alt=document.getElementById('alt'),button=document.getElementById('upload'),status=document.getElementById('status');
function input(){return (window.openai&&window.openai.toolInput)||{};} function show(text,kind){status.textContent=text;status.className='status '+(kind||'');}
button.addEventListener('click',async function(){var selected=file.files&&file.files[0],workspace=input().workspace_id;if(!selected){show('Choose a file first.','error');file.focus();return}if(!workspace){show('The upload is missing a workspace. Ask the agent to reopen it.','error');return}if(!window.openai||!window.openai.callTool){show('This MCP client does not support app tool calls.','error');return}button.disabled=true;show('Preparing secure upload…');try{var ticket=await window.openai.callTool('create_local_media_upload_ticket',{workspace_id:workspace,filename:selected.name,mime_type:selected.type||'application/octet-stream',size:selected.size,alt_text:alt.value.trim()});var upload=ticket&&ticket._meta&&ticket._meta.upload;if(!upload)throw new Error('OpenPost did not return an upload ticket');show('Uploading '+selected.name+'…');var response=await fetch(upload.url,{method:upload.method||'PUT',headers:upload.headers||{},body:selected});var result=await response.json();if(!response.ok)throw new Error(result.error||'Upload failed');show('Uploaded '+(result.original_filename||selected.name)+'.','success');if(window.openai.sendFollowUpMessage){await window.openai.sendFollowUpMessage({prompt:'Use the OpenPost media item '+result.id+' ('+(result.original_filename||selected.name)+') in this conversation.'});}}catch(error){show(error&&error.message?error.message:'Upload failed.','error')}finally{button.disabled=false}});
}());
</script></body></html>`
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
1. Call search_operations to load the schemas for list_workspaces, list_provider_catalog, list_accounts, list_media, upload_media_from_url, and create_post as needed.
2. If workspace_id is missing, call query_operation with list_workspaces and ask which workspace to use.
3. Call query_operation with list_provider_catalog and list_accounts to choose available destinations matching these platform hints: %s.
4. Call query_operation with list_media if the idea needs existing media, or call execute_operation with upload_media_from_url if the user supplied a public media URL.
5. Call execute_operation with create_post to create one concise draft and relevant media_ids. Do not schedule it until the user approves timing and destinations.
6. Explain what you created and suggest the next scheduling step.

workspace_id: %s
`, promptArg(args, "idea", "(missing idea)"), promptArg(args, "platforms", "any connected platforms"), promptArg(args, "workspace_id", "(choose with list_workspaces)")))
}

func mcpRenditionsPromptText(args map[string]string) string {
	return strings.TrimSpace(fmt.Sprintf(`
Adapt an existing OpenPost Post into platform-native variants.

workspace_id: %s
post_id: %s
goal: %s

Workflow:
1. Call search_operations to load the get_post and set_post_variants schemas.
2. Call query_operation with get_post to inspect destinations and current state.
3. Write concise, platform-native copy for each destination account.
4. Call execute_operation with set_post_variants and one variant per destination account.
5. Summarize what changed and mention any platforms that need media, hashtags, or shorter copy.
`, promptArg(args, "workspace_id", "(required)"), promptArg(args, "post_id", "(required)"), promptArg(args, "goal", "match the source Post and audience")))
}

func mcpReviewQueuePromptText(args map[string]string) string {
	return strings.TrimSpace(fmt.Sprintf(`
Review the OpenPost publishing queue and recommend useful next actions.

workspace_id: %s
window: %s

Workflow:
1. Call search_operations to load the list_posts and suggest_next_slot schemas.
2. Call query_operation with list_posts for the workspace and requested window. Prefer narrow windows of 7 to 14 days with activity_bucket scheduled; keep the default limit and repeat the request with the returned next_cursor while has_more is true, repeating all other filters unchanged. Calendar windows are limited to one page, so narrow the window instead of widening it when results do not fit.
3. Look for collisions, empty stretches, missing platform coverage, and Posts that need destination-specific Variants. Failed destinations are summarized per Post as failed_variant_count with a curated error_kind, error_action, and error_message; call get_post for full delivery detail and retry_failed_variants to retry safely retryable failures when a failure needs action.
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
		mcpRenderLocalUploadTool(),
		mcpCreateLocalUploadTicketTool(),
	}
}

// mcpSearchToolsForScope is the progressive-discovery surface: the
// search/query/execute trio plus the scheduler widget. It is the full
// listing in search mode and is appended to the direct listing in both mode.
func mcpSearchToolsForScope(scope string) []map[string]any {
	tools := mcpAdvertisedTools()
	if !mcpScopeIsReadOnly(scope) {
		return tools
	}
	readOnlyTools := make([]map[string]any, 0, len(tools)-1)
	for _, tool := range tools {
		if tool["name"] != mcpToolExecute && tool["name"] != mcpToolCreateTicket {
			readOnlyTools = append(readOnlyTools, tool)
		}
	}
	return readOnlyTools
}

// mcpDirectToolsForScope exposes the operation catalog itself: every
// operation is callable directly with its own arguments. Read-only scopes
// see only query-mode operations; enforcement for direct calls is identical
// to the delegated path.
func mcpDirectToolsForScope(scope string) []map[string]any {
	readOnly := mcpScopeIsReadOnly(scope)
	catalog := mcpOperationCatalog()
	tools := make([]map[string]any, 0, len(catalog)+1)
	for _, operation := range catalog {
		if readOnly && operation.Mode != mcpOperationQuery {
			continue
		}
		tools = append(tools, operation.Descriptor)
	}
	tools = append(tools, mcpRenderSchedulerWidgetTool())
	// render_local_media_upload changes no state and stays visible to
	// read-only connections; the ticket tool mints the upload credential.
	tools = append(tools, mcpRenderLocalUploadTool())
	if !readOnly {
		tools = append(tools, mcpCreateLocalUploadTicketTool())
	}
	return tools
}

func (h *MCPHandler) mcpAdvertisedToolsForScope(scope string, mode mcpToolMode) []map[string]any {
	switch mode {
	case mcpToolModeSearch:
		return mcpSearchToolsForScope(scope)
	case mcpToolModeBoth:
		tools := mcpDirectToolsForScope(scope)
		for _, tool := range mcpSearchToolsForScope(scope) {
			if tool["name"] == mcpToolRenderWidget || tool["name"] == mcpToolRenderUpload || tool["name"] == mcpToolCreateTicket {
				continue
			}
			tools = append(tools, tool)
		}
		return tools
	default:
		return mcpDirectToolsForScope(scope)
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
		mcpPostMetricsTool(),
		mcpDashboardLinkTool(),
		mcpSearchDocsTool(),
		mcpGetMediaTool(),
		mcpUpdateMediaTool(),
		mcpDeleteMediaTool(),
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
					"description": "Plain-language capability or operation name to find, such as 'create and schedule a video post' or 'list connected accounts'.",
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
	}, mcpToolSafety{ReadOnly: true, Idempotent: true})
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
	}, mcpToolSafety{ReadOnly: true, OpenWorld: true, Idempotent: true})
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
	"post_id":           "c66d7139-0549-4666-9374-124e988f97e7",
	"variant_id":        "08ac072f-f39f-4583-8202-53f5ddf47eb6",
	"media_id":          "30454fbe-246c-4d9d-9289-13e2c8df7f1e",
	"comment_id":        "eyJyZW5kaXRpb25faWQiOiAiMDhhYzA3MmYtZjM5Zi00NTgzLTgyMDItNTNmNWRkZjQ3ZWI2IiwgInByb3ZpZGVyX2NvbW1lbnRfaWQiOiAicHJvdmlkZXItY29tbWVudC0xMjMifQ",
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
		"description": "Inspect the provider catalog before choosing a social platform. Returns each provider's launch status, configuration state, capabilities, and availability notes. Then call list_accounts for workspace destinations and get_provider_readiness for account-scoped readiness checks.",
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
		"description": "List connected destinations before drafting or scheduling for a workspace. Returns active social account IDs, platforms, slugs, usernames, and instance URLs. Pair with list_provider_catalog for platform availability and get_provider_readiness for account-scoped checks before scheduling.",
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
		"description": "Find existing workspace assets before uploading or attaching media. Returns media IDs, file details, processing state, usage, and deletion eligibility in newest-first order, up to limit items per response. Follow next_cursor with the cursor input while has_more is true instead of widening the limit.",
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
				"cursor": map[string]any{
					"type":        "string",
					"description": "Opaque cursor from a previous response's next_cursor. Repeat all other filters unchanged while paging.",
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
		"description": "Check whether configured providers are ready before scheduling or publishing. Returns provider app, account scope, public-media, quota, and audit readiness details. Start from list_provider_catalog for platform availability, then list_accounts for the workspace destinations these checks evaluate.",
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
		"title":       "Create post",
		"description": "Create a format-first post draft when one source needs provider-specific outputs, such as a YouTube title and TikTok caption. Returns the post ID, profile, state, schedule, and variant count. The optional scheduled_at value only stores a desired time and never enqueues the post; call schedule_post after create_post to validate and enqueue, or publish_post_now to queue immediately.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id":    map[string]any{"type": "string", "description": "Workspace ID returned by list_workspaces."},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
				"content_profile": map[string]any{
					"type":        "string",
					"description": "OpenPost content profile: short_text, thread, link_share, image_post, carousel, story, short_video, or long_video.",
					"enum":        []string{"short_text", "thread", "link_share", "image_post", "carousel", "story", "short_video", "long_video"},
				},
				"title":       map[string]any{"type": "string", "description": "Internal post title."},
				"source_text": map[string]any{"type": "string", "description": "Canonical source text. Compute from description, caption, or title; do not expose this term to users."},
				"source_url":  map[string]any{"type": "string", "description": "Optional source URL for link shares."},
				"scheduled_at": map[string]any{
					"type":        "string",
					"format":      "date-time",
					"description": "Optional desired schedule time. Call schedule_post after create_post to validate and enqueue.",
				},
				"random_delay_minutes": map[string]any{
					"type": "integer", "minimum": 0, "maximum": 60,
					"description": "Optional random schedule delay in minutes (±N). Omit to inherit the Workspace setting when scheduled.",
				},
				"social_account_ids": map[string]any{
					"type":        "array",
					"description": "Destination account IDs returned by list_accounts. Used to create default variants when variants is omitted.",
					"items":       map[string]any{"type": "string"},
				},
				"media_ids": map[string]any{
					"type":        "array",
					"description": "Optional simple media attachment IDs. Prefer media when role, alt text, or thumbnail timestamp matters.",
					"items":       map[string]any{"type": "string"},
				},
				"media": map[string]any{
					"type":        "array",
					"description": "Default ordered media used by variants that do not provide their own media.",
					"items":       mediaSchema,
				},
				"variants": map[string]any{
					"type":        "array",
					"description": "Explicit account/provider outputs. Use fields by output role: body/caption as body, YouTube title as title, YouTube description as description, provider settings such as privacy.",
					"items":       mcpPublicationRenditionSchema(),
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
		"title":       "List posts",
		"description": "Find format-first posts before reading, editing, validating, or scheduling one. Returns matching post summaries in newest-first order, up to limit items per response. Prefer narrow calendar windows and follow next_cursor with the cursor input while has_more is true instead of widening the window. Failed destinations are summarized per post as failed_variant_count with curated error fields; call get_post for full delivery detail and retry_failed_variants to retry safely retryable failures.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id":    map[string]any{"type": "string", "description": "Workspace ID returned by list_workspaces."},
				"status":          map[string]any{"type": "string", "enum": []string{"draft", "ready", "scheduled", "publishing", "published", "failed"}, "description": "Optional post status filter."},
				"content_profile": map[string]any{"type": "string", "enum": []string{"short_text", "thread", "link_share", "image_post", "carousel", "story", "short_video", "long_video"}, "description": "Optional content profile filter."},
				"platform":        map[string]any{"type": "string", "description": "Optional destination platform filter, such as x, linkedin, or youtube."},
				"calendar_from":   map[string]any{"type": "string", "format": "date-time", "description": "Include calendar occurrences at or after this RFC3339 timestamp."},
				"calendar_before": map[string]any{"type": "string", "format": "date-time", "description": "Include calendar occurrences before this RFC3339 timestamp."},
				"activity_bucket": map[string]any{"type": "string", "enum": []string{"scheduled", "published", "failed", "draft"}, "description": "Optional calendar-compatible activity bucket."},
				"limit":           map[string]any{"type": "integer", "minimum": 1, "maximum": 100, "description": "Maximum posts to return. Defaults to 20."},
				"cursor":          map[string]any{"type": "string", "description": "Opaque cursor from a previous response's next_cursor. Repeat all other filters unchanged while paging."},
			},
			"required":             []string{"workspace_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpGetPublicationTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name": mcpToolGetPub, "title": "Get post",
		"description": "Read one format-first post when its full source and destination state is needed. Returns the post, ordered media, variants, and delivery fields.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id": map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"detail":  mcpDetailSchema(),
			},
			"required": []string{"post_id"}, "additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpUpdatePublicationTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name": mcpToolUpdatePub, "title": "Update post",
		"description": "Edit a post's source fields or proposed schedule while preserving omitted values. Returns the updated post and does not enqueue it for publishing.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id":         map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_post. Reload the post after a conflict before retrying.",
				},
				"title": map[string]any{"type": "string", "description": "Optional replacement internal title used to identify the post."},
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
					"description": "Clear the saved schedule and cancel its pending post job. Do not combine with scheduled_at.",
				},
				"random_delay_minutes": map[string]any{
					"type": "integer", "minimum": 0, "maximum": 60,
					"description": "Optional replacement random schedule delay in minutes (±N).",
				},
				"inherit_random_delay": map[string]any{
					"type": "boolean", "description": "Use the current Workspace random-delay setting when this Post is scheduled.",
				},
				"metadata": map[string]any{"type": "object", "description": "Optional replacement application metadata, e.g. {\"campaign\":\"spring-launch\"}.", "additionalProperties": true},
			},
			"required": []string{"post_id", "expected_revision"}, "additionalProperties": false,
		},
	}, mcpOperationExecute, false, false)
}

func mcpSetPublicationRenditionsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name": mcpToolPubRenditions, "title": "Set post variants",
		"description": "Replace every destination output after post accounts, provider fields, media roles, or captions change. Returns the post with its complete replacement variant set.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id":         map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_post. Reload the post after a conflict before retrying.",
				},
				"variants": map[string]any{
					"type": "array", "minItems": 1,
					"description": "Complete replacement list of destination-specific post outputs.",
					"items":       mcpPublicationRenditionSchema(),
				},
			},
			"required": []string{"post_id", "expected_revision", "variants"}, "additionalProperties": false,
		},
	}, mcpOperationExecute, false, false)
}

func mcpReplyToRenditionTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name": mcpToolReplyRendition, "title": "Reply to variant",
		"description": "Queue a reply to an already published provider variant, either now or at a future time. Returns the updated post status and durable reply job ID.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"variant_id":      map[string]any{"type": "string", "description": "Published variant ID returned by get_post."},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
				"body":            map[string]any{"type": "string", "description": "Reply text sent to the variant's provider thread."},
				"parent_id":       map[string]any{"type": "string", "description": "Optional provider-native parent reply ID when replying below a specific reply."},
				"run_at": map[string]any{
					"type": "string", "format": "date-time", "description": "Optional future RFC3339 execution time, such as 2026-08-01T09:30:00Z. Omit to queue immediately.",
				},
				"settings": map[string]any{"type": "object", "description": "Optional provider reply settings, e.g. {\"visibility\":\"public\"}.", "additionalProperties": true},
				"media": map[string]any{
					"type": "array", "description": "Optional ordered media attachments for the reply.", "items": mcpPublicationMediaSchema(),
				},
			},
			"required": []string{"variant_id", "body"}, "additionalProperties": false,
		},
	}, mcpOperationExecute, false, true)
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
			"id":                map[string]any{"type": "string", "description": "Optional existing variant ID when replacing a previously stored output."},
			"social_account_id": map[string]any{"type": "string", "description": "Destination account ID returned by list_accounts."},
			"profile": map[string]any{
				"type": "string", "description": "Optional content profile override for this destination.",
				"enum": []string{"short_text", "thread", "link_share", "image_post", "carousel", "story", "short_video", "long_video"},
			},
			"output_profile": map[string]any{"type": "string", "description": "Exact provider format ID returned by capability resolution."},
			"format_locked":  map[string]any{"type": "boolean", "description": "Preserve the explicitly selected format when source content changes."},
			"body":           map[string]any{"type": "string", "description": "Provider-native post text or caption."},
			"title":          map[string]any{"type": "string", "description": "Provider-native title, especially for YouTube videos."},
			"description":    map[string]any{"type": "string", "description": "Provider-native long description, especially for YouTube videos."},
			"settings":       map[string]any{"type": "object", "description": "Provider settings, e.g. {\"privacy\":\"public\"}.", "additionalProperties": true},
			"media":          map[string]any{"type": "array", "description": "Ordered media attachments for this destination output.", "items": mcpPublicationMediaSchema()},
		}, "required": []string{"social_account_id"}, "additionalProperties": false,
	}
}

func mcpValidatePublicationTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolValidatePub,
		"title":       "Validate post",
		"description": "Validate a post before scheduling or immediate publishing. Returns a valid flag plus actionable provider, media, account-scope, and processing issues. When valid is false, call get_post for the current delivery state; failed destinations retry through retry_failed_variants after the issues are fixed.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id": map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
			},
			"required":             []string{"post_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpSchedulePublicationTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolSchedulePub,
		"title":       "Schedule post",
		"description": "Validate and enqueue a post after its future scheduled_at value is set. Returns the scheduled post state and durable publishing job ID.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id":         map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
				"dry_run": map[string]any{
					"type":        "boolean",
					"description": "When true, validate the post and schedule readiness without enqueueing; returns the post state with an empty job ID.",
				},
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_post after the schedule time was saved.",
				},
				"execution_intent": map[string]any{
					"type": "string", "enum": []string{"production", "certification_test"},
					"description": "Optional typed readiness intent for this enqueue action. certification_test is restricted to an unscoped instance administrator.",
				},
			},
			"required":             []string{"post_id", "expected_revision"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, false, true)
}

func mcpCancelPublicationTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolCancelPub,
		"title":       "Cancel post",
		"description": "Cancel a scheduled post and its pending durable delivery work.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id":         map[string]any{"type": "string", "description": "Scheduled Post ID."},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
				"expected_revision": map[string]any{
					"type": "integer", "minimum": 1,
					"description": "Revision returned by get_post immediately before cancellation.",
				},
			},
			"required": []string{"post_id", "expected_revision"}, "additionalProperties": false,
		},
	}, mcpOperationExecute, false, true)
}

func mcpPublishPublicationNowTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolPublishPubNow,
		"title":       "Publish post now",
		"description": "Validate and queue a post when it should publish as soon as a worker is available. Returns the queued post state and durable publishing job ID. This action is irreversible once a worker picks it up; repeat the call with confirm=true to proceed.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id":         map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
				"dry_run": map[string]any{
					"type":        "boolean",
					"description": "When true, validate the post and publishing readiness without queueing; returns the post state with an empty job ID.",
				},
				"confirm": mcpConfirmSchema("Explicit confirmation that the post may publish immediately. Pass confirm=true on the second call."),
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_post immediately before publishing.",
				},
				"execution_intent": map[string]any{
					"type": "string", "enum": []string{"production", "certification_test"},
					"description": "Optional typed readiness intent for this enqueue action. certification_test is restricted to an unscoped instance administrator.",
				},
			},
			"required":             []string{"post_id", "expected_revision"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, false, true)
}

func mcpDeletePublicationTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolDeletePub,
		"title":       "Delete post",
		"description": "Permanently delete an editable post, its destination variants, and any linked draft. This action is irreversible; repeat the call with confirm=true to proceed. Returns a confirmation message and the deleted post ID.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id": map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_post immediately before deletion.",
				},
				"confirm":         mcpConfirmSchema("Explicit confirmation that the post may be permanently deleted. Pass confirm=true on the second call."),
				"idempotency_key": mcpIdempotencyKeySchema(),
			},
			"required":             []string{"post_id", "expected_revision", "confirm"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, true, false)
}

func mcpRetryFailedVariantsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolRetryFailed,
		"title":       "Retry failed variants",
		"description": "Queue one retry batch for the remaining safely retryable failed destination variants. Returns the post state and durable retry job ID.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id": map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_post immediately before retrying.",
				},
				"execution_intent": map[string]any{
					"type": "string", "enum": []string{"production", "certification_test"},
					"description": "Optional typed readiness intent for this retry action. certification_test is restricted to an unscoped instance administrator.",
				},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
			},
			"required":             []string{"post_id", "expected_revision"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, true, true)
}

func mcpRetryVariantTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolRetryOne,
		"title":       "Retry variant",
		"description": "Queue a retry for one failed destination variant with a confirmed safe delivery outcome. Returns the post state and durable retry job ID.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id":    map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"variant_id": map[string]any{"type": "string", "description": "Failed variant ID returned by get_post."},
				"expected_revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Revision returned by get_post immediately before retrying.",
				},
				"execution_intent": map[string]any{
					"type": "string", "enum": []string{"production", "certification_test"},
					"description": "Optional typed readiness intent for this retry action. certification_test is restricted to an unscoped instance administrator.",
				},
				"idempotency_key": mcpIdempotencyKeySchema(),
				"detail":          mcpDetailSchema(),
			},
			"required":             []string{"post_id", "variant_id", "expected_revision"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, true, true)
}

func mcpListPublicationEventsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolPubEvents,
		"title":       "List post events",
		"description": "Inspect post history when diagnosing delivery, retry, or moderation state. Returns ordered lifecycle events with status, message, metadata, and timestamps, up to limit items per response. Follow next_cursor with the cursor input while has_more is true.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id": map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
				"limit":   map[string]any{"type": "integer", "minimum": 1, "maximum": 200, "description": "Maximum events to return. Defaults to 100."},
				"cursor":  map[string]any{"type": "string", "description": "Opaque cursor from a previous response's next_cursor. Repeat the post_id unchanged while paging."},
			},
			"required":             []string{"post_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpListRenditionCommentsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolComments,
		"title":       "List variant comments",
		"description": "Read live comments before replying to or moderating a published variant. Returns up to limit provider comments with opaque OpenPost comment IDs safe for follow-up actions. Results beyond limit are truncated in provider order; the response text notes when truncation occurred.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"variant_id": map[string]any{"type": "string", "description": "Variant ID from a post's destination-specific output."},
				"limit":      map[string]any{"type": "integer", "minimum": 1, "maximum": 100, "description": "Maximum comments to return. Defaults to 50; extra provider results are truncated."},
			},
			"required":             []string{"variant_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, true)
}

func mcpReplyToCommentTool() mcpOperationDefinition {
	return mcpCommentActionTool(mcpToolReplyComment, "Reply to comment", "Queue a durable one-attempt provider reply after selecting an opaque ID from list_variant_comments. Returns a confirmation message and job ID.", true, false)
}

func mcpHideCommentTool() mcpOperationDefinition {
	return mcpCommentActionTool(mcpToolHideComment, "Hide comment", "Queue a durable one-attempt hide action when moderation is supported and removal is not required. Returns a confirmation message and job ID.", false, true)
}

func mcpDeleteCommentTool() mcpOperationDefinition {
	return mcpCommentActionTool(mcpToolDeleteComment, "Delete comment", "Queue a durable one-attempt deletion of a provider comment only when irreversible moderation is intended. Returns a confirmation message and job ID.", false, true)
}

func mcpCommentActionTool(name, title, description string, requiresBody, destructive bool) mcpOperationDefinition {
	properties := map[string]any{
		"comment_id":      map[string]any{"type": "string", "description": "Opaque comment ID returned by list_variant_comments."},
		"idempotency_key": mcpIdempotencyKeySchema(),
	}
	required := []string{"comment_id"}
	if requiresBody {
		properties["body"] = map[string]any{"type": "string", "description": "Reply text to send to the provider comment."}
		required = append(required, "body")
	}
	if name == mcpToolDeleteComment {
		properties["confirm"] = mcpConfirmSchema("Explicit confirmation that the provider comment may be permanently deleted. Pass confirm=true on the second call.")
		required = append(required, "confirm")
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
				"idempotency_key": mcpIdempotencyKeySchema(),
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

func mcpPostMetricsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolPostMetrics,
		"title":       "Get post metrics",
		"description": "Read stored analytics for a post when performance per destination is needed. Returns normalized views, reactions, engagements, impressions, and reach per variant plus post totals, from the stored analytics snapshots. Read-only; triggers no provider calls.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"post_id": map[string]any{"type": "string", "description": "Post ID returned by create_post or list_posts."},
			},
			"required":             []string{"post_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpDashboardLinkTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolDashboardLink,
		"title":       "Get dashboard link",
		"description": "Build a dashboard URL to hand to the user when they should see a visualization themselves. Pure URL builder from the configured app origin; reads no state beyond the workspace access check. Post links need an id; media, account, and calendar link to their views.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{"type": "string", "description": "Workspace ID returned by list_workspaces."},
				"kind": map[string]any{
					"type":        "string",
					"enum":        []string{"post", "media", "account", "calendar"},
					"description": "Dashboard view to link: a single post, the media library, connected accounts, or the calendar.",
				},
				"id": map[string]any{"type": "string", "description": "Post ID for kind post. Ignored for other kinds."},
			},
			"required":             []string{"workspace_id", "kind"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpSearchDocsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolSearchDocs,
		"title":       "Search docs",
		"description": "Search OpenPost documentation and assistant skills when setup, concept, or how-to guidance is needed. Returns matching guide titles, /docs paths, and snippets; resolve paths against the app origin. Backed by a curated offline registry, so it never calls external services.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{"type": "string", "description": "Plain-language topic to find, such as 'connect TikTok' or 'schedule a post'."},
				"limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 10, "description": "Maximum matching entries to return. Defaults to 5."},
			},
			"required":             []string{"query"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpGetMediaTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolGetMedia,
		"title":       "Get media",
		"description": "Read one workspace media asset when its file details, processing state, usage, or deletion eligibility is needed. Returns the media item.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"media_id": map[string]any{"type": "string", "description": "Media ID returned by list_media or upload_media_from_url."},
			},
			"required":             []string{"media_id"},
			"additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func mcpUpdateMediaTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolUpdateMedia,
		"title":       "Update media",
		"description": "Update a workspace media asset's favorite flag or alt text. Returns the updated media item with its usage and deletion eligibility.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"media_id":        map[string]any{"type": "string", "description": "Media ID returned by list_media or upload_media_from_url."},
				"favorite":        map[string]any{"type": "boolean", "description": "Optional replacement favorite flag."},
				"alt_text":        map[string]any{"type": "string", "description": "Optional replacement accessible alt text."},
				"idempotency_key": mcpIdempotencyKeySchema(),
			},
			"required":             []string{"media_id"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, true, false)
}

func mcpDeleteMediaTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolDeleteMedia,
		"title":       "Delete media",
		"description": "Move a workspace media asset to Trash when list_media reports can_delete. This action is irreversible without a restore; repeat the call with confirm=true to proceed. Returns a confirmation message and the deleted media ID.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"media_id":        map[string]any{"type": "string", "description": "Media ID returned by list_media."},
				"confirm":         mcpConfirmSchema("Explicit confirmation that the media may be moved to Trash. Pass confirm=true on the second call."),
				"idempotency_key": mcpIdempotencyKeySchema(),
			},
			"required":             []string{"media_id", "confirm"},
			"additionalProperties": false,
		},
	}, mcpOperationExecute, true, false)
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
	}, mcpToolSafety{ReadOnly: true, Idempotent: true})
}

func mcpRenderLocalUploadTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolRenderUpload,
		"title":       "Upload local media",
		"description": "Open a secure file picker so the user can add an image or video from their device to an OpenPost workspace. Returns the selected workspace for the upload widget.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{"type": "string", "description": "Workspace ID returned by list_workspaces."},
			},
			"required": []string{"workspace_id"}, "additionalProperties": false,
		},
	}, mcpToolSafety{ReadOnly: true, Idempotent: true})
}

func mcpCreateLocalUploadTicketTool() map[string]any {
	tool := mcpToolDescriptor(map[string]any{
		"name":        mcpToolCreateTicket,
		"title":       "Prepare local media upload",
		"description": "Create a one-use upload ticket for the local-media widget. Returns only non-secret readiness data to model context.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id":    map[string]any{"type": "string"},
				"filename":        map[string]any{"type": "string", "minLength": 1, "maxLength": 1024},
				"mime_type":       map[string]any{"type": "string", "maxLength": 255},
				"size":            map[string]any{"type": "integer", "minimum": 1, "maximum": MaxMediaUploadBytes},
				"alt_text":        map[string]any{"type": "string", "maxLength": 2000},
				"idempotency_key": mcpIdempotencyKeySchema(),
			},
			"required": []string{"workspace_id", "filename", "size"}, "additionalProperties": false,
		},
	}, mcpToolSafety{Destructive: true})
	meta := tool["_meta"].(map[string]any)
	meta["ui"] = map[string]any{"visibility": []string{"app"}}
	meta["openai/widgetAccessible"] = true
	return tool
}

type mcpToolSafety struct {
	ReadOnly    bool
	Destructive bool
	OpenWorld   bool
	Idempotent  bool
}

func mcpOperationDescriptor(tool map[string]any, mode mcpOperationMode, destructive, openWorld bool) mcpOperationDefinition {
	switch mode {
	case mcpOperationQuery:
		if destructive {
			panic("read-only MCP operations cannot be destructive")
		}
	case mcpOperationExecute:
		// Every state-changing operation advertises destructiveHint=true so
		// clients gate mutations as a whole. openWorldHint stays split:
		// true only for operations that reach external provider systems.
		destructive = true
	default:
		panic("invalid MCP operation mode: " + mode)
	}
	return mcpOperationDefinition{
		Descriptor: mcpToolDescriptor(tool, mcpToolSafety{
			ReadOnly:    mode == mcpOperationQuery,
			Destructive: destructive,
			OpenWorld:   openWorld,
			Idempotent:  mode == mcpOperationQuery,
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
		"idempotentHint":  safety.Idempotent,
	}
	status := mcpToolInvocationStatus(toolName)
	meta := map[string]any{
		"securitySchemes":                securitySchemes,
		"openai/toolInvocation/invoking": status.Invoking,
		"openai/toolInvocation/invoked":  status.Invoked,
	}
	if mcpToolUsesAppWidget(toolName) {
		resourceURI := mcpAppWidgetURI
		if toolName == mcpToolRenderUpload {
			resourceURI = mcpUploadWidgetURI
		}
		meta["ui"] = map[string]any{
			"resourceUri": resourceURI,
			"visibility":  []string{"model"},
		}
		meta["openai/outputTemplate"] = resourceURI
		meta["openai/widgetAccessible"] = toolName == mcpToolRenderUpload
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
	return toolName == mcpToolRenderWidget || toolName == mcpToolRenderUpload
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
	mcpToolCreatePub:      {Invoking: "Creating post", Invoked: "Post created"},
	mcpToolListPubs:       {Invoking: "Loading posts", Invoked: "Posts loaded"},
	mcpToolGetPub:         {Invoking: "Loading post", Invoked: "Post loaded"},
	mcpToolUpdatePub:      {Invoking: "Updating post", Invoked: "Post updated"},
	mcpToolPubRenditions:  {Invoking: "Updating post variants", Invoked: "Post variants updated"},
	mcpToolReplyRendition: {Invoking: "Queueing reply", Invoked: "Reply queued"},
	mcpToolValidatePub:    {Invoking: "Validating post", Invoked: "Post validated"},
	mcpToolSchedulePub:    {Invoking: "Scheduling post", Invoked: "Post scheduled"},
	mcpToolCancelPub:      {Invoking: "Cancelling post", Invoked: "Post cancelled"},
	mcpToolPublishPubNow:  {Invoking: "Queueing post", Invoked: "Post queued"},
	mcpToolDeletePub:      {Invoking: "Deleting post", Invoked: "Post deleted"},
	mcpToolRetryFailed:    {Invoking: "Retrying failed variants", Invoked: "Variant retry queued"},
	mcpToolRetryOne:       {Invoking: "Retrying variant", Invoked: "Variant retry queued"},
	mcpToolDeleteMedia:    {Invoking: "Deleting media", Invoked: "Media deleted"},
	mcpToolUpdateMedia:    {Invoking: "Updating media", Invoked: "Media updated"},
	mcpToolGetMedia:       {Invoking: "Loading media", Invoked: "Media loaded"},
	mcpToolPubEvents:      {Invoking: "Loading post events", Invoked: "Post events loaded"},
	mcpToolComments:       {Invoking: "Loading comments", Invoked: "Comments loaded"},
	mcpToolReplyComment:   {Invoking: "Queueing comment reply", Invoked: "Comment reply queued"},
	mcpToolHideComment:    {Invoking: "Queueing comment hide", Invoked: "Comment hide queued"},
	mcpToolDeleteComment:  {Invoking: "Queueing comment deletion", Invoked: "Comment deletion queued"},
	mcpToolSuggestSlot:    {Invoking: "Finding next slot", Invoked: "Next slot found"},
	mcpToolUploadURL:      {Invoking: "Uploading media", Invoked: "Media uploaded"},
	mcpToolPostMetrics:    {Invoking: "Loading post metrics", Invoked: "Post metrics loaded"},
	mcpToolDashboardLink:  {Invoking: "Building dashboard link", Invoked: "Dashboard link ready"},
	mcpToolSearchDocs:     {Invoking: "Searching docs", Invoked: "Docs found"},
	mcpToolRenderWidget:   {Invoking: "Rendering view", Invoked: "View rendered"},
	mcpToolRenderUpload:   {Invoking: "Opening local upload", Invoked: "Local upload ready"},
	mcpToolCreateTicket:   {Invoking: "Preparing upload", Invoked: "Upload ready"},
}

func mcpToolInvocationStatus(toolName string) mcpToolStatus {
	if status, ok := mcpToolStatuses[toolName]; ok {
		return status
	}
	return mcpToolStatus{Invoking: "Running tool", Invoked: "Tool complete"}
}

//nolint:gocyclo // Tool cases are a flat schema catalog, not nested control flow.
func mcpToolOutputSchema(toolName string) map[string]any {
	if toolName == mcpToolListPubs {
		return mcpStructuredOutputSchema(map[string]any{
			"publications": mcpArraySchema(mcpOpenObjectSchema()),
			"has_more":     map[string]any{"type": "boolean"},
			"next_cursor":  map[string]any{"type": "string"},
			"total_count":  map[string]any{"type": "integer"},
		}, "publications")
	}
	if toolName == mcpToolListMedia {
		return mcpStructuredOutputSchema(map[string]any{
			"media":       mcpArraySchema(mcpOpenObjectSchema()),
			"has_more":    map[string]any{"type": "boolean"},
			"next_cursor": map[string]any{"type": "string"},
			"total_count": map[string]any{"type": "integer"},
		}, "media")
	}
	if toolName == mcpToolPubEvents {
		return mcpStructuredOutputSchema(map[string]any{
			"events":      mcpArraySchema(mcpOpenObjectSchema()),
			"has_more":    map[string]any{"type": "boolean"},
			"next_cursor": map[string]any{"type": "string"},
			"total_count": map[string]any{"type": "integer"},
		}, "events")
	}
	if key, ok := mcpArrayOutputKey(toolName); ok {
		return mcpStructuredOutputSchema(map[string]any{
			key: mcpArraySchema(mcpOpenObjectSchema()),
		}, key)
	}
	switch toolName {
	case mcpToolCreatePub, mcpToolGetPub, mcpToolUpdatePub, mcpToolPubRenditions, mcpToolCancelPub,
		mcpToolSchedulePub, mcpToolPublishPubNow, mcpToolReplyRendition, mcpToolRetryFailed, mcpToolRetryOne:
		return mcpStructuredOutputSchema(map[string]any{
			"publication": mcpOpenObjectSchema(),
			"job_id":      map[string]any{"type": "string"},
		}, "publication", "job_id")
	case mcpToolDeletePub:
		return mcpStructuredOutputSchema(map[string]any{
			"message": map[string]any{"type": "string"},
			"post_id": map[string]any{"type": "string"},
			"job_id":  map[string]any{"type": "string"},
		}, "message", "post_id")
	case mcpToolGetMedia, mcpToolUpdateMedia:
		return mcpStructuredOutputSchema(map[string]any{
			"media": mcpOpenObjectSchema(),
		}, "media")
	case mcpToolDeleteMedia:
		return mcpStructuredOutputSchema(map[string]any{
			"message":  map[string]any{"type": "string"},
			"media_id": map[string]any{"type": "string"},
		}, "message", "media_id")
	case mcpToolReplyComment, mcpToolHideComment, mcpToolDeleteComment:
		return mcpStructuredOutputSchema(map[string]any{
			"message": map[string]any{"type": "string"}, "job_id": map[string]any{"type": "string"},
		}, "message", "job_id")
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
	case mcpToolPostMetrics:
		return mcpStructuredOutputSchema(map[string]any{
			"post_id":  map[string]any{"type": "string"},
			"variants": mcpArraySchema(mcpOpenObjectSchema()),
			"totals":   mcpOpenObjectSchema(),
		}, "post_id", "variants", "totals")
	case mcpToolDashboardLink:
		return mcpStructuredOutputSchema(map[string]any{
			"url":          map[string]any{"type": "string"},
			"kind":         map[string]any{"type": "string"},
			"workspace_id": map[string]any{"type": "string"},
		}, "url", "kind", "workspace_id")
	case mcpToolSearchDocs:
		return mcpStructuredOutputSchema(map[string]any{
			"results": mcpArraySchema(mcpOpenObjectSchema()),
		}, "results")
	case mcpToolRenderWidget:
		return mcpStructuredOutputSchema(map[string]any{
			"view":         map[string]any{"type": "string", "enum": mcpSchedulerWidgetViews()},
			"title":        map[string]any{"type": "string"},
			"workspace_id": map[string]any{"type": "string"},
			"data":         mcpOpenObjectSchema(),
		}, "view", "data")
	case mcpToolRenderUpload:
		return mcpStructuredOutputSchema(map[string]any{
			"workspace_id": map[string]any{"type": "string"},
		}, "workspace_id")
	case mcpToolCreateTicket:
		return mcpStructuredOutputSchema(map[string]any{
			"ready":      map[string]any{"type": "boolean"},
			"expires_at": map[string]any{"type": "string"},
		}, "ready", "expires_at")
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
		message = "No matching OpenPost operations found. Try a focused capability phrase such as 'draft', 'scheduled post', 'media', or 'connected accounts'."
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
	normalizeMCPArgumentKeys(params.Arguments)
	if canonicalName == mcpToolQuery || canonicalName == mcpToolExecute {
		normalizeMCPDelegatedArguments(params.Arguments)
	}
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
	if canonicalName == mcpToolExecute || canonicalName == mcpToolCreateTicket {
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
			auditToolName = normalizeMCPOperationName(strings.TrimSpace(operationName))
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
		input.Operation = normalizeMCPOperationName(input.Operation)
		normalizeMCPArgumentKeys(input.Arguments)
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
		return normalizeMCPOperationName(name)
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
	name = normalizeMCPOperationName(name)
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
	operation = normalizeMCPOperationName(operation)
	switch operation {
	case mcpToolWorkspaces, mcpToolProviders, mcpToolSearchDocs:
		return h.callReadOnlyGlobalTool(ctx, userID, operation, args)
	case mcpToolAccounts, mcpToolListMedia, mcpToolReadiness, mcpToolPostMetrics, mcpToolDashboardLink:
		return h.callReadOnlyWorkspaceTool(ctx, userID, operation, args)
	case mcpToolRenderWidget:
		return h.renderSchedulerWidget(args)
	case mcpToolRenderUpload:
		return h.renderLocalMediaUpload(ctx, userID, args)
	case mcpToolCreateTicket:
		return h.createLocalMediaUploadTicket(ctx, userID, args)
	case mcpToolCreatePub, mcpToolListPubs, mcpToolGetPub, mcpToolUpdatePub, mcpToolPubRenditions, mcpToolReplyRendition,
		mcpToolValidatePub, mcpToolSchedulePub, mcpToolCancelPub, mcpToolPublishPubNow, mcpToolDeletePub,
		mcpToolRetryFailed, mcpToolRetryOne, mcpToolPubEvents, mcpToolComments,
		mcpToolReplyComment, mcpToolHideComment, mcpToolDeleteComment, mcpToolSuggestSlot, mcpToolUploadURL,
		mcpToolGetMedia, mcpToolUpdateMedia, mcpToolDeleteMedia:
		return h.callWorkspaceActionTool(ctx, userID, operation, args)
	default:
		return nil, &mcpError{Code: -32602, Message: fmt.Sprintf("unknown operation %q; call %s to discover supported operations", operation, mcpToolSearch)}
	}
}

func (h *MCPHandler) callWorkspaceActionTool(ctx context.Context, userID, toolName string, args map[string]any) (any, *mcpError) {
	toolName = normalizeMCPOperationName(toolName)
	switch toolName {
	case mcpToolCreatePub, mcpToolListPubs, mcpToolGetPub, mcpToolUpdatePub, mcpToolPubRenditions, mcpToolReplyRendition,
		mcpToolValidatePub, mcpToolSchedulePub, mcpToolCancelPub, mcpToolPublishPubNow, mcpToolDeletePub,
		mcpToolRetryFailed, mcpToolRetryOne, mcpToolPubEvents, mcpToolComments,
		mcpToolReplyComment, mcpToolHideComment, mcpToolDeleteComment:
		return h.callPublicationTool(ctx, userID, toolName, args)
	case mcpToolGetMedia, mcpToolUpdateMedia, mcpToolDeleteMedia:
		return h.callMediaTool(ctx, userID, toolName, args)
	case mcpToolSuggestSlot:
		return h.suggestNextSlot(ctx, userID, args)
	case mcpToolUploadURL:
		return h.uploadMediaFromURL(ctx, userID, args)
	default:
		return nil, &mcpError{Code: -32602, Message: "unknown tool"}
	}
}

//nolint:gocyclo // Each switch case delegates one tool to its owning operation.
func (h *MCPHandler) callPublicationTool(ctx context.Context, userID, toolName string, args map[string]any) (any, *mcpError) {
	toolName = normalizeMCPOperationName(toolName)
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
	case mcpToolDeletePub:
		return h.deletePublication(ctx, userID, args)
	case mcpToolRetryFailed:
		return h.retryFailedVariants(ctx, userID, args)
	case mcpToolRetryOne:
		return h.retryVariant(ctx, userID, args)
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
	case mcpToolPostMetrics:
		return h.getPostMetrics(ctx, userID, args)
	case mcpToolDashboardLink:
		return h.dashboardLink(ctx, userID, args)
	default:
		return nil, &mcpError{Code: -32602, Message: "unknown tool"}
	}
}

func (h *MCPHandler) callReadOnlyGlobalTool(ctx context.Context, userID, toolName string, args map[string]any) (any, *mcpError) {
	switch toolName {
	case mcpToolWorkspaces:
		return h.listWorkspaces(ctx, userID)
	case mcpToolProviders:
		return h.listProviderCatalog(ctx), nil
	case mcpToolSearchDocs:
		return h.searchDocs(args)
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
	return []string{"summary", "workspaces", "providers", "accounts", "media", "publication", "publications", "post", "posts", "suggestion", "renditions", "variants"}
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
	case data["variants"] != nil:
		return "variants"
	default:
		return "summary"
	}
}

func decodeMCPArguments(args map[string]any, dest any) error {
	normalizeMCPArgumentKeys(args)
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
		providerAvailability(h.providerMapSnapshot(), h.dynamicMastodon),
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
	Renditions         []RenditionInput        `json:"variants"`
	IdempotencyKey     string                  `json:"idempotency_key"`
	Detail             string                  `json:"detail"`
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
	// FailedRenditionCount counts destination renditions in failed status.
	// ErrorKind, ErrorAction, and ErrorMessage summarize the first failed
	// rendition using the same curated taxonomy stored on the rendition
	// (never raw provider response bodies).
	FailedRenditionCount int    `json:"failed_variant_count"`
	ErrorKind            string `json:"error_kind,omitempty"`
	ErrorAction          string `json:"error_action,omitempty"`
	ErrorMessage         string `json:"error_message,omitempty"`
}

// mcpPublicationStatusFromResponse renders the list summary for one
// canonical Publication, including its safe failure summary.
func mcpPublicationStatusFromResponse(publication PublicationResponse) mcpPublicationStatus {
	status := mcpPublicationStatus{
		ID: publication.ID, WorkspaceID: publication.WorkspaceID, Title: publication.Title,
		ContentProfile: publication.ContentProfile, Status: publication.Status, Revision: publication.Revision,
		SourceText: publication.SourceText, SourceURL: publication.SourceURL, ScheduledAt: publication.ScheduledAt,
		RandomDelayMinutes: publication.RandomDelayMinutes, RandomDelayInherited: publication.RandomDelayInherited,
		CreatedAt: publication.CreatedAt,
		UpdatedAt: publication.UpdatedAt, RenditionCount: len(publication.Renditions),
	}
	for _, rendition := range publication.Renditions {
		if rendition.Status != models.RenditionStatusFailed {
			continue
		}
		status.FailedRenditionCount++
		if status.FailedRenditionCount == 1 {
			status.ErrorKind = rendition.ErrorKind
			status.ErrorAction = rendition.ErrorAction
			status.ErrorMessage = rendition.ErrorMessage
		}
	}
	return status
}

func (h *MCPHandler) createPublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input mcpCreatePublicationInput
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid create_post arguments"}
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
	body := CreatePublicationBody{
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
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		return h.createPublicationIdempotent(ctx, userID, body, args)
	}
	publication, err := h.publicationHandler().publicationApplication().Create(ctx, userID, body)
	if err != nil {
		return nil, mcpPublicationCreateError(err)
	}
	return h.mcpPostResult(ctx, userID, publication.ID, "Post created: "+publication.ID, "", args)
}

func (h *MCPHandler) createPublicationIdempotent(ctx context.Context, userID string, body CreatePublicationBody, args map[string]any) (any, *mcpError) {
	request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, body.WorkspaceID, "create-publication", args)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if !ok {
		publication, err := h.publicationHandler().publicationApplication().Create(ctx, userID, body)
		if err != nil {
			return nil, mcpPublicationCreateError(err)
		}
		return h.mcpPostResult(ctx, userID, publication.ID, "Post created: "+publication.ID, "", args)
	}
	publication, _, err := h.publicationHandler().publicationApplicationForTesting().CreateIdempotent(ctx, userID, body, request)
	if err != nil {
		if errors.Is(err, idempotency.ErrConflict) {
			return nil, mcpIdempotencyError(err, "failed to create post")
		}
		return nil, mcpPublicationCreateError(err)
	}
	return h.mcpPostResult(ctx, userID, publication.ID, "Post created: "+publication.ID, "", args)
}

func mcpPublicationCreateError(err error) *mcpError {
	var statusErr huma.StatusError
	if errors.As(err, &statusErr) && statusErr.GetStatus() < http.StatusInternalServerError {
		return &mcpError{Code: -32602, Message: statusErr.Error()}
	}
	return &mcpError{Code: -32603, Message: "failed to create post"}
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
		Cursor         string `json:"cursor"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid list_posts arguments"}
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	page, err := h.publicationHandler().publicationApplication().List(ctx, userID, ListPublicationsInput{
		WorkspaceID: input.WorkspaceID, Status: input.Status, ActivityBucket: input.ActivityBucket,
		ContentProfile: input.ContentProfile, Platform: input.Platform,
		CalendarFrom: input.CalendarFrom, CalendarBefore: input.CalendarBefore,
		Limit: limit, Cursor: strings.TrimSpace(input.Cursor),
	})
	if err != nil {
		return nil, publicationMutationMCPError(err, "failed to list posts")
	}
	publications := make([]mcpPublicationStatus, 0, len(page.Publications))
	for _, publication := range page.Publications {
		publications = append(publications, mcpPublicationStatusFromResponse(publication))
	}
	text := fmt.Sprintf("Found %d posts.", len(publications))
	if page.HasMore {
		text = fmt.Sprintf("Found %d posts; more are available. Repeat the request with cursor %q while has_more is true.", len(publications), page.NextCursor)
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: text}},
		"structuredContent": map[string]any{
			"publications": publications,
			"has_more":     page.HasMore,
			"next_cursor":  page.NextCursor,
			"total_count":  page.TotalCount,
		},
	}, nil
}

func (h *MCPHandler) getPublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	publicationID, rpcErr := decodeMCPPublicationID(args, "invalid get_post arguments")
	if rpcErr != nil {
		return nil, rpcErr
	}
	publication, err := h.publicationHandler().publicationApplication().Get(ctx, userID, publicationID)
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: "post not found or unavailable"}
	}
	if mcpPostDetail(args) == "summary" {
		status := mcpPublicationStatusFromResponse(publication)
		return map[string]any{
			"content":           []mcpContent{{Type: "text", Text: "Post loaded: " + publication.ID}},
			"structuredContent": map[string]any{"publication": status, "job_id": ""},
		}, nil
	}
	return map[string]any{
		"content":           []mcpContent{{Type: "text", Text: "Post loaded: " + publication.ID}},
		"structuredContent": map[string]any{"publication": publication, "job_id": ""},
	}, nil
}

type mcpPublicationUpdateInput struct {
	PublicationID      string                  `json:"post_id"`
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
	IdempotencyKey     string                  `json:"idempotency_key"`
	Detail             string                  `json:"detail"`
}

func (h *MCPHandler) updatePublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input mcpPublicationUpdateInput
	if err := decodeMCPArguments(args, &input); err != nil ||
		strings.TrimSpace(input.PublicationID) == "" ||
		input.ExpectedRevision < 1 {
		return nil, &mcpError{Code: -32602, Message: "invalid update_post arguments"}
	}
	body := PublicationUpdateBody{
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
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, "", "update-publication", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			publication, _, err := h.publicationHandler().publicationApplicationForTesting().UpdateIdempotent(ctx, userID, input.PublicationID, body, request)
			if err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to update post")
				}
				return nil, publicationMutationMCPError(err, "failed to update post")
			}
			return h.mcpPostResult(ctx, userID, publication.ID, "Post updated: "+publication.ID, "", args)
		}
	}
	if err := h.publicationHandler().publicationApplication().Update(ctx, userID, input.PublicationID, body); err != nil {
		return nil, publicationMutationMCPError(err, "failed to update post")
	}
	return h.mcpPostResult(ctx, userID, input.PublicationID, "Post updated: "+input.PublicationID, "", args)
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
		PublicationID    string           `json:"post_id"`
		ExpectedRevision int              `json:"expected_revision"`
		Renditions       []RenditionInput `json:"variants"`
		IdempotencyKey   string           `json:"idempotency_key"`
		Detail           string           `json:"detail"`
	}
	if err := decodeMCPArguments(args, &input); err != nil ||
		strings.TrimSpace(input.PublicationID) == "" ||
		input.ExpectedRevision < 1 ||
		len(input.Renditions) == 0 {
		return nil, &mcpError{Code: -32602, Message: "invalid set_post_variants arguments"}
	}
	handler := h.publicationHandler()
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		publication, err := handler.publicationApplication().Get(ctx, userID, strings.TrimSpace(input.PublicationID))
		if err != nil {
			return nil, &mcpError{Code: -32602, Message: "post not found or unavailable"}
		}
		accountMap, err := handler.loadAccounts(ctx, publication.WorkspaceID, renditionAccountIDs(input.Renditions))
		if err != nil {
			return nil, publicationMutationMCPError(err, "failed to update post variants")
		}
		if err := handler.validateMediaBelongsToWorkspace(ctx, publication.WorkspaceID, allPublicationMediaIDs(nil, nil, input.Renditions)); err != nil {
			return nil, publicationMutationMCPError(err, "failed to update post variants")
		}
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, publication.WorkspaceID, "upsert-publication-renditions", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			request.ResourceID = publication.ID
			request.RequestHash, err = idempotency.Hash(struct {
				PublicationID    string           `json:"publication_id"`
				ExpectedRevision int              `json:"expected_revision"`
				Renditions       []RenditionInput `json:"renditions"`
			}{publication.ID, input.ExpectedRevision, input.Renditions})
			if err != nil {
				return nil, &mcpError{Code: -32603, Message: "failed to normalize variant update"}
			}
			if _, err := idempotency.Execute(ctx, h.db, request, func(txCtx context.Context, tx bun.Tx) (PublicationResponse, error) {
				return handler.upsertRenditionsTx(txCtx, tx, userID, publication.ID, input.ExpectedRevision, input.Renditions, accountMap)
			}); err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to update post variants")
				}
				return nil, publicationMutationMCPError(err, "failed to update post variants")
			}
			return h.mcpPostResult(ctx, userID, publication.ID, "Post variants updated: "+publication.ID, "", args)
		}
	}
	if err := handler.publicationApplication().ReplaceRenditions(
		ctx, userID, input.PublicationID, input.ExpectedRevision, input.Renditions,
	); err != nil {
		return nil, publicationMutationMCPError(err, "failed to update post variants")
	}
	return h.mcpPostResult(ctx, userID, strings.TrimSpace(input.PublicationID), "Post variants updated: "+strings.TrimSpace(input.PublicationID), "", args)
}

func (h *MCPHandler) replyToRendition(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		RenditionID    string                  `json:"variant_id"`
		Body           string                  `json:"body"`
		ParentID       string                  `json:"parent_id"`
		Settings       map[string]interface{}  `json:"settings"`
		Media          []PublicationMediaInput `json:"media"`
		RunAt          *time.Time              `json:"run_at"`
		IdempotencyKey string                  `json:"idempotency_key"`
		Detail         string                  `json:"detail"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.RenditionID) == "" || strings.TrimSpace(input.Body) == "" {
		return nil, &mcpError{Code: -32602, Message: "invalid reply_to_variant arguments"}
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
	queue := func() (string, error) {
		return (&PublicationHandler{db: h.db}).queueRenditionReply(
			ctx, rendition, publication, input.Body, input.ParentID, input.Settings, input.Media, runAt,
		)
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, publication.WorkspaceID, "reply-to-publication-rendition", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			request.ResourceID = publication.ID
			request.RequestHash, _ = idempotency.Hash(struct {
				RenditionID string                 `json:"variant_id"`
				Body        string                 `json:"body"`
				ParentID    string                 `json:"parent_id"`
				Settings    map[string]interface{} `json:"settings"`
				RunAt       string                 `json:"run_at"`
			}{rendition.ID, input.Body, input.ParentID, input.Settings, runAt.Format(time.RFC3339Nano)})
			result, err := idempotency.ExecuteWithIdentity(ctx, h.db, request, func(_ context.Context, tx bun.Tx) (string, error) {
				// queueRenditionReply manages its own transaction; the
				// idempotency claim commits atomically around it.
				_ = tx
				return queue()
			}, func(jobID string) (string, string) { return publication.ID, jobID })
			if err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to enqueue reply")
				}
				return nil, &mcpError{Code: -32603, Message: "failed to enqueue reply"}
			}
			return h.mcpPostResult(ctx, userID, publication.ID, "Reply queued: "+rendition.ID, result.Value, args)
		}
	}
	jobID, err := queue()
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to enqueue reply"}
	}
	return h.mcpPostResult(ctx, userID, publication.ID, "Reply queued: "+rendition.ID, jobID, args)
}

func decodeMCPPublicationID(args map[string]any, invalid string) (string, *mcpError) {
	var input struct {
		PublicationID string `json:"post_id"`
		Detail        string `json:"detail"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.PublicationID) == "" {
		return "", &mcpError{Code: -32602, Message: invalid}
	}
	return strings.TrimSpace(input.PublicationID), nil
}

func (h *MCPHandler) validatePublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		PublicationID string `json:"post_id"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid validate_post arguments"}
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	if input.PublicationID == "" {
		return nil, &mcpError{Code: -32602, Message: "post_id is required"}
	}
	issues, err := h.publicationHandler().publicationApplication().Validate(ctx, userID, input.PublicationID)
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to validate post"}
	}
	valid := !hasBlockingIssues(issues)
	text := fmt.Sprintf("Post validation found %d issue(s).", len(issues))
	if !valid {
		text = fmt.Sprintf("Post validation failed with %d issue(s); call get_post for the current delivery state and retry_failed_variants once the issues are fixed.", len(issues))
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: text}},
		"structuredContent": map[string]any{
			"valid":  valid,
			"issues": issues,
		},
	}, nil
}

func (h *MCPHandler) schedulePublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	publicationID, expectedRevision, intent, rpcErr := h.loadMCPPublicationAction(ctx, args, "invalid schedule_post arguments")
	if rpcErr != nil {
		return nil, rpcErr
	}
	if mcpDryRunFromArgs(args) {
		if _, err := h.publicationHandler().publicationApplication().Validate(ctx, userID, publicationID); err != nil {
			return nil, publicationMutationMCPError(err, "failed to validate post")
		}
		return h.mcpPostResult(ctx, userID, publicationID, "Post schedule validated: "+publicationID, "", args)
	}
	handler := h.publicationHandler()
	if strings.TrimSpace(mcpIdempotencyKeyFromArgs(args)) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, "", "schedule-publication", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			result, _, err := handler.publicationApplicationForTesting().ScheduleIdempotent(ctx, userID, publicationID, expectedRevision, intent, request)
			if err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to schedule post")
				}
				return nil, publicationMutationMCPError(err, "failed to schedule post")
			}
			return h.mcpPostResult(ctx, userID, publicationID, "Post scheduled: "+publicationID, result.JobID, args)
		}
	}
	result, err := handler.publicationApplication().Schedule(ctx, userID, publicationID, expectedRevision, intent)
	if err != nil {
		return nil, publicationMutationMCPError(err, "failed to schedule post")
	}
	return h.mcpPostResult(ctx, userID, publicationID, "Post scheduled: "+publicationID, result.JobID, args)
}

func (h *MCPHandler) cancelPublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		PublicationID    string `json:"post_id"`
		ExpectedRevision int    `json:"expected_revision"`
		IdempotencyKey   string `json:"idempotency_key"`
		Detail           string `json:"detail"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.PublicationID) == "" || input.ExpectedRevision < 1 {
		return nil, &mcpError{Code: -32602, Message: "invalid cancel_post arguments"}
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, "", "cancel-publication", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			publication, _, err := h.publicationHandler().publicationApplicationForTesting().CancelIdempotent(ctx, userID, input.PublicationID, input.ExpectedRevision, request)
			if err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to cancel post")
				}
				return nil, publicationMutationMCPError(err, "failed to cancel post")
			}
			return h.mcpPostResult(ctx, userID, publication.ID, "Post cancelled: "+publication.ID, "", args)
		}
	}
	if err := h.publicationHandler().publicationApplication().Cancel(
		ctx, userID, input.PublicationID, input.ExpectedRevision,
	); err != nil {
		return nil, publicationMutationMCPError(err, "failed to cancel post")
	}
	return h.mcpPostResult(ctx, userID, input.PublicationID, "Post cancelled: "+input.PublicationID, "", args)
}

func (h *MCPHandler) publishPublicationNow(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	publicationID, expectedRevision, intent, rpcErr := h.loadMCPPublicationAction(ctx, args, "invalid publish_post_now arguments")
	if rpcErr != nil {
		return nil, rpcErr
	}
	// Authorization precedes the irreversible-action gate so viewers always
	// see the workspace role error first.
	publication, err := h.publicationHandler().publicationApplication().Get(ctx, userID, publicationID)
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: "post not found or unavailable"}
	}
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, publication.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := mcpRequireConfirm(args, "publish_post_now"); rpcErr != nil {
		return nil, rpcErr
	}
	if mcpDryRunFromArgs(args) {
		if _, err := h.publicationHandler().publicationApplication().Validate(ctx, userID, publicationID); err != nil {
			return nil, publicationMutationMCPError(err, "failed to validate post")
		}
		return h.mcpPostResult(ctx, userID, publicationID, "Post publish validated: "+publicationID, "", args)
	}
	handler := h.publicationHandler()
	if strings.TrimSpace(mcpIdempotencyKeyFromArgs(args)) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, "", "publish-publication-now", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			result, _, err := handler.publicationApplicationForTesting().PublishNowIdempotent(ctx, userID, publicationID, expectedRevision, intent, request)
			if err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to queue post")
				}
				return nil, publicationMutationMCPError(err, "failed to queue post")
			}
			return h.mcpPostResult(ctx, userID, publicationID, "Post queued: "+publicationID, result.JobID, args)
		}
	}
	result, err := handler.publicationApplication().PublishNow(ctx, userID, publicationID, expectedRevision, intent)
	if err != nil {
		return nil, publicationMutationMCPError(err, "failed to queue post")
	}
	return h.mcpPostResult(ctx, userID, publicationID, "Post queued: "+publicationID, result.JobID, args)
}

func (h *MCPHandler) deletePublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		PublicationID    string `json:"post_id"`
		ExpectedRevision int    `json:"expected_revision"`
		Confirm          bool   `json:"confirm"`
		IdempotencyKey   string `json:"idempotency_key"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.PublicationID) == "" || input.ExpectedRevision < 1 {
		return nil, &mcpError{Code: -32602, Message: "invalid delete_post arguments"}
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	// Authorization precedes the irreversible-action gate so viewers always
	// see the workspace role error first.
	publication, err := h.publicationHandler().publicationApplication().Get(ctx, userID, input.PublicationID)
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: "post not found or unavailable"}
	}
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, publication.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := mcpRequireConfirm(args, "delete_post"); rpcErr != nil {
		return nil, rpcErr
	}
	deleteOp := func() *mcpError {
		if err := h.publicationHandler().publicationApplication().Delete(ctx, userID, input.PublicationID, input.ExpectedRevision); err != nil {
			return publicationMutationMCPError(err, "failed to delete post")
		}
		return nil
	}
	request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, publication.WorkspaceID, "delete-publication", args)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if ok {
		request.ResourceID = input.PublicationID
		request.RequestHash, _ = idempotency.Hash(struct {
			PublicationID    string `json:"publication_id"`
			ExpectedRevision int    `json:"expected_revision"`
		}{input.PublicationID, input.ExpectedRevision})
		var opErr *mcpError
		result, err := idempotency.Execute(ctx, h.db, request, func(_ context.Context, tx bun.Tx) (string, error) {
			_ = tx
			if rpcErr := deleteOp(); rpcErr != nil {
				opErr = rpcErr
				return "", errors.New(rpcErr.Message)
			}
			return input.PublicationID, nil
		})
		if err != nil {
			if errors.Is(err, idempotency.ErrConflict) {
				return nil, mcpIdempotencyError(err, "failed to delete post")
			}
			if opErr != nil {
				return nil, opErr
			}
			return nil, &mcpError{Code: -32603, Message: "failed to delete post"}
		}
		return h.mcpDeletedPostResult(result.Value), nil
	}
	if rpcErr := deleteOp(); rpcErr != nil {
		return nil, rpcErr
	}
	return h.mcpDeletedPostResult(input.PublicationID), nil
}

func (h *MCPHandler) mcpDeletedPostResult(publicationID string) map[string]any {
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: "Post deleted: " + publicationID}},
		"structuredContent": map[string]any{
			"message": "Post deleted: " + publicationID,
			"post_id": publicationID,
			"job_id":  "",
		},
	}
}

func (h *MCPHandler) retryFailedVariants(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	publicationID, expectedRevision, intent, rpcErr := h.loadMCPPublicationAction(ctx, args, "invalid retry_failed_variants arguments")
	if rpcErr != nil {
		return nil, rpcErr
	}
	_ = intent
	if rpcErr := h.mcpCheckExpectedRevision(ctx, userID, publicationID, expectedRevision); rpcErr != nil {
		return nil, rpcErr
	}
	handler := h.publicationHandler()
	if strings.TrimSpace(mcpIdempotencyKeyFromArgs(args)) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, "", "retry-failed-publication-renditions", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			jobID, _, err := handler.publicationApplicationForTesting().RetryFailedRenditionsIdempotent(ctx, userID, publicationID, request)
			if err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to queue variant retry")
				}
				return nil, publicationMutationMCPError(err, "failed to queue variant retry")
			}
			return h.mcpPostResult(ctx, userID, publicationID, "Variant retry queued: "+publicationID, jobID, args)
		}
	}
	jobID, err := handler.publicationApplication().RetryFailedRenditions(ctx, userID, publicationID)
	if err != nil {
		return nil, publicationMutationMCPError(err, "failed to queue variant retry")
	}
	return h.mcpPostResult(ctx, userID, publicationID, "Variant retry queued: "+publicationID, jobID, args)
}

//nolint:gocyclo // Validation, authorization, and replay each have distinct client errors.
func (h *MCPHandler) retryVariant(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		PublicationID    string `json:"post_id"`
		RenditionID      string `json:"variant_id"`
		ExpectedRevision int    `json:"expected_revision"`
		ExecutionIntent  string `json:"execution_intent"`
		IdempotencyKey   string `json:"idempotency_key"`
		Detail           string `json:"detail"`
	}
	if err := decodeMCPArguments(args, &input); err != nil ||
		strings.TrimSpace(input.PublicationID) == "" ||
		strings.TrimSpace(input.RenditionID) == "" ||
		input.ExpectedRevision < 1 {
		return nil, &mcpError{Code: -32602, Message: "invalid retry_variant arguments"}
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	input.RenditionID = strings.TrimSpace(input.RenditionID)
	if _, err := providerReadinessExecutionIntent(ctx, h.db, input.ExecutionIntent); err != nil {
		return nil, &mcpError{Code: -32602, Message: err.Error()}
	}
	if rpcErr := h.mcpCheckExpectedRevision(ctx, userID, input.PublicationID, input.ExpectedRevision); rpcErr != nil {
		return nil, rpcErr
	}
	var rendition models.Rendition
	if err := h.db.NewSelect().Model(&rendition).
		Where("id = ? AND publication_id = ?", input.RenditionID, input.PublicationID).
		Scan(ctx); err != nil {
		return nil, &mcpError{Code: -32602, Message: "variant not found for this post"}
	}
	retry := func() (string, *mcpError) {
		jobID, err := h.publicationHandler().publicationApplicationForTesting().RetryRendition(ctx, userID, input.PublicationID, rendition.SocialAccountID, rendition.TargetKey)
		if err != nil {
			return "", publicationMutationMCPError(err, "failed to queue variant retry")
		}
		return jobID, nil
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		publication, err := h.publicationHandler().publicationApplication().Get(ctx, userID, input.PublicationID)
		if err != nil {
			return nil, &mcpError{Code: -32602, Message: "post not found or unavailable"}
		}
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, publication.WorkspaceID, "retry-publication-rendition", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			request.ResourceID = publication.ID
			request.RequestHash, _ = idempotency.Hash(struct {
				PublicationID string `json:"publication_id"`
				RenditionID   string `json:"variant_id"`
			}{publication.ID, rendition.ID})
			var opErr *mcpError
			result, err := idempotency.ExecuteWithIdentity(ctx, h.db, request, func(_ context.Context, tx bun.Tx) (string, error) {
				_ = tx
				jobID, rpcErr := retry()
				if rpcErr != nil {
					opErr = rpcErr
					return "", errors.New(rpcErr.Message)
				}
				return jobID, nil
			}, func(jobID string) (string, string) { return publication.ID, jobID })
			if err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to queue variant retry")
				}
				if opErr != nil {
					return nil, opErr
				}
				return nil, &mcpError{Code: -32603, Message: "failed to queue variant retry"}
			}
			return h.mcpPostResult(ctx, userID, publication.ID, "Variant retry queued: "+rendition.ID, result.Value, args)
		}
	}
	jobID, rpcErr := retry()
	if rpcErr != nil {
		return nil, rpcErr
	}
	return h.mcpPostResult(ctx, userID, input.PublicationID, "Variant retry queued: "+rendition.ID, jobID, args)
}

// mcpCheckExpectedRevision rejects stale writes with the same conflict shape
// as the REST revision guard before dispatching to retry flows that do not
// take a revision themselves. The canonical read also enforces workspace
// access before the revision is compared.
func (h *MCPHandler) mcpCheckExpectedRevision(ctx context.Context, userID, publicationID string, expectedRevision int) *mcpError {
	publication, err := h.publicationHandler().publicationApplication().Get(ctx, userID, publicationID)
	if err != nil {
		return &mcpError{Code: -32602, Message: "post not found or unavailable"}
	}
	if publication.Revision != expectedRevision {
		return &mcpError{Code: -32602, Message: fmt.Sprintf("revision conflict: expected %d but post is at revision %d; reload the post before retrying", expectedRevision, publication.Revision)}
	}
	return nil
}

func (h *MCPHandler) loadMCPPublicationAction(ctx context.Context, args map[string]any, invalidMessage string) (string, int, providerreadiness.ExecutionIntent, *mcpError) {
	var input struct {
		PublicationID    string `json:"post_id"`
		ExpectedRevision int    `json:"expected_revision"`
		ExecutionIntent  string `json:"execution_intent"`
		Confirm          bool   `json:"confirm"`
		IdempotencyKey   string `json:"idempotency_key"`
		Detail           string `json:"detail"`
		DryRun           bool   `json:"dry_run"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return "", 0, "", &mcpError{Code: -32602, Message: invalidMessage}
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	if input.PublicationID == "" || input.ExpectedRevision < 1 {
		return "", 0, "", &mcpError{Code: -32602, Message: "post_id and expected_revision are required"}
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

// mcpPostResult returns the unified post result shape: a summary status plus
// job ID by default, or the full post with ordered media and variants when
// detail=full. jobID is empty when the operation enqueues no durable work.
func (h *MCPHandler) mcpPostResult(ctx context.Context, userID, publicationID, message, jobID string, args map[string]any) (any, *mcpError) {
	publication, err := h.publicationHandler().publicationApplication().Get(ctx, userID, publicationID)
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: "post not found or unavailable"}
	}
	if mcpPostDetail(args) == "full" {
		return map[string]any{
			"content": []mcpContent{{Type: "text", Text: message}},
			"structuredContent": map[string]any{
				"publication": publication,
				"job_id":      jobID,
			},
		}, nil
	}
	return mcpPublicationActionResult(message, jobID, mcpPublicationStatusFromResponse(publication)), nil
}

func (h *MCPHandler) listPublicationEvents(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		PublicationID string `json:"post_id"`
		Limit         int    `json:"limit"`
		Cursor        string `json:"cursor"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid list_post_events arguments"}
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	if input.PublicationID == "" {
		return nil, &mcpError{Code: -32602, Message: "post_id is required"}
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 200 {
		limit = 200
	}
	page, err := h.publicationHandler().publicationApplication().History(
		ctx, userID, input.PublicationID, limit, strings.TrimSpace(input.Cursor),
	)
	if err != nil {
		return nil, publicationMutationMCPError(err, "failed to list post events")
	}
	out := page.Events
	if out == nil {
		out = []PublicationLifecycleEventResponse{}
	}
	total := h.countPublicationHistoryEvents(ctx, input.PublicationID)
	text := fmt.Sprintf("Found %d of %d post events.", len(out), total)
	if page.HasMore {
		text = fmt.Sprintf("Found %d of %d post events; more are available. Repeat the request with cursor %q while has_more is true.", len(out), total, page.NextCursor)
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: text}},
		"structuredContent": map[string]any{
			"events":      out,
			"has_more":    page.HasMore,
			"next_cursor": page.NextCursor,
			"total_count": total,
		},
	}, nil
}

// countPublicationHistoryEvents totals the same merged history that
// listPublicationHistory serves: lifecycle events, draft revision changes,
// and the creation item. Missing history tables read as zero so workspaces
// provisioned before a migration keep working.
func (h *MCPHandler) countPublicationHistoryEvents(ctx context.Context, publicationID string) int {
	total := 1
	if lifecycleCount, err := h.db.NewSelect().Model((*models.PublicationLifecycleEvent)(nil)).
		Where("publication_id = ?", publicationID).
		Count(ctx); err == nil {
		total += lifecycleCount
	} else if !isMissingPublicationHistoryTable(err) {
		return total
	}
	if editCount, err := h.db.NewSelect().Model((*models.DraftRevisionChange)(nil)).
		Where("aggregate_type = ?", drafts.AggregatePublication).
		Where("aggregate_id = ?", publicationID).
		Count(ctx); err == nil {
		total += editCount
	}
	return total
}

func (h *MCPHandler) listRenditionComments(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		RenditionID string `json:"variant_id"`
		Limit       int    `json:"limit"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid list_variant_comments arguments"}
	}
	input.RenditionID = strings.TrimSpace(input.RenditionID)
	if input.RenditionID == "" {
		return nil, &mcpError{Code: -32602, Message: "variant_id is required"}
	}
	limit := input.Limit
	if limit == 0 {
		limit = 50
	}
	if limit < 1 || limit > 100 {
		return nil, &mcpError{Code: -32602, Message: "limit must be between 1 and 100"}
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
		return nil, &mcpError{Code: -32602, Message: "variant has no provider post ID"}
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
	text := fmt.Sprintf("Found %d comments for %s.", len(out), publication.Title)
	if len(out) > limit {
		out = out[:limit]
		text = fmt.Sprintf("Found %d comments for %s; showing the first %d (limit %d).", len(comments), publication.Title, limit, limit)
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: text}},
		"structuredContent": map[string]any{
			"comments": out,
		},
	}, nil
}

//nolint:gocyclo // Comment actions share access checks but retain separate replay and queue outcomes.
func (h *MCPHandler) moderateComment(ctx context.Context, userID, operation string, args map[string]any) (any, *mcpError) {
	var input struct {
		CommentID      string `json:"comment_id"`
		Body           string `json:"body"`
		Confirm        bool   `json:"confirm"`
		IdempotencyKey string `json:"idempotency_key"`
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
	if operation == mcpToolDeleteComment {
		if rpcErr := mcpRequireConfirm(args, "delete_comment"); rpcErr != nil {
			return nil, rpcErr
		}
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
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		// Replay check before queueing so a retried call returns the stored
		// job instead of queueing a duplicate provider action.
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, publication.WorkspaceID, "provider-comment-"+action, args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			request.ResourceID = publication.ID
			request.RequestHash, _ = idempotency.Hash(struct {
				CommentID string `json:"comment_id"`
				Body      string `json:"body"`
				Action    string `json:"action"`
			}{strings.TrimSpace(input.CommentID), input.Body, action})
			if replay, found, err := idempotency.Replay[string](ctx, h.db, request); found || err != nil {
				if err != nil {
					return nil, mcpIdempotencyError(err, "failed to queue provider comment action")
				}
				return map[string]any{
					"content":           []mcpContent{{Type: "text", Text: message}},
					"structuredContent": map[string]any{"message": message, "job_id": replay.Value},
				}, nil
			}
			queuedID, err := engagementservice.QueueProviderCommentAction(ctx, h.db, h.featureGate, engagementservice.ProviderCommentActionInput{
				Actor:       workspaceActor(ctx, userID),
				WorkspaceID: publication.WorkspaceID, PublicationID: publication.ID,
				RenditionID: rendition.ID, SocialAccountID: account.ID,
				ProviderCommentID: ref.ProviderCommentID, Action: action,
				Message: input.Body,
			})
			if err != nil {
				return nil, &mcpError{Code: -32603, Message: "failed to queue provider comment action"}
			}
			request.JobID = queuedID
			if result, err := idempotency.Execute(ctx, h.db, request, func(txCtx context.Context, tx bun.Tx) (string, error) {
				_ = txCtx
				_ = tx
				return queuedID, nil
			}); err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to queue provider comment action")
				}
				// The job is queued; only the replay record failed.
				return nil, &mcpError{Code: -32603, Message: "comment action queued but the replay record failed"}
			} else if result.Replayed && result.Value != "" {
				queuedID = result.Value
			}
			return map[string]any{
				"content":           []mcpContent{{Type: "text", Text: message}},
				"structuredContent": map[string]any{"message": message, "job_id": queuedID},
			}, nil
		}
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
		"structuredContent": map[string]any{"message": message, "job_id": jobID},
	}, nil
}

func (h *MCPHandler) loadMCPCommentContext(ctx context.Context, userID, renditionID string) (*models.Rendition, *models.Publication, *models.SocialAccount, *mcpError) {
	var rendition models.Rendition
	if err := h.db.NewSelect().Model(&rendition).Where("id = ?", renditionID).Scan(ctx); err != nil {
		return nil, nil, nil, &mcpError{Code: -32602, Message: "variant not found"}
	}
	var publication models.Publication
	if err := h.db.NewSelect().Model(&publication).Where("id = ?", rendition.PublicationID).Scan(ctx); err != nil {
		return nil, nil, nil, &mcpError{Code: -32602, Message: "post not found"}
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
	key := platform.AccountProviderKey(account.Platform, account.InstanceURL, account.CapabilityState)
	h.providersMu.RLock()
	provider := h.providers[key]
	h.providersMu.RUnlock()
	commenter, ok := provider.(platform.CommentAdapter)
	if !ok || commenter == nil {
		return nil, &mcpError{Code: -32603, Message: fmt.Sprintf("comments are not supported for %s", account.Platform)}
	}
	return commenter, nil
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
		return nil, &mcpError{Code: -32603, Message: "failed to load scheduled posts"}
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
	Cursor      string `json:"cursor"`
}

//nolint:gocyclo // Cursor, filter, count, and usage checks each preserve a distinct API error.
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
	var cursor *timestampIDCursor
	if strings.TrimSpace(input.Cursor) != "" {
		parsed, err := parseTimestampIDCursor(input.Cursor)
		if err != nil {
			return nil, &mcpError{Code: -32602, Message: "invalid list_media cursor; repeat the previous response's next_cursor unchanged"}
		}
		cursor = &parsed
	}

	filter := strings.TrimSpace(input.Filter)
	applyMediaFilter := func(query *bun.SelectQuery) (*bun.SelectQuery, *mcpError) {
		switch filter {
		case "", "all":
		case "favorites":
			query = query.Where("workspace_id = ? AND is_favorite = ?", input.WorkspaceID, true)
		case "used":
			query = query.Where("workspace_id = ? AND id IN (SELECT media_id FROM post_media)", input.WorkspaceID)
		case "unused":
			query = query.Where("workspace_id = ? AND id NOT IN (SELECT media_id FROM post_media)", input.WorkspaceID)
		default:
			return nil, &mcpError{Code: -32602, Message: "filter must be one of all, favorites, used, or unused"}
		}
		if filter == "" || filter == "all" {
			query = query.Where("workspace_id = ?", input.WorkspaceID)
		}
		return query, nil
	}

	countQuery := h.db.NewSelect().Model((*models.MediaAttachment)(nil))
	countQuery, rpcErr := applyMediaFilter(countQuery)
	if rpcErr != nil {
		return nil, rpcErr
	}
	total, err := countQuery.Count(ctx)
	if err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to list media"}
	}

	var rows []models.MediaAttachment
	query := h.db.NewSelect().Model(&rows)
	query, rpcErr = applyMediaFilter(query)
	if rpcErr != nil {
		return nil, rpcErr
	}
	query = query.Order("created_at DESC", "id DESC")
	if cursor != nil {
		query = query.Where(
			"(created_at < ? OR (created_at = ? AND id < ?))",
			cursor.Timestamp, cursor.Timestamp, cursor.ID,
		)
	}
	err = query.Limit(limit+1).Scan(ctx, &rows)
	if err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to list media"}
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
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
	nextCursor := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		nextCursor = encodeTimestampIDCursor(last.CreatedAt, last.ID)
	}

	text := fmt.Sprintf("Found %d of %d media items.", len(media), total)
	if len(media) == 0 {
		text = "No media attachments found."
	} else if hasMore {
		text = fmt.Sprintf("Found %d of %d media items; more are available. Repeat the request with cursor %q while has_more is true.", len(media), total, nextCursor)
	}
	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: text,
		}},
		"structuredContent": map[string]any{
			"media":       media,
			"has_more":    hasMore,
			"next_cursor": nextCursor,
			"total_count": total,
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
	handler := &ProviderReadinessHandler{db: h.db, providers: h.providerMapSnapshot(), readiness: h.readiness}
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

type mcpVariantMetrics struct {
	VariantID       string   `json:"variant_id"`
	Platform        string   `json:"platform"`
	SocialAccountID string   `json:"social_account_id"`
	Views           int64    `json:"views"`
	Reactions       int64    `json:"reactions"`
	Engagements     int64    `json:"engagements"`
	Impressions     int64    `json:"impressions"`
	Reach           int64    `json:"reach"`
	Measured        []string `json:"measured"`
	CollectedAt     string   `json:"collected_at,omitempty"`
}

// getPostMetrics reads stored analytics snapshots for a post's variants. It
// never calls providers: collection stays in the analytics service, and this
// operation only normalizes what is already stored.
//
//nolint:gocyclo // Snapshot measurement keys must stay distinct from unmeasured zero values.
func (h *MCPHandler) getPostMetrics(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	postID, rpcErr := decodeMCPPublicationID(args, "invalid get_post_metrics arguments")
	if rpcErr != nil {
		return nil, rpcErr
	}
	post, err := h.publicationHandler().publicationApplication().Get(ctx, userID, postID)
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: "post not found or unavailable"}
	}
	var renditions []models.Rendition
	if err := h.db.NewSelect().Model(&renditions).
		Where("publication_id = ?", post.ID).
		Order("created_at ASC", "id ASC").
		Scan(ctx); err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to load post variants"}
	}
	var snapshots []models.AnalyticsRenditionSnapshot
	if err := h.db.NewSelect().Model(&snapshots).
		Where("publication_id = ?", post.ID).
		Scan(ctx); err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to load post metrics"}
	}
	latest := make(map[string]models.AnalyticsRenditionSnapshot, len(snapshots))
	for _, snapshot := range snapshots {
		current, ok := latest[snapshot.RenditionID]
		if !ok || snapshot.CapturedAt.After(current.CapturedAt) {
			latest[snapshot.RenditionID] = snapshot
		}
	}
	variants := make([]mcpVariantMetrics, 0, len(renditions))
	totals := map[string]int64{"views": 0, "reactions": 0, "engagements": 0, "impressions": 0, "reach": 0}
	measuredAny := false
	for _, rendition := range renditions {
		metrics := mcpVariantMetrics{
			VariantID: rendition.ID, Platform: rendition.Platform,
			SocialAccountID: rendition.SocialAccountID, Measured: []string{},
		}
		if snapshot, ok := latest[rendition.ID]; ok {
			values := decodeMCPStoredAnalyticsValues(snapshot.MetricsJSON)
			metrics.Views = values[platform.MetricViews]
			metrics.Reactions = values[platform.MetricReactions]
			metrics.Engagements = platform.EngagementTotal(values)
			metrics.Impressions = values[platform.MetricImpressions]
			metrics.Reach = values[platform.MetricReach]
			for _, name := range []string{
				platform.MetricViews, platform.MetricReactions,
				platform.MetricImpressions, platform.MetricReach,
			} {
				if _, ok := values[name]; ok {
					metrics.Measured = append(metrics.Measured, name)
				}
			}
			if platform.HasEngagementMetric(values) {
				metrics.Measured = append(metrics.Measured, platform.MetricEngagements)
			}
			if !snapshot.CapturedAt.IsZero() {
				metrics.CollectedAt = snapshot.CapturedAt.UTC().Format(time.RFC3339)
			}
			totals["views"] += metrics.Views
			totals["reactions"] += metrics.Reactions
			totals["engagements"] += metrics.Engagements
			totals["impressions"] += metrics.Impressions
			totals["reach"] += metrics.Reach
			measuredAny = true
		}
		variants = append(variants, metrics)
	}
	text := fmt.Sprintf("Post metrics loaded for %d variant(s).", len(variants))
	if !measuredAny {
		text = fmt.Sprintf("No stored analytics for post %s yet; variants report zeros until the analytics service collects provider measurements.", post.ID)
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: text}},
		"structuredContent": map[string]any{
			"post_id":  post.ID,
			"variants": variants,
			"totals":   totals,
		},
	}, nil
}

// decodeMCPStoredAnalyticsValues keeps every stored snapshot value readable.
// A missing key is distinct from a measured zero; malformed rows read as
// empty rather than failing the whole call.
func decodeMCPStoredAnalyticsValues(raw string) platform.AnalyticsValues {
	values := platform.AnalyticsValues{}
	if strings.TrimSpace(raw) == "" {
		return values
	}
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return platform.AnalyticsValues{}
	}
	return values
}

// dashboardLink builds a dashboard URL agents can hand to users so people see
// visualizations themselves. It is a pure URL builder from the configured app
// origin: the only state it reads is the workspace access check.
func (h *MCPHandler) dashboardLink(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID string `json:"workspace_id"`
		Kind        string `json:"kind"`
		ID          string `json:"id"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid get_dashboard_link arguments"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	origin := strings.TrimRight(strings.TrimSpace(h.publicURL), "/")
	if origin == "" {
		return nil, &mcpError{Code: -32603, Message: "dashboard links require a configured app origin"}
	}
	var path string
	switch kind := strings.TrimSpace(input.Kind); kind {
	case "post":
		id := strings.TrimSpace(input.ID)
		if id == "" {
			return nil, &mcpError{Code: -32602, Message: "id is required for post dashboard links"}
		}
		path = "/publications/" + url.PathEscape(id)
	case "media":
		path = "/media"
	case "account":
		path = "/settings?tab=accounts"
	case "calendar":
		path = "/calendar"
	default:
		return nil, &mcpError{Code: -32602, Message: "kind must be one of post, media, account, or calendar"}
	}
	link := origin + path
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: fmt.Sprintf("Dashboard link for %s: %s", strings.TrimSpace(input.Kind), link)}},
		"structuredContent": map[string]any{
			"url":          link,
			"kind":         strings.TrimSpace(input.Kind),
			"workspace_id": strings.TrimSpace(input.WorkspaceID),
		},
	}, nil
}

type mcpDocEntry struct {
	Title    string
	Path     string
	Snippet  string
	Keywords string
}

// mcpDocRegistry is a curated offline index over the public docs and
// assistant skill pages. It stays static so search_docs never touches the
// network; paths resolve under /docs on the app origin.
var mcpDocRegistry = []mcpDocEntry{
	{Title: "Connect AI assistants (MCP)", Path: "/docs/mcp", Snippet: "Setup entry point for connecting ChatGPT, Claude, and other assistants to OpenPost.", Keywords: "mcp setup connect assistant install"},
	{Title: "Endpoints and tools", Path: "/docs/mcp/mcp-guide/endpoints-and-tools", Snippet: "Direct versus compact MCP endpoints, tool modes, and the full operation list.", Keywords: "mcp endpoints tools direct compact code mode operations"},
	{Title: "Permissions and safety", Path: "/docs/mcp/mcp-guide/permissions-and-safety", Snippet: "MCP scopes, approvals, destructive actions, and workspace boundaries.", Keywords: "mcp scopes permissions safety approval mcp:read mcp:full destructive"},
	{Title: "MCP use cases", Path: "/docs/mcp/mcp-guide/use-cases", Snippet: "Example assistant workflows for drafting, scheduling, and reviewing content.", Keywords: "mcp use cases workflows examples draft schedule"},
	{Title: "Self-hosted and local MCP", Path: "/docs/mcp/mcp-guide/self-hosted-and-local", Snippet: "Run the MCP server self-hosted and connect local clients and the stdio proxy.", Keywords: "mcp self-hosted local stdio proxy openpost-mcp"},
	{Title: "MCP media guide", Path: "/docs/mcp/mcp-guide/media", Snippet: "Upload and attach media through MCP, including local file picks.", Keywords: "mcp media upload image video local picker"},
	{Title: "Assistant skills", Path: "/docs/mcp/skills", Snippet: "Installable skills that teach assistants OpenPost workflows.", Keywords: "skills install assistant capabilities"},
	{Title: "Assistant skill use cases", Path: "/docs/mcp/skills/use-cases", Snippet: "When each assistant skill helps and what it automates.", Keywords: "skills use cases when workflows"},
	{Title: "Install assistant skills", Path: "/docs/mcp/skills/install", Snippet: "How to install OpenPost skills into a compatible assistant.", Keywords: "skills install setup howto"},
	{Title: "OpenPost CLI skill", Path: "/docs/mcp/skills/openpost-cli", Snippet: "Operate OpenPost from the terminal through the openpost CLI.", Keywords: "skills cli terminal command openpost-cli"},
	{Title: "ChatGPT setup", Path: "/docs/mcp/chatgpt", Snippet: "Connect ChatGPT to OpenPost with the scheduler widget and deep research.", Keywords: "chatgpt setup openai apps widget connector"},
	{Title: "Claude setup", Path: "/docs/mcp/claude", Snippet: "Connect Claude to OpenPost over MCP.", Keywords: "claude setup anthropic connector"},
	{Title: "Claude Code setup", Path: "/docs/mcp/claude-code", Snippet: "Use OpenPost from Claude Code sessions.", Keywords: "claude code cli setup terminal"},
	{Title: "Claude Desktop setup", Path: "/docs/mcp/claude-desktop", Snippet: "Add OpenPost to Claude Desktop's MCP servers.", Keywords: "claude desktop mcp server config"},
	{Title: "Codex setup", Path: "/docs/mcp/codex", Snippet: "Use OpenPost from Codex.", Keywords: "codex setup openai cli"},
	{Title: "Cursor setup", Path: "/docs/mcp/cursor", Snippet: "Add OpenPost to Cursor's MCP configuration.", Keywords: "cursor setup ide mcp config"},
	{Title: "Gemini CLI setup", Path: "/docs/mcp/gemini-cli", Snippet: "Use OpenPost from Gemini CLI.", Keywords: "gemini cli setup google terminal"},
	{Title: "OpenCode setup", Path: "/docs/mcp/opencode", Snippet: "Use OpenPost from OpenCode.", Keywords: "opencode setup terminal agent"},
	{Title: "VS Code setup", Path: "/docs/mcp/vs-code", Snippet: "Add OpenPost to VS Code's MCP support.", Keywords: "vs code vscode setup ide github copilot"},
	{Title: "GitHub Copilot setup", Path: "/docs/mcp/github-copilot", Snippet: "Use OpenPost from GitHub Copilot.", Keywords: "github copilot setup ide"},
	{Title: "Perplexity setup", Path: "/docs/mcp/perplexity", Snippet: "Use OpenPost from Perplexity.", Keywords: "perplexity setup search assistant"},
	{Title: "Choose an agent connection", Path: "/docs/mcp/choose-an-agent-connection", Snippet: "Compare MCP, CLI, API, and n8n automation surfaces.", Keywords: "choose compare mcp cli api n8n automation which"},
	{Title: "Quickstart", Path: "/docs/guides/quickstart", Snippet: "Create a workspace, connect an account, and publish a first post.", Keywords: "quickstart start first post publish begin onboard"},
	{Title: "Publishing guide", Path: "/docs/guides/publishing", Snippet: "Draft, validate, schedule, and publish posts across destinations.", Keywords: "publishing publish schedule draft validate destinations"},
	{Title: "Scheduling guide", Path: "/docs/guides/scheduling", Snippet: "Posting schedules, calendar windows, and the best time to publish.", Keywords: "scheduling schedule calendar slots timing queue"},
	{Title: "Analytics guide", Path: "/docs/guides/analytics", Snippet: "Read followers, engagement, views, and per-post performance.", Keywords: "analytics metrics engagement views followers reach impressions performance"},
	{Title: "Media guide", Path: "/docs/guides/media", Snippet: "Upload, organize, and attach media to posts.", Keywords: "media upload image video library attach"},
	{Title: "Accounts guide", Path: "/docs/guides/accounts", Snippet: "Connect and manage social accounts and destinations.", Keywords: "accounts connect social destinations platforms oauth"},
	{Title: "Inbox guide", Path: "/docs/guides/inbox", Snippet: "Read and reply to comments and messages from connected accounts.", Keywords: "inbox comments replies messages moderation engagement"},
	{Title: "Troubleshooting", Path: "/docs/guides/troubleshooting", Snippet: "Fix failed posts, disconnected accounts, and validation errors.", Keywords: "troubleshooting failed error fix retry validation disconnect"},
	{Title: "Workspaces guide", Path: "/docs/guides/workspaces", Snippet: "Organize teams, roles, and workspaces.", Keywords: "workspaces teams roles members organization"},
	{Title: "Automation overview", Path: "/docs/automate", Snippet: "Compare API, CLI, SDK, and n8n automation options.", Keywords: "automate automation api cli sdk n8n webhooks program"},
	{Title: "API overview", Path: "/docs/automate/api", Snippet: "Authenticate and call the OpenPost REST API.", Keywords: "api rest openapi tokens authentication reference"},
	{Title: "CLI overview", Path: "/docs/automate/cli", Snippet: "Script OpenPost from the terminal with the openpost CLI.", Keywords: "cli terminal scripts command line"},
	{Title: "n8n overview", Path: "/docs/automate/n8n", Snippet: "Automate OpenPost with n8n workflows.", Keywords: "n8n workflow automation nodes zapier"},
	{Title: "Self-hosting overview", Path: "/docs/self-hosting", Snippet: "Run OpenPost on your own infrastructure with Docker or a binary.", Keywords: "self-hosting self host docker deploy server homelab"},
	{Title: "Self-hosting configuration", Path: "/docs/self-hosting/configuration", Snippet: "Environment variables and runtime configuration for self-hosted OpenPost.", Keywords: "self-hosting configuration env environment variables config"},
}

type mcpDocHit struct {
	index int
	score int
}

func (h *MCPHandler) searchDocs(args map[string]any) (any, *mcpError) {
	var input struct {
		Query string `json:"query"`
		Limit int    `json:"limit"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid search_docs arguments"}
	}
	input.Query = strings.TrimSpace(input.Query)
	if input.Query == "" {
		return nil, &mcpError{Code: -32602, Message: "query is required"}
	}
	limit := input.Limit
	if limit == 0 {
		limit = 5
	}
	if limit < 1 || limit > 10 {
		return nil, &mcpError{Code: -32602, Message: "limit must be between 1 and 10"}
	}
	terms := mcpSearchTerms(strings.ToLower(input.Query))
	hits := make([]mcpDocHit, 0, limit)
	for index, entry := range mcpDocRegistry {
		score := mcpDocScore(terms, entry)
		if score > 0 {
			hits = append(hits, mcpDocHit{index: index, score: score})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].score == hits[j].score {
			return hits[i].index < hits[j].index
		}
		return hits[i].score > hits[j].score
	})
	if len(hits) > limit {
		hits = hits[:limit]
	}
	results := make([]map[string]any, 0, len(hits))
	for _, hit := range hits {
		entry := mcpDocRegistry[hit.index]
		results = append(results, map[string]any{
			"title": entry.Title, "path": entry.Path, "snippet": entry.Snippet,
		})
	}
	message := fmt.Sprintf("Found %d doc(s) for %q. Resolve paths under /docs on the app origin.", len(results), input.Query)
	if len(results) == 0 {
		message = fmt.Sprintf("No docs matched %q. Try a broader topic such as 'schedule', 'accounts', or 'self-hosting'.", input.Query)
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: message}},
		"structuredContent": map[string]any{
			"results": results,
		},
	}, nil
}

func mcpDocScore(terms []string, entry mcpDocEntry) int {
	title := strings.ToLower(entry.Title)
	path := strings.ToLower(entry.Path)
	snippet := strings.ToLower(entry.Snippet)
	keywords := strings.ToLower(entry.Keywords)
	score := 0
	for _, term := range terms {
		switch {
		case strings.Contains(title, term):
			score += 3
		case strings.Contains(keywords, term):
			score += 2
		case strings.Contains(snippet, term), strings.Contains(path, term):
			score++
		}
	}
	return score
}

func (h *MCPHandler) callMediaTool(ctx context.Context, userID, toolName string, args map[string]any) (any, *mcpError) {
	switch normalizeMCPOperationName(toolName) {
	case mcpToolGetMedia:
		return h.getMedia(ctx, userID, args)
	case mcpToolUpdateMedia:
		return h.updateMedia(ctx, userID, args)
	case mcpToolDeleteMedia:
		return h.deleteMedia(ctx, userID, args)
	default:
		return nil, &mcpError{Code: -32602, Message: "unknown tool"}
	}
}

func (h *MCPHandler) loadMCPMedia(ctx context.Context, userID, mediaID string) (models.MediaAttachment, *mcpError) {
	var media models.MediaAttachment
	if err := h.db.NewSelect().Model(&media).Where("id = ?", strings.TrimSpace(mediaID)).Scan(ctx); err != nil {
		return media, &mcpError{Code: -32602, Message: "media not found or unavailable"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, media.WorkspaceID); rpcErr != nil {
		return media, rpcErr
	}
	return media, nil
}

func (h *MCPHandler) mcpMediaResult(ctx context.Context, media models.MediaAttachment, message string) (any, *mcpError) {
	mediaHandler := &MediaHandler{db: h.db}
	usage, err := mediaHandler.mediaUsageSummary(ctx, media.WorkspaceID, media.ID)
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to check media usage"}
	}
	out := mcpMediaFromAttachment(media, usage.Total, usage.Blocking == 0)
	text := message
	if text == "" {
		text = "Media loaded: " + media.ID
	}
	return map[string]any{
		"content":           []mcpContent{{Type: "text", Text: text}},
		"structuredContent": map[string]any{"media": out},
	}, nil
}

func (h *MCPHandler) getMedia(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		MediaID string `json:"media_id"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.MediaID) == "" {
		return nil, &mcpError{Code: -32602, Message: "invalid get_media arguments"}
	}
	media, rpcErr := h.loadMCPMedia(ctx, userID, input.MediaID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	return h.mcpMediaResult(ctx, media, "")
}

//nolint:gocyclo // Favorite and alt-text updates share one replay boundary and preserve their API errors.
func (h *MCPHandler) updateMedia(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		MediaID        string  `json:"media_id"`
		Favorite       *bool   `json:"favorite"`
		AltText        *string `json:"alt_text"`
		IdempotencyKey string  `json:"idempotency_key"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.MediaID) == "" {
		return nil, &mcpError{Code: -32602, Message: "invalid update_media arguments"}
	}
	if input.Favorite == nil && input.AltText == nil {
		return nil, &mcpError{Code: -32602, Message: "favorite or alt_text is required"}
	}
	media, rpcErr := h.loadMCPMedia(ctx, userID, input.MediaID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, media.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	apply := func() (models.MediaAttachment, *mcpError) {
		updated := media
		if input.Favorite != nil && updated.IsFavorite != *input.Favorite {
			handler := &MediaHandler{db: h.db}
			// The favorite toggle endpoint flips state; loop until it holds
			// the requested value (at most two transitions).
			for i := 0; i < 2; i++ {
				out, err := handler.updateMediaFavorite(ctx, &UpdateMediaFavoriteInput{PathID: updated.ID})
				if err != nil {
					return updated, &mcpError{Code: -32603, Message: "failed to update media"}
				}
				updated.IsFavorite = out.Body.IsFavorite
				if updated.IsFavorite == *input.Favorite {
					break
				}
			}
			if updated.IsFavorite != *input.Favorite {
				return updated, &mcpError{Code: -32603, Message: "failed to update media"}
			}
		}
		if input.AltText != nil {
			altText := strings.TrimSpace(*input.AltText)
			handler := &MediaHandler{db: h.db}
			var updateInput UpdateMediaInput
			updateInput.PathID = updated.ID
			updateInput.Body.AltText = &altText
			if _, err := handler.updateMedia(ctx, &updateInput); err != nil {
				return updated, &mcpError{Code: -32602, Message: err.Error()}
			}
			updated.AltText = altText
		}
		if err := h.db.NewSelect().Model(&updated).Where("id = ?", updated.ID).Scan(ctx); err != nil {
			return updated, &mcpError{Code: -32603, Message: "failed to load updated media"}
		}
		return updated, nil
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, media.WorkspaceID, "update-media", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			request.ResourceID = media.ID
			request.RequestHash, _ = idempotency.Hash(struct {
				MediaID  string  `json:"media_id"`
				Favorite *bool   `json:"favorite"`
				AltText  *string `json:"alt_text"`
			}{media.ID, input.Favorite, input.AltText})
			if replay, found, err := idempotency.Replay[mcpMedia](ctx, h.db, request); found || err != nil {
				if err != nil {
					return nil, mcpIdempotencyError(err, "failed to update media")
				}
				return map[string]any{
					"content":           []mcpContent{{Type: "text", Text: "Media updated: " + media.ID}},
					"structuredContent": map[string]any{"media": replay.Value},
				}, nil
			}
			updated, rpcErr := apply()
			if rpcErr != nil {
				return nil, rpcErr
			}
			mediaHandler := &MediaHandler{db: h.db}
			usage, err := mediaHandler.mediaUsageSummary(ctx, updated.WorkspaceID, updated.ID)
			if err != nil {
				return nil, &mcpError{Code: -32603, Message: "failed to check media usage"}
			}
			out := mcpMediaFromAttachment(updated, usage.Total, usage.Blocking == 0)
			if stored, err := idempotency.Execute(ctx, h.db, request, func(txCtx context.Context, tx bun.Tx) (mcpMedia, error) {
				_ = txCtx
				_ = tx
				return out, nil
			}); err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to update media")
				}
				return nil, &mcpError{Code: -32603, Message: "media updated but the replay record failed"}
			} else if stored.Replayed {
				out = stored.Value
			}
			return map[string]any{
				"content":           []mcpContent{{Type: "text", Text: "Media updated: " + updated.ID}},
				"structuredContent": map[string]any{"media": out},
			}, nil
		}
	}
	updated, rpcErr := apply()
	if rpcErr != nil {
		return nil, rpcErr
	}
	return h.mcpMediaResult(ctx, updated, "Media updated: "+updated.ID)
}

//nolint:gocyclo // Authorization, confirmation, provider errors, and replay have distinct outcomes.
func (h *MCPHandler) deleteMedia(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		MediaID        string `json:"media_id"`
		Confirm        bool   `json:"confirm"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.MediaID) == "" {
		return nil, &mcpError{Code: -32602, Message: "invalid delete_media arguments"}
	}
	media, rpcErr := h.loadMCPMedia(ctx, userID, input.MediaID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	// Authorization precedes the irreversible-action gate so viewers always
	// see the workspace role error first.
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, media.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := mcpRequireConfirm(args, "delete_media"); rpcErr != nil {
		return nil, rpcErr
	}
	remove := func() *mcpError {
		handler := &MediaHandler{db: h.db}
		_, err := handler.deleteMedia(ctx, &DeleteMediaInput{PathID: media.ID})
		if err != nil {
			var statusErr huma.StatusError
			if errors.As(err, &statusErr) && statusErr.GetStatus() < http.StatusInternalServerError {
				return &mcpError{Code: -32602, Message: err.Error()}
			}
			return &mcpError{Code: -32603, Message: "failed to delete media"}
		}
		return nil
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, media.WorkspaceID, "delete-media", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			request.ResourceID = media.ID
			request.RequestHash, _ = idempotency.Hash(struct {
				MediaID string `json:"media_id"`
			}{media.ID})
			var opErr *mcpError
			result, err := idempotency.Execute(ctx, h.db, request, func(txCtx context.Context, tx bun.Tx) (string, error) {
				_ = tx
				_ = txCtx
				if rpcErr := remove(); rpcErr != nil {
					opErr = rpcErr
					return "", errors.New(rpcErr.Message)
				}
				return media.ID, nil
			})
			if err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to delete media")
				}
				if opErr != nil {
					return nil, opErr
				}
				return nil, &mcpError{Code: -32603, Message: "failed to delete media"}
			}
			return map[string]any{
				"content":           []mcpContent{{Type: "text", Text: "Media deleted: " + result.Value}},
				"structuredContent": map[string]any{"message": "Media deleted: " + result.Value, "media_id": result.Value},
			}, nil
		}
	}
	if rpcErr := remove(); rpcErr != nil {
		return nil, rpcErr
	}
	return map[string]any{
		"content":           []mcpContent{{Type: "text", Text: "Media deleted: " + media.ID}},
		"structuredContent": map[string]any{"message": "Media deleted: " + media.ID, "media_id": media.ID},
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
		WorkspaceID    string `json:"workspace_id"`
		URL            string `json:"url"`
		Filename       string `json:"filename"`
		AltText        string `json:"alt_text"`
		IdempotencyKey string `json:"idempotency_key"`
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
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, strings.TrimSpace(input.WorkspaceID), "upload-media-from-url", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			request.RequestHash, _ = idempotency.Hash(struct {
				WorkspaceID string `json:"workspace_id"`
				URL         string `json:"url"`
				Filename    string `json:"filename"`
				AltText     string `json:"alt_text"`
			}{strings.TrimSpace(input.WorkspaceID), strings.TrimSpace(input.URL), strings.TrimSpace(input.Filename), strings.TrimSpace(input.AltText)})
			if replay, found, err := idempotency.Replay[mcpMedia](ctx, h.db, request); found || err != nil {
				if err != nil {
					return nil, mcpIdempotencyError(err, "failed to upload media")
				}
				return map[string]any{
					"content":           []mcpContent{{Type: "text", Text: "Media uploaded: " + replay.Value.ID}},
					"structuredContent": map[string]any{"media": replay.Value},
				}, nil
			}
			media, rpcErr := h.fetchAndStoreRemoteMedia(ctx, input.WorkspaceID, input.URL, input.Filename, input.AltText)
			if rpcErr != nil {
				return nil, rpcErr
			}
			request.ResourceID = media.ID
			if result, err := idempotency.Execute(ctx, h.db, request, func(txCtx context.Context, tx bun.Tx) (mcpMedia, error) {
				_ = txCtx
				_ = tx
				return media, nil
			}); err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to upload media")
				}
				return nil, &mcpError{Code: -32603, Message: "media uploaded but the replay record failed"}
			} else if result.Replayed {
				media = result.Value
			}
			return map[string]any{
				"content":           []mcpContent{{Type: "text", Text: "Media uploaded: " + media.ID}},
				"structuredContent": map[string]any{"media": media},
			}, nil
		}
	}

	media, rpcErr := h.fetchAndStoreRemoteMedia(ctx, input.WorkspaceID, input.URL, input.Filename, input.AltText)
	if rpcErr != nil {
		return nil, rpcErr
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

func (h *MCPHandler) fetchAndStoreRemoteMedia(ctx context.Context, workspaceID, rawURL, filename, altText string) (mcpMedia, *mcpError) {
	remote, filename, declaredMimeType, content, rpcErr := h.fetchRemoteMedia(ctx, rawURL, filename)
	if rpcErr != nil {
		return mcpMedia{}, rpcErr
	}
	mediaHandler := &MediaHandler{
		db:      h.db,
		storage: h.mediaStorage,
		quota:   h.entitlement,
		usage:   h.usage,
	}
	result, err := mediaHandler.processUploadBytes(ctx, mediaUploadBytesInput{
		WorkspaceID:      workspaceID,
		Filename:         filename,
		DeclaredMimeType: declaredMimeType,
		Size:             int64(len(content)),
		Content:          content,
		AltText:          altText,
	})
	if err != nil {
		return mcpMedia{}, &mcpError{Code: -32602, Message: err.Error()}
	}

	return mcpMedia{
		ID:        stringFromMap(result, "id"),
		MimeType:  stringFromMap(result, "mime_type"),
		URL:       stringFromMap(result, "url"),
		Size:      int64FromMap(result, "size"),
		Deduped:   boolFromMap(result, "deduped"),
		Filename:  filename,
		AltText:   altText,
		SourceURL: remote.String(),
	}, nil
}

func (h *MCPHandler) renderLocalMediaUpload(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID string `json:"workspace_id"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid render_local_media_upload arguments"}
	}
	// The picker itself changes no state, matching its read-only annotation;
	// the one-use upload ticket is the state-changing step.
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	return map[string]any{
		"content":           []mcpContent{{Type: "text", Text: "Local media upload is ready."}},
		"structuredContent": map[string]any{"workspace_id": input.WorkspaceID},
	}, nil
}

//nolint:gocyclo // Ticket validation, minting, and replay must keep their failure modes distinct.
func (h *MCPHandler) createLocalMediaUploadTicket(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID    string `json:"workspace_id"`
		Filename       string `json:"filename"`
		MimeType       string `json:"mime_type"`
		Size           int64  `json:"size"`
		AltText        string `json:"alt_text"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid create_local_media_upload_ticket arguments"}
	}
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	filename := cleanUploadFilename(input.Filename)
	if filename == "" {
		return nil, &mcpError{Code: -32602, Message: "filename is required"}
	}
	if input.Size <= 0 {
		return nil, &mcpError{Code: -32602, Message: "file size is invalid"}
	}
	sizeLimit := mediaUploadSizeLimit("library", filename, input.MimeType)
	if input.Size > sizeLimit {
		return nil, &mcpError{Code: -32602, Message: mediaUploadSizeError(sizeLimit)}
	}
	token := uuid.NewString()
	expiresAt := time.Now().UTC().Add(mcpMediaUploadTTL)
	mint := func() (map[string]any, *mcpError) {
		ticket := &models.MCPMediaUploadTicket{
			ID: uuid.NewString(), TicketHash: hashMCPMediaUploadTicket(token),
			WorkspaceID: input.WorkspaceID, UserID: userID,
			SessionID: middleware.GetSessionID(ctx), TokenID: middleware.GetTokenID(ctx), ClientID: middleware.GetClientID(ctx),
			Filename: filename, MimeType: strings.TrimSpace(input.MimeType), Size: input.Size,
			AltText: strings.TrimSpace(input.AltText), ExpiresAt: expiresAt,
		}
		if _, err := h.db.NewInsert().Model(ticket).Exec(ctx); err != nil {
			return nil, &mcpError{Code: -32603, Message: "failed to prepare media upload"}
		}
		uploadURL := strings.TrimRight(h.publicURL, "/") + "/mcp/media-upload"
		if strings.TrimSpace(h.publicURL) == "" {
			uploadURL = "/mcp/media-upload"
		}
		return map[string]any{
			"content":           []mcpContent{{Type: "text", Text: "Secure local media upload prepared."}},
			"structuredContent": map[string]any{"ready": true, "expires_at": expiresAt.Format(time.RFC3339)},
			"_meta": map[string]any{"upload": map[string]any{
				"url": uploadURL, "method": http.MethodPut,
				"headers":    map[string]string{"Authorization": "Upload " + token, "Content-Type": ticket.MimeType},
				"expires_at": expiresAt.Format(time.RFC3339),
			}},
		}, nil
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		request, ok, rpcErr := mcpBuildIdempotencyRequest(ctx, strings.TrimSpace(input.WorkspaceID), "create-local-media-upload-ticket", args)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if ok {
			request.RequestHash, _ = idempotency.Hash(struct {
				WorkspaceID string `json:"workspace_id"`
				Filename    string `json:"filename"`
				MimeType    string `json:"mime_type"`
				Size        int64  `json:"size"`
				AltText     string `json:"alt_text"`
			}{strings.TrimSpace(input.WorkspaceID), filename, strings.TrimSpace(input.MimeType), input.Size, strings.TrimSpace(input.AltText)})
			if replay, found, err := idempotency.Replay[map[string]any](ctx, h.db, request); found || err != nil {
				if err != nil {
					return nil, mcpIdempotencyError(err, "failed to prepare media upload")
				}
				return replay.Value, nil
			}
			result, rpcErr := mint()
			if rpcErr != nil {
				return nil, rpcErr
			}
			if stored, err := idempotency.Execute(ctx, h.db, request, func(txCtx context.Context, tx bun.Tx) (map[string]any, error) {
				_ = txCtx
				_ = tx
				return result, nil
			}); err != nil {
				if errors.Is(err, idempotency.ErrConflict) {
					return nil, mcpIdempotencyError(err, "failed to prepare media upload")
				}
				// The ticket is minted; only the replay record failed.
				return nil, &mcpError{Code: -32603, Message: "upload prepared but the replay record failed"}
			} else if stored.Replayed {
				return stored.Value, nil
			}
			return result, nil
		}
	}
	return mint()
}

func hashMCPMediaUploadTicket(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func (h *MCPHandler) handleLocalMediaUpload(c echo.Context) error {
	if h.mediaHandler == nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{fieldError: "media upload is not configured"})
	}
	rawToken, ok := strings.CutPrefix(c.Request().Header.Get(echo.HeaderAuthorization), "Upload ")
	if !ok || strings.TrimSpace(rawToken) == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{fieldError: "missing upload ticket"})
	}
	now := time.Now().UTC()
	var ticket models.MCPMediaUploadTicket
	err := h.db.NewUpdate().Model(&ticket).
		Set("consumed_at = ?", now).
		Where("ticket_hash = ?", hashMCPMediaUploadTicket(strings.TrimSpace(rawToken))).
		Where("consumed_at IS NULL").
		Where("expires_at > ?", now).
		Returning("*").
		Scan(c.Request().Context())
	if errors.Is(err, sql.ErrNoRows) {
		return c.JSON(http.StatusUnauthorized, map[string]string{fieldError: "upload ticket is invalid, expired, or already used"})
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to validate upload ticket"})
	}
	if c.Request().ContentLength >= 0 && c.Request().ContentLength != ticket.Size {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "uploaded media size does not match declared size"})
	}
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, ticket.Size+1)
	result, uploadErr := h.mediaHandler.processUploadStream(
		c.Request().Context(), ticket.WorkspaceID, ticket.Filename, ticket.MimeType, ticket.Size, c.Request().Body,
		mediaUploadBytesInput{AltText: ticket.AltText},
	)
	if uploadErr != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: uploadErr.Error()})
	}
	return c.JSON(http.StatusCreated, result)
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
