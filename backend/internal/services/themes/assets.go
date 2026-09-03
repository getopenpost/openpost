package themes

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"image"

	// Register the standard JPEG decoder used by image.DecodeConfig.
	_ "image/jpeg"
	// Register the standard PNG decoder used by image.DecodeConfig.
	_ "image/png"
	"io"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/gen2brain/avif"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"

	// Register the maintained WebP decoder used by image.DecodeConfig.
	_ "golang.org/x/image/webp"
)

const (
	maxThemeFontBytes       = 2 * 1024 * 1024
	maxThemeImageBytes      = 5 * 1024 * 1024
	themeAssetCleanupWindow = 30 * time.Second
)

type assetRow struct {
	bun.BaseModel        `bun:"table:organization_theme_assets"`
	ID                   string         `bun:"id,pk"`
	OrganizationID       string         `bun:"organization_id,notnull"`
	Kind                 ThemeAssetKind `bun:"kind,notnull"`
	Name                 string         `bun:"name,notnull"`
	MediaType            string         `bun:"media_type,notnull"`
	ObjectKey            string         `bun:"object_key,notnull"`
	SizeBytes            int64          `bun:"size_bytes,notnull"`
	Width                int            `bun:"width,notnull"`
	Height               int            `bun:"height,notnull"`
	ChecksumSHA256       string         `bun:"checksum_sha256,notnull"`
	NativeObjectKey      string         `bun:"native_object_key,notnull"`
	NativeMediaType      string         `bun:"native_media_type,notnull"`
	NativeSizeBytes      int64          `bun:"native_size_bytes,notnull"`
	NativeChecksumSHA256 string         `bun:"native_checksum_sha256,notnull"`
	FontFamily           string         `bun:"font_family,notnull"`
	FontStyle            string         `bun:"font_style,notnull"`
	FontWeight           int            `bun:"font_weight,notnull"`
	LicenseAcknowledged  bool           `bun:"license_acknowledged,notnull"`
	CreatedBy            string         `bun:"created_by,notnull"`
	CreatedAt            time.Time      `bun:"created_at,notnull"`
}

type revisionAssetRow struct {
	bun.BaseModel `bun:"table:organization_theme_revision_assets"`
	ThemeID       string `bun:"theme_id,pk"`
	Revision      int    `bun:"revision,pk"`
	AssetID       string `bun:"asset_id,pk"`
}

type draftAssetRow struct {
	bun.BaseModel `bun:"table:organization_theme_draft_assets"`
	ThemeID       string `bun:"theme_id,pk"`
	AssetID       string `bun:"asset_id,pk"`
}

type UploadAssetInput struct {
	OrganizationID      string
	Kind                ThemeAssetKind
	Name                string
	MediaType           string
	FontFamily          string
	FontStyle           string
	FontWeight          int
	LicenseAcknowledged bool
	Content             io.Reader
}

type AssetContent struct {
	Reader         io.ReadCloser
	MediaType      string
	SizeBytes      int64
	ChecksumSHA256 string
	ETag           string
}

type AssetAccessScope struct {
	OrganizationID string
	WorkspaceID    string
	ThemeID        string
	Revision       int
	Format         string
}

func NewWithStorage(db *bun.DB, storage mediastore.BlobStorage) *Service {
	service := New(db)
	service.storage = storage
	return service
}

