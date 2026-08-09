package memes

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	defaultMemegenRequestTimeout = 12 * time.Second
	defaultMemegenRenderTimeout  = 30 * time.Second
	defaultMemegenCacheTTL       = 12 * time.Hour
	defaultMemegenStaleTTL       = 7 * 24 * time.Hour
	defaultMemegenMaxTemplates   = 1000
	defaultMemegenCatalogBytes   = 2 << 20
	defaultMemegenImageBytes     = 20 << 20
	defaultMemegenMaxRedirects   = 3
	memegenRefreshRetryDelay     = 30 * time.Second
	maxMemegenCaptionRunes       = 200
	maxMemegenTextSegmentBytes   = 200
	maxMemegenSearchRunes        = 120
	maxMemegenSearchResults      = 250
	maxMemegenJSONResponseBytes  = 64 << 10
)

var (
	memegenTemplateIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)
	memegenFontPattern       = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
)

type memegenCache struct {
	templates  []Template
	byID       map[string]Template
	fetchedAt  time.Time
	lastTryAt  time.Time
	lastTryErr error
}

type memegenRefreshResult struct {
	templates   []Template
	refreshedAt time.Time
	err         error
}

// MemegenProvider wraps the supported Memegen API surface. It never returns
// the caption-bearing canonical render URL to callers.
type MemegenProvider struct {
	baseURL           *url.URL
	apiKey            string
	configured        bool
	apiClient         *http.Client
	renderAPIClient   *http.Client
	renderClient      *http.Client
	requestTimeout    time.Duration
	renderTimeout     time.Duration
	cacheTTL          time.Duration
	staleTTL          time.Duration
	maxTemplates      int
	maxCatalogBytes   int64
	maxImageBytes     int64
	maxRedirects      int
	allowedRenderHost map[string]struct{}

	cacheMu sync.RWMutex
	cache   memegenCache
	refresh chan struct{}
	now     func() time.Time
}

func NewMemegenProvider(config MemegenConfig) (*MemegenProvider, error) {
	applyMemegenDefaults(&config)
	provider := &MemegenProvider{
		apiKey:          strings.TrimSpace(config.APIKey),
		requestTimeout:  config.RequestTimeout,
		renderTimeout:   config.RenderTimeout,
		cacheTTL:        config.CacheTTL,
		staleTTL:        config.StaleTTL,
		maxTemplates:    config.MaxTemplates,
		maxCatalogBytes: config.MaxCatalogBytes,
		maxImageBytes:   config.MaxImageBytes,
		maxRedirects:    config.MaxRedirects,
		refresh:         make(chan struct{}, 1),
		now:             time.Now,
	}
	if strings.TrimSpace(config.BaseURL) == "" {
		return provider, nil
	}

	baseURL, err := parseMemegenBaseURL(config.BaseURL)
	if err != nil {
		return nil, err
	}
	provider.baseURL = baseURL
	provider.allowedRenderHost, err = renderHostAllowlist(baseURL, config.AllowedRenderHosts)
	if err != nil {
		return nil, err
	}
	provider.configured = true

	provider.apiClient = cloneHTTPClient(config.Client, config.RequestTimeout)
	provider.apiClient.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	provider.renderAPIClient = cloneHTTPClient(config.Client, config.RenderTimeout)
	provider.renderAPIClient.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	provider.renderClient = cloneHTTPClient(config.Client, config.RenderTimeout)
	provider.renderClient.CheckRedirect = provider.checkRenderRedirect
	return provider, nil
}

func applyMemegenDefaults(config *MemegenConfig) {
	if config.RequestTimeout <= 0 {
		config.RequestTimeout = defaultMemegenRequestTimeout
	}
	if config.RenderTimeout <= 0 {
		config.RenderTimeout = defaultMemegenRenderTimeout
	}
	if config.CacheTTL <= 0 {
		config.CacheTTL = defaultMemegenCacheTTL
	}
	if config.StaleTTL <= 0 {
		config.StaleTTL = defaultMemegenStaleTTL
	}
	if config.MaxTemplates <= 0 {
		config.MaxTemplates = defaultMemegenMaxTemplates
	}
	if config.MaxCatalogBytes <= 0 {
		config.MaxCatalogBytes = defaultMemegenCatalogBytes
	}
	if config.MaxImageBytes <= 0 {
		config.MaxImageBytes = defaultMemegenImageBytes
	}
	if config.MaxRedirects <= 0 {
		config.MaxRedirects = defaultMemegenMaxRedirects
	}
}

