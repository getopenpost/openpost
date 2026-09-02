package themes

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestOrganizationThemeSummaryPagesAreCompactBoundedAndStable(t *testing.T) {
	service, _ := newThemeTestService(t)
	createdAt := time.Date(2026, time.September, 2, 14, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return createdAt }
	actor := Actor{UserID: "admin-1"}
	for index := range DefaultThemePageLimit + 3 {
		_, err := service.Create(t.Context(), actor, CreateInput{
			OrganizationID:     "org-1",
			Name:               fmt.Sprintf("Theme %02d", index),
			DuplicateBuiltInID: "studio",
		})
		require.NoError(t, err)
	}

	page, err := service.List(t.Context(), actor, "org-1", PageOptions{})
	require.NoError(t, err)
	require.Len(t, page.Items, DefaultThemePageLimit)
	require.NotEmpty(t, page.NextCursor)
	encoded, err := json.Marshal(page)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), `"manifest"`)
	require.NotContains(t, string(encoded), `"draft"`)
	require.NotContains(t, string(encoded), `"latest_published"`)

	seen := map[string]struct{}{}
	cursor := ""
	for {
		page, err = service.List(t.Context(), actor, "org-1", PageOptions{Limit: 7, Cursor: cursor})
		require.NoError(t, err)
		for _, item := range page.Items {
			require.Equal(t, createdAt, item.CreatedAt, "equal timestamps must use the theme ID as the final keyset tie-breaker")
			require.NotContains(t, seen, item.Reference.ID)
			seen[item.Reference.ID] = struct{}{}
		}
		if page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
	}
	require.Len(t, seen, DefaultThemePageLimit+3)

	maximum, err := service.List(t.Context(), actor, "org-1", PageOptions{Limit: MaxThemePageLimit})
	require.NoError(t, err)
	require.Len(t, maximum.Items, DefaultThemePageLimit+3)
	for _, invalid := range []PageOptions{{Limit: -1}, {Limit: MaxThemePageLimit + 1}, {Cursor: "not-a-cursor"}, {Limit: 1, Cursor: pageCursorForOtherScope(t)}} {
		_, err = service.List(t.Context(), actor, "org-1", invalid)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
}

func TestAvailablePageContinuesFromExactBuiltInBoundaryIntoCustomThemes(t *testing.T) {
	service, db := newThemeTestService(t)
	actor := Actor{UserID: "admin-1"}
	workspaceAdmin := Actor{UserID: "workspace-admin"}
	_, err := db.ExecContext(t.Context(), `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ('workspace-1', 'workspace-admin', 'admin', 'active')`)
	require.NoError(t, err)
	custom, err := service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: "After built-ins", DuplicateBuiltInID: "studio"})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), actor, custom.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1})
	require.NoError(t, err)

	first, err := service.Available(t.Context(), workspaceAdmin, "workspace-1", PageOptions{Limit: len(builtInOrder)})
	require.NoError(t, err)
	require.Len(t, first.Items, len(builtInOrder))
	require.NotEmpty(t, first.NextCursor)
	cursor, err := decodeThemeCursor(first.NextCursor, themeCursorScope("available", "workspace-1:org-1"), cursorSegmentBuiltIn, cursorSegmentCustom)
	require.NoError(t, err)
	require.Equal(t, cursorSegmentCustom, cursor.Segment)
	require.Empty(t, cursor.NormalizedName)

	second, err := service.Available(t.Context(), workspaceAdmin, "workspace-1", PageOptions{Limit: len(builtInOrder), Cursor: first.NextCursor})
	require.NoError(t, err)
	require.Equal(t, []string{custom.Summary.Reference.ID}, summaryIDs(second.Items))
	require.Empty(t, second.NextCursor)
	for _, invalid := range []PageOptions{{Limit: -1}, {Limit: MaxThemePageLimit + 1}, {Cursor: "not-a-cursor"}} {
		_, err = service.Available(t.Context(), workspaceAdmin, "workspace-1", invalid)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
}

func TestAvailableCursorTraversesEqualPublishedNamesAndTimestamps(t *testing.T) {
	service, db := newThemeTestService(t)
	actor := Actor{UserID: "admin-1"}
	workspaceAdmin := Actor{UserID: "workspace-admin"}
	now := time.Date(2026, time.September, 2, 15, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	_, err := db.ExecContext(t.Context(), `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ('workspace-1', 'workspace-admin', 'admin', 'active')`)
	require.NoError(t, err)
	first, err := service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: "Same name", DuplicateBuiltInID: "studio"})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), actor, first.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1})
	require.NoError(t, err)
	_, err = service.UpdateDraft(t.Context(), actor, first.Summary.Reference.ID, UpdateDraftInput{
		OrganizationID: "org-1", ExpectedRevision: 1, Name: "Renamed draft", Manifest: first.Draft.Manifest,
	})
	require.NoError(t, err)
	second, err := service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: "Same name", DuplicateBuiltInID: "notebook"})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), actor, second.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1})
	require.NoError(t, err)

	builtInPage, err := service.Available(t.Context(), workspaceAdmin, "workspace-1", PageOptions{Limit: len(builtInOrder)})
	require.NoError(t, err)
	cursor := builtInPage.NextCursor
	seen := map[string]struct{}{}
	for cursor != "" {
		page, pageErr := service.Available(t.Context(), workspaceAdmin, "workspace-1", PageOptions{Limit: 1, Cursor: cursor})
		require.NoError(t, pageErr)
		require.Len(t, page.Items, 1)
		require.Equal(t, "Same name", page.Items[0].Name)
		require.Equal(t, now, page.Items[0].CreatedAt)
		require.NotContains(t, seen, page.Items[0].Reference.ID)
		seen[page.Items[0].Reference.ID] = struct{}{}
		cursor = page.NextCursor
	}
	require.Equal(t, map[string]struct{}{first.Summary.Reference.ID: {}, second.Summary.Reference.ID: {}}, seen)
}

