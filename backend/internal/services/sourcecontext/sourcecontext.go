// Package sourcecontext loads bounded public web pages for use as source material.
package sourcecontext

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	readability "codeberg.org/readeck/go-readability/v2"
	"github.com/openpost/backend/internal/netguard"
	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"
)

const (
	DefaultTimeout           = 10 * time.Second
	DefaultMaxResponseBytes  = int64(1 << 20)
	DefaultMaxTextCharacters = 30_000
	DefaultMaxRedirects      = 5

	defaultUserAgent   = "OpenPost/1.0"
	maxURLCharacters   = 8_192
	maxTitleCharacters = 300
	maxHTMLNodes       = 100_000
	maxTimeout         = 30 * time.Second
	maxResponseBytes   = int64(8 << 20)
	maxTextCharacters  = 200_000
	maxRedirects       = 10
	maxUserAgentLength = 512
)

var (
	ErrInvalidConfig          = errors.New("source loader configuration is invalid")
	ErrInvalidURL             = errors.New("source URL is invalid")
	ErrCredentialsNotAllowed  = errors.New("source URL credentials are not allowed")
	ErrCustomPortNotAllowed   = errors.New("source URL custom ports are not allowed")
	ErrURLNotPublic           = errors.New("source URL must use a public HTTP or HTTPS address")
	ErrTooManyRedirects       = errors.New("source URL redirected too many times")
	ErrFetchFailed            = errors.New("source could not be fetched")
	ErrTimeout                = errors.New("source request timed out")
	ErrHTTPStatus             = errors.New("source returned an unsuccessful HTTP status")
	ErrUnsupportedContentType = errors.New("source must be HTML or plain text")
	ErrResponseTooLarge       = errors.New("source response is too large")
	ErrUnreadable             = errors.New("source text could not be extracted")
)

// Loader is the source URL boundary used by the publication builder.
type Loader interface {
	Load(context.Context, string) (Document, error)
}

// Config bounds network and parsing work. Zero values select safe defaults.
type Config struct {
	Timeout           time.Duration
	MaxResponseBytes  int64
	MaxTextCharacters int
	MaxRedirects      int
	UserAgent         string
}

// Document is normalized source material from one public URL.
type Document struct {
	Title        string
	CanonicalURL string
	Text         string
	ContentType  string
	Truncated    bool
}

// URLLoader loads public HTML and plain-text documents through a guarded client.
type URLLoader struct {
	client            *http.Client
	policy            netguard.URLPolicy
	timeout           time.Duration
	maxResponseBytes  int64
	maxTextCharacters int
	maxRedirects      int
	userAgent         string
}

// New returns a loader that rejects private addresses at validation, redirect,
// and dial time. It never uses environment proxies or caller credentials.
func New(config Config) (*URLLoader, error) {
	return newURLLoader(config, nil, nil)
}

func newURLLoader(
	config Config,
	resolver netguard.Resolver,
	transport http.RoundTripper,
) (*URLLoader, error) {
	normalized, err := normalizeConfig(config)
	if err != nil {
		return nil, err
	}
	policy := netguard.URLPolicy{
		Label:            "source URL",
		AllowedSchemes:   []string{"http", "https"},
		AllowCustomPorts: false,
		Resolver:         resolver,
	}

	loader := &URLLoader{
		policy:            policy,
		timeout:           normalized.Timeout,
		maxResponseBytes:  normalized.MaxResponseBytes,
		maxTextCharacters: normalized.MaxTextCharacters,
		maxRedirects:      normalized.MaxRedirects,
		userAgent:         normalized.UserAgent,
	}
	if transport == nil {
		loader.client = netguard.NewHTTPClient(normalized.Timeout, policy)
	} else {
		loader.client = &http.Client{Timeout: normalized.Timeout, Transport: transport}
	}
	loader.client.CheckRedirect = loader.checkRedirect
	return loader, nil
}

