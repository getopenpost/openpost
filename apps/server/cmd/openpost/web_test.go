package main

import (
	"context"

	"encoding/json"

	"io/fs"
	"net/http"
	"net/http/httptest"

	"strconv"
	"testing"
	"testing/fstest"

	"github.com/labstack/echo/v4"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func registerSpaRoutes(e *echo.Echo, webFS fs.FS) {
	registerSpaRoutesWithProfileMetadata(e, webFS, nil, "", false, true)
}

func registerSpaRoutesWithProfileMetadata(
	e *echo.Echo,
	webFS fs.FS,
	db *bun.DB,
	publicURL string,
	managedEdition bool,
	publicProfilesEnabled bool,
) {
	routes, _ := loadSpaRouteManifest(webFS)
	registerSpaRoutesWithProfileMetadataAndMatcher(e, webFS, db, publicURL, managedEdition, publicProfilesEnabled, routes)
}

func withAppRoutes(webFS fstest.MapFS, routes ...string) fstest.MapFS {
	type routeManifest struct {
		SchemaVersion int      `json:"schema_version"`
		Routes        []string `json:"routes"`
	}
	data, err := json.Marshal(routeManifest{SchemaVersion: 1, Routes: routes})
	if err != nil {
		panic(err)
	}
	webFS[spaRouteManifestPath] = &fstest.MapFile{Data: data}
	return webFS
}

func TestPWAControlFilesRevalidate(t *testing.T) {
	for _, asset := range []string{"sw.js", "pwa-cache-cleanup.js", "manifest.webmanifest"} {
		t.Run(asset, func(t *testing.T) {
			webFS := fstest.MapFS{asset: {Data: []byte("control file")}}
			e := echo.New()
			registerSpaRoutes(e, webFS)
			response := httptest.NewRecorder()
			e.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/"+asset, nil))
			require.Equal(t, http.StatusOK, response.Code)
			require.Equal(t, "no-cache", response.Header().Get("Cache-Control"))
		})
	}
}

func TestSpaFallbackRouting(t *testing.T) {
	webFS := withAppRoutes(fstest.MapFS{
		"index.html": {Data: []byte("<html>app</html>")},
	}, "/", "/calendar", "/publications/[id]", "/video-editor/[...path]")
	e := echo.New()
	registerSpaRoutes(e, webFS)

	tests := []struct {
		name   string
		path   string
		status int
	}{
		{name: "known static route without emitted page", path: "/calendar", status: http.StatusOK},
		{name: "known dynamic route", path: "/publications/pub_123", status: http.StatusOK},
		{name: "known nested rest route", path: "/video-editor/projects/example", status: http.StatusOK},
		{name: "unknown route", path: "/this-route-does-not-exist", status: http.StatusNotFound},
		{name: "static-prefix lookalike", path: "/calendar-export", status: http.StatusNotFound},
		{name: "dynamic route missing parameter", path: "/publications", status: http.StatusNotFound},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, test.path, nil)
			e.ServeHTTP(recorder, request)

			require.Equal(t, test.status, recorder.Code)
			require.Equal(t, "<html>app</html>", recorder.Body.String())
			require.Equal(t, "text/html", recorder.Header().Get("Content-Type"))
			require.Equal(t, "no-cache, no-store, must-revalidate", recorder.Header().Get("Cache-Control"))
		})
	}

	unknownGET := httptest.NewRecorder()
	e.ServeHTTP(unknownGET, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/missing", nil))
	unknownHEAD := httptest.NewRecorder()
	e.ServeHTTP(unknownHEAD, httptest.NewRequestWithContext(context.Background(), http.MethodHead, "/missing", nil))
	require.Equal(t, http.StatusNotFound, unknownGET.Code)
	require.Equal(t, unknownGET.Code, unknownHEAD.Code)
	for _, header := range []string{"Content-Type", "Content-Length", "Cache-Control", "Pragma", "Expires"} {
		require.Equal(t, unknownGET.Header().Get(header), unknownHEAD.Header().Get(header), header)
	}
	require.Equal(t, strconv.Itoa(unknownGET.Body.Len()), unknownHEAD.Header().Get("Content-Length"))
	require.Empty(t, unknownHEAD.Body.String())

	apiHEAD := httptest.NewRecorder()
	e.ServeHTTP(apiHEAD, httptest.NewRequestWithContext(context.Background(), http.MethodHead, "/api/missing", nil))
	require.Equal(t, http.StatusNotFound, apiHEAD.Code, "API paths stay isolated from the SPA fallback")
	require.Empty(t, apiHEAD.Body.String())
}

func TestPublicProfileHTML(t *testing.T) {
	t.Parallel()

	rendered := renderPublicProfileHTML(
		[]byte("<html><head></head><body>app</body></html>"),
		&publicProfilePageMetadata{
			Username:    "rodrgds",
			DisplayName: "R&D <team>",
			AvatarURL:   "https://cdn.example/avatar?a=1&b=2",
		},
		"https://app.openpo.st/",
	)

	html := string(rendered)
	require.Contains(t, html, "R&amp;D &lt;team&gt; (@rodrgds) - OpenPost")
	require.Contains(t, html, `property="og:type" content="profile"`)
	require.Contains(t, html, `rel="canonical" href="https://app.openpo.st/u/rodrgds"`)
	require.Contains(t, html, `property="og:image" content="https://cdn.example/avatar?a=1&amp;b=2"`)

	unavailable := renderPublicProfileHTML([]byte("<html><head></head><body>app</body></html>"), nil, "")
	require.Contains(t, string(unavailable), `name="robots" content="noindex"`)
}
