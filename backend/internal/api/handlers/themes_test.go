package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/themes"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestThemeHTTPLifecyclePreservesAdvancedManifestAndServesOpaqueAssets(t *testing.T) {
	e, db, _ := newThemeTestServer(t)
	fontBytes := handlerRealWOFF2(t)
	font := uploadThemeAsset(t, e, map[string]any{
		"organization_id": "org-1", "kind": "font", "name": "Roboto Regular",
		"media_type": "font/woff2", "font_family": "Roboto", "font_style": "normal",
		"font_weight": 400, "license_acknowledged": true,
		"content_base64": base64.StdEncoding.EncodeToString(fontBytes),
	})
	decorationBytes := handlerPNG(t, 320, 180)
	decoration := uploadThemeAsset(t, e, map[string]any{
		"organization_id": "org-1", "kind": "illustration", "name": "Header illustration",
		"media_type": "image/png", "content_base64": base64.StdEncoding.EncodeToString(decorationBytes),
	})

	manifest := themes.BuiltIns()["workshop"]
	manifest.IconPack = themes.IconPhosphor
	manifest.Schemes.Light.Typography.Body.Family = "Roboto"
	manifest.Schemes.Light.Typography.Body.Weight = 400
	manifest.Fonts = []themes.ThemeFontFace{{ID: font.ID, Family: "Roboto", SourceURL: "asset:" + font.ID, Format: "woff2", Weight: 400, Style: "normal", Display: "swap"}}
	manifest.Assets = []themes.ThemeAsset{{ID: decoration.ID, Slot: "header-decoration", SourceURL: "asset:" + decoration.ID, MimeType: "image/png", Alt: "Abstract orange header shapes"}}

	createdResponse := themeRequest(t, e, http.MethodPost, "/api/v1/themes", map[string]any{"organization_id": "org-1", "name": "Launch kit", "manifest": manifest})
	require.Equal(t, http.StatusOK, createdResponse.Code, createdResponse.Body.String())
	var created themes.Theme
	require.NoError(t, json.Unmarshal(createdResponse.Body.Bytes(), &created))
	require.Equal(t, themes.IconPhosphor, created.Draft.Manifest.IconPack)
	require.Equal(t, "Roboto", created.Draft.Manifest.Schemes.Light.Typography.Body.Family)
	require.Equal(t, "header-decoration", created.Draft.Manifest.Assets[0].Slot)

	themeID := created.Summary.Reference.ID
	publishResponse := themeRequest(t, e, http.MethodPost, "/api/v1/themes/"+url.PathEscape(themeID)+"/publish", map[string]any{"organization_id": "org-1", "expected_draft_revision": 1, "expected_published_revision": 0})
	require.Equal(t, http.StatusOK, publishResponse.Code, publishResponse.Body.String())
	stalePublishResponse := themeRequest(t, e, http.MethodPost, "/api/v1/themes/"+url.PathEscape(themeID)+"/publish", map[string]any{"organization_id": "org-1", "expected_draft_revision": 1, "expected_published_revision": 0})
	require.Equal(t, http.StatusConflict, stalePublishResponse.Code, stalePublishResponse.Body.String())
	settingsResponse := themeRequest(t, e, http.MethodPut, "/api/v1/theme-settings/organization", map[string]any{
		"organization_id": "org-1", "default_reference": map[string]any{"kind": "custom", "id": themeID, "version": 1}, "assignments_locked": false,
	})
	require.Equal(t, http.StatusOK, settingsResponse.Code, settingsResponse.Body.String())
	assignmentResponse := themeRequest(t, e, http.MethodPut, "/api/v1/theme-assignments/workspace-1", map[string]any{
		"reference": map[string]any{"kind": "custom", "id": themeID, "version": 1},
	})
	require.Equal(t, http.StatusOK, assignmentResponse.Code, assignmentResponse.Body.String())

	draftOnlyResponse := themeRequest(t, e, http.MethodPost, "/api/v1/themes", map[string]any{
		"organization_id": "org-1", "name": "Draft only", "manifest": themes.BuiltIns()["notebook"],
	})
	require.Equal(t, http.StatusOK, draftOnlyResponse.Code, draftOnlyResponse.Body.String())
	libraryResponse := themeRequest(t, e, http.MethodGet, "/api/v1/themes?organization_id=org-1", nil)
	require.Equal(t, http.StatusOK, libraryResponse.Code, libraryResponse.Body.String())
	var library themes.ThemeSummaryPage
	require.NoError(t, json.Unmarshal(libraryResponse.Body.Bytes(), &library))
	require.Len(t, library.Items, 2)
	require.Equal(t, themeID, library.Items[1].Reference.ID)
	require.NotContains(t, libraryResponse.Body.String(), `"manifest"`)
	require.NotContains(t, libraryResponse.Body.String(), `"draft"`)

	catalogResponse := themeRequestAs(t, e, "workspace-admin-token", http.MethodGet, "/api/v1/themes/available?workspace_id=workspace-1", nil)
	require.Equal(t, http.StatusOK, catalogResponse.Code, catalogResponse.Body.String())
	var catalog themes.ThemeSummaryPage
	require.NoError(t, json.Unmarshal(catalogResponse.Body.Bytes(), &catalog))
	require.Len(t, catalog.Items, 9, "draft-only themes stay out of the published catalog")
	publishedSummary := catalog.Items[len(catalog.Items)-1]
	require.Equal(t, themeID, publishedSummary.Reference.ID)
	require.Zero(t, publishedSummary.DraftRevision)
	require.NotContains(t, catalogResponse.Body.String(), `"manifest"`)
	detailResponse := themeRequestAs(t, e, "workspace-admin-token", http.MethodGet, "/api/v1/themes/available/"+url.PathEscape(themeID)+"?workspace_id=workspace-1&revision=1", nil)
	require.Equal(t, http.StatusOK, detailResponse.Code, detailResponse.Body.String())
	var publishedPreview themes.PublishedThemeCatalogItem
	require.NoError(t, json.Unmarshal(detailResponse.Body.Bytes(), &publishedPreview))
	previewURL := "/api/v1/theme-assets/" + decoration.ID + "/content?workspace_id=workspace-1&theme_id=" + themeID + "&revision=1"
	require.Equal(t, previewURL, publishedPreview.Manifest.Assets[0].SourceURL)
	require.Equal(t, "/api/v1/theme-assets/"+font.ID+"/content?workspace_id=workspace-1&theme_id="+themeID+"&revision=1&format=ttf", publishedPreview.Manifest.Fonts[0].NativeDerivative.SourceURL)
	require.Equal(t, "ttf", publishedPreview.Manifest.Fonts[0].NativeDerivative.Format)
	require.NotEmpty(t, publishedPreview.Manifest.Fonts[0].NativeDerivative.Identity)
	require.NotContains(t, catalogResponse.Body.String(), `"asset:`)
	previewContent := themeRequestAs(t, e, "workspace-admin-token", http.MethodGet, previewURL, nil)
	require.Equal(t, http.StatusOK, previewContent.Code, previewContent.Body.String())
	require.Equal(t, decorationBytes, previewContent.Body.Bytes())
	previewNative := themeRequestAs(t, e, "workspace-admin-token", http.MethodGet, publishedPreview.Manifest.Fonts[0].NativeDerivative.SourceURL, nil)
	require.Equal(t, http.StatusOK, previewNative.Code, previewNative.Body.String())
	require.Equal(t, "font/ttf", previewNative.Header().Get("Content-Type"))
	require.Equal(t, http.StatusOK, themeRequestAs(t, e, "viewer-token", http.MethodGet, publishedPreview.Manifest.Fonts[0].NativeDerivative.SourceURL, nil).Code, "members may stage the exact revision selected for their Workspace")
	require.Equal(t, http.StatusForbidden, themeRequestAs(t, e, "viewer-token", http.MethodGet, "/api/v1/themes/available?workspace_id=workspace-1", nil).Code)
	require.Equal(t, http.StatusForbidden, themeRequestAs(t, e, "viewer-token", http.MethodGet, "/api/v1/themes?organization_id=org-1", nil).Code)
	require.Equal(t, http.StatusForbidden, themeRequest(t, e, http.MethodGet, "/api/v1/themes?organization_id=unknown-org", nil).Code)
	viewerSettingsResponse := themeRequestAs(t, e, "viewer-token", http.MethodGet, "/api/v1/theme-settings?workspace_id=workspace-1", nil)
	require.Equal(t, http.StatusForbidden, viewerSettingsResponse.Code, viewerSettingsResponse.Body.String())

	resolvedResponse := themeRequest(t, e, http.MethodGet, "/api/v1/themes/resolved?workspace_id=workspace-1&scheme=light", nil)
	require.Equal(t, http.StatusOK, resolvedResponse.Code, resolvedResponse.Body.String())
	var resolved themes.ResolvedTheme
	require.NoError(t, json.Unmarshal(resolvedResponse.Body.Bytes(), &resolved))
	require.Equal(t, themes.IconPhosphor, resolved.IconPack)
	require.Equal(t, "Roboto", resolved.Manifest.Typography.Body.Family)
	require.Equal(t, "/api/v1/theme-assets/"+font.ID+"/content?workspace_id=workspace-1&theme_id="+themeID+"&revision=1", resolved.Fonts[0].SourceURL)
	require.Equal(t, "/api/v1/theme-assets/"+font.ID+"/content?workspace_id=workspace-1&theme_id="+themeID+"&revision=1&format=ttf", resolved.Fonts[0].NativeDerivative.SourceURL)
	require.Equal(t, "ttf", resolved.Fonts[0].NativeDerivative.Format)
	require.NotEmpty(t, resolved.Fonts[0].NativeDerivative.Identity)
	require.Equal(t, "/api/v1/theme-assets/"+decoration.ID+"/content?workspace_id=workspace-1&theme_id="+themeID+"&revision=1", resolved.Assets[0].SourceURL)
	require.NotEmpty(t, resolvedResponse.Header().Get("ETag"))
	require.Equal(t, "private, no-cache", resolvedResponse.Header().Get("Cache-Control"))
	require.Equal(t, "Authorization, Cookie", resolvedResponse.Header().Get("Vary"))
	resolvedNative := themeRequestAs(t, e, "viewer-token", http.MethodGet, resolved.Fonts[0].NativeDerivative.SourceURL, nil)
	require.Equal(t, http.StatusOK, resolvedNative.Code, resolvedNative.Body.String())
	require.Equal(t, "font/ttf", resolvedNative.Header().Get("Content-Type"))
	resolvedConditionalRequest := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/themes/resolved?workspace_id=workspace-1&scheme=light", nil)
	resolvedConditionalRequest.Header.Set("Authorization", "Bearer web-token")
	resolvedConditionalRequest.Header.Set("If-None-Match", resolvedResponse.Header().Get("ETag"))
	resolvedConditionalResponse := httptest.NewRecorder()
	e.ServeHTTP(resolvedConditionalResponse, resolvedConditionalRequest)
	require.Equal(t, http.StatusNotModified, resolvedConditionalResponse.Code, resolvedConditionalResponse.Body.String())
	require.Empty(t, resolvedConditionalResponse.Body.Bytes())
	require.Equal(t, "private, no-cache", resolvedConditionalResponse.Header().Get("Cache-Control"))
	require.Equal(t, "Authorization, Cookie", resolvedConditionalResponse.Header().Get("Vary"))

	contentResponse := themeRequest(t, e, http.MethodGet, "/api/v1/theme-assets/"+decoration.ID+"/content?organization_id=org-1", nil)
	require.Equal(t, http.StatusOK, contentResponse.Code, contentResponse.Body.String())
	require.Equal(t, decorationBytes, contentResponse.Body.Bytes())
	require.Equal(t, "image/png", contentResponse.Header().Get("Content-Type"))
	require.Equal(t, "nosniff", contentResponse.Header().Get("X-Content-Type-Options"))
	require.NotEmpty(t, contentResponse.Header().Get("ETag"))
	require.Equal(t, "private, no-cache", contentResponse.Header().Get("Cache-Control"))
	require.Equal(t, "Authorization, Cookie", contentResponse.Header().Get("Vary"))
	cookieRequest := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/theme-assets/"+decoration.ID+"/content?organization_id=org-1", nil)
	cookieRequest.AddCookie(&http.Cookie{Name: "openpost_session", Value: "web-token"})
	cookieResponse := httptest.NewRecorder()
	e.ServeHTTP(cookieResponse, cookieRequest)
	require.Equal(t, http.StatusOK, cookieResponse.Code, cookieResponse.Body.String())
	require.Equal(t, decorationBytes, cookieResponse.Body.Bytes())
	conditionalRequest := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/theme-assets/"+decoration.ID+"/content?organization_id=org-1", nil)
	conditionalRequest.Header.Set("Authorization", "Bearer web-token")
	conditionalRequest.Header.Set("If-None-Match", contentResponse.Header().Get("ETag"))
	conditionalResponse := httptest.NewRecorder()
	e.ServeHTTP(conditionalResponse, conditionalRequest)
	require.Equal(t, http.StatusNotModified, conditionalResponse.Code, conditionalResponse.Body.String())
	require.Empty(t, conditionalResponse.Body.Bytes())
	require.Equal(t, "private, no-cache", conditionalResponse.Header().Get("Cache-Control"))
	require.Equal(t, "Authorization, Cookie", conditionalResponse.Header().Get("Vary"))
	nativeContent := themeRequest(t, e, http.MethodGet, "/api/v1/theme-assets/"+font.ID+"/content?organization_id=org-1&format=ttf", nil)
	require.Equal(t, http.StatusOK, nativeContent.Code, nativeContent.Body.String())
	require.Equal(t, "font/ttf", nativeContent.Header().Get("Content-Type"))
	require.Equal(t, []byte{0x00, 0x01, 0x00, 0x00}, nativeContent.Body.Bytes()[:4])

	guardedAssetDelete := themeRequest(t, e, http.MethodDelete, "/api/v1/theme-assets/"+decoration.ID+"?organization_id=org-1&confirm=true", nil)
	require.Equal(t, http.StatusConflict, guardedAssetDelete.Code, guardedAssetDelete.Body.String())
	updatedManifest := themes.BuiltIns()["workshop"]
	updatedManifest.Description = "Published update"
	updatedResponse := themeRequest(t, e, http.MethodPut, "/api/v1/themes/"+url.PathEscape(themeID)+"/draft", map[string]any{
		"organization_id": "org-1", "expected_revision": 1, "name": "Launch kit", "manifest": updatedManifest,
	})
	require.Equal(t, http.StatusOK, updatedResponse.Code, updatedResponse.Body.String())
	staleUpdate := themeRequest(t, e, http.MethodPut, "/api/v1/themes/"+url.PathEscape(themeID)+"/draft", map[string]any{
		"organization_id": "org-1", "expected_revision": 1, "name": "Launch kit", "manifest": updatedManifest,
	})
	require.Equal(t, http.StatusConflict, staleUpdate.Code, staleUpdate.Body.String())
	publishSecond := themeRequest(t, e, http.MethodPost, "/api/v1/themes/"+url.PathEscape(themeID)+"/publish", map[string]any{"organization_id": "org-1", "expected_draft_revision": 2, "expected_published_revision": 1})
	require.Equal(t, http.StatusOK, publishSecond.Code, publishSecond.Body.String())
	settingsAfterPublish := themeRequest(t, e, http.MethodGet, "/api/v1/theme-settings?workspace_id=workspace-1", nil)
	require.Equal(t, http.StatusOK, settingsAfterPublish.Code, settingsAfterPublish.Body.String())
	var advancedSettings themes.ThemeSettings
	require.NoError(t, json.Unmarshal(settingsAfterPublish.Body.Bytes(), &advancedSettings))
	require.Equal(t, 2, advancedSettings.OrganizationDefault.Version)
	require.NotNil(t, advancedSettings.WorkspaceSelection)
	require.Equal(t, 2, advancedSettings.WorkspaceSelection.Version)
	require.True(t, advancedSettings.CanManageWorkspace)
	require.True(t, advancedSettings.CanManageOrganization)
	oldRevisionContent := themeRequestAs(t, e, "viewer-token", http.MethodGet, resolved.Assets[0].SourceURL, nil)
	require.Equal(t, http.StatusOK, oldRevisionContent.Code, oldRevisionContent.Body.String())
	require.Equal(t, decorationBytes, oldRevisionContent.Body.Bytes(), "a concurrent same-family publish must not break in-flight staging of an immutable revision")

	revisionsResponse := themeRequest(t, e, http.MethodGet, "/api/v1/themes/"+url.PathEscape(themeID)+"/revisions?organization_id=org-1", nil)
	require.Equal(t, http.StatusOK, revisionsResponse.Code, revisionsResponse.Body.String())
	var revisions []themes.PublishedRevision
	require.NoError(t, json.Unmarshal(revisionsResponse.Body.Bytes(), &revisions))
	require.Len(t, revisions, 2)
	require.Equal(t, 2, revisions[0].Revision)
	firstRevision := themeRequest(t, e, http.MethodGet, "/api/v1/themes/"+url.PathEscape(themeID)+"/revisions/1?organization_id=org-1", nil)
	require.Equal(t, http.StatusOK, firstRevision.Code, firstRevision.Body.String())
	rollbackResponse := themeRequest(t, e, http.MethodPost, "/api/v1/themes/"+url.PathEscape(themeID)+"/rollback", map[string]any{
		"organization_id": "org-1", "source_revision": 1, "expected_draft_revision": 2, "expected_published_revision": 2,
	})
	require.Equal(t, http.StatusOK, rollbackResponse.Code, rollbackResponse.Body.String())
	var rolledBack themes.PublishedRevision
	require.NoError(t, json.Unmarshal(rollbackResponse.Body.Bytes(), &rolledBack))
	require.Equal(t, 3, rolledBack.Revision)
	require.NotNil(t, rolledBack.SourceRevision)
	require.Equal(t, 1, *rolledBack.SourceRevision)
	staleRollbackResponse := themeRequest(t, e, http.MethodPost, "/api/v1/themes/"+url.PathEscape(themeID)+"/rollback", map[string]any{
		"organization_id": "org-1", "source_revision": 1, "expected_draft_revision": 2, "expected_published_revision": 2,
	})
	require.Equal(t, http.StatusConflict, staleRollbackResponse.Code, staleRollbackResponse.Body.String())
	themeAfterRollback := themeRequest(t, e, http.MethodGet, "/api/v1/themes/"+url.PathEscape(themeID)+"?organization_id=org-1", nil)
	require.Equal(t, http.StatusOK, themeAfterRollback.Code, themeAfterRollback.Body.String())
	var rollbackState themes.Theme
	require.NoError(t, json.Unmarshal(themeAfterRollback.Body.Bytes(), &rollbackState))
	require.Equal(t, 3, rollbackState.Draft.Revision)
	require.NotEqual(t, "Published update", rollbackState.Draft.Manifest.Description)
	deleteInUse := themeRequest(t, e, http.MethodDelete, "/api/v1/themes/"+url.PathEscape(themeID)+"?organization_id=org-1&confirm=true", nil)
	require.Equal(t, http.StatusConflict, deleteInUse.Code, deleteInUse.Body.String())
	lockedResponse := themeRequest(t, e, http.MethodPut, "/api/v1/theme-settings/organization", map[string]any{
		"organization_id": "org-1", "default_reference": map[string]any{"kind": "built_in", "id": "workshop", "version": 1}, "assignments_locked": true,
	})
	require.Equal(t, http.StatusOK, lockedResponse.Code, lockedResponse.Body.String())
	lockedSettingsResponse := themeRequest(t, e, http.MethodGet, "/api/v1/theme-settings?workspace_id=workspace-1", nil)
	require.Equal(t, http.StatusOK, lockedSettingsResponse.Code, lockedSettingsResponse.Body.String())
	var lockedSettings themes.ThemeSettings
	require.NoError(t, json.Unmarshal(lockedSettingsResponse.Body.Bytes(), &lockedSettings))
	require.True(t, lockedSettings.AssignmentsLocked)
	require.Nil(t, lockedSettings.WorkspaceSelection)
	require.Equal(t, "workshop", lockedSettings.EffectiveSelection.ID)

	var linked int
	require.NoError(t, db.NewRaw("SELECT COUNT(*) FROM organization_theme_revision_assets WHERE theme_id = ?", themeID).Scan(t.Context(), &linked))
	require.Equal(t, 4, linked)
	deletedTheme := themeRequest(t, e, http.MethodDelete, "/api/v1/themes/"+url.PathEscape(themeID)+"?organization_id=org-1&confirm=true", nil)
	require.Equal(t, http.StatusOK, deletedTheme.Code, deletedTheme.Body.String())
	require.Equal(t, http.StatusNotFound, themeRequest(t, e, http.MethodGet, "/api/v1/themes/"+url.PathEscape(themeID)+"?organization_id=org-1", nil).Code)

	unusedBytes := handlerPNG(t, 24, 24)
	unused := uploadThemeAsset(t, e, map[string]any{
		"organization_id": "org-1", "kind": "illustration", "name": "Unused",
		"media_type": "image/png", "content_base64": base64.StdEncoding.EncodeToString(unusedBytes),
	})
	unusedContent := themeRequest(t, e, http.MethodGet, "/api/v1/theme-assets/"+unused.ID+"/content?organization_id=org-1", nil)
	require.Equal(t, http.StatusOK, unusedContent.Code, unusedContent.Body.String())
	require.Equal(t, unusedBytes, unusedContent.Body.Bytes())
	_, err := db.NewUpdate().Table("organization_theme_assets").
		Set("checksum_sha256 = ?", "0000000000000000000000000000000000000000000000000000000000000000").
		Where("id = ?", unused.ID).Exec(t.Context())
	require.NoError(t, err)
	corruptContent := themeRequest(t, e, http.MethodGet, "/api/v1/theme-assets/"+unused.ID+"/content?organization_id=org-1", nil)
	require.Equal(t, http.StatusServiceUnavailable, corruptContent.Code, corruptContent.Body.String())
	deleted := themeRequest(t, e, http.MethodDelete, "/api/v1/theme-assets/"+unused.ID+"?organization_id=org-1&confirm=true", nil)
	require.Equal(t, http.StatusOK, deleted.Code, deleted.Body.String())
	missing := themeRequest(t, e, http.MethodGet, "/api/v1/theme-assets/"+unused.ID+"/content?organization_id=org-1", nil)
	require.Equal(t, http.StatusNotFound, missing.Code, missing.Body.String())

	require.NoError(t, db.NewRaw("SELECT COUNT(*) FROM organization_theme_revision_assets WHERE theme_id = ?", themeID).Scan(t.Context(), &linked))
	require.Zero(t, linked)
}

