package sourcecontext

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/openpost/backend/internal/netguard"
	"github.com/stretchr/testify/require"
)

type resolverFunc func(context.Context, string) ([]net.IPAddr, error)

func (function resolverFunc) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return function(ctx, host)
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

type contextBody struct {
	context context.Context
}

func (body *contextBody) Read([]byte) (int, error) {
	<-body.context.Done()
	return 0, body.context.Err()
}

func (body *contextBody) Close() error {
	return nil
}

func TestLoadRejectsPrivateLocalCredentialsAndCustomPorts(t *testing.T) {
	t.Parallel()

	loader, err := New(Config{})
	require.NoError(t, err)

	tests := []struct {
		name string
		url  string
		want error
	}{
		{name: "loopback IPv4", url: "http://127.0.0.1/private", want: ErrURLNotPublic},
		{name: "private IPv4", url: "http://10.0.0.8/private", want: ErrURLNotPublic},
		{name: "loopback IPv6", url: "http://[::1]/private", want: ErrURLNotPublic},
		{name: "local hostname", url: "http://localhost/private", want: ErrURLNotPublic},
		{name: "credentials", url: "https://user:secret@example.com/private", want: ErrCredentialsNotAllowed},
		{name: "custom port", url: "https://example.com:8443/private", want: ErrCustomPortNotAllowed},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, loadErr := loader.Load(t.Context(), test.url)
			require.ErrorIs(t, loadErr, test.want)
		})
	}
}

func TestLoadValidatesEveryRedirect(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		location string
		want     error
	}{
		{name: "private host", location: "http://127.0.0.1/private", want: ErrURLNotPublic},
		{name: "credentials", location: "https://user:secret@other.example/private", want: ErrCredentialsNotAllowed},
		{name: "custom port", location: "https://other.example:8443/private", want: ErrCustomPortNotAllowed},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			loader := newTestLoader(t, Config{}, publicResolver(), roundTripFunc(func(request *http.Request) (*http.Response, error) {
				return response(request, http.StatusFound, "text/plain", "", http.Header{
					"Location": []string{test.location},
				}), nil
			}))

			_, err := loader.Load(t.Context(), "https://public.example/article")
			require.ErrorIs(t, err, test.want)
		})
	}
}

func TestLoadCapsRedirects(t *testing.T) {
	t.Parallel()

	loader := newTestLoader(t, Config{MaxRedirects: 1}, publicResolver(), roundTripFunc(func(request *http.Request) (*http.Response, error) {
		return response(request, http.StatusFound, "text/plain", "", http.Header{
			"Location": []string{"https://public.example" + request.URL.Path + "/next"},
		}), nil
	}))

	_, err := loader.Load(t.Context(), "https://public.example/article")
	require.ErrorIs(t, err, ErrTooManyRedirects)
}

func TestNewRejectsUnboundedConfiguration(t *testing.T) {
	t.Parallel()

	for _, config := range []Config{
		{Timeout: maxTimeout + time.Second},
		{MaxResponseBytes: maxResponseBytes + 1},
		{MaxTextCharacters: maxTextCharacters + 1},
		{MaxRedirects: maxRedirects + 1},
		{UserAgent: "OpenPost\r\nAuthorization: secret"},
	} {
		_, err := New(config)
		require.ErrorIs(t, err, ErrInvalidConfig)
	}
}

func TestLoadRejectsDialTimeDNSRebinding(t *testing.T) {
	t.Parallel()

	var mutex sync.Mutex
	lookups := 0
	resolver := resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
		mutex.Lock()
		defer mutex.Unlock()
		lookups++
		if lookups == 1 {
			return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
		}
		return []net.IPAddr{{IP: net.ParseIP("127.0.0.1")}}, nil
	})
	loader, err := newURLLoader(Config{Timeout: 250 * time.Millisecond}, resolver, nil)
	require.NoError(t, err)

	_, err = loader.Load(t.Context(), "http://rebind.example/article")
	require.ErrorIs(t, err, ErrFetchFailed)
	require.GreaterOrEqual(t, lookups, 2)
}