func normalizeConfig(config Config) (Config, error) {
	if config.Timeout < 0 || config.MaxResponseBytes < 0 ||
		config.MaxTextCharacters < 0 || config.MaxRedirects < 0 {
		return Config{}, ErrInvalidConfig
	}
	if config.Timeout == 0 {
		config.Timeout = DefaultTimeout
	}
	if config.MaxResponseBytes == 0 {
		config.MaxResponseBytes = DefaultMaxResponseBytes
	}
	if config.MaxTextCharacters == 0 {
		config.MaxTextCharacters = DefaultMaxTextCharacters
	}
	if config.MaxRedirects == 0 {
		config.MaxRedirects = DefaultMaxRedirects
	}
	config.UserAgent = strings.TrimSpace(config.UserAgent)
	if config.UserAgent == "" {
		config.UserAgent = defaultUserAgent
	}
	if config.Timeout > maxTimeout || config.MaxResponseBytes > maxResponseBytes ||
		config.MaxTextCharacters > maxTextCharacters || config.MaxRedirects > maxRedirects ||
		utf8.RuneCountInString(config.UserAgent) > maxUserAgentLength ||
		strings.ContainsAny(config.UserAgent, "\r\n") {
		return Config{}, ErrInvalidConfig
	}
	return config, nil
}

// Load fetches and extracts one public source URL.
func (loader *URLLoader) Load(ctx context.Context, rawURL string) (Document, error) {
	if loader == nil || loader.client == nil {
		return Document{}, ErrInvalidConfig
	}
	loadContext, cancel := context.WithTimeout(ctx, loader.timeout)
	defer cancel()
	remote, err := loader.parseAndValidateURL(loadContext, rawURL)
	if err != nil {
		return Document{}, err
	}

	request, err := http.NewRequestWithContext(loadContext, http.MethodGet, remote.String(), nil)
	if err != nil {
		return Document{}, ErrInvalidURL
	}
	request.Header.Set("Accept", "text/html, text/plain;q=0.9")
	request.Header.Set("User-Agent", loader.userAgent)

	response, err := loader.client.Do(request)
	if err != nil {
		return Document{}, safeRequestError(loadContext, err)
	}
	defer response.Body.Close()

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return Document{}, ErrHTTPStatus
	}
	if response.ContentLength > loader.maxResponseBytes {
		return Document{}, ErrResponseTooLarge
	}

	contentTypeHeader := response.Header.Get("Content-Type")
	contentType, _, err := mime.ParseMediaType(contentTypeHeader)
	if err != nil {
		return Document{}, ErrUnsupportedContentType
	}
	contentType = strings.ToLower(contentType)
	if contentType != "text/html" && contentType != "text/plain" {
		return Document{}, ErrUnsupportedContentType
	}

	body, err := readBounded(response.Body, loader.maxResponseBytes)
	if err != nil {
		if !errors.Is(err, ErrResponseTooLarge) {
			err = safeRequestError(loadContext, err)
		}
		return Document{}, err
	}
	decoded, err := decodeText(body, contentTypeHeader, loader.maxResponseBytes)
	if err != nil {
		return Document{}, ErrUnreadable
	}

	finalURL := remote
	if response.Request != nil && response.Request.URL != nil {
		finalURL = response.Request.URL
	}
	if err := loader.validateURL(loadContext, finalURL); err != nil {
		return Document{}, err
	}
	finalURL = normalizeURL(finalURL)

	document := Document{CanonicalURL: finalURL.String(), ContentType: contentType}
	if contentType == "text/plain" {
		document.Text = normalizeText(string(decoded))
		document.Title = firstTextLine(document.Text)
	} else {
		document.Title, document.CanonicalURL, document.Text, err = loader.extractHTML(
			loadContext,
			decoded,
			finalURL,
		)
		if err != nil {
			return Document{}, err
		}
	}
	if document.Text == "" {
		return Document{}, ErrUnreadable
	}
	document.Title, _ = truncateCharacters(normalizeInlineText(document.Title), maxTitleCharacters)
	document.Text, document.Truncated = truncateCharacters(document.Text, loader.maxTextCharacters)
	return document, nil
}

func (loader *URLLoader) checkRedirect(request *http.Request, via []*http.Request) error {
	if len(via) > loader.maxRedirects {
		return ErrTooManyRedirects
	}
	request.Header.Del("Authorization")
	request.Header.Del("Cookie")
	request.Header.Del("Proxy-Authorization")
	request.Header.Del("Referer")
	return loader.validateURL(request.Context(), request.URL)
}