func (s *Service) ListAssets(ctx context.Context, actor Actor, organizationID string, options PageOptions) (ThemeAssetPage, error) {
	organizationID = strings.TrimSpace(organizationID)
	if organizationID == "" {
		return ThemeAssetPage{}, fmt.Errorf("%w: organization_id is required", ErrInvalidInput)
	}
	if s == nil || s.db == nil {
		return ThemeAssetPage{}, ErrUnavailable
	}
	if err := authorizeOrganization(ctx, s.db, actor, organizationID); err != nil {
		return ThemeAssetPage{}, err
	}
	options, err := normalizePageOptions(options)
	if err != nil {
		return ThemeAssetPage{}, err
	}
	scope := themeCursorScope("assets", organizationID)
	cursor, err := decodeThemeCursor(options.Cursor, scope, cursorSegmentAsset)
	if err != nil {
		return ThemeAssetPage{}, err
	}
	var rows []assetRow
	query := s.db.NewSelect().Model(&rows).Where("organization_id = ?", organizationID)
	if !cursor.CreatedAt.IsZero() {
		query = query.Where("created_at < ? OR (created_at = ? AND id > ?)", cursor.CreatedAt, cursor.CreatedAt, cursor.ID)
	}
	if err := query.OrderExpr("created_at DESC, id ASC").Limit(options.Limit + 1).Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return ThemeAssetPage{}, fmt.Errorf("%w: list theme assets", ErrUnavailable)
	}
	page := ThemeAssetPage{Items: make([]ThemeAssetRecord, 0, min(len(rows), options.Limit))}
	if len(rows) > options.Limit {
		rows = rows[:options.Limit]
		last := rows[len(rows)-1]
		page.NextCursor = encodeThemeCursor(themePageCursor{Scope: scope, Segment: cursorSegmentAsset, CreatedAt: last.CreatedAt.UTC(), ID: last.ID})
	}
	for _, row := range rows {
		page.Items = append(page.Items, s.assetFromRow(row))
	}
	return page, nil
}

//nolint:gocyclo // Upload is one trust boundary for authorization, bounded decoding, metadata validation, and atomic persistence.
func (s *Service) UploadAsset(ctx context.Context, actor Actor, input UploadAssetInput) (ThemeAssetRecord, error) {
	organizationID := strings.TrimSpace(input.OrganizationID)
	name := strings.TrimSpace(input.Name)
	if organizationID == "" || name == "" || len([]rune(name)) > 120 || input.Content == nil {
		return ThemeAssetRecord{}, fmt.Errorf("%w: organization_id, name, and content are required", ErrInvalidAsset)
	}
	if s == nil || s.db == nil || s.storage == nil {
		return ThemeAssetRecord{}, ErrUnavailable
	}
	// Check access before any blob can be written, then check again inside the
	// Organization transaction that publishes its metadata.
	if err := authorizeOrganization(ctx, s.db, actor, organizationID); err != nil {
		return ThemeAssetRecord{}, err
	}
	mediaType := strings.ToLower(strings.TrimSpace(input.MediaType))
	limit, extension, err := validateAssetMetadata(input, mediaType)
	if err != nil {
		return ThemeAssetRecord{}, err
	}
	content, err := io.ReadAll(io.LimitReader(input.Content, int64(limit)+1))
	if err != nil {
		return ThemeAssetRecord{}, fmt.Errorf("%w: read upload", ErrInvalidAsset)
	}
	if len(content) == 0 || len(content) > limit {
		return ThemeAssetRecord{}, fmt.Errorf("%w: content must contain at most %d bytes", ErrInvalidAsset, limit)
	}
	width, height := 0, 0
	var native nativeFontDerivative
	if input.Kind == AssetFont {
		native, err = prepareNativeFontDerivative(content, input.FontFamily, input.FontWeight, strings.ToLower(strings.TrimSpace(input.FontStyle)))
		if err != nil {
			return ThemeAssetRecord{}, err
		}
	} else {
		width, height, err = validateRasterDimensions(mediaType, content)
		if err != nil {
			return ThemeAssetRecord{}, err
		}
	}
	hash := sha256.Sum256(content)
	id := s.newID()
	objectKey := path.Join("theme-assets", organizationID, id+extension)
	if _, err := s.storage.Save(ctx, objectKey, bytes.NewReader(content)); err != nil {
		return ThemeAssetRecord{}, fmt.Errorf("%w: store theme asset", ErrUnavailable)
	}
	nativeObjectKey := ""
	if len(native.Content) > 0 {
		nativeObjectKey = path.Join("theme-assets", organizationID, id+"."+native.Format)
		if _, err := s.storage.Save(ctx, nativeObjectKey, bytes.NewReader(native.Content)); err != nil {
			s.cleanupUncommittedAssetBlobs(ctx, objectKey)
			return ThemeAssetRecord{}, fmt.Errorf("%w: store native font derivative", ErrUnavailable)
		}
	}
	now := s.now().UTC()
	row := assetRow{
		ID: id, OrganizationID: organizationID, Kind: input.Kind, Name: name,
		MediaType: mediaType, ObjectKey: objectKey, SizeBytes: int64(len(content)), Width: width, Height: height, ChecksumSHA256: hex.EncodeToString(hash[:]),
		NativeObjectKey: nativeObjectKey, NativeMediaType: native.MediaType, NativeSizeBytes: int64(len(native.Content)), NativeChecksumSHA256: native.ChecksumSHA256,
		FontFamily: strings.TrimSpace(input.FontFamily), FontStyle: strings.ToLower(strings.TrimSpace(input.FontStyle)),
		FontWeight: input.FontWeight, LicenseAcknowledged: input.LicenseAcknowledged, CreatedBy: actor.UserID, CreatedAt: now,
	}
	err = organizationguard.WithOrganization(ctx, s.db, organizationID, func(txCtx context.Context, db bun.IDB) error {
		if accessErr := authorizeOrganization(txCtx, db, actor, organizationID); accessErr != nil {
			return accessErr
		}
		_, insertErr := db.NewInsert().Model(&row).Exec(txCtx)
		return insertErr
	})
	if err != nil {
		s.cleanupUncommittedAssetBlobs(ctx, objectKey, nativeObjectKey)
		return ThemeAssetRecord{}, writeError(err, "create theme asset")
	}
	return s.assetFromRow(row), nil
}

