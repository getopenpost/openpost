package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/editoragent"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/ratelimit"
	"github.com/uptrace/bun"
)

const (
	editorAssistantLimitPerMinute = 6
	editorAssistantMaxSteps       = 12
	editorAssistantMaxHistory     = 10
)

type EditorAgentAssistantHandler struct {
	db          *bun.DB
	auth        middleware.Authenticator
	entitlement entitlements.Service
	generator   ai.Generator
	model       string
	edition     string
	limiter     *ratelimit.Limiter
}

func NewEditorAgentAssistantHandler(db *bun.DB, auth middleware.Authenticator, entitlement entitlements.Service, generator ai.Generator, model, edition string) *EditorAgentAssistantHandler {
	return &EditorAgentAssistantHandler{db: db, auth: auth, entitlement: entitlement, generator: generator, model: model, edition: edition, limiter: ratelimit.New()}
}

type editorAssistantStatusInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
}

type editorAssistantStatusOutput struct {
	Body struct {
		Available bool   `json:"available"`
		Reason    string `json:"reason,omitempty"`
	}
}

type editorAssistantMessage struct {
	Role    string `json:"role" enum:"user,assistant"`
	Content string `json:"content" maxLength:"4000"`
}

type editorAssistantInput struct {
	Body struct {
		WorkspaceID string                   `json:"workspace_id" minLength:"1"`
		SessionID   string                   `json:"session_id" minLength:"1"`
		ProjectID   string                   `json:"project_id" minLength:"1"`
		Prompt      string                   `json:"prompt" minLength:"1" maxLength:"4000"`
		History     []editorAssistantMessage `json:"history,omitempty" maxItems:"10"`
	}
}

type editorAssistantStep struct {
	Operation string          `json:"operation"`
	Result    json.RawMessage `json:"result"`
}

type editorAssistantOutput struct {
	Body struct {
		Reply            string                `json:"reply"`
		Steps            []editorAssistantStep `json:"steps"`
		PendingRequestID string                `json:"pending_request_id,omitempty"`
		Model            string                `json:"model"`
		InputTokens      int64                 `json:"input_tokens"`
		OutputTokens     int64                 `json:"output_tokens"`
	}
}

type editorAssistantDecision struct {
	Kind          string `json:"kind"`
	Operation     string `json:"operation"`
	ArgumentsJSON string `json:"arguments_json"`
	Message       string `json:"message"`
}

func (h *EditorAgentAssistantHandler) RegisterRoutes(api huma.API) {
	auth := huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}
	huma.Register(api, huma.Operation{
		OperationID: "editor-agent-assistant-status", Method: http.MethodGet, Path: "/editor-agent/assistant/status",
		Summary: "Check paid Hosted editor assistant availability", Tags: []string{"Editor Agent"},
		Middlewares: auth, Errors: []int{401, 403},
	}, h.status)
	huma.Register(api, huma.Operation{
		OperationID: "run-editor-agent-assistant", Method: http.MethodPost, Path: "/editor-agent/assistant",
		Summary: "Run a bounded paid Hosted editing assistant turn", Tags: []string{"Editor Agent"},
		Middlewares: auth, MaxBodyBytes: 32 * 1024, Errors: []int{400, 401, 403, 429, 502, 503},
	}, h.run)
}

func (h *EditorAgentAssistantHandler) available(ctx context.Context, workspaceID, userID string) (bool, string, error) {
	if h.edition != "cloud" {
		return false, "cloud_only", nil
	}
	if h.generator == nil || strings.TrimSpace(h.model) == "" {
		return false, "not_configured", nil
	}
	allowed, err := workspaceEditAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return false, "", err
	}
	if !allowed {
		return false, "no_edit_access", nil
	}
	if h.entitlement == nil {
		return false, "billing_unavailable", nil
	}
	decision, err := h.entitlement.Check(ctx, entitlements.Request{
		WorkspaceID: workspaceID, UserID: userID,
		Limit: entitlements.LimitFeatureEditorAssistant, Amount: 1,
	})
	if err != nil {
		return false, "", err
	}
	if !decision.Allowed {
		return false, "paid_plan_required", nil
	}
	return true, "", nil
}

