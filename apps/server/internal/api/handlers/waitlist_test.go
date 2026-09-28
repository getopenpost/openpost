package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/waitlist"
	"github.com/stretchr/testify/require"
)

func TestHostedWaitlistPersistsOnceAndRetriesDiscordWithoutCreatingAnAccount(t *testing.T) {
	ctx := context.Background()
	db, err := database.InitDBWithDriver("sqlite", filepath.Join(t.TempDir(), "waitlist.db"))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))
	var attempts atomic.Int32
	discord := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			AllowedMentions struct {
				Parse []string `json:"parse"`
			} `json:"allowed_mentions"`
			Embeds []struct{ Title, Description string } `json:"embeds"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&payload))
		require.Empty(t, payload.AllowedMentions.Parse)
		require.Len(t, payload.Embeds, 1)
		require.Equal(t, "person@example.com", payload.Embeds[0].Description)
		if attempts.Add(1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer discord.Close()
	service := waitlist.NewService(db, discord.URL)
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, false)
	handler.SetWaitlist(service)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.JoinWaitlist(api)
	handler.Register(api)
	handler.Configuration(api)

	configuration := jsonRequest(t, e, http.MethodGet, "/api/v1/auth/config", nil, "")
	require.Equal(t, http.StatusOK, configuration.Code)
	require.Contains(t, configuration.Body.String(), `"waitlist_enabled":true`)
	require.Contains(t, configuration.Body.String(), `"registration_enabled":false`)
	invalid := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/waitlist", map[string]any{"email": "not-an-email"}, "")
	require.Equal(t, http.StatusBadRequest, invalid.Code)
	for _, email := range []string{" Person@Example.com ", "person@example.com"} {
		response := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/waitlist", map[string]any{"email": email}, "")
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		require.Empty(t, response.Header().Values("Set-Cookie"))
	}
	count, err := db.NewSelect().Table("hosted_waitlist_entries").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", jobregistry.TypeWaitlistNotification).Scan(ctx))
	require.Len(t, jobs, 1)
	// A fresh service proves delivery reads committed state, including after a failed attempt.
	workerService := waitlist.NewService(db, discord.URL)
	require.Error(t, waitlist.NewService(db, "").HandleNotification(ctx, jobs[0].Payload))
	require.Error(t, workerService.HandleNotification(ctx, jobs[0].Payload))
	require.NoError(t, workerService.HandleNotification(ctx, jobs[0].Payload))
	require.NoError(t, workerService.HandleNotification(ctx, jobs[0].Payload))
	require.EqualValues(t, 2, attempts.Load())

	registration := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/register", map[string]any{
		"email": "bypass@example.com", "password": "password1234",
	}, "")
	require.Equal(t, http.StatusForbidden, registration.Code, registration.Body.String())
	count, err = db.NewSelect().Model((*models.User)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
	for range 7 {
		response := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/waitlist", map[string]any{"email": "person@example.com"}, "")
		require.Equal(t, http.StatusOK, response.Code)
	}
	limited := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/waitlist", map[string]any{"email": "person@example.com"}, "")
	require.Equal(t, http.StatusTooManyRequests, limited.Code)

	handler.SetWaitlist(nil)
	closed := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/waitlist", map[string]any{"email": "other@example.com"}, "")
	require.Equal(t, http.StatusForbidden, closed.Code)
	registration = jsonRequest(t, e, http.MethodPost, "/api/v1/auth/register", map[string]any{
		"email": "selfhost@example.com", "password": "password1234",
	}, "")
	require.Equal(t, http.StatusOK, registration.Code, registration.Body.String())
}
