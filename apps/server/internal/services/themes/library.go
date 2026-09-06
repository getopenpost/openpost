package themes

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

type customSummaryRow struct {
	ThemeID                 string    `bun:"theme_id"`
	OrganizationID          string    `bun:"organization_id"`
	NormalizedName          string    `bun:"normalized_name"`
	LatestPublishedRevision int       `bun:"latest_published_revision"`
	CreatedAt               time.Time `bun:"created_at"`
	SortAt                  time.Time `bun:"sort_at"`
	UpdatedAt               time.Time `bun:"updated_at"`
	ManifestJSON            string    `bun:"manifest_json"`
	DraftRevision           int       `bun:"draft_revision"`
	PublishedAt             time.Time `bun:"published_at"`
	IsOrganizationDefault   bool      `bun:"is_organization_default"`
	AssignedWorkspaceCount  int       `bun:"assigned_workspace_count"`
}

// Corrupt rows are skipped in bounded batches. Ten batches let a request recover
// through 1,000 bad candidates, then hand the caller a continuation cursor.
const maxUnavailableThemeScanBatches = 10

type availableSummaryBatch struct {
	Items   []ThemeSummary
	Cursor  themePageCursor
	HasMore bool
}

func (s *Service) List(ctx context.Context, actor Actor, organizationID string, options PageOptions) (ThemeSummaryPage, error) {
	organizationID = strings.TrimSpace(organizationID)
	if organizationID == "" {
		return ThemeSummaryPage{}, fmt.Errorf("%w: organization_id is required", ErrInvalidInput)
	}
	if s == nil || s.db == nil {
		return ThemeSummaryPage{}, ErrUnavailable
	}
	if err := authorizeOrganization(ctx, s.db, actor, organizationID); err != nil {
		return ThemeSummaryPage{}, err
	}
	options, err := normalizePageOptions(options)
	if err != nil {
		return ThemeSummaryPage{}, err
	}
	scope := themeCursorScope("organization", organizationID)
	cursor, err := decodeThemeCursor(options.Cursor, scope, cursorSegmentCustom)
	if err != nil {
		return ThemeSummaryPage{}, err
	}
	rows, err := s.listOrganizationSummaryRows(ctx, organizationID, cursor, options.Limit+1)
	if err != nil {
		return ThemeSummaryPage{}, err
	}
	page := ThemeSummaryPage{Items: make([]ThemeSummary, 0, min(len(rows), options.Limit))}
	if len(rows) > options.Limit {
		rows = rows[:options.Limit]
		page.NextCursor = customThemeCursor(scope, rows[len(rows)-1])
	}
	for _, row := range rows {
		manifest, decodeErr := decodeStoredManifest(row.ManifestJSON)
		if decodeErr != nil || row.DraftRevision < 1 {
			return ThemeSummaryPage{}, fmt.Errorf("%w: decode theme library draft", ErrUnavailable)
		}
		page.Items = append(page.Items, summaryFromCustomRow(row, manifest, row.DraftRevision, row.UpdatedAt))
	}
	return page, nil
}

func (s *Service) Available(ctx context.Context, actor Actor, workspaceID string, options PageOptions) (ThemeSummaryPage, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return ThemeSummaryPage{}, fmt.Errorf("%w: workspace_id is required", ErrInvalidInput)
	}
	if s == nil || s.db == nil {
		return ThemeSummaryPage{}, ErrUnavailable
	}
	decision, err := workspaceaccess.NewAuthorizer(s.db).Authorize(ctx, workspaceID, workspaceActor(actor), workspaceaccess.LevelAdminister)
	if err != nil {
		return ThemeSummaryPage{}, fmt.Errorf("%w: authorize Workspace theme catalogue", ErrUnavailable)
	}
	if !decision.Allowed || strings.TrimSpace(decision.OrganizationID) == "" {
		return ThemeSummaryPage{}, ErrInaccessible
	}
	organizationID := decision.OrganizationID
	options, err = normalizePageOptions(options)
	if err != nil {
		return ThemeSummaryPage{}, err
	}
	scope := themeCursorScope("available", workspaceID+":"+organizationID)
	cursor, err := decodeThemeCursor(options.Cursor, scope, cursorSegmentBuiltIn, cursorSegmentCustom)
	if err != nil {
		return ThemeSummaryPage{}, err
	}
	page, cursor, complete := s.availableBuiltInPage(scope, cursor, options.Limit)
	if complete {
		return page, nil
	}
	return s.availableCustomPage(ctx, organizationID, scope, cursor, options.Limit, page)
}

