package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/publicationauth"
)

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
		if rpcErr == nil {
			result, rpcErr = mcpStructuredJSONText(result)
		}
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
	case mcpToolInboxList, mcpToolInboxGet, mcpToolInboxRefresh, mcpToolInboxState, mcpToolInboxRead, mcpToolInboxAction:
		return h.callInboxTool(ctx, userID, operation, args)
	case mcpToolWorkspaces, mcpToolProviders, mcpToolSearchDocs:
		return h.callReadOnlyGlobalTool(ctx, userID, operation, args)
	case mcpToolLookupMentions, mcpToolAccounts, mcpToolListMedia, mcpToolReadiness, mcpToolPostMetrics, mcpToolDashboardLink:
		return h.callReadOnlyWorkspaceTool(ctx, userID, operation, args)
	case mcpToolRenderWidget:
		return h.renderSchedulerWidget(args)
	case mcpToolRenderUpload:
		return h.renderLocalMediaUpload(ctx, userID, args)
	case mcpToolCreateTicket:
		return h.createLocalMediaUploadTicket(ctx, userID, args)
	case "editor_sessions", "editor_reference", "editor_context", "editor_reveal", "timeline_inspect", "image_inspect", "media_library", "media_analyze", "media_analysis_status", "media_analysis_cancel", "media_search", "media_inspect", "media_frame", "media_storyboard", "scene_analyze", "scene_analysis_status", "scene_analysis_cancel", "scene_search", "scene_inspect", "preview_render", "preview_audio", "video_edit", "image_edit", "export_start", "export_status", "export_cancel", "editor_work_status", "editor_work_cancel", "editor_history_inspect", "editor_history_undo", "editor_history_redo", "library_search", "library_inspect", "library_apply", "library_save", "style_capture", "style_preview", "style_list", "style_inspect", "style_save", "preferences_get", "preferences_set", "preferences_remove", "style_archive":
		return h.callEditorAgentTool(ctx, userID, operation, args)
	case mcpToolPreviewTextCard, mcpToolCreatePub, mcpToolListPubs, mcpToolGetPub, mcpToolUpdatePub, mcpToolPubRenditions, mcpToolReplyRendition,
		mcpToolValidatePub, mcpToolSchedulePub, mcpToolCancelPub, mcpToolPublishPubNow, mcpToolDeletePub,
		mcpToolRetryFailed, mcpToolRetryOne, mcpToolPubEvents, mcpToolComments,
		mcpToolReplyComment, mcpToolHideComment, mcpToolDeleteComment, mcpToolSuggestSlot, mcpToolUploadURL, mcpToolUploadBase64,
		mcpToolGetMedia, mcpToolUpdateMedia, mcpToolDeleteMedia, mcpToolPrepareImage:
		return h.callWorkspaceActionTool(ctx, userID, operation, args)
	default:
		return nil, &mcpError{Code: -32602, Message: fmt.Sprintf("unknown operation %q; call %s to discover supported operations", operation, mcpToolSearch)}
	}
}

func (h *MCPHandler) callWorkspaceActionTool(ctx context.Context, userID, toolName string, args map[string]any) (any, *mcpError) {
	toolName = normalizeMCPOperationName(toolName)
	switch toolName {
	case mcpToolPreviewTextCard, mcpToolCreatePub, mcpToolListPubs, mcpToolGetPub, mcpToolUpdatePub, mcpToolPubRenditions, mcpToolReplyRendition,
		mcpToolValidatePub, mcpToolSchedulePub, mcpToolCancelPub, mcpToolPublishPubNow, mcpToolDeletePub,
		mcpToolRetryFailed, mcpToolRetryOne, mcpToolPubEvents, mcpToolComments,
		mcpToolReplyComment, mcpToolHideComment, mcpToolDeleteComment:
		return h.callPublicationTool(ctx, userID, toolName, args)
	case mcpToolGetMedia, mcpToolUpdateMedia, mcpToolDeleteMedia, mcpToolPrepareImage:
		return h.callMediaTool(ctx, userID, toolName, args)
	case mcpToolSuggestSlot:
		return h.suggestNextSlot(ctx, userID, args)
	case mcpToolUploadURL:
		return h.uploadMediaFromURL(ctx, userID, args)
	case mcpToolUploadBase64:
		return h.uploadMediaBase64(ctx, userID, args)
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
	case mcpToolPreviewTextCard:
		return h.previewTextCard(ctx, userID, args)
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
	case mcpToolLookupMentions:
		return h.lookupMCPMentions(ctx, userID, args)
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

func newUUID() string {
	return uuid.New().String()
}
