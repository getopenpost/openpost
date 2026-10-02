package handlers

import (
	"encoding/base64"
	"encoding/json"
	"testing"

	"github.com/openpost/backend/internal/services/editoragent"
)

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