func (h *EditorAgentAssistantHandler) status(ctx context.Context, input *editorAssistantStatusInput) (*editorAssistantStatusOutput, error) {
	userID := middleware.GetUserID(ctx)
	if middleware.GetSessionID(ctx) == "" || middleware.GetTokenID(ctx) != "" {
		return nil, huma.Error401Unauthorized("Browser session required")
	}
	available, reason, err := h.available(ctx, input.WorkspaceID, userID)
	if err != nil {
		return nil, huma.Error503ServiceUnavailable("Could not check assistant availability")
	}
	output := new(editorAssistantStatusOutput)
	output.Body.Available = available
	output.Body.Reason = reason
	return output, nil
}

func editorAssistantResponseSchema() *ai.JSONSchema {
	return &ai.JSONSchema{
		Name: "openpost_editor_assistant_step", Description: "One editor tool call or final reply",
		Schema: map[string]any{
			"type": "object", "additionalProperties": false,
			"required": []string{"kind", "operation", "arguments_json", "message"},
			"properties": map[string]any{
				"kind":           map[string]any{"type": "string", "enum": []string{"tool", "final"}},
				"operation":      map[string]any{"type": "string"},
				"arguments_json": map[string]any{"type": "string"},
				"message":        map[string]any{"type": "string"},
			},
		},
	}
}

func editorAssistantAllowedOperation(kind, operation string) bool {
	switch operation {
	case "editor_context", "editor_reveal", "preview_render", "export_start", "export_status", "export_cancel", "editor_history_inspect", "editor_history_undo", "editor_history_redo", "editor_work_status", "editor_work_cancel":
		return true
	case "timeline_inspect", "media_library", "media_analyze", "media_analysis_status", "media_analysis_cancel", "media_search", "media_inspect", "media_frame", "media_storyboard", "video_edit":
		return kind == "video"
	case "image_inspect", "image_edit":
		return kind == "image"
	default:
		return false
	}
}

func editorAssistantToolGuide(kind string) string {
	names := []string{"editor_context", "editor_reveal", "preview_render", "export_start", "export_status", "export_cancel", "editor_history_inspect", "editor_history_undo", "editor_history_redo", "editor_work_status", "editor_work_cancel"}
	if kind == "video" {
		names = append(names, "timeline_inspect", "media_library", "media_analyze", "media_analysis_status", "media_analysis_cancel", "media_search", "media_inspect", "media_frame", "media_storyboard", "video_edit")
	} else {
		names = append(names, "image_inspect", "image_edit")
	}
	definitions := make([]map[string]any, 0, len(names))
	for _, name := range names {
		operation, ok := mcpOperationByName(name)
		if !ok {
			continue
		}
		definitions = append(definitions, map[string]any{
			"name":         name,
			"description":  operation.Descriptor["description"],
			"input_schema": operation.Descriptor["inputSchema"],
		})
	}
	data, _ := json.Marshal(definitions)
	return string(data)
}

type editorAssistantPending struct {
	RequestID string
	Status    string
}

func (e editorAssistantPending) Error() string {
	return "editor request " + e.RequestID + " is " + e.Status
}

