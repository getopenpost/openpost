package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/netguard"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/apitokens"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/mediastore"
	postservice "github.com/openpost/backend/internal/services/posts"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/uptrace/bun"
)

const (
	mcpProtocolVersion   = "2025-06-18"
	mcpToolWorkspaces    = "list_workspaces"
	mcpToolProviders     = "list_provider_catalog"
	mcpToolAccounts      = "list_accounts"
	mcpToolListMedia     = "list_media"
	mcpToolReadiness     = "get_provider_readiness"
	mcpToolCreateDraft   = "create_draft"
	mcpToolCreatePub     = "create_publication"
	mcpToolListPubs      = "list_publications"
	mcpToolValidatePub   = "validate_publication"
	mcpToolSchedulePub   = "schedule_publication"
	mcpToolPublishPubNow = "publish_publication_now"
	mcpToolPubEvents     = "list_publication_events"
	mcpToolComments      = "list_rendition_comments"
	mcpToolListDrafts    = "list_drafts"
	mcpToolUpdateDraft   = "update_draft"
	mcpToolRenditions    = "set_post_renditions"
	mcpToolSchedulePost  = "schedule_post"
	mcpToolScheduleDraft = "schedule_draft"
	mcpToolGetPost       = "get_post_status"
	mcpToolListPosts     = "list_scheduled_posts"
	mcpToolCancelPost    = "cancel_post"
	mcpToolSuggestSlot   = "suggest_next_slot"
	mcpToolUploadURL     = "upload_media_from_url"
	mcpToolRenderWidget  = "render_scheduler_widget"
	mcpPromptPlanPost    = "plan_social_post"
	mcpPromptRenditions  = "adapt_platform_renditions"
	mcpPromptReviewQueue = "review_schedule"
	mcpScopeFull         = apitokens.ScopeMCP
	maxRemoteMediaBytes  = 50 * 1024 * 1024
	mcpAppWidgetURI      = "ui://widget/openpost-scheduler-v1.html"
	mcpAppWidgetMimeType = "text/html;profile=mcp-app"
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
	providers         map[string]platform.Adapter
	dynamicMastodon   bool
	tokenEncryptor    *servicecrypto.TokenEncryptor
	serverVersion     string
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

func (h *MCPHandler) SetUsage(usageService *usage.Service) {
	if usageService != nil {
		h.usage = usageService
	}
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

func (h *MCPHandler) SetProviderCatalog(providers map[string]platform.Adapter, dynamicMastodon bool) {
	h.providers = providers
	h.dynamicMastodon = dynamicMastodon
}

func (h *MCPHandler) SetTokenEncryptor(encryptor *servicecrypto.TokenEncryptor) {
	h.tokenEncryptor = encryptor
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

func (h *MCPHandler) handle(c echo.Context) error {
	principal, err := h.authenticate(c.Request())
	if err != nil {
		challenge := h.mcpWWWAuthenticate(c.Request())
		c.Response().Header().Set("WWW-Authenticate", challenge)
		return c.JSON(http.StatusUnauthorized, map[string]any{
			fieldError: "unauthorized",
			"_meta": map[string]any{
				"mcp/www_authenticate": challenge,
			},
		})
	}

	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return c.JSON(http.StatusBadRequest, mcpResponse{
			JSONRPC: "2.0",
			Error:   &mcpError{Code: -32700, Message: "parse error"},
		})
	}

	var req mcpRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return c.JSON(http.StatusBadRequest, mcpResponse{
			JSONRPC: "2.0",
			Error:   &mcpError{Code: -32700, Message: "parse error"},
		})
	}
	if req.JSONRPC != "2.0" || req.Method == "" {
		return c.JSON(http.StatusOK, mcpResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &mcpError{Code: -32600, Message: "invalid request"},
		})
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

	result, rpcErr := h.dispatch(c.Request().Context(), principal, req)
	resp := mcpResponse{JSONRPC: "2.0", ID: req.ID}
	if rpcErr != nil {
		resp.Error = rpcErr
	} else {
		resp.Result = result
	}
	return c.JSON(http.StatusOK, resp)
}

func (h *MCPHandler) handleStreamGetUnsupported(c echo.Context) error {
	c.Response().Header().Set(echo.HeaderAllow, http.MethodPost)
	return c.NoContent(http.StatusMethodNotAllowed)
}

func (h *MCPHandler) protectedResourceMetadata(c echo.Context) error {
	baseURL := h.externalBaseURL(c.Request())
	resource := baseURL + "/mcp"
	return c.JSON(http.StatusOK, map[string]any{
		"resource":                 resource,
		"authorization_servers":    []string{baseURL},
		"scopes_supported":         []string{mcpScopeFull},
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
		return nil, fmt.Errorf("api token scope %q cannot access mcp", principal.Scope)
	}
	return principal, nil
}

func mcpScopeAllowed(scope string) bool {
	switch strings.TrimSpace(scope) {
	case "", apitokens.ScopeCLI, apitokens.ScopeMCP:
		return true
	default:
		return false
	}
}

type mcpWorkspaceScopeContextKey struct{}

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

func (h *MCPHandler) dispatch(ctx context.Context, principal *middleware.Principal, req mcpRequest) (any, *mcpError) {
	ctx = contextWithMCPWorkspaceScope(ctx, principal.WorkspaceID)
	switch req.Method {
	case "initialize":
		return map[string]any{
			"protocolVersion": mcpProtocolVersion,
			"serverInfo": map[string]string{
				"name":    "openpost",
				"version": h.serverVersion,
			},
			"instructions": "OpenPost schedules social posts and format-first publications. Use create_publication for post types such as link, image, carousel, story, short video, and long video; pass explicit rendition title/description/caption/settings when provider outputs differ. Use create_draft/update_draft for legacy short-text drafts. List workspaces, accounts, providers, and media when IDs are unknown; validate publications before scheduling or publishing; use render_scheduler_widget when a visual summary helps.",
			"capabilities": map[string]any{
				"tools":     map[string]any{"listChanged": false},
				"prompts":   map[string]any{"listChanged": false},
				"resources": map[string]any{"listChanged": false},
			},
		}, nil
	case "ping":
		return map[string]any{}, nil
	case "tools/list":
		return map[string]any{"tools": []map[string]any{
			mcpListWorkspacesTool(),
			mcpListProviderCatalogTool(),
			mcpListAccountsTool(),
			mcpListMediaTool(),
			mcpProviderReadinessTool(),
			mcpCreatePublicationTool(),
			mcpListPublicationsTool(),
			mcpValidatePublicationTool(),
			mcpSchedulePublicationTool(),
			mcpPublishPublicationNowTool(),
			mcpListPublicationEventsTool(),
			mcpListRenditionCommentsTool(),
			mcpCreateDraftTool(),
			mcpListDraftsTool(),
			mcpUpdateDraftTool(),
			mcpSetPostRenditionsTool(),
			mcpSchedulePostTool(),
			mcpScheduleDraftTool(),
			mcpGetPostStatusTool(),
			mcpListScheduledPostsTool(),
			mcpCancelPostTool(),
			mcpSuggestNextSlotTool(),
			mcpUploadMediaFromURLTool(),
			mcpRenderSchedulerWidgetTool(),
		}}, nil
	case "resources/list":
		return h.listMCPResources(), nil
	case "resources/read":
		return h.readMCPResource(req.Params)
	case "prompts/list":
		return map[string]any{"prompts": []map[string]any{
			mcpPlanSocialPostPrompt(),
			mcpAdaptPlatformRenditionsPrompt(),
			mcpReviewSchedulePrompt(),
		}}, nil
	case "prompts/get":
		return mcpGetPrompt(req.Params)
	case "tools/call":
		return h.callTool(ctx, principal, req.Params)
	default:
		return nil, &mcpError{Code: -32601, Message: "method not found"}
	}
}

func mcpPlanSocialPostPrompt() map[string]any {
	return map[string]any{
		"name":        mcpPromptPlanPost,
		"title":       "Plan social post",
		"description": "Turn an idea into a workspace-aware OpenPost draft plan.",
		"arguments": []map[string]any{
			{"name": "idea", "description": "The source idea, note, link, or rough post to develop.", "required": true},
			{"name": "workspace_id", "description": "Optional workspace ID if already known.", "required": false},
			{"name": "platforms", "description": "Optional comma-separated destination platforms to consider.", "required": false},
		},
	}
}

func mcpAdaptPlatformRenditionsPrompt() map[string]any {
	return map[string]any{
		"name":        mcpPromptRenditions,
		"title":       "Adapt platform renditions",
		"description": "Rewrite a draft or scheduled post into platform-native destination copy.",
		"arguments": []map[string]any{
			{"name": "workspace_id", "description": "Workspace ID that owns the post.", "required": true},
			{"name": "post_id", "description": "Draft or scheduled post ID to adapt.", "required": true},
			{"name": "goal", "description": "Optional campaign goal, audience, or tone guidance.", "required": false},
		},
	}
}

func mcpReviewSchedulePrompt() map[string]any {
	return map[string]any{
		"name":        mcpPromptReviewQueue,
		"title":       "Review publishing queue",
		"description": "Inspect upcoming scheduled posts and recommend useful next actions.",
		"arguments": []map[string]any{
			{"name": "workspace_id", "description": "Workspace ID to inspect.", "required": true},
			{"name": "window", "description": "Optional time window, such as today, this week, or next 14 days.", "required": false},
		},
	}
}

func mcpGetPrompt(raw json.RawMessage) (any, *mcpError) {
	var params struct {
		Name      string            `json:"name"`
		Arguments map[string]string `json:"arguments"`
	}
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid prompt params"}
	}
	switch params.Name {
	case mcpPromptPlanPost:
		return mcpPromptResult("Plan an OpenPost draft from an idea.", mcpPlanPostPromptText(params.Arguments)), nil
	case mcpPromptRenditions:
		return mcpPromptResult("Adapt a post into platform-native renditions.", mcpRenditionsPromptText(params.Arguments)), nil
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
			"description": "Renders OpenPost workspaces, accounts, media, drafts, scheduled posts, provider status, and post details in ChatGPT.",
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
		"openai/widgetDescription":   "OpenPost scheduler view for workspaces, accounts, media, drafts, scheduled posts, provider status, and post details.",
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
  function renderPost(post) {
    if (!post) return '<div class="empty">No post data to show.</div>';
    var destinations = array(post.destinations).map(function (dest) {
      return '<div class="row"><span class="muted">' + escapeHTML(dest.platform || dest.social_account_id || "destination") + '</span><span class="' + statusClass(dest.status) + '">' + escapeHTML(dest.status || "pending") + '</span></div>';
    }).join("");
    var media = array(post.media).map(function (item) {
      return '<div class="row"><span class="muted">' + escapeHTML(item.original_filename || item.media_id || "media") + '</span><span class="pill idle">' + escapeHTML(item.mime_type || "asset") + '</span></div>';
    }).join("");
    return '<section class="card"><div class="title">' + escapeHTML(post.content || post.id || "Post") + '</div><div class="muted">' + escapeHTML(post.scheduled_at || post.created_at || "") + '</div>' + destinations + media + '</section>';
  }
  function renderData(view, data) {
    if (view === "post") return renderPost(data.post);
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
1. If workspace_id is missing, call list_workspaces and ask which workspace to use.
2. Call list_provider_catalog to understand which requested platforms are available, need server configuration, or are still planned.
3. Call list_accounts for the selected workspace and pick destination accounts matching these platform hints: %s.
4. Call list_media if the idea needs existing media, or upload_media_from_url if the user supplied a public media URL.
5. Create one concise draft with create_draft, attaching media_ids when relevant. Do not schedule it until the user approves timing and destinations.
6. Explain what you created and suggest the next scheduling step.

workspace_id: %s
`, promptArg(args, "idea", "(missing idea)"), promptArg(args, "platforms", "any connected platforms"), promptArg(args, "workspace_id", "(choose with list_workspaces)")))
}

func mcpRenditionsPromptText(args map[string]string) string {
	return strings.TrimSpace(fmt.Sprintf(`
Adapt an existing OpenPost post into platform-native renditions.

workspace_id: %s
post_id: %s
goal: %s

Workflow:
1. Call get_post_status to inspect destinations and current state.
2. Write concise, platform-native copy for each destination account.
3. Call set_post_renditions with one rendition per destination account.
4. Summarize what changed and mention any platforms that need media, hashtags, or shorter copy.
`, promptArg(args, "workspace_id", "(required)"), promptArg(args, "post_id", "(required)"), promptArg(args, "goal", "match the source post and audience")))
}

func mcpReviewQueuePromptText(args map[string]string) string {
	return strings.TrimSpace(fmt.Sprintf(`
Review the OpenPost publishing queue and recommend useful next actions.

workspace_id: %s
window: %s

Workflow:
1. Call list_scheduled_posts for the workspace and requested window.
2. Look for collisions, empty stretches, missing platform coverage, and posts that need destination-specific renditions.
3. Call suggest_next_slot if a useful new slot is needed.
4. Recommend concrete actions without canceling or scheduling anything unless the user explicitly asks.
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

func mcpListWorkspacesTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolWorkspaces,
		"title":       "List workspaces",
		"description": "List OpenPost workspaces available to the authenticated user.",
		"inputSchema": map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		},
	}, true, false)
}

func mcpListProviderCatalogTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolProviders,
		"title":       "List provider catalog",
		"description": "List OpenPost provider launch status so assistants know which platforms are connectable, unconfigured, or planned.",
		"inputSchema": map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		},
	}, true, false)
}

func mcpListAccountsTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolAccounts,
		"title":       "List social accounts",
		"description": "List active social accounts connected to an OpenPost workspace.",
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
	}, true, false)
}

func mcpListMediaTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolListMedia,
		"title":       "List media",
		"description": "List recent media attachments in an OpenPost workspace so assistants can reuse existing assets.",
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
	}, true, false)
}

func mcpProviderReadinessTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolReadiness,
		"title":       "Get provider readiness",
		"description": "Inspect provider app, account scope, public media, quota, and audit readiness for an OpenPost workspace.",
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
	}, true, false)
}

func mcpCreateDraftTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolCreateDraft,
		"title":       "Create draft",
		"description": "Create an OpenPost draft in a workspace, optionally assigning destination social accounts and media.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
				"content": map[string]any{
					"type":        "string",
					"description": "Draft post content.",
				},
				"social_account_ids": map[string]any{
					"type":        "array",
					"description": "Optional destination account IDs returned by list_accounts.",
					"items":       map[string]any{"type": "string"},
				},
				"media_ids": map[string]any{
					"type":        "array",
					"description": "Optional media attachment IDs returned by list_media or upload_media_from_url.",
					"items":       map[string]any{"type": "string"},
				},
			},
			"required":             []string{"workspace_id", "content"},
			"additionalProperties": false,
		},
	}, false, false)
}

func mcpCreatePublicationTool() map[string]any {
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
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolCreatePub,
		"title":       "Create publication",
		"description": "Create a format-first publication. Use explicit renditions when selected accounts need different output roles, for example YouTube title/description plus TikTok caption for the same short video.",
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
	}, false, false)
}

func mcpListPublicationsTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolListPubs,
		"title":       "List publications",
		"description": "List format-first publications in a workspace.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id":    map[string]any{"type": "string", "description": "Workspace ID returned by list_workspaces."},
				"status":          map[string]any{"type": "string", "description": "Optional publication status filter."},
				"content_profile": map[string]any{"type": "string", "description": "Optional content profile filter."},
				"limit":           map[string]any{"type": "integer", "minimum": 1, "maximum": 100, "description": "Maximum publications to return. Defaults to 20."},
			},
			"required":             []string{"workspace_id"},
			"additionalProperties": false,
		},
	}, true, false)
}

func mcpValidatePublicationTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolValidatePub,
		"title":       "Validate publication",
		"description": "Run provider capability, media readiness, account scope, and native processing validation for a publication.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"publication_id": map[string]any{"type": "string", "description": "Publication ID returned by create_publication or list_publications."},
			},
			"required":             []string{"publication_id"},
			"additionalProperties": false,
		},
	}, true, false)
}

func mcpSchedulePublicationTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolSchedulePub,
		"title":       "Schedule publication",
		"description": "Validate and enqueue a publication whose scheduled_at is already set.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"publication_id": map[string]any{"type": "string", "description": "Publication ID returned by create_publication or list_publications."},
			},
			"required":             []string{"publication_id"},
			"additionalProperties": false,
		},
	}, false, true)
}

func mcpPublishPublicationNowTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolPublishPubNow,
		"title":       "Publish publication now",
		"description": "Validate and queue a publication for immediate publishing.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"publication_id": map[string]any{"type": "string", "description": "Publication ID returned by create_publication or list_publications."},
			},
			"required":             []string{"publication_id"},
			"additionalProperties": false,
		},
	}, false, true)
}

func mcpListPublicationEventsTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolPubEvents,
		"title":       "List publication events",
		"description": "List lifecycle events recorded while an OpenPost publication is prepared, published, retried, or moderated.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"publication_id": map[string]any{"type": "string", "description": "Publication ID returned by create_publication or list_publications."},
				"limit":          map[string]any{"type": "integer", "minimum": 1, "maximum": 200, "description": "Maximum events to return. Defaults to 100."},
			},
			"required":             []string{"publication_id"},
			"additionalProperties": false,
		},
	}, true, false)
}

func mcpListRenditionCommentsTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolComments,
		"title":       "List rendition comments",
		"description": "List live provider comments for a published rendition when the platform supports comment retrieval.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"rendition_id": map[string]any{"type": "string", "description": "Rendition ID from a publication's destination-specific output."},
			},
			"required":             []string{"rendition_id"},
			"additionalProperties": false,
		},
	}, true, false)
}

func mcpListDraftsTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolListDrafts,
		"title":       "List drafts",
		"description": "List editable draft posts in a workspace so an assistant can inspect unfinished work before creating duplicates.",
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
					"description": "Maximum drafts to return. Defaults to 20.",
				},
			},
			"required":             []string{"workspace_id"},
			"additionalProperties": false,
		},
	}, true, false)
}

func mcpUpdateDraftTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolUpdateDraft,
		"title":       "Update draft",
		"description": "Update an editable draft's source content, destination accounts, or attached media.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
				"post_id": map[string]any{
					"type":        "string",
					"description": "Draft post ID returned by create_draft or list_drafts.",
				},
				"content": map[string]any{
					"type":        "string",
					"description": "Updated source draft content.",
				},
				"social_account_ids": map[string]any{
					"type":        "array",
					"description": "Optional replacement destination account IDs returned by list_accounts. Pass an empty array to clear destinations.",
					"items":       map[string]any{"type": "string"},
				},
				"media_ids": map[string]any{
					"type":        "array",
					"description": "Optional replacement source media IDs returned by list_media or upload_media_from_url. Pass an empty array to clear media.",
					"items":       map[string]any{"type": "string"},
				},
			},
			"required":             []string{"workspace_id", "post_id"},
			"additionalProperties": false,
		},
	}, false, false)
}

func mcpSetPostRenditionsTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolRenditions,
		"title":       "Set post renditions",
		"description": "Create or update destination-specific post copy for accounts already assigned to an OpenPost draft or scheduled post.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
				"post_id": map[string]any{
					"type":        "string",
					"description": "Post ID returned by create_draft or schedule_post.",
				},
				"renditions": map[string]any{
					"type":        "array",
					"description": "Destination-specific copy keyed by social account.",
					"minItems":    1,
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"social_account_id": map[string]any{
								"type":        "string",
								"description": "Destination account ID returned by list_accounts and already attached to the post.",
							},
							"content": map[string]any{
								"type":        "string",
								"description": "Platform-native post content for this destination.",
							},
							"media_ids": map[string]any{
								"type":        "array",
								"description": "Optional media IDs to use for this destination instead of the parent post media.",
								"items":       map[string]any{"type": "string"},
							},
						},
						"required":             []string{"social_account_id", "content"},
						"additionalProperties": false,
					},
				},
			},
			"required":             []string{"workspace_id", "post_id", "renditions"},
			"additionalProperties": false,
		},
	}, false, false)
}

func mcpSchedulePostTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolSchedulePost,
		"title":       "Schedule post",
		"description": "Create a scheduled OpenPost post and queue it for publishing.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
				"content": map[string]any{
					"type":        "string",
					"description": "Post content.",
				},
				"scheduled_at": map[string]any{
					"type":        "string",
					"format":      "date-time",
					"description": "Publish time as an RFC3339 timestamp.",
				},
				"social_account_ids": map[string]any{
					"type":        "array",
					"description": "Destination account IDs returned by list_accounts.",
					"items":       map[string]any{"type": "string"},
					"minItems":    1,
				},
				"media_ids": map[string]any{
					"type":        "array",
					"description": "Optional media attachment IDs returned by list_media or upload_media_from_url.",
					"items":       map[string]any{"type": "string"},
				},
			},
			"required":             []string{"workspace_id", "content", "scheduled_at", "social_account_ids"},
			"additionalProperties": false,
		},
	}, false, true)
}

func mcpScheduleDraftTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolScheduleDraft,
		"title":       "Schedule draft",
		"description": "Schedule an existing draft post and queue it for publishing without creating a duplicate post.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
				"post_id": map[string]any{
					"type":        "string",
					"description": "Draft post ID returned by create_draft or list_drafts.",
				},
				"scheduled_at": map[string]any{
					"type":        "string",
					"format":      "date-time",
					"description": "Publish time as an RFC3339 timestamp.",
				},
				"social_account_ids": map[string]any{
					"type":        "array",
					"description": "Optional replacement destination account IDs returned by list_accounts. If omitted, the draft's current destinations are used.",
					"items":       map[string]any{"type": "string"},
					"minItems":    1,
				},
				"media_ids": map[string]any{
					"type":        "array",
					"description": "Optional replacement source media IDs returned by list_media or upload_media_from_url. If omitted, existing draft media is used.",
					"items":       map[string]any{"type": "string"},
				},
				"random_delay_minutes": map[string]any{
					"type":        "integer",
					"minimum":     0,
					"description": "Optional natural-posting random delay window in minutes.",
				},
			},
			"required":             []string{"workspace_id", "post_id", "scheduled_at"},
			"additionalProperties": false,
		},
	}, false, true)
}

func mcpGetPostStatusTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolGetPost,
		"title":       "Get post status",
		"description": "Read the current OpenPost status and destination status for a post.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
				"post_id": map[string]any{
					"type":        "string",
					"description": "Post ID returned by create_draft or schedule_post.",
				},
			},
			"required":             []string{"workspace_id", "post_id"},
			"additionalProperties": false,
		},
	}, true, false)
}

func mcpListScheduledPostsTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolListPosts,
		"title":       "List scheduled posts",
		"description": "List upcoming scheduled posts in a workspace so an assistant can inspect the publishing queue.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
				"from": map[string]any{
					"type":        "string",
					"format":      "date-time",
					"description": "Optional inclusive RFC3339 lower bound for scheduled_at.",
				},
				"to": map[string]any{
					"type":        "string",
					"format":      "date-time",
					"description": "Optional exclusive RFC3339 upper bound for scheduled_at.",
				},
				"limit": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"maximum":     100,
					"description": "Maximum posts to return. Defaults to 20.",
				},
			},
			"required":             []string{"workspace_id"},
			"additionalProperties": false,
		},
	}, true, false)
}

func mcpCancelPostTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolCancelPost,
		"title":       "Cancel scheduled post",
		"description": "Cancel a queued scheduled post and leave it as an editable draft.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"workspace_id": map[string]any{
					"type":        "string",
					"description": "Workspace ID returned by list_workspaces.",
				},
				"post_id": map[string]any{
					"type":        "string",
					"description": "Scheduled post ID returned by schedule_post.",
				},
			},
			"required":             []string{"workspace_id", "post_id"},
			"additionalProperties": false,
		},
	}, false, true)
}

func mcpSuggestNextSlotTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolSuggestSlot,
		"title":       "Suggest next slot",
		"description": "Suggest the next free configured posting slot for a workspace.",
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
	}, true, false)
}

func mcpUploadMediaFromURLTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolUploadURL,
		"title":       "Upload media from URL",
		"description": "Fetch a public media URL and store it in an OpenPost workspace.",
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
	}, false, true)
}

func mcpRenderSchedulerWidgetTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolRenderWidget,
		"title":       "Render scheduler widget",
		"description": "Render OpenPost scheduler data in a ChatGPT Apps widget.",
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
	}, true, false)
}

func mcpToolDescriptor(tool map[string]any, readOnly, openWorld bool) map[string]any {
	securitySchemes := []map[string]any{mcpOAuthSecurityScheme()}
	toolName, _ := tool["name"].(string)
	tool["securitySchemes"] = securitySchemes
	tool["outputSchema"] = mcpToolOutputSchema(toolName)
	tool["annotations"] = map[string]any{
		"readOnlyHint":    readOnly,
		"destructiveHint": false,
		"openWorldHint":   openWorld,
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

func mcpToolUsesAppWidget(toolName string) bool {
	return toolName == mcpToolRenderWidget
}

type mcpToolStatus struct {
	Invoking string
	Invoked  string
}

var mcpToolStatuses = map[string]mcpToolStatus{
	mcpToolWorkspaces:    {Invoking: "Loading workspaces", Invoked: "Workspaces loaded"},
	mcpToolProviders:     {Invoking: "Loading providers", Invoked: "Providers loaded"},
	mcpToolAccounts:      {Invoking: "Loading accounts", Invoked: "Accounts loaded"},
	mcpToolListMedia:     {Invoking: "Loading media", Invoked: "Media loaded"},
	mcpToolReadiness:     {Invoking: "Checking provider readiness", Invoked: "Provider readiness loaded"},
	mcpToolCreateDraft:   {Invoking: "Creating draft", Invoked: "Draft created"},
	mcpToolCreatePub:     {Invoking: "Creating publication", Invoked: "Publication created"},
	mcpToolListPubs:      {Invoking: "Loading publications", Invoked: "Publications loaded"},
	mcpToolValidatePub:   {Invoking: "Validating publication", Invoked: "Publication validated"},
	mcpToolSchedulePub:   {Invoking: "Scheduling publication", Invoked: "Publication scheduled"},
	mcpToolPublishPubNow: {Invoking: "Queueing publication", Invoked: "Publication queued"},
	mcpToolPubEvents:     {Invoking: "Loading publication events", Invoked: "Publication events loaded"},
	mcpToolComments:      {Invoking: "Loading comments", Invoked: "Comments loaded"},
	mcpToolListDrafts:    {Invoking: "Loading drafts", Invoked: "Drafts loaded"},
	mcpToolUpdateDraft:   {Invoking: "Updating draft", Invoked: "Draft updated"},
	mcpToolRenditions:    {Invoking: "Updating renditions", Invoked: "Renditions updated"},
	mcpToolSchedulePost:  {Invoking: "Scheduling post", Invoked: "Post scheduled"},
	mcpToolScheduleDraft: {Invoking: "Scheduling draft", Invoked: "Draft scheduled"},
	mcpToolGetPost:       {Invoking: "Loading post status", Invoked: "Post status loaded"},
	mcpToolListPosts:     {Invoking: "Loading queue", Invoked: "Queue loaded"},
	mcpToolCancelPost:    {Invoking: "Canceling post", Invoked: "Post canceled"},
	mcpToolSuggestSlot:   {Invoking: "Finding next slot", Invoked: "Next slot found"},
	mcpToolUploadURL:     {Invoking: "Uploading media", Invoked: "Media uploaded"},
	mcpToolRenderWidget:  {Invoking: "Rendering view", Invoked: "View rendered"},
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
	case mcpToolCreateDraft, mcpToolUpdateDraft, mcpToolSchedulePost, mcpToolScheduleDraft, mcpToolGetPost, mcpToolCancelPost:
		return mcpStructuredOutputSchema(map[string]any{
			"post": mcpOpenObjectSchema(),
		}, "post")
	case mcpToolCreatePub:
		return mcpStructuredOutputSchema(map[string]any{
			"publication": mcpOpenObjectSchema(),
		}, "publication")
	case mcpToolSchedulePub, mcpToolPublishPubNow:
		return mcpStructuredOutputSchema(map[string]any{
			"publication": mcpOpenObjectSchema(),
			"job_id":      map[string]any{"type": "string"},
		}, "publication", "job_id")
	case mcpToolValidatePub:
		return mcpStructuredOutputSchema(map[string]any{
			"valid":  map[string]any{"type": "boolean"},
			"issues": mcpArraySchema(mcpOpenObjectSchema()),
		}, "valid", "issues")
	case mcpToolRenditions:
		return mcpStructuredOutputSchema(map[string]any{
			"post_id":    map[string]any{"type": "string"},
			"renditions": mcpArraySchema(mcpOpenObjectSchema()),
		}, "post_id", "renditions")
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
	default:
		return mcpStructuredOutputSchema(map[string]any{})
	}
}

func mcpArrayOutputKey(toolName string) (string, bool) {
	switch toolName {
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
	case mcpToolListDrafts, mcpToolListPosts:
		return "posts", true
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
		"additionalProperties": true,
	}
}

func mcpOAuthSecurityScheme() map[string]any {
	return map[string]any{
		"type":   "oauth2",
		"scopes": []string{mcpScopeFull},
	}
}

func (h *MCPHandler) callTool(ctx context.Context, principal *middleware.Principal, raw json.RawMessage) (any, *mcpError) {
	var params struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	}
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid tool call params"}
	}
	start := time.Now()
	var (
		result any
		rpcErr *mcpError
	)
	switch params.Name {
	case mcpToolWorkspaces, mcpToolProviders:
		result, rpcErr = h.callReadOnlyGlobalTool(ctx, principal.UserID, params.Name)
	case mcpToolAccounts, mcpToolListMedia, mcpToolReadiness:
		result, rpcErr = h.callReadOnlyWorkspaceTool(ctx, principal.UserID, params.Name, params.Arguments)
	case mcpToolRenderWidget:
		result, rpcErr = h.renderSchedulerWidget(params.Arguments)
	case mcpToolCreateDraft, mcpToolListDrafts, mcpToolUpdateDraft,
		mcpToolCreatePub, mcpToolListPubs, mcpToolValidatePub, mcpToolPubEvents, mcpToolComments,
		mcpToolRenditions, mcpToolSchedulePost, mcpToolScheduleDraft,
		mcpToolGetPost, mcpToolListPosts, mcpToolCancelPost,
		mcpToolSuggestSlot, mcpToolUploadURL:
		result, rpcErr = h.callWorkspaceActionTool(ctx, principal.UserID, params.Name, params.Arguments)
	default:
		rpcErr = &mcpError{Code: -32602, Message: "unknown tool"}
	}
	h.recordToolCall(ctx, principal, params.Name, workspaceIDFromMCPArguments(params.Arguments), time.Since(start), rpcErr)
	return result, rpcErr
}

