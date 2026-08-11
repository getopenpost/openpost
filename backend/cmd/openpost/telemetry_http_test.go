package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/stretchr/testify/require"
)

func TestTelemetryErrorHandlerCapturesHandledServerErrorsWithoutRawURL(t *testing.T) {
	recorder := &telemetry.MemoryRecorder{}
	e := echo.New()
	installTelemetryErrorHandler(e, recorder)
	e.GET("/things/:id", func(echo.Context) error {
		return errors.New("database unavailable")
	})

	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/things/secret-id?token=secret", nil)
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)

	require.Equal(t, http.StatusInternalServerError, response.Code)
	require.Len(t, recorder.Exceptions, 1)
	require.Equal(t, "/things/:id", recorder.Exceptions[0].Properties["route"])
	require.NotContains(t, recorder.Exceptions[0].Properties, "url")
	require.NotContains(t, recorder.Exceptions[0].Properties, "query")
}

func TestTelemetryPanicBoundaryCapturesOnceWithoutPanicValue(t *testing.T) {
	recorder := &telemetry.MemoryRecorder{}
	e := echo.New()
	e.Use(middleware.RecoverWithConfig(middleware.RecoverConfig{DisablePrintStack: true}))
	e.Use(capturePanics(recorder))
	installTelemetryErrorHandler(e, recorder)
	e.GET("/panic", func(echo.Context) error {
		panic("secret panic value")
	})

	response := httptest.NewRecorder()
	e.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/panic", nil))

	require.Equal(t, http.StatusInternalServerError, response.Code)
	require.Len(t, recorder.Exceptions, 1)
	require.Equal(t, "http_panic", recorder.Exceptions[0].Properties["error_boundary"])
	require.NotContains(t, recorder.Exceptions[0].Description, "secret panic value")
}
