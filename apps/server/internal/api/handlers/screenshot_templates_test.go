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
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewScreenshotTemplateHandler(db, testAuthenticator{}).RegisterRoutes(api)
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
func TestScreenshotTemplateSaveRejectsStaleRevision(t *testing.T) {
	t.Parallel()
	srv := newScreenshotTestServer(t)
	design := srv.create(t)
	document := design.Document
	document.Conversation.Messages[0].Text = "The updated punchline"
	path := "/screenshot-templates/designs/" + design.ID
	saved := srv.request(t, http.MethodPut, path, map[string]any{"revision": 1, "document": document})
	require.Equal(t, 200, saved.Code, saved.Body.String())
	document.Conversation.Messages[0].Text = "Stale tab"
	stale := srv.request(t, http.MethodPut, path, map[string]any{"revision": 1, "document": document})
	require.Equal(t, 409, stale.Code, stale.Body.String())
	loaded := srv.request(t, http.MethodGet, path, nil)
	var current ScreenshotTemplateDesignResponse
	require.NoError(t, json.Unmarshal(loaded.Body.Bytes(), &current))
	require.Equal(t, 2, current.Revision)
	require.Equal(t, "The updated punchline", current.Document.Conversation.Messages[0].Text)
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
func TestScreenshotTemplateRejectsInvalidConversation(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name   string
		change func(*ScreenshotTemplateDocument)
	}{
		{"missing sender", func(doc *ScreenshotTemplateDocument) { doc.Conversation.Messages[0].SenderID = "unknown" }},
		{"duplicate message", func(doc *ScreenshotTemplateDocument) {
			doc.Conversation.Messages = append(doc.Conversation.Messages, doc.Conversation.Messages[0])
		}},
		{"null messages", func(doc *ScreenshotTemplateDocument) { doc.Conversation.Messages = nil }},
		{"empty messages", func(doc *ScreenshotTemplateDocument) { doc.Conversation.Messages = []ScreenshotTemplateMessage{} }},
		{"unrelated content", func(doc *ScreenshotTemplateDocument) {
			doc.StatusPage = &ScreenshotTemplateStatus{Severity: "outage", Updates: []ScreenshotTemplateStatusUpdate{{ID: "update"}}}
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			srv := newScreenshotTestServer(t)
			doc := screenshotDocumentFixture()
			test.change(&doc)
			response := srv.request(t, http.MethodPost, "/screenshot-templates/designs", map[string]any{"workspace_id": "workspace-1", "document": doc})
			require.Contains(t, []int{400, 422}, response.Code, response.Body.String())
		})
	}
}

func TestScreenshotTemplateImageFieldsRoundTrip(t *testing.T) {
	srv := newScreenshotTestServer(t)
	_, err := srv.db.NewInsert().Model(&models.MediaAttachment{ID: "photo", WorkspaceID: "workspace-1", MimeType: "image/png", ProcessingStatus: "ready"}).Exec(t.Context())
	require.NoError(t, err)
	var doc map[string]any
	encoded, err := json.Marshal(screenshotDocumentFixture())
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(encoded, &doc))
	chat := doc["conversation"].(map[string]any)
	chat["people"].([]any)[0].(map[string]any)["avatar_media_id"] = "photo"
	chat["messages"].([]any)[0].(map[string]any)["image_media_id"] = "photo"
	result := srv.request(t, http.MethodPost, "/screenshot-templates/designs", map[string]any{"workspace_id": "workspace-1", "document": doc})
	require.Equal(t, 200, result.Code, result.Body.String())
	require.Contains(t, result.Body.String(), `"avatar_media_id":"photo"`)
	require.Contains(t, result.Body.String(), `"image_media_id":"photo"`)
}