func (h *EditorAgentAssistantHandler) execute(ctx context.Context, userID, workspaceID, sessionID, projectID, operation string, argumentsJSON, requestKey string) (json.RawMessage, *ai.Image, error) {
	var args map[string]any
	if err := json.Unmarshal([]byte(argumentsJSON), &args); err != nil || args == nil {
		return nil, nil, errors.New("tool arguments must be a JSON object")
	}
	args["workspace_id"] = workspaceID
	if operation != "editor_work_status" && operation != "editor_work_cancel" {
		args["session_id"] = sessionID
	}
	if operation == "video_edit" || operation == "image_edit" || operation == "editor_reveal" || operation == "media_analyze" || operation == "media_analysis_cancel" || operation == "export_start" || operation == "export_status" || operation == "export_cancel" || operation == "editor_history_undo" || operation == "editor_history_redo" {
		args["project_id"] = projectID
		if operation != "editor_reveal" && operation != "media_analyze" && operation != "media_analysis_cancel" && operation != "export_status" && operation != "export_cancel" {
			args["request_id"] = requestKey
		}
	}
	if rpcErr := validateMCPToolArguments(operation, args); rpcErr != nil {
		return nil, nil, errors.New(rpcErr.Message)
	}
	result, rpcErr := (&MCPHandler{db: h.db}).callEditorAgentTool(ctx, userID, operation, args)
	if rpcErr != nil {
		return nil, nil, errors.New(rpcErr.Message)
	}
	wrapped, ok := result.(map[string]any)
	if !ok {
		return nil, nil, errors.New("editor tool returned an invalid result")
	}
	structured, ok := wrapped["structuredContent"].(map[string]any)
	if !ok {
		return nil, nil, errors.New("editor tool returned no structured result")
	}
	request, ok := structured["request"].(*editoragent.Request)
	if !ok {
		return nil, nil, errors.New("editor tool returned no request receipt")
	}
	if request.Status == "queued" || request.Status == "leased" || request.Status == "cancel_requested" {
		settled, err := editoragent.NewRelay(h.db).Wait(ctx, request.ID, workspaceID, userID, 18*time.Second)
		if err != nil {
			return nil, nil, err
		}
		request = settled
		wrapped = editorAgentToolResult(map[string]any{"request": request})
		structured = wrapped["structuredContent"].(map[string]any)
		request = structured["request"].(*editoragent.Request)
	}
	if request.Status == "failed" {
		return request.Error, nil, nil
	}
	if request.Status != "completed" {
		return nil, nil, editorAssistantPending{RequestID: request.ID, Status: request.Status}
	}
	var preview *ai.Image
	if content, ok := wrapped["content"].([]mcpContent); ok {
		for _, block := range content {
			if block.Type != "image" || block.MimeType != "image/jpeg" {
				continue
			}
			bytes, err := base64.StdEncoding.DecodeString(block.Data)
			if err == nil {
				preview = &ai.Image{Data: bytes, MIMEType: block.MimeType, Detail: ai.ImageDetailLow}
			}
			break
		}
	}
	return request.Result, preview, nil
}

