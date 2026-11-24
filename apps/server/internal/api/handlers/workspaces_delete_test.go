package handlers

import (
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/workspacedeletion"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func newDeleteWorkspaceTestServer(t *testing.T) *workspaceTestServer {
	t.Helper()
	db := newHandlerSchemaTestDB(t)

	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	authService := auth.NewService("workspace-delete-test")
	handler := NewWorkspaceHandler(db, testAuthenticator{}, entitlements.NewSelfHostedService())
	handler.SetSensitiveActionServices(authService, nil)
	handler.SetFrontendURL("https://app.openpost.test")
	handler.ListWorkspaces(api)
	handler.GetWorkspaceDeletionPreview(api)
	handler.DeleteWorkspace(api)

	return &workspaceTestServer{echo: e, db: db}
}

func insertDeleteFixture(t *testing.T, db *bun.DB) {
	t.Helper()
	ctx := t.Context()
	now := time.Now().UTC()
	passwordHash, err := auth.NewService("workspace-delete-test").HashPassword("current-password-123")
	require.NoError(t, err)
	for _, model := range []any{
		&models.User{ID: "user-1", Email: "user-1@example.com", PasswordHash: passwordHash, CreatedAt: now},
		&models.Organization{ID: "org-1", Name: "Org", CreatedByID: "user-1", CreatedAt: now, UpdatedAt: now},
		&models.OrganizationMember{OrganizationID: "org-1", UserID: "user-1", Role: models.OrganizationRoleOwner, CreatedAt: now},
		&models.Workspace{ID: "workspace-1", OrganizationID: "org-1", Name: "One", Timezone: "UTC", CreatedAt: now},
		&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin},
		&models.Workspace{ID: "workspace-2", OrganizationID: "org-1", Name: "Two", Timezone: "UTC", CreatedAt: now},
		&models.WorkspaceMember{WorkspaceID: "workspace-2", UserID: "user-1", Role: models.WorkspaceRoleAdmin},
	} {
		_, err := db.NewInsert().Model(model).Exec(ctx)
		require.NoError(t, err)
	}
}

func countRows[T any](t *testing.T, db *bun.DB, where string, args ...any) int {
	t.Helper()
	var model T
	query := db.NewSelect().Model(&model)
	if where != "" {
		query = query.Where(where, args...)
	}
	count, err := query.Count(t.Context())
	require.NoError(t, err)
	return int(count)
}

func TestWorkspaceDeletionRequiresOrganizationOwner(t *testing.T) {
	t.Parallel()
	server := newDeleteWorkspaceTestServer(t)
	insertDeleteFixture(t, server.db)
	_, err := server.db.NewUpdate().Model((*models.OrganizationMember)(nil)).
		Set("role = ?", models.OrganizationRoleAdmin).
		Where("organization_id = ? AND user_id = ?", "org-1", "user-1").Exec(t.Context())
	require.NoError(t, err)

	preview := jsonRequest(t, server.echo, http.MethodGet, "/api/v1/workspaces/workspace-1/deletion-preview", nil, "web-token")
	require.Equal(t, http.StatusForbidden, preview.Code, preview.Body.String())
	deleted := jsonRequest(t, server.echo, http.MethodDelete, "/api/v1/workspaces/workspace-1", map[string]any{
		"confirm_name": "One", "current_password": "current-password-123",
	}, "web-token")
	require.Equal(t, http.StatusForbidden, deleted.Code, deleted.Body.String())
	require.Equal(t, 1, countRows[models.Workspace](t, server.db, "id = ?", "workspace-1"))
}

func TestConcurrentWorkspaceDeletionKeepsFinalWorkspace(t *testing.T) {
	t.Parallel()
	server := newDeleteWorkspaceTestServer(t)
	insertDeleteFixture(t, server.db)
	service := workspacedeletion.NewService(server.db, auth.NewService("workspace-delete-test"), nil)
	actor := workspacedeletion.Actor{UserID: "user-1"}
	start := make(chan struct{})
	errorsByWorkspace := make(chan error, 2)
	var workers sync.WaitGroup
	for _, target := range []struct{ id, name string }{{"workspace-1", "One"}, {"workspace-2", "Two"}} {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			errorsByWorkspace <- service.Delete(t.Context(), target.id, actor, workspacedeletion.Confirmation{CanonicalName: target.name, CurrentPassword: "current-password-123"})
		}()
	}
	close(start)
	workers.Wait()
	close(errorsByWorkspace)

	require.Equal(t, 1, countRows[models.Workspace](t, server.db, "organization_id = ?", "org-1"))
}