func parseMemegenBaseURL(value string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, errors.New("memegen base URL must be an absolute HTTP or HTTPS URL")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("memegen base URL must not contain credentials, a query, or a fragment")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawPath = ""
	parsed.Host = strings.ToLower(parsed.Host)
	return parsed, nil
}

func renderHostAllowlist(baseURL *url.URL, configured []string) (map[string]struct{}, error) {
	allowed := map[string]struct{}{strings.ToLower(baseURL.Host): {}}
	for _, value := range configured {
		value = strings.ToLower(strings.TrimSpace(value))
		probe, err := url.Parse("//" + value)
		if value == "" || err != nil || probe.Host != value || probe.Hostname() == "" || probe.User != nil ||
			strings.ContainsAny(value, "/?#@") {
			return nil, errors.New("memegen render host allowlist entries must be host[:port]")
		}
		allowed[value] = struct{}{}
	}
	return allowed, nil
}

func cloneHTTPClient(source *http.Client, timeout time.Duration) *http.Client {
	if source == nil {
		return &http.Client{Timeout: timeout}
	}
	clone := *source
	clone.Timeout = timeout
	return &clone
}

func (p *MemegenProvider) Key() string { return MemegenProviderKey }

func (p *MemegenProvider) Available() bool { return p != nil && p.configured }

func (p *MemegenProvider) Health(ctx context.Context) (Health, error) {
	health := Health{Available: p.Available()}
	if !p.Available() {
		return health, providerError(ErrorKindDisabled, "health", 0, 0, nil)
	}
	catalog, err := p.Templates(ctx)
	if err != nil {
		p.cacheMu.RLock()
		health.CatalogCached = len(p.cache.templates) > 0
		health.TemplateCount = len(p.cache.templates)
		health.RefreshedAt = p.cache.fetchedAt
		p.cacheMu.RUnlock()
		return health, err
	}
	health.Ready = len(catalog.Templates) > 0
	health.CatalogCached = health.Ready
	health.CatalogStale = catalog.Stale
	health.TemplateCount = len(catalog.Templates)
	health.RefreshedAt = catalog.RefreshedAt
	return health, nil
}

func (p *MemegenProvider) Templates(ctx context.Context) (Catalog, error) {
	if !p.Available() {
		return Catalog{}, providerError(ErrorKindDisabled, "catalog", 0, 0, nil)
	}
	now := p.now()
	if catalog, ok := p.cachedCatalog(now, p.cacheTTL); ok {
		return catalog, nil
	}

	select {
	case p.refresh <- struct{}{}:
	case <-ctx.Done():
		return Catalog{}, providerError(ErrorKindUnavailable, "catalog", 0, 0, ctx.Err())
	}
	releaseRefresh := true
	defer func() {
		if releaseRefresh {
			<-p.refresh
		}
	}()

	now = p.now()
	if catalog, ok := p.cachedCatalog(now, p.cacheTTL); ok {
		return catalog, nil
	}
	if catalog, ok, err := p.recentRefreshFailure(now); ok {
		if len(catalog.Templates) > 0 {
			catalog.Stale = true
			return catalog, nil
		}
		return Catalog{}, err
	}

	result := make(chan memegenRefreshResult, 1)
	refreshCtx := context.WithoutCancel(ctx)
	go p.refreshTemplates(refreshCtx, now, result)
	releaseRefresh = false

	select {
	case <-ctx.Done():
		return Catalog{}, providerError(ErrorKindUnavailable, "catalog", 0, 0, ctx.Err())
	case refreshed := <-result:
		if refreshed.err == nil {
			return Catalog{Templates: cloneTemplates(refreshed.templates), RefreshedAt: refreshed.refreshedAt}, nil
		}
		if catalog, ok := p.cachedCatalog(refreshed.refreshedAt, p.staleTTL); ok {
			catalog.Stale = true
			return catalog, nil
		}
		return Catalog{}, refreshed.err
	}
}

// refreshTemplates is owned by the provider rather than the browser request
// that won the refresh lock. fetchTemplates still applies requestTimeout, so a
// canceled caller can return promptly without canceling or globally poisoning
// the one bounded refresh shared by other callers.
func (p *MemegenProvider) refreshTemplates(ctx context.Context, attemptedAt time.Time, result chan<- memegenRefreshResult) {
	defer func() { <-p.refresh }()
	templates, err := p.fetchTemplates(ctx)

	p.cacheMu.Lock()
	p.cache.lastTryAt = attemptedAt
	p.cache.lastTryErr = err
	if err == nil {
		byID := make(map[string]Template, len(templates))
		for _, template := range templates {
			byID[template.ID] = cloneTemplate(template)
		}
		p.cache.templates = cloneTemplates(templates)
		p.cache.byID = byID
		p.cache.fetchedAt = attemptedAt
		p.cache.lastTryErr = nil
	}
	p.cacheMu.Unlock()

	result <- memegenRefreshResult{templates: templates, refreshedAt: attemptedAt, err: err}
}

