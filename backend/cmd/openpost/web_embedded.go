//go:build !dev

package main

import (
	"embed"
	"io/fs"

	"github.com/labstack/echo/v4"
	"github.com/uptrace/bun"
)

//go:embed all:public
var embeddedWeb embed.FS

func RegisterSpaRoutes(e *echo.Echo, db *bun.DB, publicURL string, managedEdition, publicProfilesEnabled bool) {
	webFS, err := fs.Sub(embeddedWeb, "public")
	if err != nil {
		panic(err)
	}
	registerSpaRoutesFromFS(e, webFS, db, publicURL, managedEdition, publicProfilesEnabled)
}
