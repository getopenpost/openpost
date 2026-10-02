package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/services/editoragent"
	"github.com/openpost/backend/internal/services/entitlements"
)

type editorAssistantTestGenerator struct{}

func (editorAssistantTestGenerator) Generate(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
	return ai.GenerateResult{}, nil
}

type editorAssistantSequenceGenerator struct {
	responses []editorAssistantDecision
	calls     int
}

func (g *editorAssistantSequenceGenerator) Generate(_ context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
	if request.Model != "test-model" || request.ResponseSchema == nil || g.calls >= len(g.responses) {
		return ai.GenerateResult{}, ai.ErrEmptyResponse
	}
	response, _ := json.Marshal(g.responses[g.calls])
	g.calls++
	return ai.GenerateResult{Text: string(response), Usage: ai.Usage{InputTokens: 10, OutputTokens: 5}}, nil
}

func TestHostedEditorAssistantRequiresCloudPaidPlanAndEditAccess(t *testing.T) {
	db := workflowHandlerDB(t)
	for _, test := range []struct {
		name        string
		edition     string
		entitlement entitlements.Service
		workspaceID string
		userID      string
		available   bool
		reason      string
	}{
		{name: "paid editor", edition: "cloud", entitlement: entitlements.NewStaticService(entitlements.PlanSnapshot{PlanID: "paid"}), workspaceID: "ws", userID: "user", available: true},
		{name: "free editor", edition: "cloud", entitlement: entitlements.NewCloudBootstrapService(), workspaceID: "ws", userID: "user", reason: "paid_plan_required"},
		{name: "other user", edition: "cloud", entitlement: entitlements.NewStaticService(entitlements.PlanSnapshot{PlanID: "paid"}), workspaceID: "ws", userID: "other", reason: "no_edit_access"},
		{name: "self hosted", edition: "selfhost", entitlement: entitlements.NewStaticService(entitlements.PlanSnapshot{PlanID: "paid"}), workspaceID: "ws", userID: "user", reason: "cloud_only"},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler := NewEditorAgentAssistantHandler(db, workflowSession{}, test.entitlement, editorAssistantTestGenerator{}, "test-model", test.edition)
			available, reason, err := handler.available(t.Context(), test.workspaceID, test.userID)
			if err != nil || available != test.available || reason != test.reason {
				t.Fatalf("availability = %v, %q, %v; want %v, %q", available, reason, err, test.available, test.reason)
			}
		})
	}
}