func (p *MemegenProvider) TemplateImage(ctx context.Context, templateID string) (RenderedImage, error) {
	if !p.Available() {
		return RenderedImage{}, providerError(ErrorKindUnavailable, "thumbnail", 0, 0, nil)
	}
	templateID = strings.TrimSpace(templateID)
	if !memegenTemplateIDPattern.MatchString(templateID) {
		return RenderedImage{}, providerError(ErrorKindInvalidRequest, "thumbnail", 0, 0, nil)
	}
	catalog, err := p.Templates(ctx)
	if err != nil {
		return RenderedImage{}, err
	}
	var template Template
	for _, candidate := range catalog.Templates {
		if candidate.ID == templateID {
			template = candidate
			break
		}
	}
	if template.ID == "" {
		return RenderedImage{}, providerError(ErrorKindNotFound, "thumbnail", http.StatusNotFound, 0, nil)
	}
	blankURL, err := url.Parse(template.BlankURL)
	if err != nil || !p.isAllowedRenderURL(blankURL) {
		return RenderedImage{}, providerError(ErrorKindUnsafeResponseURL, "thumbnail", 0, 0, nil)
	}
	extension := strings.TrimPrefix(strings.ToLower(path.Ext(blankURL.Path)), ".")
	if extension == "jpeg" {
		extension = "jpg"
	}
	if _, ok := mimeTypeForExtension(extension); !ok {
		return RenderedImage{}, providerError(ErrorKindInvalidResponse, "thumbnail", 0, 0, nil)
	}
	requestCtx, cancel := context.WithTimeout(ctx, p.renderTimeout)
	defer cancel()
	data, mimeType, err := p.downloadRender(requestCtx, blankURL, extension)
	if err != nil {
		return RenderedImage{}, err
	}
	return RenderedImage{
		Data: data, MIMEType: mimeType, Extension: extension, TemplateID: template.ID,
	}, nil
}

func (p *MemegenProvider) cachedCatalog(now time.Time, maximumAge time.Duration) (Catalog, bool) {
	p.cacheMu.RLock()
	defer p.cacheMu.RUnlock()
	if len(p.cache.templates) == 0 || p.cache.fetchedAt.IsZero() {
		return Catalog{}, false
	}
	age := now.Sub(p.cache.fetchedAt)
	if age > maximumAge {
		return Catalog{}, false
	}
	return Catalog{
		Templates:   cloneTemplates(p.cache.templates),
		RefreshedAt: p.cache.fetchedAt,
		Stale:       age > p.cacheTTL,
	}, true
}

func (p *MemegenProvider) recentRefreshFailure(now time.Time) (Catalog, bool, error) {
	p.cacheMu.RLock()
	defer p.cacheMu.RUnlock()
	if p.cache.lastTryErr == nil || p.cache.lastTryAt.IsZero() || now.Sub(p.cache.lastTryAt) >= memegenRefreshRetryDelay {
		return Catalog{}, false, nil
	}
	catalog := Catalog{
		Templates:   cloneTemplates(p.cache.templates),
		RefreshedAt: p.cache.fetchedAt,
		Stale:       true,
	}
	if !p.cache.fetchedAt.IsZero() && now.Sub(p.cache.fetchedAt) > p.staleTTL {
		catalog = Catalog{}
	}
	return catalog, true, p.cache.lastTryErr
}

func (p *MemegenProvider) Search(ctx context.Context, query string, limit int) (Catalog, error) {
	if utf8.RuneCountInString(query) > maxMemegenSearchRunes {
		return Catalog{}, providerError(ErrorKindInvalidRequest, "search", 0, 0, nil)
	}
	if limit <= 0 {
		limit = 40
	}
	if limit > maxMemegenSearchResults {
		limit = maxMemegenSearchResults
	}
	catalog, err := p.Templates(ctx)
	if err != nil {
		return Catalog{}, err
	}
	catalog.Templates = searchTemplates(catalog.Templates, query, limit)
	return catalog, nil
}

