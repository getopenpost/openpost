package main

import (
	"embed"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"

	"github.com/labstack/echo/v4"
)

//go:embed all:public
var embeddedWeb embed.FS

//nolint:gochecknoinits // build-time safety net: a `go build` that skipped the frontend step would otherwise embed an empty `public/` and silently serve blank HTML at runtime. The panic has to fire before the binary's main() runs, which only `init()` can guarantee.
func init() {
	// Guard against a build that skipped the frontend step. The
	// SvelteKit static adapter writes its output (index.html +
	// assets) into this directory before `go build` runs. If a
	// developer clones the repo and runs `go build` without first
	// running the frontend build, the embedded `public/` is empty
	// (just the .gitkeep) and the SPA route would silently serve
	// blank HTML with HTTP 200. Fail loud at startup instead.
	data, err := fs.ReadFile(embeddedWeb, "public/index.html")
	if err != nil || len(data) == 0 {
		panic("openpost: embedded frontend is missing or empty (backend/cmd/openpost/public/index.html). " +
			"Run the frontend build first: `cd frontend && bun run build` (or use `devenv shell build`).")
	}
}

func RegisterSpaRoutes(e *echo.Echo) {
	webFS, err := fs.Sub(embeddedWeb, "public")
	if err != nil {
		panic(err)
	}

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

			hfs := http.FS(webFS)
			file, _ := hfs.Open(relPath)
			defer file.Close()
			http.ServeContent(c.Response().Writer, c.Request(), info.Name(), info.ModTime(), file)
			return nil
		}

		if os.IsNotExist(err) {
			indexData, _ := fs.ReadFile(webFS, "index.html")
			return writeHTML(c, indexData)
		}

		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	})
}
