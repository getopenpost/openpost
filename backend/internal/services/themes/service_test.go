package themes

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestThemeLifecyclePublishesImmutableRevisionsAndAdvancesSelections(t *testing.T) {
	service, db := newThemeTestService(t)
	actor := Actor{UserID: "admin-1"}
	light := Workshop(SchemeLight)
	dark := Workshop(SchemeDark)
	manifest := BuiltIns()["workshop"]

	theme, err := service.Create(t.Context(), actor, CreateInput{
		OrganizationID: "org-1", Name: "Product", Manifest: manifest,
	})
	require.NoError(t, err)
	require.Equal(t, 1, theme.Draft.Revision)
	require.Zero(t, theme.Summary.PublishedRevision)

	published, err := service.Publish(t.Context(), actor, theme.Summary.Reference.ID, PublishInput{
		OrganizationID: "org-1", ExpectedDraftRevision: 1,
	})
	require.NoError(t, err)
	require.Equal(t, 1, published.Revision)

	_, err = service.SetOrganizationSettings(t.Context(), actor, OrganizationSettingsInput{
		OrganizationID: "org-1", DefaultReference: ThemeReference{Kind: ReferenceCustom, ID: theme.Summary.Reference.ID, Version: 1},
	})
	require.NoError(t, err)
	resolved, err := service.Resolve(t.Context(), actor, ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeLight})
	require.NoError(t, err)
	require.Equal(t, ResolutionOrganization, resolved.Source)
	require.Equal(t, "1", resolved.Revision)

	updatedLight := light
	updatedLight.Colors.ActionFocal = "#2563eb"
	updatedLight.Colors.ActionFocalHover = "#1d4ed8"
	updatedLight.Colors.ActionFocalActive = "#1e40af"
	updatedLight.Colors.Selection = "#bfdbfe"
	updatedLight.Colors.Focus = "#2563eb"
	updatedManifest := manifest
	updatedManifest.Schemes = ThemeSchemes{Light: &updatedLight, Dark: &dark}
	theme, err = service.UpdateDraft(t.Context(), actor, theme.Summary.Reference.ID, UpdateDraftInput{
		OrganizationID: "org-1", ExpectedRevision: 1, Name: "Product", Manifest: updatedManifest,
	})
	require.NoError(t, err)
	require.Equal(t, 2, theme.Draft.Revision)

	_, err = service.UpdateDraft(t.Context(), actor, theme.Summary.Reference.ID, UpdateDraftInput{
		OrganizationID: "org-1", ExpectedRevision: 1, Name: "Stale", Manifest: manifest,
	})
	require.ErrorIs(t, err, ErrRevisionConflict)

	published, err = service.Publish(t.Context(), actor, theme.Summary.Reference.ID, PublishInput{
		OrganizationID: "org-1", ExpectedDraftRevision: 2,
	})
	require.NoError(t, err)
	require.Equal(t, 2, published.Revision)
	settings, err := service.Settings(t.Context(), actor, "workspace-1")
	require.NoError(t, err)
	require.Equal(t, 2, settings.OrganizationDefault.Version, "publishing must advance existing family references")
	resolved, err = service.Resolve(t.Context(), actor, ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeLight})
	require.NoError(t, err)
	require.Equal(t, "#2563eb", resolved.Manifest.Colors.ActionFocal)
	require.Equal(t, "2", resolved.Revision)

	rolledBack, err := service.Rollback(t.Context(), actor, theme.Summary.Reference.ID, RollbackInput{
		OrganizationID: "org-1", SourceRevision: 1,
	})
	require.NoError(t, err)
	require.Equal(t, 3, rolledBack.Revision, "rollback creates a new immutable revision")
	resolved, err = service.Resolve(t.Context(), actor, ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeLight})
	require.NoError(t, err)
	require.Equal(t, light.Colors.ActionFocal, resolved.Manifest.Colors.ActionFocal)
	require.Equal(t, "3", resolved.Revision)
	rolledBackTheme, err := service.Get(t.Context(), actor, "org-1", theme.Summary.Reference.ID)
	require.NoError(t, err)
	require.Equal(t, 3, rolledBackTheme.Draft.Revision)
	require.Equal(t, light.Colors.ActionFocal, rolledBackTheme.Draft.Manifest.Schemes.Light.Colors.ActionFocal)

	rolledBackDraft := rolledBackTheme.Draft.Manifest
	rolledBackDraft.Description = "Edited after rollback"
	rolledBackTheme, err = service.UpdateDraft(t.Context(), actor, theme.Summary.Reference.ID, UpdateDraftInput{
		OrganizationID: "org-1", ExpectedRevision: 3, Name: "Product", Manifest: rolledBackDraft,
	})
	require.NoError(t, err)
	require.Equal(t, 4, rolledBackTheme.Draft.Revision)
	_, err = service.Publish(t.Context(), actor, theme.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 4})
	require.NoError(t, err)
	latest, err := service.GetRevision(t.Context(), actor, "org-1", theme.Summary.Reference.ID, 4)
	require.NoError(t, err)
	require.Equal(t, "Edited after rollback", latest.Manifest.Description)
	resolved, err = service.Resolve(t.Context(), actor, ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeLight})
	require.NoError(t, err)
	require.Equal(t, light.Colors.ActionFocal, resolved.Manifest.Colors.ActionFocal, "saving after rollback must not reintroduce the pre-rollback draft")
	require.Equal(t, "4", resolved.Revision)

	var revisions int
	require.NoError(t, db.NewSelect().Model((*revisionRow)(nil)).Where("theme_id = ?", theme.Summary.Reference.ID).ColumnExpr("COUNT(*)").Scan(t.Context(), &revisions))
	require.Equal(t, 4, revisions)
}