func (h *EditorAgentAssistantHandler) run(ctx context.Context, input *editorAssistantInput) (*editorAssistantOutput, error) {
	userID := middleware.GetUserID(ctx)
	if middleware.GetSessionID(ctx) == "" || middleware.GetTokenID(ctx) != "" {
		return nil, huma.Error401Unauthorized("Browser session required")
	}
	workspaceID, sessionID, projectID := input.Body.WorkspaceID, input.Body.SessionID, input.Body.ProjectID
	available, reason, err := h.available(ctx, workspaceID, userID)
	if err != nil {
		return nil, huma.Error503ServiceUnavailable("Could not check assistant availability")
	}
	if !available {
		return nil, huma.Error403Forbidden("Hosted editor assistant unavailable: " + reason)
	}
	session, err := editoragent.NewRelay(h.db).ActiveSession(ctx, sessionID, workspaceID)
	if err != nil || session.UserID != userID || session.ProjectID != projectID {
		return nil, huma.Error400BadRequest("Open the requested project in this browser before asking the assistant")
	}
	if len(input.Body.History) > editorAssistantMaxHistory {
		return nil, huma.Error400BadRequest("Conversation history is too long")
	}
	if !h.limiter.Allow("editor-assistant:"+userID, editorAssistantLimitPerMinute, time.Minute) {
		return nil, huma.Error429TooManyRequests("Assistant limit reached; try again shortly")
	}
	conversation := []string{}
	for _, message := range input.Body.History {
		if message.Role != "user" && message.Role != "assistant" {
			return nil, huma.Error400BadRequest("Invalid conversation role")
		}
		conversation = append(conversation, message.Role+": "+message.Content)
	}
	conversation = append(conversation, "user: "+input.Body.Prompt)
	observations := []string{}
	parts := []ai.MultimodalPart{}
	steps := make([]editorAssistantStep, 0, editorAssistantMaxSteps)
	runID := uuid.NewString()
	inputTokens, outputTokens := int64(0), int64(0)
	toolGuide := editorAssistantToolGuide(session.EditorKind)
	for index := range editorAssistantMaxSteps {
		prompt := strings.Join(conversation, "\n") + "\n\nTool results so far:\n" + strings.Join(observations, "\n")
		generated, err := h.generator.Generate(ctx, ai.GenerateRequest{
			Model:        h.model,
			SystemPrompt: "You are the OpenPost editor assistant. Use only the listed operations and exact stable IDs. Inspect evidence before edits. Never infer absent content from partial coverage. The browser applies edits live and returns actual receipts. Never claim visual or export verification without a result proving it. Make a short, safe change, then inspect again. If a prior request is pending, use editor_work_status with its request ID before another edit. If a request is ambiguous or unsupported, explain that plainly. Return kind=tool with operation and arguments_json containing a JSON object, or kind=final with a concise message. Available operations: " + toolGuide,
			UserPrompt:   prompt, ResponseSchema: editorAssistantResponseSchema(), Parts: parts,
			MaxOutputTokens: 1200, ReasoningEffort: ai.ReasoningEffortLow,
		})
		if err != nil {
			log.Printf("editor assistant generation failed (%T)", err)
			return nil, huma.Error502BadGateway("Hosted editor assistant failed")
		}
		inputTokens += generated.Usage.InputTokens
		outputTokens += generated.Usage.OutputTokens
		var decision editorAssistantDecision
		if err := json.Unmarshal([]byte(generated.Text), &decision); err != nil {
			return nil, huma.Error502BadGateway("Hosted editor assistant returned an invalid step")
		}
		if decision.Kind == "final" {
			output := new(editorAssistantOutput)
			output.Body.Reply = strings.TrimSpace(decision.Message)
			output.Body.Steps = steps
			output.Body.Model = h.model
			output.Body.InputTokens = inputTokens
			output.Body.OutputTokens = outputTokens
			return output, nil
		}
		if decision.Kind != "tool" || !editorAssistantAllowedOperation(session.EditorKind, decision.Operation) {
			return nil, huma.Error502BadGateway("Hosted editor assistant requested an unsupported operation")
		}
		requestKey := fmt.Sprintf("assistant:%s:%d", runID, index)
		result, preview, err := h.execute(ctx, userID, workspaceID, sessionID, projectID, decision.Operation, decision.ArgumentsJSON, requestKey)
		if err != nil {
			var pending editorAssistantPending
			if errors.As(err, &pending) {
				output := new(editorAssistantOutput)
				output.Body.Reply = "The editor step is " + pending.Status + " (request " + pending.RequestID + "). Ask me to check it before another edit."
				output.Body.PendingRequestID = pending.RequestID
				output.Body.Steps = steps
				output.Body.Model = h.model
				output.Body.InputTokens = inputTokens
				output.Body.OutputTokens = outputTokens
				return output, nil
			}
			observations = append(observations, decision.Operation+" error: "+err.Error())
			continue
		}
		steps = append(steps, editorAssistantStep{Operation: decision.Operation, Result: result})
		if preview != nil {
			parts = append(parts, ai.MultimodalPart{SourceID: fmt.Sprintf("editor-preview-%d", index), Image: preview})
			if len(parts) > 2 {
				parts = parts[len(parts)-2:]
			}
		}
		text := string(result)
		if len(text) > 16000 {
			text = text[:16000] + "... [result truncated; inspect a smaller range]"
		}
		observations = append(observations, decision.Operation+" result: "+text)
	}
	output := new(editorAssistantOutput)
	output.Body.Reply = "I reached the step limit. The completed edits are visible in the editor. Review them before continuing."
	output.Body.Steps = steps
	output.Body.Model = h.model
	output.Body.InputTokens = inputTokens
	output.Body.OutputTokens = outputTokens
	return output, nil
}