func TestHostedEditorAssistantStopCancelsQueuedEdit(t *testing.T) {
	db := workflowHandlerDB(t)
	relay := editoragent.NewRelay(db)
	session, err := relay.Register(t.Context(), "ws", "user", "project", "video")
	if err != nil {
		t.Fatal(err)
	}
	request, err := relay.Enqueue(t.Context(), session, "user", "stop-key", "video_edit", json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	handler := &EditorAgentAssistantHandler{db: db}
	if _, err := handler.waitForEditorRequest(ctx, request.ID, "ws", "user"); err != context.Canceled {
		t.Fatalf("wait error = %v, want cancellation", err)
	}
	stopped, err := relay.GetRequest(t.Context(), request.ID, "ws", "user")
	if err != nil || stopped.Status != "cancelled" {
		t.Fatalf("queued edit remained executable: status=%v err=%v", stopped, err)
	}
	leased, err := relay.LeaseNext(t.Context(), session.ID, "user", session.Epoch)
	if err != nil || leased != nil {
		t.Fatalf("browser received stopped edit: request=%v err=%v", leased, err)
	}
}

func TestHostedEditorAssistantHTTPUsesPaidToolLoopAndAccountsUsage(t *testing.T) {
	db := workflowHandlerDB(t)
	relay := editoragent.NewRelay(db)
	session, err := relay.Register(t.Context(), "ws", "user", "project", "video")
	if err != nil {
		t.Fatal(err)
	}
	request, err := relay.Enqueue(t.Context(), session, "user", "completed-key", "editor_context", json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := relay.LeaseNext(t.Context(), session.ID, "user", session.Epoch); err != nil {
		t.Fatal(err)
	}
	if err := relay.Respond(t.Context(), session.ID, "user", session.Epoch, request.ID, json.RawMessage(`{"revision":"current"}`), json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	arguments, _ := json.Marshal(map[string]string{"request_id": request.ID})
	generator := &editorAssistantSequenceGenerator{responses: []editorAssistantDecision{
		{Kind: "tool", Operation: "editor_work_status", ArgumentsJSON: string(arguments)},
		{Kind: "final", Message: "The editor is at revision current."},
	}}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
	NewEditorAgentAssistantHandler(db, workflowSession{}, entitlements.NewStaticService(entitlements.PlanSnapshot{PlanID: "paid"}), generator, "test-model", "cloud").RegisterRoutes(api)
	body, _ := json.Marshal(map[string]string{
		"workspace_id": "ws", "session_id": session.ID, "project_id": "project", "prompt": "Check the editor",
	})
	httpRequest := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/editor-agent/assistant", bytes.NewReader(body))
	httpRequest.Header.Set("Authorization", "Bearer session")
	httpRequest.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	e.ServeHTTP(response, httpRequest)
	if response.Code != http.StatusOK {
		t.Fatalf("assistant status = %d: %s", response.Code, response.Body.String())
	}
	var result struct {
		Reply        string                `json:"reply"`
		Steps        []editorAssistantStep `json:"steps"`
		InputTokens  int64                 `json:"input_tokens"`
		OutputTokens int64                 `json:"output_tokens"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if generator.calls != 2 || result.Reply != "The editor is at revision current." || len(result.Steps) != 1 || string(result.Steps[0].Result) != `{"revision":"current"}` || result.InputTokens != 20 || result.OutputTokens != 10 {
		t.Fatalf("assistant did not inspect the real receipt and account for both model calls: %#v, calls=%d", result, generator.calls)
	}
}

func TestEditorAgentMCPValidatesSpecificActions(t *testing.T) {
	base := map[string]any{
		"workspace_id": "workspace", "session_id": "session", "project_id": "project",
		"expected_revision": "revision", "request_id": "retry-key",
	}
	for _, test := range []struct {
		name    string
		tool    string
		action  map[string]any
		allowed bool
	}{
		{"video text", "video_edit", map[string]any{"kind": "text.add", "value": map[string]any{"text": "Hello", "frame": 30}}, true},
		{"video missing target", "video_edit", map[string]any{"kind": "clip.remove", "value": map[string]any{"include_linked": false}}, false},
		{"video wrong value", "video_edit", map[string]any{"kind": "audio.gain", "target_id": "clip", "value": map[string]any{"gain": 9}}, false},
		{"image text", "image_edit", map[string]any{"kind": "text.set", "target_id": "layer", "value": map[string]any{"page_id": "page", "text": "Hello"}}, true},
		{"image unsupported", "image_edit", map[string]any{"kind": "arbitrary.patch", "target_id": "layer", "value": map[string]any{"page_id": "page"}}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			args := make(map[string]any, len(base)+1)
			for key, value := range base {
				args[key] = value
			}
			args["actions"] = []any{test.action}
			err := validateMCPToolArguments(test.tool, args)
			if (err == nil) != test.allowed {
				t.Fatalf("validation allowed=%v, want %v: %#v", err == nil, test.allowed, err)
			}
		})
	}
}

func TestEditorAudioPreviewReturnsBoundedMCPAudioContent(t *testing.T) {
	wav := make([]byte, 44)
	copy(wav[:4], "RIFF")
	copy(wav[8:12], "WAVE")
	encoded := base64.StdEncoding.EncodeToString(wav)
	result := editorAgentToolResult(map[string]any{"request": &editoragent.Request{
		Status: "completed", Result: json.RawMessage(`{"audio_base64":"` + encoded + `","start_frame":0}`),
	}})
	content := result["content"].([]mcpContent)
	if len(content) != 2 || content[1].Type != "audio" || content[1].MimeType != "audio/wav" || content[1].Data != encoded {
		t.Fatalf("WAV preview was not returned as audio content: %#v", content)
	}
	receipt := result["structuredContent"].(map[string]any)["request"].(*editoragent.Request)
	if string(receipt.Result) != `{"start_frame":0}` {
		t.Fatalf("audio bytes leaked into the structured receipt: %s", receipt.Result)
	}
}

func TestEditorAgentMCPResultUsesAdvertisedEnvelope(t *testing.T) {
	result := editorAgentToolResult(map[string]any{"sessions": []any{}})
	if err := validateMCPToolOutput("editor_sessions", result); err != nil {
		t.Fatalf("editor session output does not match the MCP contract: %v", err)
	}
	if err := validateMCPToolOutput("editor_sessions", map[string]any{"sessions": []any{}}); err == nil {
		t.Fatal("bare editor data must not pass as an MCP tool response")
	}
}

func TestHostedAssistantCanInspectCompletedEditorRequest(t *testing.T) {
	db := workflowHandlerDB(t)
	relay := editoragent.NewRelay(db)
	session, err := relay.Register(t.Context(), "ws", "user", "project", "video")
	if err != nil {
		t.Fatal(err)
	}
	request, err := relay.Enqueue(t.Context(), session, "user", "edit-key", "video_edit", json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := relay.LeaseNext(t.Context(), session.ID, "user", session.Epoch); err != nil {
		t.Fatal(err)
	}
	if err := relay.Respond(t.Context(), session.ID, "user", session.Epoch, request.ID, json.RawMessage(`{"status":"committed"}`), json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	handler := &EditorAgentAssistantHandler{db: db}
	arguments, _ := json.Marshal(map[string]string{"request_id": request.ID})
	result, preview, err := handler.execute(t.Context(), "user", "ws", session.ID, "project", "editor_work_status", string(arguments), "unused")
	if err != nil || preview != nil || string(result) != `{"status":"committed"}` {
		t.Fatalf("assistant could not recover completed request: result=%s preview=%#v err=%v", result, preview, err)
	}
}
