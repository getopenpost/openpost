package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/imagegeneration"
	"github.com/stretchr/testify/require"
)

func TestImageGenerationRequiresSignInEvenWhenProviderIsUnconfigured(t *testing.T) {
	e := echo.New()
	api := humaecho.New(e, huma.DefaultConfig("test", "1"))
	NewImageGenerationHandler(nil, publicationBuildTestAuthenticator{}).RegisterRoutes(api)
	for _, request := range []struct {
		method string
		path   string
		body   string
	}{
		{method: http.MethodGet, path: "/image-generations/config"},
		{method: http.MethodGet, path: "/image-generations?workspace_id=ws&project_id=project"},
		{method: http.MethodGet, path: "/image-generations/run"},
		{method: http.MethodPost, path: "/image-generations", body: `{"workspace_id":"ws","project_id":"project","operation":"generate","prompt":"launch image"}`},
	} {
		req := httptest.NewRequestWithContext(t.Context(), request.method, request.path, strings.NewReader(request.body))
		if request.body != "" {
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Idempotency-Key", "unauthenticated-create")
		}
		response := httptest.NewRecorder()
		e.ServeHTTP(response, req)
		require.Equal(t, http.StatusUnauthorized, response.Code, request.method+" "+request.path)
	}
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/image-generations/config", nil)
	req.Header.Set("Authorization", "Bearer web-token")
	response := httptest.NewRecorder()
	e.ServeHTTP(response, req)
	require.Equal(t, http.StatusOK, response.Code)
	var config struct {
		Available    bool   `json:"available"`
		DefaultModel string `json:"default_model"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &config))
	require.False(t, config.Available)
	require.Equal(t, "gpt-image-2.5-flare", config.DefaultModel)
}

func TestGeneratedImageImportRecoversAfterRecipeFailureWithoutAnotherUpload(t *testing.T) {
	srv := newMediaQuotaTestServer(t, entitlements.NewStaticService(entitlements.PlanSnapshot{}))
	_, err := srv.db.NewCreateTable().Model((*models.MediaGenerationRecipe)(nil)).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.ExecContext(t.Context(), `CREATE TRIGGER fail_image_recipe BEFORE INSERT ON media_generation_recipes BEGIN SELECT RAISE(FAIL, 'recipe unavailable'); END`)
	require.NoError(t, err)
	input := imagegeneration.MediaImport{WorkspaceID: "ws-1", RunID: "generation-1", Recipe: `{"prompt":"red square"}`, Content: validMemePNG(t)}
	_, err = srv.handler.ImportGeneratedImage(t.Context(), input)
	require.Error(t, err)
	var first models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&first).Scan(t.Context()))
	_, err = srv.db.ExecContext(t.Context(), "DROP TRIGGER fail_image_recipe")
	require.NoError(t, err)
	result, err := srv.handler.ImportGeneratedImage(t.Context(), input)
	require.NoError(t, err)
	require.Equal(t, first.ID, result.ID)
	count, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
	uploaded, err := srv.usage.CurrentMonthly(t.Context(), "ws-1", entitlements.LimitMediaBytesUploadedMonthly, time.Now())
	require.NoError(t, err)
	require.Equal(t, int64(len(input.Content)), uploaded)
	// The retry must also finish the recipe the first attempt could not store.
	var stored models.MediaGenerationRecipe
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("media_id = ?", result.ID).Scan(t.Context()))
	require.Equal(t, input.Recipe, stored.RecipeJSON)
	recipeCount, err := srv.db.NewSelect().Model((*models.MediaGenerationRecipe)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, recipeCount)
}
