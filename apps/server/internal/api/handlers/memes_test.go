package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"hash/crc32"
	"image"
	"image/png"
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

func (p *memeProviderStub) Key() string     { return memes.BuiltinProviderKey }
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

type memeMemoryStorage struct {
	mu             sync.Mutex
	objects        map[string][]byte
	afterFirstSave func()
	saveOnce       sync.Once
}

func (s *memeMemoryStorage) Driver() string { return "local" }
func (s *memeMemoryStorage) Save(_ context.Context, id string, reader io.Reader) (string, error) {
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
	if s.afterFirstSave != nil {
		s.saveOnce.Do(s.afterFirstSave)
	}
	return id, nil
}
func (s *memeMemoryStorage) Delete(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.objects, id)
	return nil
}
func (s *memeMemoryStorage) GetURL(id string) string {
	return "https://cdn.openpost.test/media/" + id
}
func (s *memeMemoryStorage) Open(_ context.Context, id string) (io.ReadCloser, error) {
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
		(*models.ScreenshotTemplateRecipeMediaReference)(nil),
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
					Semantic: memes.TemplateSemantic{
						Visual:  "Drake rejects the upper choice and approves the lower choice.",
						Meaning: "Reject the first option and approve the second.", Mechanism: "reject_prefer",
						CaptionRoles: []string{"rejected option", "preferred option"}, Tags: []string{"choice", "contrast"},
					},
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
	api := humaecho.NewV4WithGroup(e, group, huma.DefaultConfig("Test", "1.0.0"))
	handler := NewMemeHandler(db, testAuthenticator{}, mediaHandler, mediaHandler.publicMedia, provider, suggester)
	handler.RegisterRoutes(api)
	return &memeHandlerTestServer{
		echo: e, db: db, provider: provider, mediaHandler: mediaHandler,
		handler: handler, storage: storage,
	}
}

func validMemePNG(t *testing.T) []byte {
	t.Helper()
	var data bytes.Buffer
	require.NoError(t, png.Encode(&data, image.NewNRGBA(image.Rect(0, 0, 1, 1))))
	return data.Bytes()
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
	require.Equal(t, memes.BuiltinProviderKey, output.Body.Catalog.ProviderKey)
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
	require.Equal(t, "image/png", first.Header().Get("Content-Type"))
	require.Equal(t, validMemePNG(t), first.Body.Bytes())
	require.NotEmpty(t, first.Header().Get("ETag"))

	second := srv.request(t, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, second.Code, second.Body.String())
	require.Equal(t, []string{"drake"}, srv.provider.templateImageRequests())

	unauthenticated := srv.request(t, http.MethodGet, path, nil, "")
	require.Equal(t, http.StatusUnauthorized, unauthenticated.Code)
}

func TestMemeRenderRollsBackMediaWhenPostInsertBookkeepingFails(t *testing.T) {
	t.Parallel()

	srv := newMemeHandlerTestServer(t, nil)
	_, err := srv.db.Exec(`
		CREATE TRIGGER fail_meme_usage_insert
		BEFORE INSERT ON usage_counters
		BEGIN
			SELECT RAISE(FAIL, 'forced usage failure');
		END;
	`)
	require.NoError(t, err)
	response := srv.request(t, http.MethodPost, "/api/v1/memes/render", map[string]any{
		"workspace_id": "ws-1", "template_id": "drake", "captions": []string{"one", "two"}, "format": "png",
	})
	require.Equal(t, http.StatusInternalServerError, response.Code, response.Body.String())
	count, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("source = ?", "meme_generator").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count, "an import that fails after media insertion must not leave an attachment without a recipe")
	srv.storage.mu.Lock()
	remainingObjects := len(srv.storage.objects)
	srv.storage.mu.Unlock()
	require.Zero(t, remainingObjects, "compensation must also remove the generated image and thumbnails")
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

var _ mediastore.BlobStorage = (*memeMemoryStorage)(nil)

func TestMemeRenderRetainsGIFOverlayAndParent(t *testing.T) {
	t.Parallel()
	srv := newMemeHandlerTestServer(t, nil)
	image, err := base64.StdEncoding.DecodeString("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
	require.NoError(t, err)
	for _, id := range []string{"overlay-gif", "parent-gif"} {
		_, err = srv.db.NewInsert().Model(&models.MediaAttachment{ID: id, WorkspaceID: "ws-1", FilePath: id + ".gif", MimeType: "image/gif", ProcessingStatus: mediaReadyStatus, Size: int64(len(image)), Width: 1, Height: 1}).Exec(t.Context())
		require.NoError(t, err)
		srv.storage.objects[id+".gif"] = image
	}
	response := srv.request(t, http.MethodPost, "/api/v1/memes/render", map[string]any{"workspace_id": "ws-1", "template_id": "3hd", "captions": []string{"One", "Two", "Three"}, "overlay_media_ids": []string{"overlay-gif"}, "parent_media_id": "parent-gif", "format": "png", "retention_class": "library"})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var output RenderMemeOutput
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output.Body))
	require.Equal(t, "library", output.Body.Media.RetentionClass)
	var refs []models.ScreenshotTemplateRecipeMediaReference
	require.NoError(t, srv.db.NewSelect().Model(&refs).Where("export_media_id = ?", output.Body.Media.ID).Order("media_id ASC").Scan(t.Context()))
	require.Len(t, refs, 2)
	require.Equal(t, "overlay-gif", refs[0].MediaID)
	require.Equal(t, "parent-gif", refs[1].MediaID)
}