func TestLoadRejectsUnsupportedContentType(t *testing.T) {
	t.Parallel()

	loader := newTestLoader(t, Config{}, publicResolver(), staticResponse(
		http.StatusOK,
		"application/json",
		`{"text":"not accepted"}`,
	))

	_, err := loader.Load(t.Context(), "https://public.example/data")
	require.ErrorIs(t, err, ErrUnsupportedContentType)
}

func TestLoadReturnsSafeFetchAndStatusErrors(t *testing.T) {
	t.Parallel()

	fetchLoader := newTestLoader(t, Config{}, publicResolver(), roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("upstream leaked secret response")
	}))
	_, err := fetchLoader.Load(t.Context(), "https://public.example/failure")
	require.ErrorIs(t, err, ErrFetchFailed)
	require.NotContains(t, err.Error(), "secret")

	statusLoader := newTestLoader(t, Config{}, publicResolver(), staticResponse(
		http.StatusBadGateway,
		"text/plain",
		"private upstream failure body",
	))
	_, err = statusLoader.Load(t.Context(), "https://public.example/status")
	require.ErrorIs(t, err, ErrHTTPStatus)
	require.NotContains(t, err.Error(), "private upstream failure body")
}

func TestLoadCapsResponseBytes(t *testing.T) {
	t.Parallel()

	loader := newTestLoader(t, Config{MaxResponseBytes: 5}, publicResolver(), staticResponse(
		http.StatusOK,
		"text/plain; charset=utf-8",
		"123456",
	))

	_, err := loader.Load(t.Context(), "https://public.example/large")
	require.ErrorIs(t, err, ErrResponseTooLarge)
}

func TestLoadCapsTextByUnicodeCharacters(t *testing.T) {
	t.Parallel()

	loader := newTestLoader(t, Config{MaxTextCharacters: 9}, publicResolver(), staticResponse(
		http.StatusOK,
		"text/plain; charset=utf-8",
		"hello 世界 and more",
	))

	document, err := loader.Load(t.Context(), "https://public.example/text")
	require.NoError(t, err)
	require.True(t, document.Truncated)
	require.True(t, utf8.ValidString(document.Text))
	require.LessOrEqual(t, utf8.RuneCountInString(document.Text), 9)
	require.Equal(t, "hello 世界", document.Text)
}

func TestLoadTimesOut(t *testing.T) {
	t.Parallel()

	loader := newTestLoader(t, Config{Timeout: 20 * time.Millisecond}, publicResolver(), roundTripFunc(func(request *http.Request) (*http.Response, error) {
		<-request.Context().Done()
		return nil, request.Context().Err()
	}))

	_, err := loader.Load(t.Context(), "https://public.example/slow")
	require.ErrorIs(t, err, ErrTimeout)
}

func TestLoadTimesOutWhileReadingResponseBody(t *testing.T) {
	t.Parallel()

	loader := newTestLoader(t, Config{Timeout: 20 * time.Millisecond}, publicResolver(), roundTripFunc(func(request *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     http.StatusText(http.StatusOK),
			Header:     http.Header{"Content-Type": []string{"text/plain"}},
			Body:       &contextBody{context: request.Context()},
			Request:    request,
		}, nil
	}))

	_, err := loader.Load(t.Context(), "https://public.example/slow-body")
	require.ErrorIs(t, err, ErrTimeout)
}

