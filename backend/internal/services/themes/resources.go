package themes

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"path"
	"slices"
	"strings"

	"github.com/uptrace/bun"
)

var (
	errUnsafeResource = errors.New("theme references an unsafe resource")
	errResourceFailed = errors.New("theme resource is unavailable")
)

const sha256HexLength = 64

var bundledFontFamilies = map[string]struct{}{
	"Anton": {}, "Arial": {}, "Bebas Neue": {}, "Courier New": {},
	"DM Sans Variable": {}, "Geist Mono Variable": {}, "Geist Variable": {}, "Georgia": {},
	"Inter Tight Variable": {}, "Inter Variable": {}, "Manrope Variable": {},
	"Orbitron Variable": {}, "Playfair Display Variable": {}, "Roboto": {},
	"Roboto Slab": {}, "SFMono-Regular": {}, "Source Serif 4 Variable": {},
	"Space Grotesk Variable": {}, "Times New Roman": {}, "system-ui": {},
}

type resourceRequirement struct {
	font  *ThemeFontFace
	asset *ThemeAsset
}

func validateManifestFontAvailability(manifest ThemeManifest) error {
	faces := map[string]map[int]map[string]struct{}{}
	for index := range manifest.Fonts {
		font := &manifest.Fonts[index]
		if faces[font.Family] == nil {
			faces[font.Family] = map[int]map[string]struct{}{}
		}
		if faces[font.Family][font.Weight] == nil {
			faces[font.Family][font.Weight] = map[string]struct{}{}
		}
		faces[font.Family][font.Weight][font.Style] = struct{}{}
	}
	for _, scheme := range []struct {
		path     string
		manifest *ThemeSchemeManifest
	}{{"light", manifest.Schemes.Light}, {"dark", manifest.Schemes.Dark}} {
		if scheme.manifest == nil {
			continue
		}
		roles := []struct {
			path string
			role ThemeTypographyRoleTokens
		}{
			{"display", scheme.manifest.Typography.Display}, {"title", scheme.manifest.Typography.Title},
			{"body", scheme.manifest.Typography.Body}, {"label", scheme.manifest.Typography.Label},
			{"metadata", scheme.manifest.Typography.Metadata}, {"code", scheme.manifest.Typography.Code},
		}
		for _, item := range roles {
			if _, bundled := bundledFontFamilies[item.role.Family]; bundled {
				continue
			}
			weights := faces[item.role.Family]
			styles := weights[item.role.Weight]
			if _, uploaded := styles["normal"]; !uploaded {
				return invalidManifest("schemes."+scheme.path+".typography."+item.path+".family", "is not bundled and has no matching normal Organization WOFF2 face")
			}
		}
	}
	return nil
}

func manifestResourceRequirements(manifest ThemeManifest) map[string]resourceRequirement {
	result := make(map[string]resourceRequirement, len(manifest.Fonts)+len(manifest.Assets))
	for index := range manifest.Fonts {
		font := &manifest.Fonts[index]
		result[font.ID] = resourceRequirement{font: font}
	}
	for index := range manifest.Assets {
		asset := &manifest.Assets[index]
		result[asset.ID] = resourceRequirement{asset: asset}
	}
	return result
}

//nolint:gocyclo // Each finite resource kind has independent ownership, MIME, dimension, and font metadata invariants.
func validateResourceMetadata(row assetRow, requirement resourceRequirement) error {
	if !validStoredAssetMetadata(row) {
		return fmt.Errorf("%w: stored resource metadata is invalid", ErrInvalidManifest)
	}
	if requirement.font != nil {
		font := requirement.font
		if row.Kind != AssetFont || row.MediaType != "font/woff2" || row.FontFamily != font.Family || row.FontStyle != font.Style || row.FontWeight != font.Weight || !row.LicenseAcknowledged || !validNativeFontMetadata(row) {
			return fmt.Errorf("%w: font resource metadata does not match the manifest", ErrInvalidManifest)
		}
		return nil
	}
	asset := requirement.asset
	if asset == nil || row.Kind == AssetFont || row.MediaType != asset.MimeType {
		return fmt.Errorf("%w: decorative resource metadata does not match the manifest", ErrInvalidManifest)
	}
	if strings.HasSuffix(asset.Slot, "illustration") && row.Kind != AssetIllustration {
		return fmt.Errorf("%w: illustration slot requires an illustration asset", ErrInvalidManifest)
	}
	if asset.Slot == "background-texture" && row.Kind != AssetTexture && row.Kind != AssetBackground {
		return fmt.Errorf("%w: background texture slot requires a texture or background asset", ErrInvalidManifest)
	}
	return nil
}

