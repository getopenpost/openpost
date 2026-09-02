package themes

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

func (s *Service) List(ctx context.Context, actor Actor, organizationID string) ([]Theme, error) {
	organizationID = strings.TrimSpace(organizationID)
	if organizationID == "" {
		return nil, fmt.Errorf("%w: organization_id is required", ErrInvalidInput)
	}
	if s == nil || s.db == nil {
		return nil, ErrUnavailable
	}
	if err := authorizeOrganization(ctx, s.db, actor, organizationID); err != nil {
		return nil, err
	}
	var rows []themeRow
	if err := s.db.NewSelect().Model(&rows).Where("organization_id = ?", organizationID).OrderExpr("normalized_name ASC, created_at ASC").Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: list themes", ErrUnavailable)
	}
	result := make([]Theme, 0, len(rows))
	for _, row := range rows {
		draft, loadErr := s.loadDraft(ctx, s.db, organizationID, row.ID)
		if loadErr != nil {
			return nil, fmt.Errorf("%w: load theme library draft", ErrUnavailable)
		}
		manifest, decodeErr := decodeStoredManifest(draft.ManifestJSON)
		if decodeErr != nil {
			return nil, fmt.Errorf("%w: decode theme library draft", ErrUnavailable)
		}
		summary := summaryFromRows(row, draft, manifest)
		isDefault, assigned, usageErr := themeUsage(ctx, s.db, organizationID, row.ID)
		if usageErr != nil {
			return nil, usageErr
		}
		summary.IsOrganizationDefault = isDefault
		summary.AssignedWorkspaceCount = assigned
		item := Theme{
			Summary: summary,
			Draft:   &ThemeDraft{ThemeID: row.ID, Revision: draft.Revision, Manifest: manifest, UpdatedBy: draft.UpdatedBy, UpdatedAt: draft.UpdatedAt},
		}
		if row.LatestPublishedRevision > 0 {
			latest, publishedErr := s.published(ctx, organizationID, row.ID, row.LatestPublishedRevision)
			if publishedErr != nil {
				return nil, fmt.Errorf("%w: load theme library published revision", ErrUnavailable)
			}
			item.Latest = latest
		}
		result = append(result, item)
	}
	return result, nil
}

func (s *Service) Available(ctx context.Context, actor Actor, workspaceID string) ([]PublishedThemeCatalogItem, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return nil, fmt.Errorf("%w: workspace_id is required", ErrInvalidInput)
	}
	if s == nil || s.db == nil {
		return nil, ErrUnavailable
	}
	decision, err := workspaceaccess.NewAuthorizer(s.db).Authorize(ctx, workspaceID, workspaceActor(actor), workspaceaccess.LevelAdminister)
	if err != nil {
		return nil, fmt.Errorf("%w: authorize Workspace theme catalogue", ErrUnavailable)
	}
	if !decision.Allowed || strings.TrimSpace(decision.OrganizationID) == "" {
		return nil, ErrInaccessible
	}
	organizationID := decision.OrganizationID
	result := make([]PublishedThemeCatalogItem, 0, len(builtInOrder))
	for _, family := range s.ListBuiltIns() {
		result = append(result, PublishedThemeCatalogItem{
			Summary: ThemeSummary{
				Reference: ThemeReference{Kind: ReferenceBuiltIn, ID: family.ID, Version: BuiltInVersion},
				Name:      family.Name, Description: family.Description, IconPack: family.IconPack,
				BuiltIn: true, PublishedRevision: BuiltInVersion, SupportedSchemes: family.SupportedSchemes,
			},
			Manifest: runtimeManifest(family),
		})
	}
	var rows []themeRow
	if err := s.db.NewSelect().Model(&rows).Where("organization_id = ? AND latest_published_revision > 0", organizationID).OrderExpr("normalized_name ASC, created_at ASC").Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: list available themes", ErrUnavailable)
	}
	for _, row := range rows {
		published, err := s.published(ctx, organizationID, row.ID, row.LatestPublishedRevision)
		if err != nil {
			return nil, fmt.Errorf("%w: load available theme", ErrUnavailable)
		}
		isDefault, assigned, usageErr := themeUsage(ctx, s.db, organizationID, row.ID)
		if usageErr != nil {
			return nil, usageErr
		}
		manifest := runtimeManifest(published.Manifest)
		if err := s.materializePreviewManifestURLs(ctx, &manifest, organizationID, workspaceID, row.ID, row.LatestPublishedRevision); err != nil {
			return nil, err
		}
		result = append(result, PublishedThemeCatalogItem{Summary: ThemeSummary{
			Reference:      ThemeReference{Kind: ReferenceCustom, ID: row.ID, Version: row.LatestPublishedRevision},
			OrganizationID: organizationID, Name: published.Manifest.Name, Description: published.Manifest.Description,
			IconPack: published.Manifest.IconPack, PublishedRevision: row.LatestPublishedRevision,
			SupportedSchemes: published.Manifest.SupportedSchemes, IsOrganizationDefault: isDefault,
			AssignedWorkspaceCount: assigned, CreatedAt: row.CreatedAt, UpdatedAt: published.PublishedAt,
		}, Manifest: manifest})
	}
	return result, nil
}

func runtimeManifest(manifest ThemeManifest) ThemeRuntimeManifest {
	return ThemeRuntimeManifest{
		SchemaVersion: manifest.SchemaVersion, ID: manifest.ID, Revision: manifest.Revision,
		Name: manifest.Name, Description: manifest.Description, IconPack: manifest.IconPack,
		SupportedSchemes: manifest.SupportedSchemes, Schemes: manifest.Schemes,
		Fonts: runtimeFontFaces(manifest.Fonts), Assets: manifest.Assets,
	}
}

