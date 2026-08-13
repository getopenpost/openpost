package handlers

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/stretchr/testify/require"
)

func TestProviderExecutionIntentJSONPropertiesAreOptionalEnums(t *testing.T) {
	db := createHandlerTestDB(t)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	oauth := NewOAuthHandler(
		db,
		crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"),
		nil,
		testAuthenticator{},
		false,
		"https://app.openpost.test",
	)
	oauth.ExchangeCode(api)
	oauth.BlueskyLogin(api)
	oauth.DiscordWebhookLogin(api)
	NewPublicationHandler(db, testAuthenticator{}, nil).RegisterRoutes(api)

	raw, err := json.Marshal(api.OpenAPI())
	require.NoError(t, err)
	var document map[string]any
	require.NoError(t, json.Unmarshal(raw, &document))
	components := document["components"].(map[string]any)
	schemas := components["schemas"].(map[string]any)
	matched := 0
	for schemaName, rawSchema := range schemas {
		schema, ok := rawSchema.(map[string]any)
		if !ok {
			continue
		}
		properties, _ := schema["properties"].(map[string]any)
		required := openAPIStringSet(schema["required"])
		for propertyName, rawProperty := range properties {
			property, ok := rawProperty.(map[string]any)
			if !ok {
				continue
			}
			description, _ := property["description"].(string)
			if !strings.HasPrefix(description, "Typed execution intent") &&
				!strings.HasPrefix(description, "Typed readiness intent") {
				continue
			}
			matched++
			require.NotContains(t, required, propertyName, "%s.%s must be optional", schemaName, propertyName)
			require.ElementsMatch(t, []any{"production", "certification_test"}, property["enum"], "%s.%s", schemaName, propertyName)
			require.NotContains(t, property, "default", "%s.%s must normalize omission at runtime", schemaName, propertyName)
		}
	}
	require.Equal(t, 4, matched, "all JSON-body readiness intents must share the optional enum contract")
}

func openAPIStringSet(raw any) map[string]struct{} {
	result := map[string]struct{}{}
	values, _ := raw.([]any)
	for _, value := range values {
		if text, ok := value.(string); ok {
			result[text] = struct{}{}
		}
	}
	return result
}
