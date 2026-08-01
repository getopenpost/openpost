package main

import (
	"embed"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
)

//go:embed all:public
var embeddedWeb embed.FS

func RegisterSpaRoutes(e *echo.Echo) {
	webFS, err := fs.Sub(embeddedWeb, "public")
	if err != nil {
		panic(err)
	}
	// Keep package tests independent of generated frontend output while still
	// failing immediately when the application starts with an empty embed.
	data, err := fs.ReadFile(webFS, "index.html")
	if err != nil || len(data) == 0 {
		panic("openpost: embedded frontend is missing or empty (backend/cmd/openpost/public/index.html). " +
			"Run the frontend build first: `cd frontend && pnpm build` (or use `devenv shell -- build`).")
	}
	registerSpaRoutes(e, webFS)
}

func registerSpaRoutes(e *echo.Echo, webFS fs.FS) {
	writeHTML := func(c echo.Context, data []byte) error {
		c.Response().Header().Set("Content-Type", "text/html")
		c.Response().Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		c.Response().Header().Set("Pragma", "no-cache")
		c.Response().Header().Set("Expires", "0")
		_, err := c.Response().Write(data)
		return err
	}

	e.GET("/*", func(c echo.Context) error {
		reqPath := c.Request().URL.Path
		if reqPath == "" {
			reqPath = "/"
		}

		if strings.HasPrefix(reqPath, "/api") {
			return echo.NewHTTPError(http.StatusNotFound, "API not found")
		}

		relPath := strings.TrimPrefix(path.Clean(reqPath), "/")
		if relPath == "." {
			relPath = ""
		}

		if relPath == "" {
			indexData, _ := fs.ReadFile(webFS, "index.html")
			return writeHTML(c, indexData)
		}
		if path.Ext(relPath) == ".html" {
			data, readErr := fs.ReadFile(webFS, relPath)
			if readErr == nil {
				return writeHTML(c, data)
			}
		}

		htmlFile := relPath + ".html"
		if _, err := fs.Stat(webFS, htmlFile); err == nil {
			data, _ := fs.ReadFile(webFS, htmlFile)
			return writeHTML(c, data)
		}

		info, err := fs.Stat(webFS, relPath)
		if err == nil {
			if info.IsDir() {
				indexPath := relPath + "/index.html"
				if _, statErr := fs.Stat(webFS, indexPath); statErr == nil {
					indexData, _ := fs.ReadFile(webFS, indexPath)
					return writeHTML(c, indexData)
				}

				indexData, _ := fs.ReadFile(webFS, "index.html")
				return writeHTML(c, indexData)
			}

			return serveStaticAsset(c, webFS, relPath, info)
		}

		if os.IsNotExist(err) {
			indexData, _ := fs.ReadFile(webFS, "index.html")
			return writeHTML(c, indexData)
		}

		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	})
}

func serveStaticAsset(c echo.Context, webFS fs.FS, relPath string, originalInfo fs.FileInfo) error {
	assetPath := relPath
	contentEncoding := ""
	if c.Request().Header.Get("Range") == "" {
		assetPath, contentEncoding = precompressedAssetPath(
			webFS,
			relPath,
			c.Request().Header.Get("Accept-Encoding"),
		)
	}

	file, err := http.FS(webFS).Open(assetPath)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound)
	}
	defer file.Close()

	responseHeaders := c.Response().Header()
	addVaryHeader(responseHeaders, "Accept-Encoding")
	if contentType := mime.TypeByExtension(path.Ext(relPath)); contentType != "" {
		responseHeaders.Set("Content-Type", contentType)
	}
	if contentEncoding != "" {
		responseHeaders.Set("Content-Encoding", contentEncoding)
	}
	if isImmutableAsset(relPath) {
		responseHeaders.Set("Cache-Control", "public, max-age=31536000, immutable")
	}

	info := originalInfo
	if assetPath != relPath {
		if compressedInfo, statErr := fs.Stat(webFS, assetPath); statErr == nil {
			info = compressedInfo
		}
	}
	http.ServeContent(
		c.Response().Writer,
		c.Request(),
		path.Base(relPath),
		info.ModTime(),
		file,
	)
	return nil
}

func precompressedAssetPath(webFS fs.FS, relPath, acceptEncoding string) (string, string) {
	bestPath := relPath
	bestEncoding := ""
	bestQuality := 0.0
	for _, candidate := range []struct {
		name     string
		suffix   string
		encoding string
	}{
		{name: "br", suffix: ".br", encoding: "br"},
		{name: "gzip", suffix: ".gz", encoding: "gzip"},
	} {
		quality := contentEncodingQuality(acceptEncoding, candidate.name)
		if quality <= bestQuality {
			continue
		}
		compressedPath := relPath + candidate.suffix
		if _, err := fs.Stat(webFS, compressedPath); err == nil {
			bestPath = compressedPath
			bestEncoding = candidate.encoding
			bestQuality = quality
		}
	}
	return bestPath, bestEncoding
}

func contentEncodingQuality(header, desired string) float64 {
	desiredQuality := -1.0
	wildcardQuality := -1.0
	for _, item := range strings.Split(header, ",") {
		parts := strings.Split(strings.TrimSpace(item), ";")
		name := strings.ToLower(strings.TrimSpace(parts[0]))
		quality := 1.0
		for _, parameter := range parts[1:] {
			key, value, found := strings.Cut(strings.TrimSpace(parameter), "=")
			if !found || !strings.EqualFold(strings.TrimSpace(key), "q") {
				continue
			}
			parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
			if err != nil {
				quality = 0
			} else {
				quality = parsed
			}
		}
		if name == desired {
			desiredQuality = quality
		}
		if name == "*" {
			wildcardQuality = quality
		}
	}
	if desiredQuality >= 0 {
		return desiredQuality
	}
	return wildcardQuality
}

func addVaryHeader(header http.Header, value string) {
	for _, item := range strings.Split(header.Get("Vary"), ",") {
		if strings.EqualFold(strings.TrimSpace(item), value) {
			return
		}
	}
	header.Add("Vary", value)
}

func isImmutableAsset(relPath string) bool {
	if strings.HasPrefix(relPath, "_app/immutable/") {
		return true
	}
	if !strings.HasPrefix(relPath, "studio-models/") {
		return false
	}
	filename := path.Base(relPath)
	if len(filename) != 64 {
		return false
	}
	for _, character := range filename {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}
