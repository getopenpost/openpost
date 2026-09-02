package themes

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/uptrace/bun"
)

var (
	errUnsafeResource = errors.New("theme references an unsafe resource")
	errResourceFailed = errors.New("theme resource is unavailable")
)

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
		len(row.NativeChecksumSHA256) == 64
}

func resourceObjectKeys(row assetRow) []string {
	keys := []string{row.ObjectKey}
	if row.Kind == AssetFont {
		keys = append(keys, row.NativeObjectKey)
	}
	return keys
}

func (s *Service) resourcesAvailable(ctx context.Context, organizationID string, manifest ThemeManifest) error {
	requirements := manifestResourceRequirements(manifest)
	if len(requirements) == 0 {
		return nil
	}
	if s == nil || s.db == nil {
		return ErrUnavailable
	}
	if s.storage == nil {
		return errResourceFailed
	}
	for assetID, requirement := range requirements {
		var row assetRow
		err := s.db.NewSelect().Model(&row).Where("id = ? AND organization_id = ?", assetID, organizationID).Scan(ctx)
		if errors.Is(err, sql.ErrNoRows) {
			return errUnsafeResource
		}
		if err != nil {
			return fmt.Errorf("%w: load resolved resource", ErrUnavailable)
		}
		if err := validateResourceMetadata(row, requirement); err != nil {
			return errUnsafeResource
		}
		for _, objectKey := range resourceObjectKeys(row) {
			reader, err := s.storage.Open(ctx, objectKey)
			if err != nil {
				return errResourceFailed
			}
			if err := reader.Close(); err != nil {
				return errResourceFailed
			}
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
