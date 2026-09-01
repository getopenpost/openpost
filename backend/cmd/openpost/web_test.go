package main

import (
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"testing/fstest"
	"time"

	"github.com/andybalholm/brotli"
	"github.com/labstack/echo/v4"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

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

func TestSpaHTMLIsNoindexAndCompressesNegotiatedResponses(t *testing.T) {
	const document = `<html><head></head><body>application document with enough repeated content to compress application document</body></html>`
	webFS := fstest.MapFS{
		"index.html": {Data: []byte(document)},
		"login.html": {Data: []byte(document)},
	}
	e := echo.New()
	registerSpaRoutes(e, webFS)

	for _, test := range []struct {
		name            string
		acceptEncoding  string
		contentEncoding string
		newReader       func(io.Reader) (io.Reader, error)
	}{
		{
			name:            "gzip",
			acceptEncoding:  "gzip",
			contentEncoding: "gzip",
			newReader: func(reader io.Reader) (io.Reader, error) {
				return gzip.NewReader(reader)
			},
		},
		{
			name:            "brotli",
			acceptEncoding:  "br",
			contentEncoding: "br",
			newReader: func(reader io.Reader) (io.Reader, error) {
				return brotli.NewReader(reader), nil
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/login", nil)
			req.Header.Set("Accept-Encoding", test.acceptEncoding)
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)

			require.Equal(t, http.StatusOK, rec.Code)
			require.Equal(t, "noindex, nofollow", rec.Header().Get("X-Robots-Tag"))
			require.Equal(t, test.contentEncoding, rec.Header().Get("Content-Encoding"))
			require.Equal(t, "Accept-Encoding", rec.Header().Get("Vary"))
			reader, err := test.newReader(rec.Body)
			require.NoError(t, err)
			decoded, err := io.ReadAll(reader)
			require.NoError(t, err)
			require.Equal(t, document, string(decoded))
		})
	}
}

func TestSpaCompressedHeadMatchesGetHeadersWithoutBody(t *testing.T) {
	webFS := fstest.MapFS{"index.html": {Data: []byte(`<html><head></head><body>application document application document application document</body></html>`)}}
	e := echo.New()
	registerSpaRoutes(e, webFS)

	request := func(method string) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(t.Context(), method, "/", nil)
		req.Header.Set("Accept-Encoding", "br, gzip;q=0.5")
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		return rec
	}
	getRec := request(http.MethodGet)
	headRec := request(http.MethodHead)

	require.Equal(t, getRec.Code, headRec.Code)
	for _, header := range []string{"Content-Type", "Content-Encoding", "Content-Length", "Cache-Control", "X-Robots-Tag", "Vary"} {
		require.Equal(t, getRec.Header().Get(header), headRec.Header().Get(header), header)
	}
	require.Equal(t, strconv.Itoa(getRec.Body.Len()), headRec.Header().Get("Content-Length"))
	require.Empty(t, headRec.Body.String())
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

func TestSpaFallbackDistinguishesKnownDynamicRoutesFromUnknownDocuments(t *testing.T) {
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
}

func TestSpaUnknownHeadMatchesGetStatusAndHeadersWithoutBody(t *testing.T) {
	webFS := withAppRoutes(fstest.MapFS{
		"index.html": {Data: []byte("<html>app</html>")},
	}, "/")
	e := echo.New()
	registerSpaRoutes(e, webFS)

	getRecorder := httptest.NewRecorder()
	e.ServeHTTP(getRecorder, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/missing", nil))
	headRecorder := httptest.NewRecorder()
	e.ServeHTTP(headRecorder, httptest.NewRequestWithContext(context.Background(), http.MethodHead, "/missing", nil))

	require.Equal(t, http.StatusNotFound, getRecorder.Code)
	require.Equal(t, getRecorder.Code, headRecorder.Code)
	for _, header := range []string{"Content-Type", "Content-Length", "Cache-Control", "Pragma", "Expires"} {
		require.Equal(t, getRecorder.Header().Get(header), headRecorder.Header().Get(header), header)
	}
	require.Equal(t, strconv.Itoa(getRecorder.Body.Len()), headRecorder.Header().Get("Content-Length"))
	require.Empty(t, headRecorder.Body.String())
}

func TestSpaStartupRejectsMissingOrMalformedRouteManifest(t *testing.T) {
	for _, test := range []struct {
		name  string
		files fstest.MapFS
	}{
		{
			name: "missing",
			files: fstest.MapFS{
				"index.html": {Data: []byte("<html>app</html>")},
			},
		},
		{
			name: "unknown field",
			files: fstest.MapFS{
				"index.html":         {Data: []byte("<html>app</html>")},
				spaRouteManifestPath: {Data: []byte(`{"schema_version":1,"routes":["/"],"extra":true}`)},
			},
		},
		{
			name: "unsorted",
			files: withAppRoutes(fstest.MapFS{
				"index.html": {Data: []byte("<html>app</html>")},
			}, "/settings", "/"),
		},
		{
			name: "empty parameter",
			files: withAppRoutes(fstest.MapFS{
				"index.html": {Data: []byte("<html>app</html>")},
			}, "/publications/[]"),
		},
		{
			name: "non-final rest parameter",
			files: withAppRoutes(fstest.MapFS{
				"index.html": {Data: []byte("<html>app</html>")},
			}, "/files/[...path]/details"),
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			var recovered any
			func() {
				defer func() {
					recovered = recover()
				}()
				registerSpaRoutesFromFS(echo.New(), test.files, nil, "", false, true)
			}()
			require.NotNil(t, recovered)
			require.Contains(t, fmt.Sprint(recovered), "route manifest is missing or invalid")
		})
	}
}