func TestThemeHTTPDuplicateBuiltInDoesNotRequireManifest(t *testing.T) {
	e, _, _ := newThemeTestServer(t)
	response := themeRequest(t, e, http.MethodPost, "/api/v1/themes", map[string]any{
		"organization_id": "org-1", "name": "Studio copy", "duplicate_built_in_id": "studio",
	})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var created themes.Theme
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &created))
	require.Equal(t, "Studio copy", created.Summary.Name)
	require.Equal(t, themes.BuiltIns()["studio"].IconPack, created.Draft.Manifest.IconPack)
}

func TestThemeHTTPSettingsRequireManagementWithoutWorkspaceEnumeration(t *testing.T) {
	e, _, _ := newThemeTestServer(t)
	viewerKnown := themeRequestAs(t, e, "viewer-token", http.MethodGet, "/api/v1/theme-settings?workspace_id=workspace-1", nil)
	viewerMissing := themeRequestAs(t, e, "viewer-token", http.MethodGet, "/api/v1/theme-settings?workspace_id=missing-workspace", nil)
	require.Equal(t, http.StatusForbidden, viewerKnown.Code, viewerKnown.Body.String())
	require.Equal(t, viewerKnown.Code, viewerMissing.Code)
	require.JSONEq(t, viewerKnown.Body.String(), viewerMissing.Body.String())

	workspaceAdmin := themeRequestAs(t, e, "workspace-admin-token", http.MethodGet, "/api/v1/theme-settings?workspace_id=workspace-1", nil)
	require.Equal(t, http.StatusOK, workspaceAdmin.Code, workspaceAdmin.Body.String())
	resolved := themeRequestAs(t, e, "viewer-token", http.MethodGet, "/api/v1/themes/resolved?workspace_id=workspace-1&scheme=light", nil)
	require.Equal(t, http.StatusOK, resolved.Code, resolved.Body.String(), "ordinary members still read the resolved theme")
}

