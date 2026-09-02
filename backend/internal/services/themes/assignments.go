package themes

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

func (s *Service) SetOrganizationSettings(ctx context.Context, actor Actor, input OrganizationSettingsInput) (OrganizationThemeSettings, error) {
	organizationID := strings.TrimSpace(input.OrganizationID)
	if organizationID == "" {
		return OrganizationThemeSettings{}, fmt.Errorf("%w: organization_id is required", ErrInvalidInput)
	}
	if s == nil || s.db == nil {
		return OrganizationThemeSettings{}, ErrUnavailable
	}
	if err := authorizeOrganization(ctx, s.db, actor, organizationID); err != nil {
		return OrganizationThemeSettings{}, err
	}
	now := s.now().UTC()
	err := organizationguard.WithOrganization(ctx, s.db, organizationID, func(txCtx context.Context, db bun.IDB) error {
		if accessErr := authorizeOrganization(txCtx, db, actor, organizationID); accessErr != nil {
			return accessErr
		}
		if refErr := s.validateReference(txCtx, db, organizationID, input.DefaultReference); refErr != nil {
			return refErr
		}
		row := settingsRow{OrganizationID: organizationID, DefaultReferenceKind: string(input.DefaultReference.Kind), DefaultReferenceID: input.DefaultReference.ID, DefaultReferenceVersion: input.DefaultReference.Version, AssignmentsLocked: input.AssignmentsLocked, UpdatedBy: actor.UserID, UpdatedAt: now}
		_, upsertErr := db.NewInsert().Model(&row).On("CONFLICT (organization_id) DO UPDATE").Set("default_reference_kind = EXCLUDED.default_reference_kind").Set("default_reference_id = EXCLUDED.default_reference_id").Set("default_reference_version = EXCLUDED.default_reference_version").Set("assignments_locked = EXCLUDED.assignments_locked").Set("updated_by = EXCLUDED.updated_by").Set("updated_at = EXCLUDED.updated_at").Exec(txCtx)
		if upsertErr != nil {
			return upsertErr
		}
		if input.AssignmentsLocked {
			_, deleteErr := db.NewDelete().Model((*assignmentRow)(nil)).Where("organization_id = ?", organizationID).Exec(txCtx)
			return deleteErr
		}
		return nil
	})
	if err != nil {
		return OrganizationThemeSettings{}, writeError(err, "update Organization theme settings")
	}
	return OrganizationThemeSettings{OrganizationID: organizationID, DefaultReference: input.DefaultReference, AssignmentsLocked: input.AssignmentsLocked}, nil
}

func (s *Service) AssignWorkspace(ctx context.Context, actor Actor, input WorkspaceAssignmentInput) (ThemeSettings, error) {
	workspaceID := strings.TrimSpace(input.WorkspaceID)
	if workspaceID == "" {
		return ThemeSettings{}, fmt.Errorf("%w: workspace_id is required", ErrInvalidInput)
	}
	if s == nil || s.db == nil {
		return ThemeSettings{}, ErrUnavailable
	}
	preflight, err := workspaceaccess.NewAuthorizer(s.db).Authorize(ctx, workspaceID, workspaceActor(actor), workspaceaccess.LevelAdminister)
	if err != nil {
		return ThemeSettings{}, fmt.Errorf("%w: authorize Workspace theme assignment", ErrUnavailable)
	}
	if !preflight.Allowed {
		return ThemeSettings{}, ErrInaccessible
	}
	err = organizationguard.WithWorkspace(ctx, s.db, workspaceID, func(txCtx context.Context, db bun.IDB) error {
		decision, accessErr := workspaceaccess.NewAuthorizer(db).Authorize(txCtx, workspaceID, workspaceActor(actor), workspaceaccess.LevelAdminister)
		if accessErr != nil {
			return accessErr
		}
		if !decision.Allowed {
			return ErrInaccessible
		}
		organizationID, loadErr := workspaceOrganization(txCtx, db, workspaceID)
		if loadErr != nil {
			return loadErr
		}
		settings, settingsErr := loadSettings(txCtx, db, organizationID)
		if settingsErr != nil {
			return settingsErr
		}
		if settings.AssignmentsLocked {
			return ErrAssignmentLocked
		}
		if input.Reference == nil {
			_, deleteErr := db.NewDelete().Model((*assignmentRow)(nil)).Where("workspace_id = ?", workspaceID).Exec(txCtx)
			return deleteErr
		}
		if refErr := s.validateReference(txCtx, db, organizationID, *input.Reference); refErr != nil {
			return refErr
		}
		now := s.now().UTC()
		row := assignmentRow{WorkspaceID: workspaceID, OrganizationID: organizationID, ReferenceKind: string(input.Reference.Kind), ReferenceID: input.Reference.ID, ReferenceVersion: input.Reference.Version, UpdatedBy: actor.UserID, UpdatedAt: now}
		_, upsertErr := db.NewInsert().Model(&row).On("CONFLICT (workspace_id) DO UPDATE").Set("organization_id = EXCLUDED.organization_id").Set("reference_kind = EXCLUDED.reference_kind").Set("reference_id = EXCLUDED.reference_id").Set("reference_version = EXCLUDED.reference_version").Set("updated_by = EXCLUDED.updated_by").Set("updated_at = EXCLUDED.updated_at").Exec(txCtx)
		return upsertErr
	})
	if err != nil {
		return ThemeSettings{}, writeError(err, "assign Workspace theme")
	}
	return s.Settings(ctx, actor, workspaceID)
}

