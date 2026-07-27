package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestUpdateAccountSlug(t *testing.T) {
	t.Parallel()

	srv := newAccountsTestServer(t)
	resp := srv.request(t, http.MethodPatch, "/api/v1/accounts/acc-1", map[string]string{"slug": "main-x"})
	require.Equal(t, http.StatusOK, resp.Code)

	var out AccountResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "main-x", out.Slug)

	var account models.SocialAccount
	require.NoError(t, srv.db.NewSelect().Model(&account).Where("id = ?", "acc-1").Scan(context.Background()))
	require.Equal(t, "main-x", account.Slug)
}

func TestUpdateAccountSlugRejectsDuplicate(t *testing.T) {
	t.Parallel()

	srv := newAccountsTestServer(t)
	resp := srv.request(t, http.MethodPatch, "/api/v1/accounts/acc-1", map[string]string{"slug": "other-x"})
	require.Equal(t, http.StatusConflict, resp.Code)
}

func TestUpdateAccountSlugRejectsInvalidSlug(t *testing.T) {
	t.Parallel()

	srv := newAccountsTestServer(t)
	resp := srv.request(t, http.MethodPatch, "/api/v1/accounts/acc-1", map[string]string{"slug": "Bad Slug"})
	require.Equal(t, http.StatusBadRequest, resp.Code)
}

type accountsTestServer struct {
	echo *echo.Echo
	db   *bun.DB
}

func newAccountsTestServer(t *testing.T) *accountsTestServer {
	t.Helper()

	db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil))
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        "admin",
	}).Exec(ctx)
	require.NoError(t, err)
	accounts := []models.SocialAccount{
		{ID: "acc-1", WorkspaceID: "ws-1", Slug: "old-x", Platform: "x", AccountID: "1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "acc-2", WorkspaceID: "ws-1", Slug: "other-x", Platform: "x", AccountID: "2", AccessTokenEnc: []byte("token"), IsActive: true},
	}
	_, err = db.NewInsert().Model(&accounts).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := &OAuthHandler{db: db, auth: testAuthenticator{}}
	handler.UpdateAccount(api)

	return &accountsTestServer{echo: e, db: db}
}

func (s *accountsTestServer) request(t *testing.T, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	require.NoError(t, json.NewEncoder(&payload).Encode(body))
	req := httptest.NewRequestWithContext(t.Context(), method, path, &payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}