func TestThemeHTTPSummaryPaginationIsBoundedCompactAndComplete(t *testing.T) {
	e, _, _ := newThemeTestServer(t)
	createdIDs := map[string]struct{}{}
	publishedIDs := map[string]struct{}{}
	customsToPublish := themes.DefaultThemePageLimit - len(themes.BuiltIns()) + 1
	for index := range themes.DefaultThemePageLimit + 3 {
		response := themeRequest(t, e, http.MethodPost, "/api/v1/themes", map[string]any{
			"organization_id": "org-1", "name": fmt.Sprintf("Theme %02d", index), "duplicate_built_in_id": "studio",
		})
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var created themes.Theme
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &created))
		createdIDs[created.Summary.Reference.ID] = struct{}{}
		if index < customsToPublish {
			published := themeRequest(t, e, http.MethodPost, "/api/v1/themes/"+url.PathEscape(created.Summary.Reference.ID)+"/publish", map[string]any{
				"organization_id": "org-1", "expected_draft_revision": 1, "expected_published_revision": 0,
			})
			require.Equal(t, http.StatusOK, published.Code, published.Body.String())
			publishedIDs[created.Summary.Reference.ID] = struct{}{}
		}
	}

	defaultPageResponse := themeRequest(t, e, http.MethodGet, "/api/v1/themes?organization_id=org-1", nil)
	require.Equal(t, http.StatusOK, defaultPageResponse.Code, defaultPageResponse.Body.String())
	var defaultPage themes.ThemeSummaryPage
	require.NoError(t, json.Unmarshal(defaultPageResponse.Body.Bytes(), &defaultPage))
	require.Len(t, defaultPage.Items, themes.DefaultThemePageLimit)
	require.NotEmpty(t, defaultPage.NextCursor)
	require.Less(t, defaultPageResponse.Body.Len(), 32_000)
	require.NotContains(t, defaultPageResponse.Body.String(), `"manifest"`)
	require.NotContains(t, defaultPageResponse.Body.String(), `"draft"`)

	maximumResponse := themeRequest(t, e, http.MethodGet, "/api/v1/themes?organization_id=org-1&limit=100", nil)
	require.Equal(t, http.StatusOK, maximumResponse.Code, maximumResponse.Body.String())
	var maximum themes.ThemeSummaryPage
	require.NoError(t, json.Unmarshal(maximumResponse.Body.Bytes(), &maximum))
	require.Len(t, maximum.Items, len(createdIDs))

	seen := map[string]struct{}{}
	cursor := ""
	for {
		path := "/api/v1/themes?organization_id=org-1&limit=7"
		if cursor != "" {
			path += "&cursor=" + url.QueryEscape(cursor)
		}
		response := themeRequest(t, e, http.MethodGet, path, nil)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var page themes.ThemeSummaryPage
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &page))
		for _, item := range page.Items {
			require.Contains(t, createdIDs, item.Reference.ID)
			require.NotContains(t, seen, item.Reference.ID)
			seen[item.Reference.ID] = struct{}{}
		}
		if page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
	}
	require.Equal(t, createdIDs, seen)

	for _, query := range []string{"&limit=0", "&limit=-1", "&limit=101"} {
		response := themeRequest(t, e, http.MethodGet, "/api/v1/themes?organization_id=org-1"+query, nil)
		require.Equal(t, http.StatusUnprocessableEntity, response.Code, response.Body.String())
	}
	invalidCursor := themeRequest(t, e, http.MethodGet, "/api/v1/themes?organization_id=org-1&cursor=not-a-cursor", nil)
	require.Equal(t, http.StatusBadRequest, invalidCursor.Code, invalidCursor.Body.String())

	availableDefaultResponse := themeRequestAs(t, e, "workspace-admin-token", http.MethodGet, "/api/v1/themes/available?workspace_id=workspace-1", nil)
	require.Equal(t, http.StatusOK, availableDefaultResponse.Code, availableDefaultResponse.Body.String())
	var availableDefault themes.ThemeSummaryPage
	require.NoError(t, json.Unmarshal(availableDefaultResponse.Body.Bytes(), &availableDefault))
	require.Len(t, availableDefault.Items, themes.DefaultThemePageLimit)
	require.NotEmpty(t, availableDefault.NextCursor)
	require.Less(t, availableDefaultResponse.Body.Len(), 32_000)
	require.NotContains(t, availableDefaultResponse.Body.String(), `"manifest"`)

	availableMaximumResponse := themeRequestAs(t, e, "workspace-admin-token", http.MethodGet, "/api/v1/themes/available?workspace_id=workspace-1&limit=100", nil)
	require.Equal(t, http.StatusOK, availableMaximumResponse.Code, availableMaximumResponse.Body.String())
	var availableMaximum themes.ThemeSummaryPage
	require.NoError(t, json.Unmarshal(availableMaximumResponse.Body.Bytes(), &availableMaximum))
	require.Len(t, availableMaximum.Items, len(themes.BuiltIns())+len(publishedIDs))
	for _, query := range []string{"&limit=0", "&limit=-1", "&limit=101"} {
		response := themeRequestAs(t, e, "workspace-admin-token", http.MethodGet, "/api/v1/themes/available?workspace_id=workspace-1"+query, nil)
		require.Equal(t, http.StatusUnprocessableEntity, response.Code, response.Body.String())
	}
}

