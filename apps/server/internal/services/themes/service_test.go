package themes

import (
	"bytes"
	"context"
	"database/sql"

	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

func TestWorkspaceAssignmentLockAndDeleteGuards(t *testing.T) {
	service, _ := newThemeTestService(t)
	actor := Actor{UserID: "admin-1"}
	theme, err := service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: "Custom", DuplicateBuiltInID: "studio"})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), actor, theme.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1, ExpectedPublishedRevision: 0})
	require.NoError(t, err)
	custom := ThemeReference{Kind: ReferenceCustom, ID: theme.Summary.Reference.ID, Version: 1}

	_, err = service.AssignWorkspace(t.Context(), actor, WorkspaceAssignmentInput{WorkspaceID: "workspace-1", Reference: &custom})
	require.NoError(t, err)
	err = service.Delete(t.Context(), actor, theme.Summary.Reference.ID, DeleteInput{OrganizationID: "org-1"})
	require.ErrorIs(t, err, ErrThemeInUse)

	_, err = service.SetOrganizationSettings(t.Context(), actor, OrganizationSettingsInput{
		OrganizationID: "org-1", DefaultReference: builtInReference(BuiltIns()["workshop"]), AssignmentsLocked: true,
	})
	require.NoError(t, err)
	resolved, err := service.Resolve(t.Context(), actor, ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeLight})
	require.NoError(t, err)
	require.Equal(t, "workshop", resolved.ID, "a lock must apply the Organization default, not a stale Workspace choice")
	_, err = service.AssignWorkspace(t.Context(), actor, WorkspaceAssignmentInput{WorkspaceID: "workspace-1", Reference: nil})
	require.ErrorIs(t, err, ErrAssignmentLocked)

	_, err = service.SetOrganizationSettings(t.Context(), actor, OrganizationSettingsInput{
		OrganizationID: "org-1", DefaultReference: builtInReference(BuiltIns()["workshop"]), AssignmentsLocked: false,
	})
	require.NoError(t, err)
	resolved, err = service.Resolve(t.Context(), actor, ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeLight})
	require.NoError(t, err)
	require.Equal(t, "workshop", resolved.ID, "unlocking must not resurrect the deleted override")
	require.NoError(t, service.Delete(t.Context(), actor, theme.Summary.Reference.ID, DeleteInput{OrganizationID: "org-1"}))
}

func TestWorkspaceBoundTokenCannotReadOrganizationThemeLibrary(t *testing.T) {
	service, db := newThemeTestService(t)
	_, err := db.ExecContext(t.Context(), `INSERT INTO api_tokens (id, user_id, workspace_id) VALUES ('workspace-token', 'admin-1', 'workspace-1')`)
	require.NoError(t, err)

	_, err = service.List(t.Context(), Actor{UserID: "admin-1", TokenID: "workspace-token"}, "org-1", PageOptions{})
	require.ErrorIs(t, err, ErrInaccessible)
}

