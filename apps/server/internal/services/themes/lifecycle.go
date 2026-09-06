package themes

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/uptrace/bun"
)

//nolint:gocyclo // Publishing validates the draft and resources, appends one revision, and advances all references atomically.
func (s *Service) Publish(ctx context.Context, actor Actor, themeID string, input PublishInput) (PublishedRevision, error) {
	organizationID := strings.TrimSpace(input.OrganizationID)
	if organizationID == "" || input.ExpectedDraftRevision < 1 || input.ExpectedPublishedRevision < 0 {
		return PublishedRevision{}, fmt.Errorf("%w: organization_id and expected draft and published revisions are required", ErrInvalidInput)
	}
	if s == nil || s.db == nil {
		return PublishedRevision{}, ErrUnavailable
	}
	if err := authorizeOrganization(ctx, s.db, actor, organizationID); err != nil {
		return PublishedRevision{}, err
	}
	var published PublishedRevision
	err := organizationguard.WithOrganization(ctx, s.db, organizationID, func(txCtx context.Context, db bun.IDB) error {
		if accessErr := authorizeOrganization(txCtx, db, actor, organizationID); accessErr != nil {
			return accessErr
		}
		theme, loadErr := s.loadTheme(txCtx, db, organizationID, themeID)
		if loadErr != nil {
			return loadErr
		}
		if theme.LatestPublishedRevision != input.ExpectedPublishedRevision {
			return ErrRevisionConflict
		}
		draft, loadErr := s.loadDraft(txCtx, db, organizationID, themeID)
		if loadErr != nil {
			return loadErr
		}
		if draft.Revision != input.ExpectedDraftRevision {
			return ErrRevisionConflict
		}
		manifest, decodeErr := decodeStoredManifest(draft.ManifestJSON)
		if decodeErr != nil {
			return decodeErr
		}
		next := theme.LatestPublishedRevision + 1
		now := s.now().UTC()
		manifest.ID = themeID
		manifest.Revision = fmt.Sprintf("%d", next)
		manifest.Name = draft.Name
		manifest, publishedRaw, normalizeErr := normalizeAndEncodeManifest(manifest)
		if normalizeErr != nil {
			return normalizeErr
		}
		row := revisionRow{ThemeID: themeID, OrganizationID: organizationID, Revision: next, Name: draft.Name, ManifestJSON: publishedRaw, PublishedBy: actor.UserID, PublishedAt: now}
		if _, insertErr := db.NewInsert().Model(&row).Exec(txCtx); insertErr != nil {
			return insertErr
		}
		result, updateErr := db.NewUpdate().Model((*themeRow)(nil)).Set("latest_published_revision = ?", next).Set("updated_at = ?", now).Where("id = ? AND organization_id = ? AND latest_published_revision = ?", themeID, organizationID, theme.LatestPublishedRevision).Exec(txCtx)
		if updateErr != nil {
			return updateErr
		}
		if one, affectedErr := exactlyOne(result); affectedErr != nil || !one {
			return ErrRevisionConflict
		}
		if advanceErr := advancePublishedReferences(txCtx, db, organizationID, themeID, next, now, actor.UserID); advanceErr != nil {
			return advanceErr
		}
		if assetErr := s.replaceRevisionAssets(txCtx, db, organizationID, themeID, next, manifest); assetErr != nil {
			return assetErr
		}
		published = PublishedRevision{ThemeID: themeID, Revision: next, Manifest: manifest, PublishedBy: actor.UserID, PublishedAt: now}
		return nil
	})
	if err != nil {
		return PublishedRevision{}, writeError(err, "publish theme")
	}
	return published, nil
}

