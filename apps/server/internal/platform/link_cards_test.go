package platform

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDetectFirstURL(t *testing.T) {
	require.Equal(t, "https://example.com/post", DetectFirstURL("Read https://example.com/post today"))
	require.Equal(t, "https://example.com/a", DetectFirstURL("https://example.com/a and https://example.com/b"))
	require.Equal(t, "https://example.com/trim", DetectFirstURL("See https://example.com/trim."))
	require.Equal(t, "", DetectFirstURL("no links here"))
	require.Equal(t, "", DetectFirstURL("ftp://example.com/file"))
}

func TestDetectFirstURLKeepsBalancedParentheses(t *testing.T) {
	require.Equal(t, "https://en.wikipedia.org/wiki/Go_(programming_language)",
		DetectFirstURL("Read https://en.wikipedia.org/wiki/Go_(programming_language) today"))
	require.Equal(t, "https://en.wikipedia.org/wiki/Go_(programming_language)",
		DetectFirstURL("(see https://en.wikipedia.org/wiki/Go_(programming_language))."))
	require.Equal(t, "https://example.com/x", DetectFirstURL("(see https://example.com/x)"))
	require.Equal(t, "https://example.com/x", DetectFirstURL("See https://example.com/x)."))
}

func TestEffectiveLinkURLPrefersExplicitSetting(t *testing.T) {
	settings := map[string]interface{}{"url": "https://explicit.example/x"}
	require.Equal(t, "https://explicit.example/x", EffectiveLinkURL(settings, "see https://detected.example/y"))
	require.Equal(t, "https://detected.example/y", EffectiveLinkURL(nil, "see https://detected.example/y"))
	require.Equal(t, "", EffectiveLinkURL(nil, "no link"))
}

func TestParseOpenGraphMetadata(t *testing.T) {
	title, description := parseOpenGraphMetadata(`<html><head><meta property="og:title" content="OG Title"><meta property="og:description" content="OG Desc"></head></html>`)
	require.Equal(t, "OG Title", title)
	require.Equal(t, "OG Desc", description)

	title, description = parseOpenGraphMetadata(`<html><head><title>Fallback</title><meta name="description" content="Meta desc"></head></html>`)
	require.Equal(t, "Fallback", title)
	require.Equal(t, "Meta desc", description)
}

func TestParseOpenGraphMetadataKeepsQuotesAndDecodesEntities(t *testing.T) {
	title, description := parseOpenGraphMetadata(`<html><head>` +
		`<meta property="og:title" content="The world's best coffee &amp; tea">` +
		`<meta content='She said "hi" &#8212; then left' property='og:description'>` +
		`</head></html>`)
	require.Equal(t, "The world's best coffee & tea", title)
	require.Equal(t, `She said "hi" — then left`, description)

	title, description = parseOpenGraphMetadata(`<html><head><title>Don&#39;t panic</title>` +
		`<meta name="description" content="It's fine"></head></html>`)
	require.Equal(t, "Don't panic", title)
	require.Equal(t, "It's fine", description)
}

func TestParseOpenGraphMetadataReadsOnlyTheContentAttribute(t *testing.T) {
	// data-content is a different attribute; only content names the value.
	title, _ := parseOpenGraphMetadata(`<html><head><meta property="og:title" content="Final" data-content="Draft"></head></html>`)
	require.Equal(t, "Final", title)
	title, _ = parseOpenGraphMetadata(`<html><head><title>Fallback</title><meta property="og:title" data-content="Draft"></head></html>`)
	require.Equal(t, "Fallback", title)

	// An unquoted attribute value is valid HTML.
	title, description := parseOpenGraphMetadata(`<html><head><meta property="og:title" content=Final><meta content=Summary name="description"></head></html>`)
	require.Equal(t, "Final", title)
	require.Equal(t, "Summary", description)
}

func TestLinkedInBuildsArticleFromDetectedURLWithOGFallback(t *testing.T) {
	originalClient := httpClient
	originalFetch := fetchLinkPreviewFunc
	defer func() { httpClient = originalClient; fetchLinkPreviewFunc = originalFetch }()

	fetchLinkPreviewFunc = func(context.Context, string) (LinkPreview, error) {
		return LinkPreview{Title: "OG Title", Description: "OG Desc"}, nil
	}
	var payload []byte
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		raw, _ := io.ReadAll(req.Body)
		payload = raw
		return &http.Response{
			StatusCode: http.StatusCreated,
			Header:     http.Header{"X-Restli-Id": {"urn:li:share:1"}},
			Body:       io.NopCloser(strings.NewReader(`{}`)),
			Request:    req,
		}, nil
	})}

	adapter := &LinkedInAdapter{}
	result, err := adapter.Publish(context.Background(), "token", "urn:li:person:1", &PublishRequest{
		Content:  "Launch notes https://example.com/launch",
		Settings: map[string]interface{}{},
	})
	require.NoError(t, err)
	require.Equal(t, "urn:li:share:1", result.ExternalID)
	require.Contains(t, string(payload), `"article"`)
	require.Contains(t, string(payload), "https://example.com/launch")
	require.Contains(t, string(payload), "OG Title")
	require.Contains(t, string(payload), "OG Desc")
}

func TestLinkedInFallsBackToTextWhenPreviewHasNoTitle(t *testing.T) {
	originalClient := httpClient
	originalFetch := fetchLinkPreviewFunc
	defer func() { httpClient = originalClient; fetchLinkPreviewFunc = originalFetch }()

	fetchLinkPreviewFunc = func(context.Context, string) (LinkPreview, error) {
		return LinkPreview{}, errors.New("preview unavailable")
	}
	var payload []byte
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		payload, _ = io.ReadAll(req.Body)
		return &http.Response{
			StatusCode: http.StatusCreated,
			Header:     http.Header{"X-Restli-Id": {"urn:li:share:1"}},
			Body:       io.NopCloser(strings.NewReader(`{}`)),
			Request:    req,
		}, nil
	})}

	adapter := &LinkedInAdapter{}
	_, err := adapter.Publish(context.Background(), "token", "urn:li:person:1", &PublishRequest{
		Content: "Launch notes https://example.com/launch",
	})
	require.NoError(t, err)
	require.NotContains(t, string(payload), `"article"`)
}

func TestFacebookFallsBackToTextOnlyOnScrapeFailure(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	calls := 0
	var bodies []string
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		raw, _ := io.ReadAll(req.Body)
		bodies = append(bodies, string(raw))
		if calls == 1 {
			return jsonResponseWithStatus(req, http.StatusBadRequest, `{"error":{"message":"link scrape failed","code":1609005}}`), nil
		}
		return jsonResponse(req, `{"id":"post-1"}`), nil
	})}

	adapter := &FacebookAdapter{graphVersion: "v25.0"}
	result, err := adapter.Publish(context.Background(), "token", "page-1", &PublishRequest{
		Content:  "Read https://example.com/blocked",
		Settings: map[string]interface{}{},
	})
	require.NoError(t, err)
	require.Equal(t, "post-1", result.ExternalID)
	require.Len(t, bodies, 2, "scrape failure must retry once text-only")
	require.Contains(t, bodies[0], "link=", "first attempt attaches the native card")
	require.NotContains(t, bodies[1], "link=", "retry must drop the card parameter")
}