func TestThemeHTTPAvailableDetailDoesNotEnumerateStaleOrInaccessibleThemes(t *testing.T) {
	e, _, _ := newThemeTestServer(t)
	createdResponse := themeRequest(t, e, http.MethodPost, "/api/v1/themes", map[string]any{
		"organization_id": "org-1", "name": "Immutable preview", "duplicate_built_in_id": "studio",
	})
	require.Equal(t, http.StatusOK, createdResponse.Code, createdResponse.Body.String())
	var created themes.Theme
	require.NoError(t, json.Unmarshal(createdResponse.Body.Bytes(), &created))
	themeID := created.Summary.Reference.ID
	published := themeRequest(t, e, http.MethodPost, "/api/v1/themes/"+url.PathEscape(themeID)+"/publish", map[string]any{
		"organization_id": "org-1", "expected_draft_revision": 1, "expected_published_revision": 0,
	})
	require.Equal(t, http.StatusOK, published.Code, published.Body.String())
	updated := created.Draft.Manifest
	updated.Description = "Current preview"
	update := themeRequest(t, e, http.MethodPut, "/api/v1/themes/"+url.PathEscape(themeID)+"/draft", map[string]any{
		"organization_id": "org-1", "expected_revision": 1, "name": "Immutable preview", "manifest": updated,
	})
	require.Equal(t, http.StatusOK, update.Code, update.Body.String())
	published = themeRequest(t, e, http.MethodPost, "/api/v1/themes/"+url.PathEscape(themeID)+"/publish", map[string]any{
		"organization_id": "org-1", "expected_draft_revision": 2, "expected_published_revision": 1,
	})
	require.Equal(t, http.StatusOK, published.Code, published.Body.String())

	currentPath := "/api/v1/themes/available/" + url.PathEscape(themeID) + "?workspace_id=workspace-1&revision=2"
	current := themeRequestAs(t, e, "workspace-admin-token", http.MethodGet, currentPath, nil)
	require.Equal(t, http.StatusOK, current.Code, current.Body.String())
	for _, path := range []string{
		"/api/v1/themes/available/" + url.PathEscape(themeID) + "?workspace_id=workspace-1&revision=1",
		"/api/v1/themes/available/missing-theme?workspace_id=workspace-1&revision=2",
		"/api/v1/themes/available/" + url.PathEscape(themeID) + "?workspace_id=workspace-1&revision=3",
	} {
		response := themeRequestAs(t, e, "workspace-admin-token", http.MethodGet, path, nil)
		require.Equal(t, http.StatusNotFound, response.Code, response.Body.String())
	}
	viewer := themeRequestAs(t, e, "viewer-token", http.MethodGet, currentPath, nil)
	missingWorkspace := themeRequestAs(t, e, "workspace-admin-token", http.MethodGet, "/api/v1/themes/available/"+url.PathEscape(themeID)+"?workspace_id=missing-workspace&revision=2", nil)
	require.Equal(t, http.StatusForbidden, viewer.Code, viewer.Body.String())
	require.Equal(t, viewer.Code, missingWorkspace.Code)
	require.JSONEq(t, viewer.Body.String(), missingWorkspace.Body.String())
}

