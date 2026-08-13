package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func newDeleteWorkspaceTestServer(t *testing.T) *workspaceTestServer {
	t.Helper()
	db, err := database.InitDB("file:" + t.TempDir() + "/delete-workspace.db?mode=rwc")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewWorkspaceHandler(db, testAuthenticator{}, entitlements.NewSelfHostedService())
	handler.SetFrontendURL("https://app.openpost.test")
	handler.ListWorkspaces(api)
	handler.DeleteWorkspace(api)

	return &workspaceTestServer{echo: e, db: db}
}

func insertDeleteFixture(t *testing.T, db *bun.DB) {
	t.Helper()
	ctx := t.Context()
	now := time.Now().UTC()
	for _, model := range []any{
		&models.User{ID: "user-1", Email: "user-1@example.com", CreatedAt: now},
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
	return count
}

func TestDeleteWorkspaceRemovesWorkspaceContent(t *testing.T) {
	t.Parallel()
	server := newDeleteWorkspaceTestServer(t)
	ctx := t.Context()
	insertDeleteFixture(t, server.db)

	_, err := server.db.NewInsert().Model(&models.MediaAttachment{
		ID: "media-1", WorkspaceID: "workspace-1", FilePath: "/tmp/media-one.png",
		MimeType: "image/png", CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.UserNotification{
		ID: "notification-1", UserID: "user-1", WorkspaceID: "workspace-1",
		Type: "publish_failed", Title: "Publishing failed", Body: "Draft content",
		CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	for _, job := range []*models.Job{
		{
			ID: "cleanup-workspace-1", Type: "media_cleanup", ScopeID: "workspace-1", DedupeKey: "daily",
			Payload: `{"workspace_id":"workspace-1"}`, Status: "pending", RunAt: time.Now().UTC(), MaxAttempts: 3,
		},
		{
			ID: "cleanup-workspace-2", Type: "media_cleanup", ScopeID: "workspace-2", DedupeKey: "daily",
			Payload: `{"workspace_id":"workspace-2"}`, Status: "pending", RunAt: time.Now().UTC(), MaxAttempts: 3,
		},
	} {
		_, err = server.db.NewInsert().Model(job).Exec(ctx)
		require.NoError(t, err)
	}

	rec := jsonRequest(t, server.echo, http.MethodDelete, "/api/v1/workspaces/workspace-1", nil, "web-token")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.Contains(t, rec.Body.String(), `"deleted":true`)

	require.Zero(t, countRows[models.Workspace](t, server.db, "id = ?", "workspace-1"))
	require.Zero(t, countRows[models.WorkspaceMember](t, server.db, "workspace_id = ?", "workspace-1"))
	require.Zero(t, countRows[models.MediaAttachment](t, server.db, "id = ?", "media-1"))
	require.Zero(t, countRows[models.UserNotification](t, server.db, "id = ?", "notification-1"))
	require.Equal(t, 1, countRows[models.Job](t, server.db, "type = ?", "storage_delete"))
	require.Zero(t, countRows[models.Job](t, server.db, "id = ?", "cleanup-workspace-1"))
	require.Equal(t, 1, countRows[models.Job](t, server.db, "id = ?", "cleanup-workspace-2"))
	require.Equal(t, 1, countRows[models.Workspace](t, server.db, ""))
}

func TestEnqueueStorageCleanupBatchesWorkerSizedPayloads(t *testing.T) {
	t.Parallel()
	server := newDeleteWorkspaceTestServer(t)
	keys := make([]string, storageCleanupBatchSize+1)
	for index := range keys {
		keys[index] = fmt.Sprintf("media/%05d.bin", index)
	}

	err := server.db.RunInTx(t.Context(), &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		jobIDs, err := enqueueStorageCleanup(ctx, tx, keys)
		if err != nil {
			return err
		}
		require.Len(t, jobIDs, 2)
		return nil
	})
	require.NoError(t, err)

	var jobs []models.Job
	require.NoError(t, server.db.NewSelect().Model(&jobs).Where("type = ?", "storage_delete").Scan(t.Context()))
	require.Len(t, jobs, 2)
	batchSizes := make([]int, 0, len(jobs))
	for _, job := range jobs {
		var payload struct {
			Keys []string `json:"keys"`
		}
		require.NoError(t, json.Unmarshal([]byte(job.Payload), &payload))
		require.NotEmpty(t, payload.Keys)
		require.LessOrEqual(t, len(payload.Keys), storageCleanupBatchSize)
		batchSizes = append(batchSizes, len(payload.Keys))
	}
	sort.Ints(batchSizes)
	require.Equal(t, []int{1, storageCleanupBatchSize}, batchSizes)
}

func TestDeleteWorkspaceRejectsLastWorkspace(t *testing.T) {
	t.Parallel()
	server := newDeleteWorkspaceTestServer(t)
	ctx := t.Context()
	insertDeleteFixture(t, server.db)

	// Remove the second workspace so this is the user's only workspace.
	_, err := server.db.NewDelete().Model((*models.Workspace)(nil)).Where("id = ?", "workspace-2").Exec(ctx)
	require.NoError(t, err)
	_, err = server.db.NewDelete().Model((*models.WorkspaceMember)(nil)).
		Where("workspace_id = ?", "workspace-2").Exec(ctx)
	require.NoError(t, err)

	rec := jsonRequest(t, server.echo, http.MethodDelete, "/api/v1/workspaces/workspace-1", nil, "web-token")
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())

	require.Equal(t, 1, countRows[models.Workspace](t, server.db, ""))
}
