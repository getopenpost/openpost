package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestCloudVideoProjectCreateLoadAndWorkspaceAuthorization(t *testing.T) {
	t.Parallel()
	server := newVideoProjectTestServer(t)
	document := map[string]any{
		"id":            "project-document-1",
		"name":          "Launch clip",
		"schemaFamily":  "openpost",
		"schemaVersion": 12,
		"metadata": map[string]any{
			"width":  1080,
			"height": 1920,
			"fps":    30,
		},
		"timeline":       map[string]any{"tracks": []any{}, "items": []any{map[string]any{"id": "clip", "panelLayout": "device-only"}}},
		"rootFolderName": "device-only",
	}

	created := server.request(t, "editor-token", http.MethodPost, "/api/v1/video-projects", map[string]any{
		"id":           "client-project-1",
		"workspace_id": "ws-1",
		"name":         "Launch clip",
		"device_id":    "desktop-a",
		"document":     document,
	})
	require.Equal(t, http.StatusOK, created.Code, created.Body.String())

	var project VideoProjectResponse
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &project))
	require.NotEmpty(t, project.ID)
	require.Equal(t, "client-project-1", project.ID)
	require.Equal(t, "ws-1", project.WorkspaceID)
	require.Equal(t, int64(1), project.HeadRevision)
	require.Equal(t, "user-editor", project.UpdatedByUserID)
	require.Equal(t, "synced", project.SyncStatus)
	require.NotContains(t, projectDocument(t, project.Document), "rootFolderName")
	require.NotContains(t, projectItem(t, project.Document, 0), "panelLayout")

	replayed := server.request(t, "editor-token", http.MethodPost, "/api/v1/video-projects", map[string]any{
		"id": "client-project-1", "workspace_id": "ws-1", "name": "Ignored retry name", "device_id": "desktop-a", "document": document,
	})
	require.Equal(t, http.StatusOK, replayed.Code, replayed.Body.String())
	var replayedProject VideoProjectResponse
	require.NoError(t, json.Unmarshal(replayed.Body.Bytes(), &replayedProject))
	require.Equal(t, project.ID, replayedProject.ID)
	require.Equal(t, "Launch clip", replayedProject.Name)

	loaded := server.request(t, "editor-token", http.MethodGet, "/api/v1/video-projects/"+project.ID+"?workspace_id=ws-1", nil)
	require.Equal(t, http.StatusOK, loaded.Code, loaded.Body.String())
	var loadedProject VideoProjectResponse
	require.NoError(t, json.Unmarshal(loaded.Body.Bytes(), &loadedProject))
	require.Equal(t, project.ID, loadedProject.ID)
	require.Equal(t, project.Document, loadedProject.Document)

	viewerCreate := server.request(t, "viewer-token", http.MethodPost, "/api/v1/video-projects", map[string]any{
		"workspace_id": "ws-1",
		"name":         "Viewer project",
		"device_id":    "phone-b",
		"document":     document,
	})
	require.Equal(t, http.StatusForbidden, viewerCreate.Code, viewerCreate.Body.String())

	otherWorkspace := server.request(t, "editor-token", http.MethodGet, "/api/v1/video-projects/"+project.ID+"?workspace_id=ws-2", nil)
	require.Equal(t, http.StatusNotFound, otherWorkspace.Code, otherWorkspace.Body.String())
}

func TestCloudVideoProjectCopyRejectsMissingOrForeignSourcesWithoutCreatingAProject(t *testing.T) {
	t.Parallel()
	server := newVideoProjectTestServer(t)
	foreign := &models.VideoProject{
		ID: "foreign-source", WorkspaceID: "ws-2", Name: "Private source", DocumentJSON: `{}`,
		CreatedByUserID: "user-editor", UpdatedByUserID: "user-editor",
	}
	_, err := server.db.NewInsert().Model(foreign).Exec(t.Context())
	require.NoError(t, err)
	for _, sourceID := range []string{"missing-source", "foreign-source"} {
		t.Run(sourceID, func(t *testing.T) {
			id := "copy-" + sourceID
			copied := server.request(t, "editor-token", http.MethodPost, "/api/v1/video-projects", map[string]any{
				"id": id, "workspace_id": "ws-1", "name": "Copy", "source_project_id": sourceID,
				"document": map[string]any{"id": id},
			})
			require.Equal(t, http.StatusNotFound, copied.Code, copied.Body.String())
			count, err := server.db.NewSelect().Model((*models.VideoProject)(nil)).Where("id = ?", id).Count(t.Context())
			require.NoError(t, err)
			require.Zero(t, count, "failed source lookup must roll back the copy")
		})
	}
}

