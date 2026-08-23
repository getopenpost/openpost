package api

import (
	"encoding/json"
	"testing"

	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/automationcatalog"
	"github.com/stretchr/testify/require"
)

type registeredOperation struct {
	OperationID string         `json:"operationId"`
	Tags        []string       `json:"tags"`
	Automation  map[string]any `json:"x-openpost-automation"`
}

func TestRESTScopeCatalogMatchesRegisteredHumaOperations(t *testing.T) {
	e := echo.New()
	humaAPI := humaecho.NewWithGroup(e, e.Group("/api/v1"), NewHumaConfig("Test", "1.0.0"))
	RegisterHumaRoutes(humaAPI, RouteDeps{PublicProfilesEnabled: true})

	raw, err := json.Marshal(humaAPI.OpenAPI())
	require.NoError(t, err)
	var document struct {
		Paths map[string]map[string]registeredOperation `json:"paths"`
	}
	require.NoError(t, json.Unmarshal(raw, &document))
	registered := make(map[string]registeredOperation)
	for _, path := range document.Paths {
		for _, operation := range path {
			if operation.OperationID != "" {
				registered[operation.OperationID] = operation
			}
		}
	}

	read, write := middleware.RESTScopeOperationCatalog()
	legacyRead, legacyWrite := middleware.LegacyRESTScopeOperationCatalog()
	readSet := make(map[string]struct{}, len(read))
	humaSet := make(map[string]struct{}, len(read)+len(write))
	for _, operationID := range read {
		readSet[operationID] = struct{}{}
		humaSet[operationID] = struct{}{}
	}
	for _, operationID := range write {
		_, overlapsRead := readSet[operationID]
		require.False(t, overlapsRead, "%s must have one curated access classification", operationID)
		humaSet[operationID] = struct{}{}
	}

	protectedTags := map[string]struct{}{"Admin": {}, "Auth": {}, "Billing": {}}
	for _, operationID := range append(read, write...) {
		operation, exists := registered[operationID]
		require.True(t, exists, "curated REST operation %q must exist in the registered Huma API", operationID)
		for _, tag := range operation.Tags {
			_, protected := protectedTags[tag]
			require.False(t, protected, "curated REST operation %q must not expose protected %s APIs", operationID, tag)
		}
		catalogOperation, exists := automationcatalog.Lookup(operationID)
		require.True(t, exists)
		require.Equal(t, catalogOperation.Metadata(), operation.Automation)
	}
	legacyReadSet := make(map[string]struct{}, len(legacyRead))
	for _, operationID := range legacyRead {
		legacyReadSet[operationID] = struct{}{}
	}
	for _, operationID := range legacyWrite {
		_, overlapsRead := legacyReadSet[operationID]
		require.False(t, overlapsRead, "%s must have one curated legacy access classification", operationID)
	}
	for _, operationID := range append(legacyRead, legacyWrite...) {
		_, exists := registered[operationID]
		require.False(t, exists, "legacy Echo operation %q must not collide with a registered Huma operation", operationID)
		_, overlapsHuma := humaSet[operationID]
		require.False(t, overlapsHuma, "%s must have one curated transport classification", operationID)
	}
}
