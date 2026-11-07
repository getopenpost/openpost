package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"
)

func TestGitHubStarsEndpointIsPublicWhenTheCountIsUnavailable(t *testing.T) {
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewGitHubStarsHandler(nil).RegisterRoutes(api)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/github-stars", nil)
	resp := httptest.NewRecorder()
	e.ServeHTTP(resp, req)

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var body map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	_, hasCount := body["count"]
	require.False(t, hasCount)
}
