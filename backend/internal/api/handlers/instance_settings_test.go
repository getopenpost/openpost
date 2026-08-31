package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/config"
	"github.com/openpost/backend/internal/models"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/instancesettings"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func newInstanceSettingsTestServer(t *testing.T, isAdmin bool) *echo.Echo {
	return newInstanceSettingsTestServerWithAuthenticator(t, isAdmin, browserSessionTestAuthenticator())
}

func newInstanceSettingsTestServerWithAuthenticator(
	t *testing.T,
	isAdmin bool,
	authenticator middleware.Authenticator,
) *echo.Echo {
	t.Helper()
	db := createHandlerTestDB(t, (*models.User)(nil), (*models.InstanceSetting)(nil))
	_, err := db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "user@example.com", PasswordHash: "hash", IsAdmin: isAdmin, CreatedAt: time.Now().UTC(),
	}).Exec(context.Background())
	require.NoError(t, err)
	service := instancesettings.NewService(
		db,
		servicecrypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"),
		config.Load(),
	)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewInstanceSettingsHandler(service, db, authenticator).RegisterRoutes(api)
	return e
}

func newCloudInstanceSettingsTestServer(t *testing.T) (*echo.Echo, *bun.DB) {
	t.Helper()
	db := createHandlerTestDB(t, (*models.User)(nil), (*models.InstanceSetting)(nil))
	_, err := db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "user@example.com", PasswordHash: "hash", IsAdmin: true, CreatedAt: time.Now().UTC(),
	}).Exec(context.Background())
	require.NoError(t, err)
	encryptor := servicecrypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef")
	seedService := instancesettings.NewService(db, encryptor, config.Load())
	storedSecret := "stored-secret"
	_, err = seedService.Save(t.Context(), "user-1", []instancesettings.Update{{
		Key: "OPENPOST_PEXELS_API_KEY", Value: &storedSecret,
	}})
	require.NoError(t, err)
	t.Setenv("OPENPOST_EDITION", config.EditionCloud)
	t.Setenv("OPENPOST_PEXELS_API_KEY", "deployment-secret")
	service := instancesettings.NewService(db, encryptor, config.Load())
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewInstanceSettingsHandler(service, db, browserSessionTestAuthenticator()).RegisterRoutes(api)
	return e, db
}

func TestInstanceSettingsAdminRejectsBearerAdminToken(t *testing.T) {
	e := newInstanceSettingsTestServerWithAuthenticator(t, true, unboundCLIFullTestAuthenticator())
	response := requestInstanceSettings(t, e, http.MethodGet, nil)
	require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
	require.Contains(t, response.Body.String(), "browser session")
}