func (loader *URLLoader) parseAndValidateURL(ctx context.Context, rawURL string) (*url.URL, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" || utf8.RuneCountInString(rawURL) > maxURLCharacters {
		return nil, ErrInvalidURL
	}
	remote, err := url.Parse(rawURL)
	if err != nil || !remote.IsAbs() || remote.Opaque != "" || remote.Hostname() == "" {
		return nil, ErrInvalidURL
	}
	remote = normalizeURL(remote)
	if err := loader.validateURL(ctx, remote); err != nil {
		return nil, err
	}
	return remote, nil
}

func (loader *URLLoader) validateURL(ctx context.Context, remote *url.URL) error {
	if remote == nil || remote.User != nil {
		if remote != nil && remote.User != nil {
			return ErrCredentialsNotAllowed
		}
		return ErrInvalidURL
	}
	if hasCustomPort(remote) {
		return ErrCustomPortNotAllowed
	}
	if err := netguard.ValidateURL(ctx, remote, loader.policy); err != nil {
		if contextErr := safeContextError(ctx); contextErr != nil {
			return contextErr
		}
		return ErrURLNotPublic
	}
	return nil
}

func hasCustomPort(remote *url.URL) bool {
	port := remote.Port()
	if port == "" {
		return false
	}
	return (remote.Scheme == "http" && port != "80") ||
		(remote.Scheme == "https" && port != "443")
}

func safeRequestError(ctx context.Context, err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
		return context.Canceled
	}
	for _, safe := range []error{
		ErrCredentialsNotAllowed,
		ErrCustomPortNotAllowed,
		ErrURLNotPublic,
		ErrTooManyRedirects,
	} {
		if errors.Is(err, safe) {
			return safe
		}
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return ErrTimeout
	}
	var networkError net.Error
	if errors.As(err, &networkError) && networkError.Timeout() {
		return ErrTimeout
	}
	return ErrFetchFailed
}

func safeContextError(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return context.Canceled
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return ErrTimeout
	}
	return nil
}

func readBounded(reader io.Reader, limit int64) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		return nil, ErrResponseTooLarge
	}
	return body, nil
}

func decodeText(data []byte, contentType string, maxResponseBytes int64) ([]byte, error) {
	reader, err := charset.NewReader(bytes.NewReader(data), contentType)
	if err != nil {
		return nil, err
	}
	maxDecodedBytes := maxResponseBytes * 4
	if maxDecodedBytes < maxResponseBytes {
		maxDecodedBytes = maxResponseBytes
	}
	decoded, err := io.ReadAll(io.LimitReader(reader, maxDecodedBytes+1))
	if err != nil || int64(len(decoded)) > maxDecodedBytes {
		return nil, ErrUnreadable
	}
	return decoded, nil
}

func (loader *URLLoader) extractHTML(
	ctx context.Context,
	body []byte,
	pageURL *url.URL,
) (string, string, string, error) {
	fallbackTitle, canonicalURL := inspectHTML(body, pageURL)
	if canonicalURL != nil {
		if err := loader.validateURL(ctx, canonicalURL); err != nil {
			if contextErr := safeContextError(ctx); contextErr != nil {
				return "", "", "", contextErr
			}
			canonicalURL = nil
		}
	}
	canonical := pageURL.String()
	if canonicalURL != nil {
		canonical = normalizeURL(canonicalURL).String()
	}

	parser := readability.NewParser()
	parser.MaxElemsToParse = maxHTMLNodes
	article, err := parser.Parse(bytes.NewReader(body), pageURL)
	if contextErr := safeContextError(ctx); contextErr != nil {
		return "", "", "", contextErr
	}
	if err == nil && article.Node != nil {
		var rendered strings.Builder
		if renderErr := article.RenderText(&rendered); renderErr == nil {
			text := normalizeText(rendered.String())
			if text != "" {
				title := article.Title()
				if strings.TrimSpace(title) == "" {
					title = fallbackTitle
				}
				return title, canonical, text, nil
			}
		}
	}
	text := fallbackHTMLText(body)
	if contextErr := safeContextError(ctx); contextErr != nil {
		return "", "", "", contextErr
	}
	return fallbackTitle, canonical, text, nil
}