func (s *Service) Settings(ctx context.Context, actor Actor, workspaceID string) (ThemeSettings, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return ThemeSettings{}, fmt.Errorf("%w: workspace_id is required", ErrInvalidInput)
	}
	if s == nil || s.db == nil {
		return ThemeSettings{}, ErrUnavailable
	}
	authorizer := workspaceaccess.NewAuthorizer(s.db)
	decision, err := authorizer.Authorize(ctx, workspaceID, workspaceActor(actor), workspaceaccess.LevelRead)
	if err != nil {
		return ThemeSettings{}, fmt.Errorf("%w: authorize Workspace", ErrUnavailable)
	}
	if !decision.Allowed {
		return ThemeSettings{}, ErrInaccessible
	}
	manageWorkspace, err := authorizer.Authorize(ctx, workspaceID, workspaceActor(actor), workspaceaccess.LevelAdminister)
	if err != nil {
		return ThemeSettings{}, fmt.Errorf("%w: authorize Workspace management", ErrUnavailable)
	}
	selection, err := s.Selection(ctx, workspaceID)
	if err != nil {
		return ThemeSettings{}, err
	}
	settings, err := loadSettings(ctx, s.db, selection.OrganizationID)
	if err != nil {
		return ThemeSettings{}, err
	}
	var assignment assignmentRow
	assignmentErr := s.db.NewSelect().Model(&assignment).Where("workspace_id = ? AND organization_id = ?", workspaceID, selection.OrganizationID).Scan(ctx)
	var assigned *ThemeReference
	if assignmentErr == nil {
		ref := assignment.Reference()
		assigned = &ref
	} else if !errors.Is(assignmentErr, sql.ErrNoRows) {
		return ThemeSettings{}, fmt.Errorf("%w: load Workspace assignment", ErrUnavailable)
	}
	canManageOrganization := false
	if organizationErr := authorizeOrganization(ctx, s.db, actor, selection.OrganizationID); organizationErr == nil {
		canManageOrganization = true
	} else if !errors.Is(organizationErr, ErrInaccessible) {
		return ThemeSettings{}, organizationErr
	}
	return ThemeSettings{
		OrganizationID: selection.OrganizationID, WorkspaceID: workspaceID,
		OrganizationDefault: settings.Reference(), WorkspaceSelection: assigned,
		AssignmentsLocked: settings.AssignmentsLocked, EffectiveSelection: selection.Reference,
		CanManageWorkspace: manageWorkspace.Allowed, CanManageOrganization: canManageOrganization,
	}, nil
}

func (s *Service) Resolve(ctx context.Context, actor Actor, input ResolveInput) (ResolvedTheme, error) {
	if s == nil || s.db == nil {
		return ResolvedTheme{}, ErrUnavailable
	}
	decision, err := workspaceaccess.NewAuthorizer(s.db).Authorize(ctx, input.WorkspaceID, workspaceActor(actor), workspaceaccess.LevelRead)
	if err != nil {
		return ResolvedTheme{}, fmt.Errorf("%w: authorize Workspace", ErrUnavailable)
	}
	if !decision.Allowed {
		return ResolvedTheme{}, ErrInaccessible
	}
	resolved, err := s.resolver.Resolve(ctx, input)
	if err != nil {
		return ResolvedTheme{}, err
	}
	if err := s.materializeResolvedResourceURLs(ctx, &resolved, input.WorkspaceID); err != nil {
		if errors.Is(err, errUnsafeResource) || errors.Is(err, errResourceFailed) {
			reason := FallbackUnsafeResource
			if errors.Is(err, errResourceFailed) {
				reason = FallbackResourceFailed
			}
			fallback := workshopFallback(input.Scheme, reason)
			fallback.organizationID = decision.OrganizationID
			return fallback, nil
		}
		return ResolvedTheme{}, err
	}
	return resolved, nil
}

// Selection implements the private resolution store. It is deliberately unexported through
// the HTTP surface; callers use Resolve so fallback remains atomic.
func (s *Service) Selection(ctx context.Context, workspaceID string) (Selection, error) {
	if s == nil || s.db == nil {
		return Selection{}, ErrUnavailable
	}
	organizationID, err := workspaceOrganization(ctx, s.db, workspaceID)
	if err != nil {
		return Selection{}, err
	}
	settings, err := loadSettings(ctx, s.db, organizationID)
	if err != nil {
		return Selection{}, err
	}
	selection := Selection{OrganizationID: organizationID, WorkspaceID: workspaceID, Reference: settings.Reference(), Locked: settings.AssignmentsLocked, Inherited: true}
	if settings.AssignmentsLocked {
		return selection, nil
	}
	var assignment assignmentRow
	err = s.db.NewSelect().Model(&assignment).Where("workspace_id = ? AND organization_id = ?", workspaceID, organizationID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return selection, nil
	}
	if err != nil {
		return Selection{}, fmt.Errorf("%w: load Workspace theme selection", ErrUnavailable)
	}
	selection.Reference = assignment.Reference()
	selection.Inherited = false
	return selection, nil
}

func advancePublishedReferences(ctx context.Context, db bun.IDB, organizationID, themeID string, revision int, now time.Time, actorID string) error {
	if _, err := db.NewUpdate().Model((*settingsRow)(nil)).
		Set("default_reference_version = ?", revision).
		Set("updated_by = ?", actorID).
		Set("updated_at = ?", now).
		Where("organization_id = ?", organizationID).
		Where("default_reference_kind = ? AND default_reference_id = ?", ReferenceCustom, themeID).
		Exec(ctx); err != nil {
		return err
	}
	_, err := db.NewUpdate().Model((*assignmentRow)(nil)).
		Set("reference_version = ?", revision).
		Set("updated_by = ?", actorID).
		Set("updated_at = ?", now).
		Where("organization_id = ?", organizationID).
		Where("reference_kind = ? AND reference_id = ?", ReferenceCustom, themeID).
		Exec(ctx)
	return err
}
