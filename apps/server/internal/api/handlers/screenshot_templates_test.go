package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image/jpeg"
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

type screenshotTestServer struct {
	echo *echo.Echo
	db   *bun.DB
}

func newScreenshotTestServer(t *testing.T) screenshotTestServer {
	t.Helper()
	db := createHandlerTestDB(t, (*models.User)(nil), (*models.Workspace)(nil), (*models.WorkspaceMember)(nil), (*models.MediaAttachment)(nil), (*models.MediaGenerationRecipe)(nil), (*models.ScreenshotTemplateDesign)(nil), (*models.ScreenshotTemplateMediaReference)(nil), (*models.ScreenshotTemplateRecipeMediaReference)(nil))
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{ID: "user-1", Email: "template@example.com", PasswordHash: "test"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "Templates"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleEditor}).Exec(ctx)
	require.NoError(t, err)
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	storage := &memeMemoryStorage{objects: make(map[string][]byte)}
	media := NewMediaHandler(db, storage, nil, testAuthenticator{}, nil)
	NewScreenshotTemplateHandler(db, testAuthenticator{}, NewScreenshotTemplateRenderer(db, storage, media)).RegisterRoutes(api)
	return screenshotTestServer{e, db}
}
func (srv screenshotTestServer) request(t *testing.T, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	encoded, err := json.Marshal(body)
	require.NoError(t, err)
	req := httptest.NewRequestWithContext(t.Context(), method, "/api/v1"+path, bytes.NewReader(encoded))
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.echo.ServeHTTP(rec, req)
	return rec
}
func screenshotDocumentFixture() ScreenshotTemplateDocument {
	return ScreenshotTemplateDocument{SchemaVersion: 1, TemplateID: "messages", Title: "Investor chat", Appearance: "light", Frame: "natural", TextSize: "normal", Conversation: &ScreenshotTemplateConversation{Name: "Investor", SelfID: "me", ShowHeader: true, People: []ScreenshotTemplatePerson{{ID: "me", Name: "Me"}, {ID: "alex", Name: "Alex"}}, Messages: []ScreenshotTemplateMessage{{ID: "first", SenderID: "alex", Text: "你好 👋 مرحبا"}}}}
}
func (srv screenshotTestServer) create(t *testing.T) ScreenshotTemplateDesignResponse {
	t.Helper()
	res := srv.request(t, http.MethodPost, "/screenshot-templates/designs", map[string]any{"workspace_id": "workspace-1", "document": screenshotDocumentFixture()})
	require.Equal(t, 200, res.Code, res.Body.String())
	var design ScreenshotTemplateDesignResponse
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &design))
	return design
}

func TestScreenshotTemplateRecipeSurvivesDraftChangesAndDeletion(t *testing.T) {
	t.Parallel()
	srv := newScreenshotTestServer(t)
	design := srv.create(t)
	_, err := srv.db.NewInsert().Model(&models.MediaAttachment{ID: "export-1", WorkspaceID: "workspace-1", MimeType: "image/png", Source: "screenshot_template", ProcessingStatus: "ready"}).Exec(context.Background())
	require.NoError(t, err)
	path := "/screenshot-templates/designs/" + design.ID
	exported := srv.request(t, http.MethodPost, path+"/exports", map[string]any{"revision": 1, "media_id": "export-1"})
	require.Equal(t, 200, exported.Code, exported.Body.String())
	// Retrying the same export is safe; an existing export never changes when its draft does.
	retry := srv.request(t, http.MethodPost, path+"/exports", map[string]any{"revision": 1, "media_id": "export-1"})
	require.Equal(t, 200, retry.Code)
	doc := design.Document
	doc.Conversation.Messages[0].Text = "New draft"
	updated := srv.request(t, http.MethodPut, path, map[string]any{"revision": 1, "document": doc})
	require.Equal(t, 200, updated.Code)
	replace := srv.request(t, http.MethodPost, path+"/exports", map[string]any{"revision": 2, "media_id": "export-1"})
	require.Equal(t, 409, replace.Code)
	deleted := srv.request(t, http.MethodDelete, path, nil)
	require.Equal(t, 204, deleted.Code)
	recipe := srv.request(t, http.MethodGet, "/screenshot-templates/recipes/export-1", nil)
	require.Equal(t, 200, recipe.Code, recipe.Body.String())
	var body struct {
		Document ScreenshotTemplateDocument `json:"document"`
	}
	require.NoError(t, json.Unmarshal(recipe.Body.Bytes(), &body))
	require.Equal(t, "你好 👋 مرحبا", body.Document.Conversation.Messages[0].Text)
}
func TestScreenshotTemplateAuthorization(t *testing.T) {
	t.Parallel()
	srv := newScreenshotTestServer(t)
	design := srv.create(t)
	path := "/screenshot-templates/designs/" + design.ID
	_, err := srv.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role = ?", models.WorkspaceRoleViewer).Where("workspace_id = ?", "workspace-1").Exec(context.Background())
	require.NoError(t, err)
	read := srv.request(t, http.MethodGet, path, nil)
	require.Equal(t, 200, read.Code)
	require.Contains(t, read.Body.String(), `"can_edit":false`)
	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		result := srv.request(t, method, path, map[string]any{"revision": 1, "document": design.Document})
		require.Equal(t, 403, result.Code, result.Body.String())
	}
	create := srv.request(t, http.MethodPost, "/screenshot-templates/designs", map[string]any{"workspace_id": "workspace-1", "document": design.Document})
	require.Equal(t, 403, create.Code)
	_, err = srv.db.NewDelete().Model((*models.WorkspaceMember)(nil)).Where("workspace_id = ?", "workspace-1").Exec(context.Background())
	require.NoError(t, err)
	denied := srv.request(t, http.MethodGet, path, nil)
	require.Equal(t, 403, denied.Code)
}

