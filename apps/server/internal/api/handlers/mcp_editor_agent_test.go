package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/services/aiusage"
	"github.com/openpost/backend/internal/services/editoragent"
	"github.com/openpost/backend/internal/services/editorpreferences"
	"github.com/openpost/backend/internal/services/entitlements"
)

type editorAssistantTestGenerator struct{}

func (editorAssistantTestGenerator) Generate(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
	return ai.GenerateResult{}, nil
}

type editorAssistantSequenceGenerator struct {
	responses []editorAssistantDecision
	audioSeen bool
	calls     int
}

func (g *editorAssistantSequenceGenerator) Generate(_ context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
	for _, part := range request.Parts {
		if part.Audio != nil && part.Audio.MIMEType == "audio/wav" && len(part.Audio.Data) > 0 {
			g.audioSeen = true
		}
	}
	if request.Model != "test-model" || request.ResponseSchema == nil || g.calls >= len(g.responses) {
		return ai.GenerateResult{}, ai.ErrEmptyResponse
	}
	response, _ := json.Marshal(g.responses[g.calls])
	g.calls++
	return ai.GenerateResult{Text: string(response), Usage: ai.Usage{InputTokens: 10, OutputTokens: 5}}, nil
}

func TestEditorAssistantRequiresConfiguredModelEditAccessAndHostedPlan(t *testing.T) {
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
		{name: "self hosted", edition: "selfhost", entitlement: entitlements.NewStaticService(entitlements.PlanSnapshot{PlanID: "paid"}), workspaceID: "ws", userID: "user", available: true},
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
	// Stand in for the connected browser, leasing and answering the actual query.
	browserCtx, stopBrowser := context.WithCancel(t.Context())
	defer stopBrowser()
	browserResult := make(chan error, 1)
	go func() {
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-browserCtx.Done():
				browserResult <- browserCtx.Err()
				return
			case <-ticker.C:
				request, leaseErr := relay.LeaseNext(browserCtx, session.ID, "user", session.Epoch)
				if leaseErr != nil {
					browserResult <- leaseErr
					return
				}
				if request == nil {
					continue
				}
				if request.Operation != "preview_audio" {
					browserResult <- fmt.Errorf("browser received %q instead of preview_audio", request.Operation)
					return
				}
				browserResult <- relay.Respond(browserCtx, session.ID, "user", session.Epoch, request.ID, json.RawMessage(`{"revision":"current","audio_base64":"UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA="}`), json.RawMessage(`{}`))
				return
			}
		}
	}()
	generator := &editorAssistantSequenceGenerator{responses: []editorAssistantDecision{
		{Kind: "tool", Operation: "preview_audio", ArgumentsJSON: `{"expected_revision":"current","start_frame":0,"end_frame":30}`},
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
	stopBrowser()
	if err := <-browserResult; err != nil {
		t.Fatalf("browser did not receive the audio query: %v; response: %s", err, response.Body.String())
	}
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
	if !generator.audioSeen || generator.calls != 2 || result.Reply != "The editor is at revision current." || len(result.Steps) != 1 || string(result.Steps[0].Result) != `{"revision":"current"}` || result.InputTokens != 20 || result.OutputTokens != 10 {
		t.Fatalf("assistant did not inspect the real receipt and account for both model calls: %#v, calls=%d", result, generator.calls)
	}
	preferences := editorpreferences.NewService(db)
	personal, err := preferences.SavePreference(t.Context(), "ws", "user", editorpreferences.Preference{EditorKind: "video", Rule: "Use simple captions", SourceInstruction: "Always use simple captions", Enabled: true}, 0)
	if err != nil {
		t.Fatal(err)
	}
	removeArgs, _ := json.Marshal(map[string]any{"id": personal.ID, "project_id": "", "expected_revision": personal.Revision})
	generator.responses = []editorAssistantDecision{
		{Kind: "tool", Operation: "preferences_remove", ArgumentsJSON: string(removeArgs)},
		{Kind: "final", Message: "I forgot your personal caption rule."},
	}
	generator.calls = 0
	body, _ = json.Marshal(map[string]string{"workspace_id": "ws", "session_id": session.ID, "project_id": "project", "prompt": "Forget my personal caption rule"})
	httpRequest = httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/editor-agent/assistant", bytes.NewReader(body))
	httpRequest.Header.Set("Authorization", "Bearer session")
	httpRequest.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	e.ServeHTTP(response, httpRequest)
	if response.Code != http.StatusOK {
		t.Fatalf("forget status = %d: %s", response.Code, response.Body.String())
	}
	remaining, err := preferences.Context(t.Context(), "ws", "user", "project", "video", "")
	if err != nil || len(remaining.Preferences) != 0 {
		t.Fatalf("Hosted forget did not remove the personal rule: %+v %v", remaining.Preferences, err)
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

func TestEditorPreferencesKeepScopeExplicitRulesAndPinnedStyles(t *testing.T) {
	db := workflowHandlerDB(t)
	service := editorpreferences.NewService(db)
	personal, err := service.SavePreference(t.Context(), "ws", "user", editorpreferences.Preference{EditorKind: "video", Rule: "Use simple captions", SourceInstruction: "Always use simple captions", Enabled: true}, 0)
	if err != nil {
		t.Fatal(err)
	}
	project, err := service.SavePreference(t.Context(), "ws", "user", editorpreferences.Preference{ProjectID: "project-a", EditorKind: "video", Rule: "Keep the intro", SourceInstruction: "Remember this project's intro", Enabled: true}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.SavePreference(t.Context(), "ws", "user", personal, 0); err != nil {
		t.Fatal(err)
	}
	if _, err = service.SavePreference(t.Context(), "ws", "user", personal, personal.Revision+1); err != editorpreferences.ErrConflict {
		t.Fatalf("stale preference update: %v", err)
	}
	for _, entry := range []struct {
		user, project string
		count         int
	}{{"user", "project-a", 3}, {"user", "project-b", 2}, {"other", "project-a", 1}} {
		context, err := service.Context(t.Context(), "ws", entry.user, entry.project, "video", "")
		if err != nil || len(context.Preferences) != entry.count {
			t.Fatalf("preferences leaked or disappeared for %v: %+v %v", entry, context.Preferences, err)
		}
	}
	if err = service.RemovePreference(t.Context(), "ws", "other", "", personal.ID, personal.Revision); err != editorpreferences.ErrConflict {
		t.Fatalf("another user removed private rule: %v", err)
	}
	if err = service.RemovePreference(t.Context(), "ws", "user", "project-b", project.ID, project.Revision); err != editorpreferences.ErrConflict {
		t.Fatalf("project rule removed through another project: %v", err)
	}
	style, err := service.SaveStyle(t.Context(), "ws", "user", editorpreferences.Style{Name: "My captions", EditorKind: "video", SourceInstruction: "Save my caption style", Definition: editorpreferences.StyleDefinition{Typography: editorpreferences.TextStyle{FontSize: 40, Color: "#ffffff"}}}, 0)
	if err != nil {
		t.Fatal(err)
	}
	style.Definition.Typography.FontSize = 60
	updated, err := service.SaveStyle(t.Context(), "ws", "user", style, 1)
	if err != nil || updated.Version != 2 {
		t.Fatalf("style update: %+v %v", updated, err)
	}
	pinned, err := service.Style(t.Context(), "ws", "user", style.ID, 1)
	if err != nil || pinned.Definition.Typography.FontSize != 40 {
		t.Fatalf("pinned style changed: %+v %v", pinned, err)
	}
	if _, err = service.Style(t.Context(), "ws", "other", style.ID, 0); err != editorpreferences.ErrUnavailable {
		t.Fatalf("private style leaked: %v", err)
	}
	context, err := service.Context(t.Context(), "ws", "user", "project-a", "video", "")
	if err != nil || len(context.Styles) != 6 || context.Styles[5].Version != 2 {
		t.Fatalf("style list doesn't select latest once: %+v %v", context.Styles, err)
	}
	if err = service.ArchiveStyle(t.Context(), "ws", "user", style.ID, 1, true); err != editorpreferences.ErrConflict {
		t.Fatalf("stale archive: %v", err)
	}
	if err = service.ArchiveStyle(t.Context(), "ws", "user", style.ID, 2, true); err != nil {
		t.Fatal(err)
	}
	hidden, err := service.Context(t.Context(), "ws", "user", "project-a", "video", "")
	if err != nil || len(hidden.Styles) != 5 {
		t.Fatalf("archived style remains selectable: %+v %v", hidden.Styles, err)
	}
	if pinned, err = service.Style(t.Context(), "ws", "user", style.ID, 1); err != nil || pinned.Definition.Typography.FontSize != 40 {
		t.Fatalf("archive broke pinned version: %+v %v", pinned, err)
	}
	if err = service.ArchiveStyle(t.Context(), "ws", "user", style.ID, 2, false); err != nil {
		t.Fatal(err)
	}
}

func TestEditorSuggestionsNeedThreeDistinctManualProjectsAndRespectReset(t *testing.T) {
	service := editorpreferences.NewService(workflowHandlerDB(t))
	record := func(project string) {
		t.Helper()
		if err := service.RecordChoice(t.Context(), "ws", "user", project, "tutorial", "caption-clean", "Clean captions", "video"); err != nil {
			t.Fatal(err)
		}
	}
	record("one")
	record("one")
	record("two")
	read := func() editorpreferences.Context {
		t.Helper()
		c, err := service.Context(t.Context(), "ws", "user", "one", "video", "tutorial")
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	if len(read().Suggestions) != 0 {
		t.Fatal("repeated choice in one project became a rule")
	}
	record("three")
	if c := read(); len(c.Suggestions) != 1 || c.Suggestions[0].Projects != 3 || len(c.Preferences) != 0 {
		t.Fatalf("manual choice suggestion: %+v", c)
	}
	if err := service.SetLearning(t.Context(), "ws", "user", editorpreferences.LearningChange{Enabled: false, Reset: true, ProjectID: "two"}); err != nil {
		t.Fatal(err)
	}
	record("four")
	if c := read(); c.LearningEnabled || len(c.Suggestions) != 0 {
		t.Fatalf("learning off still ranks choices: %+v", c)
	}
	if err := service.SetLearning(t.Context(), "ws", "user", editorpreferences.LearningChange{Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if len(read().Suggestions) != 0 {
		t.Fatal("disabled or reset observations counted toward suggestion")
	}
}

type editorUsageGenerator func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error)

func (g editorUsageGenerator) Generate(ctx context.Context, r ai.GenerateRequest) (ai.GenerateResult, error) {
	return g(ctx, r)
}

func TestEditorUsageSurvivesCancellationAndInvalidOutput(t *testing.T) {
	db := workflowHandlerDB(t)
	usage := aiusage.NewService(db)
	ctx, cancel := context.WithCancel(t.Context())
	cost := 0.0042
	generator := editorUsageGenerator(func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
		cancel()
		return ai.GenerateResult{RequestID: "provider-call", Model: "actual-model", Usage: ai.Usage{InputTokens: 31, OutputTokens: 7, TotalTokens: 38, CostUSD: &cost}}, context.Canceled
	})
	_, err := usage.Generate(ctx, aiusage.EditorIdentity{WorkspaceID: "ws", UserID: "user", ProjectID: "p", RunID: "cancel-run", Step: 1}, generator, ai.GenerateRequest{Model: "requested-model"})
	if err != context.Canceled {
		t.Fatalf("cancel outcome: %v", err)
	}
	calls, err := usage.List(t.Context(), "ws", "user")
	if err != nil || len(calls) != 1 || calls[0].ProviderRequestID != "provider-call" || calls[0].CostMicrousd == nil || *calls[0].CostMicrousd != 4200 || calls[0].TotalTokens == nil || *calls[0].TotalTokens != 38 {
		t.Fatalf("cancellation lost provider accounting: %+v %v", calls, err)
	}
	if err := usage.Invalid(ctx, "cancel-run", 1); err != nil {
		t.Fatal(err)
	}
	calls, err = usage.List(t.Context(), "ws", "user")
	if err != nil || calls[0].State != "invalid_output" || *calls[0].InputTokens != 31 {
		t.Fatalf("invalid-output marking erased accounting: %+v %v", calls, err)
	}
	other, err := usage.List(t.Context(), "ws", "other")
	if err != nil || len(other) != 0 {
		t.Fatalf("usage leaked to another user: %+v %v", other, err)
	}
}
