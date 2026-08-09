package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/memes"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/memegeneration"
	"github.com/openpost/backend/internal/services/publicurl"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type memeProviderStub struct {
	mu             sync.Mutex
	available      bool
	catalog        memes.Catalog
	templateErr    error
	searchErr      error
	renderErr      error
	searchQueries  []string
	renderRequests []memes.RenderRequest
	templateImages []string
	renderedData   []byte
}

func (p *memeProviderStub) Key() string     { return memes.MemegenProviderKey }
func (p *memeProviderStub) Available() bool { return p != nil && p.available }
func (p *memeProviderStub) Health(context.Context) (memes.Health, error) {
	return memes.Health{Available: p.Available(), Ready: p.Available(), TemplateCount: len(p.catalog.Templates)}, nil
}
func (p *memeProviderStub) Templates(context.Context) (memes.Catalog, error) {
	if p.templateErr != nil {
		return memes.Catalog{}, p.templateErr
	}
	return p.catalog, nil
}
func (p *memeProviderStub) Search(_ context.Context, query string, limit int) (memes.Catalog, error) {
	p.mu.Lock()
	p.searchQueries = append(p.searchQueries, query)
	p.mu.Unlock()
	if p.searchErr != nil {
		return memes.Catalog{}, p.searchErr
	}
	catalog := p.catalog
	query = strings.ToLower(strings.TrimSpace(query))
	catalog.Templates = nil
	for _, template := range p.catalog.Templates {
		searchable := strings.ToLower(template.ID + " " + template.Name + " " + strings.Join(template.Keywords, " "))
		if query == "" || strings.Contains(searchable, query) {
			catalog.Templates = append(catalog.Templates, template)
		}
		if len(catalog.Templates) == limit {
			break
		}
	}
	return catalog, nil
}
func (p *memeProviderStub) Render(_ context.Context, request memes.RenderRequest) (memes.RenderedImage, error) {
	p.mu.Lock()
	p.renderRequests = append(p.renderRequests, request)
	p.mu.Unlock()
	if p.renderErr != nil {
		return memes.RenderedImage{}, p.renderErr
	}
	extension := normalizedMemeExtension(request.Extension)
	mimeType, _ := expectedMemeMIMEType(extension)
	return memes.RenderedImage{
		Data: append([]byte(nil), p.renderedData...), MIMEType: mimeType,
		Extension: extension, TemplateID: request.TemplateID,
	}, nil
}

func (p *memeProviderStub) TemplateImage(_ context.Context, templateID string) (memes.RenderedImage, error) {
	p.mu.Lock()
	p.templateImages = append(p.templateImages, templateID)
	p.mu.Unlock()
	if p.renderErr != nil {
		return memes.RenderedImage{}, p.renderErr
	}
	return memes.RenderedImage{
		Data: append([]byte(nil), p.renderedData...), MIMEType: "image/png",
		Extension: "png", TemplateID: templateID,
	}, nil
}

func (p *memeProviderStub) renderedRequests() []memes.RenderRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]memes.RenderRequest(nil), p.renderRequests...)
}

func (p *memeProviderStub) templateImageRequests() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.templateImages...)
}

type memeSuggesterFunc func(context.Context, memegeneration.Input) (memegeneration.Result, error)

func (f memeSuggesterFunc) Suggest(ctx context.Context, input memegeneration.Input) (memegeneration.Result, error) {
	return f(ctx, input)
}

type memeRollbackProbe struct {
	rollbackContextErr error
}

func (p *memeRollbackProbe) ImportMeme(context.Context, MemeMediaImport) (models.MediaAttachment, bool, error) {
	return models.MediaAttachment{}, false, errors.New("not used")
}

func (p *memeRollbackProbe) RollbackMeme(ctx context.Context, _ models.MediaAttachment) error {
	p.rollbackContextErr = ctx.Err()
	return nil
}