func (p *MemegenProvider) fetchTemplates(ctx context.Context) ([]Template, error) {
	requestCtx, cancel := context.WithTimeout(ctx, p.requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, p.endpoint("templates"), nil)
	if err != nil {
		return nil, providerError(ErrorKindInvalidRequest, "catalog", 0, 0, nil)
	}
	p.setAPIHeaders(req, "application/json")
	resp, err := p.apiClient.Do(req)
	if err != nil {
		return nil, p.requestFailure(requestCtx, "catalog", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		drainResponse(resp.Body)
		return nil, statusProviderError("catalog", resp)
	}
	if !isJSONContentType(resp.Header.Get("Content-Type")) {
		return nil, providerError(ErrorKindInvalidResponse, "catalog", resp.StatusCode, 0, nil)
	}
	payload, err := readBounded(resp.Body, p.maxCatalogBytes, "catalog")
	if err != nil {
		return nil, err
	}
	var raw []memegenTemplateResponse
	if err := decodeSingleJSON(payload, &raw); err != nil {
		return nil, providerError(ErrorKindInvalidResponse, "catalog", resp.StatusCode, 0, nil)
	}
	return normalizeTemplates(raw, p.maxTemplates)
}

func (p *MemegenProvider) Render(ctx context.Context, request RenderRequest) (RenderedImage, error) {
	template, normalized, err := p.validateRenderRequest(ctx, request)
	if err != nil {
		return RenderedImage{}, err
	}
	body := memegenRenderRequest{
		TemplateID: template.ID,
		Text:       append([]string(nil), normalized.Text...),
		Extension:  normalized.Extension,
		Layout:     normalized.Layout,
		Font:       normalized.Font,
		Redirect:   false,
	}
	if len(normalized.OverlayURLs) > 0 {
		body.Style = append([]string(nil), normalized.OverlayURLs...)
	} else {
		body.Style = append([]string(nil), normalized.Styles...)
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return RenderedImage{}, providerError(ErrorKindInvalidRequest, "render", 0, 0, nil)
	}

	requestCtx, cancel := context.WithTimeout(ctx, p.renderTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodPost, p.endpoint("images"), bytes.NewReader(payload))
	if err != nil {
		return RenderedImage{}, providerError(ErrorKindInvalidRequest, "render", 0, 0, nil)
	}
	p.setAPIHeaders(req, "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.renderAPIClient.Do(req)
	if err != nil {
		return RenderedImage{}, p.requestFailure(requestCtx, "render", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		drainResponse(resp.Body)
		return RenderedImage{}, statusProviderError("render", resp)
	}
	if !isJSONContentType(resp.Header.Get("Content-Type")) {
		return RenderedImage{}, providerError(ErrorKindInvalidResponse, "render", resp.StatusCode, 0, nil)
	}
	responsePayload, err := readBounded(resp.Body, maxMemegenJSONResponseBytes, "render")
	if err != nil {
		return RenderedImage{}, err
	}
	var renderResponse struct {
		URL string `json:"url"`
	}
	if err := decodeSingleJSON(responsePayload, &renderResponse); err != nil || strings.TrimSpace(renderResponse.URL) == "" {
		return RenderedImage{}, providerError(ErrorKindInvalidResponse, "render", resp.StatusCode, 0, nil)
	}
	renderURL, err := url.Parse(renderResponse.URL)
	if err != nil || !p.isAllowedRenderURL(renderURL) {
		return RenderedImage{}, providerError(ErrorKindUnsafeResponseURL, "download", 0, 0, nil)
	}
	data, mimeType, err := p.downloadRender(requestCtx, renderURL, normalized.Extension)
	if err != nil {
		return RenderedImage{}, err
	}
	return RenderedImage{
		Data: data, MIMEType: mimeType, Extension: normalized.Extension, TemplateID: template.ID,
	}, nil
}

func (p *MemegenProvider) validateRenderRequest(ctx context.Context, request RenderRequest) (Template, RenderRequest, error) {
	if !p.Available() {
		return Template{}, request, providerError(ErrorKindDisabled, "render", 0, 0, nil)
	}
	if request.TemplateID != strings.TrimSpace(request.TemplateID) || !memegenTemplateIDPattern.MatchString(request.TemplateID) {
		return Template{}, request, invalidRenderRequest()
	}
	catalog, err := p.Templates(ctx)
	if err != nil {
		return Template{}, request, err
	}
	template := findTemplate(catalog.Templates, request.TemplateID)
	if template.ID == "" {
		return Template{}, request, providerError(ErrorKindNotFound, "render", http.StatusNotFound, 0, nil)
	}
	if err := validateCaptions(request.Text, template.Lines); err != nil {
		return Template{}, request, err
	}
	if err := validateNamedStyles(request.Styles, template.Styles); err != nil {
		return Template{}, request, err
	}
	if err := normalizeOverlayURLs(&request, template); err != nil {
		return Template{}, request, err
	}
	if err := normalizeRenderOptions(&request); err != nil {
		return Template{}, request, err
	}
	return template, request, nil
}

func findTemplate(templates []Template, id string) Template {
	for _, template := range templates {
		if template.ID == id {
			return template
		}
	}
	return Template{}
}

func validateCaptions(captions []string, maximum int) error {
	if len(captions) > maximum {
		return invalidRenderRequest()
	}
	for _, caption := range captions {
		if err := ValidateMemegenCaption(caption); err != nil {
			return invalidRenderRequest()
		}
	}
	return nil
}

// ValidateMemegenCaption enforces Memegen's canonical path-segment limit.
// The POST API accepts raw text but returns a URL whose substitutions can
// expand punctuation, so rune or raw-byte limits alone are insufficient.
func ValidateMemegenCaption(caption string) error {
	if !utf8.ValidString(caption) || utf8.RuneCountInString(caption) > maxMemegenCaptionRunes {
		return ErrInvalidRequest
	}
	decoded := caption
	if candidate, err := url.PathUnescape(caption); err == nil && utf8.ValidString(candidate) {
		decoded = candidate
	}
	for _, current := range decoded {
		if current == '\x00' || (unicode.IsControl(current) && current != '\n' && current != '\r' && current != '\t') {
			return ErrInvalidRequest
		}
	}
	if memegenEncodedTextBytes(decoded) > maxMemegenTextSegmentBytes {
		return ErrInvalidRequest
	}
	return nil
}

func memegenEncodedTextBytes(value string) int {
	for _, replacement := range [][2]string{
		{"_", "__"}, {"-", "--"}, {" ", "_"}, {"?", "~q"}, {"%", "~p"},
		{"#", "~h"}, {"\"", "''"}, {"/", "~s"}, {"\\", "~b"}, {"\n", "~n"},
		{"&", "~a"}, {"<", "~l"}, {">", "~g"}, {"‘", "'"}, {"’", "'"},
		{"“", "\""}, {"”", "\""}, {"–", "-"},
	} {
		value = strings.ReplaceAll(value, replacement[0], replacement[1])
	}
	return len(value)
}

func validateNamedStyles(requested, allowed []string) error {
	if len(requested) > 8 {
		return invalidRenderRequest()
	}
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, style := range allowed {
		allowedSet[style] = struct{}{}
	}
	for _, style := range requested {
		if _, ok := allowedSet[style]; !ok {
			return invalidRenderRequest()
		}
	}
	return nil
}

func normalizeOverlayURLs(request *RenderRequest, template Template) error {
	if len(request.OverlayURLs) > 0 && len(request.Styles) > 0 {
		return invalidRenderRequest()
	}
	if len(request.OverlayURLs) > template.Overlays {
		return invalidRenderRequest()
	}
	request.OverlayURLs = append([]string(nil), request.OverlayURLs...)
	for index, overlayURL := range request.OverlayURLs {
		normalizedURL, ok := normalizeOverlayURL(overlayURL)
		if !ok {
			return invalidRenderRequest()
		}
		request.OverlayURLs[index] = normalizedURL
	}
	return nil
}

func normalizeRenderOptions(request *RenderRequest) error {
	request.Extension = strings.ToLower(strings.TrimSpace(request.Extension))
	if request.Extension == "" {
		request.Extension = "png"
	}
	if _, ok := mimeTypeForExtension(request.Extension); !ok {
		return invalidRenderRequest()
	}
	request.Layout = strings.ToLower(strings.TrimSpace(request.Layout))
	if request.Layout != "" && request.Layout != "default" && request.Layout != "top" {
		return invalidRenderRequest()
	}
	request.Font = strings.TrimSpace(request.Font)
	if request.Font != "" && !memegenFontPattern.MatchString(request.Font) {
		return invalidRenderRequest()
	}
	return nil
}

func invalidRenderRequest() error {
	return providerError(ErrorKindInvalidRequest, "render", 0, 0, nil)
}

func (p *MemegenProvider) downloadRender(ctx context.Context, renderURL *url.URL, extension string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, renderURL.String(), nil)
	if err != nil {
		return nil, "", providerError(ErrorKindUnsafeResponseURL, "download", 0, 0, nil)
	}
	expectedMIME, _ := mimeTypeForExtension(extension)
	req.Header.Set("Accept", expectedMIME)
	req.Header.Set("User-Agent", "OpenPost/memegen")
	if p.apiKey != "" && strings.EqualFold(renderURL.Host, p.baseURL.Host) {
		req.Header.Set("X-API-KEY", p.apiKey)
	}
	resp, err := p.renderClient.Do(req)
	if err != nil {
		if errors.Is(err, ErrUnsafeResponseURL) {
			return nil, "", providerError(ErrorKindUnsafeResponseURL, "download", 0, 0, nil)
		}
		return nil, "", p.requestFailure(ctx, "download", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		drainResponse(resp.Body)
		return nil, "", statusProviderError("download", resp)
	}
	mediaType, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if err != nil || mediaType != expectedMIME {
		return nil, "", providerError(ErrorKindInvalidResponse, "download", resp.StatusCode, 0, nil)
	}
	if resp.ContentLength > p.maxImageBytes {
		return nil, "", providerError(ErrorKindResponseTooLarge, "download", resp.StatusCode, 0, nil)
	}
	data, err := readBounded(resp.Body, p.maxImageBytes, "download")
	if err != nil {
		return nil, "", err
	}
	if len(data) == 0 || http.DetectContentType(data) != expectedMIME {
		return nil, "", providerError(ErrorKindInvalidResponse, "download", resp.StatusCode, 0, nil)
	}
	return data, expectedMIME, nil
}

func (p *MemegenProvider) checkRenderRedirect(req *http.Request, via []*http.Request) error {
	if p.baseURL == nil || !strings.EqualFold(req.URL.Host, p.baseURL.Host) {
		req.Header.Del("X-API-KEY")
	}
	if len(via) >= p.maxRedirects {
		return ErrUnsafeResponseURL
	}
	if !p.isAllowedRenderURL(req.URL) {
		return ErrUnsafeResponseURL
	}
	return nil
}

func (p *MemegenProvider) isAllowedRenderURL(candidate *url.URL) bool {
	if candidate == nil || candidate.User != nil || candidate.Host == "" || candidate.RawQuery != "" && len(candidate.RawQuery) > 4096 {
		return false
	}
	if _, ok := p.allowedRenderHost[strings.ToLower(candidate.Host)]; !ok {
		return false
	}
	if candidate.Scheme == "https" {
		return true
	}
	return candidate.Scheme == "http" && p.baseURL.Scheme == "http" && strings.EqualFold(candidate.Host, p.baseURL.Host)
}

func (p *MemegenProvider) endpoint(path string) string {
	copyURL := *p.baseURL
	copyURL.Path = strings.TrimRight(copyURL.Path, "/") + "/" + strings.TrimLeft(path, "/")
	copyURL.RawPath = ""
	return copyURL.String()
}

func (p *MemegenProvider) setAPIHeaders(request *http.Request, accept string) {
	request.Header.Set("Accept", accept)
	request.Header.Set("User-Agent", "OpenPost/memegen")
	if p.apiKey != "" {
		request.Header.Set("X-API-KEY", p.apiKey)
	}
}

func (p *MemegenProvider) requestFailure(requestCtx context.Context, operation string, _ error) error {
	if requestCtx.Err() != nil {
		return providerError(ErrorKindUnavailable, operation, 0, 0, requestCtx.Err())
	}
	return providerError(ErrorKindUnavailable, operation, 0, 0, nil)
}

func providerError(kind ErrorKind, operation string, status int, retryAfter time.Duration, cause error) error {
	return &ProviderError{Kind: kind, Operation: operation, StatusCode: status, RetryAfter: retryAfter, Cause: cause}
}

func statusProviderError(operation string, response *http.Response) error {
	kind := ErrorKindUnavailable
	switch response.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		kind = ErrorKindUnauthorized
	case http.StatusTooManyRequests:
		kind = ErrorKindRateLimited
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		// Only the render endpoint receives caller-controlled template and
		// caption input. A 4xx response from catalog or download instead
		// means the upstream service or its configured route failed.
		if operation == "render" {
			kind = ErrorKindInvalidRequest
		}
	case http.StatusNotFound:
		// The render endpoint can legitimately report a template that
		// disappeared after the catalog was cached. A missing catalog route
		// or provider-issued image is not a user-facing template miss.
		if operation == "render" {
			kind = ErrorKindNotFound
		}
	case http.StatusRequestURITooLong:
		// Memegen materializes captions in its canonical image path. Some
		// deployments accept the POST and then enforce their path limit when
		// OpenPost downloads the image.
		if operation == "render" || operation == "download" {
			kind = ErrorKindInvalidRequest
		}
	}
	return providerError(kind, operation, response.StatusCode, parseRetryAfter(response.Header.Get("Retry-After")), nil)
}

func parseRetryAfter(value string) time.Duration {
	value = strings.TrimSpace(value)
	if seconds, err := strconv.Atoi(value); err == nil && seconds >= 0 {
		return time.Duration(seconds) * time.Second
	}
	if at, err := http.ParseTime(value); err == nil {
		if delay := time.Until(at); delay > 0 {
			return delay
		}
	}
	return 0
}

func readBounded(reader io.Reader, maximum int64, operation string) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, maximum+1))
	if err != nil {
		return nil, providerError(ErrorKindUnavailable, operation, 0, 0, nil)
	}
	if int64(len(data)) > maximum {
		return nil, providerError(ErrorKindResponseTooLarge, operation, 0, 0, nil)
	}
	return data, nil
}

