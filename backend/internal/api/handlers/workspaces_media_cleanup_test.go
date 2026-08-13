package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestWorkspaceSettingsMediaCleanupDaysIsDeprecatedAndFixed(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.Workspace)(nil), (*models.WorkspaceMember)(nil))
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.Workspace{
		ID: "workspace-1", Name: "Workspace", Timezone: "UTC", WeekStart: 1, CreatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), "UPDATE workspaces SET media_cleanup_days = 365 WHERE id = ?", "workspace-1")
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewWorkspaceHandler(db, testAuthenticator{})
	handler.GetWorkspaceSettings(api)
	handler.UpdateWorkspaceSettings(api)
	for _, schemaName := range []string{
		"GetWorkspaceSettingsOutputBody",
		"UpdateWorkspaceSettingsInputBody",
		"UpdateWorkspaceSettingsOutputBody",
	} {
		schema := api.OpenAPI().Components.Schemas.Map()[schemaName]
		require.NotNil(t, schema, schemaName)
		cleanup := schema.Properties["media_cleanup_days"]
		require.NotNil(t, cleanup, schemaName)
		require.True(t, cleanup.Deprecated, "%s must mark media_cleanup_days deprecated", schemaName)
		require.Contains(t, cleanup.Description, "Deprecated")
		if schemaName != "UpdateWorkspaceSettingsInputBody" {
			require.Len(t, cleanup.Enum, 1, schemaName)
			require.EqualValues(t, 14, cleanup.Enum[0], schemaName)
			require.EqualValues(t, 14, cleanup.Default, schemaName)
		}
	}

	get := jsonRequest(t, e, http.MethodGet, "/api/v1/workspaces/workspace-1/settings", nil, "web-token")
	require.Equal(t, http.StatusOK, get.Code, get.Body.String())
	var initial map[string]any
	require.NoError(t, json.Unmarshal(get.Body.Bytes(), &initial))
	require.EqualValues(t, 14, initial["media_cleanup_days"])

	update := jsonRequest(t, e, http.MethodPatch, "/api/v1/workspaces/workspace-1/settings", map[string]any{
		"media_cleanup_days": 0,
		"timezone":           "Europe/Lisbon",
	}, "web-token")
	require.Equal(t, http.StatusOK, update.Code, update.Body.String())
	var updated map[string]any
	require.NoError(t, json.Unmarshal(update.Body.Bytes(), &updated))
	require.EqualValues(t, 14, updated["media_cleanup_days"])
	require.Equal(t, "Europe/Lisbon", updated["timezone"])

	var stored struct {
		Timezone string `bun:"timezone"`
		Legacy   int    `bun:"media_cleanup_days"`
	}
	require.NoError(t, db.NewSelect().Table("workspaces").Column("timezone", "media_cleanup_days").Where("id = ?", "workspace-1").Scan(context.Background(), &stored))
	require.Equal(t, "Europe/Lisbon", stored.Timezone)
	require.Equal(t, 365, stored.Legacy, "deprecated client input must not alter the ignored tombstone column")
}
