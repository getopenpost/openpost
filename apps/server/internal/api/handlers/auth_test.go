package handlers

import (
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
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/sessions"
	"github.com/stretchr/testify/require"
)

func TestAuthHandlerListsAndRevokesSessions(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil), (*models.UserSession)(nil))
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
		CreatedAt:    time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	authService := auth.NewService("test-secret")
	sessionService := sessions.NewService(db)
	current, err := sessionService.CreateSession(ctx, sessions.CreateInput{
		UserID:    "user-1",
		UserAgent: "Current Browser",
		IPAddress: "203.0.113.10",
		ExpiresAt: time.Now().UTC().Add(time.Hour),
	})
	require.NoError(t, err)
	other, err := sessionService.CreateSession(ctx, sessions.CreateInput{
		UserID:    "user-1",
		UserAgent: "Other Browser",
		IPAddress: "203.0.113.11",
		ExpiresAt: time.Now().UTC().Add(time.Hour),
	})
	require.NoError(t, err)
	token, err := authService.GenerateTokenWithSession("user-1", "user@example.com", current.ID, current.ExpiresAt)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewAuthHandler(
		db,
		authService,
		middleware.NewJWTAuthenticatorWithSessions(authService, sessionService),
		nil,
		nil,
		false,
	)
	handler.SetSessionService(sessionService)
	handler.ListSessions(api)
	handler.RevokeSession(api)

	listResp := authSessionRequest(t, e, http.MethodGet, "/api/v1/auth/sessions", token)
	require.Equal(t, http.StatusOK, listResp.Code, listResp.Body.String())

	var listOut []UserSessionSummary
	require.NoError(t, json.Unmarshal(listResp.Body.Bytes(), &listOut))
	require.Len(t, listOut, 2)
	summaries := map[string]UserSessionSummary{}
	for _, item := range listOut {
		summaries[item.ID] = item
	}
	require.True(t, summaries[current.ID].Current)
	require.False(t, summaries[other.ID].Current)

	revokeResp := authSessionRequest(t, e, http.MethodDelete, "/api/v1/auth/sessions/"+other.ID, token)
	require.Equal(t, http.StatusOK, revokeResp.Code, revokeResp.Body.String())
	var revokeOut struct {
		Revoked        bool `json:"revoked"`
		RevokedCurrent bool `json:"revoked_current"`
	}
	require.NoError(t, json.Unmarshal(revokeResp.Body.Bytes(), &revokeOut))
	require.True(t, revokeOut.Revoked)
	require.False(t, revokeOut.RevokedCurrent)

	var revoked models.UserSession
	require.NoError(t, db.NewSelect().Model(&revoked).Where("id = ?", other.ID).Scan(ctx))
	require.False(t, revoked.RevokedAt.IsZero())
}

func authSessionRequest(t *testing.T, e *echo.Echo, method, path, token string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), method, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}