func TestManagedSpaRootUsesTheApplicationForTheRoot(t *testing.T) {
	webFS := fstest.MapFS{"index.html": {Data: []byte(`<html><head></head><body>app</body></html>`)}}
	e := echo.New()
	registerSpaRoutesWithProfileMetadata(e, webFS, nil, "https://app.openpo.st", true, true)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), "app")
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
		"https://app.openpo.st",
		true,
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
}

func TestManagedSpaRootProvidesProductReviewFallback(t *testing.T) {
	webFS := fstest.MapFS{
		"index.html": {Data: []byte(`<html><head></head><body><div id="app">app</div></body></html>`)},
	}
	e := echo.New()
	registerSpaRoutesWithProfileMetadata(e, webFS, nil, "https://app.openpo.st", true, true)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	html := rec.Body.String()
	require.Contains(t, html, `name="openpost-edition" content="cloud"`)
	require.Contains(t, html, "Your content operation, together in one workspace.")
	require.Contains(t, html, "Starter: $15/month")
	require.Contains(t, html, "Agency: $199/month")
	require.Contains(t, html, "Every plan starts with a 14-day free trial")
	require.Contains(t, html, `href="/register?plan=founder&amp;billing_period=monthly"`)
	require.Contains(t, html, `href="https://openpo.st/pricing"`)
	require.Contains(t, html, `href="https://openpo.st/terms"`)
	require.Contains(t, html, `href="https://openpo.st/privacy"`)
	require.Contains(t, html, `href="https://openpo.st/refunds"`)
}

func TestManagedSpaRootReviewPricingMatchesCatalog(t *testing.T) {
	t.Parallel()

	data, err := os.ReadFile("../../../packages/plan-catalog/src/catalog.json")
	require.NoError(t, err)
	var catalog struct {
		Plans []struct {
			Name            string `json:"name"`
			MonthlyPriceUSD int    `json:"monthly_price_usd"`
		} `json:"plans"`
	}
	require.NoError(t, json.Unmarshal(data, &catalog))
	require.NotEmpty(t, catalog.Plans)
	for _, plan := range catalog.Plans {
		require.Contains(
			t,
			managedEditionReviewFallback,
			fmt.Sprintf("<li>%s: $%d/month</li>", plan.Name, plan.MonthlyPriceUSD),
		)
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
		"https://app.openpo.st/",
	)

	html := string(rendered)
	require.Contains(t, html, "R&amp;D &lt;team&gt; (@rodrgds) - OpenPost")
	require.Contains(t, html, `property="og:type" content="profile"`)
	require.Contains(t, html, `rel="canonical" href="https://app.openpo.st/u/rodrgds"`)
	require.Contains(t, html, `property="og:image" content="https://cdn.example/avatar?a=1&amp;b=2"`)
}

func TestRenderUnavailablePublicProfileHTMLIsNotIndexed(t *testing.T) {
	t.Parallel()

	rendered := renderPublicProfileHTML([]byte("<html><head></head><body>app</body></html>"), nil, "")
	require.Contains(t, string(rendered), `name="robots" content="noindex"`)
}

func TestDirectPublicProfileRoutesUseSafeDistinctStatusClasses(t *testing.T) {
	webFS := fstest.MapFS{
		"index.html": {Data: []byte("<html><head></head><body>app</body></html>")},
	}

	t.Run("disabled", func(t *testing.T) {
		e := echo.New()
		registerSpaRoutesWithProfileMetadata(e, webFS, nil, "", false, false)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/u/person", nil))
		require.Equal(t, http.StatusNotFound, rec.Code)
		require.Contains(t, rec.Body.String(), `name="robots" content="noindex"`)
		require.Equal(t, "noindex, nofollow", rec.Header().Get("X-Robots-Tag"))
	})

	t.Run("private or missing", func(t *testing.T) {
		e := echo.New()
		registerSpaRoutesWithProfileMetadata(e, webFS, nil, "", false, true)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/u/person", nil))
		require.Equal(t, http.StatusNotFound, rec.Code)
		require.Equal(t, "noindex, nofollow", rec.Header().Get("X-Robots-Tag"))
	})

	t.Run("backend failure", func(t *testing.T) {
		sqldb, err := sql.Open("sqlite3", "file:public-profile-failure?mode=memory&cache=private")
		require.NoError(t, err)
		db := bun.NewDB(sqldb, sqlitedialect.New())
		t.Cleanup(func() { require.NoError(t, db.Close()) })
		e := echo.New()
		registerSpaRoutesWithProfileMetadata(e, webFS, db, "", false, true)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/u/person", nil))
		require.Equal(t, http.StatusServiceUnavailable, rec.Code)
		require.Equal(t, "noindex, nofollow", rec.Header().Get("X-Robots-Tag"))
	})

	t.Run("public", func(t *testing.T) {
		sqldb, err := sql.Open("sqlite3", "file:public-profile-success?mode=memory&cache=private")
		require.NoError(t, err)
		db := bun.NewDB(sqldb, sqlitedialect.New())
		t.Cleanup(func() { require.NoError(t, db.Close()) })
		_, err = db.NewCreateTable().Model((*models.User)(nil)).Exec(t.Context())
		require.NoError(t, err)
		_, err = db.NewInsert().Model(&models.User{
			ID: "user-1", Email: "person@example.test", Username: "person", PublicProfile: true,
		}).Exec(t.Context())
		require.NoError(t, err)
		e := echo.New()
		registerSpaRoutesWithProfileMetadata(e, webFS, db, "https://openpost.example", false, true)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/u/person", nil))
		require.Equal(t, http.StatusOK, rec.Code)
		require.Contains(t, rec.Body.String(), `name="robots" content="index, follow"`)
		require.Empty(t, rec.Header().Get("X-Robots-Tag"))
	})
}