func (s *Service) cleanupUncommittedAssetBlobs(ctx context.Context, objectKeys ...string) {
	failed := make([]string, 0, len(objectKeys))
	for _, objectKey := range objectKeys {
		if objectKey == "" {
			continue
		}
		if err := mediastore.DeleteForCleanup(ctx, s.storage, objectKey); err != nil {
			failed = append(failed, objectKey)
		}
	}
	if len(failed) == 0 || s.db == nil {
		return
	}
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), themeAssetCleanupWindow)
	defer cancel()
	_, _ = jobregistry.EnqueueStorageDeletes(cleanupCtx, s.db, failed)
}

//nolint:gocyclo // Deletion keeps authorization, draft/revision reachability guards, and blob cleanup in one boundary.
func (s *Service) DeleteAsset(ctx context.Context, actor Actor, organizationID, assetID string) error {
	organizationID = strings.TrimSpace(organizationID)
	assetID = strings.TrimSpace(assetID)
	if organizationID == "" || assetID == "" {
		return fmt.Errorf("%w: organization_id and asset_id are required", ErrInvalidInput)
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
		var row assetRow
		if loadErr := db.NewSelect().Model(&row).Where("id = ? AND organization_id = ?", assetID, organizationID).Scan(txCtx); loadErr != nil {
			if errors.Is(loadErr, sql.ErrNoRows) {
				return ErrNotFound
			}
			return loadErr
		}
		used, countErr := db.NewSelect().Model((*revisionAssetRow)(nil)).Where("asset_id = ?", assetID).Count(txCtx)
		if countErr != nil {
			return countErr
		}
		draftUsed, countErr := db.NewSelect().Model((*draftAssetRow)(nil)).Where("asset_id = ?", assetID).Count(txCtx)
		if countErr != nil {
			return countErr
		}
		if used > 0 || draftUsed > 0 {
			return ErrThemeInUse
		}
		objectKeys := []string{row.ObjectKey}
		if row.NativeObjectKey != "" {
			objectKeys = append(objectKeys, row.NativeObjectKey)
		}
		if _, enqueueErr := jobregistry.EnqueueStorageDeletes(txCtx, db, objectKeys); enqueueErr != nil {
			return enqueueErr
		}
		result, deleteErr := db.NewDelete().Model((*assetRow)(nil)).Where("id = ? AND organization_id = ?", assetID, organizationID).Exec(txCtx)
		if deleteErr != nil {
			return deleteErr
		}
		if one, affectedErr := exactlyOne(result); affectedErr != nil || !one {
			return ErrNotFound
		}
		return nil
	})
	if err != nil {
		return writeError(err, "delete theme asset")
	}
	return nil
}

