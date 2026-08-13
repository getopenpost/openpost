package workspaceaccess

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

// Member returns an active workspace membership. Inactive members must not be
// treated as authorized by API, OAuth, MCP, notification, or background-job
// paths.
func Member(ctx context.Context, db bun.IDB, workspaceID, userID string) (models.WorkspaceMember, bool, error) {
	var member models.WorkspaceMember
	err := db.NewSelect().
		Model(&member).
		Where("workspace_id = ? AND user_id = ? AND status = ?", strings.TrimSpace(workspaceID), strings.TrimSpace(userID), models.WorkspaceMemberStatusActive).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return models.WorkspaceMember{}, false, nil
	}
	if err != nil {
		return models.WorkspaceMember{}, false, err
	}
	return member, true, nil
}

func Allows(ctx context.Context, db bun.IDB, workspaceID, userID string) (bool, error) {
	_, ok, err := Member(ctx, db, workspaceID, userID)
	return ok, err
}

func IsAdmin(ctx context.Context, db bun.IDB, workspaceID, userID string) (bool, error) {
	member, ok, err := Member(ctx, db, workspaceID, userID)
	if err != nil || !ok {
		return false, err
	}
	return member.Role == models.WorkspaceRoleAdmin, nil
}