func (h *MCPHandler) callWorkspaceActionTool(ctx context.Context, userID, toolName string, args map[string]any) (any, *mcpError) {
	switch toolName {
	case mcpToolCreateDraft:
		return h.createDraft(ctx, userID, args)
	case mcpToolCreatePub, mcpToolListPubs, mcpToolValidatePub, mcpToolSchedulePub, mcpToolPublishPubNow, mcpToolPubEvents, mcpToolComments:
		return h.callPublicationTool(ctx, userID, toolName, args)
	case mcpToolListDrafts:
		return h.listDrafts(ctx, userID, args)
	case mcpToolUpdateDraft:
		return h.updateDraft(ctx, userID, args)
	case mcpToolRenditions:
		return h.setPostRenditions(ctx, userID, args)
	case mcpToolSchedulePost:
		return h.schedulePost(ctx, userID, args)
	case mcpToolScheduleDraft:
		return h.scheduleDraft(ctx, userID, args)
	case mcpToolGetPost:
		return h.getPostStatus(ctx, userID, args)
	case mcpToolListPosts:
		return h.listScheduledPosts(ctx, userID, args)
	case mcpToolCancelPost:
		return h.cancelPost(ctx, userID, args)
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
	case mcpToolValidatePub:
		return h.validatePublication(ctx, userID, args)
	case mcpToolSchedulePub:
		return h.schedulePublication(ctx, userID, args)
	case mcpToolPublishPubNow:
		return h.publishPublicationNow(ctx, userID, args)
	case mcpToolPubEvents:
		return h.listPublicationEvents(ctx, userID, args)
	case mcpToolComments:
		return h.listRenditionComments(ctx, userID, args)
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
		return h.listProviderCatalog(), nil
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
	return []string{"summary", "workspaces", "providers", "accounts", "media", "post", "posts", "suggestion", "renditions"}
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
	return json.Unmarshal(payload, dest)
}

func (h *MCPHandler) recordToolCall(ctx context.Context, principal *middleware.Principal, toolName, workspaceID string, duration time.Duration, rpcErr *mcpError) {
	status := "success"
	errorMessage := ""
	if rpcErr != nil {
		status = "error"
		errorMessage = rpcErr.Message
	}
	_, _ = h.db.NewInsert().Model(&models.MCPToolCall{
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
	}).Exec(ctx)
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
	count, err := h.db.NewSelect().
		Model((*models.WorkspaceMember)(nil)).
		Where("workspace_id = ? AND user_id = ?", workspaceID, userID).
		Count(ctx)
	if err != nil {
		return &mcpError{Code: -32603, Message: "failed to check workspace access"}
	}
	if count == 0 {
		return &mcpError{Code: -32602, Message: "workspace not accessible"}
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
		Where("wm.user_id = ?", userID)
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

func (h *MCPHandler) listProviderCatalog() any {
	providers := providerAvailability(h.providers, h.dynamicMastodon)
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
	WorkspaceID      string                  `json:"workspace_id"`
	ContentProfile   string                  `json:"content_profile"`
	Title            string                  `json:"title"`
	SourceText       string                  `json:"source_text"`
	SourceURL        string                  `json:"source_url"`
	ScheduledAt      *time.Time              `json:"scheduled_at"`
	SocialAccountIDs []string                `json:"social_account_ids"`
	MediaIDs         []string                `json:"media_ids"`
	Media            []PublicationMediaInput `json:"media"`
	Renditions       []RenditionInput        `json:"renditions"`
	Metadata         map[string]interface{}  `json:"metadata"`
}

type mcpPublicationStatus struct {
	ID             string `json:"id"`
	WorkspaceID    string `json:"workspace_id"`
	Title          string `json:"title"`
	ContentProfile string `json:"content_profile"`
	Status         string `json:"status"`
	SourceText     string `json:"source_text"`
	SourceURL      string `json:"source_url,omitempty"`
	ScheduledAt    string `json:"scheduled_at,omitempty"`
	CreatedAt      string `json:"created_at"`
	RenditionCount int    `json:"rendition_count"`
}

func (h *MCPHandler) createPublication(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input mcpCreatePublicationInput
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid create_publication arguments"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := validateMCPCreatePublicationInput(input); rpcErr != nil {
		return nil, rpcErr
	}

	defaultMedia, rpcErr := mcpDefaultPublicationMedia(input)
	if rpcErr != nil {
		return nil, rpcErr
	}
	publicationHandler := &PublicationHandler{db: h.db}
	renditions, rpcErr := mcpPublicationRenditions(publicationHandler, input, defaultMedia)
	if rpcErr != nil {
		return nil, rpcErr
	}
	accountMap, err := publicationHandler.loadAccounts(ctx, input.WorkspaceID, renditionAccountIDs(renditions))
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: err.Error()}
	}
	if err := publicationHandler.validateMediaBelongsToWorkspace(ctx, input.WorkspaceID, allMediaIDs(defaultMedia, renditions)); err != nil {
		return nil, &mcpError{Code: -32602, Message: err.Error()}
	}

	now := time.Now().UTC()
	publication := newMCPPublication(input, userID, now)
	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(publication).Exec(txCtx); err != nil {
			return err
		}
		return publicationHandler.insertRenditions(txCtx, tx, publication, renditions, defaultMedia, accountMap)
	})
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to create publication"}
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

