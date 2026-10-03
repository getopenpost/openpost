package handlers

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/postimport"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestPostImportsCanBeEnabledReadAndDisabledWithinWorkspace(t *testing.T) {
	modelsToCreate := []any{
		(*models.User)(nil), (*models.Workspace)(nil), (*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil), (*models.PostImportState)(nil),
		(*models.ImportedPost)(nil), (*models.Job)(nil),
	}
	t.Run("sqlite", func(t *testing.T) {
		testPostImportsLifecycle(t, createHandlerTestDB(t, modelsToCreate...))
	})
	t.Run("postgres", func(t *testing.T) {
		dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
		if dsn == "" {
			t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
		}
		db := bun.NewDB(sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn))), pgdialect.New())
		db.SetMaxOpenConns(1)
		t.Cleanup(func() { require.NoError(t, db.Close()) })
		schema := fmt.Sprintf("post_imports_%d", time.Now().UnixNano())
		_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
		require.NoError(t, err)
		t.Cleanup(func() {
			_, err := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
			require.NoError(t, err)
		})
		_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
		require.NoError(t, err)
		for _, model := range modelsToCreate {
			_, err = db.NewCreateTable().Model(model).Exec(t.Context())
			require.NoError(t, err)
		}
		testPostImportsLifecycle(t, db)
	})
}

func testPostImportsLifecycle(t *testing.T, db *bun.DB) {
	t.Helper()
	ctx := t.Context()
	now := time.Now().UTC()
	for _, row := range []any{
		&models.User{ID: "user-1", Email: "user@example.com"},
		&models.Workspace{ID: "workspace-1", OrganizationID: "org-1", Name: "One"},
		&models.Workspace{ID: "workspace-2", OrganizationID: "org-1", Name: "Two"},
		&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleEditor, Status: models.WorkspaceMemberStatusActive},
		&models.WorkspaceMember{WorkspaceID: "workspace-2", UserID: "user-1", Role: models.WorkspaceRoleEditor, Status: models.WorkspaceMemberStatusActive},
		&models.SocialAccount{ID: "account-1", WorkspaceID: "workspace-1", Slug: "bluesky", Platform: "bluesky", AccountID: "did:plc:owner", AccessTokenEnc: []byte("encrypted"), IsActive: true, CreatedAt: now},
	} {
		_, err := db.NewInsert().Model(row).Exec(ctx)
		require.NoError(t, err)
	}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPostImportHandler(db, postimport.NewService(db, nil), testAuthenticator{}).RegisterRoutes(api)
	request := func(method, path string, body any) *httptest.ResponseRecorder {
		var data bytes.Buffer
		if body != nil {
			require.NoError(t, json.NewEncoder(&data).Encode(body))
		}
		req := httptest.NewRequestWithContext(ctx, method, path, &data)
		req.Header.Set("Authorization", "Bearer web-token")
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		e.ServeHTTP(res, req)
		return res
	}
	path := "/api/v1/accounts/account-1/post-imports?workspace_id=workspace-1"
	var overview struct {
		Supported  bool   `json:"supported"`
		Enabled    bool   `json:"enabled"`
		NextCursor string `json:"next_cursor"`
		Posts      []struct {
			ID string `json:"id"`
		} `json:"posts"`
	}
	res := request(http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &overview))
	require.True(t, overview.Supported)
	require.False(t, overview.Enabled)

	res = request(http.MethodPut, "/api/v1/accounts/account-1/post-imports", map[string]any{"workspace_id": "workspace-1", "enabled": true})
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	state := &models.PostImportState{}
	require.NoError(t, db.NewSelect().Model(state).Where("social_account_id = ?", "account-1").Scan(ctx))
	require.True(t, state.Enabled)
	jobs, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", postimport.JobTypeSync).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, jobs)
	firstWatermark := state.ImportWatermark
	res = request(http.MethodPut, "/api/v1/accounts/account-1/post-imports", map[string]any{"workspace_id": "workspace-1", "enabled": true})
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	require.NoError(t, db.NewSelect().Model(state).Where("social_account_id = ?", "account-1").Scan(ctx))
	require.Equal(t, firstWatermark, state.ImportWatermark)

	_, err = db.NewInsert().Model(&models.ImportedPost{
		ID: "import-1", WorkspaceID: "workspace-1", SocialAccountID: "account-1", Platform: "bluesky",
		ProviderPostID: "native-1", PublishedAt: now, Origin: "external", FirstSeenAt: now, LastSeenAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	res = request(http.MethodPut, "/api/v1/accounts/account-1/post-imports", map[string]any{"workspace_id": "workspace-1", "enabled": false})
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	res = request(http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &overview))
	require.False(t, overview.Enabled)
	require.Len(t, overview.Posts, 1)
	require.Equal(t, "import-1", overview.Posts[0].ID)
	for _, id := range []string{"import-2", "import-3"} {
		_, err = db.NewInsert().Model(&models.ImportedPost{
			ID: id, WorkspaceID: "workspace-1", SocialAccountID: "account-1", Platform: "bluesky",
			ProviderPostID: id, PublishedAt: now, Origin: "external", FirstSeenAt: now, LastSeenAt: now,
		}).Exec(ctx)
		require.NoError(t, err)
	}
	res = request(http.MethodGet, path+"&limit=2", nil)
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &overview))
	require.Len(t, overview.Posts, 2)
	require.NotEmpty(t, overview.NextCursor)
	res = request(http.MethodGet, path+"&limit=2&cursor="+overview.NextCursor, nil)
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	overview.NextCursor = ""
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &overview))
	require.Len(t, overview.Posts, 1)
	require.Equal(t, "import-1", overview.Posts[0].ID)
	require.Empty(t, overview.NextCursor)
	// Re-enabling retains the read-only library and starts a new opt-in window.
	res = request(http.MethodPut, "/api/v1/accounts/account-1/post-imports", map[string]any{"workspace_id": "workspace-1", "enabled": true})
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &overview))
	require.True(t, overview.Enabled)
	require.Len(t, overview.Posts, 3)
	require.NoError(t, db.NewSelect().Model(state).Where("social_account_id = ?", "account-1").Scan(ctx))
	require.True(t, state.ImportWatermark.After(firstWatermark))

	res = request(http.MethodGet, path+"&cursor=invalid!", nil)
	require.Equal(t, http.StatusBadRequest, res.Code)

	res = request(http.MethodGet, "/api/v1/accounts/account-1/post-imports?workspace_id=workspace-2", nil)
	require.Equal(t, http.StatusNotFound, res.Code, res.Body.String())
}