func TestAvailableDetailOnlyServesTheAdvertisedPublishedHead(t *testing.T) {
	service, db := newThemeTestService(t)
	actor := Actor{UserID: "admin-1"}
	workspaceAdmin := Actor{UserID: "workspace-admin"}
	_, err := db.ExecContext(t.Context(), `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ('workspace-1', 'workspace-admin', 'admin', 'active')`)
	require.NoError(t, err)
	theme, err := service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: "Published head", DuplicateBuiltInID: "studio"})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), actor, theme.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1})
	require.NoError(t, err)
	updated := theme.Draft.Manifest
	updated.Description = "Second head"
	theme, err = service.UpdateDraft(t.Context(), actor, theme.Summary.Reference.ID, UpdateDraftInput{OrganizationID: "org-1", ExpectedRevision: 1, Name: "Published head", Manifest: updated})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), actor, theme.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 2, ExpectedPublishedRevision: 1})
	require.NoError(t, err)

	detail, err := service.AvailableDetail(t.Context(), workspaceAdmin, "workspace-1", theme.Summary.Reference.ID, 2)
	require.NoError(t, err)
	require.Equal(t, "2", detail.Manifest.Revision)
	require.Equal(t, "Second head", detail.Manifest.Description)
	for _, request := range []struct {
		actor     Actor
		workspace string
		themeID   string
		revision  int
		expected  error
	}{
		{workspaceAdmin, "workspace-1", theme.Summary.Reference.ID, 1, ErrNotFound},
		{workspaceAdmin, "workspace-1", theme.Summary.Reference.ID, 3, ErrNotFound},
		{workspaceAdmin, "workspace-1", "missing-theme", 2, ErrNotFound},
		{Actor{UserID: "member-1"}, "workspace-1", theme.Summary.Reference.ID, 2, ErrInaccessible},
		{workspaceAdmin, "missing-workspace", theme.Summary.Reference.ID, 2, ErrInaccessible},
	} {
		_, err = service.AvailableDetail(t.Context(), request.actor, request.workspace, request.themeID, request.revision)
		require.ErrorIs(t, err, request.expected)
	}
}

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

func TestAvailablePageScansPastOneHundredUnavailableRowsAndSoftlyExhausts(t *testing.T) {
	service, db := newThemeTestService(t)
	actor := Actor{UserID: "admin-1"}
	workspaceAdmin := Actor{UserID: "workspace-admin"}
	_, err := db.ExecContext(t.Context(), `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ('workspace-1', 'workspace-admin', 'admin', 'active')`)
	require.NoError(t, err)
	for index := range MaxThemePageLimit + 5 {
		item, createErr := service.Create(t.Context(), actor, CreateInput{
			OrganizationID: "org-1", Name: fmt.Sprintf("Unavailable %03d", index), DuplicateBuiltInID: "studio",
		})
		require.NoError(t, createErr)
		_, publishErr := service.Publish(t.Context(), actor, item.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1})
		require.NoError(t, publishErr)
		_, corruptErr := db.NewUpdate().Model((*revisionRow)(nil)).Set("manifest_json = ?", `{not-json`).
			Where("theme_id = ? AND revision = 1", item.Summary.Reference.ID).Exec(t.Context())
		require.NoError(t, corruptErr)
	}
	safe, err := service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: "Z safe", DuplicateBuiltInID: "notebook"})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), actor, safe.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1})
	require.NoError(t, err)

	builtInPage, err := service.Available(t.Context(), workspaceAdmin, "workspace-1", PageOptions{Limit: len(builtInOrder)})
	require.NoError(t, err)
	page, err := service.Available(t.Context(), workspaceAdmin, "workspace-1", PageOptions{Limit: 1, Cursor: builtInPage.NextCursor})
	require.NoError(t, err)
	require.Equal(t, []string{safe.Summary.Reference.ID}, summaryIDs(page.Items))
	require.Empty(t, page.NextCursor)

	_, err = db.NewUpdate().Model((*revisionRow)(nil)).Set("manifest_json = ?", `{not-json`).
		Where("theme_id = ? AND revision = 1", safe.Summary.Reference.ID).Exec(t.Context())
	require.NoError(t, err)
	page, err = service.Available(t.Context(), workspaceAdmin, "workspace-1", PageOptions{Limit: 1, Cursor: builtInPage.NextCursor})
	require.NoError(t, err)
	require.Empty(t, page.Items)
	require.Empty(t, page.NextCursor)
}

