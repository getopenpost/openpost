package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/publicationbuilder"
	"github.com/openpost/backend/internal/services/workflows"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
)

type workflowFailingBuilder struct{}

func (workflowFailingBuilder) Build(context.Context, publicationbuilder.BuildInput) (publicationbuilder.BuildResult, error) {
	return publicationbuilder.BuildResult{}, errors.New("synthetic private backend detail must not escape")
}

func TestWorkflowBuilderFailureRetainsNativeResultAndSafeRecovery(t *testing.T) {
	db := workflowHandlerDB(t)
	application, err := publicationbuilder.NewApplication(db, workflowFailingBuilder{}, publicationbuilder.ApplicationConfig{})
	require.NoError(t, err)
	publications := NewPublicationHandler(db, workflowSession{}, nil)
	builds := NewPublicationBuildHandler(db, workflowSession{}, application)
	service := workflows.NewService(db, NewWorkflowActions(publications, builds, nil), nil)
	actor := workspaceaccess.ActorFacts{UserID: "user", SessionID: "session"}
	workflow, err := service.Save(t.Context(), actor, "ws", "", workflows.SaveRequest{Name: "Synthetic Builder failure", Definition: workflows.Definition{Schema: 1, Source: workflows.Source{Kind: "manual"}, Steps: []workflows.Step{{ID: "build", Kind: workflows.KindBuild, Name: "Build", Inputs: map[string]workflows.Value{"text": {Literal: "Synthetic unscheduled post"}}}}}})
	require.NoError(t, err)
	run, err := service.Start(t.Context(), actor, "ws", workflow.ID, workflows.ModeLive, map[string]any{}, workflow.Revision)
	require.NoError(t, err)
	authority := workspaceaccess.StoredAuthority{UserID: "user", WorkspaceID: "ws", OrganizationID: "org", AssuredAt: time.Now().UTC()}
	build, _, err := application.Enqueue(t.Context(), publicationbuilder.CreateBuildRequest{WorkspaceID: "ws", CreatedByID: "user", IdempotencyKey: "workflow:" + run.ID + ":build", Authority: authority, Input: publicationbuilder.BuildInput{Idea: "Synthetic unscheduled post", Destinations: []publicationbuilder.Destination{{AccountID: "synthetic-account", Platform: "bluesky", AllowedOutputProfiles: []publicationbuilder.OutputProfile{{Key: "post", TextLimit: 300, MaxSegments: 1}}}}}})
	require.NoError(t, err)
	payload, err := json.Marshal(map[string]string{"build_id": build.ID})
	require.NoError(t, err)
	require.Error(t, application.HandleJob(t.Context(), jobregistry.TypePublicationBuild, string(payload)))
	failed, err := application.Get(t.Context(), "user", build.ID)
	require.NoError(t, err)
	require.Equal(t, publicationbuilder.BuildStateFailed, failed.State)
	payload, err = json.Marshal(map[string]string{"run_id": run.ID})
	require.NoError(t, err)
	require.NoError(t, service.HandleJob(t.Context(), jobregistry.TypeWorkflowRun, string(payload)))
	retained, err := service.GetRun(t.Context(), actor, "ws", run.ID)
	require.NoError(t, err)
	require.Equal(t, workflows.StateFailed, retained.State)
	require.Len(t, retained.Steps, 1)
	require.Equal(t, build.ID, retained.Steps[0].Output["build_id"])
	require.Equal(t, failed.State, retained.Steps[0].Output["state"])
	require.Equal(t, "generation_failed", retained.Steps[0].Output["error_code"])
	require.Equal(t, failed.ErrorMessage, retained.Steps[0].Error)
	encoded, err := json.Marshal(retained)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "synthetic private backend detail")
	require.NotContains(t, retained.Error, "Open the build")
	count, err := db.NewSelect().Model((*models.Publication)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Builder inspection", "1"))
	NewPublicationBuildHandler(db, workflowBuildReadSession{}, nil).RegisterRoutes(api)
	for _, check := range []struct {
		method, path, token string
		status              int
	}{
		{http.MethodGet, "/api/v1/publication-builds/" + build.ID, "session", http.StatusOK},
		{http.MethodGet, "/api/v1/publication-builds/" + build.ID, "other", http.StatusNotFound},
		{http.MethodGet, "/api/v1/publication-builds/" + build.ID, "foreign-workspace", http.StatusForbidden},
		{http.MethodPost, "/api/v1/publication-builds/" + build.ID + "/retry", "session", http.StatusServiceUnavailable},
	} {
		req := httptest.NewRequestWithContext(t.Context(), check.method, check.path, bytes.NewBufferString("{}"))
		req.Header.Set("Authorization", "Bearer "+check.token)
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		e.ServeHTTP(response, req)
		require.Equal(t, check.status, response.Code, response.Body.String())
		require.NotContains(t, response.Body.String(), "synthetic private backend detail")
		if check.status == http.StatusOK {
			require.Contains(t, response.Body.String(), build.ID)
			require.Contains(t, response.Body.String(), "generation_failed")
		}
	}
}

type workflowBuildReadSession struct{}

func (workflowBuildReadSession) AuthenticateBearer(_ context.Context, token string) (*middleware.Principal, error) {
	userID, workspaceID := "user", ""
	if token == "other" {
		userID = "other"
	}
	if token == "foreign-workspace" {
		workspaceID = "other"
	}
	return &middleware.Principal{UserID: userID, SessionID: "session", WorkspaceID: workspaceID}, nil
}