//nolint:gocyclo // The finite access scopes deliberately keep every non-enumerating authorization and reachability check together.
func (s *Service) OpenAsset(ctx context.Context, actor Actor, assetID string, scope AssetAccessScope) (AssetContent, error) {
	assetID = strings.TrimSpace(assetID)
	scope.OrganizationID = strings.TrimSpace(scope.OrganizationID)
	scope.WorkspaceID = strings.TrimSpace(scope.WorkspaceID)
	scope.ThemeID = strings.TrimSpace(scope.ThemeID)
	scope.Format = strings.ToLower(strings.TrimSpace(scope.Format))
	if scope.Format != "" && scope.Format != "ttf" && scope.Format != "otf" {
		return AssetContent{}, fmt.Errorf("%w: format must be ttf or otf", ErrInvalidInput)
	}
	organizationScope := scope.OrganizationID != "" && scope.WorkspaceID == "" && scope.ThemeID == "" && scope.Revision == 0
	resolvedScope := scope.OrganizationID == "" && scope.WorkspaceID != "" && scope.ThemeID == "" && scope.Revision == 0
	publishedScope := scope.OrganizationID == "" && scope.WorkspaceID != "" && scope.ThemeID != "" && scope.Revision > 0
	if assetID == "" || (!organizationScope && !resolvedScope && !publishedScope) {
		return AssetContent{}, fmt.Errorf("%w: asset_id and one complete Organization, resolved Workspace, or published preview scope are required", ErrInvalidInput)
	}
	if s == nil || s.db == nil || s.storage == nil {
		return AssetContent{}, ErrUnavailable
	}
	var row assetRow
	if err := s.db.NewSelect().Model(&row).Where("id = ?", assetID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AssetContent{}, ErrNotFound
		}
		return AssetContent{}, fmt.Errorf("%w: load theme asset", ErrUnavailable)
	}
	if !validStoredAssetMetadata(row) {
		return AssetContent{}, ErrNotFound
	}
	if scope.WorkspaceID != "" {
		decision, err := workspaceaccess.NewAuthorizer(s.db).Authorize(ctx, scope.WorkspaceID, workspaceActor(actor), workspaceaccess.LevelRead)
		if err != nil {
			return AssetContent{}, fmt.Errorf("%w: authorize theme asset", ErrUnavailable)
		}
		if !decision.Allowed || decision.OrganizationID != row.OrganizationID {
			return AssetContent{}, ErrNotFound
		}
		themeID, revision := scope.ThemeID, scope.Revision
		if resolvedScope {
			selection, selectionErr := s.Selection(ctx, scope.WorkspaceID)
			if selectionErr != nil {
				return AssetContent{}, selectionErr
			}
			if selection.OrganizationID != row.OrganizationID || selection.Reference.Kind != ReferenceCustom {
				return AssetContent{}, ErrNotFound
			}
			themeID, revision = selection.Reference.ID, selection.Reference.Version
		} else if decision.Role != models.WorkspaceRoleAdmin {
			selection, selectionErr := s.Selection(ctx, scope.WorkspaceID)
			if selectionErr != nil {
				return AssetContent{}, selectionErr
			}
			// One previous revision keeps client staging stable when a publish
			// commits between resolving the manifest and fetching its resources.
			if selection.OrganizationID != row.OrganizationID || selection.Reference.Kind != ReferenceCustom ||
				selection.Reference.ID != themeID || selection.Reference.Version < revision || selection.Reference.Version-revision > 1 {
				return AssetContent{}, ErrNotFound
			}
		}
		if _, revisionErr := s.loadRevision(ctx, s.db, decision.OrganizationID, themeID, revision); revisionErr != nil {
			if errors.Is(revisionErr, ErrNotFound) {
				return AssetContent{}, ErrNotFound
			}
			return AssetContent{}, revisionErr
		}
		linked, err := s.db.NewSelect().Model((*revisionAssetRow)(nil)).Where("theme_id = ? AND revision = ? AND asset_id = ?", themeID, revision, assetID).Exists(ctx)
		if err != nil {
			return AssetContent{}, fmt.Errorf("%w: authorize published theme asset", ErrUnavailable)
		}
		if !linked {
			return AssetContent{}, ErrNotFound
		}
	} else {
		if scope.OrganizationID != row.OrganizationID {
			return AssetContent{}, ErrNotFound
		}
		if err := authorizeOrganization(ctx, s.db, actor, scope.OrganizationID); err != nil {
			if errors.Is(err, ErrInaccessible) {
				return AssetContent{}, ErrNotFound
			}
			return AssetContent{}, err
		}
	}
	objectKey, mediaType, sizeBytes, checksum := row.ObjectKey, row.MediaType, row.SizeBytes, row.ChecksumSHA256
	if scope.Format != "" {
		if row.Kind != AssetFont || row.NativeMediaType != "font/"+scope.Format || row.NativeObjectKey == "" || row.NativeSizeBytes < 1 || row.NativeChecksumSHA256 == "" {
			return AssetContent{}, ErrNotFound
		}
		objectKey, mediaType, sizeBytes, checksum = row.NativeObjectKey, row.NativeMediaType, row.NativeSizeBytes, row.NativeChecksumSHA256
	}
	reader, err := s.storage.Open(ctx, objectKey)
	if err != nil {
		return AssetContent{}, fmt.Errorf("%w: open theme asset", ErrUnavailable)
	}
	return AssetContent{Reader: reader, MediaType: mediaType, SizeBytes: sizeBytes, ChecksumSHA256: checksum, ETag: `"sha256-` + checksum + `"`}, nil
}

