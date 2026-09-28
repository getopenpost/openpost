package platform

import (
	"context"
	"errors"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/openpost/backend/internal/netguard"
)

var (
	errInvalidLinkURL    = errors.New("link URL is invalid")
	errLinkPreviewStatus = errors.New("link preview returned a non-success status")
)

var linkURLPattern = regexp.MustCompile(`https?://[^\s<>"'\]]+`)

// DetectFirstURL returns the first http(s) URL embedded in post text. Empty
// means the text carries no link card candidate.
func DetectFirstURL(text string) string {
	for _, candidate := range linkURLPattern.FindAllString(text, -1) {
		cleaned := trimURLTail(strings.TrimSpace(candidate))
		parsed, err := url.Parse(cleaned)
		if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
			continue
		}
		return cleaned
	}
	return ""
}

// trimURLTail drops trailing sentence punctuation from a URL found in text.
// A closing parenthesis is dropped only while it has no opening one in the
// URL, so ".../Go_(programming_language)" keeps its parentheses while the
// ")" that closes "(see https://example.com/x)" is not part of the link.
func trimURLTail(candidate string) string {
	for candidate != "" {
		last := candidate[len(candidate)-1]
		switch {
		case strings.IndexByte(".,;:!?]}", last) >= 0:
			candidate = candidate[:len(candidate)-1]
		case last == ')' && strings.Count(candidate, ")") > strings.Count(candidate, "("):
			candidate = candidate[:len(candidate)-1]
		default:
			return candidate
		}
	}
	return candidate
}

// EffectiveLinkURL prefers an explicit native link setting and falls back to
// the first URL detected in post text so providers can build a native card.
func EffectiveLinkURL(settings map[string]interface{}, content string) string {
	if explicit := firstNonEmptyString(settingString(settings, "url"), settingString(settings, "link_url")); explicit != "" {
		if parsed, err := url.Parse(strings.TrimSpace(explicit)); err == nil && parsed.Host != "" && (parsed.Scheme == "https" || parsed.Scheme == "http") {
			return strings.TrimSpace(explicit)
		}
	}
	return DetectFirstURL(content)
}

// LinkPreview is the SSRF-safe Open Graph metadata used for native cards.
type LinkPreview struct {
	URL         string
	Title       string
	Description string
}

// fetchLinkPreviewFunc is overridden in tests to avoid network access.
var fetchLinkPreviewFunc = FetchLinkPreview

func linkFetchPolicy() netguard.URLPolicy {
	return netguard.URLPolicy{Label: "link URL", AllowedSchemes: []string{"https", "http"}}
}

// FetchLinkPreview fetches bounded Open Graph metadata through netguard so
// DNS rebinding, private ranges, and redirects cannot receive the request.
func FetchLinkPreview(ctx context.Context, rawURL string) (LinkPreview, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Host == "" {
		return LinkPreview{}, errInvalidLinkURL
	}
	policy := linkFetchPolicy()
	if err := netguard.ValidateURL(ctx, parsed, policy); err != nil {
		return LinkPreview{}, err
	}
	fetchCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	client := netguard.NewHTTPClient(8*time.Second, policy)
	req, err := http.NewRequestWithContext(fetchCtx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return LinkPreview{}, err
	}
	req.Header.Set("Accept", "text/html")
	req.Header.Set("User-Agent", "OpenPostLinkPreview/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return LinkPreview{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return LinkPreview{}, errLinkPreviewStatus
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return LinkPreview{}, err
	}
	title, description := parseOpenGraphMetadata(string(body))
	return LinkPreview{URL: parsed.String(), Title: title, Description: description}, nil
}

func parseOpenGraphMetadata(document string) (string, string) {
	title := firstNonEmptyString(
		metaContentByProperty(document, "og:title"),
		htmlTagContent(document, "title"),
	)
	description := firstNonEmptyString(
		metaContentByProperty(document, "og:description"),
		metaContentByName(document, "description"),
	)
	// Attribute values and the title are HTML text: "Tom &amp; Jerry" and
	// "Don&#39;t" are what the page says as "Tom & Jerry" and "Don't".
	return strings.TrimSpace(html.UnescapeString(title)), strings.TrimSpace(html.UnescapeString(description))
}