func requestInstanceSettings(t *testing.T, e *echo.Echo, method string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	req := httptest.NewRequestWithContext(t.Context(), method, "/api/v1/admin/instance-settings", &payload)
	req.Header.Set("Authorization", "Bearer web-token")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func responseSettingByKey(t *testing.T, response InstanceSettingsResponse, key string) InstanceSettingResponse {
	t.Helper()
	for _, setting := range response.Settings {
		if setting.Key == key {
			return setting
		}
	}
	t.Fatalf("instance setting %s was not returned", key)
	return InstanceSettingResponse{}
}

func TestInstanceSettingsAdminListsAndSavesRedactedSettings(t *testing.T) {
	e := newInstanceSettingsTestServer(t, true)
	feedbackURL := "https://discord.com/api/webhooks/123/sensitive-feedback-token"

	list := requestInstanceSettings(t, e, http.MethodGet, nil)
	require.Equal(t, http.StatusOK, list.Code, list.Body.String())
	var initial InstanceSettingsResponse
	require.NoError(t, json.Unmarshal(list.Body.Bytes(), &initial))
	require.NotEmpty(t, initial.Settings)

	save := requestInstanceSettings(t, e, http.MethodPut, map[string]any{"settings": []map[string]any{
		{"key": "OPENPOST_EMAIL_PROVIDER", "value": "resend"},
		{"key": "OPENPOST_EMAIL_FROM", "value": "OpenPost <hello@example.com>"},
		{"key": "OPENPOST_RESEND_API_KEY", "value": "re_private"},
		{"key": "OPENPOST_FEEDBACK_DESTINATION_URL", "value": feedbackURL},
	}})
	require.Equal(t, http.StatusOK, save.Code, save.Body.String())
	require.NotContains(t, save.Body.String(), "re_private")
	require.NotContains(t, save.Body.String(), "sensitive-feedback-token")
	var saved InstanceSettingsResponse
	require.NoError(t, json.Unmarshal(save.Body.Bytes(), &saved))
	require.True(t, saved.RequiresRestart)
	resendKey := responseSettingByKey(t, saved, "OPENPOST_RESEND_API_KEY")
	require.True(t, resendKey.SecretConfigured)
	require.Empty(t, resendKey.Value)
	require.Equal(t, "database", resendKey.Source)
	feedback := responseSettingByKey(t, saved, "OPENPOST_FEEDBACK_DESTINATION_URL")
	require.True(t, feedback.Secret)
	require.True(t, feedback.SecretConfigured)
	require.Empty(t, feedback.Value)
	require.Equal(t, "database", feedback.Source)
}

func TestCloudInstanceSecretIsReadOnlyAndLegacyRowCanBeRemoved(t *testing.T) {
	e, db := newCloudInstanceSettingsTestServer(t)
	list := requestInstanceSettings(t, e, http.MethodGet, nil)
	require.Equal(t, http.StatusOK, list.Code, list.Body.String())
	var initial InstanceSettingsResponse
	require.NoError(t, json.Unmarshal(list.Body.Bytes(), &initial))
	pexels := responseSettingByKey(t, initial, "OPENPOST_PEXELS_API_KEY")
	require.Equal(t, "environment", pexels.Source)
	require.Equal(t, "OPENPOST_PEXELS_API_KEY", pexels.ManagedBy)
	require.True(t, pexels.DatabaseOverride)
	require.False(t, pexels.Editable)
	require.True(t, pexels.SecretConfigured)
	require.Empty(t, pexels.Value)

	var before models.InstanceSetting
	require.NoError(t, db.NewSelect().Model(&before).Where("key = ?", "OPENPOST_PEXELS_API_KEY").Scan(t.Context()))
	rejected := requestInstanceSettings(t, e, http.MethodPut, map[string]any{"settings": []map[string]any{
		{"key": "OPENPOST_PEXELS_API_KEY", "value": "replacement-secret"},
	}})
	require.Equal(t, http.StatusBadRequest, rejected.Code, rejected.Body.String())
	require.NotContains(t, rejected.Body.String(), "replacement-secret")
	var after models.InstanceSetting
	require.NoError(t, db.NewSelect().Model(&after).Where("key = ?", "OPENPOST_PEXELS_API_KEY").Scan(t.Context()))
	require.Equal(t, before.ValueEncrypted, after.ValueEncrypted)

	removed := requestInstanceSettings(t, e, http.MethodPut, map[string]any{"settings": []map[string]any{
		{"key": "OPENPOST_PEXELS_API_KEY", "unset": true},
	}})
	require.Equal(t, http.StatusOK, removed.Code, removed.Body.String())
	var saved InstanceSettingsResponse
	require.NoError(t, json.Unmarshal(removed.Body.Bytes(), &saved))
	pexels = responseSettingByKey(t, saved, "OPENPOST_PEXELS_API_KEY")
	require.Equal(t, "environment", pexels.Source)
	require.False(t, pexels.DatabaseOverride)
	require.False(t, pexels.Editable)
	var count int
	require.NoError(t, db.NewSelect().Model((*models.InstanceSetting)(nil)).Where("key = ?", "OPENPOST_PEXELS_API_KEY").ColumnExpr("COUNT(*)").Scan(t.Context(), &count))
	require.Zero(t, count)
}

func TestInstanceSettingsAdminRejectsNonAdmin(t *testing.T) {
	e := newInstanceSettingsTestServer(t, false)
	response := requestInstanceSettings(t, e, http.MethodGet, nil)
	require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
}

func TestInstanceSettingsAdminOverridesEnvironmentManagedValue(t *testing.T) {
	t.Setenv("OPENPOST_FEEDBACK_ENABLED", "true")
	e := newInstanceSettingsTestServer(t, true)
	initial := requestInstanceSettings(t, e, http.MethodGet, nil)
	require.Equal(t, http.StatusOK, initial.Code, initial.Body.String())
	var listed InstanceSettingsResponse
	require.NoError(t, json.Unmarshal(initial.Body.Bytes(), &listed))
	var feedback InstanceSettingResponse
	for _, setting := range listed.Settings {
		if setting.Key == "OPENPOST_FEEDBACK_ENABLED" {
			feedback = setting
			break
		}
	}
	require.Equal(t, "environment", feedback.Source)
	require.Equal(t, "OPENPOST_FEEDBACK_ENABLED", feedback.ManagedBy)
	require.True(t, feedback.Editable)
	require.False(t, feedback.DatabaseOverride)

	response := requestInstanceSettings(t, e, http.MethodPut, map[string]any{"settings": []map[string]any{
		{"key": "OPENPOST_FEEDBACK_ENABLED", "value": "false"},
	}})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var saved InstanceSettingsResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &saved))
	for _, setting := range saved.Settings {
		if setting.Key == "OPENPOST_FEEDBACK_ENABLED" {
			feedback = setting
			break
		}
	}
	require.Equal(t, "database", feedback.Source)
	require.Equal(t, "OPENPOST_FEEDBACK_ENABLED", feedback.ManagedBy)
	require.Equal(t, "false", feedback.Value)
	require.True(t, feedback.DatabaseOverride)
	require.True(t, feedback.RequiresRestart)
}