func validNativeFontMetadata(row assetRow) bool {
	return row.NativeObjectKey != "" &&
		nativeFormat(row.NativeMediaType) != "" &&
		row.NativeSizeBytes > 0 && row.NativeSizeBytes <= maxDecodedThemeFontBytes &&
		validSHA256(row.NativeChecksumSHA256)
}

func validStoredAssetMetadata(row assetRow) bool {
	if row.ID == "" || path.Base(row.ID) != row.ID || row.OrganizationID == "" || path.Base(row.OrganizationID) != row.OrganizationID ||
		row.SizeBytes < 1 || !validSHA256(row.ChecksumSHA256) {
		return false
	}
	objectPrefix := path.Join("theme-assets", row.OrganizationID, row.ID)
	switch row.Kind {
	case AssetFont:
		return validStoredFontMetadata(row, objectPrefix)
	case AssetBackground, AssetTexture, AssetIllustration:
		return validStoredRasterMetadata(row, objectPrefix)
	default:
		return false
	}
}

func validStoredFontMetadata(row assetRow, objectPrefix string) bool {
	return row.MediaType == "font/woff2" && row.ObjectKey == objectPrefix+".woff2" && row.SizeBytes <= maxThemeFontBytes &&
		fontFamilyPattern.MatchString(row.FontFamily) && !strings.Contains(row.FontFamily, ":") &&
		(row.FontStyle == "normal" || row.FontStyle == "italic") &&
		row.FontWeight >= 100 && row.FontWeight <= 900 && row.FontWeight%100 == 0 &&
		row.LicenseAcknowledged && validNativeFontMetadata(row) &&
		row.NativeObjectKey == objectPrefix+"."+nativeFormat(row.NativeMediaType)
}

func validStoredRasterMetadata(row assetRow, objectPrefix string) bool {
	if row.SizeBytes > maxThemeImageBytes || row.Width < 1 || row.Height < 1 ||
		row.Width > 8192 || row.Height > 8192 || int64(row.Width)*int64(row.Height) > 32_000_000 {
		return false
	}
	extension, supported := storedRasterExtension(row.MediaType)
	return supported && row.ObjectKey == objectPrefix+extension
}

func storedRasterExtension(mediaType string) (string, bool) {
	switch mediaType {
	case "image/png":
		return ".png", true
	case "image/jpeg":
		return ".jpg", true
	case "image/webp":
		return ".webp", true
	case "image/avif":
		return ".avif", true
	default:
		return "", false
	}
}