func drainResponse(reader io.Reader) {
	_, _ = io.Copy(io.Discard, io.LimitReader(reader, 4096))
}

func isJSONContentType(value string) bool {
	mediaType, _, err := mime.ParseMediaType(value)
	return err == nil && (mediaType == "application/json" || strings.HasSuffix(mediaType, "+json"))
}

func decodeSingleJSON(payload []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("unexpected trailing JSON")
	}
	return nil
}

func mimeTypeForExtension(extension string) (string, bool) {
	switch extension {
	case "png":
		return "image/png", true
	case "jpg", "jpeg":
		return "image/jpeg", true
	case "gif":
		return "image/gif", true
	case "webp":
		return "image/webp", true
	default:
		return "", false
	}
}

func normalizeOverlayURL(value string) (string, bool) {
	if value == "" || value != strings.TrimSpace(value) || len(value) > 2048 {
		return "", false
	}
	parsed, err := url.Parse(value)
	if err != nil || !validOverlayURLShape(parsed) {
		return "", false
	}
	hostname := strings.ToLower(parsed.Hostname())
	if !validOverlayHostname(hostname) || !validOverlayPort(parsed.Port()) {
		return "", false
	}
	if address := net.ParseIP(hostname); address != nil && (!address.IsGlobalUnicast() || address.IsPrivate()) {
		return "", false
	}
	return parsed.String(), true
}

