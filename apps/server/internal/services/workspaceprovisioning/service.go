package workspaceprovisioning

import (
	"context"
	"errors"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/voiceprofiles"
	"github.com/uptrace/bun"
)

type Boundary struct {
	Organization       *models.Organization
	OrganizationMember *models.OrganizationMember
	Workspace          *models.Workspace
	WorkspaceMember    *models.WorkspaceMember
}

// Create inserts a workspace and every invariant owned by its creation
// boundary. The caller controls the surrounding transaction.
func Create(ctx context.Context, db bun.IDB, boundary Boundary) error {
	if boundary.Workspace == nil || boundary.WorkspaceMember == nil {
		return errors.New("workspace and workspace member are required")
	}
	if boundary.Organization != nil {
		if _, err := db.NewInsert().Model(boundary.Organization).Exec(ctx); err != nil {
			return err
		}
	}
	if boundary.OrganizationMember != nil {
		if _, err := db.NewInsert().Model(boundary.OrganizationMember).Exec(ctx); err != nil {
			return err
		}
	}
	for _, record := range []any{boundary.Workspace, boundary.WorkspaceMember} {
		if _, err := db.NewInsert().Model(record).Exec(ctx); err != nil {
			return err
		}
	}
	if _, err := voiceprofiles.SeedDefault(ctx, db, voiceprofiles.DefaultSeed{
		WorkspaceID: boundary.Workspace.ID,
		CreatedByID: boundary.WorkspaceMember.UserID,
		Name:        boundary.Workspace.Name,
		Now:         boundary.Workspace.CreatedAt,
	}); err != nil {
		return err
	}
	_, _, err := jobregistry.EnqueueMediaCleanup(ctx, db, boundary.Workspace.ID, time.Time{})
	return err
}