func (s *Service) availableBuiltInPage(scope string, cursor themePageCursor, limit int) (ThemeSummaryPage, themePageCursor, bool) {
	page := ThemeSummaryPage{Items: make([]ThemeSummary, 0, limit)}
	if cursor.Segment == cursorSegmentCustom {
		return page, cursor, false
	}
	startBuiltIn := 0
	if cursor.Segment == cursorSegmentBuiltIn {
		startBuiltIn = cursor.BuiltInIndex + 1
	}
	families := s.ListBuiltIns()
	for index := startBuiltIn; index < len(families) && len(page.Items) < limit; index++ {
		page.Items = append(page.Items, builtInSummary(families[index]))
		if len(page.Items) == limit && index+1 < len(families) {
			page.NextCursor = encodeThemeCursor(themePageCursor{Scope: scope, Segment: cursorSegmentBuiltIn, BuiltInIndex: index})
			return page, cursor, true
		}
	}
	return page, themePageCursor{}, false
}

func (s *Service) availableCustomPage(ctx context.Context, organizationID, scope string, cursor themePageCursor, limit int, page ThemeSummaryPage) (ThemeSummaryPage, error) {
	if len(page.Items) == limit {
		rows, err := s.listAvailableSummaryRows(ctx, organizationID, cursor, 1)
		if err != nil {
			return ThemeSummaryPage{}, err
		}
		if len(rows) > 0 {
			page.NextCursor = encodeThemeCursor(themePageCursor{Scope: scope, Segment: cursorSegmentCustom})
		}
		return page, nil
	}
	for range maxUnavailableThemeScanBatches {
		batch, err := s.scanAvailableSummaryBatch(ctx, organizationID, scope, cursor, limit-len(page.Items))
		if err != nil {
			return ThemeSummaryPage{}, err
		}
		page.Items = append(page.Items, batch.Items...)
		page.NextCursor = ""
		if batch.HasMore {
			page.NextCursor = encodeThemeCursor(batch.Cursor)
		}
		if len(page.Items) == limit || !batch.HasMore {
			return page, nil
		}
		cursor = batch.Cursor
	}
	return page, nil
}

func (s *Service) scanAvailableSummaryBatch(ctx context.Context, organizationID, scope string, cursor themePageCursor, capacity int) (availableSummaryBatch, error) {
	rows, err := s.listAvailableSummaryRows(ctx, organizationID, cursor, MaxThemePageLimit+1)
	if err != nil {
		return availableSummaryBatch{}, err
	}
	scanRows := rows[:min(len(rows), MaxThemePageLimit)]
	resources, err := s.loadPublishedResourceSets(ctx, organizationID, scanRows)
	if err != nil {
		return availableSummaryBatch{}, err
	}
	batch := availableSummaryBatch{Items: make([]ThemeSummary, 0, capacity)}
	lastConsumed := -1
	for index, row := range scanRows {
		lastConsumed = index
		manifest, decodeErr := decodeStoredManifest(row.ManifestJSON)
		if decodeErr != nil || validatePublishedResourceSet(manifest, resources[row.ThemeID]) != nil {
			continue
		}
		batch.Items = append(batch.Items, summaryFromCustomRow(row, manifest, 0, row.PublishedAt))
		if len(batch.Items) == capacity {
			break
		}
	}
	if lastConsumed < 0 {
		return batch, nil
	}
	batch.HasMore = lastConsumed+1 < len(rows)
	batch.Cursor = customThemeCursorValue(scope, scanRows[lastConsumed])
	return batch, nil
}