func TestCloudVideoProjectCanDismissConflictWithoutChangingHead(t *testing.T) {
	t.Parallel()
	server := newVideoProjectTestServer(t)
	created := server.request(t, "editor-token", http.MethodPost, "/api/v1/video-projects", map[string]any{
		"workspace_id": "ws-1", "name": "Dismiss conflict", "document": map[string]any{"id": "dismiss", "title": "Original"},
	})
	require.Equal(t, http.StatusOK, created.Code, created.Body.String())
	var project VideoProjectResponse
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &project))

	first := server.request(t, "editor-token", http.MethodPost, "/api/v1/video-projects/"+project.ID+"/mutations", map[string]any{
		"workspace_id": "ws-1", "mutation_id": "desktop", "base_revision": 1,
		"operations": []map[string]any{{"kind": "set", "target": "project:title", "path": "/title", "value": "Desktop"}},
	})
	require.Equal(t, http.StatusOK, first.Code, first.Body.String())
	second := server.request(t, "editor-token", http.MethodPost, "/api/v1/video-projects/"+project.ID+"/mutations", map[string]any{
		"workspace_id": "ws-1", "mutation_id": "phone", "base_revision": 1,
		"operations": []map[string]any{{"kind": "set", "target": "project:title", "path": "/title", "value": "Phone"}},
	})
	require.Equal(t, http.StatusOK, second.Code, second.Body.String())
	var conflict VideoProjectMutationResponse
	require.NoError(t, json.Unmarshal(second.Body.Bytes(), &conflict))
	require.Equal(t, "conflict", conflict.Outcome)
	require.NotEmpty(t, conflict.ConflictID, "the stale edit must be stored as a resolvable conflict")

	dismissed := server.request(t, "editor-token", http.MethodPost, "/api/v1/video-projects/"+project.ID+"/conflicts/"+conflict.ConflictID+"/resolve", map[string]any{
		"workspace_id": "ws-1", "resolution": "keep_current",
	})
	require.Equal(t, http.StatusOK, dismissed.Code, dismissed.Body.String())
	var dismissedProject VideoProjectResponse
	require.NoError(t, json.Unmarshal(dismissed.Body.Bytes(), &dismissedProject))
	require.Equal(t, int64(2), dismissedProject.HeadRevision)
	require.Equal(t, "Desktop", projectDocument(t, dismissedProject.Document)["title"])

	remaining := server.request(t, "editor-token", http.MethodGet, "/api/v1/video-projects/"+project.ID+"/conflicts?workspace_id=ws-1", nil)
	require.Equal(t, http.StatusOK, remaining.Code, remaining.Body.String())
	var branches []VideoProjectConflictResponse
	require.NoError(t, json.Unmarshal(remaining.Body.Bytes(), &branches))
	require.Empty(t, branches, "keeping the current head must dismiss the stored conflict")
}

