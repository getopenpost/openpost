//go:build !dev

package main

import (
	"errors"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/uptrace/bun"
)

func registerE2EDeliveryProjection(_ *echo.Echo, _ *bun.DB, _ middleware.Authenticator, enabled bool) error {
	if enabled {
		return errors.New("E2E delivery projection requires a development build")
	}
	return nil
}
