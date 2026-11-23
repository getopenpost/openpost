package handlers

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/services/appbranding"
	"github.com/openpost/backend/internal/services/mediastore"

	"github.com/stretchr/testify/require"
)

func newBrandingTestServer(t *testing.T) *echo.Echo {
	t.Helper()
	e, db, api := newThemeTestServer(t)
	NewAppBrandingHandler(db, themeTestAuthenticator{}, mediastore.NewLocalStorage(t.TempDir(), "/unused")).RegisterRoutes(api)
	return e
}

func brandingResponse(t *testing.T, e *echo.Echo, token, path string, body any) appbranding.Settings {
	t.Helper()
	response := themeRequestAs(t, e, token, http.MethodPut, path, body)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var settings appbranding.Settings
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &settings))
	return settings
}

func TestAppBrandingHTTPImagesAreScopedCopiedAndValidated(t *testing.T) {
	t.Parallel()
	e := newBrandingTestServer(t)
	root := "/api/v1/app-branding/workspace-1"
	image := map[string]any{"content_base64": base64.StdEncoding.EncodeToString(handlerPNG(t, 32, 32))}
	org := brandingResponse(t, e, "web-token", root+"/organization", map[string]any{"expected_revision": 0, "allow_workspace_override": true, "profile": map[string]any{"display_name": "Studio", "logo": image}})
	require.NotNil(t, org.Effective.Logo)
	response := themeRequestAs(t, e, "viewer-token", http.MethodGet, org.Effective.Logo.URL, nil)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Equal(t, "image/png", response.Header().Get("Content-Type"))
	require.Equal(t, "private, no-store", response.Header().Get("Cache-Control"))
	denied := themeRequestAs(t, e, "viewer-token", http.MethodGet, org.OrganizationDefault.Logo.URL, nil)
	require.Equal(t, http.StatusForbidden, denied.Code)
	workspace := brandingResponse(t, e, "workspace-admin-token", root+"/workspace", map[string]any{"expected_revision": 0, "profile": map[string]any{"display_name": "Client", "logo": map[string]any{"id": org.Effective.Logo.ID}}})
	require.NotEqual(t, org.Effective.Logo.ID, workspace.Effective.Logo.ID, "customizing copies an organization image so later changes cannot break the override")
	brandingResponse(t, e, "web-token", root+"/organization", map[string]any{"expected_revision": 1, "allow_workspace_override": true, "profile": map[string]any{"display_name": "New Studio"}})
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
	brandingResponse(t, e, "web-token", root+"/organization", map[string]any{"expected_revision": 0, "allow_workspace_override": true})
	old := brandingResponse(t, e, "workspace-admin-token", root+"/workspace", map[string]any{"expected_revision": 0, "profile": map[string]any{"display_name": "Client", "logo": map[string]any{"content_base64": base64.StdEncoding.EncodeToString(handlerPNG(t, 16, 16))}}})
	restored := brandingResponse(t, e, "workspace-admin-token", root+"/workspace", map[string]any{"expected_revision": old.WorkspaceRevision})
	require.Greater(t, restored.WorkspaceRevision, old.WorkspaceRevision)
	stale := themeRequestAs(t, e, "workspace-admin-token", http.MethodPut, root+"/workspace", map[string]any{"expected_revision": 0, "profile": map[string]any{"display_name": "Stale"}})
	require.Equal(t, http.StatusConflict, stale.Code, "reset must retain a revision fence even when inheriting")
	var payloads []string
	require.NoError(t, db.NewSelect().Table("jobs").Column("payload").Scan(t.Context(), &payloads))
	require.Contains(t, strings.Join(payloads, "\n"), "app-branding/org-1/"+old.Effective.Logo.ID+".png", "reset queues cleanup of its exact committed image")
}
