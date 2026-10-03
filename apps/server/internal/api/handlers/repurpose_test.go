package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/repurpose"
	"github.com/stretchr/testify/require"
)

type repurposeGenerator struct{}

func (repurposeGenerator) Generate(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
	return ai.GenerateResult{Text: `{"candidates":[]}`}, nil
}

func TestRepurposeHTTPReviewBoundary(t *testing.T) {
	db := newHandlerSchemaTestDB(t)
	for _, model := range []any{
		&models.User{ID: "user-1", Email: "one@example.com"}, &models.User{ID: "user-2", Email: "two@example.com"},
		&models.Workspace{ID: "ws-1", OrganizationID: "org-1", Name: "Main"}, &models.Workspace{ID: "ws-2", OrganizationID: "org-2", Name: "Other"},
		&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
		&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-2", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
	} {
		_, err := db.NewInsert().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("test", "1"))
	NewRepurposeHandler(repurpose.New(db, repurposeGenerator{}, "fixture"), publicationBuildTestAuthenticator{}).RegisterRoutes(api)
	invoke := func(method, path, token, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequestWithContext(t.Context(), method, path, bytes.NewBufferString(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Idempotency-Key", "http-request-1")
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		response := httptest.NewRecorder()
		e.ServeHTTP(response, request)
		return response
	}
	body := `{"workspace_id":"ws-1","source":{"id":"local-source","revision":"snapshot-1","audio_track_index":0,"duration":5,"words":[{"text":"A complete thought.","start":0.5,"end":4}]}}`
	require.Equal(t, http.StatusUnauthorized, invoke(http.MethodPost, "/api/v1/repurpose-suggestions", "", body).Code)
	require.Equal(t, http.StatusForbidden, invoke(http.MethodPost, "/api/v1/repurpose-suggestions", "foreign-workspace-token", body).Code)
	response := invoke(http.MethodPost, "/api/v1/repurpose-suggestions", "web-token", body)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var suggestion repurpose.ClipSuggestions
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &suggestion))
	require.Equal(t, "snapshot-1", suggestion.SourceRevision)
	path := "/api/v1/repurpose-suggestions/" + suggestion.ID
	require.Equal(t, http.StatusNotFound, invoke(http.MethodGet, path, "other-user-token", "").Code)
	require.Equal(t, http.StatusForbidden, invoke(http.MethodGet, path, "foreign-workspace-token", "").Code)
	require.Equal(t, http.StatusConflict, invoke(http.MethodPost, path+"/cancel", "web-token", `{"revision":99}`).Code)
	response = invoke(http.MethodPost, path+"/cancel", "web-token", `{"revision":1}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	response = invoke(http.MethodPost, path+"/retry", "web-token", `{"revision":2}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Equal(t, http.StatusUnprocessableEntity, invoke(http.MethodPost, path+"/cancel", "web-token", `{"revision":0}`).Code)
	_, err := db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role = ?", models.WorkspaceRoleViewer).Where("user_id = ?", "user-1").Exec(t.Context())
	require.NoError(t, err)
	require.Equal(t, http.StatusForbidden, invoke(http.MethodPost, path+"/cancel", "web-token", `{"revision":3}`).Code)
	require.Equal(t, http.StatusForbidden, invoke(http.MethodPost, "/api/v1/repurpose-suggestions", "web-token", body).Code)
	require.Equal(t, http.StatusOK, invoke(http.MethodGet, path, "web-token", "").Code)
}
