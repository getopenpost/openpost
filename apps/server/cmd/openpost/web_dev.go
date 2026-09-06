//go:build dev

package main

import (
	"os"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/uptrace/bun"
)

func RegisterSpaRoutes(e *echo.Echo, db *bun.DB, publicURL string, managedEdition, publicProfilesEnabled bool) {
	webPath := strings.TrimSpace(os.Getenv("OPENPOST_WEB_PATH"))
	if webPath == "" {
		webPath = "cmd/openpost/public"
	}
	registerSpaRoutesFromFS(e, os.DirFS(webPath), db, publicURL, managedEdition, publicProfilesEnabled)
}
