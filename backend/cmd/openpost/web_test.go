package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"
)

func TestSpaStaticAssetsPreferPrecompressedImmutableResponses(t *testing.T) {
	modTime := time.Date(2026, time.July, 27, 12, 0, 0, 0, time.UTC)
	webFS := fstest.MapFS{
		"index.html": {
			Data:    []byte("<html>app</html>"),
			ModTime: modTime,
		},
		"_app/immutable/chunks/app.hash.js": {
			Data:    []byte("identity"),
			ModTime: modTime,
		},
		"_app/immutable/chunks/app.hash.js.br": {
			Data:    []byte("brotli"),
			ModTime: modTime,
		},
		"_app/immutable/chunks/app.hash.js.gz": {
			Data:    []byte("gzip"),
			ModTime: modTime,
		},
	}
	e := echo.New()
	registerSpaRoutes(e, webFS)

	req := httptest.NewRequestWithContext(
		context.Background(),
		http.MethodGet,
		"/_app/immutable/chunks/app.hash.js",
		nil,
	)
	req.Header.Set("Accept-Encoding", "gzip, br")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "brotli", rec.Body.String())
	require.Equal(t, "br", rec.Header().Get("Content-Encoding"))
	require.Equal(t, "Accept-Encoding", rec.Header().Get("Vary"))
	require.Equal(t, "public, max-age=31536000, immutable", rec.Header().Get("Cache-Control"))
	require.Contains(t, rec.Header().Get("Content-Type"), "javascript")
}

func TestSpaStaticAssetsRespectEncodingQualityAndRangeRequests(t *testing.T) {
	modTime := time.Date(2026, time.July, 27, 12, 0, 0, 0, time.UTC)
	webFS := fstest.MapFS{
		"index.html": {
			Data:    []byte("<html>app</html>"),
			ModTime: modTime,
		},
		"_app/immutable/chunks/app.hash.js": {
			Data:    []byte("identity"),
			ModTime: modTime,
		},
		"_app/immutable/chunks/app.hash.js.br": {
			Data:    []byte("brotli"),
			ModTime: modTime,
		},
		"_app/immutable/chunks/app.hash.js.gz": {
			Data:    []byte("gzip"),
			ModTime: modTime,
		},
	}
	e := echo.New()
	registerSpaRoutes(e, webFS)

	gzipReq := httptest.NewRequestWithContext(
		context.Background(),
		http.MethodGet,
		"/_app/immutable/chunks/app.hash.js",
		nil,
	)
	gzipReq.Header.Set("Accept-Encoding", "br;q=0.5, gzip")
	gzipRec := httptest.NewRecorder()
	e.ServeHTTP(gzipRec, gzipReq)
	require.Equal(t, http.StatusOK, gzipRec.Code)
	require.Equal(t, "gzip", gzipRec.Body.String())
	require.Equal(t, "gzip", gzipRec.Header().Get("Content-Encoding"))

	rangeReq := httptest.NewRequestWithContext(
		context.Background(),
		http.MethodGet,
		"/_app/immutable/chunks/app.hash.js",
		nil,
	)
	rangeReq.Header.Set("Accept-Encoding", "br")
	rangeReq.Header.Set("Range", "bytes=0-2")
	rangeRec := httptest.NewRecorder()
	e.ServeHTTP(rangeRec, rangeReq)
	require.Equal(t, http.StatusPartialContent, rangeRec.Code)
	require.Equal(t, "ide", rangeRec.Body.String())
	require.Empty(t, rangeRec.Header().Get("Content-Encoding"))
	require.Equal(t, "Accept-Encoding", rangeRec.Header().Get("Vary"))
}

func TestSpaHTMLRemainsUncached(t *testing.T) {
	webFS := fstest.MapFS{
		"index.html": {Data: []byte("<html>app</html>")},
		"login.html": {Data: []byte("<html>login</html>")},
	}
	e := echo.New()
	registerSpaRoutes(e, webFS)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/login", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "no-cache, no-store, must-revalidate", rec.Header().Get("Cache-Control"))
	require.Equal(t, "<html>login</html>", rec.Body.String())
}