func TestThemeOpenAPIExposesCanonicalManifestAndLifecycleRoutes(t *testing.T) {
	_, _, api := newThemeTestServer(t)
	for _, path := range []string{
		"/themes/available", "/themes/available/{id}", "/themes/{id}/draft", "/themes/{id}/publish",
		"/themes/{id}/revisions", "/themes/{id}/revisions/{revision}",
		"/themes/resolved", "/theme-assets/{id}/content",
	} {
		require.Contains(t, api.OpenAPI().Paths, path)
	}
	encoded, err := json.Marshal(api.OpenAPI())
	require.NoError(t, err)
	contract := string(encoded)
	for _, property := range []string{
		`"schemaVersion"`, `"borderStyle"`, `"navigation"`, `"pageTransition"`,
		`"loadingState"`, `"sourceUrl"`, `"can_manage_workspace"`,
		`"can_manage_organization"`, `"theme_id"`, `"revision"`, `"nativeDerivative"`, `"identity"`,
		`"next_cursor"`,
	} {
		require.Contains(t, contract, property)
	}
	require.NotContains(t, contract, `"object_key"`)
	var document map[string]any
	require.NoError(t, json.Unmarshal(encoded, &document))
	schemas := document["components"].(map[string]any)["schemas"].(map[string]any)
	storedFont := schemas["ThemeFontFace"].(map[string]any)["properties"].(map[string]any)
	require.NotContains(t, storedFont, "nativeDerivative")
	runtimeFont := schemas["ThemeRuntimeFontFace"].(map[string]any)["properties"].(map[string]any)
	require.Contains(t, runtimeFont, "nativeDerivative")
	requireEnumProperty(t, schemas, "ThemeReference", "kind", []any{"built_in", "custom"})
	requireEnumProperty(t, schemas, "ThemeManifest", "schemaVersion", []any{float64(1)})
	requireEnumProperty(t, schemas, "ThemeManifest", "iconPack", []any{"lucide", "heroicons-outline", "heroicons-solid", "phosphor", "tabler"})
	requireArrayEnumProperty(t, schemas, "ThemeManifest", "supportedSchemes", []any{"light", "dark"})
	requireEnumProperty(t, schemas, "ThemeSummary", "icon_pack", []any{"lucide", "heroicons-outline", "heroicons-solid", "phosphor", "tabler"})
	requireArrayEnumProperty(t, schemas, "ThemeSummary", "supported_schemes", []any{"light", "dark"})
	requireEnumProperty(t, schemas, "ThemeAssetRecord", "kind", []any{"font", "background", "texture", "illustration"})
	requireEnumProperty(t, schemas, "ThemeAssetRecord", "media_type", []any{"font/woff2", "image/png", "image/jpeg", "image/webp", "image/avif"})
	requireEnumProperty(t, schemas, "ThemeAssetRecord", "font_style", []any{"normal", "italic"})
	requireEnumProperty(t, schemas, "UploadThemeAssetInputBody", "media_type", []any{"font/woff2", "image/png", "image/jpeg", "image/webp", "image/avif"})
	require.Contains(t, schemas["PublishedRevision"].(map[string]any)["properties"].(map[string]any), "source_revision")
	pageProperties := schemas["ThemeSummaryPage"].(map[string]any)["properties"].(map[string]any)
	require.Contains(t, pageProperties, "items")
	require.Contains(t, pageProperties, "next_cursor")
	require.NotContains(t, pageProperties, "manifest")
	createRequired := schemas["CreateThemeInputBody"].(map[string]any)["required"].([]any)
	require.NotContains(t, createRequired, "manifest")
	publishRequired := schemas["PublishThemeInputBody"].(map[string]any)["required"].([]any)
	require.Contains(t, publishRequired, "expected_draft_revision")
	require.Contains(t, publishRequired, "expected_published_revision")
	rollbackRequired := schemas["RollbackThemeInputBody"].(map[string]any)["required"].([]any)
	require.Contains(t, rollbackRequired, "source_revision")
	require.Contains(t, rollbackRequired, "expected_draft_revision")
	require.Contains(t, rollbackRequired, "expected_published_revision")
}