// metaContentValue matches a content attribute up to its own closing quote,
// so an apostrophe inside double quotes (or a double quote inside single
// quotes) is part of the value rather than its end. The leading whitespace is
// the attribute boundary, so data-content is not read as content, and an
// unquoted value (content=Final), which HTML allows, is read too.
const metaContentValue = `\scontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>` + "`" + `]+))`

var (
	ogTitlePattern       = regexp.MustCompile(`(?i)<meta[^>]+property=["']og:title["'][^>]*` + metaContentValue)
	ogTitleReverse       = regexp.MustCompile(`(?i)<meta[^>]*` + metaContentValue + `[^>]*property=["']og:title["']`)
	ogDescriptionPattern = regexp.MustCompile(`(?i)<meta[^>]+property=["']og:description["'][^>]*` + metaContentValue)
	ogDescriptionReverse = regexp.MustCompile(`(?i)<meta[^>]*` + metaContentValue + `[^>]*property=["']og:description["']`)
	metaDescription      = regexp.MustCompile(`(?i)<meta[^>]+name=["']description["'][^>]*` + metaContentValue)
	metaDescriptionRev   = regexp.MustCompile(`(?i)<meta[^>]*` + metaContentValue + `[^>]*name=["']description["']`)
	htmlTitlePattern     = regexp.MustCompile(`(?i)<title[^>]*>([^<]+)</title>`)
)

// metaContent returns the content value of the first pattern that matches;
// the value is in whichever of the three value groups matched.
func metaContent(document string, patterns ...*regexp.Regexp) string {
	for _, pattern := range patterns {
		if match := pattern.FindStringSubmatch(document); match != nil {
			return match[1] + match[2] + match[3]
		}
	}
	return ""
}

func metaContentByProperty(document, property string) string {
	switch property {
	case "og:title":
		return metaContent(document, ogTitlePattern, ogTitleReverse)
	case "og:description":
		return metaContent(document, ogDescriptionPattern, ogDescriptionReverse)
	}
	return ""
}

func metaContentByName(document, name string) string {
	if name == "description" {
		return metaContent(document, metaDescription, metaDescriptionRev)
	}
	return ""
}

func htmlTagContent(document, tag string) string {
	if tag == "title" {
		if match := htmlTitlePattern.FindStringSubmatch(document); len(match) == 2 {
			return match[1]
		}
	}
	return ""
}

// linkedInArticleFields resolves a native article card: explicit settings win,
// then the first URL detected in post text, with SSRF-guarded OG metadata
// filling a missing title or description. OG failures leave fields empty.
func linkedInArticleFields(ctx context.Context, req *PublishRequest, articleURL string) (string, string) {
	title := settingString(req.Settings, "article_title")
	description := settingString(req.Settings, "article_description")
	if articleURL == "" || (title != "" && description != "") {
		return title, description
	}
	preview, err := fetchLinkPreviewFunc(ctx, articleURL)
	if err != nil {
		return title, description
	}
	return firstNonEmptyString(title, preview.Title), firstNonEmptyString(description, preview.Description)
}

// facebookFeedLink resolves the native feed link: explicit settings win, then
// the first URL detected in post text so Meta can scrape the card.
func facebookFeedLink(req *PublishRequest) string {
	if req == nil {
		return ""
	}
	return EffectiveLinkURL(req.Settings, req.Content)
}

// isFacebookLinkScrapeFailure reports Meta error 1609005: the link cannot be
// scraped, so the post must be retried text-only without the card.
func isFacebookLinkScrapeFailure(err error) bool {
	if err == nil {
		return false
	}
	var httpErr *HTTPError
	if errors.As(err, &httpErr) {
		if strings.Contains(httpErr.Code, "1609005") || strings.Contains(httpErr.Subcode, "1609005") {
			return true
		}
	}
	return strings.Contains(err.Error(), "1609005")
}
