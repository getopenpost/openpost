package workspaceaccess

import (
	"context"
	"database/sql"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	_ "github.com/uptrace/bun/driver/sqliteshim"
)

func TestInactiveMemberHasNoWorkspaceAccess(t *testing.T) {
	sqlDB, err := sql.Open("sqliteshim", "file:workspace-access?mode=memory&cache=shared")
	require.NoError(t, err)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	_, err = db.NewCreateTable().Model((*models.WorkspaceMember)(nil)).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
		Status:      models.WorkspaceMemberStatusInactive,
	}).Exec(context.Background())
	require.NoError(t, err)

	allowed, err := Allows(context.Background(), db, "workspace-1", "user-1")
	require.NoError(t, err)
	require.False(t, allowed)
	admin, err := IsAdmin(context.Background(), db, "workspace-1", "user-1")
	require.NoError(t, err)
	require.False(t, admin)
}