func requireEnumProperty(t *testing.T, schemas map[string]any, schemaName, propertyName string, expected []any) {
	t.Helper()
	property := schemas[schemaName].(map[string]any)["properties"].(map[string]any)[propertyName].(map[string]any)
	require.Equal(t, expected, property["enum"], schemaName+"."+propertyName)
}

func requireArrayEnumProperty(t *testing.T, schemas map[string]any, schemaName, propertyName string, expected []any) {
	t.Helper()
	property := schemas[schemaName].(map[string]any)["properties"].(map[string]any)[propertyName].(map[string]any)
	require.Equal(t, "array", property["type"], schemaName+"."+propertyName+" must not accept null")
	require.Equal(t, expected, property["items"].(map[string]any)["enum"], schemaName+"."+propertyName)
}

func newThemeTestServer(t *testing.T) (*echo.Echo, *bun.DB, huma.API) {
	t.Helper()
	db := newHandlerSchemaTestDB(t)
	now := time.Date(2026, time.September, 2, 12, 0, 0, 0, time.UTC)
	user := &models.User{ID: "user-1", Email: "themes@example.com", CreatedAt: now}
	organization := &models.Organization{ID: "org-1", Name: "Themes", CreatedByID: user.ID, CreatedAt: now, UpdatedAt: now}
	member := &models.OrganizationMember{OrganizationID: organization.ID, UserID: user.ID, Role: models.OrganizationRoleAdmin, CreatedAt: now}
	workspace := &models.Workspace{ID: "workspace-1", OrganizationID: organization.ID, Name: "Main", CreatedAt: now}
	workspaceMember := &models.WorkspaceMember{WorkspaceID: workspace.ID, UserID: user.ID, Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive, CreatedAt: now, UpdatedAt: now}
	viewer := &models.User{ID: "viewer-1", Email: "viewer@example.com", CreatedAt: now}
	viewerOrganizationMember := &models.OrganizationMember{OrganizationID: organization.ID, UserID: viewer.ID, Role: models.OrganizationRoleMember, CreatedAt: now}
	viewerWorkspaceMember := &models.WorkspaceMember{WorkspaceID: workspace.ID, UserID: viewer.ID, Role: models.WorkspaceRoleViewer, Status: models.WorkspaceMemberStatusActive, CreatedAt: now, UpdatedAt: now}
	workspaceAdmin := &models.User{ID: "workspace-admin", Email: "workspace-admin@example.com", CreatedAt: now}
	workspaceAdminMember := &models.WorkspaceMember{WorkspaceID: workspace.ID, UserID: workspaceAdmin.ID, Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive, CreatedAt: now, UpdatedAt: now}
	for _, item := range []any{user, viewer, workspaceAdmin, organization, member, viewerOrganizationMember, workspace, workspaceMember, viewerWorkspaceMember, workspaceAdminMember} {
		_, err := db.NewInsert().Model(item).Exec(t.Context())
		require.NoError(t, err)
	}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	storage := mediastore.NewLocalStorage(t.TempDir(), "/theme-assets")
	NewThemeHandler(db, themeTestAuthenticator{}, storage).RegisterRoutes(api)
	return e, db, api
}