type memeMemoryStorage struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func (s *memeMemoryStorage) Driver() string { return "local" }
func (s *memeMemoryStorage) Save(id string, reader io.Reader) (string, error) {
	data, err := io.ReadAll(reader)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.objects == nil {
		s.objects = make(map[string][]byte)
	}
	s.objects[id] = data
	return id, nil
}
func (s *memeMemoryStorage) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.objects, id)
	return nil
}
func (s *memeMemoryStorage) GetURL(id string) string {
	return "https://cdn.openpost.test/media/" + id
}
func (s *memeMemoryStorage) Open(id string) (io.ReadCloser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, ok := s.objects[id]
	if !ok {
		return nil, errors.New("object not found")
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

type memePublicVerifierFunc func(context.Context, string) publicurl.Result

func (f memePublicVerifierFunc) Verify(ctx context.Context, rawURL string) publicurl.Result {
	return f(ctx, rawURL)
}

type memeHandlerTestServer struct {
	echo         *echo.Echo
	db           *bun.DB
	provider     *memeProviderStub
	mediaHandler *MediaHandler
	handler      *MemeHandler
	storage      *memeMemoryStorage
}

func newMemeHandlerTestServer(t *testing.T, suggester memegeneration.Suggester) *memeHandlerTestServer {
	t.Helper()

	db := createHandlerTestDB(t,
		(*models.User)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.MediaAttachment)(nil),
		(*models.MediaGenerationRecipe)(nil),
		(*models.UsageCounter)(nil),
		(*models.RenditionMedia)(nil),
	)
	_, err := db.NewInsert().Model(&models.User{ID: "user-1", Email: "user@example.com"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin,
	}).Exec(t.Context())
	require.NoError(t, err)

	storage := &memeMemoryStorage{objects: make(map[string][]byte)}
	mediaHandler := NewMediaHandler(db, storage, nil, testAuthenticator{}, nil)
	mediaHandler.SetPublicURLVerifier(memePublicVerifierFunc(func(_ context.Context, rawURL string) publicurl.Result {
		return publicurl.Result{Ready: strings.HasPrefix(rawURL, "https://"), CheckedAt: time.Now().UTC(), StatusCode: http.StatusOK}
	}))
	provider := &memeProviderStub{
		available:    true,
		renderedData: validMemePNG(t),
		catalog: memes.Catalog{
			RefreshedAt: time.Date(2026, time.August, 9, 10, 0, 0, 0, time.UTC),
			Templates: []memes.Template{
				{
					ID: "drake", Name: "Drake Hotline Bling", Lines: 2,
					BlankURL:  "https://api.memegen.test/images/drake.png",
					Example:   memes.TemplateExample{Text: []string{"no", "yes"}},
					SourceURL: "https://knowyourmeme.com/memes/drakeposting", Keywords: []string{"choice", "preference"},
				},
				{
					ID: "3hd", Name: "Three Headed Dragon", Lines: 3, Overlays: 1,
					BlankURL:  "https://api.memegen.test/images/3hd.png",
					Example:   memes.TemplateExample{Text: []string{"first", "second", "third"}},
					SourceURL: "https://knowyourmeme.com/memes/three-headed-dragon", Keywords: []string{"team", "comparison"},
				},
			},
		},
	}
	e := echo.New()
	group := e.Group("/api/v1")
	group.Use(MemeBodyLimitMiddleware)
	api := humaecho.NewWithGroup(e, group, huma.DefaultConfig("Test", "1.0.0"))
	handler := NewMemeHandler(db, testAuthenticator{}, mediaHandler, mediaHandler.publicMedia, provider, suggester)
	handler.RegisterRoutes(api)
	return &memeHandlerTestServer{
		echo: e, db: db, provider: provider, mediaHandler: mediaHandler,
		handler: handler, storage: storage,
	}
}

func validMemePNG(t *testing.T) []byte {
	t.Helper()
	data, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=")
	require.NoError(t, err)
	return data
}

func (s *memeHandlerTestServer) request(t *testing.T, method, path string, body any, token ...string) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		require.NoError(t, err)
		reader = bytes.NewReader(encoded)
	}
	request := httptest.NewRequestWithContext(t.Context(), method, path, reader)
	request.Header.Set("Content-Type", "application/json")
	authToken := "web-token"
	if len(token) > 0 {
		authToken = token[0]
	}
	if authToken != "" {
		request.Header.Set("Authorization", "Bearer "+authToken)
	}
	response := httptest.NewRecorder()
	s.echo.ServeHTTP(response, request)
	return response
}