func validOverlayURLShape(parsed *url.URL) bool {
	return parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil && parsed.Fragment == ""
}

func validOverlayHostname(hostname string) bool {
	return hostname != "" && !strings.Contains(hostname, "%") && hostname != "localhost" &&
		!strings.HasSuffix(hostname, ".localhost") && !strings.HasSuffix(hostname, ".local") &&
		!strings.HasSuffix(hostname, ".internal")
}

func validOverlayPort(port string) bool {
	if port == "" {
		return true
	}
	value, err := strconv.ParseUint(port, 10, 16)
	return err == nil && value > 0
}

type memegenTemplateResponse struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Lines    int      `json:"lines"`
	Overlays int      `json:"overlays"`
	Styles   []string `json:"styles"`
	Blank    string   `json:"blank"`
	Example  struct {
		Text []string `json:"text"`
		URL  string   `json:"url"`
	} `json:"example"`
	Source   string   `json:"source"`
	Keywords []string `json:"keywords"`
}

type memegenRenderRequest struct {
	TemplateID string   `json:"template_id"`
	Style      []string `json:"style,omitempty"`
	Text       []string `json:"text"`
	Layout     string   `json:"layout,omitempty"`
	Font       string   `json:"font,omitempty"`
	Extension  string   `json:"extension"`
	Redirect   bool     `json:"redirect"`
}