func validSHA256(value string) bool {
	if len(value) != sha256HexLength {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func resourceObjectKeys(row assetRow) []string {
	keys := []string{row.ObjectKey}
	if row.Kind == AssetFont {
		keys = append(keys, row.NativeObjectKey)
	}
	return keys
}

// publishedResourcesAvailable verifies the immutable database evidence recorded
// at publish time. Blob existence is proved before the revision commits and is
// checked again by client staging when the exact resource is fetched. Ordinary
// theme resolution must not turn into one remote storage operation per asset.
func (s *Service) publishedResourcesAvailable(ctx context.Context, organizationID, themeID string, revision int, manifest ThemeManifest) error {
	requirements := manifestResourceRequirements(manifest)
	if len(requirements) == 0 {
		return nil
	}
	if s == nil || s.db == nil {
		return ErrUnavailable
	}
	for assetID, requirement := range requirements {
		linked, err := s.db.NewSelect().Model((*revisionAssetRow)(nil)).
			Where("theme_id = ? AND revision = ? AND asset_id = ?", themeID, revision, assetID).
			Exists(ctx)
		if err != nil {
			return fmt.Errorf("%w: load published resource link", ErrUnavailable)
		}
		if !linked {
			return errUnsafeResource
		}
		var row assetRow
		err = s.db.NewSelect().Model(&row).Where("id = ? AND organization_id = ?", assetID, organizationID).Scan(ctx)
		if errors.Is(err, sql.ErrNoRows) {
			return errUnsafeResource
		}
		if err != nil {
			return fmt.Errorf("%w: load resolved resource", ErrUnavailable)
		}
		if err := validateResourceMetadata(row, requirement); err != nil {
			return errUnsafeResource
		}
	}
	return nil
}

func (s *Service) loadPublishedResourceSets(ctx context.Context, organizationID string, themes []customSummaryRow) (map[string]map[string]assetRow, error) {
	result, themeRevisions, hasRequirements := initializePublishedResourceSets(themes)
	if !hasRequirements {
		return result, nil
	}
	linked, linkedAssetIDs, err := s.loadPublishedResourceLinks(ctx, themeRevisions)
	if err != nil {
		return nil, err
	}
	assetsByID, err := s.loadPublishedAssets(ctx, organizationID, linkedAssetIDs)
	if err != nil {
		return nil, err
	}
	mergePublishedResourceSets(result, linked, assetsByID)
	return result, nil
}

func initializePublishedResourceSets(themes []customSummaryRow) (map[string]map[string]assetRow, map[string]int, bool) {
	result := make(map[string]map[string]assetRow, len(themes))
	themeRevisions := make(map[string]int, len(themes))
	hasRequirements := false
	for _, theme := range themes {
		result[theme.ThemeID] = map[string]assetRow{}
		themeRevisions[theme.ThemeID] = theme.LatestPublishedRevision
		manifest, err := decodeStoredManifest(theme.ManifestJSON)
		if err == nil && len(manifestResourceRequirements(manifest)) > 0 {
			hasRequirements = true
		}
	}
	return result, themeRevisions, hasRequirements
}

func (s *Service) loadPublishedResourceLinks(ctx context.Context, themeRevisions map[string]int) (map[string]map[string]struct{}, []string, error) {
	themeIDs := make([]string, 0, len(themeRevisions))
	for themeID := range themeRevisions {
		themeIDs = append(themeIDs, themeID)
	}
	slices.Sort(themeIDs)
	conditions := make([]string, 0, len(themeIDs))
	conditionArgs := make([]any, 0, len(themeIDs)*2)
	for _, themeID := range themeIDs {
		conditions = append(conditions, "(link.theme_id = ? AND link.revision = ?)")
		conditionArgs = append(conditionArgs, themeID, themeRevisions[themeID])
	}
	var links []revisionAssetRow
	if err := s.db.NewSelect().Model(&links).ModelTableExpr("organization_theme_revision_assets AS link").ExcludeColumn("*").
		ColumnExpr("link.theme_id AS theme_id, link.revision AS revision, link.asset_id AS asset_id").
		Where(strings.Join(conditions, " OR "), conditionArgs...).
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, nil, fmt.Errorf("%w: load published resource links: %v", ErrUnavailable, err)
	}
	linked := make(map[string]map[string]struct{}, len(themeIDs))
	linkedAssetIDs := make([]string, 0, len(links))
	for _, link := range links {
		if themeRevisions[link.ThemeID] != link.Revision {
			continue
		}
		if linked[link.ThemeID] == nil {
			linked[link.ThemeID] = map[string]struct{}{}
		}
		linked[link.ThemeID][link.AssetID] = struct{}{}
		linkedAssetIDs = append(linkedAssetIDs, link.AssetID)
	}
	slices.Sort(linkedAssetIDs)
	linkedAssetIDs = slices.Compact(linkedAssetIDs)
	return linked, linkedAssetIDs, nil
}

func (s *Service) loadPublishedAssets(ctx context.Context, organizationID string, linkedAssetIDs []string) (map[string]assetRow, error) {
	if len(linkedAssetIDs) == 0 {
		return map[string]assetRow{}, nil
	}
	var assets []assetRow
	if err := s.db.NewSelect().Model(&assets).
		Where("organization_id = ? AND id IN (?)", organizationID, bun.List(linkedAssetIDs)).
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: load published resources: %v", ErrUnavailable, err)
	}
	assetsByID := make(map[string]assetRow, len(assets))
	for _, asset := range assets {
		assetsByID[asset.ID] = asset
	}
	return assetsByID, nil
}

