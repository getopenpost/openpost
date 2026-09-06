package themes

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

func (s *Service) get(ctx context.Context, db bun.IDB, organizationID, themeID string) (Theme, error) {
	row, err := s.loadTheme(ctx, db, organizationID, themeID)
	if err != nil {
		return Theme{}, err
	}
	draft, err := s.loadDraft(ctx, db, organizationID, themeID)
	if err != nil {
		return Theme{}, err
	}
	draftManifest, err := decodeStoredManifest(draft.ManifestJSON)
	if err != nil {
		return Theme{}, err
	}
	result := Theme{Summary: summaryFromRows(row, draft, draftManifest), Draft: &ThemeDraft{ThemeID: themeID, Revision: draft.Revision, Manifest: draftManifest, UpdatedBy: draft.UpdatedBy, UpdatedAt: draft.UpdatedAt}}
	if row.LatestPublishedRevision > 0 {
		published, publishedErr := s.published(ctx, organizationID, themeID, row.LatestPublishedRevision)
		if publishedErr != nil {
			return Theme{}, publishedErr
		}
		result.Latest = published
	}
	return result, nil
}

func (s *Service) validateReference(ctx context.Context, db bun.IDB, organizationID string, reference ThemeReference) error {
	if reference.Kind == ReferenceBuiltIn {
		family, ok := BuiltIns()[reference.ID]
		if !ok || reference.Version != builtInVersion(family) {
			return fmt.Errorf("%w: unknown built-in revision", ErrInvalidInput)
		}
		return nil
	}
	if reference.Kind != ReferenceCustom || reference.ID == "" || reference.Version < 1 {
		return fmt.Errorf("%w: invalid theme reference", ErrInvalidInput)
	}
	_, err := s.loadRevision(ctx, db, organizationID, reference.ID, reference.Version)
	return err
}

func (s *Service) loadTheme(ctx context.Context, db bun.IDB, organizationID, themeID string) (themeRow, error) {
	var row themeRow
	err := db.NewSelect().Model(&row).Where("id = ? AND organization_id = ?", strings.TrimSpace(themeID), strings.TrimSpace(organizationID)).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return themeRow{}, ErrNotFound
	}
	if err != nil {
		return themeRow{}, fmt.Errorf("%w: load theme", ErrUnavailable)
	}
	return row, nil
}

func (s *Service) loadDraft(ctx context.Context, db bun.IDB, organizationID, themeID string) (draftRow, error) {
	var row draftRow
	err := db.NewSelect().Model(&row).Where("theme_id = ? AND organization_id = ?", themeID, organizationID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return draftRow{}, ErrNotFound
	}
	if err != nil {
		return draftRow{}, fmt.Errorf("%w: load theme draft", ErrUnavailable)
	}
	return row, nil
}

func (s *Service) loadRevision(ctx context.Context, db bun.IDB, organizationID, themeID string, revision int) (revisionRow, error) {
	var row revisionRow
	err := db.NewSelect().Model(&row).Where("theme_id = ? AND organization_id = ? AND revision = ?", themeID, organizationID, revision).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return revisionRow{}, ErrNotFound
	}
	if err != nil {
		return revisionRow{}, fmt.Errorf("%w: load published theme", ErrUnavailable)
	}
	return row, nil
}

func normalizeIdentity(organizationID, name string) (string, string, string, error) {
	organizationID = strings.TrimSpace(organizationID)
	name = strings.TrimSpace(name)
	if organizationID == "" || name == "" || len([]rune(name)) > 80 {
		return "", "", "", fmt.Errorf("%w: organization_id and a name of at most 80 characters are required", ErrInvalidInput)
	}
	return organizationID, name, strings.ToLower(name), nil
}

func normalizeDraftManifest(themeID string, revision int, name string, manifest ThemeManifest) (ThemeManifest, string, error) {
	manifest.SchemaVersion = ManifestSchemaVersion
	manifest.ID = themeID
	manifest.Revision = fmt.Sprintf("draft-%d", revision)
	manifest.Name = name
	manifest.SupportedSchemes = supportedSchemes(manifest.Schemes)
	return normalizeAndEncodeManifest(manifest)
}

func normalizeAndEncodeManifest(manifest ThemeManifest) (ThemeManifest, string, error) {
	normalized, err := NormalizeManifest(manifest)
	if err != nil {
		return ThemeManifest{}, "", err
	}
	encoded, err := json.Marshal(normalized)
	if err != nil {
		return ThemeManifest{}, "", fmt.Errorf("%w: encode manifest", ErrUnavailable)
	}
	return normalized, string(encoded), nil
}

