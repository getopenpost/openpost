package themes

import (
	"bytes"

	"testing"

	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/stretchr/testify/require"
)

func TestAvailablePageSkipsUnsafeRowsWithoutAnEmptyContinuation(t *testing.T) {
	service, db := newThemeTestService(t)
	service.storage = mediastore.NewLocalStorage(t.TempDir(), "/theme-assets")
	actor := Actor{UserID: "admin-1"}
	workspaceAdmin := Actor{UserID: "workspace-admin"}
	_, err := db.ExecContext(t.Context(), `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ('workspace-1', 'workspace-admin', 'admin', 'active')`)
	require.NoError(t, err)
	asset, err := service.UploadAsset(t.Context(), actor, UploadAssetInput{
		OrganizationID: "org-1", Kind: AssetIllustration, Name: "Unsafe art", MediaType: "image/png", Content: bytes.NewReader(pngImage(t, 20, 20)),
	})
	require.NoError(t, err)
	unsafeManifest := BuiltIns()["workshop"]
	unsafeManifest.Assets = []ThemeAsset{{ID: asset.ID, Slot: "header-decoration", SourceURL: "asset:" + asset.ID, MimeType: "image/png", Alt: "Unsafe"}}
	unsafeTheme, err := service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: "A unsafe", Manifest: unsafeManifest})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), actor, unsafeTheme.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1})
	require.NoError(t, err)
	safeTheme, err := service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: "B safe", DuplicateBuiltInID: "studio"})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), actor, safeTheme.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1})
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*assetRow)(nil)).Set("checksum_sha256 = ?", "invalid").Where("id = ?", asset.ID).Exec(t.Context())
	require.NoError(t, err)

	builtIns, err := service.Available(t.Context(), workspaceAdmin, "workspace-1", PageOptions{Limit: len(builtInOrder)})
	require.NoError(t, err)
	page, err := service.Available(t.Context(), workspaceAdmin, "workspace-1", PageOptions{Limit: 1, Cursor: builtIns.NextCursor})
	require.NoError(t, err)
	require.Equal(t, []string{safeTheme.Summary.Reference.ID}, summaryIDs(page.Items))
	require.Empty(t, page.NextCursor)
	_, err = service.AvailableDetail(t.Context(), workspaceAdmin, "workspace-1", unsafeTheme.Summary.Reference.ID, 1)
	require.ErrorIs(t, err, ErrNotFound)
}

func summaryIDs(items []ThemeSummary) []string {
	result := make([]string, 0, len(items))
	for _, item := range items {
		result = append(result, item.Reference.ID)
	}
	return result
}
