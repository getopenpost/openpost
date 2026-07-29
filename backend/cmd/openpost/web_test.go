package main

import (
	"context"
	"net/http"
	"net/http/httptest"
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
