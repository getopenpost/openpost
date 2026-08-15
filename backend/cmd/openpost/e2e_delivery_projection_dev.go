//go:build dev

package main

import (
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/handlers"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/uptrace/bun"
)

func registerE2EDeliveryProjection(e *echo.Echo, db *bun.DB, authenticator middleware.Authenticator, enabled bool) error {
	if enabled {
		handlers.NewE2EDeliveryProjectionHandler(db, authenticator).RegisterRoutes(e)
	}
	return nil
}
