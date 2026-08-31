package api

import (
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"
)

func operationByID(t *testing.T, document *huma.OpenAPI, operationID string) *huma.Operation {
	t.Helper()
	for _, path := range document.Paths {
		for _, operation := range []*huma.Operation{
			path.Get, path.Put, path.Post, path.Delete, path.Options, path.Head, path.Patch, path.Trace,
		} {
			if operation != nil && operation.OperationID == operationID {
				return operation
			}
		}
	}
	t.Fatalf("operation %q not found", operationID)
	return nil
}

func TestHumaConfigDescribesCanonicalBaseAuthenticationAndAutomation(t *testing.T) {
	t.Parallel()

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), OpenAPIConfig("1.0.0"))
	RegisterHumaRoutes(api, RouteDeps{PublicProfilesEnabled: true})
	FinalizeOpenAPIContract(api)
	document := api.OpenAPI()

	require.Equal(t, "/api/v1", document.Servers[1].URL)
	require.Equal(t, []map[string][]string{{"bearerAuth": {}}}, document.Security)
	require.Equal(t, "http", document.Components.SecuritySchemes["bearerAuth"].Type)
	require.Equal(t, "bearer", document.Components.SecuritySchemes["bearerAuth"].Scheme)

	listWorkspaces := operationByID(t, document, "list-workspaces")
	require.Nil(t, listWorkspaces.Security, "authenticated operations inherit root bearer security")
	require.Equal(t, map[string]any{
		"access":      "read",
		"exposure":    "alpha",
		"effect":      "query",
		"retry":       "transient",
		"idempotency": "none",
	}, listWorkspaces.Extensions["x-openpost-automation"])

	authConfiguration := operationByID(t, document, "get-auth-configuration")
	require.NotNil(t, authConfiguration.Security)
	require.Empty(t, authConfiguration.Security, "public operations override root bearer security")
	require.NotContains(t, authConfiguration.Extensions, "x-openpost-automation")
}
