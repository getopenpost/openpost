package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	notificationservice "github.com/openpost/backend/internal/services/notifications"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type notificationTestServer struct {
	echo *echo.Echo
	db   *bun.DB
}

func newNotificationTestServer(t *testing.T) *notificationTestServer {
	return newNotificationTestServerWithAuthenticator(t, testAuthenticator{})
}

func newNotificationTestServerWithAuthenticator(t *testing.T, auth middleware.Authenticator) *notificationTestServer {
	t.Helper()
	db := createHandlerTestDB(
		t,
		(*models.User)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.UserNotification)(nil),
		(*models.UserNotificationPreference)(nil),
		(*models.UserWorkspaceQueueReminder)(nil),
		(*models.UserNotificationDigestItem)(nil),
		(*models.UserNotificationMute)(nil),
		(*models.Job)(nil),
		(*models.WorkspaceActivation)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
	)
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewNotificationHandler(db, auth, notificationservice.NewService(db)).RegisterRoutes(api)
	return &notificationTestServer{echo: e, db: db}
}

func TestNotificationMuteAPIValidatesScopeAuthorizationAndEndsEarly(t *testing.T) {
	t.Parallel()
	server := newNotificationTestServer(t)
	server.seed(t)
	endsAt := time.Now().UTC().Add(2 * time.Hour).Format(time.RFC3339)

	unauthorized := jsonRequest(t, server.echo, http.MethodPost, "/api/v1/notifications/mutes", map[string]any{
		"scope": "workspace", "workspace_id": "workspace-outside", "ends_at": endsAt,
	}, "web-token")
	require.Equal(t, http.StatusForbidden, unauthorized.Code, unauthorized.Body.String())

	created := jsonRequest(t, server.echo, http.MethodPost, "/api/v1/notifications/mutes", map[string]any{
		"scope": "workspace", "workspace_id": "workspace-1", "ends_at": endsAt,
	}, "web-token")
	require.Equal(t, http.StatusOK, created.Code, created.Body.String())
	require.Contains(t, created.Body.String(), `"scope":"workspace"`)
	require.Contains(t, created.Body.String(), `"workspace_name":"One"`)
	var body struct {
		Mutes []struct {
			ID string `json:"id"`
		} `json:"mutes"`
	}
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &body))
	require.Len(t, body.Mutes, 1)

	ended := jsonRequest(t, server.echo, http.MethodDelete, "/api/v1/notifications/mutes/"+body.Mutes[0].ID, nil, "web-token")
	require.Equal(t, http.StatusOK, ended.Code, ended.Body.String())
	require.Contains(t, ended.Body.String(), `"mutes":[]`)
}

func TestNotificationMuteAPIRejectsPastAndMismatchedScopes(t *testing.T) {
	t.Parallel()
	server := newNotificationTestServer(t)
	server.seed(t)

	for _, body := range []map[string]any{
		{"scope": "account", "workspace_id": "workspace-1", "ends_at": time.Now().UTC().Add(time.Hour).Format(time.RFC3339)},
		{"scope": "workspace", "ends_at": time.Now().UTC().Add(time.Hour).Format(time.RFC3339)},
		{"scope": "account", "ends_at": time.Now().UTC().Add(-time.Minute).Format(time.RFC3339)},
	} {
		response := jsonRequest(t, server.echo, http.MethodPost, "/api/v1/notifications/mutes", body, "web-token")
		require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
	}
}

func (s *notificationTestServer) seed(t *testing.T) {
	t.Helper()
	now := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)
	for _, model := range []any{
		&models.User{ID: "user-1", Email: "one@example.com", PasswordHash: "hash", CreatedAt: now},
		&models.User{ID: "user-2", Email: "two@example.com", PasswordHash: "hash", CreatedAt: now},
		&models.Workspace{ID: "workspace-1", Name: "One", CreatedAt: now},
		&models.Workspace{ID: "workspace-2", Name: "Two", CreatedAt: now},
		&models.Workspace{ID: "workspace-outside", Name: "Outside", CreatedAt: now},
		&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin},
		&models.WorkspaceMember{WorkspaceID: "workspace-2", UserID: "user-1", Role: models.WorkspaceRoleViewer},
		&models.WorkspaceMember{WorkspaceID: "workspace-outside", UserID: "user-2", Role: models.WorkspaceRoleAdmin},
		&models.UserNotification{ID: "workspace-one", UserID: "user-1", WorkspaceID: "workspace-1", Type: "post_published", Title: "One", CreatedAt: now},
		&models.UserNotification{ID: "workspace-two", UserID: "user-1", WorkspaceID: "workspace-2", Type: "post_published", Title: "Two", CreatedAt: now.Add(-time.Minute)},
		&models.UserNotification{ID: "account-wide", UserID: "user-1", Type: "workspace_invite", Title: "Account", CreatedAt: now.Add(-2 * time.Minute)},
		&models.UserNotification{ID: "other-user", UserID: "user-2", WorkspaceID: "workspace-1", Type: "post_published", Title: "Other", CreatedAt: now},
	} {
		_, err := s.db.NewInsert().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
}

