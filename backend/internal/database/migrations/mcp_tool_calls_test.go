package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesMCPToolCallsSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, RunMigrations(db))

	row := db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'mcp_tool_calls'")
	var schema string
	require.NoError(t, row.Scan(&schema))
	require.Contains(t, schema, "tool_name TEXT NOT NULL")
	require.Contains(t, schema, "duration_ms INTEGER NOT NULL DEFAULT 0")
	require.Contains(t, schema, "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL")
	require.Contains(t, schema, "client_id TEXT")
	require.Contains(t, schema, "client_name TEXT")
	require.Contains(t, schema, "client_scope TEXT")
	require.Contains(t, schema, "client_token_prefix TEXT")

	var indexCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("sqlite_master").
		Where("type = 'index' AND name IN ('mcp_tool_calls_user_created_idx', 'mcp_tool_calls_workspace_created_idx', 'mcp_tool_calls_tool_status_idx', 'mcp_tool_calls_client_created_idx')").
		Scan(ctx, &indexCount))
	require.Equal(t, 4, indexCount)
}

func TestRunMigrationsMCPToolCallsNullWorkspaceOnDelete(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, RunMigrations(db))

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