//nolint:gocyclo // Rollback atomically creates a new head, resets the draft, relinks assets, and advances references.
func (s *Service) Rollback(ctx context.Context, actor Actor, themeID string, input RollbackInput) (PublishedRevision, error) {
	organizationID := strings.TrimSpace(input.OrganizationID)
	if organizationID == "" || input.SourceRevision < 1 || input.ExpectedDraftRevision < 1 ||
		input.ExpectedPublishedRevision < 1 || input.SourceRevision >= input.ExpectedPublishedRevision {
		return PublishedRevision{}, fmt.Errorf("%w: organization_id, a prior source revision, and expected draft and published revisions are required", ErrInvalidInput)
	}
	if s == nil || s.db == nil {
		return PublishedRevision{}, ErrUnavailable
	}
	if err := authorizeOrganization(ctx, s.db, actor, organizationID); err != nil {
		return PublishedRevision{}, err
	}
	var published PublishedRevision
	err := organizationguard.WithOrganization(ctx, s.db, organizationID, func(txCtx context.Context, db bun.IDB) error {
		if accessErr := authorizeOrganization(txCtx, db, actor, organizationID); accessErr != nil {
			return accessErr
		}
		theme, loadErr := s.loadTheme(txCtx, db, organizationID, themeID)
		if loadErr != nil {
			return loadErr
		}
		if theme.LatestPublishedRevision != input.ExpectedPublishedRevision {
			return ErrRevisionConflict
		}
		draft, loadErr := s.loadDraft(txCtx, db, organizationID, themeID)
		if loadErr != nil {
			return loadErr
		}
		if draft.Revision != input.ExpectedDraftRevision {
			return ErrRevisionConflict
		}
		source, loadErr := s.loadRevision(txCtx, db, organizationID, themeID, input.SourceRevision)
		if loadErr != nil {
			return loadErr
		}
		manifest, decodeErr := decodeStoredManifest(source.ManifestJSON)
		if decodeErr != nil {
			return decodeErr
		}
		next := theme.LatestPublishedRevision + 1
		now := s.now().UTC()
		manifest.ID = themeID
		manifest.Revision = fmt.Sprintf("%d", next)
		manifest, publishedRaw, normalizeErr := normalizeAndEncodeManifest(manifest)
		if normalizeErr != nil {
			return normalizeErr
		}
		sourceRevision := input.SourceRevision
		row := revisionRow{ThemeID: themeID, OrganizationID: organizationID, Revision: next, Name: source.Name, ManifestJSON: publishedRaw, PublishedBy: actor.UserID, PublishedAt: now, SourceRevision: &sourceRevision}
		if _, insertErr := db.NewInsert().Model(&row).Exec(txCtx); insertErr != nil {
			return insertErr
		}
		_, _, normalizedName, normalizeIdentityErr := normalizeIdentity(organizationID, source.Name)
		if normalizeIdentityErr != nil {
			return normalizeIdentityErr
		}
		result, updateErr := db.NewUpdate().Model((*themeRow)(nil)).Set("latest_published_revision = ?", next).Set("name = ?", source.Name).Set("normalized_name = ?", normalizedName).Set("updated_at = ?", now).Where("id = ? AND organization_id = ? AND latest_published_revision = ?", themeID, organizationID, theme.LatestPublishedRevision).Exec(txCtx)
		if updateErr != nil {
			return updateErr
		}
		if one, affectedErr := exactlyOne(result); affectedErr != nil || !one {
			return ErrRevisionConflict
		}
		if advanceErr := advancePublishedReferences(txCtx, db, organizationID, themeID, next, now, actor.UserID); advanceErr != nil {
			return advanceErr
		}
		if assetErr := s.replaceRevisionAssets(txCtx, db, organizationID, themeID, next, manifest); assetErr != nil {
			return assetErr
		}
		draftManifest := manifest
		draftManifest.Revision = fmt.Sprintf("draft-%d", draft.Revision+1)
		draftManifest, draftRaw, draftNormalizeErr := normalizeAndEncodeManifest(draftManifest)
		if draftNormalizeErr != nil {
			return draftNormalizeErr
		}
		draftResult, draftUpdateErr := db.NewUpdate().Model((*draftRow)(nil)).
			Set("revision = ?", draft.Revision+1).
			Set("name = ?", source.Name).
			Set("manifest_json = ?", draftRaw).
			Set("updated_by = ?", actor.UserID).
			Set("updated_at = ?", now).
			Where("theme_id = ? AND organization_id = ? AND revision = ?", themeID, organizationID, draft.Revision).
			Exec(txCtx)
		if draftUpdateErr != nil {
			return draftUpdateErr
		}
		if one, affectedErr := exactlyOne(draftResult); affectedErr != nil || !one {
			return ErrRevisionConflict
		}
		if assetErr := s.replaceDraftAssets(txCtx, db, organizationID, themeID, draftManifest); assetErr != nil {
			return assetErr
		}
		published = PublishedRevision{ThemeID: themeID, Revision: next, SourceRevision: &sourceRevision, Manifest: manifest, PublishedBy: actor.UserID, PublishedAt: now}
		return nil
	})
	if err != nil {
		return PublishedRevision{}, writeError(err, "rollback theme")
	}
	return published, nil
}

//nolint:gocyclo // Theme deletion keeps all default, assignment, and asset-link guards inside one authorized transaction.
func (s *Service) Delete(ctx context.Context, actor Actor, themeID string, input DeleteInput) error {
	organizationID := strings.TrimSpace(input.OrganizationID)
	if organizationID == "" || strings.TrimSpace(themeID) == "" {
		return fmt.Errorf("%w: organization_id and theme_id are required", ErrInvalidInput)
	}
	if s == nil || s.db == nil {
		return ErrUnavailable
	}
	if err := authorizeOrganization(ctx, s.db, actor, organizationID); err != nil {
		return err
	}
	err := organizationguard.WithOrganization(ctx, s.db, organizationID, func(txCtx context.Context, db bun.IDB) error {
		if accessErr := authorizeOrganization(txCtx, db, actor, organizationID); accessErr != nil {
			return accessErr
		}
		if _, loadErr := s.loadTheme(txCtx, db, organizationID, themeID); loadErr != nil {
			return loadErr
		}
		var settings settingsRow
		settingsErr := db.NewSelect().Model(&settings).Where("organization_id = ?", organizationID).Scan(txCtx)
		if settingsErr != nil && !errors.Is(settingsErr, sql.ErrNoRows) {
			return settingsErr
		}
		if settings.Reference().Kind == ReferenceCustom && settings.Reference().ID == themeID {
			return ErrThemeInUse
		}
		assigned, countErr := db.NewSelect().Model((*assignmentRow)(nil)).Where("organization_id = ? AND reference_kind = ? AND reference_id = ?", organizationID, ReferenceCustom, themeID).Count(txCtx)
		if countErr != nil {
			return countErr
		}
		if assigned > 0 {
			return ErrThemeInUse
		}
		result, deleteErr := db.NewDelete().Model((*themeRow)(nil)).Where("id = ? AND organization_id = ?", themeID, organizationID).Exec(txCtx)
		if deleteErr != nil {
			return deleteErr
		}
		if one, affectedErr := exactlyOne(result); affectedErr != nil || !one {
			return ErrNotFound
		}
		return nil
	})
	if err != nil {
		return writeError(err, "delete theme")
	}
	return nil
}