func normalizeTemplates(raw []memegenTemplateResponse, maximum int) ([]Template, error) {
	byID := make(map[string]Template, len(raw))
	for _, item := range raw {
		template, err := normalizeTemplateResponse(item)
		if err != nil {
			continue
		}
		if existing, found := byID[template.ID]; found {
			template = mergeTemplate(existing, template)
		}
		byID[template.ID] = template
		if len(byID) > maximum {
			return nil, providerError(ErrorKindResponseTooLarge, "catalog", 0, 0, nil)
		}
	}
	if len(byID) == 0 {
		return nil, providerError(ErrorKindInvalidResponse, "catalog", 0, 0, nil)
	}
	return finalizeTemplates(byID), nil
}

func normalizeTemplateResponse(item memegenTemplateResponse) (Template, error) {
	id := strings.TrimSpace(item.ID)
	if !memegenTemplateIDPattern.MatchString(id) || item.Lines < 1 || item.Lines > 16 || item.Overlays < 0 || item.Overlays > 16 {
		return Template{}, providerError(ErrorKindInvalidResponse, "catalog", 0, 0, nil)
	}
	name := strings.TrimSpace(item.Name)
	if len(name) > 240 || !utf8.ValidString(name) {
		name = ""
	}
	template := Template{
		ID: id, Name: name, Lines: item.Lines, Overlays: item.Overlays,
		Styles: normalizeStringList(item.Styles, 64, 240), BlankURL: safeCatalogURL(item.Blank),
		Example:   TemplateExample{Text: normalizeOrderedStringList(item.Example.Text, 16, 500), URL: safeCatalogURL(item.Example.URL)},
		SourceURL: safeCatalogURL(item.Source), Keywords: normalizeStringList(item.Keywords, 64, 240),
	}
	return template, nil
}

