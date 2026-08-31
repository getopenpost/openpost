package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/workspacedeletion"
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
	_, err = server.db.ExecContext(ctx, `INSERT INTO publication_builds (
		id, workspace_id, created_by_id, state, phase, idempotency_key,
		request_fingerprint, authority_json, request_json
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"build-workspace-1", "workspace-1", "user-1", "queued", "queued",
		"workspace-delete-build", "fingerprint", `{}`, `{"input":{}}`)
	require.NoError(t, err)
	for _, job := range []*models.Job{
		{
			ID: "cleanup-workspace-1", Type: "media_cleanup", ScopeID: "workspace-1", DedupeKey: "daily",
			Payload: `{"workspace_id":"workspace-1"}`, Status: "completed", RunAt: time.Now().UTC(), MaxAttempts: 3,
		},
		{
			ID: "cleanup-workspace-2", Type: "media_cleanup", ScopeID: "workspace-2", DedupeKey: "daily",
			Payload: `{"workspace_id":"workspace-2"}`, Status: "pending", RunAt: time.Now().UTC(), MaxAttempts: 3,
		},
		{
			ID: "publication-build-workspace-1", Type: "publication_build", ScopeID: "build-workspace-1", DedupeKey: "execute",
			Payload: `{"build_id":"build-workspace-1"}`, Status: "completed", RunAt: time.Now().UTC(), MaxAttempts: 2,
		},
	} {
		_, err = server.db.NewInsert().Model(job).Exec(ctx)
		require.NoError(t, err)
	}

	rec := jsonRequest(t, server.echo, http.MethodDelete, "/api/v1/workspaces/workspace-1", map[string]any{
		"confirm_name": "One", "current_password": "current-password-123",
	}, "web-token")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.Contains(t, rec.Body.String(), `"deleted":true`)

	require.Zero(t, countRows[models.Workspace](t, server.db, "id = ?", "workspace-1"))
	require.Zero(t, countRows[models.WorkspaceMember](t, server.db, "workspace_id = ?", "workspace-1"))
	require.Zero(t, countRows[models.MediaAttachment](t, server.db, "id = ?", "media-1"))
	require.Zero(t, countRows[models.UserNotification](t, server.db, "id = ?", "notification-1"))
	require.Equal(t, 1, countRows[models.Job](t, server.db, "type = ?", "storage_delete"))
	require.Zero(t, countRows[models.Job](t, server.db, "id = ?", "cleanup-workspace-1"))
	require.Zero(t, countRows[models.Job](t, server.db, "id = ?", "publication-build-workspace-1"))
	require.Equal(t, 1, countRows[models.Job](t, server.db, "id = ?", "cleanup-workspace-2"))
	require.Equal(t, 1, countRows[models.Workspace](t, server.db, ""))
}

func TestEnqueueStorageCleanupBatchesWorkerSizedPayloads(t *testing.T) {
	t.Parallel()
	server := newDeleteWorkspaceTestServer(t)
	keys := make([]string, workspacedeletion.StorageCleanupBatchSize+1)
	for index := range keys {
		keys[index] = fmt.Sprintf("media/%05d.bin", index)
	}

	err := server.db.RunInTx(t.Context(), &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		jobIDs, err := workspacedeletion.EnqueueStorageCleanup(ctx, tx, keys)
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
		require.LessOrEqual(t, len(payload.Keys), workspacedeletion.StorageCleanupBatchSize)
		batchSizes = append(batchSizes, len(payload.Keys))
	}
	sort.Ints(batchSizes)
	require.Equal(t, []int{1, workspacedeletion.StorageCleanupBatchSize}, batchSizes)
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

	rec := jsonRequest(t, server.echo, http.MethodDelete, "/api/v1/workspaces/workspace-1", map[string]any{
		"confirm_name": "One", "current_password": "current-password-123",
	}, "web-token")
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())

	require.Equal(t, 1, countRows[models.Workspace](t, server.db, ""))
}

func TestWorkspaceDeletionPreviewExplainsImpactRetentionRecoveryAndBlockers(t *testing.T) {
	t.Parallel()
	server := newDeleteWorkspaceTestServer(t)
	insertDeleteFixture(t, server.db)

	rec := jsonRequest(t, server.echo, http.MethodGet, "/api/v1/workspaces/workspace-1/deletion-preview", nil, "web-token")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.JSONEq(t, `{
		"$schema":"https://example.com/schemas/WorkspaceDeletionPreview.json",
		"workspace_id":"workspace-1",
		"workspace_name":"One",
		"removed":["access","content","connected_assets"],
		"retained":["required_records"],
		"recovery_possible":false,
		"blockers":[]
	}`, rec.Body.String())
}

func TestDeleteWorkspaceRequiresCanonicalNameAndRecentAuthentication(t *testing.T) {
	t.Parallel()
	server := newDeleteWorkspaceTestServer(t)
	insertDeleteFixture(t, server.db)

	wrongName := jsonRequest(t, server.echo, http.MethodDelete, "/api/v1/workspaces/workspace-1", map[string]any{
		"confirm_name": "one", "current_password": "current-password-123",
	}, "web-token")
	require.Equal(t, http.StatusBadRequest, wrongName.Code, wrongName.Body.String())

	wrongPassword := jsonRequest(t, server.echo, http.MethodDelete, "/api/v1/workspaces/workspace-1", map[string]any{
		"confirm_name": "One", "current_password": "wrong-password",
	}, "web-token")
	require.Equal(t, http.StatusUnauthorized, wrongPassword.Code, wrongPassword.Body.String())
	require.Equal(t, 1, countRows[models.Workspace](t, server.db, "id = ?", "workspace-1"))
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

func TestWorkspaceDeletionPreviewReportsBillingAndCleanupBlockers(t *testing.T) {
	t.Parallel()
	server := newDeleteWorkspaceTestServer(t)
	insertDeleteFixture(t, server.db)
	_, err := server.db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID: "org-1", WorkspaceID: "workspace-1", Provider: models.BillingProviderPaddle,
		ProviderCustomerID: "customer-1", ProviderSubscriptionID: "subscription-1", Status: "active",
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.MediaAttachment{
		ID: "media-cleanup", WorkspaceID: "workspace-1", FilePath: "/uploads/object-key.jpg", ThumbnailsJSON: "{}",
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.Job{
		ID: "cleanup-active", Type: "storage_delete", ScopeID: "object-cleanup", Payload: `{"keys":["object-key.jpg"]}`,
		Status: "pending", RunAt: time.Now().UTC().Add(time.Hour), MaxAttempts: 3,
	}).Exec(t.Context())
	require.NoError(t, err)

	preview := jsonRequest(t, server.echo, http.MethodGet, "/api/v1/workspaces/workspace-1/deletion-preview", nil, "web-token")
	require.Equal(t, http.StatusOK, preview.Code, preview.Body.String())
	require.Contains(t, preview.Body.String(), `"code":"active_billing"`)
	require.Contains(t, preview.Body.String(), `"code":"pending_cleanup"`)
}

func TestWorkspaceDeletionFindsJobsScopedThroughWorkspaceChildren(t *testing.T) {
	t.Parallel()
	server := newDeleteWorkspaceTestServer(t)
	insertDeleteFixture(t, server.db)
	_, err := server.db.NewInsert().Model(&models.Publication{
		ID: "publication-child", WorkspaceID: "workspace-1", CreatedByID: "user-1", Title: "Queued", SourceContent: "Queued", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.Job{
		ID: "publish-child", Type: "publish_publication", ScopeID: "publication-child", Payload: `{"publication_id":"publication-child"}`,
		Status: "pending", RunAt: time.Now().UTC().Add(time.Hour), MaxAttempts: 3,
	}).Exec(t.Context())
	require.NoError(t, err)

	preview := jsonRequest(t, server.echo, http.MethodGet, "/api/v1/workspaces/workspace-1/deletion-preview", nil, "web-token")
	require.Equal(t, http.StatusOK, preview.Code, preview.Body.String())
	require.Contains(t, preview.Body.String(), `"code":"pending_external_writes"`)
}

func TestConcurrentWorkspaceDeletionKeepsFinalWorkspace(t *testing.T) {
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

func TestWorkspaceDeletionBlockersAreActionableAndLeaveDataIntact(t *testing.T) {
	t.Parallel()
	server := newDeleteWorkspaceTestServer(t)
	insertDeleteFixture(t, server.db)

	_, err := server.db.NewInsert().Model(&models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Slug: "x-owner", Platform: "x", AccountID: "remote-1",
		AccountUsername: "owner", AccessTokenEnc: []byte("encrypted"), CreatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.ProviderWriteAttempt{
		ID: "write-1", OperationID: "operation-1", AttemptNumber: 1, WorkspaceID: "workspace-1",
		SocialAccountID: "account-1", TargetKey: "x", Provider: "x", Operation: "publish",
		PayloadFingerprint: "sha256:fingerprint", Status: "sending", SubmissionState: "unknown", RetrySafety: "never",
	}).Exec(t.Context())
	require.NoError(t, err)

	preview := jsonRequest(t, server.echo, http.MethodGet, "/api/v1/workspaces/workspace-1/deletion-preview", nil, "web-token")
	require.Equal(t, http.StatusOK, preview.Code, preview.Body.String())
	require.Contains(t, preview.Body.String(), `"code":"pending_external_writes"`)
	require.Contains(t, preview.Body.String(), "Wait for publishing and provider actions")

	deleted := jsonRequest(t, server.echo, http.MethodDelete, "/api/v1/workspaces/workspace-1", map[string]any{
		"confirm_name": "One", "current_password": "current-password-123",
	}, "web-token")
	require.Equal(t, http.StatusConflict, deleted.Code, deleted.Body.String())
	require.Contains(t, deleted.Body.String(), "Wait for publishing and provider actions")
	require.Equal(t, 1, countRows[models.Workspace](t, server.db, "id = ?", "workspace-1"))
}

func TestDeleteWorkspaceRetainsOrganizationAuditEvidence(t *testing.T) {
	t.Parallel()
	server := newDeleteWorkspaceTestServer(t)
	insertDeleteFixture(t, server.db)

	rec := jsonRequest(t, server.echo, http.MethodDelete, "/api/v1/workspaces/workspace-1", map[string]any{
		"confirm_name": "One", "current_password": "current-password-123",
	}, "web-token")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var event models.WorkspaceLifecycleAuditEvent
	require.NoError(t, server.db.NewSelect().Model(&event).Where("workspace_id = ?", "workspace-1").Scan(t.Context()))
	require.Equal(t, "org-1", event.OrganizationID)
	require.Equal(t, "user-1", event.ActorUserID)
	require.Equal(t, "workspace.deleted", event.Action)
	require.Equal(t, "One", event.WorkspaceName)
}