func TestCloudVideoProjectCheckpointRestoreAndTrashRecovery(t *testing.T) {
	t.Parallel()
	server := newVideoProjectTestServer(t)
	created := server.request(t, "editor-token", http.MethodPost, "/api/v1/video-projects", map[string]any{
		"workspace_id": "ws-1",
		"name":         "Recovery",
		"device_id":    "desktop-a",
		"document": map[string]any{
			"id": "recovery-document",
			"timeline": map[string]any{"tracks": []any{}, "items": []map[string]any{
				{"id": "title", "type": "text", "text": "First"},
			}},
		},
	})
	require.Equal(t, http.StatusOK, created.Code, created.Body.String())
	var project VideoProjectResponse
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &project))

	mutated := server.request(t, "editor-token", http.MethodPost, "/api/v1/video-projects/"+project.ID+"/mutations", map[string]any{
		"workspace_id": "ws-1", "mutation_id": "title-second", "base_revision": 1, "device_id": "desktop-a",
		"operations": []map[string]any{{"kind": "set", "target": "item:title.text", "path": "/timeline/items/0/text", "value": "Second"}},
	})
	require.Equal(t, http.StatusOK, mutated.Code, mutated.Body.String())

	checkpointResponse := server.request(t, "editor-token", http.MethodPost, "/api/v1/video-projects/"+project.ID+"/checkpoints", map[string]any{
		"workspace_id": "ws-1", "name": "Approved cut",
	})
	require.Equal(t, http.StatusOK, checkpointResponse.Code, checkpointResponse.Body.String())
	var checkpoint VideoProjectCheckpointResponse
	require.NoError(t, json.Unmarshal(checkpointResponse.Body.Bytes(), &checkpoint))
	require.Equal(t, int64(2), checkpoint.Revision)
	require.Equal(t, "Approved cut", checkpoint.Name)

	third := server.request(t, "editor-token", http.MethodPost, "/api/v1/video-projects/"+project.ID+"/mutations", map[string]any{
		"workspace_id": "ws-1", "mutation_id": "title-third", "base_revision": 2, "device_id": "desktop-a",
		"operations": []map[string]any{{"kind": "set", "target": "item:title.text", "path": "/timeline/items/0/text", "value": "Third"}},
	})
	require.Equal(t, http.StatusOK, third.Code, third.Body.String())

	restored := server.request(t, "editor-token", http.MethodPost, "/api/v1/video-projects/"+project.ID+"/restore-revision", map[string]any{
		"workspace_id": "ws-1", "revision": checkpoint.Revision, "device_id": "desktop-a",
	})
	require.Equal(t, http.StatusOK, restored.Code, restored.Body.String())
	var restoredProject VideoProjectResponse
	require.NoError(t, json.Unmarshal(restored.Body.Bytes(), &restoredProject))
	require.Equal(t, int64(4), restoredProject.HeadRevision)
	require.Equal(t, "Second", projectItem(t, restoredProject.Document, 0)["text"])
	_, err := server.db.NewUpdate().Model((*models.VideoProjectRevision)(nil)).
		Set("expires_at = ?", time.Now().UTC().Add(-time.Minute)).
		Where("project_id = ? AND revision = ?", project.ID, 3).
		Exec(t.Context())
	require.NoError(t, err)

	revisions := server.request(t, "editor-token", http.MethodGet, "/api/v1/video-projects/"+project.ID+"/revisions?workspace_id=ws-1", nil)
	require.Equal(t, http.StatusOK, revisions.Code, revisions.Body.String())
	var history []VideoProjectRevisionResponse
	require.NoError(t, json.Unmarshal(revisions.Body.Bytes(), &history))
	require.Len(t, history, 3)
	require.Equal(t, int64(2), history[0].RestoredFromRevision)
	require.Equal(t, "restore", history[0].Kind)
	require.Equal(t, []string{"Approved cut"}, history[1].CheckpointNames)
	require.Empty(t, history[1].ExpiresAt)
	require.Len(t, history[1].Checkpoints, 1)
	require.Equal(t, checkpoint.ID, history[1].Checkpoints[0].ID)

	deletedCheckpoint := server.request(t, "editor-token", http.MethodDelete, "/api/v1/video-projects/"+project.ID+"/checkpoints/"+checkpoint.ID+"?workspace_id=ws-1", nil)
	require.Equal(t, http.StatusOK, deletedCheckpoint.Code, deletedCheckpoint.Body.String())
	revisionsAfterDelete := server.request(t, "editor-token", http.MethodGet, "/api/v1/video-projects/"+project.ID+"/revisions?workspace_id=ws-1", nil)
	require.Equal(t, http.StatusOK, revisionsAfterDelete.Code, revisionsAfterDelete.Body.String())
	require.NoError(t, json.Unmarshal(revisionsAfterDelete.Body.Bytes(), &history))
	require.Empty(t, history[1].CheckpointNames)
	require.NotEmpty(t, history[1].ExpiresAt)

	trashed := server.request(t, "editor-token", http.MethodPost, "/api/v1/video-projects/"+project.ID+"/trash", map[string]any{"workspace_id": "ws-1"})
	require.Equal(t, http.StatusOK, trashed.Code, trashed.Body.String())
	var trashedProject VideoProjectResponse
	require.NoError(t, json.Unmarshal(trashed.Body.Bytes(), &trashedProject))
	require.NotEmpty(t, trashedProject.TrashedAt)
	require.NotEmpty(t, trashedProject.RetentionExpiresAt)

	hidden := server.request(t, "editor-token", http.MethodGet, "/api/v1/video-projects/"+project.ID+"?workspace_id=ws-1", nil)
	require.Equal(t, http.StatusNotFound, hidden.Code, hidden.Body.String())
	trashList := server.request(t, "editor-token", http.MethodGet, "/api/v1/video-projects?workspace_id=ws-1&include_trash=true", nil)
	require.Equal(t, http.StatusOK, trashList.Code, trashList.Body.String())
	var listed []VideoProjectResponse
	require.NoError(t, json.Unmarshal(trashList.Body.Bytes(), &listed))
	require.Len(t, listed, 1)

	restoredFromTrash := server.request(t, "editor-token", http.MethodPost, "/api/v1/video-projects/"+project.ID+"/restore", map[string]any{"workspace_id": "ws-1"})
	require.Equal(t, http.StatusOK, restoredFromTrash.Code, restoredFromTrash.Body.String())
	var active VideoProjectResponse
	require.NoError(t, json.Unmarshal(restoredFromTrash.Body.Bytes(), &active))
	require.Empty(t, active.TrashedAt)
	require.Empty(t, active.RetentionExpiresAt)
	require.Equal(t, int64(4), active.HeadRevision)
}