func TestWorkspaceAssignmentLockAndDeleteGuards(t *testing.T) {
	service, _ := newThemeTestService(t)
	actor := Actor{UserID: "admin-1"}
	theme, err := service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: "Custom", DuplicateBuiltInID: "studio"})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), actor, theme.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1})
	require.NoError(t, err)
	custom := ThemeReference{Kind: ReferenceCustom, ID: theme.Summary.Reference.ID, Version: 1}

	_, err = service.AssignWorkspace(t.Context(), actor, WorkspaceAssignmentInput{WorkspaceID: "workspace-1", Reference: &custom})
	require.NoError(t, err)
	err = service.Delete(t.Context(), actor, theme.Summary.Reference.ID, DeleteInput{OrganizationID: "org-1"})
	require.ErrorIs(t, err, ErrThemeInUse)

	_, err = service.SetOrganizationSettings(t.Context(), actor, OrganizationSettingsInput{
		OrganizationID: "org-1", DefaultReference: ThemeReference{Kind: ReferenceBuiltIn, ID: "workshop", Version: 1}, AssignmentsLocked: true,
	})
	require.NoError(t, err)
	resolved, err := service.Resolve(t.Context(), actor, ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeLight})
	require.NoError(t, err)
	require.Equal(t, "workshop", resolved.ID, "a lock must apply the Organization default, not a stale Workspace choice")
	_, err = service.AssignWorkspace(t.Context(), actor, WorkspaceAssignmentInput{WorkspaceID: "workspace-1", Reference: nil})
	require.ErrorIs(t, err, ErrAssignmentLocked)

	_, err = service.SetOrganizationSettings(t.Context(), actor, OrganizationSettingsInput{
		OrganizationID: "org-1", DefaultReference: ThemeReference{Kind: ReferenceBuiltIn, ID: "workshop", Version: 1}, AssignmentsLocked: false,
	})
	require.NoError(t, err)
	resolved, err = service.Resolve(t.Context(), actor, ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeLight})
	require.NoError(t, err)
	require.Equal(t, "workshop", resolved.ID, "unlocking must not resurrect the deleted override")
	require.NoError(t, service.Delete(t.Context(), actor, theme.Summary.Reference.ID, DeleteInput{OrganizationID: "org-1"}))
}

func TestOrganizationMembersCannotMutateThemeLibrary(t *testing.T) {
	service, _ := newThemeTestService(t)
	_, err := service.Create(t.Context(), Actor{UserID: "member-1"}, CreateInput{
		OrganizationID: "org-1", Name: "Not allowed", Manifest: BuiltIns()["workshop"],
	})
	require.ErrorIs(t, err, ErrInaccessible)
}