func TestScreenshotTemplatePreviewUsesServerRenderer(t *testing.T) {
	t.Parallel()
	srv := newScreenshotTestServer(t)
	res := srv.request(t, http.MethodPost, "/screenshot-templates/previews", map[string]any{"workspace_id": "workspace-1", "document": screenshotDocumentFixture(), "scale": 1})
	require.Equal(t, 200, res.Code, res.Body.String())
	var preview struct {
		MIMEType   string `json:"mime_type"`
		DataBase64 string `json:"data_base64"`
		Width      int    `json:"width"`
		Height     int    `json:"height"`
		Regions    []struct {
			ID    string  `json:"id"`
			Width float64 `json:"width"`
		} `json:"regions"`
	}
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &preview))
	require.Equal(t, "image/jpeg", preview.MIMEType)
	require.Equal(t, 540, preview.Width)
	data, err := base64.StdEncoding.DecodeString(preview.DataBase64)
	require.NoError(t, err)
	decoded, err := jpeg.Decode(bytes.NewReader(data))
	require.NoError(t, err)
	require.Equal(t, preview.Height, decoded.Bounds().Dy())
	require.Len(t, preview.Regions, 1)
	require.Equal(t, "first", preview.Regions[0].ID)
	require.Positive(t, preview.Regions[0].Width)

	square := screenshotDocumentFixture()
	square.Frame = "square"
	for range 30 {
		square.Conversation.Messages = append(square.Conversation.Messages, ScreenshotTemplateMessage{ID: fmt.Sprintf("m%d", len(square.Conversation.Messages)), SenderID: "me", Text: "One more line that will not fit"})
	}
	overflow := srv.request(t, http.MethodPost, "/screenshot-templates/previews", map[string]any{"workspace_id": "workspace-1", "document": square})
	require.Equal(t, 422, overflow.Code, overflow.Body.String())
}

func TestScreenshotTemplateExportRendersOnServerAndReusesIdenticalExport(t *testing.T) {
	t.Parallel()
	srv := newScreenshotTestServer(t)
	design := srv.create(t)
	path := "/screenshot-templates/designs/" + design.ID + "/exports"
	first := srv.request(t, http.MethodPost, path, map[string]any{"revision": 1})
	require.Equal(t, 200, first.Code, first.Body.String())
	var exported struct {
		Media *struct {
			ID     string `json:"id"`
			Width  int    `json:"width"`
			Height int    `json:"height"`
		} `json:"media"`
		Document ScreenshotTemplateDocument `json:"document"`
	}
	require.NoError(t, json.Unmarshal(first.Body.Bytes(), &exported))
	require.NotNil(t, exported.Media)
	require.Equal(t, design.Document, exported.Document)
	var media models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&media).Where("id = ?", exported.Media.ID).Scan(t.Context()))
	require.Equal(t, "image/png", media.MimeType)
	require.Equal(t, "screenshot_template", media.Source)
	require.Equal(t, 1080, media.Width)
	var recipe models.MediaGenerationRecipe
	require.NoError(t, srv.db.NewSelect().Model(&recipe).Where("media_id = ?", media.ID).Scan(t.Context()))
	require.Equal(t, screenshotTemplateRenderer, recipe.RendererKey)
	require.Equal(t, "user-1", recipe.CreatedByID)

	again := srv.request(t, http.MethodPost, path, map[string]any{"revision": 1})
	require.Equal(t, 200, again.Code, again.Body.String())
	var reused struct {
		Media struct {
			ID string `json:"id"`
		} `json:"media"`
	}
	require.NoError(t, json.Unmarshal(again.Body.Bytes(), &reused))
	require.Equal(t, exported.Media.ID, reused.Media.ID, "an unchanged design reuses its export")
	count, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("source = ?", "screenshot_template").Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
}