func (s *Service) AvailableDetail(ctx context.Context, actor Actor, workspaceID, themeID string, revision int) (PublishedThemeCatalogItem, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	themeID = strings.TrimSpace(themeID)
	if workspaceID == "" || themeID == "" || revision < 1 {
		return PublishedThemeCatalogItem{}, fmt.Errorf("%w: workspace_id, theme_id, and a positive revision are required", ErrInvalidInput)
	}
	if s == nil || s.db == nil {
		return PublishedThemeCatalogItem{}, ErrUnavailable
	}
	decision, err := workspaceaccess.NewAuthorizer(s.db).Authorize(ctx, workspaceID, workspaceActor(actor), workspaceaccess.LevelAdminister)
	if err != nil {
		return PublishedThemeCatalogItem{}, fmt.Errorf("%w: authorize Workspace theme catalogue", ErrUnavailable)
	}
	if !decision.Allowed || strings.TrimSpace(decision.OrganizationID) == "" {
		return PublishedThemeCatalogItem{}, ErrInaccessible
	}
	organizationID := decision.OrganizationID
	row, err := s.availableDetailRow(ctx, organizationID, themeID, revision)
	if err != nil {
		return PublishedThemeCatalogItem{}, err
	}
	stored, err := decodeStoredManifest(row.ManifestJSON)
	if err != nil {
		return PublishedThemeCatalogItem{}, ErrNotFound
	}
	resources, err := s.loadPublishedResourceSets(ctx, organizationID, []customSummaryRow{row})
	if err != nil {
		return PublishedThemeCatalogItem{}, err
	}
	resourceSet := resources[row.ThemeID]
	if validatePublishedResourceSet(stored, resourceSet) != nil {
		return PublishedThemeCatalogItem{}, ErrNotFound
	}
	manifest := runtimeManifest(stored)
	if err := materializePreviewManifestURLs(&manifest, workspaceID, row.ThemeID, revision, resourceSet); err != nil {
		return PublishedThemeCatalogItem{}, ErrNotFound
	}
	return PublishedThemeCatalogItem{Summary: summaryFromCustomRow(row, stored, 0, row.PublishedAt), Manifest: manifest}, nil
}

func (s *Service) listOrganizationSummaryRows(ctx context.Context, organizationID string, cursor themePageCursor, limit int) ([]customSummaryRow, error) {
	var rows []customSummaryRow
	query := s.summaryQuery(organizationID).
		ColumnExpr("theme.normalized_name AS normalized_name").
		ColumnExpr("theme.created_at AS sort_at").
		ColumnExpr("COALESCE(draft.revision, 0) AS draft_revision").
		ColumnExpr("COALESCE(draft.manifest_json, '') AS manifest_json").
		ColumnExpr("theme.updated_at AS updated_at").
		ColumnExpr("theme.updated_at AS published_at").
		Join("LEFT JOIN organization_theme_drafts AS draft ON draft.theme_id = theme.id AND draft.organization_id = theme.organization_id").
		Where("theme.organization_id = ?", organizationID)
	query = applyCustomSummaryCursor(query, cursor, "theme.normalized_name", "theme.created_at")
	err := query.OrderExpr("theme.normalized_name ASC, theme.created_at ASC, theme.id ASC").Limit(limit).Scan(ctx, &rows)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: list themes", ErrUnavailable)
	}
	return rows, nil
}

func (s *Service) listAvailableSummaryRows(ctx context.Context, organizationID string, cursor themePageCursor, limit int) ([]customSummaryRow, error) {
	if limit < 1 {
		return []customSummaryRow{}, nil
	}
	var rows []customSummaryRow
	query := s.summaryQuery(organizationID).
		ColumnExpr("LOWER(revision.name) AS normalized_name").
		ColumnExpr("revision.published_at AS sort_at").
		ColumnExpr("0 AS draft_revision").
		ColumnExpr("revision.manifest_json AS manifest_json").
		ColumnExpr("revision.published_at AS updated_at").
		ColumnExpr("revision.published_at AS published_at").
		Join("JOIN organization_theme_revisions AS revision ON revision.theme_id = theme.id AND revision.organization_id = theme.organization_id AND revision.revision = theme.latest_published_revision").
		Where("theme.organization_id = ? AND theme.latest_published_revision > 0", organizationID)
	query = applyCustomSummaryCursor(query, cursor, "LOWER(revision.name)", "revision.published_at")
	err := query.OrderExpr("LOWER(revision.name) ASC, revision.published_at ASC, theme.id ASC").Limit(limit).Scan(ctx, &rows)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: list available themes", ErrUnavailable)
	}
	return rows, nil
}