func TestMemeTemplatesReturnsConfigurationAndCatalogMetadata(t *testing.T) {
	t.Parallel()

	srv := newMemeHandlerTestServer(t, memeSuggesterFunc(func(context.Context, memegeneration.Input) (memegeneration.Result, error) {
		return memegeneration.Result{}, nil
	}))
	response := srv.request(t, http.MethodGet, "/api/v1/memes/templates?workspace_id=ws-1&q=drake&limit=1", nil)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Equal(t, "private, max-age=60", response.Header().Get("Cache-Control"))

	var output ListMemeTemplatesOutput
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output.Body))
	require.True(t, output.Body.Configured)
	require.True(t, output.Body.AIConfigured)
	require.Equal(t, memes.MemegenProviderKey, output.Body.Catalog.ProviderKey)
	require.Equal(t, 2, output.Body.Catalog.TotalTemplates)
	require.Equal(t, 1, output.Body.Catalog.Returned)
	require.True(t, strings.HasPrefix(output.Body.Catalog.Revision, "sha256:"))
	require.Len(t, output.Body.Templates, 1)
	require.Equal(t, "drake", output.Body.Templates[0].ID)
	require.Empty(t, output.Body.Templates[0].BlankURL)
	require.Empty(t, output.Body.Templates[0].Example.URL)

	unauthenticated := srv.request(t, http.MethodGet, "/api/v1/memes/templates?workspace_id=ws-1", nil, "")
	require.Equal(t, http.StatusUnauthorized, unauthenticated.Code)
}

func TestMemeTemplateThumbnailIsAuthenticatedProxiedAndCached(t *testing.T) {
	t.Parallel()

	srv := newMemeHandlerTestServer(t, nil)
	path := "/api/v1/memes/templates/drake/thumbnail?workspace_id=ws-1"
	first := srv.request(t, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, first.Code, first.Body.String())
	require.Equal(t, "private, max-age=3600", first.Header().Get("Cache-Control"))
	var output GetMemeTemplateThumbnailOutput
	require.NoError(t, json.Unmarshal(first.Body.Bytes(), &output.Body))
	require.Equal(t, "drake", output.Body.TemplateID)
	require.Equal(t, "image/png", output.Body.MIMEType)
	require.Equal(t, validMemePNG(t), mustDecodeBase64(t, output.Body.DataBase64))

	second := srv.request(t, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, second.Code, second.Body.String())
	require.Equal(t, []string{"drake"}, srv.provider.templateImageRequests())

	unauthenticated := srv.request(t, http.MethodGet, path, nil, "")
	require.Equal(t, http.StatusUnauthorized, unauthenticated.Code)
}

func TestMemeSuggestionsRanksBoundedTemplatesAndReturnsMetadata(t *testing.T) {
	t.Parallel()

	var received memegeneration.Input
	srv := newMemeHandlerTestServer(t, memeSuggesterFunc(func(_ context.Context, input memegeneration.Input) (memegeneration.Result, error) {
		received = input
		return memegeneration.Result{
			Model: "model/revision",
			Candidates: []memegeneration.Candidate{
				{TemplateID: "drake", CaptionLines: []string{"Tests", "Deploy Friday"}, Rationale: "A clear rejection and preference.", AltText: "Drake meme: Tests; Deploy Friday."},
				{TemplateID: "3hd", CaptionLines: []string{"Backend", "Frontend", "Friday deploy"}, Rationale: "The third head carries the joke.", AltText: "Three Headed Dragon meme with three labels."},
			},
		}, nil
	}))
	response := srv.request(t, http.MethodPost, "/api/v1/memes/suggestions", map[string]any{
		"workspace_id": "ws-1", "idea": "team deploy preference", "tone": "sarcastic", "language": "en", "count": 2,
	})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Equal(t, "team deploy preference", received.Idea)
	require.Equal(t, "sarcastic", received.Tone)
	require.Equal(t, 2, received.CandidateCount)
	require.GreaterOrEqual(t, len(received.Templates), 2)
	var drakeTemplate memegeneration.Template
	for _, template := range received.Templates {
		if template.ID == "drake" {
			drakeTemplate = template
		}
	}
	require.Equal(t, []string{"no", "yes"}, drakeTemplate.ExampleLines)
	require.LessOrEqual(t, len(received.Templates), memegeneration.MaxCandidateTemplates)

	var output GenerateMemeSuggestionsOutput
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output.Body))
	require.Equal(t, "model/revision", output.Body.Model)
	require.Len(t, output.Body.Candidates, 2)
	require.Equal(t, "Drake Hotline Bling", output.Body.Candidates[0].Template.Name)
	require.True(t, strings.HasPrefix(output.Body.CatalogRevision, "sha256:"))
}