func TestSpaRedirectsLegacyStudioRoutesBeforeRenderingTheApp(t *testing.T) {
	webFS := fstest.MapFS{
		"index.html": {Data: []byte("<html>app</html>")},
	}
	e := echo.New()
	registerSpaRoutes(e, webFS)

	req := httptest.NewRequestWithContext(
		context.Background(),
		http.MethodGet,
		"/studio/new?legacy-route=1",
		nil,
	)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusPermanentRedirect, rec.Code)
	require.Equal(t, "/image-editor/new?legacy-route=1", rec.Header().Get("Location"))
}

func TestManagedSpaRootExposesProductPricingAndPoliciesWithoutJavaScript(t *testing.T) {
	webFS := fstest.MapFS{
		"index.html": {Data: []byte(`<html><head></head><body><div id="app">app</div></body></html>`)},
		"login.html": {Data: []byte(`<html><head></head><body>login</body></html>`)},
	}
	e := echo.New()
	registerSpaRoutesWithProfileMetadata(
		e,
		webFS,
		nil,
		"https://app.openpost.social",
		true,
	)

	rootReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	rootRec := httptest.NewRecorder()
	e.ServeHTTP(rootRec, rootReq)

	require.Equal(t, http.StatusOK, rootRec.Code)
	rootHTML := rootRec.Body.String()
	require.Contains(t, rootHTML, `name="openpost-edition" content="cloud"`)
	require.Contains(t, rootHTML, `id="openpost-managed-public-home"`)
	require.Contains(t, rootHTML, "Your content operation, together in one workspace.")
	require.Contains(t, rootHTML, "Starter")
	require.Contains(t, rootHTML, "$15")
	require.Contains(t, rootHTML, "Agency")
	require.Contains(t, rootHTML, "$199")
	require.Contains(t, rootHTML, `href="https://openpost.social/terms"`)
	require.Contains(t, rootHTML, `href="https://openpost.social/privacy"`)
	require.Contains(t, rootHTML, `href="https://openpost.social/refunds"`)
	require.Contains(t, rootHTML, `rel="canonical" href="https://app.openpost.social/"`)

	loginReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/login", nil)
	loginRec := httptest.NewRecorder()
	e.ServeHTTP(loginRec, loginReq)
	require.Equal(t, http.StatusOK, loginRec.Code)
	require.Contains(t, loginRec.Body.String(), `name="openpost-edition" content="cloud"`)
	require.NotContains(t, loginRec.Body.String(), `id="openpost-managed-public-home"`)
}

func TestManagedSpaHeadMatchesGetHeadersWithoutBody(t *testing.T) {
	webFS := fstest.MapFS{
		"index.html": {Data: []byte(`<html><head></head><body><div id="app">app</div></body></html>`)},
	}
	e := echo.New()
	registerSpaRoutesWithProfileMetadata(
		e,
		webFS,
		nil,
		"https://app.openpost.social",
		true,
	)

	getRec := httptest.NewRecorder()
	e.ServeHTTP(getRec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil))
	headRec := httptest.NewRecorder()
	e.ServeHTTP(headRec, httptest.NewRequestWithContext(context.Background(), http.MethodHead, "/", nil))

	require.Equal(t, getRec.Code, headRec.Code)
	for _, header := range []string{"Content-Type", "Content-Length", "Cache-Control", "Pragma", "Expires"} {
		require.Equal(t, getRec.Header().Get(header), headRec.Header().Get(header), header)
	}
	require.Equal(t, strconv.Itoa(getRec.Body.Len()), headRec.Header().Get("Content-Length"))
	require.Empty(t, headRec.Body.String())
}