func (s *Service) availableDetailRow(ctx context.Context, organizationID, themeID string, revision int) (customSummaryRow, error) {
	var row customSummaryRow
	err := s.summaryQuery(organizationID).
		ColumnExpr("LOWER(revision.name) AS normalized_name").
		ColumnExpr("revision.published_at AS sort_at").
		ColumnExpr("0 AS draft_revision").
		ColumnExpr("revision.manifest_json AS manifest_json").
		ColumnExpr("revision.published_at AS updated_at").
		ColumnExpr("revision.published_at AS published_at").
		Join("JOIN organization_theme_revisions AS revision ON revision.theme_id = theme.id AND revision.organization_id = theme.organization_id AND revision.revision = theme.latest_published_revision").
		Where("theme.organization_id = ? AND theme.id = ? AND revision.revision = ?", organizationID, themeID, revision).
		Limit(1).Scan(ctx, &row)
	if errors.Is(err, sql.ErrNoRows) {
		return customSummaryRow{}, ErrNotFound
	}
	if err != nil {
		return customSummaryRow{}, fmt.Errorf("%w: load available theme", ErrUnavailable)
	}
	row.LatestPublishedRevision = revision
	return row, nil
}

func (s *Service) summaryQuery(organizationID string) *bun.SelectQuery {
	return s.db.NewSelect().
		TableExpr("organization_themes AS theme").
		ColumnExpr("theme.id AS theme_id").
		ColumnExpr("theme.organization_id AS organization_id").
		ColumnExpr("theme.latest_published_revision AS latest_published_revision").
		ColumnExpr("theme.created_at AS created_at").
		ColumnExpr("CASE WHEN settings.default_reference_kind = ? AND settings.default_reference_id = theme.id THEN TRUE ELSE FALSE END AS is_organization_default", ReferenceCustom).
		ColumnExpr("COALESCE(usage.assigned_workspace_count, 0) AS assigned_workspace_count").
		Join("LEFT JOIN organization_theme_settings AS settings ON settings.organization_id = theme.organization_id").
		Join("LEFT JOIN (SELECT organization_id, reference_id, COUNT(*) AS assigned_workspace_count FROM workspace_theme_assignments WHERE reference_kind = ? AND organization_id = ? GROUP BY organization_id, reference_id) AS usage ON usage.organization_id = theme.organization_id AND usage.reference_id = theme.id", ReferenceCustom, organizationID)
}

func applyCustomSummaryCursor(query *bun.SelectQuery, cursor themePageCursor, nameExpression, timeExpression string) *bun.SelectQuery {
	if cursor.Segment != cursorSegmentCustom || cursor.NormalizedName == "" {
		return query
	}
	condition := "(" + nameExpression + " > ? OR (" + nameExpression + " = ? AND (" + timeExpression + " > ? OR (" + timeExpression + " = ? AND theme.id > ?))))"
	return query.Where(condition,
		cursor.NormalizedName, cursor.NormalizedName, cursor.CreatedAt, cursor.CreatedAt, cursor.ID)
}

func summaryFromCustomRow(row customSummaryRow, manifest ThemeManifest, draftRevision int, updatedAt time.Time) ThemeSummary {
	version := row.LatestPublishedRevision
	if version < 1 {
		version = 1
	}
	return ThemeSummary{
		Reference:      ThemeReference{Kind: ReferenceCustom, ID: row.ThemeID, Version: version},
		OrganizationID: row.OrganizationID, Name: manifest.Name, Description: manifest.Description,
		IconPack: manifest.IconPack, DraftRevision: draftRevision, PublishedRevision: row.LatestPublishedRevision,
		SupportedSchemes: slices.Clone(manifest.SupportedSchemes), IsOrganizationDefault: row.IsOrganizationDefault,
		AssignedWorkspaceCount: row.AssignedWorkspaceCount, CreatedAt: row.CreatedAt, UpdatedAt: updatedAt,
	}
}

func builtInSummary(family BuiltInFamily) ThemeSummary {
	reference := builtInReference(family)
	return ThemeSummary{
		Reference: reference,
		Name:      family.Name, Description: family.Description, IconPack: family.IconPack, BuiltIn: true,
		PublishedRevision: reference.Version, SupportedSchemes: slices.Clone(family.SupportedSchemes),
	}
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