func uploadThemeAsset(t *testing.T, e *echo.Echo, body map[string]any) themes.ThemeAssetRecord {
	t.Helper()
	response := themeRequest(t, e, http.MethodPost, "/api/v1/theme-assets", body)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var asset themes.ThemeAssetRecord
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &asset))
	return asset
}

func themeRequest(t *testing.T, e *echo.Echo, method, path string, body any) *httptest.ResponseRecorder {
	return themeRequestAs(t, e, "web-token", method, path, body)
}

func themeRequestAs(t *testing.T, e *echo.Echo, token, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	request := httptest.NewRequestWithContext(t.Context(), method, path, &payload)
	request.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)
	return response
}

type themeTestAuthenticator struct{}

func (themeTestAuthenticator) AuthenticateBearer(_ context.Context, token string) (*middleware.Principal, error) {
	switch token {
	case "web-token":
		return &middleware.Principal{UserID: "user-1", Email: "themes@example.com"}, nil
	case "viewer-token":
		return &middleware.Principal{UserID: "viewer-1", Email: "viewer@example.com"}, nil
	case "workspace-admin-token":
		return &middleware.Principal{UserID: "workspace-admin", Email: "workspace-admin@example.com"}, nil
	default:
		return nil, apitokens.ErrInvalidToken
	}
}

func handlerRealWOFF2(t *testing.T) []byte {
	t.Helper()
	content, err := os.ReadFile("../../services/themes/testdata/roboto-latin-400-normal.woff2")
	require.NoError(t, err)
	return content
}

func handlerPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	canvas.Set(0, 0, color.RGBA{R: 242, G: 112, B: 42, A: 255})
	var encoded bytes.Buffer
	require.NoError(t, png.Encode(&encoded, canvas))
	return encoded.Bytes()
}
