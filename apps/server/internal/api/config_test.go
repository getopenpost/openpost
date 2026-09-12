package api

import (
	"net/http"
	"regexp"
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
	require.Equal(t, []map[string][]string{{"bearerAuth": {}}, {"sessionCookie": {}}}, document.Security)
	require.Equal(t, "http", document.Components.SecuritySchemes["bearerAuth"].Type)
	require.Equal(t, "bearer", document.Components.SecuritySchemes["bearerAuth"].Scheme)
	require.Equal(t, "apiKey", document.Components.SecuritySchemes["sessionCookie"].Type)
	require.Equal(t, "cookie", document.Components.SecuritySchemes["sessionCookie"].In)
	require.Equal(t, "openpost_session", document.Components.SecuritySchemes["sessionCookie"].Name)

	listWorkspaces := operationByID(t, document, "list-workspaces")
	require.Nil(t, listWorkspaces.Security, "authenticated operations inherit bearer or session cookie security")
	for _, operationID := range []string{
		"append-provider-approval-review",
		"append-provider-runtime-control",
		"append-provider-certification",
	} {
		require.Equal(t, []map[string][]string{{"sessionCookie": {}}},
			operationByID(t, document, operationID).Security, operationID)
	}
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

	bootstrap := operationByID(t, document, "get-app-bootstrap")
	require.Equal(t, []map[string][]string{
		{},
		{"bearerAuth": {}},
		{"sessionCookie": {}},
	}, bootstrap.Security, "bootstrap supports anonymous, bearer, and session-cookie responses")
	require.ElementsMatch(t, []string{"Auth", "Workspaces"}, bootstrap.Tags)
	require.NotContains(t, bootstrap.Extensions, "x-openpost-automation", "narrow REST tokens must not gain account identity access")
	bootstrapResponse := bootstrap.Responses["200"].Content["application/json"].Schema
	bootstrapSchema := document.Components.Schemas.SchemaFromRef(bootstrapResponse.Ref)
	require.ElementsMatch(t, []string{
		"authenticated",
		"user",
		"workspaces",
		"selected_workspace_id",
		"selected_workspace_settings",
	}, bootstrapSchema.Required)
	require.False(t, bootstrapSchema.Properties["workspaces"].Nullable)
	require.True(t, bootstrapSchema.Properties["selected_workspace_id"].Nullable)
	require.True(t, document.Components.Schemas.SchemaFromRef(bootstrapSchema.Properties["user"].Ref).Nullable)
	require.True(t, document.Components.Schemas.SchemaFromRef(bootstrapSchema.Properties["selected_workspace_settings"].Ref).Nullable)
	require.Contains(t, bootstrap.Responses, "503")

	sessionState := operationByID(t, document, "get-auth-session-state")
	require.Equal(t, []map[string][]string{
		{},
		{"bearerAuth": {}},
		{"sessionCookie": {}},
	}, sessionState.Security, "session state supports anonymous, bearer, and session-cookie responses")
	require.Contains(t, sessionState.Responses, "503")
}

func TestAPIReferenceLoadsItsSchemaFromTheServingInstance(t *testing.T) {
	t.Parallel()
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), OpenAPIConfig("1.0.0"))
	FinalizeOpenAPIContract(api)
	page := systemGET(t, e, "/api/v1/docs")
	require.Equal(t, http.StatusOK, page.Code)
	match := regexp.MustCompile(`apiDescriptionUrl="([^"]+)"`).FindStringSubmatch(page.Body.String())
	require.Len(t, match, 2)
	schema := systemGET(t, e, match[1])
	require.Equal(t, http.StatusOK, schema.Code, "API reference must load its advertised schema: %s", match[1])
	require.Contains(t, schema.Body.String(), "openapi: 3.1.0")
}