func validateMCPCreatePublicationInput(input mcpCreatePublicationInput) *mcpError {
	if strings.TrimSpace(input.ContentProfile) == "" {
		return &mcpError{Code: -32602, Message: "content_profile is required"}
	}
	if strings.TrimSpace(input.SourceText) == "" {
		return &mcpError{Code: -32602, Message: "source_text is required"}
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

func mcpPublicationRenditions(publicationHandler *PublicationHandler, input mcpCreatePublicationInput, defaultMedia []PublicationMediaInput) ([]RenditionInput, *mcpError) {
	if len(input.Renditions) > 0 {
		return input.Renditions, nil
	}
	accountIDs, rpcErr := normalizeMCPIDs(input.SocialAccountIDs, "social_account_ids")
	if rpcErr != nil {
		return nil, rpcErr
	}
	return publicationHandler.defaultRenditionInputs(accountIDs, input.ContentProfile, input.SourceText, input.Title, defaultMedia), nil
}

func newMCPPublication(input mcpCreatePublicationInput, userID string, now time.Time) *models.Publication {
	metadata := map[string]interface{}{"created_from": "mcp"}
	for key, value := range input.Metadata {
		metadata[key] = value
	}
	publication := &models.Publication{
		ID:              newUUID(),
		WorkspaceID:     input.WorkspaceID,
		CreatedByID:     userID,
		Title:           publicationFirstNonEmpty(input.Title, firstMCPContentLine(input.SourceText), "Untitled publication"),
		ContentProfile:  input.ContentProfile,
		SourceText:      input.SourceText,
		SourceContent:   input.SourceText,
		SourceURL:       input.SourceURL,
		Status:          models.PublicationStatusDraft,
		MetadataJSON:    mustJSON(metadata),
		ReleasePlanJSON: mustJSON(metadata),
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if input.ScheduledAt != nil {
		publication.ScheduledAt = *input.ScheduledAt
		publication.Status = models.PublicationStatusScheduled
	}
	return publication
}

func (h *MCPHandler) listPublications(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID    string `json:"workspace_id"`
		Status         string `json:"status"`
		ContentProfile string `json:"content_profile"`
		Limit          int    `json:"limit"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid list_publications arguments"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	query := h.db.NewSelect().Model((*models.Publication)(nil)).Where("workspace_id = ?", input.WorkspaceID)
	if input.Status != "" {
		query = query.Where("status = ?", input.Status)
	}
	if input.ContentProfile != "" {
		query = query.Where("content_profile = ?", input.ContentProfile)
	}
	var rows []models.Publication
	if err := query.Order("created_at DESC").Limit(limit).Scan(ctx, &rows); err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to list publications"}
	}
	publications := make([]mcpPublicationStatus, 0, len(rows))
	for _, row := range rows {
		status, rpcErr := h.loadMCPPublicationStatus(ctx, row.ID)
		if rpcErr != nil {
			return nil, rpcErr
		}
		publications = append(publications, status)
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: fmt.Sprintf("Found %d publications.", len(publications))}},
		"structuredContent": map[string]any{
			"publications": publications,
		},
	}, nil
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
	var publication models.Publication
	if err := h.db.NewSelect().Model(&publication).Where("id = ?", input.PublicationID).Scan(ctx); err != nil {
		return nil, &mcpError{Code: -32602, Message: "publication not found"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, publication.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	issues, err := (&PublicationHandler{db: h.db}).validatePublicationByID(ctx, publication.ID)
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
	publication, rpcErr := h.loadMCPPublicationForAction(ctx, userID, args, "invalid schedule_publication arguments")
	if rpcErr != nil {
		return nil, rpcErr
	}
	if publication.ScheduledAt.IsZero() {
		return nil, &mcpError{Code: -32602, Message: "scheduled_at is required before scheduling"}
	}
	handler := &PublicationHandler{db: h.db}
	issues, err := handler.validatePublicationByID(ctx, publication.ID)
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to validate publication"}
	}
	if hasBlockingIssues(issues) {
		return nil, &mcpError{Code: -32602, Message: "publication has blocking validation errors"}
	}
	jobID, err := handler.replacePublicationJob(ctx, publication.ID, publication.ScheduledAt)
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to schedule publication"}
	}
	if err := handler.markPublicationQueued(ctx, publication.ID); err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to mark publication scheduled"}
	}
	status, rpcErr := h.loadMCPPublicationStatus(ctx, publication.ID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	return mcpPublicationActionResult("Publication scheduled: "+publication.ID, jobID, status), nil
}

func (h *MCPHandler) publishPublicationNow(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	publication, rpcErr := h.loadMCPPublicationForAction(ctx, userID, args, "invalid publish_publication_now arguments")
	if rpcErr != nil {
		return nil, rpcErr
	}
	handler := &PublicationHandler{db: h.db}
	issues, err := handler.validatePublicationByID(ctx, publication.ID)
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to validate publication"}
	}
	if hasBlockingIssues(issues) {
		return nil, &mcpError{Code: -32602, Message: "publication has blocking validation errors"}
	}
	jobID, err := handler.replacePublicationJob(ctx, publication.ID, time.Now().UTC())
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to queue publication"}
	}
	if err := handler.markPublicationQueued(ctx, publication.ID); err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to mark publication queued"}
	}
	status, rpcErr := h.loadMCPPublicationStatus(ctx, publication.ID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	return mcpPublicationActionResult("Publication queued: "+publication.ID, jobID, status), nil
}

func (h *MCPHandler) loadMCPPublicationForAction(ctx context.Context, userID string, args map[string]any, invalidMessage string) (models.Publication, *mcpError) {
	var input struct {
		PublicationID string `json:"publication_id"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return models.Publication{}, &mcpError{Code: -32602, Message: invalidMessage}
	}
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	if input.PublicationID == "" {
		return models.Publication{}, &mcpError{Code: -32602, Message: "publication_id is required"}
	}
	var publication models.Publication
	if err := h.db.NewSelect().Model(&publication).Where("id = ?", input.PublicationID).Scan(ctx); err != nil {
		return models.Publication{}, &mcpError{Code: -32602, Message: "publication not found"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, publication.WorkspaceID); rpcErr != nil {
		return models.Publication{}, rpcErr
	}
	return publication, nil
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
	var publication models.Publication
	if err := h.db.NewSelect().Model(&publication).Where("id = ?", input.PublicationID).Scan(ctx); err != nil {
		return nil, &mcpError{Code: -32602, Message: "publication not found"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, publication.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	events, err := lifecycle.NewService(h.db).ListForPublication(ctx, publication.WorkspaceID, publication.ID, input.Limit)
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to list publication events"}
	}
	out := make([]PublicationLifecycleEventResponse, 0, len(events))
	for _, event := range events {
		out = append(out, publicationLifecycleEventResponse(event))
	}
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
	commenter, accessToken, rpcErr := h.commentAdapter(account)
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

func (h *MCPHandler) commentAdapter(account *models.SocialAccount) (platform.CommentAdapter, string, *mcpError) {
	provider := h.providers[account.Platform]
	commenter, ok := provider.(platform.CommentAdapter)
	if !ok || commenter == nil {
		return nil, "", &mcpError{Code: -32603, Message: fmt.Sprintf("comments are not supported for %s", account.Platform)}
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
		ID:             publication.ID,
		WorkspaceID:    publication.WorkspaceID,
		Title:          publication.Title,
		ContentProfile: publication.ContentProfile,
		Status:         publication.Status,
		SourceText:     publication.SourceText,
		SourceURL:      publication.SourceURL,
		ScheduledAt:    formatOptionalTime(publication.ScheduledAt),
		CreatedAt:      publication.CreatedAt.Format(time.RFC3339),
		RenditionCount: count,
	}, nil
}

func firstMCPContentLine(content string) string {
	for _, line := range strings.Split(content, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func (h *MCPHandler) createDraft(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID      string   `json:"workspace_id"`
		Content          string   `json:"content"`
		SocialAccountIDs []string `json:"social_account_ids"`
		MediaIDs         []string `json:"media_ids"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid create_draft arguments"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	if strings.TrimSpace(input.Content) == "" {
		return nil, &mcpError{Code: -32602, Message: "content is required"}
	}
	if rpcErr := h.ensureActiveAccounts(ctx, input.WorkspaceID, input.SocialAccountIDs); rpcErr != nil {
		return nil, rpcErr
	}
	mediaIDs, rpcErr := normalizeMCPIDs(input.MediaIDs, "media_ids")
	if rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := h.ensureMediaBelongsToWorkspace(ctx, input.WorkspaceID, mediaIDs); rpcErr != nil {
		return nil, rpcErr
	}
	now := time.Now().UTC()
	post := &models.Post{
		ID:          newUUID(),
		WorkspaceID: input.WorkspaceID,
		CreatedByID: userID,
		Content:     input.Content,
		Status:      statusDraft,
		CreatedAt:   now,
	}
	destinations := make([]models.PostDestination, 0, len(input.SocialAccountIDs))
	for _, accountID := range input.SocialAccountIDs {
		destinations = append(destinations, models.PostDestination{
			ID:              newUUID(),
			PostID:          post.ID,
			SocialAccountID: accountID,
			Status:          postStatusPending,
		})
	}

	err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(post).Exec(txCtx); err != nil {
			return err
		}
		if len(destinations) > 0 {
			if _, err := tx.NewInsert().Model(&destinations).Exec(txCtx); err != nil {
				return err
			}
		}
		return insertMCPPostMedia(txCtx, tx, post.ID, mediaIDs)
	})
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to create draft"}
	}

	postStatus, rpcErr := h.loadMCPPostStatus(ctx, post.ID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	return mcpPostToolResult("Draft created: "+post.ID, postStatus), nil
}

type mcpListDraftsInput struct {
	WorkspaceID string `json:"workspace_id"`
	Limit       int    `json:"limit"`
}

func (h *MCPHandler) listDrafts(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input mcpListDraftsInput
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid list_drafts arguments"}
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

	var rows []models.Post
	err := h.db.NewSelect().
		Model(&rows).
		Column("id").
		Where("workspace_id = ?", input.WorkspaceID).
		Where("status = ?", statusDraft).
		Order("created_at DESC").
		Limit(limit).
		Scan(ctx)
	if err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to list drafts"}
	}

	posts := make([]mcpPostStatus, 0, len(rows))
	for _, row := range rows {
		postStatus, rpcErr := h.loadMCPPostStatus(ctx, row.ID)
		if rpcErr != nil {
			return nil, rpcErr
		}
		posts = append(posts, postStatus)
	}
	text := fmt.Sprintf("Found %d drafts.", len(posts))
	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: text,
		}},
		"structuredContent": map[string]any{
			"posts": posts,
		},
	}, nil
}

type mcpUpdateDraftInput struct {
	WorkspaceID      string    `json:"workspace_id"`
	PostID           string    `json:"post_id"`
	Content          *string   `json:"content"`
	SocialAccountIDs *[]string `json:"social_account_ids"`
	MediaIDs         *[]string `json:"media_ids"`
}

func (h *MCPHandler) updateDraft(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	input, post, accountIDs, mediaIDs, rpcErr := h.validateUpdateDraftInput(ctx, userID, args)
	if rpcErr != nil {
		return nil, rpcErr
	}

	err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if input.Content != nil {
			post.Content = *input.Content
			if _, err := tx.NewUpdate().
				Model(post).
				Column("content").
				Where("id = ?", post.ID).
				Exec(txCtx); err != nil {
				return err
			}
		}
		if input.SocialAccountIDs != nil {
			if err := replaceMCPPostDestinations(txCtx, tx, post.ID, accountIDs); err != nil {
				return err
			}
			if err := pruneMCPPostVariants(txCtx, tx, post.ID, accountIDs); err != nil {
				return err
			}
		}
		if input.MediaIDs != nil {
			if err := replaceMCPPostMedia(txCtx, tx, post.ID, mediaIDs); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to update draft"}
	}

	postStatus, rpcErr := h.loadMCPPostStatus(ctx, post.ID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	return mcpPostToolResult("Draft updated: "+post.ID, postStatus), nil
}

func (h *MCPHandler) validateUpdateDraftInput(ctx context.Context, userID string, args map[string]any) (mcpUpdateDraftInput, *models.Post, []string, []string, *mcpError) {
	var input mcpUpdateDraftInput
	if err := decodeMCPArguments(args, &input); err != nil {
		return input, nil, nil, nil, &mcpError{Code: -32602, Message: "invalid update_draft arguments"}
	}
	post, rpcErr := h.accessibleMCPDraft(ctx, userID, input.WorkspaceID, input.PostID, "update_draft can only edit draft posts")
	if rpcErr != nil {
		return input, nil, nil, nil, rpcErr
	}
	if input.Content == nil && input.SocialAccountIDs == nil && input.MediaIDs == nil {
		return input, nil, nil, nil, &mcpError{Code: -32602, Message: "content, social_account_ids, or media_ids is required"}
	}
	if input.Content != nil && strings.TrimSpace(*input.Content) == "" {
		return input, nil, nil, nil, &mcpError{Code: -32602, Message: "content is required"}
	}
	accountIDs, rpcErr := h.normalizeMCPOptionalDestinationAccounts(ctx, input.WorkspaceID, input.SocialAccountIDs)
	if rpcErr != nil {
		return input, nil, nil, nil, rpcErr
	}
	mediaIDs, rpcErr := h.normalizeMCPOptionalMediaIDs(ctx, input.WorkspaceID, input.MediaIDs)
	if rpcErr != nil {
		return input, nil, nil, nil, rpcErr
	}
	return input, post, accountIDs, mediaIDs, nil
}

type mcpPostRenditionInput struct {
	WorkspaceID string                    `json:"workspace_id"`
	PostID      string                    `json:"post_id"`
	Renditions  []mcpPostRenditionRequest `json:"renditions"`
}

type mcpPostRenditionRequest struct {
	SocialAccountID string   `json:"social_account_id"`
	Content         string   `json:"content"`
	MediaIDs        []string `json:"media_ids"`
}

type mcpPostRendition struct {
	ID              string   `json:"id"`
	PostID          string   `json:"post_id"`
	SocialAccountID string   `json:"social_account_id"`
	Platform        string   `json:"platform"`
	Slug            string   `json:"slug"`
	Content         string   `json:"content"`
	MediaIDs        []string `json:"media_ids"`
	IsUnsynced      bool     `json:"is_unsynced"`
	CreatedAt       string   `json:"created_at"`
	UpdatedAt       string   `json:"updated_at"`
}

func (h *MCPHandler) setPostRenditions(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	input, post, rpcErr := h.validateSetPostRenditionsInput(ctx, userID, args)
	if rpcErr != nil {
		return nil, rpcErr
	}

	err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		for _, rendition := range input.Renditions {
			if err := upsertMCPPostRendition(txCtx, tx, post.ID, rendition); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to update post renditions"}
	}

	renditions, rpcErr := h.loadMCPPostRenditions(ctx, post.ID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: fmt.Sprintf("Updated %d post renditions.", len(input.Renditions)),
		}},
		"structuredContent": map[string]any{
			"post_id":    post.ID,
			"renditions": renditions,
		},
	}, nil
}

func (h *MCPHandler) validateSetPostRenditionsInput(ctx context.Context, userID string, args map[string]any) (mcpPostRenditionInput, *models.Post, *mcpError) {
	var input mcpPostRenditionInput
	if err := decodeMCPArguments(args, &input); err != nil {
		return input, nil, &mcpError{Code: -32602, Message: "invalid set_post_renditions arguments"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return input, nil, rpcErr
	}
	if strings.TrimSpace(input.PostID) == "" {
		return input, nil, &mcpError{Code: -32602, Message: "post_id is required"}
	}
	if len(input.Renditions) == 0 {
		return input, nil, &mcpError{Code: -32602, Message: "renditions must contain at least one item"}
	}

	post, rpcErr := h.accessibleMCPPost(ctx, userID, map[string]any{
		"workspace_id": input.WorkspaceID,
		"post_id":      input.PostID,
	})
	if rpcErr != nil {
		return input, nil, rpcErr
	}
	if post.Status == models.PostStatusPublished || post.Status == models.PostStatusPublishing {
		return input, nil, &mcpError{Code: -32602, Message: "cannot update renditions for a post that is published or being published"}
	}

	accountIDs, mediaIDs, rpcErr := validateMCPRenditionRequests(input.Renditions)
	if rpcErr != nil {
		return input, nil, rpcErr
	}
	if rpcErr := h.ensureActiveAccounts(ctx, input.WorkspaceID, accountIDs); rpcErr != nil {
		return input, nil, rpcErr
	}
	if rpcErr := h.ensurePostDestinationAccounts(ctx, post.ID, accountIDs); rpcErr != nil {
		return input, nil, rpcErr
	}
	if rpcErr := h.ensureMediaBelongsToWorkspace(ctx, input.WorkspaceID, mediaIDs); rpcErr != nil {
		return input, nil, rpcErr
	}
	return input, post, nil
}

func validateMCPRenditionRequests(renditions []mcpPostRenditionRequest) ([]string, []string, *mcpError) {
	accountIDs := make([]string, 0, len(renditions))
	mediaIDs := make([]string, 0)
	seenAccounts := make(map[string]struct{}, len(renditions))
	for _, rendition := range renditions {
		accountID := strings.TrimSpace(rendition.SocialAccountID)
		if accountID == "" {
			return nil, nil, &mcpError{Code: -32602, Message: "renditions.social_account_id is required"}
		}
		if _, ok := seenAccounts[accountID]; ok {
			return nil, nil, &mcpError{Code: -32602, Message: "renditions cannot contain duplicate social_account_id values"}
		}
		seenAccounts[accountID] = struct{}{}
		if strings.TrimSpace(rendition.Content) == "" {
			return nil, nil, &mcpError{Code: -32602, Message: "renditions.content is required"}
		}
		accountIDs = append(accountIDs, accountID)
		normalizedMediaIDs, rpcErr := normalizeMCPIDs(rendition.MediaIDs, "renditions.media_ids")
		if rpcErr != nil {
			return nil, nil, rpcErr
		}
		mediaIDs = append(mediaIDs, normalizedMediaIDs...)
	}
	mediaIDs, rpcErr := normalizeMCPIDs(mediaIDs, "renditions.media_ids")
	if rpcErr != nil {
		return nil, nil, rpcErr
	}
	return accountIDs, mediaIDs, nil
}

func upsertMCPPostRendition(ctx context.Context, tx bun.Tx, postID string, rendition mcpPostRenditionRequest) error {
	normalizedMediaIDs, rpcErr := normalizeMCPIDs(rendition.MediaIDs, "renditions.media_ids")
	if rpcErr != nil {
		return fmt.Errorf("%s", rpcErr.Message)
	}
	mediaIDs, err := json.Marshal(normalizedMediaIDs)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	var existing models.PostVariant
	err = tx.NewSelect().
		Model(&existing).
		Where("post_id = ? AND social_account_id = ?", postID, strings.TrimSpace(rendition.SocialAccountID)).
		Scan(ctx)
	if err == nil {
		existing.Content = rendition.Content
		existing.MediaIDs = string(mediaIDs)
		existing.IsUnsynced = true
		existing.UpdatedAt = now
		_, err = tx.NewUpdate().
			Model(&existing).
			Column("content", "media_ids", "is_unsynced", "updated_at").
			Where("id = ?", existing.ID).
			Exec(ctx)
		return err
	}
	if err != sql.ErrNoRows {
		return err
	}
	variant := models.PostVariant{
		ID:              newUUID(),
		PostID:          postID,
		SocialAccountID: strings.TrimSpace(rendition.SocialAccountID),
		Content:         rendition.Content,
		MediaIDs:        string(mediaIDs),
		IsUnsynced:      true,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	_, err = tx.NewInsert().Model(&variant).Exec(ctx)
	return err
}

func (h *MCPHandler) loadMCPPostRenditions(ctx context.Context, postID string) ([]mcpPostRendition, *mcpError) {
	var rows []struct {
		models.PostVariant `bun:",extend"`
		Platform           string `bun:"platform"`
		Slug               string `bun:"slug"`
	}
	err := h.db.NewSelect().
		Model(&rows).
		ColumnExpr("post_variant.*").
		ColumnExpr("sa.platform").
		ColumnExpr("sa.slug").
		Join("JOIN social_accounts AS sa ON sa.id = post_variant.social_account_id").
		Where("post_variant.post_id = ?", postID).
		OrderExpr("sa.platform ASC, sa.slug ASC").
		Scan(ctx)
	if err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to load post renditions"}
	}
	renditions := make([]mcpPostRendition, 0, len(rows))
	for _, row := range rows {
		renditions = append(renditions, mcpPostRendition{
			ID:              row.ID,
			PostID:          row.PostID,
			SocialAccountID: row.SocialAccountID,
			Platform:        row.Platform,
			Slug:            row.Slug,
			Content:         row.Content,
			MediaIDs:        decodeVariantMediaIDs(row.MediaIDs),
			IsUnsynced:      row.IsUnsynced,
			CreatedAt:       row.CreatedAt.Format(time.RFC3339),
			UpdatedAt:       row.UpdatedAt.Format(time.RFC3339),
		})
	}
	return renditions, nil
}

func decodeVariantMediaIDs(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{}
	}
	var mediaIDs []string
	if err := json.Unmarshal([]byte(raw), &mediaIDs); err != nil {
		return []string{}
	}
	return mediaIDs
}

type mcpPostDestination struct {
	SocialAccountID string `json:"social_account_id"`
	Platform        string `json:"platform"`
	Slug            string `json:"slug"`
	Status          string `json:"status"`
	ErrorMessage    string `json:"error_message,omitempty"`
}

type mcpPostMedia struct {
	MediaID          string `json:"media_id"`
	DisplayOrder     int    `json:"display_order"`
	URL              string `json:"url"`
	ThumbnailURL     string `json:"thumbnail_url"`
	MimeType         string `json:"mime_type"`
	OriginalFilename string `json:"original_filename"`
	AltText          string `json:"alt_text,omitempty"`
	Width            int    `json:"width,omitempty"`
	Height           int    `json:"height,omitempty"`
}

type mcpPostStatus struct {
	ID                 string               `json:"id"`
	WorkspaceID        string               `json:"workspace_id"`
	Content            string               `json:"content"`
	Status             string               `json:"status"`
	ScheduledAt        string               `json:"scheduled_at,omitempty"`
	ActualRunAt        string               `json:"actual_run_at,omitempty"`
	RandomDelayMinutes int                  `json:"random_delay_minutes"`
	CreatedAt          string               `json:"created_at"`
	MediaIDs           []string             `json:"media_ids"`
	Media              []mcpPostMedia       `json:"media"`
	Destinations       []mcpPostDestination `json:"destinations"`
}

type mcpSchedulePostInput struct {
	WorkspaceID      string   `json:"workspace_id"`
	Content          string   `json:"content"`
	ScheduledAt      string   `json:"scheduled_at"`
	SocialAccountIDs []string `json:"social_account_ids"`
	MediaIDs         []string `json:"media_ids"`
}

func (h *MCPHandler) validateSchedulePostInput(ctx context.Context, userID string, args map[string]any) (mcpSchedulePostInput, []string, []string, time.Time, *mcpError) {
	var input mcpSchedulePostInput
	if err := decodeMCPArguments(args, &input); err != nil {
		return input, nil, nil, time.Time{}, &mcpError{Code: -32602, Message: "invalid schedule_post arguments"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return input, nil, nil, time.Time{}, rpcErr
	}
	if strings.TrimSpace(input.Content) == "" {
		return input, nil, nil, time.Time{}, &mcpError{Code: -32602, Message: "content is required"}
	}
	accountIDs, rpcErr := normalizeMCPIDs(input.SocialAccountIDs, "social_account_ids")
	if rpcErr != nil {
		return input, nil, nil, time.Time{}, rpcErr
	}
	if len(accountIDs) == 0 {
		return input, nil, nil, time.Time{}, &mcpError{Code: -32602, Message: "social_account_ids must contain at least one account"}
	}
	if rpcErr := h.ensureActiveAccounts(ctx, input.WorkspaceID, accountIDs); rpcErr != nil {
		return input, nil, nil, time.Time{}, rpcErr
	}
	mediaIDs, rpcErr := normalizeMCPIDs(input.MediaIDs, "media_ids")
	if rpcErr != nil {
		return input, nil, nil, time.Time{}, rpcErr
	}
	if rpcErr := h.ensureMediaBelongsToWorkspace(ctx, input.WorkspaceID, mediaIDs); rpcErr != nil {
		return input, nil, nil, time.Time{}, rpcErr
	}
	scheduledAt, err := time.Parse(time.RFC3339, input.ScheduledAt)
	if err != nil {
		return input, nil, nil, time.Time{}, &mcpError{Code: -32602, Message: "scheduled_at must be an RFC3339 timestamp"}
	}
	if scheduledAt.IsZero() {
		return input, nil, nil, time.Time{}, &mcpError{Code: -32602, Message: "scheduled_at is required"}
	}
	if rpcErr := validateMCPScheduledProviderMedia(ctx, h.db, input.WorkspaceID, accountIDs, mediaIDs); rpcErr != nil {
		return input, nil, nil, time.Time{}, rpcErr
	}
	if rpcErr := h.checkScheduledPostQuota(ctx, input.WorkspaceID, 1, scheduledAt); rpcErr != nil {
		return input, nil, nil, time.Time{}, rpcErr
	}
	return input, accountIDs, mediaIDs, scheduledAt, nil
}

func (h *MCPHandler) schedulePost(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	input, accountIDs, mediaIDs, scheduledAt, rpcErr := h.validateSchedulePostInput(ctx, userID, args)
	if rpcErr != nil {
		return nil, rpcErr
	}

	now := time.Now().UTC()
	post := &models.Post{
		ID:          newUUID(),
		WorkspaceID: input.WorkspaceID,
		CreatedByID: userID,
		Content:     input.Content,
		Status:      statusScheduled,
		ScheduledAt: scheduledAt,
		ActualRunAt: scheduledAt,
		CreatedAt:   now,
	}
	destinations := make([]models.PostDestination, 0, len(accountIDs))
	for _, accountID := range accountIDs {
		destinations = append(destinations, models.PostDestination{
			ID:              newUUID(),
			PostID:          post.ID,
			SocialAccountID: accountID,
			Status:          postStatusPending,
		})
	}
	payload, err := json.Marshal(map[string]string{postIDKey: post.ID})
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to create publish job payload"}
	}
	job := &models.Job{
		ID:      newUUID(),
		Type:    jobTypePublishPost,
		Payload: string(payload),
		Status:  "pending",
		RunAt:   scheduledAt,
	}

	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(post).Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewInsert().Model(&destinations).Exec(txCtx); err != nil {
			return err
		}
		if err := insertMCPPostMedia(txCtx, tx, post.ID, mediaIDs); err != nil {
			return err
		}
		if _, err := tx.NewInsert().Model(job).Exec(txCtx); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to schedule post"}
	}
	if rpcErr := h.recordScheduledPostUsage(ctx, input.WorkspaceID, 1, scheduledAt); rpcErr != nil {
		return nil, rpcErr
	}

	postStatus, rpcErr := h.loadMCPPostStatus(ctx, post.ID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	return mcpPostToolResult("Post scheduled: "+post.ID, postStatus), nil
}

type mcpScheduleDraftInput struct {
	WorkspaceID        string    `json:"workspace_id"`
	PostID             string    `json:"post_id"`
	ScheduledAt        string    `json:"scheduled_at"`
	SocialAccountIDs   *[]string `json:"social_account_ids"`
	MediaIDs           *[]string `json:"media_ids"`
	RandomDelayMinutes *int      `json:"random_delay_minutes"`
}

func (h *MCPHandler) scheduleDraft(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	input, post, accountIDs, mediaIDs, scheduledAt, jobRunAt, rpcErr := h.validateScheduleDraftInput(ctx, userID, args)
	if rpcErr != nil {
		return nil, rpcErr
	}

	payload, err := json.Marshal(map[string]string{postIDKey: post.ID})
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to create publish job payload"}
	}
	job := &models.Job{
		ID:      newUUID(),
		Type:    jobTypePublishPost,
		Payload: string(payload),
		Status:  "pending",
		RunAt:   jobRunAt,
	}

	post.Status = statusScheduled
	post.ScheduledAt = scheduledAt
	post.ActualRunAt = jobRunAt
	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewUpdate().
			Model(post).
			Column("status", "scheduled_at", "actual_run_at", "random_delay_minutes").
			Where("id = ?", post.ID).
			Exec(txCtx); err != nil {
			return err
		}
		if input.SocialAccountIDs != nil {
			if err := replaceMCPPostDestinations(txCtx, tx, post.ID, accountIDs); err != nil {
				return err
			}
			if err := pruneMCPPostVariants(txCtx, tx, post.ID, accountIDs); err != nil {
				return err
			}
		}
		if input.MediaIDs != nil {
			if err := replaceMCPPostMedia(txCtx, tx, post.ID, mediaIDs); err != nil {
				return err
			}
		}
		if _, err := tx.NewDelete().
			Model(&models.Job{}).
			Where(publishPostJobPostIDWhere(h.db), jobTypePublishPost, post.ID).
			Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewInsert().Model(job).Exec(txCtx); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to schedule draft"}
	}
	if rpcErr := h.recordScheduledPostUsage(ctx, input.WorkspaceID, 1, scheduledAt); rpcErr != nil {
		return nil, rpcErr
	}

	postStatus, rpcErr := h.loadMCPPostStatus(ctx, post.ID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	return mcpPostToolResult("Draft scheduled: "+post.ID, postStatus), nil
}

func (h *MCPHandler) validateScheduleDraftInput(ctx context.Context, userID string, args map[string]any) (mcpScheduleDraftInput, *models.Post, []string, []string, time.Time, time.Time, *mcpError) {
	input, scheduledAt, rpcErr := decodeMCPScheduleDraftArguments(args)
	if rpcErr != nil {
		return input, nil, nil, nil, time.Time{}, time.Time{}, rpcErr
	}
	post, rpcErr := h.accessibleMCPDraft(ctx, userID, input.WorkspaceID, input.PostID, "schedule_draft can only schedule draft posts")
	if rpcErr != nil {
		return input, nil, nil, nil, time.Time{}, time.Time{}, rpcErr
	}
	randomDelayMinutes, rpcErr := resolveMCPScheduleDraftRandomDelay(post.RandomDelayMinutes, input.RandomDelayMinutes)
	if rpcErr != nil {
		return input, nil, nil, nil, time.Time{}, time.Time{}, rpcErr
	}
	accountIDs, rpcErr := h.resolveScheduleDraftAccountIDs(ctx, input, post.ID)
	if rpcErr != nil {
		return input, nil, nil, nil, time.Time{}, time.Time{}, rpcErr
	}
	mediaIDs, rpcErr := h.normalizeMCPOptionalMediaIDs(ctx, input.WorkspaceID, input.MediaIDs)
	if rpcErr != nil {
		return input, nil, nil, nil, time.Time{}, time.Time{}, rpcErr
	}
	validationMediaIDs := mediaIDs
	if input.MediaIDs == nil {
		var err error
		validationMediaIDs, err = postservice.NewService(h.db).MediaIDs(ctx, post.ID)
		if err != nil {
			return input, nil, nil, nil, time.Time{}, time.Time{}, &mcpError{Code: -32603, Message: err.Error()}
		}
	}
	if rpcErr := validateMCPScheduledProviderMedia(ctx, h.db, input.WorkspaceID, accountIDs, validationMediaIDs); rpcErr != nil {
		return input, nil, nil, nil, time.Time{}, time.Time{}, rpcErr
	}
	if rpcErr := h.checkScheduledPostQuota(ctx, input.WorkspaceID, 1, scheduledAt); rpcErr != nil {
		return input, nil, nil, nil, time.Time{}, time.Time{}, rpcErr
	}
	post.RandomDelayMinutes = randomDelayMinutes
	return input, post, accountIDs, mediaIDs, scheduledAt, postservice.ApplyRandomDelay(scheduledAt, randomDelayMinutes), nil
}

func validateMCPScheduledProviderMedia(ctx context.Context, db *bun.DB, workspaceID string, accountIDs []string, mediaIDs []string) *mcpError {
	if err := postservice.NewService(db).ValidateScheduledProviderMedia(ctx, workspaceID, accountIDs, mediaIDs); err != nil {
		return &mcpError{Code: -32602, Message: err.Error()}
	}
	return nil
}

func decodeMCPScheduleDraftArguments(args map[string]any) (mcpScheduleDraftInput, time.Time, *mcpError) {
	var input mcpScheduleDraftInput
	if err := decodeMCPArguments(args, &input); err != nil {
		return input, time.Time{}, &mcpError{Code: -32602, Message: "invalid schedule_draft arguments"}
	}
	scheduledAt, err := time.Parse(time.RFC3339, input.ScheduledAt)
	if err != nil {
		return input, time.Time{}, &mcpError{Code: -32602, Message: "scheduled_at must be an RFC3339 timestamp"}
	}
	if scheduledAt.IsZero() {
		return input, time.Time{}, &mcpError{Code: -32602, Message: "scheduled_at is required"}
	}
	return input, scheduledAt, nil
}

func resolveMCPScheduleDraftRandomDelay(current int, requested *int) (int, *mcpError) {
	if requested == nil {
		return current, nil
	}
	if *requested < 0 {
		return 0, &mcpError{Code: -32602, Message: "random_delay_minutes must be greater than or equal to 0"}
	}
	return *requested, nil
}

func (h *MCPHandler) resolveScheduleDraftAccountIDs(ctx context.Context, input mcpScheduleDraftInput, postID string) ([]string, *mcpError) {
	accountIDs, rpcErr := h.normalizeMCPOptionalDestinationAccounts(ctx, input.WorkspaceID, input.SocialAccountIDs)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if input.SocialAccountIDs == nil {
		accountIDs, rpcErr = h.loadMCPPostDestinationAccountIDs(ctx, postID)
		if rpcErr != nil {
			return nil, rpcErr
		}
	}
	if len(accountIDs) == 0 {
		return nil, &mcpError{Code: -32602, Message: "draft must have at least one destination account before scheduling"}
	}
	if rpcErr := h.ensureActiveAccounts(ctx, input.WorkspaceID, accountIDs); rpcErr != nil {
		return nil, rpcErr
	}
	return accountIDs, nil
}

func (h *MCPHandler) getPostStatus(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	post, rpcErr := h.accessibleMCPPost(ctx, userID, args)
	if rpcErr != nil {
		return nil, rpcErr
	}
	postStatus, rpcErr := h.loadMCPPostStatus(ctx, post.ID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	return mcpPostToolResult("Post status: "+post.Status, postStatus), nil
}

type mcpListScheduledPostsInput struct {
	WorkspaceID string `json:"workspace_id"`
	From        string `json:"from"`
	To          string `json:"to"`
	Limit       int    `json:"limit"`
}

func (h *MCPHandler) listScheduledPosts(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input mcpListScheduledPostsInput
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid list_scheduled_posts arguments"}
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

	var rows []models.Post
	query := h.db.NewSelect().
		Model(&rows).
		Column("id").
		Where("workspace_id = ?", input.WorkspaceID).
		Where("status = ?", statusScheduled).
		Order("scheduled_at ASC").
		Limit(limit)
	if strings.TrimSpace(input.From) != "" {
		from, err := time.Parse(time.RFC3339, input.From)
		if err != nil {
			return nil, &mcpError{Code: -32602, Message: "from must be an RFC3339 timestamp"}
		}
		query = query.Where("scheduled_at >= ?", from)
	}
	if strings.TrimSpace(input.To) != "" {
		to, err := time.Parse(time.RFC3339, input.To)
		if err != nil {
			return nil, &mcpError{Code: -32602, Message: "to must be an RFC3339 timestamp"}
		}
		query = query.Where("scheduled_at < ?", to)
	}

	if err := query.Scan(ctx); err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to list scheduled posts"}
	}

	posts := make([]mcpPostStatus, 0, len(rows))
	for _, row := range rows {
		postStatus, rpcErr := h.loadMCPPostStatus(ctx, row.ID)
		if rpcErr != nil {
			return nil, rpcErr
		}
		posts = append(posts, postStatus)
	}
	text := fmt.Sprintf("Found %d scheduled posts.", len(posts))
	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: text,
		}},
		"structuredContent": map[string]any{
			"posts": posts,
		},
	}, nil
}

func (h *MCPHandler) cancelPost(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	post, rpcErr := h.accessibleMCPPost(ctx, userID, args)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if post.Status == models.PostStatusPublished || post.Status == models.PostStatusPublishing {
		return nil, &mcpError{Code: -32602, Message: "cannot cancel a post that is published or being published"}
	}

	post.Status = statusDraft
	post.ScheduledAt = time.Time{}
	post.ActualRunAt = time.Time{}
	post.RandomDelayMinutes = 0
	err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewUpdate().
			Model(post).
			Column("status", "scheduled_at", "actual_run_at", "random_delay_minutes").
			Where("id = ?", post.ID).
			Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewDelete().
			Model(&models.Job{}).
			Where(publishPostJobPostIDWhere(h.db), jobTypePublishPost, post.ID).
			Exec(txCtx); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to cancel post"}
	}

	postStatus, rpcErr := h.loadMCPPostStatus(ctx, post.ID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	return mcpPostToolResult("Post canceled and returned to drafts: "+post.ID, postStatus), nil
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

	var scheduledPosts []models.Post
	postQuery := h.db.NewSelect().
		Model(&scheduledPosts).
		Where("workspace_id = ?", input.WorkspaceID).
		Where("status = ?", statusScheduled).
		Where("scheduled_at >= ?", now.UTC().Add(-24*time.Hour)).
		Order("scheduled_at ASC")
	if err := postQuery.Scan(ctx); err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to load scheduled posts"}
	}

	nextSlot, nextSlotTime := findNextConfiguredScheduleSlotTime(now, loc, schedules, scheduledPosts)
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
	handler := &ProviderReadinessHandler{db: h.db, providers: h.providers}
	apps, err := handler.loadProviderApps(ctx)
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to load provider app configuration"}
	}
	accounts, err := handler.loadReadinessAccounts(ctx, input.WorkspaceID)
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to load connected accounts"}
	}
	mediaHealth, err := handler.publicMediaHealth(ctx, input.WorkspaceID)
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to load public media health"}
	}
	providers := make([]ProviderReadinessItem, 0, len(readinessProviders()))
	for _, provider := range readinessProviders() {
		providers = append(providers, buildProviderReadiness(provider, apps[provider], accounts[provider], mediaHealth))
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
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
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

func (h *MCPHandler) accessibleMCPPost(ctx context.Context, userID string, args map[string]any) (*models.Post, *mcpError) {
	var input struct {
		WorkspaceID string `json:"workspace_id"`
		PostID      string `json:"post_id"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid post arguments"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	if strings.TrimSpace(input.PostID) == "" {
		return nil, &mcpError{Code: -32602, Message: "post_id is required"}
	}
	post := new(models.Post)
	err := h.db.NewSelect().
		Model(post).
		Where("id = ? AND workspace_id = ?", input.PostID, input.WorkspaceID).
		Scan(ctx)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, &mcpError{Code: -32602, Message: "post not found in workspace"}
		}
		return nil, &mcpError{Code: -32603, Message: "failed to load post"}
	}
	return post, nil
}

func (h *MCPHandler) accessibleMCPDraft(ctx context.Context, userID, workspaceID, postID, wrongStatusMessage string) (*models.Post, *mcpError) {
	post, rpcErr := h.accessibleMCPPost(ctx, userID, map[string]any{
		"workspace_id": workspaceID,
		"post_id":      postID,
	})
	if rpcErr != nil {
		return nil, rpcErr
	}
	if post.Status != statusDraft {
		return nil, &mcpError{Code: -32602, Message: wrongStatusMessage}
	}
	return post, nil
}

func (h *MCPHandler) normalizeMCPOptionalDestinationAccounts(ctx context.Context, workspaceID string, accountIDs *[]string) ([]string, *mcpError) {
	if accountIDs == nil {
		return nil, nil
	}
	normalized, rpcErr := normalizeMCPIDs(*accountIDs, "social_account_ids")
	if rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := h.ensureActiveAccounts(ctx, workspaceID, normalized); rpcErr != nil {
		return nil, rpcErr
	}
	return normalized, nil
}

func (h *MCPHandler) normalizeMCPOptionalMediaIDs(ctx context.Context, workspaceID string, mediaIDs *[]string) ([]string, *mcpError) {
	if mediaIDs == nil {
		return nil, nil
	}
	normalized, rpcErr := normalizeMCPIDs(*mediaIDs, "media_ids")
	if rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := h.ensureMediaBelongsToWorkspace(ctx, workspaceID, normalized); rpcErr != nil {
		return nil, rpcErr
	}
	return normalized, nil
}

func (h *MCPHandler) loadMCPPostStatus(ctx context.Context, postID string) (mcpPostStatus, *mcpError) {
	var post models.Post
	if err := h.db.NewSelect().Model(&post).Where("id = ?", postID).Scan(ctx); err != nil {
		return mcpPostStatus{}, &mcpError{Code: -32603, Message: "failed to load post"}
	}

	var rows []struct {
		models.PostDestination `bun:",extend"`
		Platform               string `bun:"platform"`
		Slug                   string `bun:"slug"`
	}
	err := h.db.NewSelect().
		Model(&rows).
		ColumnExpr("post_destination.*").
		ColumnExpr("sa.platform").
		ColumnExpr("sa.slug").
		Join("JOIN social_accounts AS sa ON sa.id = post_destination.social_account_id").
		Where("post_destination.post_id = ?", post.ID).
		OrderExpr("sa.platform ASC, sa.slug ASC").
		Scan(ctx)
	if err != nil && err != sql.ErrNoRows {
		return mcpPostStatus{}, &mcpError{Code: -32603, Message: "failed to load post destinations"}
	}

	destinations := make([]mcpPostDestination, 0, len(rows))
	for _, row := range rows {
		destinations = append(destinations, mcpPostDestination{
			SocialAccountID: row.SocialAccountID,
			Platform:        row.Platform,
			Slug:            row.Slug,
			Status:          row.Status,
			ErrorMessage:    row.ErrorMessage,
		})
	}

	media, rpcErr := h.loadMCPPostMedia(ctx, post.ID)
	if rpcErr != nil {
		return mcpPostStatus{}, rpcErr
	}
	mediaIDs := make([]string, 0, len(media))
	for _, item := range media {
		mediaIDs = append(mediaIDs, item.MediaID)
	}

	status := mcpPostStatus{
		ID:                 post.ID,
		WorkspaceID:        post.WorkspaceID,
		Content:            post.Content,
		Status:             post.Status,
		RandomDelayMinutes: post.RandomDelayMinutes,
		CreatedAt:          post.CreatedAt.Format(time.RFC3339),
		MediaIDs:           mediaIDs,
		Media:              media,
		Destinations:       destinations,
	}
	if !post.ScheduledAt.IsZero() {
		status.ScheduledAt = post.ScheduledAt.Format(time.RFC3339)
	}
	if !post.ActualRunAt.IsZero() {
		status.ActualRunAt = post.ActualRunAt.Format(time.RFC3339)
	}
	return status, nil
}

func (h *MCPHandler) loadMCPPostMedia(ctx context.Context, postID string) ([]mcpPostMedia, *mcpError) {
	var rows []struct {
		MediaID          string `bun:"media_id"`
		DisplayOrder     int    `bun:"display_order"`
		MimeType         string `bun:"mime_type"`
		OriginalFilename string `bun:"original_filename"`
		AltText          string `bun:"alt_text"`
		Width            int    `bun:"width"`
		Height           int    `bun:"height"`
		ThumbnailsJSON   string `bun:"thumbnails"`
	}
	err := h.db.NewSelect().
		TableExpr("post_media AS pm").
		ColumnExpr("pm.media_id, pm.display_order, ma.mime_type, ma.original_filename, ma.alt_text, ma.width, ma.height, ma.thumbnails").
		Join("JOIN media_attachments AS ma ON ma.id = pm.media_id").
		Where("pm.post_id = ?", postID).
		Order("pm.display_order ASC").
		Scan(ctx, &rows)
	if err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to load post media"}
	}
	media := make([]mcpPostMedia, 0, len(rows))
	for _, row := range rows {
		thumbnailURL := "/media/" + row.MediaID + "/thumb"
		if mcpHasSmallThumbnail(row.ThumbnailsJSON) {
			thumbnailURL = "/media/" + row.MediaID + "/thumb/sm"
		}
		media = append(media, mcpPostMedia{
			MediaID:          row.MediaID,
			DisplayOrder:     row.DisplayOrder,
			URL:              "/media/" + row.MediaID,
			ThumbnailURL:     thumbnailURL,
			MimeType:         row.MimeType,
			OriginalFilename: row.OriginalFilename,
			AltText:          row.AltText,
			Width:            row.Width,
			Height:           row.Height,
		})
	}
	return media, nil
}

func mcpPostToolResult(text string, post mcpPostStatus) map[string]any {
	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: text,
		}},
		"structuredContent": map[string]any{
			"post": post,
		},
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

func (h *MCPHandler) loadMCPPostDestinationAccountIDs(ctx context.Context, postID string) ([]string, *mcpError) {
	var rows []models.PostDestination
	err := h.db.NewSelect().
		Model(&rows).
		Column("social_account_id").
		Where("post_id = ?", postID).
		Order("social_account_id ASC").
		Scan(ctx)
	if err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to load post destinations"}
	}
	accountIDs := make([]string, 0, len(rows))
	for _, row := range rows {
		accountIDs = append(accountIDs, row.SocialAccountID)
	}
	return accountIDs, nil
}

func replaceMCPPostDestinations(ctx context.Context, tx bun.Tx, postID string, accountIDs []string) error {
	if _, err := tx.NewDelete().
		Model(&models.PostDestination{}).
		Where("post_id = ?", postID).
		Exec(ctx); err != nil {
		return err
	}
	if len(accountIDs) == 0 {
		return nil
	}
	destinations := make([]models.PostDestination, 0, len(accountIDs))
	for _, accountID := range accountIDs {
		destinations = append(destinations, models.PostDestination{
			ID:              newUUID(),
			PostID:          postID,
			SocialAccountID: accountID,
			Status:          postStatusPending,
		})
	}
	_, err := tx.NewInsert().Model(&destinations).Exec(ctx)
	return err
}

func insertMCPPostMedia(ctx context.Context, tx bun.Tx, postID string, mediaIDs []string) error {
	if len(mediaIDs) == 0 {
		return nil
	}
	attachments := make([]models.PostMedia, 0, len(mediaIDs))
	for i, mediaID := range mediaIDs {
		attachments = append(attachments, models.PostMedia{
			PostID:       postID,
			MediaID:      mediaID,
			DisplayOrder: i,
		})
	}
	_, err := tx.NewInsert().Model(&attachments).Exec(ctx)
	return err
}

func replaceMCPPostMedia(ctx context.Context, tx bun.Tx, postID string, mediaIDs []string) error {
	if _, err := tx.NewDelete().
		Model(&models.PostMedia{}).
		Where("post_id = ?", postID).
		Exec(ctx); err != nil {
		return err
	}
	return insertMCPPostMedia(ctx, tx, postID, mediaIDs)
}

func pruneMCPPostVariants(ctx context.Context, tx bun.Tx, postID string, accountIDs []string) error {
	query := tx.NewDelete().
		Model(&models.PostVariant{}).
		Where("post_id = ?", postID)
	if len(accountIDs) > 0 {
		query = query.Where("social_account_id NOT IN (?)", bun.List(accountIDs))
	}
	_, err := query.Exec(ctx)
	return err
}

func (h *MCPHandler) checkScheduledPostQuota(ctx context.Context, workspaceID string, amount int64, scheduledAt time.Time) *mcpError {
	current, err := h.usage.CurrentMonthly(ctx, workspaceID, entitlements.LimitScheduledPostsMonthly, scheduledAt)
	if err != nil {
		return &mcpError{Code: -32603, Message: "failed to load scheduled post usage"}
	}
	decision, err := h.entitlement.Check(ctx, entitlements.Request{
		WorkspaceID: workspaceID,
		Limit:       entitlements.LimitScheduledPostsMonthly,
		Current:     current,
		Amount:      amount,
	})
	if err != nil {
		return &mcpError{Code: -32603, Message: "failed to check scheduled post limit"}
	}
	if !decision.Allowed {
		reason := decision.Reason
		if reason == "" {
			reason = "scheduled post limit exceeded"
		}
		return &mcpError{Code: -32000, Message: reason}
	}
	return nil
}

func (h *MCPHandler) recordScheduledPostUsage(ctx context.Context, workspaceID string, amount int64, scheduledAt time.Time) *mcpError {
	if _, err := h.usage.IncrementMonthly(ctx, workspaceID, entitlements.LimitScheduledPostsMonthly, amount, scheduledAt); err != nil {
		return &mcpError{Code: -32603, Message: "failed to record scheduled post usage"}
	}
	return nil
}

func (h *MCPHandler) ensureActiveAccounts(ctx context.Context, workspaceID string, accountIDs []string) *mcpError {
	if len(accountIDs) == 0 {
		return nil
	}
	unique := make([]string, 0, len(accountIDs))
	seen := make(map[string]struct{}, len(accountIDs))
	for _, accountID := range accountIDs {
		accountID = strings.TrimSpace(accountID)
		if accountID == "" {
			return &mcpError{Code: -32602, Message: "social_account_ids cannot contain empty values"}
		}
		if _, ok := seen[accountID]; ok {
			continue
		}
		seen[accountID] = struct{}{}
		unique = append(unique, accountID)
	}
	count, err := h.db.NewSelect().
		Model((*models.SocialAccount)(nil)).
		Where("workspace_id = ?", workspaceID).
		Where("is_active = ?", true).
		Where("id IN (?)", bun.List(unique)).
		Count(ctx)
	if err != nil {
		return &mcpError{Code: -32603, Message: "failed to validate social accounts"}
	}
	if count != len(unique) {
		return &mcpError{Code: -32602, Message: "one or more social accounts are invalid, disconnected, or outside this workspace"}
	}
	return nil
}

func (h *MCPHandler) ensurePostDestinationAccounts(ctx context.Context, postID string, accountIDs []string) *mcpError {
	if len(accountIDs) == 0 {
		return nil
	}
	unique, rpcErr := normalizeMCPIDs(accountIDs, "social_account_ids")
	if rpcErr != nil {
		return rpcErr
	}
	count, err := h.db.NewSelect().
		Model((*models.PostDestination)(nil)).
		Where("post_id = ?", postID).
		Where("social_account_id IN (?)", bun.List(unique)).
		Count(ctx)
	if err != nil {
		return &mcpError{Code: -32603, Message: "failed to validate post destinations"}
	}
	if count != len(unique) {
		return &mcpError{Code: -32602, Message: "one or more renditions target accounts that are not destinations for this post"}
	}
	return nil
}

func (h *MCPHandler) ensureMediaBelongsToWorkspace(ctx context.Context, workspaceID string, mediaIDs []string) *mcpError {
	if len(mediaIDs) == 0 {
		return nil
	}
	unique, rpcErr := normalizeMCPIDs(mediaIDs, "media_ids")
	if rpcErr != nil {
		return rpcErr
	}
	count, err := h.db.NewSelect().
		Model((*models.MediaAttachment)(nil)).
		Where("workspace_id = ?", workspaceID).
		Where("id IN (?)", bun.List(unique)).
		Count(ctx)
	if err != nil {
		return &mcpError{Code: -32603, Message: "failed to validate media"}
	}
	if count != len(unique) {
		return &mcpError{Code: -32602, Message: "one or more media_ids are invalid or outside this workspace"}
	}
	return nil
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