func TestThemeSummaryQueryCountsStayConstantAsPagesGrow(t *testing.T) {
	service, db := newThemeTestService(t)
	actor := Actor{UserID: "admin-1"}
	counter := &themeQueryCounter{}
	db.AddQueryHook(counter)
	_, err := service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: "Theme 00", DuplicateBuiltInID: "studio"})
	require.NoError(t, err)

	counter.Reset()
	_, err = service.List(t.Context(), actor, "org-1", PageOptions{Limit: MaxThemePageLimit})
	require.NoError(t, err)
	oneThemeQueries := counter.Count()
	t.Logf("organization summary page queries: %d", oneThemeQueries)
	for index := 1; index < 40; index++ {
		_, err = service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: fmt.Sprintf("Theme %02d", index), DuplicateBuiltInID: "studio"})
		require.NoError(t, err)
	}
	counter.Reset()
	page, err := service.List(t.Context(), actor, "org-1", PageOptions{Limit: MaxThemePageLimit})
	require.NoError(t, err)
	require.Len(t, page.Items, 40)
	require.Equal(t, oneThemeQueries, counter.Count(), "joined drafts and grouped usage must not add queries per theme")

	_, err = db.ExecContext(t.Context(), `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ('workspace-1', 'workspace-admin', 'admin', 'active')`)
	require.NoError(t, err)
	service.storage = mediastore.NewLocalStorage(t.TempDir(), "/theme-assets")
	asset, err := service.UploadAsset(t.Context(), actor, UploadAssetInput{
		OrganizationID: "org-1", Kind: AssetIllustration, Name: "Shared art", MediaType: "image/png", Content: bytes.NewReader(pngImage(t, 20, 20)),
	})
	require.NoError(t, err)
	manifest := BuiltIns()["workshop"]
	manifest.Assets = []ThemeAsset{{ID: asset.ID, Slot: "header-decoration", SourceURL: "asset:" + asset.ID, MimeType: "image/png", Alt: "Shared"}}
	first, err := service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: "Published 00", Manifest: manifest})
	require.NoError(t, err)
	_, err = service.Publish(t.Context(), actor, first.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1})
	require.NoError(t, err)
	workspaceAdmin := Actor{UserID: "workspace-admin"}
	counter.Reset()
	_, err = service.Available(t.Context(), workspaceAdmin, "workspace-1", PageOptions{Limit: MaxThemePageLimit})
	require.NoError(t, err)
	onePublishedQueries := counter.Count()
	t.Logf("available catalog page queries with resources: %d", onePublishedQueries)
	for index := 1; index < 12; index++ {
		item, createErr := service.Create(t.Context(), actor, CreateInput{OrganizationID: "org-1", Name: fmt.Sprintf("Published %02d", index), Manifest: manifest})
		require.NoError(t, createErr)
		_, publishErr := service.Publish(t.Context(), actor, item.Summary.Reference.ID, PublishInput{OrganizationID: "org-1", ExpectedDraftRevision: 1})
		require.NoError(t, publishErr)
	}
	counter.Reset()
	available, err := service.Available(t.Context(), workspaceAdmin, "workspace-1", PageOptions{Limit: MaxThemePageLimit})
	require.NoError(t, err)
	require.Len(t, available.Items, len(builtInOrder)+12)
	require.Equal(t, onePublishedQueries, counter.Count(), "published heads, resource links, assets, and usage must load in fixed query batches")
}

func pageCursorForOtherScope(t *testing.T) string {
	t.Helper()
	return encodeThemeCursor(themePageCursor{
		Scope:          themeCursorScope("organization", "other-org"),
		Segment:        cursorSegmentCustom,
		NormalizedName: "theme",
		CreatedAt:      time.Date(2026, time.September, 2, 14, 0, 0, 0, time.UTC),
		ID:             "theme-1",
	})
}

func summaryIDs(items []ThemeSummary) []string {
	result := make([]string, 0, len(items))
	for _, item := range items {
		result = append(result, item.Reference.ID)
	}
	return result
}

type themeQueryCounter struct{ count atomic.Int64 }

func (counter *themeQueryCounter) BeforeQuery(ctx context.Context, _ *bun.QueryEvent) context.Context {
	return ctx
}

func (counter *themeQueryCounter) AfterQuery(context.Context, *bun.QueryEvent) {
	counter.count.Add(1)
}

func (counter *themeQueryCounter) Reset()       { counter.count.Store(0) }
func (counter *themeQueryCounter) Count() int64 { return counter.count.Load() }
