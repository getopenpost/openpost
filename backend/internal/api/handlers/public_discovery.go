package handlers

import (
	_ "embed"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"github.com/labstack/echo/v4"
)

const (
	apiCatalogMediaType = `application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"`
	publicRobotsPolicy  = `User-agent: *
Disallow: /
Allow: /u/
Allow: /openapi.json
Allow: /.well-known/api-catalog
Allow: /.well-known/oauth-authorization-server
Allow: /.well-known/oauth-protected-resource
Allow: /.well-known/oauth-protected-resource/mcp
Allow: /.well-known/mcp/server-card.json
Allow: /mcp/server-card
`
)

var semanticVersionPattern = regexp.MustCompile(`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$`)

//go:embed mcp_server_card_base.json
var mcpServerCardBaseJSON []byte

type mcpServerCard struct {
	Schema      string                  `json:"$schema"`
	Name        string                  `json:"name"`
	Version     string                  `json:"version"`
	Description string                  `json:"description"`
	Title       string                  `json:"title"`
	WebsiteURL  string                  `json:"websiteUrl"`
	Repository  mcpServerCardRepository `json:"repository"`
	Icons       []mcpServerCardIcon     `json:"icons"`
	Remotes     []mcpServerCardRemote   `json:"remotes"`
}

type mcpServerCardRepository struct {
	URL    string `json:"url"`
	Source string `json:"source"`
}

type mcpServerCardIcon struct {
	Source   string `json:"src"`
	MimeType string `json:"mimeType"`
}

type mcpServerCardRemote struct {
	Type                      string   `json:"type"`
	URL                       string   `json:"url"`
	SupportedProtocolVersions []string `json:"supportedProtocolVersions"`
}

var baseMCPServerCard = mustLoadMCPServerCardBase()

type PublicDiscoveryHandler struct {
	publicURL     string
	serverVersion string
}

func NewPublicDiscoveryHandler(publicURL, serverVersion string) *PublicDiscoveryHandler {
	return &PublicDiscoveryHandler{
		publicURL:     strings.TrimRight(strings.TrimSpace(publicURL), "/"),
		serverVersion: serverCardVersion(serverVersion),
	}
}

func (h *PublicDiscoveryHandler) RegisterRoutes(e *echo.Echo) {
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		e.Add(method, "/robots.txt", h.robots)
		e.Add(method, "/.well-known/api-catalog", h.apiCatalog)
		e.Add(method, "/.well-known/mcp/server-card.json", h.mcpServerCard)
		e.Add(method, "/mcp/server-card", h.mcpServerCard)
	}
}

func (h *PublicDiscoveryHandler) robots(c echo.Context) error {
	if c.Request().Method == http.MethodHead {
		c.Response().Header().Set(echo.HeaderContentType, echo.MIMETextPlainCharsetUTF8)
		return c.NoContent(http.StatusOK)
	}
	return c.String(http.StatusOK, publicRobotsPolicy)
}

func (h *PublicDiscoveryHandler) apiCatalog(c echo.Context) error {
	baseURL := requestBaseURL(c.Request(), h.publicURL)
	apiURL := baseURL + "/api/v1"
	mcpURL := baseURL + "/mcp"
	c.Response().Header().Set(echo.HeaderContentType, apiCatalogMediaType)
	c.Response().Header().Set("Link", `</.well-known/api-catalog>; rel="api-catalog"`)
	if c.Request().Method == http.MethodHead {
		return c.NoContent(http.StatusOK)
	}

	return c.JSON(http.StatusOK, map[string]any{
		"linkset": []any{
			map[string]any{
				"anchor": baseURL,
				"item": []any{
					map[string]any{"href": apiURL},
					map[string]any{"href": mcpURL},
				},
			},
			map[string]any{
				"anchor": apiURL,
				"service-desc": []any{
					map[string]any{
						"href": baseURL + "/openapi.json",
						"type": "application/vnd.oai.openapi+json;version=3.1",
					},
				},
				"service-doc": []any{
					map[string]any{
						"href": "https://docs.openpo.st/development/api-reference",
						"type": "text/html",
					},
				},
				"status": []any{
					map[string]any{"href": apiURL + "/ready", "type": "application/json"},
				},
			},
			map[string]any{
				"anchor": mcpURL,
				"service-desc": []any{
					map[string]any{
						"href": baseURL + "/mcp/server-card",
						"type": "application/mcp-server-card+json",
					},
				},
				"service-doc": []any{
					map[string]any{
						"href": "https://docs.openpo.st/mcp/",
						"type": "text/html",
					},
				},
			},
		},
	})
}

func (h *PublicDiscoveryHandler) mcpServerCard(c echo.Context) error {
	baseURL := requestBaseURL(c.Request(), h.publicURL)
	c.Response().Header().Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	if c.Request().Method == http.MethodHead {
		return c.NoContent(http.StatusOK)
	}

	card := baseMCPServerCard
	card.Version = h.serverVersion
	card.Remotes = append([]mcpServerCardRemote(nil), baseMCPServerCard.Remotes...)
	card.Remotes[0].URL = baseURL + "/mcp"
	return c.JSON(http.StatusOK, card)
}

func mustLoadMCPServerCardBase() mcpServerCard {
	var card mcpServerCard
	if err := json.Unmarshal(mcpServerCardBaseJSON, &card); err != nil {
		panic("invalid embedded MCP server card contract: " + err.Error())
	}
	if len(card.Remotes) != 1 {
		panic("embedded MCP server card contract must declare exactly one remote")
	}
	return card
}

func serverCardVersion(version string) string {
	normalized := strings.TrimPrefix(strings.TrimSpace(version), "v")
	if semanticVersionPattern.MatchString(normalized) {
		return normalized
	}
	return "0.0.0-dev"
}