func TestOrganizationMembersCanResolveButCannotReadManagementData(t *testing.T) {
	service, _ := newThemeTestService(t)
	admin := Actor{UserID: "admin-1"}
	member := Actor{UserID: "member-1"}
	theme, err := service.Create(t.Context(), admin, CreateInput{OrganizationID: "org-1", Name: "Private draft", DuplicateBuiltInID: "studio"})
	require.NoError(t, err)

	_, err = service.List(t.Context(), member, "org-1")
	require.ErrorIs(t, err, ErrInaccessible)
	_, err = service.Get(t.Context(), member, "org-1", theme.Summary.Reference.ID)
	require.ErrorIs(t, err, ErrInaccessible)
	_, err = service.ListAssets(t.Context(), member, "org-1")
	require.ErrorIs(t, err, ErrInaccessible)
	settings, err := service.Settings(t.Context(), member, "workspace-1")
	require.NoError(t, err)
	require.False(t, settings.CanManageWorkspace)
	require.False(t, settings.CanManageOrganization)

	resolved, err := service.Resolve(t.Context(), member, ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeLight})
	require.NoError(t, err)
	require.Equal(t, "workshop", resolved.ID)
}

func TestThemeSettingsExposeServerAuthorizedCapabilities(t *testing.T) {
	service, db := newThemeTestService(t)
	_, err := db.ExecContext(t.Context(), `INSERT INTO organization_members (organization_id, user_id, role) VALUES ('org-1', 'editor-1', 'member')`)
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ('workspace-1', 'editor-1', 'editor', 'active'), ('workspace-1', 'workspace-admin', 'admin', 'active')`)
	require.NoError(t, err)

	tests := []struct {
		name                  string
		actor                 Actor
		canManageWorkspace    bool
		canManageOrganization bool
	}{
		{"viewer", Actor{UserID: "member-1"}, false, false},
		{"editor", Actor{UserID: "editor-1"}, false, false},
		{"workspace admin", Actor{UserID: "workspace-admin"}, true, false},
		{"organization admin", Actor{UserID: "admin-1"}, true, true},
		{"workspace scoped organization admin", Actor{UserID: "admin-1", CredentialWorkspaceID: "workspace-1"}, true, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			settings, err := service.Settings(t.Context(), test.actor, "workspace-1")
			require.NoError(t, err)
			require.Equal(t, test.canManageWorkspace, settings.CanManageWorkspace)
			require.Equal(t, test.canManageOrganization, settings.CanManageOrganization)
		})
	}

	_, err = service.Settings(t.Context(), Actor{UserID: "admin-1", CredentialWorkspaceID: "other-workspace"}, "workspace-1")
	require.ErrorIs(t, err, ErrInaccessible)
}

func TestWorkspaceAdministratorCanListOnlyPublishedAvailableThemes(t *testing.T) {
	service, db := newThemeTestService(t)
	admin := Actor{UserID: "admin-1"}
	_, err := db.ExecContext(t.Context(), `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ('workspace-1', 'workspace-admin', 'admin', 'active')`)
	require.NoError(t, err)
	publishedTheme, err := service.Create(t.Context(), admin, CreateInput{OrganizationID: "org-1", Name: "Published", DuplicateBuiltInID: "studio"})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), admin, publishedTheme.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1})
	require.NoError(t, err)
	_, err = service.Create(t.Context(), admin, CreateInput{OrganizationID: "org-1", Name: "Draft only", DuplicateBuiltInID: "notebook"})
	require.NoError(t, err)

	workspaceAdmin := Actor{UserID: "workspace-admin"}
	available, err := service.Available(t.Context(), workspaceAdmin, "workspace-1")
	require.NoError(t, err)
	require.Len(t, available, 9)
	require.Equal(t, builtInOrder, []string{available[0].Summary.Reference.ID, available[1].Summary.Reference.ID, available[2].Summary.Reference.ID, available[3].Summary.Reference.ID, available[4].Summary.Reference.ID, available[5].Summary.Reference.ID, available[6].Summary.Reference.ID, available[7].Summary.Reference.ID})
	require.Equal(t, "Published", available[8].Summary.Name)
	require.Zero(t, available[8].Summary.DraftRevision)
	require.Equal(t, publishedTheme.Summary.Reference.ID, available[8].Manifest.ID)
	require.Equal(t, "1", available[8].Manifest.Revision)
	publishedAt := available[8].Summary.UpdatedAt
	changedDraft := publishedTheme.Draft.Manifest
	changedDraft.Description = "Unpublished activity"
	_, err = service.UpdateDraft(t.Context(), admin, publishedTheme.Summary.Reference.ID, UpdateDraftInput{
		OrganizationID: "org-1", ExpectedRevision: 1, Name: "Published", Manifest: changedDraft,
	})
	require.NoError(t, err)
	available, err = service.Available(t.Context(), workspaceAdmin, "workspace-1")
	require.NoError(t, err)
	require.Equal(t, publishedAt, available[8].Summary.UpdatedAt, "catalog timestamps must not reveal draft activity")
	require.NotEqual(t, "Unpublished activity", available[8].Manifest.Description)
	_, err = service.List(t.Context(), workspaceAdmin, "org-1")
	require.ErrorIs(t, err, ErrInaccessible)

	_, err = service.Available(t.Context(), Actor{UserID: "member-1"}, "workspace-1")
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
	_, err = service.Publish(t.Context(), admin, theme.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1})
	require.NoError(t, err)

	workspaceAdmin := Actor{UserID: "workspace-admin"}
	available, err := service.Available(t.Context(), workspaceAdmin, "workspace-1")
	require.NoError(t, err)
	preview := available[len(available)-1]
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

func TestAdminThemeSummaryIncludesAssignmentAndDefaultUsage(t *testing.T) {
	service, _ := newThemeTestService(t)
	actor := Actor{UserID: "admin-1"}
	theme, err := service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: "Used", DuplicateBuiltInID: "studio"})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), actor, theme.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1})
	require.NoError(t, err)
	reference := ThemeReference{Kind: ReferenceCustom, ID: theme.Summary.Reference.ID, Version: 1}
	_, err = service.AssignWorkspace(t.Context(), actor, WorkspaceAssignmentInput{WorkspaceID: "workspace-1", Reference: &reference})
	require.NoError(t, err)
	_, err = service.SetOrganizationSettings(t.Context(), actor, OrganizationSettingsInput{OrganizationID: "org-1", DefaultReference: reference})
	require.NoError(t, err)

	items, err := service.List(t.Context(), actor, "org-1")
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.True(t, items[0].Summary.IsOrganizationDefault)
	require.Equal(t, 1, items[0].Summary.AssignedWorkspaceCount)
	require.NotNil(t, items[0].Draft)
	require.NotNil(t, items[0].Latest)
}

func TestListFailsClosedWhenDraftStorageIsMissing(t *testing.T) {
	service, db := newThemeTestService(t)
	_, err := service.Create(t.Context(), Actor{UserID: "admin-1"}, CreateInput{OrganizationID: "org-1", Name: "Stored", DuplicateBuiltInID: "studio"})
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `DROP TABLE organization_theme_drafts`)
	require.NoError(t, err)

	_, err = service.List(t.Context(), Actor{UserID: "admin-1"}, "org-1")
	require.ErrorIs(t, err, ErrUnavailable)
}

func TestResolveFallsBackForCorruptStoredManifest(t *testing.T) {
	service, db := newThemeTestService(t)
	actor := Actor{UserID: "admin-1"}
	theme, err := service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: "Corrupt later", DuplicateBuiltInID: "studio"})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), actor, theme.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1})
	require.NoError(t, err)
	_, err = service.SetOrganizationSettings(t.Context(), actor, OrganizationSettingsInput{OrganizationID: "org-1", DefaultReference: ThemeReference{Kind: ReferenceCustom, ID: theme.Summary.Reference.ID, Version: 1}})
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*revisionRow)(nil)).Set("manifest_json = ?", `{not-json`).Where("theme_id = ? AND revision = 1", theme.Summary.Reference.ID).Exec(t.Context())
	require.NoError(t, err)

	resolved, err := service.Resolve(t.Context(), actor, ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeLight})
	require.NoError(t, err)
	require.Equal(t, ResolutionFallback, resolved.Source)
	require.Equal(t, FallbackInvalidManifest, resolved.FallbackReason)
	require.Equal(t, Workshop(SchemeLight), resolved.Manifest)
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
	require.Equal(t, 1, jobs, "both font objects fit in one bounded durable cleanup job")
	var cleanupPayload string
	require.NoError(t, db.NewSelect().Table("jobs").Column("payload").Where("type = ?", "storage_delete").Scan(t.Context(), &cleanupPayload))
	require.Contains(t, cleanupPayload, ".woff2")
	require.Contains(t, cleanupPayload, ".ttf")
	assets, err := service.ListAssets(t.Context(), actor, "org-1")
	require.NoError(t, err)
	require.Empty(t, assets)
	_, err = service.OpenAsset(t.Context(), actor, asset.ID, AssetAccessScope{WorkspaceID: "workspace-1"})
	require.ErrorIs(t, err, ErrNotFound)
}

func TestThemeRasterUploadValidatesDimensions(t *testing.T) {
	service, _ := newThemeTestService(t)
	service.storage = mediastore.NewLocalStorage(t.TempDir(), "/theme-assets")
	actor := Actor{UserID: "admin-1"}

	asset, err := service.UploadAsset(t.Context(), actor, UploadAssetInput{
		OrganizationID: "org-1", Kind: AssetIllustration, Name: "Loading art", MediaType: "image/png", Content: bytes.NewReader(pngImage(t, 640, 360)),
	})
	require.NoError(t, err)
	require.Equal(t, 640, asset.Width)
	require.Equal(t, 360, asset.Height)

	_, err = service.UploadAsset(t.Context(), actor, UploadAssetInput{
		OrganizationID: "org-1", Kind: AssetIllustration, Name: "Too wide", MediaType: "image/png", Content: bytes.NewReader(pngImage(t, 8193, 1)),
	})
	require.ErrorIs(t, err, ErrInvalidAsset)
	require.ErrorContains(t, err, "dimensions")

	_, err = service.UploadAsset(t.Context(), actor, UploadAssetInput{
		OrganizationID: "org-1", Kind: AssetIllustration, Name: "Header only", MediaType: "image/png", Content: bytes.NewReader([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}),
	})
	require.ErrorIs(t, err, ErrInvalidAsset)

	avifBytes, err := os.ReadFile("testdata/valid-rotated.avif")
	require.NoError(t, err)
	avifAsset, err := service.UploadAsset(t.Context(), actor, UploadAssetInput{
		OrganizationID: "org-1", Kind: AssetIllustration, Name: "Valid AVIF", MediaType: "image/avif", Content: bytes.NewReader(avifBytes),
	})
	require.NoError(t, err)
	require.Positive(t, avifAsset.Width)
	require.Positive(t, avifAsset.Height)

	fabricated := append([]byte{0, 0, 0, 20, 'f', 't', 'y', 'p', 'a', 'v', 'i', 'f'}, []byte("arbitrary-ispe-payload")...)
	_, err = service.UploadAsset(t.Context(), actor, UploadAssetInput{
		OrganizationID: "org-1", Kind: AssetIllustration, Name: "Fabricated AVIF", MediaType: "image/avif", Content: bytes.NewReader(fabricated),
	})
	require.ErrorIs(t, err, ErrInvalidAsset)
}

func TestPublishRejectsMissingAndCrossOrganizationFontResources(t *testing.T) {
	service, db := newThemeTestService(t)
	service.storage = mediastore.NewLocalStorage(t.TempDir(), "/theme-assets")
	admin := Actor{UserID: "admin-1"}

	missing := BuiltIns()["workshop"]
	missing.Schemes.Light.Typography.Body.Family = "Missing Sans"
	theme, err := service.Create(t.Context(), admin, CreateInput{OrganizationID: "org-1", Name: "Missing font", Manifest: missing})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), admin, theme.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1})
	require.ErrorIs(t, err, ErrInvalidManifest)
	require.ErrorContains(t, err, "no matching normal Organization WOFF2 face")

	_, err = db.ExecContext(t.Context(), `INSERT INTO organizations (id, name) VALUES ('org-2', 'Other')`)
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `INSERT INTO organization_members (organization_id, user_id, role) VALUES ('org-2', 'admin-2', 'admin')`)
	require.NoError(t, err)
	foreign, err := service.UploadAsset(t.Context(), Actor{UserID: "admin-2"}, UploadAssetInput{
		OrganizationID: "org-2", Kind: AssetFont, Name: "Foreign Roboto", MediaType: "font/woff2",
		FontFamily: "Roboto", FontStyle: "normal", FontWeight: 400, LicenseAcknowledged: true,
		Content: bytes.NewReader(realWOFF2(t)),
	})
	require.NoError(t, err)
	foreignManifest := BuiltIns()["workshop"]
	foreignManifest.Fonts = []ThemeFontFace{{ID: foreign.ID, Family: "Roboto", SourceURL: "asset:" + foreign.ID, Format: "woff2", Weight: 400, Style: "normal", Display: "swap"}}
	_, err = service.Create(t.Context(), admin, CreateInput{OrganizationID: "org-1", Name: "Foreign font", Manifest: foreignManifest})
	require.ErrorIs(t, err, ErrInvalidManifest)
	require.ErrorContains(t, err, "this Organization")
}

func TestDeleteAssetRejectsCurrentDraftReferences(t *testing.T) {
	service, _ := newThemeTestService(t)
	service.storage = mediastore.NewLocalStorage(t.TempDir(), "/theme-assets")
	actor := Actor{UserID: "admin-1"}
	asset, err := service.UploadAsset(t.Context(), actor, UploadAssetInput{
		OrganizationID: "org-1", Kind: AssetIllustration, Name: "Draft art", MediaType: "image/png", Content: bytes.NewReader(pngImage(t, 64, 64)),
	})
	require.NoError(t, err)
	manifest := BuiltIns()["workshop"]
	manifest.Assets = []ThemeAsset{{ID: asset.ID, Slot: "empty-state-illustration", SourceURL: "asset:" + asset.ID, MimeType: "image/png", Alt: "Draft illustration"}}
	_, err = service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: "Draft with art", Manifest: manifest})
	require.NoError(t, err)

	err = service.DeleteAsset(t.Context(), actor, "org-1", asset.ID)
	require.ErrorIs(t, err, ErrThemeInUse)
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
	sqlDB, err := sql.Open("sqlite3", dsn)
	require.NoError(t, err)
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
		`CREATE TABLE organization_theme_settings (organization_id TEXT PRIMARY KEY, default_reference_kind TEXT NOT NULL, default_reference_id TEXT NOT NULL, default_reference_version INTEGER NOT NULL, assignments_locked BOOLEAN NOT NULL, updated_by TEXT NOT NULL, updated_at DATETIME NOT NULL)`,
		`CREATE TABLE organization_themes (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, latest_published_revision INTEGER NOT NULL, created_by TEXT NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, UNIQUE (organization_id, normalized_name), UNIQUE (id, organization_id))`,
		`CREATE TABLE organization_theme_drafts (theme_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, revision INTEGER NOT NULL, name TEXT NOT NULL, manifest_json TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at DATETIME NOT NULL, FOREIGN KEY (theme_id, organization_id) REFERENCES organization_themes(id, organization_id) ON DELETE CASCADE)`,
		`CREATE TABLE organization_theme_revisions (theme_id TEXT NOT NULL, organization_id TEXT NOT NULL, revision INTEGER NOT NULL, name TEXT NOT NULL, manifest_json TEXT NOT NULL, published_by TEXT NOT NULL, published_at DATETIME NOT NULL, source_revision INTEGER, PRIMARY KEY (theme_id, revision), FOREIGN KEY (theme_id, organization_id) REFERENCES organization_themes(id, organization_id) ON DELETE CASCADE)`,
		`CREATE TABLE workspace_theme_assignments (workspace_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, reference_kind TEXT NOT NULL, reference_id TEXT NOT NULL, reference_version INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at DATETIME NOT NULL)`,
		`CREATE TABLE organization_theme_assets (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, media_type TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0, checksum_sha256 TEXT NOT NULL, native_object_key TEXT NOT NULL DEFAULT '', native_media_type TEXT NOT NULL DEFAULT '', native_size_bytes INTEGER NOT NULL DEFAULT 0, native_checksum_sha256 TEXT NOT NULL DEFAULT '', font_family TEXT NOT NULL DEFAULT '', font_style TEXT NOT NULL DEFAULT '', font_weight INTEGER NOT NULL DEFAULT 0, license_acknowledged BOOLEAN NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at DATETIME NOT NULL)`,
		`CREATE TABLE organization_theme_draft_assets (theme_id TEXT NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY (theme_id, asset_id))`,
		`CREATE TABLE organization_theme_revision_assets (theme_id TEXT NOT NULL, revision INTEGER NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY (theme_id, revision, asset_id))`,
		`CREATE TABLE jobs (id TEXT PRIMARY KEY, type TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', dedupe_key TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', run_at DATETIME NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, last_error TEXT NOT NULL DEFAULT '', locked_at DATETIME, locked_by TEXT NOT NULL DEFAULT '')`,
	}
	for _, statement := range statements {
		_, err := db.Exec(statement)
		require.NoError(t, err, statement)
	}
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