func mergePublishedResourceSets(result map[string]map[string]assetRow, linked map[string]map[string]struct{}, assetsByID map[string]assetRow) {
	for themeID, themeLinks := range linked {
		for assetID := range themeLinks {
			if asset, ok := assetsByID[assetID]; ok {
				result[themeID][assetID] = asset
			}
		}
	}
}

func validatePublishedResourceSet(manifest ThemeManifest, resources map[string]assetRow) error {
	for assetID, requirement := range manifestResourceRequirements(manifest) {
		row, ok := resources[assetID]
		if !ok || validateResourceMetadata(row, requirement) != nil {
			return errUnsafeResource
		}
	}
	return nil
}

func (s *Service) replaceRevisionAssets(ctx context.Context, db bun.IDB, organizationID, themeID string, revision int, manifest ThemeManifest) error {
	if err := validateManifestFontAvailability(manifest); err != nil {
		return err
	}
	assetIDs, err := s.validateOwnedResources(ctx, db, organizationID, manifest)
	if err != nil {
		return err
	}
	for _, assetID := range assetIDs {
		row := revisionAssetRow{ThemeID: themeID, Revision: revision, AssetID: assetID}
		if _, err := db.NewInsert().Model(&row).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) replaceDraftAssets(ctx context.Context, db bun.IDB, organizationID, themeID string, manifest ThemeManifest) error {
	assetIDs, err := s.validateOwnedResources(ctx, db, organizationID, manifest)
	if err != nil {
		return err
	}
	if _, err := db.NewDelete().Model((*draftAssetRow)(nil)).Where("theme_id = ?", themeID).Exec(ctx); err != nil {
		return err
	}
	for _, assetID := range assetIDs {
		row := draftAssetRow{ThemeID: themeID, AssetID: assetID}
		if _, err := db.NewInsert().Model(&row).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) validateOwnedResources(ctx context.Context, db bun.IDB, organizationID string, manifest ThemeManifest) ([]string, error) {
	requirements := manifestResourceRequirements(manifest)
	assetIDs := make([]string, 0, len(requirements))
	for assetID, requirement := range requirements {
		var asset assetRow
		err := db.NewSelect().Model(&asset).Where("id = ? AND organization_id = ?", assetID, organizationID).Scan(ctx)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("%w: referenced asset does not exist in this Organization", ErrInvalidManifest)
		}
		if err != nil {
			return nil, err
		}
		if err := validateResourceMetadata(asset, requirement); err != nil {
			return nil, err
		}
		if s.storage == nil {
			return nil, fmt.Errorf("%w: validate referenced asset storage", ErrUnavailable)
		}
		for _, objectKey := range resourceObjectKeys(asset) {
			reader, openErr := s.storage.Open(ctx, objectKey)
			if openErr != nil {
				return nil, fmt.Errorf("%w: referenced asset content is unavailable", ErrUnavailable)
			}
			if closeErr := reader.Close(); closeErr != nil {
				return nil, fmt.Errorf("%w: close referenced asset", ErrUnavailable)
			}
		}
		assetIDs = append(assetIDs, assetID)
	}
	slices.Sort(assetIDs)
	return assetIDs, nil
}
