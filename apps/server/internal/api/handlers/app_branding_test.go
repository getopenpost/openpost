package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/services/appbranding"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/workspacedeletion"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func newBrandingTestServer(t *testing.T) *echo.Echo {
	t.Helper()
	e, db, api := newThemeTestServer(t)
	NewAppBrandingHandler(db, themeTestAuthenticator{}, mediastore.NewLocalStorage(t.TempDir(), "/unused")).RegisterRoutes(api)
	return e
}

func brandingResponse(t *testing.T, e *echo.Echo, token, method, path string, body any) appbranding.Settings {
	t.Helper()
	response := themeRequestAs(t, e, token, method, path, body)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var settings appbranding.Settings
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &settings))
	return settings
}

func TestAppBrandingHTTPInheritancePermissionsAndRevisionConflict(t *testing.T) {
	t.Parallel()
	e := newBrandingTestServer(t)
	root := "/api/v1/app-branding/workspace-1"
	initial := brandingResponse(t, e, "viewer-token", http.MethodGet, root, nil)
	require.Equal(t, "OpenPost", initial.Effective.DisplayName)
	require.False(t, initial.CanManageWorkspace)
	require.False(t, initial.AllowWorkspaceOverride)
	body := map[string]any{"expected_revision": 0, "profile": map[string]any{"display_name": "Studio Social"}, "allow_workspace_override": true}
	denied := themeRequestAs(t, e, "workspace-admin-token", http.MethodPut, root+"/organization", body)
	require.Equal(t, http.StatusForbidden, denied.Code)
	saved := brandingResponse(t, e, "web-token", http.MethodPut, root+"/organization", body)
	require.Equal(t, "Studio Social", saved.Effective.DisplayName)
	require.Equal(t, 1, saved.OrganizationRevision)
	stale := themeRequest(t, e, http.MethodPut, root+"/organization", body)
	require.Equal(t, http.StatusConflict, stale.Code)
	override := brandingResponse(t, e, "workspace-admin-token", http.MethodPut, root+"/workspace", map[string]any{"expected_revision": 0, "profile": map[string]any{"display_name": "Client Social"}})
	require.Equal(t, "Client Social", override.Effective.DisplayName)
	member := brandingResponse(t, e, "viewer-token", http.MethodGet, root, nil)
	require.Equal(t, "Client Social", member.Effective.DisplayName)
	denied = themeRequestAs(t, e, "viewer-token", http.MethodPut, root+"/workspace", map[string]any{"expected_revision": 1})
	require.Equal(t, http.StatusForbidden, denied.Code)
	restored := brandingResponse(t, e, "workspace-admin-token", http.MethodPut, root+"/workspace", map[string]any{"expected_revision": 1})
	require.Equal(t, "Studio Social", restored.Effective.DisplayName)
	require.Nil(t, restored.WorkspaceOverride)
	brandingResponse(t, e, "workspace-admin-token", http.MethodPut, root+"/workspace", map[string]any{"expected_revision": restored.WorkspaceRevision, "profile": map[string]any{"display_name": "Client Again"}})
	locked := brandingResponse(t, e, "web-token", http.MethodPut, root+"/organization", map[string]any{"expected_revision": 1, "profile": map[string]any{"display_name": "Organization Only"}, "allow_workspace_override": false})
	require.Equal(t, "Organization Only", locked.Effective.DisplayName)
	require.Nil(t, locked.WorkspaceOverride)
	denied = themeRequestAs(t, e, "workspace-admin-token", http.MethodPut, root+"/workspace", map[string]any{"expected_revision": 0, "profile": map[string]any{"display_name": "Blocked"}})
	require.Equal(t, http.StatusConflict, denied.Code)
	reset := brandingResponse(t, e, "web-token", http.MethodPut, root+"/organization", map[string]any{"expected_revision": 2, "allow_workspace_override": true})
	require.Equal(t, "OpenPost", reset.Effective.DisplayName)
	require.Nil(t, reset.WorkspaceOverride, "locking clears overrides rather than resurrecting them later")
	denied = themeRequest(t, e, http.MethodGet, "/api/v1/app-branding/other-workspace", nil)
	require.Equal(t, http.StatusForbidden, denied.Code)
}

