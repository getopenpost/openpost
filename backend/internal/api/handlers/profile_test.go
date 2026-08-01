package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestDeleteProfileAvatarClearsStoredReference(t *testing.T) {
	db := createHandlerTestDB(t, (*models.User)(nil))
	_, err := db.NewInsert().Model(&models.User{
		ID:              "user-1",
		Email:           "user@example.com",
		PasswordHash:    "hash",
		AvatarURL:       "/avatars/avatar-1",
		AvatarObjectKey: "avatar-1.png",
	}).Exec(context.Background())
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewProfileHandler(db, testAuthenticator{}, nil).RegisterRoutes(api)

	req := httptest.NewRequestWithContext(t.Context(), http.MethodDelete, "/api/v1/auth/profile/avatar", nil)
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var user models.User
	require.NoError(t, db.NewSelect().Model(&user).Where("id = ?", "user-1").Scan(context.Background()))
	require.Empty(t, user.AvatarURL)
	require.Empty(t, user.AvatarObjectKey)
}
