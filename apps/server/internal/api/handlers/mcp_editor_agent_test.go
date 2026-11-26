package handlers

import (
	"bytes"
	"context"
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
	"github.com/openpost/backend/internal/services/editoragent"
	"github.com/openpost/backend/internal/services/editorpreferences"
	"github.com/openpost/backend/internal/services/entitlements"
)

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

func TestHostedEditorAssistantHTTPUsesPaidToolLoopAndAccountsUsage(t *testing.T) {
	t.Parallel()
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
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
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

func TestHostedAssistantCanInspectCompletedEditorRequest(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
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

type editorUsageGenerator func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error)

func (g editorUsageGenerator) Generate(ctx context.Context, r ai.GenerateRequest) (ai.GenerateResult, error) {
	return g(ctx, r)
}