func (s *Service) published(ctx context.Context, organizationID, themeID string, revision int) (*PublishedRevision, error) {
	if s == nil || s.db == nil {
		return nil, ErrUnavailable
	}
	row, err := s.loadRevision(ctx, s.db, organizationID, themeID, revision)
	if err != nil {
		return nil, err
	}
	manifest, err := decodeStoredManifest(row.ManifestJSON)
	if err != nil {
		return nil, err
	}
	return &PublishedRevision{ThemeID: themeID, Revision: row.Revision, SourceRevision: row.SourceRevision, Manifest: manifest, PublishedBy: row.PublishedBy, PublishedAt: row.PublishedAt}, nil
}

func (s *Service) ListRevisions(ctx context.Context, actor Actor, organizationID, themeID string, options PageOptions) (PublishedRevisionPage, error) {
	organizationID = strings.TrimSpace(organizationID)
	themeID = strings.TrimSpace(themeID)
	if organizationID == "" || themeID == "" {
		return PublishedRevisionPage{}, fmt.Errorf("%w: organization_id and theme_id are required", ErrInvalidInput)
	}
	if s == nil || s.db == nil {
		return PublishedRevisionPage{}, ErrUnavailable
	}
	if err := authorizeOrganization(ctx, s.db, actor, organizationID); err != nil {
		return PublishedRevisionPage{}, err
	}
	if _, err := s.loadTheme(ctx, s.db, organizationID, themeID); err != nil {
		return PublishedRevisionPage{}, err
	}
	options, err := normalizePageOptions(options)
	if err != nil {
		return PublishedRevisionPage{}, err
	}
	scope := themeCursorScope("revisions", organizationID+":"+themeID)
	cursor, err := decodeThemeCursor(options.Cursor, scope, cursorSegmentRevision)
	if err != nil {
		return PublishedRevisionPage{}, err
	}
	var rows []revisionRow
	query := s.db.NewSelect().Model(&rows).Where("theme_id = ? AND organization_id = ?", themeID, organizationID)
	if cursor.Revision > 0 {
		query = query.Where("revision < ?", cursor.Revision)
	}
	if err := query.OrderExpr("revision DESC").Limit(options.Limit + 1).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return PublishedRevisionPage{}, fmt.Errorf("%w: list published theme revisions", ErrUnavailable)
	}
	page := PublishedRevisionPage{Items: make([]PublishedRevision, 0, min(len(rows), options.Limit))}
	if len(rows) > options.Limit {
		rows = rows[:options.Limit]
		page.NextCursor = encodeThemeCursor(themePageCursor{Scope: scope, Segment: cursorSegmentRevision, Revision: rows[len(rows)-1].Revision})
	}
	for _, row := range rows {
		manifest, err := decodeStoredManifest(row.ManifestJSON)
		if err != nil {
			return PublishedRevisionPage{}, fmt.Errorf("%w: decode published theme revision", ErrUnavailable)
		}
		page.Items = append(page.Items, PublishedRevision{ThemeID: themeID, Revision: row.Revision, SourceRevision: row.SourceRevision, Manifest: manifest, PublishedBy: row.PublishedBy, PublishedAt: row.PublishedAt})
	}
	return page, nil
}

func (s *Service) GetRevision(ctx context.Context, actor Actor, organizationID, themeID string, revision int) (PublishedRevision, error) {
	organizationID = strings.TrimSpace(organizationID)
	themeID = strings.TrimSpace(themeID)
	if organizationID == "" || themeID == "" || revision < 1 {
		return PublishedRevision{}, fmt.Errorf("%w: organization_id, theme_id, and revision are required", ErrInvalidInput)
	}
	if s == nil || s.db == nil {
		return PublishedRevision{}, ErrUnavailable
	}
	if err := authorizeOrganization(ctx, s.db, actor, organizationID); err != nil {
		return PublishedRevision{}, err
	}
	published, err := s.published(ctx, organizationID, themeID, revision)
	if err != nil {
		if errors.Is(err, errStoredManifest) {
			return PublishedRevision{}, fmt.Errorf("%w: decode published theme revision", ErrUnavailable)
		}
		return PublishedRevision{}, err
	}
	return *published, nil
}
