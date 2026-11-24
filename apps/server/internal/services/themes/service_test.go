package themes

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
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

func TestWorkspaceAdministratorCanListOnlyPublishedAvailableThemes(t *testing.T) {
	service, db := newThemeTestService(t)
	admin := Actor{UserID: "admin-1"}
	_, err := db.ExecContext(t.Context(), `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ('workspace-1', 'workspace-admin', 'admin', 'active')`)
	require.NoError(t, err)
	publishedTheme, err := service.Create(t.Context(), admin, CreateInput{OrganizationID: "org-1", Name: "Published", DuplicateBuiltInID: "studio"})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), admin, publishedTheme.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1, ExpectedPublishedRevision: 0})
	require.NoError(t, err)
	_, err = service.Create(t.Context(), admin, CreateInput{OrganizationID: "org-1", Name: "Draft only", DuplicateBuiltInID: "notebook"})
	require.NoError(t, err)

	workspaceAdmin := Actor{UserID: "workspace-admin"}
	available, err := service.Available(t.Context(), workspaceAdmin, "workspace-1", PageOptions{Limit: MaxThemePageLimit})
	require.NoError(t, err)
	require.Len(t, available.Items, len(builtInOrder)+1)
	require.Equal(t, builtInOrder, summaryIDs(available.Items[:len(builtInOrder)]))
	require.Equal(t, "Published", available.Items[len(builtInOrder)].Name)
	require.Zero(t, available.Items[len(builtInOrder)].DraftRevision)
	preview, err := service.AvailableDetail(t.Context(), workspaceAdmin, "workspace-1", publishedTheme.Summary.Reference.ID, 1)
	require.NoError(t, err)
	require.Equal(t, publishedTheme.Summary.Reference.ID, preview.Manifest.ID)
	require.Equal(t, "1", preview.Manifest.Revision)
	publishedAt := available.Items[len(builtInOrder)].UpdatedAt
	changedDraft := publishedTheme.Draft.Manifest
	changedDraft.Description = "Unpublished activity"
	_, err = service.UpdateDraft(t.Context(), admin, publishedTheme.Summary.Reference.ID, UpdateDraftInput{
		OrganizationID: "org-1", ExpectedRevision: 1, Name: "Published", Manifest: changedDraft,
	})
	require.NoError(t, err)
	available, err = service.Available(t.Context(), workspaceAdmin, "workspace-1", PageOptions{Limit: MaxThemePageLimit})
	require.NoError(t, err)
	require.Equal(t, publishedAt, available.Items[len(builtInOrder)].UpdatedAt, "catalog timestamps must not reveal draft activity")
	preview, err = service.AvailableDetail(t.Context(), workspaceAdmin, "workspace-1", publishedTheme.Summary.Reference.ID, 1)
	require.NoError(t, err)
	require.NotEqual(t, "Unpublished activity", preview.Manifest.Description)
	_, err = service.List(t.Context(), workspaceAdmin, "org-1", PageOptions{})
	require.ErrorIs(t, err, ErrInaccessible)

	_, err = service.Available(t.Context(), Actor{UserID: "member-1"}, "workspace-1", PageOptions{})
	require.ErrorIs(t, err, ErrInaccessible)
}

func TestWorkspaceAdministratorCanPreviewPublishedCatalogResources(t *testing.T) {
	service, db := newThemeTestService(t)
	service.storage = mediastore.NewLocalStorage(t.TempDir(), "/theme-assets")
	admin := Actor{UserID: "admin-1"}
	_, err := db.ExecContext(t.Context(), `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ('workspace-1', 'workspace-admin', 'admin', 'active')`)
	require.NoError(t, err)
	asset, err := service.UploadAsset(t.Context(), admin, UploadAssetInput{
		OrganizationID: "org-1", Kind: AssetIllustration, Name: "Preview art", MediaType: "image/png", Content: bytes.NewReader(pngImage(t, 80, 40)),
	})
	require.NoError(t, err)
	manifest := BuiltIns()["workshop"]
	manifest.Assets = []ThemeAsset{{ID: asset.ID, Slot: "header-decoration", SourceURL: "asset:" + asset.ID, MimeType: "image/png", Alt: "Preview"}}
	theme, err := service.Create(t.Context(), admin, CreateInput{OrganizationID: "org-1", Name: "Previewable", Manifest: manifest})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), admin, theme.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1, ExpectedPublishedRevision: 0})
	require.NoError(t, err)

	workspaceAdmin := Actor{UserID: "workspace-admin"}
	available, err := service.Available(t.Context(), workspaceAdmin, "workspace-1", PageOptions{Limit: MaxThemePageLimit})
	require.NoError(t, err)
	require.Equal(t, theme.Summary.Reference.ID, available.Items[len(available.Items)-1].Reference.ID)
	preview, err := service.AvailableDetail(t.Context(), workspaceAdmin, "workspace-1", theme.Summary.Reference.ID, 1)
	require.NoError(t, err)
	expectedURL := "/api/v1/theme-assets/" + asset.ID + "/content?workspace_id=workspace-1&theme_id=" + theme.Summary.Reference.ID + "&revision=1"
	require.Equal(t, expectedURL, preview.Manifest.Assets[0].SourceURL)
	require.Zero(t, preview.Summary.DraftRevision)

	_, err = service.OpenAsset(t.Context(), workspaceAdmin, asset.ID, AssetAccessScope{WorkspaceID: "workspace-1"})
	require.ErrorIs(t, err, ErrNotFound, "ordinary Workspace scope only exposes the effective theme")
	content, err := service.OpenAsset(t.Context(), workspaceAdmin, asset.ID, AssetAccessScope{WorkspaceID: "workspace-1", ThemeID: theme.Summary.Reference.ID, Revision: 1})
	require.NoError(t, err)
	require.NoError(t, content.Reader.Close())
	_, err = service.OpenAsset(t.Context(), Actor{UserID: "member-1"}, asset.ID, AssetAccessScope{WorkspaceID: "workspace-1", ThemeID: theme.Summary.Reference.ID, Revision: 1})
	require.ErrorIs(t, err, ErrNotFound, "published previews require Workspace administration")
	_, err = service.OpenAsset(t.Context(), workspaceAdmin, asset.ID, AssetAccessScope{WorkspaceID: "workspace-1", ThemeID: theme.Summary.Reference.ID})
	require.ErrorIs(t, err, ErrInvalidInput)
}

func TestListFailsClosedWhenDraftStorageIsMissing(t *testing.T) {
	service, db := newThemeTestService(t)
	_, err := service.Create(t.Context(), Actor{UserID: "admin-1"}, CreateInput{OrganizationID: "org-1", Name: "Stored", DuplicateBuiltInID: "studio"})
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `DROP TABLE organization_theme_drafts`)
	require.NoError(t, err)

	_, err = service.List(t.Context(), Actor{UserID: "admin-1"}, "org-1", PageOptions{})
	require.ErrorIs(t, err, ErrUnavailable)
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