func decodeStoredManifest(raw string) (ThemeManifest, error) {
	manifest, err := DecodeManifest([]byte(raw))
	if err != nil {
		return ThemeManifest{}, fmt.Errorf("%w: %v", errStoredManifest, err)
	}
	return manifest, nil
}

func supportedSchemes(manifests SchemeManifests) []ColorScheme {
	result := []ColorScheme{}
	if manifests.Light != nil {
		result = append(result, SchemeLight)
	}
	if manifests.Dark != nil {
		result = append(result, SchemeDark)
	}
	return result
}

func summaryFromRows(row themeRow, draft draftRow, manifest ThemeManifest) ThemeSummary {
	version := row.LatestPublishedRevision
	if version < 1 {
		version = 1
	}
	return ThemeSummary{Reference: ThemeReference{Kind: ReferenceCustom, ID: row.ID, Version: version}, OrganizationID: row.OrganizationID, Name: row.Name, Description: manifest.Description, IconPack: manifest.IconPack, DraftRevision: draft.Revision, PublishedRevision: row.LatestPublishedRevision, SupportedSchemes: manifest.SupportedSchemes, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}
}

func workspaceOrganization(ctx context.Context, db bun.IDB, workspaceID string) (string, error) {
	var row models.Workspace
	err := db.NewSelect().Model(&row).Column("organization_id").Where("id = ?", workspaceID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("%w: load Workspace", ErrUnavailable)
	}
	return row.OrganizationID, nil
}

func loadSettings(ctx context.Context, db bun.IDB, organizationID string) (settingsRow, error) {
	var row settingsRow
	err := db.NewSelect().Model(&row).Where("organization_id = ?", organizationID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		workshop := builtInReference(BuiltIns()["workshop"])
		return settingsRow{OrganizationID: organizationID, DefaultReferenceKind: string(workshop.Kind), DefaultReferenceID: workshop.ID, DefaultReferenceVersion: workshop.Version}, nil
	}
	if err != nil {
		return settingsRow{}, fmt.Errorf("%w: load Organization theme settings", ErrUnavailable)
	}
	return row, nil
}

func (r settingsRow) Reference() ThemeReference {
	return ThemeReference{Kind: ReferenceKind(r.DefaultReferenceKind), ID: r.DefaultReferenceID, Version: r.DefaultReferenceVersion}
}

func (r assignmentRow) Reference() ThemeReference {
	return ThemeReference{Kind: ReferenceKind(r.ReferenceKind), ID: r.ReferenceID, Version: r.ReferenceVersion}
}

func authorizeOrganization(ctx context.Context, db bun.IDB, actor Actor, organizationID string) error {
	actor.UserID = strings.TrimSpace(actor.UserID)
	if actor.UserID == "" {
		return ErrInaccessible
	}
	if strings.TrimSpace(actor.CredentialWorkspaceID) != "" {
		return ErrInaccessible
	}
	var member models.OrganizationMember
	err := db.NewSelect().Model(&member).Where("organization_id = ? AND user_id = ?", organizationID, actor.UserID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrInaccessible
	}
	if err != nil {
		return fmt.Errorf("%w: authorize Organization membership", ErrUnavailable)
	}
	if member.Role != models.OrganizationRoleOwner && member.Role != models.OrganizationRoleAdmin {
		return ErrInaccessible
	}
	decision, err := identity.EvaluateOrganizationAccess(ctx, db, organizationID, actor.UserID, actor.SessionID, actor.TokenID)
	if err != nil {
		return fmt.Errorf("%w: evaluate Organization identity policy", ErrUnavailable)
	}
	if !decision.Allowed {
		return ErrInaccessible
	}
	return nil
}

func workspaceActor(actor Actor) workspaceaccess.ActorFacts {
	return workspaceaccess.ActorFacts{UserID: actor.UserID, SessionID: actor.SessionID, TokenID: actor.TokenID, ClientID: actor.ClientID, CredentialWorkspaceID: actor.CredentialWorkspaceID}
}

func exactlyOne(result sql.Result) (bool, error) {
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func writeError(err error, operation string) error {
	for _, known := range []error{ErrInvalidInput, ErrInvalidManifest, ErrNotFound, ErrInaccessible, ErrConflict, ErrRevisionConflict, ErrAssignmentLocked, ErrThemeInUse, ErrUnsupportedScheme, ErrInvalidAsset} {
		if errors.Is(err, known) {
			return err
		}
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "unique") || strings.Contains(message, "duplicate key") {
		return fmt.Errorf("%w: duplicate theme name", ErrConflict)
	}
	return fmt.Errorf("%w: %s", ErrUnavailable, operation)
}