func TestSpaHeadPreservesRedirectsAPIIsolationAndStaticHeaders(t *testing.T) {
	modTime := time.Date(2026, time.July, 27, 12, 0, 0, 0, time.UTC)
	webFS := fstest.MapFS{
		"index.html":                        {Data: []byte("<html>app</html>")},
		"_app/immutable/chunks/app.hash.js": {Data: []byte("identity"), ModTime: modTime},
	}
	e := echo.New()
	registerSpaRoutes(e, webFS)

	tests := []struct {
		name       string
		path       string
		status     int
		headerName string
		header     string
	}{
		{name: "legacy redirect", path: "/studio/new?legacy-route=1", status: http.StatusPermanentRedirect, headerName: "Location", header: "/image-editor/new?legacy-route=1"},
		{name: "API path", path: "/api/missing", status: http.StatusNotFound},
		{name: "immutable asset", path: "/_app/immutable/chunks/app.hash.js", status: http.StatusOK, headerName: "Cache-Control", header: "public, max-age=31536000, immutable"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequestWithContext(context.Background(), http.MethodHead, test.path, nil)
			e.ServeHTTP(rec, req)

			require.Equal(t, test.status, rec.Code)
			require.Equal(t, test.header, rec.Header().Get(test.headerName))
			require.Empty(t, rec.Body.String())
		})
	}
}

func TestSelfHostedSpaRootDoesNotAdvertiseManagedPlans(t *testing.T) {
	webFS := fstest.MapFS{
		"index.html": {Data: []byte(`<html><head></head><body><div id="app">app</div></body></html>`)},
	}
	e := echo.New()
	registerSpaRoutes(e, webFS)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.NotContains(t, rec.Body.String(), `name="openpost-edition"`)
	require.NotContains(t, rec.Body.String(), `id="openpost-managed-public-home"`)
}

func TestManagedSpaRootPricingMatchesFrontendCatalog(t *testing.T) {
	catalogSource, err := os.ReadFile("../../../frontend/src/lib/billing.ts")
	require.NoError(t, err)

	planPattern := regexp.MustCompile(`(?s)\{\s*id:\s*'[^']+',\s*name:\s*'([^']+)',[^}]*monthlyPriceUSD:\s*(\d+),`)
	plans := planPattern.FindAllStringSubmatch(string(catalogSource), -1)
	require.NotEmpty(t, plans)

	rendered := string(renderManagedPublicHomeHTML(
		[]byte(`<html><head></head><body><div id="app">app</div></body></html>`),
		"https://app.openpost.social",
	))
	require.Equal(t, len(plans), strings.Count(rendered, `class="oph-plan"`))
	for _, plan := range plans {
		name, monthlyPrice := plan[1], plan[2]
		require.Contains(t, rendered, "<h3>"+name+"</h3><p>$"+monthlyPrice+"<span>/month")
	}
}

func TestRenderPublicProfileHTMLAddsEscapedShareMetadata(t *testing.T) {
	t.Parallel()

	rendered := renderPublicProfileHTML(
		[]byte("<html><head></head><body>app</body></html>"),
		&publicProfilePageMetadata{
			Username:    "rodrgds",
			DisplayName: "R&D <team>",
			AvatarURL:   "https://cdn.example/avatar?a=1&b=2",
		},
		"https://app.openpost.social/",
	)

	html := string(rendered)
	require.Contains(t, html, "R&amp;D &lt;team&gt; (@rodrgds) - OpenPost")
	require.Contains(t, html, `property="og:type" content="profile"`)
	require.Contains(t, html, `rel="canonical" href="https://app.openpost.social/u/rodrgds"`)
	require.Contains(t, html, `property="og:image" content="https://cdn.example/avatar?a=1&amp;b=2"`)
}

func TestRenderUnavailablePublicProfileHTMLIsNotIndexed(t *testing.T) {
	t.Parallel()

	rendered := renderPublicProfileHTML([]byte("<html><head></head><body>app</body></html>"), nil, "")
	require.Contains(t, string(rendered), `name="robots" content="noindex"`)
}
