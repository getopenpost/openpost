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
	"github.com/openpost/backend/internal/services/postgeneration"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type postBuilderFunc func(context.Context, postgeneration.Input) (postgeneration.Result, error)

func (f postBuilderFunc) Build(ctx context.Context, input postgeneration.Input) (postgeneration.Result, error) {
	return f(ctx, input)
}

func TestGeneratePostUsesOnlyActiveAccountsFromEditableWorkspace(t *testing.T) {
	server := newPostBuilderTestServer(t, postBuilderFunc(func(_ context.Context, input postgeneration.Input) (postgeneration.Result, error) {
		require.Equal(t, "Shipped offline drafts", input.Idea)
		require.Equal(t, []postgeneration.Destination{
			{AccountID: "account-x", Platform: "x", Profile: models.ContentProfileShortText},
			{AccountID: "account-linkedin", Platform: "linkedin", Profile: models.ContentProfileShortText},
		}, input.Destinations)
		return postgeneration.Result{
			SourceText: "Offline drafts are live.",
			Renditions: []postgeneration.Rendition{{AccountID: "account-x", Body: "Offline drafts are live on X."}, {AccountID: "account-linkedin", Body: "Your drafts now survive unreliable connections."}},
			Model:      "openai/gpt-5.6-luna",
		}, nil
	}))

	response := server.request(t, []string{"account-x", "account-linkedin"})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var output GeneratePostOutput
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output.Body))
	require.Equal(t, "Offline drafts are live.", output.Body.SourceText)
	require.Len(t, output.Body.Renditions, 2)
}

func TestGeneratePostRejectsAccountFromAnotherWorkspaceBeforeGeneration(t *testing.T) {
	called := false
	server := newPostBuilderTestServer(t, postBuilderFunc(func(_ context.Context, _ postgeneration.Input) (postgeneration.Result, error) {
		called = true
		return postgeneration.Result{}, nil
	}))

	response := server.request(t, []string{"account-other"})
	require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
	require.False(t, called)
}

func TestGeneratePostReportsWhenAIIsNotConfigured(t *testing.T) {
	server := newPostBuilderTestServer(t, nil)
	response := server.request(t, []string{"account-x"})
	require.Equal(t, http.StatusServiceUnavailable, response.Code, response.Body.String())
}

type postBuilderTestServer struct {
	echo *echo.Echo
	db   *bun.DB
}

func newPostBuilderTestServer(t *testing.T, builder postgeneration.Builder) *postBuilderTestServer {
	t.Helper()
	db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.SocialAccount)(nil))
	_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
	require.NoError(t, err)
	accounts := []models.SocialAccount{
		{ID: "account-x", WorkspaceID: "ws-1", Slug: "x", Platform: "x", AccountID: "remote-x", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "account-linkedin", WorkspaceID: "ws-1", Slug: "linkedin", Platform: "linkedin", AccountID: "remote-linkedin", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "account-other", WorkspaceID: "ws-2", Slug: "other", Platform: "x", AccountID: "remote-other", AccessTokenEnc: []byte("token"), IsActive: true},
	}
	_, err = db.NewInsert().Model(&accounts).Exec(t.Context())
	require.NoError(t, err)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPostBuilderHandler(db, testAuthenticator{}, builder).RegisterRoutes(api)
	return &postBuilderTestServer{echo: e, db: db}
}

func (s *postBuilderTestServer) request(t *testing.T, accountIDs []string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	require.NoError(t, json.NewEncoder(&body).Encode(map[string]any{
		"workspace_id": "ws-1", "idea": "Shipped offline drafts", "social_account_ids": accountIDs,
	}))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/post-builder/generate", &body)
	request.Header.Set("Authorization", "Bearer web-token")
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	s.echo.ServeHTTP(recorder, request)
	return recorder
}