//nolint:gocyclo // Font metadata fields are independently validated against parsed WOFF2 metadata at this upload boundary.
func validateAssetMetadata(input UploadAssetInput, mediaType string) (int, string, error) {
	if input.Kind == AssetFont {
		family := strings.TrimSpace(input.FontFamily)
		style := strings.ToLower(strings.TrimSpace(input.FontStyle))
		if mediaType != "font/woff2" || !fontFamilyPattern.MatchString(family) || strings.Contains(family, ":") || (style != "normal" && style != "italic") || input.FontWeight < 100 || input.FontWeight > 900 || input.FontWeight%100 != 0 || !input.LicenseAcknowledged {
			return 0, "", fmt.Errorf("%w: fonts require WOFF2, family, normal or italic style, 100-step weight, and license acknowledgement", ErrInvalidAsset)
		}
		return maxThemeFontBytes, ".woff2", nil
	}
	if input.Kind != AssetBackground && input.Kind != AssetTexture && input.Kind != AssetIllustration {
		return 0, "", fmt.Errorf("%w: unsupported asset kind", ErrInvalidAsset)
	}
	switch mediaType {
	case "image/png":
		return maxThemeImageBytes, ".png", nil
	case "image/jpeg":
		return maxThemeImageBytes, ".jpg", nil
	case "image/webp":
		return maxThemeImageBytes, ".webp", nil
	case "image/avif":
		return maxThemeImageBytes, ".avif", nil
	default:
		return 0, "", fmt.Errorf("%w: decorative assets must be PNG, JPEG, WebP, or AVIF", ErrInvalidAsset)
	}
}

func validRasterHeader(mediaType string, content []byte) bool {
	switch mediaType {
	case "image/png":
		return len(content) >= 8 && bytes.Equal(content[:8], []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})
	case "image/jpeg":
		return len(content) >= 3 && content[0] == 0xff && content[1] == 0xd8 && content[2] == 0xff
	case "image/webp":
		return len(content) >= 12 && string(content[:4]) == "RIFF" && string(content[8:12]) == "WEBP"
	case "image/avif":
		return len(content) >= 12 && string(content[4:8]) == "ftyp" && (string(content[8:12]) == "avif" || string(content[8:12]) == "avis")
	default:
		return false
	}
}

func validateRasterDimensions(mediaType string, content []byte) (int, int, error) {
	if !validRasterHeader(mediaType, content) {
		return 0, 0, fmt.Errorf("%w: content does not match its raster media type", ErrInvalidAsset)
	}
	var config image.Config
	var err error
	if mediaType == "image/avif" {
		config, err = avif.DecodeConfig(bytes.NewReader(content))
	} else {
		config, _, err = image.DecodeConfig(bytes.NewReader(content))
	}
	if err != nil {
		return 0, 0, fmt.Errorf("%w: raster image could not be decoded", ErrInvalidAsset)
	}
	width, height := config.Width, config.Height
	if width < 1 || height < 1 || width > 8192 || height > 8192 || int64(width)*int64(height) > 32_000_000 {
		return 0, 0, fmt.Errorf("%w: raster dimensions must be at most 8192px per side and 32 megapixels", ErrInvalidAsset)
	}
	var decoded image.Image
	if mediaType == "image/avif" {
		decoded, err = avif.Decode(bytes.NewReader(content))
	} else {
		decoded, _, err = image.Decode(bytes.NewReader(content))
	}
	if err != nil || decoded.Bounds().Dx() != width || decoded.Bounds().Dy() != height {
		return 0, 0, fmt.Errorf("%w: raster image content is incomplete or invalid", ErrInvalidAsset)
	}
	return width, height, nil
}