type videoProjectTestServer struct {
	echo *echo.Echo
	db   *bun.DB
}

func newVideoProjectTestServer(t testing.TB) *videoProjectTestServer {
	t.Helper()
	db := createHandlerTestDB(t,
		(*models.Workspace)(nil),
		(*models.User)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.VideoProject)(nil),
		(*models.VideoProjectRevision)(nil),
		(*models.VideoProjectMutation)(nil),
		(*models.VideoProjectConflict)(nil),
		(*models.VideoProjectCheckpoint)(nil),
		(*models.ProjectAsset)(nil),
	)
	return videoProjectTestServerWithDB(t, db)
}

func videoProjectTestServerWithDB(t testing.TB, db *bun.DB) *videoProjectTestServer {
	t.Helper()
	ctx := context.Background()
	users := []models.User{
		{ID: "user-editor", Email: "editor@example.com", PasswordHash: "hash"},
		{ID: "user-viewer", Email: "viewer@example.com", PasswordHash: "hash"},
	}
	_, err := db.NewInsert().Model(&users).Exec(ctx)
	require.NoError(t, err)
	workspaces := []models.Workspace{{ID: "ws-1", Name: "Launch"}, {ID: "ws-2", Name: "Other"}}
	_, err = db.NewInsert().Model(&workspaces).Exec(ctx)
	require.NoError(t, err)
	members := []models.WorkspaceMember{
		{WorkspaceID: "ws-1", UserID: "user-editor", Role: models.WorkspaceRoleEditor},
		{WorkspaceID: "ws-1", UserID: "user-viewer", Role: models.WorkspaceRoleViewer},
	}
	_, err = db.NewInsert().Model(&members).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewVideoProjectHandler(db, videoProjectTestAuthenticator{}, nil).RegisterRoutes(api)
	return &videoProjectTestServer{echo: e, db: db}
}

func (s *videoProjectTestServer) request(t testing.TB, token, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, &payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	s.echo.ServeHTTP(recorder, req)
	return recorder
}

type videoProjectTestAuthenticator struct{}

func (videoProjectTestAuthenticator) AuthenticateBearer(_ context.Context, token string) (*middleware.Principal, error) {
	switch token {
	case "editor-token":
		return &middleware.Principal{UserID: "user-editor"}, nil
	case "viewer-token":
		return &middleware.Principal{UserID: "user-viewer"}, nil
	default:
		return nil, apitokens.ErrInvalidToken
	}
}

func projectDocument(t *testing.T, document videoProjectDocument) map[string]any {
	t.Helper()
	var decoded map[string]any
	require.NoError(t, json.Unmarshal(document.RawMessage, &decoded))
	return decoded
}

func projectItem(t *testing.T, document videoProjectDocument, index int) map[string]any {
	t.Helper()
	timeline, ok := projectDocument(t, document)["timeline"].(map[string]any)
	require.True(t, ok)
	items, ok := timeline["items"].([]any)
	require.True(t, ok)
	require.Greater(t, len(items), index)
	item, ok := items[index].(map[string]any)
	require.True(t, ok)
	return item
}
