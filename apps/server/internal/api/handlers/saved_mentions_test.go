package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestSavedMentionLibraryUsesCurrentWorkspacePermissions(t *testing.T) {
	db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.SavedMention)(nil))
	_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws", UserID: "user-1", Role: models.WorkspaceRoleEditor}).Exec(t.Context())
	require.NoError(t, err)
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
	RegisterSavedMentionRoutes(api, db, testAuthenticator{})
	call := func(method, path string, body any) *httptest.ResponseRecorder {
		var payload bytes.Buffer
		if body != nil {
			require.NoError(t, json.NewEncoder(&payload).Encode(body))
		}
		req := httptest.NewRequestWithContext(t.Context(), method, "/api/v1/workspaces/"+path, &payload)
		req.Header.Set("Authorization", "Bearer web-token")
		req.Header.Set("Content-Type", "application/json")
		out := httptest.NewRecorder()
		e.ServeHTTP(out, req)
		return out
	}
	input := map[string]any{"name": "@alice", "profiles": []map[string]any{{"provider": "x", "text": "@alice_x"}}}
	created := call(http.MethodPost, "ws/mentions", input)
	require.Equal(t, http.StatusOK, created.Code, created.Body.String())
	var saved SavedMentionResponse
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &saved))
	require.NotEmpty(t, saved.ID)
	listed := call(http.MethodGet, "ws/mentions", nil)
	require.Equal(t, http.StatusOK, listed.Code, listed.Body.String())
	require.Contains(t, listed.Body.String(), "@alice_x")
	require.Equal(t, http.StatusForbidden, call(http.MethodGet, "other/mentions", nil).Code)
	require.Equal(t, http.StatusForbidden, call(http.MethodDelete, "other/mentions/"+saved.ID, nil).Code)
	input["id"] = saved.ID
	input["name"] = "@renamed"
	require.Equal(t, http.StatusOK, call(http.MethodPost, "ws/mentions", input).Code)
	_, err = db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role = ?", models.WorkspaceRoleViewer).Where("workspace_id = ?", "ws").Exec(t.Context())
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, call(http.MethodGet, "ws/mentions", nil).Code)
	require.Equal(t, http.StatusForbidden, call(http.MethodPost, "ws/mentions", input).Code)
	require.Equal(t, http.StatusForbidden, call(http.MethodDelete, "ws/mentions/"+saved.ID, nil).Code)
	_, err = db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role = ?", models.WorkspaceRoleEditor).Where("workspace_id = ?", "ws").Exec(t.Context())
	require.NoError(t, err)
	require.Equal(t, http.StatusNoContent, call(http.MethodDelete, "ws/mentions/"+saved.ID, nil).Code)
	require.JSONEq(t, "[]", call(http.MethodGet, "ws/mentions", nil).Body.String())
}