func inspectHTML(body []byte, pageURL *url.URL) (string, *url.URL) {
	document, err := html.Parse(bytes.NewReader(body))
	if err != nil {
		return "", nil
	}
	var title string
	var canonical *url.URL
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode {
			switch strings.ToLower(node.Data) {
			case "title":
				if title == "" {
					title = nodeText(node)
				}
			case "link":
				if canonical == nil && hasRel(node, "canonical") {
					if href := attribute(node, "href"); href != "" && utf8.RuneCountInString(href) <= maxURLCharacters {
						if parsed, parseErr := url.Parse(href); parseErr == nil {
							canonical = pageURL.ResolveReference(parsed)
						}
					}
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(document)
	return normalizeInlineText(title), canonical
}

func fallbackHTMLText(body []byte) string {
	document, err := html.Parse(bytes.NewReader(body))
	if err != nil {
		return ""
	}
	var output strings.Builder
	var walk func(*html.Node, bool)
	walk = func(node *html.Node, skipped bool) {
		if node.Type == html.ElementNode && isSkippedElement(node.Data) {
			skipped = true
		}
		if skipped {
			return
		}
		if node.Type == html.TextNode {
			output.WriteString(node.Data)
			output.WriteByte(' ')
		}
		if node.Type == html.ElementNode && isBlockElement(node.Data) {
			output.WriteByte('\n')
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child, skipped)
		}
		if node.Type == html.ElementNode && isBlockElement(node.Data) {
			output.WriteByte('\n')
		}
	}
	walk(document, false)
	return normalizeText(output.String())
}

func isSkippedElement(name string) bool {
	switch strings.ToLower(name) {
	case "head", "script", "style", "noscript", "template", "svg", "canvas", "nav", "aside", "header", "footer", "form", "button":
		return true
	default:
		return false
	}
}

func isBlockElement(name string) bool {
	switch strings.ToLower(name) {
	case "address", "article", "blockquote", "br", "div", "dl", "fieldset", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "main", "ol", "p", "pre", "section", "table", "tr", "ul":
		return true
	default:
		return false
	}
}

func nodeText(node *html.Node) string {
	var output strings.Builder
	var walk func(*html.Node)
	walk = func(candidate *html.Node) {
		if candidate.Type == html.TextNode {
			output.WriteString(candidate.Data)
			output.WriteByte(' ')
		}
		for child := candidate.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(node)
	return normalizeInlineText(output.String())
}

func hasRel(node *html.Node, expected string) bool {
	for _, rel := range strings.Fields(strings.ToLower(attribute(node, "rel"))) {
		if rel == expected {
			return true
		}
	}
	return false
}

func attribute(node *html.Node, name string) string {
	for _, attr := range node.Attr {
		if strings.EqualFold(attr.Key, name) {
			return strings.TrimSpace(attr.Val)
		}
	}
	return ""
}

func normalizeURL(remote *url.URL) *url.URL {
	if remote == nil {
		return nil
	}
	normalized := *remote
	normalized.Scheme = strings.ToLower(normalized.Scheme)
	normalized.Fragment = ""
	hostname := strings.ToLower(normalized.Hostname())
	port := normalized.Port()
	if (normalized.Scheme == "http" && port == "80") ||
		(normalized.Scheme == "https" && port == "443") {
		port = ""
	}
	if strings.Contains(hostname, ":") && port == "" {
		normalized.Host = "[" + hostname + "]"
	} else if port != "" {
		normalized.Host = net.JoinHostPort(hostname, port)
	} else {
		normalized.Host = hostname
	}
	if normalized.Path == "" {
		normalized.Path = "/"
	}
	return &normalized
}

func normalizeInlineText(text string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
}

func normalizeText(text string) string {
	text = strings.TrimPrefix(text, "\ufeff")
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	lines := strings.Split(text, "\n")
	clean := make([]string, 0, len(lines))
	blank := false
	for _, line := range lines {
		line = normalizeInlineText(line)
		if line == "" {
			if len(clean) > 0 {
				blank = true
			}
			continue
		}
		if blank && len(clean) > 0 && clean[len(clean)-1] != "" {
			clean = append(clean, "")
		}
		clean = append(clean, line)
		blank = false
	}
	return strings.TrimSpace(strings.Join(clean, "\n"))
}

func firstTextLine(text string) string {
	for _, line := range strings.Split(text, "\n") {
		if line = normalizeInlineText(line); line != "" {
			return line
		}
	}
	return ""
}

func truncateCharacters(text string, limit int) (string, bool) {
	if limit <= 0 || utf8.RuneCountInString(text) <= limit {
		return text, false
	}
	runes := []rune(text)
	return strings.TrimSpace(string(runes[:limit])), true
}