func TestAppBrandingHTTPImagesAreScopedCopiedAndValidated(t *testing.T) {
	t.Parallel()
	e := newBrandingTestServer(t)
	root := "/api/v1/app-branding/workspace-1"
	image := map[string]any{"content_base64": base64.StdEncoding.EncodeToString(handlerPNG(t, 32, 32))}
	org := brandingResponse(t, e, "web-token", http.MethodPut, root+"/organization", map[string]any{"expected_revision": 0, "allow_workspace_override": true, "profile": map[string]any{"display_name": "Studio", "logo": image}})
	require.NotNil(t, org.Effective.Logo)
	response := themeRequestAs(t, e, "viewer-token", http.MethodGet, org.Effective.Logo.URL, nil)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Equal(t, "image/png", response.Header().Get("Content-Type"))
	require.Equal(t, "private, no-store", response.Header().Get("Cache-Control"))
	denied := themeRequestAs(t, e, "viewer-token", http.MethodGet, org.OrganizationDefault.Logo.URL, nil)
	require.Equal(t, http.StatusForbidden, denied.Code)
	workspace := brandingResponse(t, e, "workspace-admin-token", http.MethodPut, root+"/workspace", map[string]any{"expected_revision": 0, "profile": map[string]any{"display_name": "Client", "logo": map[string]any{"id": org.Effective.Logo.ID}}})
	require.NotEqual(t, org.Effective.Logo.ID, workspace.Effective.Logo.ID, "customizing copies an organization image so later changes cannot break the override")
	brandingResponse(t, e, "web-token", http.MethodPut, root+"/organization", map[string]any{"expected_revision": 1, "allow_workspace_override": true, "profile": map[string]any{"display_name": "New Studio"}})
	response = themeRequestAs(t, e, "viewer-token", http.MethodGet, workspace.Effective.Logo.URL, nil)
	require.Equal(t, http.StatusOK, response.Code)
	denied = themeRequestAs(t, e, "viewer-token", http.MethodGet, org.Effective.Logo.URL, nil)
	require.Equal(t, http.StatusForbidden, denied.Code, "previously effective images are no longer readable")
	for _, profile := range []map[string]any{
		{"display_name": "Invalid", "logo": map[string]any{"content_base64": base64.StdEncoding.EncodeToString([]byte("<svg onload='alert(1)'/>"))}},
		{"display_name": "Invalid", "logo": map[string]any{"content_base64": base64.StdEncoding.EncodeToString(handlerPNG(t, 64, 32))}},
		{"display_name": "Invalid", "dark_logo": image},
		{"display_name": "Bad\nName"},
	} {
		invalid := themeRequest(t, e, http.MethodPut, root+"/organization", map[string]any{"expected_revision": 2, "profile": profile})
		require.Equal(t, http.StatusBadRequest, invalid.Code, invalid.Body.String())
	}
	invalid := themeRequest(t, e, http.MethodPut, root+"/organization", map[string]any{"expected_revision": 2, "profile": map[string]any{"display_name": "Invalid", "logo": map[string]any{"id": workspace.Effective.Logo.ID}}})
	require.Equal(t, http.StatusForbidden, invalid.Code, "organization branding cannot adopt workspace-private images")
}

func TestAppBrandingHTTPResetFencesStaleEditorsAndQueuesImageCleanup(t *testing.T) {
	t.Parallel()
	e, db, api := newThemeTestServer(t)
	NewAppBrandingHandler(db, themeTestAuthenticator{}, mediastore.NewLocalStorage(t.TempDir(), "/unused")).RegisterRoutes(api)
	root := "/api/v1/app-branding/workspace-1"
	brandingResponse(t, e, "web-token", http.MethodPut, root+"/organization", map[string]any{"expected_revision": 0, "allow_workspace_override": true})
	old := brandingResponse(t, e, "workspace-admin-token", http.MethodPut, root+"/workspace", map[string]any{"expected_revision": 0, "profile": map[string]any{"display_name": "Client", "logo": map[string]any{"content_base64": base64.StdEncoding.EncodeToString(handlerPNG(t, 16, 16))}}})
	restored := brandingResponse(t, e, "workspace-admin-token", http.MethodPut, root+"/workspace", map[string]any{"expected_revision": old.WorkspaceRevision})
	require.Greater(t, restored.WorkspaceRevision, old.WorkspaceRevision)
	stale := themeRequestAs(t, e, "workspace-admin-token", http.MethodPut, root+"/workspace", map[string]any{"expected_revision": 0, "profile": map[string]any{"display_name": "Stale"}})
	require.Equal(t, http.StatusConflict, stale.Code, "reset must retain a revision fence even when inheriting")
	var payloads []string
	require.NoError(t, db.NewSelect().Table("jobs").Column("payload").Scan(t.Context(), &payloads))
	require.Contains(t, strings.Join(payloads, "\n"), "app-branding/org-1/"+old.Effective.Logo.ID+".png", "reset queues cleanup of its exact committed image")
}

func TestAppBrandingDeletionCollectsImagesAfterPreflight(t *testing.T) {
	t.Parallel()
	e, db, api := newThemeTestServer(t)
	NewAppBrandingHandler(db, themeTestAuthenticator{}, mediastore.NewLocalStorage(t.TempDir(), "/unused")).RegisterRoutes(api)
	root := "/api/v1/app-branding/workspace-1"
	brandingResponse(t, e, "web-token", http.MethodPut, root+"/organization", map[string]any{"expected_revision": 0, "allow_workspace_override": true})
	profile := map[string]any{"display_name": "Client", "logo": map[string]any{"content_base64": base64.StdEncoding.EncodeToString(handlerPNG(t, 16, 16))}}
	brandingResponse(t, e, "workspace-admin-token", http.MethodPut, root+"/workspace", map[string]any{"expected_revision": 0, "profile": profile})
	preflight, err := workspacedeletion.StoredObjectKeys(t.Context(), db, []string{"workspace-1"})
	require.NoError(t, err)
	current := brandingResponse(t, e, "workspace-admin-token", http.MethodPut, root+"/workspace", map[string]any{"expected_revision": 1, "profile": profile})
	require.NoError(t, db.RunInTx(t.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := workspacedeletion.EnqueueStorageCleanup(ctx, tx, preflight); err != nil {
			return err
		}
		return workspacedeletion.DeleteWorkspaceData(ctx, tx, []string{"workspace-1"})
	}))
	var payloads []string
	require.NoError(t, db.NewSelect().Table("jobs").Column("payload").Scan(t.Context(), &payloads))
	require.Contains(t, strings.Join(payloads, "\n"), "app-branding/org-1/"+current.Effective.Logo.ID+".png", "deletion must enqueue the image committed after its preflight snapshot")
}
