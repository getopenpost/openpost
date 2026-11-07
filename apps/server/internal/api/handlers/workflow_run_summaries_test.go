package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/workflows"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
)

func TestWorkflowRunSummariesKeepPayloadsInAuthorizedDetail(t *testing.T) {
	db := workflowHandlerDB(t)
	service := workflows.NewService(db, NewWorkflowActions(NewPublicationHandler(db, workflowSession{}, nil), nil, nil), nil)
	actor := workspaceaccess.ActorFacts{UserID: "user", SessionID: "session"}
	workflow, err := service.Save(t.Context(), actor, "ws", "", workflows.SaveRequest{Name: "Original workflow", Definition: workflows.Definition{Schema: 1, Source: workflows.Source{Kind: "manual"}, Steps: []workflows.Step{{ID: "draft", Kind: workflows.KindDraft, Inputs: map[string]workflows.Value{"text": {Reference: "source.body"}}}}}})
	require.NoError(t, err)
	run, err := service.Start(t.Context(), actor, "ws", workflow.ID, workflows.ModePreview, map[string]any{"body": "Full source preserved"}, workflow.Revision)
	require.NoError(t, err)
	require.NoError(t, service.HandleJob(t.Context(), jobregistry.TypeWorkflowRun, `{"run_id":"`+run.ID+`"}`))
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
	NewWorkflowHandler(service, workflowSession{}).RegisterRoutes(api)
	get := func(path string, status int) []byte {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1"+path, nil)
		req.Header.Set("Authorization", "Bearer session")
		response := httptest.NewRecorder()
		e.ServeHTTP(response, req)
		require.Equal(t, status, response.Code, response.Body.String())
		return response.Body.Bytes()
	}
	var summaries []map[string]any
	require.NoError(t, json.Unmarshal(get("/workflow-run-summaries?workspace_id=ws", http.StatusOK), &summaries))
	require.Len(t, summaries, 1)
	require.Equal(t, run.ID, summaries[0]["id"])
	require.Equal(t, "Original workflow", summaries[0]["workflow_name"])
	require.NotContains(t, summaries[0], "source")
	require.Equal(t, []any{map[string]any{"step_id": "draft", "state": "succeeded"}}, summaries[0]["steps"])
	var detail workflows.Run
	require.NoError(t, json.Unmarshal(get("/workflow-runs/"+run.ID+"?workspace_id=ws", http.StatusOK), &detail))
	require.Equal(t, "Full source preserved", detail.Source["body"])
	require.Equal(t, "Full source preserved", detail.Steps[0].Inputs["text"])
	require.Equal(t, true, detail.Steps[0].Output["preview"])
	var fullList []workflows.Run
	require.NoError(t, json.Unmarshal(get("/workflow-runs?workspace_id=ws", http.StatusOK), &fullList))
	require.Equal(t, []workflows.Run{detail}, fullList)
	get("/workflow-run-summaries?workspace_id=other", http.StatusForbidden)
	require.JSONEq(t, `[]`, string(get("/workflow-run-summaries?workspace_id=ws&workflow_id=other", http.StatusOK)))
}

type workflowSummaryScopeSession struct{}

func (workflowSummaryScopeSession) AuthenticateBearer(_ context.Context, scope string) (*middleware.Principal, error) {
	return &middleware.Principal{UserID: "user", SessionID: "session", Scope: scope}, nil
}
func TestWorkflowRunSummariesAllowReadScopes(t *testing.T) {
	db := workflowHandlerDB(t)
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
	NewWorkflowHandler(workflows.NewService(db, nil, nil), workflowSummaryScopeSession{}).RegisterRoutes(api)
	for _, scope := range []string{apitokens.ScopeAPIRead, apitokens.ScopeAPIWrite, apitokens.ScopeMCP} {
		for _, path := range []string{"/workflow-runs", "/workflow-run-summaries"} {
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1"+path+"?workspace_id=ws", nil)
			req.Header.Set("Authorization", "Bearer "+scope)
			response := httptest.NewRecorder()
			e.ServeHTTP(response, req)
			expected := http.StatusOK
			if scope == apitokens.ScopeMCP {
				expected = http.StatusForbidden
			}
			require.Equal(t, expected, response.Code, "%s %s: %s", scope, path, response.Body.String())
		}
	}
}
