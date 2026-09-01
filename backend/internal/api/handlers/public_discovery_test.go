package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"
)

func TestPublicDiscoveryRoutes(t *testing.T) {
	t.Parallel()

	e := echo.New()
	handler := NewPublicDiscoveryHandler("https://app.openpost.test", "v4.16.0")
	handler.RegisterRoutes(e)

	t.Run("crawler policy", func(t *testing.T) {
		rec := requestPublicDiscovery(t, e, http.MethodGet, "/robots.txt")
		require.Equal(t, http.StatusOK, rec.Code)
		require.Equal(t, "text/plain; charset=UTF-8", rec.Header().Get("Content-Type"))
		require.Equal(t, `User-agent: *
Allow: /
Disallow: /api/
`, rec.Body.String())
	})

	t.Run("API catalog", func(t *testing.T) {
		rec := requestPublicDiscovery(t, e, http.MethodGet, "/.well-known/api-catalog")
		require.Equal(t, http.StatusOK, rec.Code)
		require.Equal(
			t,
			`application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"`,
			rec.Header().Get("Content-Type"),
		)
		require.Equal(t, `</.well-known/api-catalog>; rel="api-catalog"`, rec.Header().Get("Link"))
		var body struct {
			Linkset []map[string]any `json:"linkset"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		require.Len(t, body.Linkset, 3)
		require.Equal(t, "https://app.openpost.test", body.Linkset[0]["anchor"])
		require.Equal(t, "https://app.openpost.test/api/v1", body.Linkset[1]["anchor"])
		require.Equal(t, "https://app.openpost.test/mcp", body.Linkset[2]["anchor"])
	})

	t.Run("MCP server card", func(t *testing.T) {
		for _, pathname := range []string{
			"/.well-known/mcp/server-card.json",
			"/mcp/server-card",
		} {
			rec := requestPublicDiscovery(t, e, http.MethodGet, pathname)
			require.Equal(t, http.StatusOK, rec.Code)
			require.Equal(t, "application/json", rec.Header().Get("Content-Type"))
			var body map[string]any
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
			require.Equal(t, "4.16.0", body["version"])
			remote := body["remotes"].([]any)[0].(map[string]any)
			require.Equal(t, "https://app.openpost.test/mcp", remote["url"])
			require.Equal(t, []any{mcpProtocolVersion, mcpFallbackVersion}, remote["supportedProtocolVersions"])
		}
	})

	for _, pathname := range []string{
		"/robots.txt",
		"/.well-known/api-catalog",
		"/.well-known/mcp/server-card.json",
		"/mcp/server-card",
	} {
		rec := requestPublicDiscovery(t, e, http.MethodHead, pathname)
		require.Equal(t, http.StatusOK, rec.Code, pathname)
		require.Empty(t, rec.Body.String(), pathname)
	}
}

func requestPublicDiscovery(t *testing.T, e *echo.Echo, method, pathname string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, pathname, nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}