func TestLoadExtractsCleanReadableArticle(t *testing.T) {
	t.Parallel()

	paragraph := "Deleting the compatibility layer removed fifteen thousand lines while preserving every supported publishing path. " +
		"The smaller design now keeps destination formats in one place and makes account-specific behavior explicit. "
	htmlBody := `<!doctype html>
<html><head>
<title>Building smaller systems | Example</title>
<link rel="canonical" href="/notes/smaller-systems">
</head><body>
<header>Unrelated menu Pricing Login</header>
<nav>Buy now Subscribe</nav>
<main><article>
<h1>Building smaller systems</h1>
<p>` + paragraph + paragraph + `</p>
<p>The result was less state, fewer migrations, and the same user-visible features.</p>
</article></main>
<aside>Sponsored unrelated story</aside>
<footer>Cookie settings</footer>
</body></html>`
	loader := newTestLoader(t, Config{}, publicResolver(), staticResponse(
		http.StatusOK,
		"text/html; charset=utf-8",
		htmlBody,
	))

	document, err := loader.Load(t.Context(), "https://ARTICLES.example/story?ref=feed#fragment")
	require.NoError(t, err)
	require.Equal(t, "Building smaller systems | Example", document.Title)
	require.Equal(t, "https://articles.example/notes/smaller-systems", document.CanonicalURL)
	require.Contains(t, document.Text, "Deleting the compatibility layer removed fifteen thousand lines")
	require.Contains(t, document.Text, "The result was less state")
	require.NotContains(t, document.Text, "Unrelated menu")
	require.NotContains(t, document.Text, "Buy now")
	require.NotContains(t, document.Text, "Sponsored unrelated story")
	require.False(t, document.Truncated)
}

func TestLoadNormalizesPlainTextAndCanonicalURL(t *testing.T) {
	t.Parallel()

	loader := newTestLoader(t, Config{}, publicResolver(), staticResponse(
		http.StatusOK,
		"text/plain; charset=utf-8",
		"\ufeffRelease notes\r\n\r\n  Fixed account routing.  \r\n",
	))

	document, err := loader.Load(t.Context(), "https://EXAMPLE.com:443#ignored")
	require.NoError(t, err)
	require.Equal(t, "Release notes", document.Title)
	require.Equal(t, "https://example.com/", document.CanonicalURL)
	require.Equal(t, "Release notes\n\nFixed account routing.", document.Text)
}

func TestHTMLFallbackBoundsDeepTraversal(t *testing.T) {
	t.Parallel()

	body := strings.Repeat("<div>", maxHTMLNodes+100) + "bounded text" + strings.Repeat("</div>", maxHTMLNodes+100)
	pageURL, err := url.Parse("https://example.com/source")
	require.NoError(t, err)
	title, canonical := inspectHTML([]byte("<title>Bounded</title>"+body), pageURL)
	require.Equal(t, "Bounded", title)
	require.Nil(t, canonical)
	require.NotContains(t, fallbackHTMLText([]byte(body)), "bounded text", "tokens beyond the node budget must not be traversed")
}

func TestNewUsesGuardedTransportWithoutProxy(t *testing.T) {
	t.Parallel()

	loader, err := New(Config{})
	require.NoError(t, err)
	transport, ok := loader.client.Transport.(*http.Transport)
	require.True(t, ok)
	require.Nil(t, transport.Proxy)
}

func newTestLoader(
	t *testing.T,
	config Config,
	resolver netguard.Resolver,
	transport http.RoundTripper,
) *URLLoader {
	t.Helper()
	loader, err := newURLLoader(config, resolver, transport)
	require.NoError(t, err)
	return loader
}

func publicResolver() netguard.Resolver {
	return resolverFunc(func(_ context.Context, host string) ([]net.IPAddr, error) {
		if parsed := net.ParseIP(strings.Trim(host, "[]")); parsed != nil {
			return []net.IPAddr{{IP: parsed}}, nil
		}
		return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
	})
}

func staticResponse(status int, contentType, body string) http.RoundTripper {
	return roundTripFunc(func(request *http.Request) (*http.Response, error) {
		return response(request, status, contentType, body, nil), nil
	})
}

func response(
	request *http.Request,
	status int,
	contentType string,
	body string,
	headers http.Header,
) *http.Response {
	if headers == nil {
		headers = make(http.Header)
	}
	if contentType != "" {
		headers.Set("Content-Type", contentType)
	}
	return &http.Response{
		StatusCode:    status,
		Status:        http.StatusText(status),
		Header:        headers,
		Body:          io.NopCloser(strings.NewReader(body)),
		ContentLength: -1,
		Request:       request,
	}
}