func TestThemeSettingsExposeServerAuthorizedCapabilities(t *testing.T) {
	service, db := newThemeTestService(t)
	_, err := db.ExecContext(t.Context(), `INSERT INTO organization_members (organization_id, user_id, role) VALUES ('org-1', 'editor-1', 'member')`)
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ('workspace-1', 'editor-1', 'editor', 'active'), ('workspace-1', 'workspace-admin', 'admin', 'active')`)
	require.NoError(t, err)

	denied := []struct {
		name  string
		actor Actor
	}{
		{"viewer", Actor{UserID: "member-1"}},
		{"editor", Actor{UserID: "editor-1"}},
	}
	for _, test := range denied {
		t.Run(test.name, func(t *testing.T) {
			_, err := service.Settings(t.Context(), test.actor, "workspace-1")
			require.ErrorIs(t, err, ErrInaccessible)
		})
	}

	allowed := []struct {
		name                  string
		actor                 Actor
		canManageWorkspace    bool
		canManageOrganization bool
	}{
		{"workspace admin", Actor{UserID: "workspace-admin"}, true, false},
		{"organization admin", Actor{UserID: "admin-1"}, true, true},
		{"workspace scoped organization admin", Actor{UserID: "admin-1", CredentialWorkspaceID: "workspace-1"}, true, false},
	}
	for _, test := range allowed {
		t.Run(test.name, func(t *testing.T) {
			settings, err := service.Settings(t.Context(), test.actor, "workspace-1")
			require.NoError(t, err)
			require.Equal(t, test.canManageWorkspace, settings.CanManageWorkspace)
			require.Equal(t, test.canManageOrganization, settings.CanManageOrganization)
		})
	}

	_, err = service.Settings(t.Context(), Actor{UserID: "admin-1", CredentialWorkspaceID: "other-workspace"}, "workspace-1")
	require.ErrorIs(t, err, ErrInaccessible)
	_, err = service.Settings(t.Context(), Actor{UserID: "member-1"}, "missing-workspace")
	require.ErrorIs(t, err, ErrInaccessible, "denials must not reveal whether a Workspace exists")
	_, err = service.Settings(t.Context(), Actor{UserID: "admin-1"}, "missing-workspace")
	require.ErrorIs(t, err, ErrInaccessible, "management credentials must not enumerate Workspace IDs")
}

func TestLegacyDitherDraftRemainsEditableButCannotPublishUnbalancedTexture(t *testing.T) {
	service, db := newThemeTestService(t)
	actor := Actor{UserID: "admin-1"}
	theme, err := service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: "Legacy Dither", DuplicateBuiltInID: "dither"})
	require.NoError(t, err)
	manifest := theme.Draft.Manifest
	manifest.Schemes.Light.Colors.ActionFocal = "#020cce"
	manifest.Schemes.Light.Colors.ActionFocalHover = "#020bb9"
	manifest.Schemes.Light.Colors.ActionFocalActive = "#010aa5"
	manifest.Schemes.Light.Colors.ActionFocalInk = "#a0c142"
	raw, err := json.Marshal(manifest)
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*draftRow)(nil)).Set("manifest_json = ?", string(raw)).Where("theme_id = ?", theme.Summary.Reference.ID).Exec(t.Context())
	require.NoError(t, err)

	page, err := service.List(t.Context(), actor, "org-1", PageOptions{})
	require.NoError(t, err, "older palette styling must not make the library unavailable")
	require.Len(t, page.Items, 1)
	loaded, err := service.Get(t.Context(), actor, "org-1", theme.Summary.Reference.ID)
	require.NoError(t, err)
	require.Equal(t, manifest.Schemes.Light.Colors, loaded.Draft.Manifest.Schemes.Light.Colors)
	_, err = service.Publish(t.Context(), actor, theme.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1, ExpectedPublishedRevision: 0})
	require.ErrorContains(t, err, "dither texture")
}

func TestResolveUsesPublishedStateWithoutBlobReadsAndFallsBackForCorruptResourceMetadata(t *testing.T) {
	service, db := newThemeTestService(t)
	storage := mediastore.NewLocalStorage(t.TempDir(), "/theme-assets")
	service.storage = storage
	actor := Actor{UserID: "admin-1"}
	asset, err := service.UploadAsset(t.Context(), actor, UploadAssetInput{
		OrganizationID: "org-1", Kind: AssetIllustration, Name: "Stored art", MediaType: "image/png", Content: bytes.NewReader(pngImage(t, 32, 24)),
	})
	require.NoError(t, err)
	manifest := BuiltIns()["workshop"]
	manifest.Assets = []ThemeAsset{{ID: asset.ID, Slot: "header-decoration", SourceURL: "asset:" + asset.ID, MimeType: "image/png", Alt: "Stored art"}}
	theme, err := service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: "Stored resources", Manifest: manifest})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), actor, theme.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1, ExpectedPublishedRevision: 0})
	require.NoError(t, err)
	_, err = service.SetOrganizationSettings(t.Context(), actor, OrganizationSettingsInput{
		OrganizationID: "org-1", DefaultReference: ThemeReference{Kind: ReferenceCustom, ID: theme.Summary.Reference.ID, Version: 1},
	})
	require.NoError(t, err)

	service.storage = failingOpenStorage{BlobStorage: storage}
	resolved, err := service.Resolve(t.Context(), actor, ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeLight})
	require.NoError(t, err)
	require.Equal(t, ResolutionOrganization, resolved.Source, "ordinary resolution must use immutable database evidence instead of remote blob reads")
	require.Contains(t, resolved.Assets[0].SourceURL, "theme_id="+theme.Summary.Reference.ID+"&revision=1")

	_, err = db.NewUpdate().Model((*assetRow)(nil)).Set("checksum_sha256 = ?", "not-a-checksum").Where("id = ?", asset.ID).Exec(t.Context())
	require.NoError(t, err)
	resolved, err = service.Resolve(t.Context(), actor, ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeLight})
	require.NoError(t, err)
	require.Equal(t, ResolutionFallback, resolved.Source)
	require.Equal(t, FallbackUnsafeResource, resolved.FallbackReason)
	require.Equal(t, Workshop(SchemeLight), resolved.Manifest)

	_, err = db.ExecContext(t.Context(), `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ('workspace-1', 'workspace-admin', 'admin', 'active')`)
	require.NoError(t, err)
	available, err := service.Available(t.Context(), Actor{UserID: "workspace-admin"}, "workspace-1", PageOptions{Limit: MaxThemePageLimit})
	require.NoError(t, err)
	require.Len(t, available.Items, len(BuiltIns()), "one corrupt custom theme must not make the whole catalog unavailable")
	_, err = service.OpenAsset(t.Context(), actor, asset.ID, AssetAccessScope{OrganizationID: "org-1"})
	require.ErrorIs(t, err, ErrNotFound)
}

func TestThemeFontUploadValidatesWOFF2AndDeletesThroughDurableJob(t *testing.T) {
	service, db := newThemeTestService(t)
	service.storage = mediastore.NewLocalStorage(t.TempDir(), "/theme-assets")
	actor := Actor{UserID: "admin-1"}

	_, err := service.UploadAsset(t.Context(), actor, UploadAssetInput{
		OrganizationID: "org-1", Kind: AssetFont, Name: "Fake", MediaType: "font/woff2",
		FontFamily: "OpenPost Sans", FontStyle: "normal", FontWeight: 500, LicenseAcknowledged: true,
		Content: bytes.NewReader([]byte("not a font")),
	})
	require.ErrorIs(t, err, ErrInvalidAsset)

	content := realWOFF2(t)
	asset, err := service.UploadAsset(t.Context(), actor, UploadAssetInput{
		OrganizationID: "org-1", Kind: AssetFont, Name: "Roboto Regular", MediaType: "font/woff2",
		FontFamily: "Roboto", FontStyle: "normal", FontWeight: 400, LicenseAcknowledged: true,
		Content: bytes.NewReader(content),
	})
	require.NoError(t, err)
	require.Equal(t, int64(len(content)), asset.SizeBytes)
	require.NotEmpty(t, asset.URL)
	require.Equal(t, "/api/v1/theme-assets/"+asset.ID+"/content?organization_id=org-1", asset.URL)
	require.NotEmpty(t, asset.ObjectKey, "the service keeps the storage handle private but available to lifecycle code")
	var stored assetRow
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", asset.ID).Scan(t.Context()))
	require.Equal(t, "font/ttf", stored.NativeMediaType)
	require.NotEmpty(t, stored.NativeObjectKey)
	require.Positive(t, stored.NativeSizeBytes)
	require.Len(t, stored.NativeChecksumSHA256, 64)
	encoded, err := json.Marshal(asset)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), `"object_key"`)
	_, err = service.OpenAsset(t.Context(), actor, asset.ID, AssetAccessScope{WorkspaceID: "workspace-1"})
	require.ErrorIs(t, err, ErrNotFound, "draft-only and library assets are not readable through a Workspace scope")
	opened, err := service.OpenAsset(t.Context(), actor, asset.ID, AssetAccessScope{OrganizationID: "org-1"})
	require.NoError(t, err)
	read, err := io.ReadAll(opened.Reader)
	require.NoError(t, err)
	require.NoError(t, opened.Reader.Close())
	require.Equal(t, content, read)
	require.Equal(t, "font/woff2", opened.MediaType)
	require.NotEmpty(t, opened.ETag)
	native, err := service.OpenAsset(t.Context(), actor, asset.ID, AssetAccessScope{OrganizationID: "org-1", Format: "ttf"})
	require.NoError(t, err)
	nativeBytes, err := io.ReadAll(native.Reader)
	require.NoError(t, err)
	require.NoError(t, native.Reader.Close())
	require.Equal(t, "font/ttf", native.MediaType)
	require.Equal(t, []byte{0x00, 0x01, 0x00, 0x00}, nativeBytes[:4])
	require.NotEqual(t, opened.ETag, native.ETag)
	_, err = service.OpenAsset(t.Context(), actor, asset.ID, AssetAccessScope{OrganizationID: "org-1", Format: "otf"})
	require.ErrorIs(t, err, ErrNotFound)
	_, err = service.OpenAsset(t.Context(), Actor{UserID: "member-1"}, asset.ID, AssetAccessScope{OrganizationID: "other-org"})
	require.ErrorIs(t, err, ErrNotFound)

	require.NoError(t, service.DeleteAsset(t.Context(), actor, "org-1", asset.ID))
	jobs, err := db.NewSelect().Table("jobs").Where("type = ?", "storage_delete").Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, jobs, "both font objects fit in one bounded durable cleanup job")
	var cleanupPayload string
	require.NoError(t, db.NewSelect().Table("jobs").Column("payload").Where("type = ?", "storage_delete").Scan(t.Context(), &cleanupPayload))
	require.Contains(t, cleanupPayload, ".woff2")
	require.Contains(t, cleanupPayload, ".ttf")
	assets, err := service.ListAssets(t.Context(), actor, "org-1", PageOptions{})
	require.NoError(t, err)
	require.Empty(t, assets.Items)
	_, err = service.OpenAsset(t.Context(), actor, asset.ID, AssetAccessScope{WorkspaceID: "workspace-1"})
	require.ErrorIs(t, err, ErrNotFound)
}

func TestThemeUploadQueuesCleanupWhenCompensatingBlobDeleteFails(t *testing.T) {
	service, db := newThemeTestService(t)
	service.storage = deleteFailingStorage{BlobStorage: mediastore.NewLocalStorage(t.TempDir(), "/theme-assets")}
	_, err := db.ExecContext(t.Context(), `DROP TABLE organization_theme_assets`)
	require.NoError(t, err)

	_, err = service.UploadAsset(t.Context(), Actor{UserID: "admin-1"}, UploadAssetInput{
		OrganizationID: "org-1", Kind: AssetIllustration, Name: "Uncommitted", MediaType: "image/png", Content: bytes.NewReader(pngImage(t, 16, 16)),
	})
	require.ErrorIs(t, err, ErrUnavailable)
	var payload string
	require.NoError(t, db.NewSelect().Table("jobs").Column("payload").Where("type = ?", "storage_delete").Scan(t.Context(), &payload))
	require.Contains(t, payload, "theme-assets/org-1/")
}

func realWOFF2(t *testing.T) []byte {
	t.Helper()
	content, err := os.ReadFile("testdata/roboto-latin-400-normal.woff2")
	require.NoError(t, err)
	return content
}

func pngImage(t *testing.T, width, height int) []byte {
	t.Helper()
	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	canvas.Set(0, 0, color.RGBA{R: 255, G: 128, B: 32, A: 255})
	var encoded bytes.Buffer
	require.NoError(t, png.Encode(&encoded, canvas))
	return encoded.Bytes()
}

func newThemeTestService(t *testing.T) (*Service, *bun.DB) {
	t.Helper()
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	sqlDB, err := sql.Open(sqliteshim.ShimName, dsn)
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	createThemeTestTables(t, db)
	seedThemeTestAccess(t, db)

	service := New(db)
	now := time.Date(2026, time.September, 2, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { now = now.Add(time.Second); return now }
	sequence := 0
	service.newID = func() string { sequence++; return fmt.Sprintf("theme-%d", sequence) }
	return service, db
}

func createThemeTestTables(t *testing.T, db *bun.DB) {
	t.Helper()
	statements := []string{
		`PRAGMA foreign_keys = ON`,
		`CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT '', created_at DATETIME, updated_at DATETIME)`,
		`CREATE TABLE organization_members (organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at DATETIME, PRIMARY KEY (organization_id, user_id))`,
		`CREATE TABLE workspaces (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '')`,
		`CREATE TABLE workspace_members (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, created_at DATETIME, updated_at DATETIME, deactivated_at DATETIME, PRIMARY KEY (workspace_id, user_id))`,
		`CREATE TABLE api_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL DEFAULT '', organization_id TEXT NOT NULL DEFAULT '')`,
		`CREATE TABLE organization_theme_settings (organization_id TEXT PRIMARY KEY, default_reference_kind TEXT NOT NULL, default_reference_id TEXT NOT NULL, default_reference_version INTEGER NOT NULL, assignments_locked BOOLEAN NOT NULL, updated_by TEXT NOT NULL, updated_at DATETIME NOT NULL)`,
		`CREATE TABLE organization_themes (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, latest_published_revision INTEGER NOT NULL, created_by TEXT NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, UNIQUE (organization_id, normalized_name), UNIQUE (id, organization_id))`,
		`CREATE TABLE organization_theme_drafts (theme_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, revision INTEGER NOT NULL, name TEXT NOT NULL, manifest_json TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at DATETIME NOT NULL, FOREIGN KEY (theme_id, organization_id) REFERENCES organization_themes(id, organization_id) ON DELETE CASCADE)`,
		`CREATE TABLE organization_theme_revisions (theme_id TEXT NOT NULL, organization_id TEXT NOT NULL, revision INTEGER NOT NULL, name TEXT NOT NULL, manifest_json TEXT NOT NULL, published_by TEXT NOT NULL, published_at DATETIME NOT NULL, source_revision INTEGER, PRIMARY KEY (theme_id, revision), FOREIGN KEY (theme_id, organization_id) REFERENCES organization_themes(id, organization_id) ON DELETE CASCADE)`,
		`CREATE TABLE workspace_theme_assignments (workspace_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, reference_kind TEXT NOT NULL, reference_id TEXT NOT NULL, reference_version INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at DATETIME NOT NULL)`,
		`CREATE TABLE organization_theme_assets (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, media_type TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0, checksum_sha256 TEXT NOT NULL, native_object_key TEXT NOT NULL DEFAULT '', native_media_type TEXT NOT NULL DEFAULT '', native_size_bytes INTEGER NOT NULL DEFAULT 0, native_checksum_sha256 TEXT NOT NULL DEFAULT '', font_family TEXT NOT NULL DEFAULT '', font_style TEXT NOT NULL DEFAULT '', font_weight INTEGER NOT NULL DEFAULT 0, license_acknowledged BOOLEAN NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at DATETIME NOT NULL)`,
		`CREATE TABLE organization_theme_draft_assets (theme_id TEXT NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY (theme_id, asset_id))`,
		`CREATE TABLE organization_theme_revision_assets (theme_id TEXT NOT NULL, revision INTEGER NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY (theme_id, revision, asset_id))`,
		`CREATE TABLE jobs (id TEXT PRIMARY KEY, type TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', dedupe_key TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', run_at DATETIME NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, last_error TEXT NOT NULL DEFAULT '', locked_at DATETIME, locked_by TEXT NOT NULL DEFAULT '', lease_generation BIGINT NOT NULL DEFAULT 0)`,
	}
	for _, statement := range statements {
		_, err := db.Exec(statement)
		require.NoError(t, err, statement)
	}
}

type failingOpenStorage struct {
	mediastore.BlobStorage
}

func (failingOpenStorage) Open(context.Context, string) (io.ReadCloser, error) {
	return nil, errors.New("unexpected blob read")
}

type deleteFailingStorage struct {
	mediastore.BlobStorage
}

func (deleteFailingStorage) Delete(context.Context, string) error {
	return errors.New("transient delete failure")
}

func seedThemeTestAccess(t *testing.T, db *bun.DB) {
	t.Helper()
	statements := []string{
		`INSERT INTO organizations (id, name) VALUES ('org-1', 'OpenPost')`,
		`INSERT INTO organization_members (organization_id, user_id, role) VALUES ('org-1', 'admin-1', 'admin'), ('org-1', 'member-1', 'member')`,
		`INSERT INTO workspaces (id, organization_id, name) VALUES ('workspace-1', 'org-1', 'Main')`,
		`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ('workspace-1', 'admin-1', 'admin', 'active'), ('workspace-1', 'member-1', 'viewer', 'active')`,
	}
	for _, statement := range statements {
		_, err := db.Exec(statement)
		require.NoError(t, err)
	}
}

func TestValidateFontAcceptsTransformedWOFF2Metrics(t *testing.T) {
	// Derived from the existing Roboto fixture with FontTools 4.61.1, enabling
	// glyf, loca and hmtx WOFF2 transforms. This exercises omitted side bearings.
	content, err := os.ReadFile("testdata/roboto-latin-400-hmtx-transform.woff2")
	require.NoError(t, err)
	require.NoError(t, ValidateFontContent(content, "woff2"))
	require.NoError(t, validateWOFF2(content, "Roboto", 400, "normal"))
	derivative, err := prepareNativeFontDerivative(content, "Roboto", 400, "normal")
	require.NoError(t, err)
	require.Equal(t, "ttf", derivative.Format)
	require.NoError(t, ValidateFontContent(derivative.Content, "ttf"))
}