func finalizeTemplates(byID map[string]Template) []Template {
	templates := make([]Template, 0, len(byID))
	for _, template := range byID {
		templates = append(templates, finalizeTemplate(template))
	}
	sort.Slice(templates, func(left, right int) bool {
		leftName := normalizeSearchValue(templates[left].Name)
		rightName := normalizeSearchValue(templates[right].Name)
		if leftName != rightName {
			return leftName < rightName
		}
		return templates[left].ID < templates[right].ID
	})
	return templates
}

func finalizeTemplate(template Template) Template {
	if template.Name == "" {
		template.Name = template.ID
	}
	template.SearchTerms, template.searchText = buildSearchMetadata(template)
	for _, style := range template.Styles {
		if style == "animated" {
			template.Animated = true
			break
		}
	}
	return template
}

func mergeTemplate(existing, incoming Template) Template {
	if existing.Name == "" {
		existing.Name = incoming.Name
	}
	if incoming.Lines > existing.Lines {
		existing.Lines = incoming.Lines
	}
	if incoming.Overlays > existing.Overlays {
		existing.Overlays = incoming.Overlays
	}
	existing.Styles = mergeStringLists(existing.Styles, incoming.Styles)
	if existing.BlankURL == "" {
		existing.BlankURL = incoming.BlankURL
	}
	if len(existing.Example.Text) == 0 {
		existing.Example.Text = incoming.Example.Text
	}
	if existing.Example.URL == "" {
		existing.Example.URL = incoming.Example.URL
	}
	if existing.SourceURL == "" {
		existing.SourceURL = incoming.SourceURL
	}
	existing.Keywords = mergeStringLists(existing.Keywords, incoming.Keywords)
	return existing
}

func normalizeStringList(values []string, maximumItems, maximumLength int) []string {
	if len(values) > maximumItems {
		values = values[:maximumItems]
	}
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || len(value) > maximumLength {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

// normalizeOrderedStringList bounds untrusted catalog strings without
// changing their semantic positions. Meme example text is ordered by caption
// slot, and repeated text can be intentional.
func normalizeOrderedStringList(values []string, maximumItems, maximumLength int) []string {
	if len(values) > maximumItems {
		values = values[:maximumItems]
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if len(value) > maximumLength || !utf8.ValidString(value) {
			value = ""
		}
		result = append(result, value)
	}
	return result
}

func mergeStringLists(left, right []string) []string {
	return normalizeStringList(append(append([]string(nil), left...), right...), 64, 500)
}

func safeCatalogURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 4096 {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || parsed.User != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	return parsed.String()
}

func cloneTemplates(source []Template) []Template {
	result := make([]Template, 0, len(source))
	for _, template := range source {
		result = append(result, cloneTemplate(template))
	}
	return result
}

func cloneTemplate(source Template) Template {
	source.Styles = append([]string(nil), source.Styles...)
	source.Keywords = append([]string(nil), source.Keywords...)
	source.SearchTerms = append([]string(nil), source.SearchTerms...)
	source.Example.Text = append([]string(nil), source.Example.Text...)
	return source
}

var _ Provider = (*MemegenProvider)(nil)
var _ TemplateImageProvider = (*MemegenProvider)(nil)
