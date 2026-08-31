package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsMCPToolCallsNullWorkspaceOnDelete(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-mcp", Name: "MCP"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO mcp_tool_calls (id, user_id, workspace_id, tool_name, status, duration_ms)
		VALUES ('call-1', 'user-1', 'ws-mcp', 'list_accounts', 'success', 12)
	`)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, "DELETE FROM workspaces WHERE id = ?", "ws-mcp")
	require.NoError(t, err)

	var workspaceID *string
	require.NoError(t, db.NewSelect().
		ColumnExpr("workspace_id").
		TableExpr("mcp_tool_calls").
		Where("id = ?", "call-1").
		Scan(ctx, &workspaceID))
	require.Nil(t, workspaceID)
}