func TestMemePreviewResolvesWorkspaceOverlayToHTTPSAndDoesNotPersist(t *testing.T) {
	t.Parallel()

	srv := newMemeHandlerTestServer(t, nil)
	_, err := srv.db.NewInsert().Model(&models.MediaAttachment{
		ID: "overlay-1", WorkspaceID: "ws-1", FilePath: "overlay-1.png",
		MimeType: "image/png", ProcessingStatus: mediaReadyStatus,
		Size: int64(len(validMemePNG(t))), Width: 1, Height: 1,
	}).Exec(t.Context())
	require.NoError(t, err)

	response := srv.request(t, http.MethodPost, "/api/v1/memes/preview", map[string]any{
		"workspace_id": "ws-1", "template_id": "3hd",
		"captions": []string{"one", "two", "three"}, "overlay_media_ids": []string{"overlay-1"}, "format": "png",
	})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
	var output PreviewMemeOutput
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output.Body))
	require.Equal(t, "image/png", output.Body.MIMEType)
	require.Equal(t, srv.provider.renderedData, mustDecodeBase64(t, output.Body.DataBase64))

	requests := srv.provider.renderedRequests()
	require.Len(t, requests, 1)
	require.Equal(t, []string{"https://cdn.openpost.test/media/overlay-1.png"}, requests[0].OverlayURLs)
	count, err := srv.db.NewSelect().Model((*models.MediaGenerationRecipe)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestMemePreviewRejectsOversizedOverlayBeforeCallingProvider(t *testing.T) {
	t.Parallel()

	srv := newMemeHandlerTestServer(t, nil)
	_, err := srv.db.NewInsert().Model(&models.MediaAttachment{
		ID: "overlay-large", WorkspaceID: "ws-1", FilePath: "overlay-large.png",
		MimeType: "image/png", ProcessingStatus: mediaReadyStatus,
		Size: maxMemeOverlayBytes + 1, Width: 1, Height: 1,
	}).Exec(t.Context())
	require.NoError(t, err)
	response := srv.request(t, http.MethodPost, "/api/v1/memes/preview", map[string]any{
		"workspace_id": "ws-1", "template_id": "3hd",
		"captions": []string{"one", "two", "three"}, "overlay_media_ids": []string{"overlay-large"},
	})
	require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
	require.Empty(t, srv.provider.renderedRequests())
}

func TestMemeRenderImportsMediaPersistsImmutableRecipeAndAllowsRecipeRead(t *testing.T) {
	t.Parallel()

	srv := newMemeHandlerTestServer(t, nil)
	_, err := srv.db.NewInsert().Model(&models.MediaAttachment{
		ID: "overlay-1", WorkspaceID: "ws-1", FilePath: "overlay-1.png",
		MimeType: "image/png", ProcessingStatus: mediaReadyStatus,
		Size: int64(len(validMemePNG(t))), Width: 1, Height: 1,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.MediaAttachment{
		ID: "parent-1", WorkspaceID: "ws-1", FilePath: "parent-1.png",
		MimeType: "image/png", ProcessingStatus: mediaReadyStatus,
	}).Exec(t.Context())
	require.NoError(t, err)

	response := srv.request(t, http.MethodPost, "/api/v1/memes/render", map[string]any{
		"workspace_id": "ws-1", "template_id": "3hd",
		"captions":          []string{"Backend\nteam", "Frontend", "Friday deploy"},
		"overlay_media_ids": []string{"overlay-1"}, "format": "png",
		"parent_media_id": "parent-1",
	})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var output RenderMemeOutput
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output.Body))
	require.NotEmpty(t, output.Body.Media.ID)
	require.Equal(t, "meme_generator", output.Body.Media.Source)
	require.Equal(t, "parent-1", output.Body.Media.ParentMediaID)
	require.Equal(t, output.Body.Media.ID, output.Body.Recipe.MediaID)
	require.Equal(t, []string{"overlay-1"}, output.Body.Recipe.Recipe.OverlayMediaIDs)

	var storedMedia models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&storedMedia).Where("id = ?", output.Body.Media.ID).Scan(t.Context()))
	require.Equal(t, "meme_generator", storedMedia.Source)
	require.Equal(t, "Three Headed Dragon meme. Text: Backend team; Frontend; Friday deploy.", storedMedia.AltText)
	require.Equal(t, "parent-1", storedMedia.ParentMediaID)

	var storedRecipe models.MediaGenerationRecipe
	require.NoError(t, srv.db.NewSelect().Model(&storedRecipe).Where("media_id = ?", output.Body.Media.ID).Scan(t.Context()))
	require.Equal(t, "user-1", storedRecipe.CreatedByID)
	require.Equal(t, "3hd", storedRecipe.TemplateID)
	require.Contains(t, storedRecipe.RecipeJSON, `"overlay_media_ids":["overlay-1"]`)
	require.NotContains(t, storedRecipe.RecipeJSON, "cdn.openpost.test")

	_, err = srv.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).
		Set("role = ?", models.WorkspaceRoleViewer).
		Where("workspace_id = ? AND user_id = ?", "ws-1", "user-1").Exec(t.Context())
	require.NoError(t, err)
	recipeResponse := srv.request(t, http.MethodGet, "/api/v1/memes/recipes/"+output.Body.Media.ID, nil)
	require.Equal(t, http.StatusOK, recipeResponse.Code, recipeResponse.Body.String())
	require.Equal(t, "no-store", recipeResponse.Header().Get("Cache-Control"))
	var read GetMemeRecipeOutput
	require.NoError(t, json.Unmarshal(recipeResponse.Body.Bytes(), &read.Body))
	require.Equal(t, storedRecipe.CatalogRevision, read.Body.CatalogRevision)
	require.Equal(t, []string{"Backend\nteam", "Frontend", "Friday deploy"}, read.Body.Recipe.Captions)

	_, err = srv.db.NewInsert().Model(&models.Workspace{ID: "ws-2", Name: "Other"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewUpdate().Model((*models.MediaGenerationRecipe)(nil)).
		Set("workspace_id = ?", "ws-2").Where("media_id = ?", output.Body.Media.ID).Exec(t.Context())
	require.NoError(t, err)
	mismatchedRecipe := srv.request(t, http.MethodGet, "/api/v1/memes/recipes/"+output.Body.Media.ID, nil)
	require.Equal(t, http.StatusInternalServerError, mismatchedRecipe.Code, mismatchedRecipe.Body.String())

	forbiddenPreview := srv.request(t, http.MethodPost, "/api/v1/memes/preview", map[string]any{
		"workspace_id": "ws-1", "template_id": "drake", "captions": []string{"one", "two"},
	})
	require.Equal(t, http.StatusForbidden, forbiddenPreview.Code)
}

func TestMemeRenderRollsBackImportedMediaWhenRecipeInsertFails(t *testing.T) {
	t.Parallel()

	srv := newMemeHandlerTestServer(t, nil)
	_, err := srv.db.NewDropTable().Model((*models.MediaGenerationRecipe)(nil)).Exec(t.Context())
	require.NoError(t, err)
	response := srv.request(t, http.MethodPost, "/api/v1/memes/render", map[string]any{
		"workspace_id": "ws-1", "template_id": "drake", "captions": []string{"one", "two"}, "format": "png",
	})
	require.Equal(t, http.StatusInternalServerError, response.Code, response.Body.String())
	count, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("source = ?", "meme_generator").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestMemeRollbackDetachesFromCanceledRequest(t *testing.T) {
	t.Parallel()

	probe := &memeRollbackProbe{}
	handler := &MemeHandler{importer: probe}
	requestCtx, cancel := context.WithCancel(t.Context())
	cancel()
	handler.rollbackImportedMeme(requestCtx, models.MediaAttachment{ID: "generated-1"})
	require.NoError(t, probe.rollbackContextErr)
}

func TestMemeRenderRejectsCrossWorkspaceParentBeforeCallingProvider(t *testing.T) {
	t.Parallel()

	srv := newMemeHandlerTestServer(t, nil)
	_, err := srv.db.NewInsert().Model(&models.Workspace{ID: "ws-2", Name: "Elsewhere"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.MediaAttachment{
		ID: "foreign-parent", WorkspaceID: "ws-2", FilePath: "foreign.png",
		MimeType: "image/png", ProcessingStatus: mediaReadyStatus,
	}).Exec(t.Context())
	require.NoError(t, err)

	response := srv.request(t, http.MethodPost, "/api/v1/memes/render", map[string]any{
		"workspace_id": "ws-1", "template_id": "drake", "captions": []string{"one", "two"},
		"parent_media_id": "foreign-parent",
	})
	require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
	require.Empty(t, srv.provider.renderedRequests())
}

func TestMemeConcurrencyLimiterBoundsGlobalAndPerUserWork(t *testing.T) {
	t.Parallel()

	limiter := newMemeConcurrencyLimiter(2, 1)
	releaseA, ok := limiter.acquire("user-a")
	require.True(t, ok)
	_, ok = limiter.acquire("user-a")
	require.False(t, ok)
	releaseB, ok := limiter.acquire("user-b")
	require.True(t, ok)
	_, ok = limiter.acquire("user-c")
	require.False(t, ok)
	releaseA()
	releaseB()
	releaseC, ok := limiter.acquire("user-c")
	require.True(t, ok)
	releaseC()
}

func TestMemeRenderedImageRejectsUnsafeDimensionsBeforeDecode(t *testing.T) {
	t.Parallel()

	data := validMemePNG(t)
	binary.BigEndian.PutUint32(data[16:20], uint32(maxMemeImageDimension+1))
	binary.BigEndian.PutUint32(data[20:24], 1)
	binary.BigEndian.PutUint32(data[29:33], crc32.ChecksumIEEE(data[12:29]))
	err := validateMemeRenderedImage(memes.RenderedImage{
		Data: data, MIMEType: "image/png", Extension: "png", TemplateID: "drake",
	}, "drake")
	require.Error(t, err)
}

func TestMemeThumbnailRejectsBrowserUnsafeDimensions(t *testing.T) {
	t.Parallel()

	data := validMemePNG(t)
	binary.BigEndian.PutUint32(data[16:20], uint32(maxMemeThumbnailDimension+1))
	binary.BigEndian.PutUint32(data[20:24], 1)
	binary.BigEndian.PutUint32(data[29:33], crc32.ChecksumIEEE(data[12:29]))
	require.Error(t, validateMemeThumbnailImage(data))
}

func TestMemeThumbnailCacheStaysWithinByteBudget(t *testing.T) {
	handler := &MemeHandler{
		thumbnailCache: make(map[string]memeThumbnailCacheEntry),
		now:            func() time.Time { return time.Now().UTC() },
	}
	data := make([]byte, 1024*1024)
	for index := 0; index < 40; index++ {
		handler.storeMemeThumbnail(fmt.Sprintf("entry-%d", index), memeThumbnailCacheEntry{
			data: data, mimeType: "image/png", templateID: "drake",
			expiresAt: handler.now().Add(time.Duration(index+1) * time.Hour),
		})
	}
	require.LessOrEqual(t, handler.thumbnailBytes, maxMemeThumbnailCacheBytes)
	require.LessOrEqual(t, len(handler.thumbnailCache), maxMemeThumbnailEntries)
}

func TestPublicMemeSourceURLDropsPrivateOrStatefulURLs(t *testing.T) {
	t.Parallel()

	require.Equal(t, "https://knowyourmeme.com/memes/example", publicMemeSourceURL("https://knowyourmeme.com/memes/example"))
	require.Empty(t, publicMemeSourceURL("http://knowyourmeme.com/memes/example"))
	require.Empty(t, publicMemeSourceURL("https://renderer.internal/source"))
	require.Empty(t, publicMemeSourceURL("https://127.0.0.1/source"))
	require.Empty(t, publicMemeSourceURL("https://example.com/source?token=secret"))
}

func TestMemeRendererErrorsAreMappedWithoutLeakingCaptionsOrURLs(t *testing.T) {
	t.Parallel()

	srv := newMemeHandlerTestServer(t, nil)
	srv.provider.renderErr = &memes.ProviderError{
		Kind: memes.ErrorKindInvalidResponse, Operation: "render",
		Cause: errors.New("private caption at https://api.memegen.test/secret"),
	}
	response := srv.request(t, http.MethodPost, "/api/v1/memes/preview", map[string]any{
		"workspace_id": "ws-1", "template_id": "drake", "captions": []string{"private caption", "secret"},
	})
	require.Equal(t, http.StatusBadGateway, response.Code, response.Body.String())
	require.NotContains(t, response.Body.String(), "private caption")
	require.NotContains(t, response.Body.String(), "api.memegen.test")
}

func TestMemePreviewRejectsImagesAboveBase64ResponseLimit(t *testing.T) {
	t.Parallel()

	srv := newMemeHandlerTestServer(t, nil)
	srv.provider.renderedData = make([]byte, maxMemePreviewBytes+1)
	response := srv.request(t, http.MethodPost, "/api/v1/memes/preview", map[string]any{
		"workspace_id": "ws-1", "template_id": "drake", "captions": []string{"one", "two"},
	})
	require.Equal(t, http.StatusBadGateway, response.Code, response.Body.String())
	require.NotContains(t, response.Body.String(), base64.StdEncoding.EncodeToString(srv.provider.renderedData[:32]))
}

func TestMemeBodyLimitRejectsOversizedInputBeforeHumaDecode(t *testing.T) {
	t.Parallel()

	srv := newMemeHandlerTestServer(t, nil)
	response := srv.request(t, http.MethodPost, "/api/v1/memes/preview", map[string]any{
		"workspace_id": "ws-1", "template_id": "drake",
		"captions": []string{strings.Repeat("x", maxMemeRequestBytes), "two"},
	})
	require.Equal(t, http.StatusRequestEntityTooLarge, response.Code, response.Body.String())
	require.Empty(t, srv.provider.renderedRequests())
}

func TestMemeSuggestionsAreRateLimitedPerAuthenticatedUser(t *testing.T) {
	t.Parallel()

	srv := newMemeHandlerTestServer(t, memeSuggesterFunc(func(_ context.Context, input memegeneration.Input) (memegeneration.Result, error) {
		return memegeneration.Result{Candidates: []memegeneration.Candidate{{
			TemplateID: input.Templates[0].ID, CaptionLines: []string{"one", "two"},
			Rationale: "fit", AltText: "description",
		}}}, nil
	}))
	for attempt := 0; attempt < memeSuggestionRequestsPerMinute; attempt++ {
		response := srv.request(t, http.MethodPost, "/api/v1/memes/suggestions", map[string]any{
			"workspace_id": "ws-1", "idea": "choice", "count": 1,
		})
		require.Equal(t, http.StatusOK, response.Code, "attempt %d: %s", attempt, response.Body.String())
	}
	response := srv.request(t, http.MethodPost, "/api/v1/memes/suggestions", map[string]any{
		"workspace_id": "ws-1", "idea": "choice", "count": 1,
	})
	require.Equal(t, http.StatusTooManyRequests, response.Code, response.Body.String())
}

func mustDecodeBase64(t *testing.T, value string) []byte {
	t.Helper()
	decoded, err := base64.StdEncoding.DecodeString(value)
	require.NoError(t, err)
	return decoded
}

var _ mediastore.BlobStorage = (*memeMemoryStorage)(nil)