func (s *Service) Get(ctx context.Context, actor Actor, organizationID, themeID string) (Theme, error) {
	if s == nil || s.db == nil {
		return Theme{}, ErrUnavailable
	}
	if err := authorizeOrganization(ctx, s.db, actor, organizationID); err != nil {
		return Theme{}, err
	}
	return s.get(ctx, s.db, organizationID, themeID)
}

func (s *Service) Create(ctx context.Context, actor Actor, input CreateInput) (Theme, error) {
	if strings.TrimSpace(input.Name) == "" {
		input.Name = input.Manifest.Name
	}
	organizationID, name, normalizedName, err := normalizeIdentity(input.OrganizationID, input.Name)
	if err != nil {
		return Theme{}, err
	}
	manifest := input.Manifest
	if builtInID := strings.TrimSpace(input.DuplicateBuiltInID); builtInID != "" {
		family, ok := BuiltIns()[builtInID]
		if !ok {
			return Theme{}, fmt.Errorf("%w: duplicate built-in does not exist", ErrInvalidInput)
		}
		manifest = family
	}
	if s == nil || s.db == nil {
		return Theme{}, ErrUnavailable
	}
	if err := authorizeOrganization(ctx, s.db, actor, organizationID); err != nil {
		return Theme{}, err
	}
	themeID := s.newID()
	manifest, raw, err := normalizeDraftManifest(themeID, 1, name, manifest)
	if err != nil {
		return Theme{}, err
	}
	now := s.now().UTC()
	row := themeRow{ID: themeID, OrganizationID: organizationID, Name: name, NormalizedName: normalizedName, CreatedBy: actor.UserID, CreatedAt: now, UpdatedAt: now}
	draft := draftRow{ThemeID: row.ID, OrganizationID: organizationID, Revision: 1, Name: name, ManifestJSON: raw, UpdatedBy: actor.UserID, UpdatedAt: now}
	err = organizationguard.WithOrganization(ctx, s.db, organizationID, func(txCtx context.Context, db bun.IDB) error {
		if accessErr := authorizeOrganization(txCtx, db, actor, organizationID); accessErr != nil {
			return accessErr
		}
		if _, insertErr := db.NewInsert().Model(&row).Exec(txCtx); insertErr != nil {
			return insertErr
		}
		if _, insertErr := db.NewInsert().Model(&draft).Exec(txCtx); insertErr != nil {
			return insertErr
		}
		return s.replaceDraftAssets(txCtx, db, organizationID, themeID, manifest)
	})
	if err != nil {
		return Theme{}, writeError(err, "create theme")
	}
	return Theme{Summary: summaryFromRows(row, draft, manifest), Draft: &ThemeDraft{ThemeID: row.ID, Revision: 1, Manifest: manifest, UpdatedBy: actor.UserID, UpdatedAt: now}}, nil
}

func (s *Service) UpdateDraft(ctx context.Context, actor Actor, themeID string, input UpdateDraftInput) (Theme, error) {
	if strings.TrimSpace(input.Name) == "" {
		input.Name = input.Manifest.Name
	}
	organizationID, name, normalizedName, err := normalizeIdentity(input.OrganizationID, input.Name)
	if err != nil {
		return Theme{}, err
	}
	if input.ExpectedRevision < 1 {
		return Theme{}, fmt.Errorf("%w: expected_revision must be positive", ErrInvalidInput)
	}
	manifest, raw, err := normalizeDraftManifest(themeID, input.ExpectedRevision+1, name, input.Manifest)
	if err != nil {
		return Theme{}, err
	}
	if s == nil || s.db == nil {
		return Theme{}, ErrUnavailable
	}
	if err := authorizeOrganization(ctx, s.db, actor, organizationID); err != nil {
		return Theme{}, err
	}
	now := s.now().UTC()
	err = organizationguard.WithOrganization(ctx, s.db, organizationID, func(txCtx context.Context, db bun.IDB) error {
		if accessErr := authorizeOrganization(txCtx, db, actor, organizationID); accessErr != nil {
			return accessErr
		}
		if _, loadErr := s.loadTheme(txCtx, db, organizationID, themeID); loadErr != nil {
			return loadErr
		}
		result, updateErr := db.NewUpdate().Model((*draftRow)(nil)).Set("revision = revision + 1").Set("name = ?", name).Set("manifest_json = ?", raw).Set("updated_by = ?", actor.UserID).Set("updated_at = ?", now).Where("theme_id = ? AND organization_id = ? AND revision = ?", themeID, organizationID, input.ExpectedRevision).Exec(txCtx)
		if updateErr != nil {
			return updateErr
		}
		if one, affectedErr := exactlyOne(result); affectedErr != nil || !one {
			return ErrRevisionConflict
		}
		if assetErr := s.replaceDraftAssets(txCtx, db, organizationID, themeID, manifest); assetErr != nil {
			return assetErr
		}
		_, updateErr = db.NewUpdate().Model((*themeRow)(nil)).Set("name = ?", name).Set("normalized_name = ?", normalizedName).Set("updated_at = ?", now).Where("id = ? AND organization_id = ?", themeID, organizationID).Exec(txCtx)
		return updateErr
	})
	if err != nil {
		return Theme{}, writeError(err, "update theme draft")
	}
	return s.Get(ctx, actor, organizationID, themeID)
}