func (s *Service) assetFromRow(row assetRow) ThemeAssetRecord {
	contentURL := "/api/v1/theme-assets/" + url.PathEscape(row.ID) + "/content?organization_id=" + url.QueryEscape(row.OrganizationID)
	return ThemeAssetRecord{
		ID: row.ID, OrganizationID: row.OrganizationID, Kind: row.Kind, Name: row.Name,
		MediaType: row.MediaType, ObjectKey: row.ObjectKey, URL: contentURL, SizeBytes: row.SizeBytes, Width: row.Width, Height: row.Height,
		ChecksumSHA256: row.ChecksumSHA256, FontFamily: row.FontFamily, FontStyle: row.FontStyle,
		FontWeight: row.FontWeight, LicenseAcknowledged: row.LicenseAcknowledged,
		CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt,
	}
}

func (s *Service) materializeResolvedResourceURLs(ctx context.Context, resolved *ResolvedTheme, workspaceID string) error {
	if resolved.Source != ResolutionOrganization {
		return nil
	}
	revision, err := strconv.Atoi(resolved.Revision)
	if err != nil || revision < 1 || strings.TrimSpace(resolved.ID) == "" {
		return errUnsafeResource
	}
	query := "?workspace_id=" + url.QueryEscape(strings.TrimSpace(workspaceID)) +
		"&theme_id=" + url.QueryEscape(resolved.ID) +
		"&revision=" + strconv.Itoa(revision)
	for index := range resolved.Fonts {
		font := &resolved.Fonts[index]
		row, err := s.loadRuntimeFontAsset(ctx, resolved.organizationID, font.ID)
		if err != nil {
			return err
		}
		font.SourceURL = "/api/v1/theme-assets/" + url.PathEscape(font.ID) + "/content" + query
		font.NativeDerivative = NativeFontDerivative{
			SourceURL: font.SourceURL + "&format=" + nativeFormat(row.NativeMediaType),
			Format:    nativeFormat(row.NativeMediaType), Identity: row.NativeChecksumSHA256,
		}
	}
	for index := range resolved.Assets {
		resolved.Assets[index].SourceURL = "/api/v1/theme-assets/" + url.PathEscape(resolved.Assets[index].ID) + "/content" + query
	}
	return nil
}

func materializePreviewManifestURLs(manifest *ThemeRuntimeManifest, workspaceID, themeID string, revision int, resources map[string]assetRow) error {
	query := "?workspace_id=" + url.QueryEscape(strings.TrimSpace(workspaceID)) +
		"&theme_id=" + url.QueryEscape(strings.TrimSpace(themeID)) +
		"&revision=" + strconv.Itoa(revision)
	for index := range manifest.Fonts {
		font := &manifest.Fonts[index]
		row, ok := resources[font.ID]
		if !ok || !validNativeFontMetadata(row) {
			return errUnsafeResource
		}
		font.SourceURL = "/api/v1/theme-assets/" + url.PathEscape(font.ID) + "/content" + query
		font.NativeDerivative = NativeFontDerivative{
			SourceURL: font.SourceURL + "&format=" + nativeFormat(row.NativeMediaType),
			Format:    nativeFormat(row.NativeMediaType), Identity: row.NativeChecksumSHA256,
		}
	}
	for index := range manifest.Assets {
		manifest.Assets[index].SourceURL = "/api/v1/theme-assets/" + url.PathEscape(manifest.Assets[index].ID) + "/content" + query
	}
	return nil
}

func (s *Service) loadRuntimeFontAsset(ctx context.Context, organizationID, assetID string) (assetRow, error) {
	var row assetRow
	err := s.db.NewSelect().Model(&row).Where("id = ? AND organization_id = ? AND kind = ?", assetID, organizationID, AssetFont).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return assetRow{}, errUnsafeResource
	}
	if err != nil {
		return assetRow{}, fmt.Errorf("%w: load resolved font derivative", ErrUnavailable)
	}
	if !validNativeFontMetadata(row) {
		return assetRow{}, errUnsafeResource
	}
	return row, nil
}

func nativeFormat(mediaType string) string {
	switch mediaType {
	case "font/ttf":
		return "ttf"
	case "font/otf":
		return "otf"
	default:
		return ""
	}
}