func notificationRow(t *testing.T, db *bun.DB, id string) models.UserNotification {
	t.Helper()
	var row models.UserNotification
	require.NoError(t, db.NewSelect().Model(&row).Where("id = ?", id).Scan(t.Context()))
	return row
}

func notificationCount(t *testing.T, db *bun.DB, id string) int {
	t.Helper()
	count, err := db.NewSelect().Model((*models.UserNotification)(nil)).Where("id = ?", id).Count(t.Context())
	require.NoError(t, err)
	return int(count)
}

func TestNotificationBulkActionsAreAuthorizedAndWorkspaceScoped(t *testing.T) {
	t.Parallel()
	server := newNotificationTestServer(t)
	server.seed(t)

	mark := jsonRequest(t, server.echo, http.MethodPost, "/api/v1/notifications/read", map[string]any{
		"workspace_id": "workspace-1",
		"all":          true,
	}, "web-token")
	require.Equal(t, http.StatusNoContent, mark.Code, mark.Body.String())
	require.False(t, notificationRow(t, server.db, "workspace-one").ReadAt.IsZero())
	require.False(t, notificationRow(t, server.db, "account-wide").ReadAt.IsZero())
	require.True(t, notificationRow(t, server.db, "workspace-two").ReadAt.IsZero())
	require.True(t, notificationRow(t, server.db, "other-user").ReadAt.IsZero())

	remove := jsonRequest(t, server.echo, http.MethodPost, "/api/v1/notifications/delete", map[string]any{
		"workspace_id": "workspace-1",
		"all":          true,
	}, "web-token")
	require.Equal(t, http.StatusNoContent, remove.Code, remove.Body.String())
	require.Zero(t, notificationCount(t, server.db, "workspace-one"))
	require.Zero(t, notificationCount(t, server.db, "account-wide"))
	require.Equal(t, 1, notificationCount(t, server.db, "workspace-two"))
	require.Equal(t, 1, notificationCount(t, server.db, "other-user"))
}

func TestNotificationChangesRejectMissingUnauthorizedAndCrossWorkspaceScopes(t *testing.T) {
	t.Parallel()
	server := newNotificationTestServer(t)
	server.seed(t)

	missing := jsonRequest(t, server.echo, http.MethodPost, "/api/v1/notifications/read", map[string]any{
		"all": true,
	}, "web-token")
	require.Equal(t, http.StatusUnprocessableEntity, missing.Code, missing.Body.String())

	empty := jsonRequest(t, server.echo, http.MethodPost, "/api/v1/notifications/delete", map[string]any{
		"workspace_id": "  ",
		"all":          true,
	}, "web-token")
	require.Equal(t, http.StatusBadRequest, empty.Code, empty.Body.String())

	unauthorized := jsonRequest(t, server.echo, http.MethodPost, "/api/v1/notifications/read", map[string]any{
		"workspace_id": "workspace-outside",
		"all":          true,
	}, "web-token")
	require.Equal(t, http.StatusForbidden, unauthorized.Code, unauthorized.Body.String())

	crossWorkspaceID := jsonRequest(t, server.echo, http.MethodPost, "/api/v1/notifications/delete", map[string]any{
		"workspace_id": "workspace-1",
		"ids":          []string{"workspace-two"},
	}, "web-token")
	require.Equal(t, http.StatusNoContent, crossWorkspaceID.Code, crossWorkspaceID.Body.String())

	for _, id := range []string{"workspace-one", "workspace-two", "account-wide", "other-user"} {
		require.Equal(t, 1, notificationCount(t, server.db, id), id)
	}
}

func TestNotificationChangesHonorAPITokenWorkspaceBoundary(t *testing.T) {
	t.Parallel()
	server := newNotificationTestServerWithAuthenticator(t, workspaceTestAuthenticator{
		"workspace-token": {UserID: "user-1", Email: "one@example.com", WorkspaceID: "workspace-1"},
	})
	server.seed(t)

	outsideTokenScope := jsonRequest(t, server.echo, http.MethodPost, "/api/v1/notifications/read", map[string]any{
		"workspace_id": "workspace-2",
		"all":          true,
	}, "workspace-token")
	require.Equal(t, http.StatusForbidden, outsideTokenScope.Code, outsideTokenScope.Body.String())
	require.True(t, notificationRow(t, server.db, "workspace-two").ReadAt.IsZero())
}