func TestScreenshotTemplateRejectsUnavailableImages(t *testing.T) {
	for _, test := range []struct {
		name, workspace, mime, status string
		assetKind                     string
		trashed                       bool
	}{
		{name: "another workspace", workspace: "workspace-2", mime: "image/png", status: "ready"},
		{name: "project asset", workspace: "workspace-1", mime: "image/png", status: "ready", assetKind: "project_asset"},
		{name: "video", workspace: "workspace-1", mime: "video/mp4", status: "ready"},
		{name: "SVG", workspace: "workspace-1", mime: "image/svg+xml", status: "ready"},
		{name: "processing", workspace: "workspace-1", mime: "image/png", status: "processing"},
		{name: "trash", workspace: "workspace-1", mime: "image/png", status: "ready", trashed: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			srv := newScreenshotTestServer(t)
			media := models.MediaAttachment{ID: "photo", WorkspaceID: test.workspace, MimeType: test.mime, ProcessingStatus: test.status, AssetKind: test.assetKind}
			if test.trashed {
				media.TrashedAt = time.Now()
			}
			_, err := srv.db.NewInsert().Model(&media).Exec(t.Context())
			require.NoError(t, err)
			design := srv.create(t)
			for _, field := range []string{"avatar", "message"} {
				doc := screenshotDocumentFixture()
				if field == "avatar" {
					doc.Conversation.People[0].AvatarMediaID = "photo"
				} else {
					doc.Conversation.Messages[0].ImageMediaID = "photo"
				}
				create := srv.request(t, http.MethodPost, "/screenshot-templates/designs", map[string]any{"workspace_id": "workspace-1", "document": doc})
				require.Equal(t, 400, create.Code, create.Body.String())
				update := srv.request(t, http.MethodPut, "/screenshot-templates/designs/"+design.ID, map[string]any{"revision": 1, "document": doc})
				require.Equal(t, 400, update.Code, update.Body.String())
			}
		})
	}
}

func TestMemeTemplateDraftAndLegacyRecipe(t *testing.T) {
	t.Parallel()
	srv := newScreenshotTestServer(t)
	doc := ScreenshotTemplateDocument{SchemaVersion: 1, TemplateID: "meme", Title: "Launch joke", Appearance: "light", Frame: "natural", TextSize: "normal", Meme: &ScreenshotTemplateMeme{TemplateID: "fry", Name: "Futurama Fry", Captions: []string{"Before launch", "After launch"}, OverlayMediaIDs: []string{}, Format: "png"}}
	created := srv.request(t, http.MethodPost, "/screenshot-templates/designs", map[string]any{"workspace_id": "workspace-1", "document": doc})
	require.Equal(t, 200, created.Code, created.Body.String())
	var design ScreenshotTemplateDesignResponse
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &design))
	doc.Meme.Captions[1] = "Still fixing bugs"
	updated := srv.request(t, http.MethodPut, "/screenshot-templates/designs/"+design.ID, map[string]any{"revision": 1, "document": doc})
	require.Equal(t, 200, updated.Code, updated.Body.String())
	loaded := srv.request(t, http.MethodGet, "/screenshot-templates/designs/"+design.ID, nil)
	require.NoError(t, json.Unmarshal(loaded.Body.Bytes(), &design))
	require.Equal(t, []string{"Before launch", "Still fixing bugs"}, design.Document.Meme.Captions)
	doc.Meme.OverlayMediaIDs = []string{"foreign-image"}
	invalid := srv.request(t, http.MethodPut, "/screenshot-templates/designs/"+design.ID, map[string]any{"revision": 2, "document": doc})
	require.Equal(t, 400, invalid.Code, invalid.Body.String())
	legacy := MemeRecipeDocument{SchemaVersion: 1, Template: MemeRecipeTemplateSnapshot{ID: "fry", Name: "Fry", Lines: 2}, Captions: []string{"Old", "Joke"}, Format: "gif"}
	encoded, err := json.Marshal(legacy)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.MediaGenerationRecipe{MediaID: "legacy", WorkspaceID: "workspace-1", Kind: "meme", RecipeJSON: string(encoded)}).Exec(t.Context())
	require.NoError(t, err)
	result := srv.request(t, http.MethodGet, "/screenshot-templates/recipes/legacy", nil)
	require.Equal(t, 200, result.Code, result.Body.String())
	var recipe ScreenshotTemplateRecipeOutput
	require.NoError(t, json.Unmarshal(result.Body.Bytes(), &recipe.Body))
	require.Equal(t, "meme", recipe.Body.Document.TemplateID)
	require.Equal(t, "gif", recipe.Body.Document.Meme.Format)
	require.Equal(t, "legacy", recipe.Body.Document.Meme.ParentMediaID)
	require.Equal(t, []string{"Old", "Joke"}, recipe.Body.Document.Meme.Captions)
}
