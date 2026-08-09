package memes

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

var tinyPNG = []byte("\x89PNG\r\n\x1a\n")

func TestMemegenProviderCanBeDisabledWithoutInvalidConfiguration(t *testing.T) {
	provider, err := NewMemegenProvider(MemegenConfig{})
	require.NoError(t, err)
	require.False(t, provider.Available())
	require.Equal(t, MemegenProviderKey, provider.Key())

	health, err := provider.Health(context.Background())
	require.ErrorIs(t, err, ErrDisabled)
	require.False(t, health.Available)

	_, err = NewMemegenProvider(MemegenConfig{BaseURL: "file:///tmp/memegen"})
	require.EqualError(t, err, "memegen base URL must be an absolute HTTP or HTTPS URL")
	_, err = NewMemegenProvider(MemegenConfig{
		BaseURL: "https://memegen.example", AllowedRenderHosts: []string{"https://cdn.example"},
	})
	require.EqualError(t, err, "memegen render host allowlist entries must be host[:port]")
}

func TestMemegenCatalogNormalizesDeduplicatesSearchesAndCaches(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		require.Equal(t, "/gateway/templates", request.URL.Path)
		require.Equal(t, "catalog-key", request.Header.Get("X-API-KEY"))
		writer.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = io.WriteString(writer, `[
			{
				"id":"drake","name":"","lines":1,"overlays":1,
				"styles":["default","animated","default"],
				"blank":"https://api.memegen.link/images/drake.jpg",
				"example":{"text":["Old choice","New choice"],"url":"https://api.memegen.link/images/drake/old/new.jpg"},
				"source":"https://example.test/source","keywords":["Reação","choice"]
			},
			{
				"id":"drake","name":"Drakeposting","lines":2,"overlays":1,
				"styles":["yes","default"],
				"blank":"https://api.memegen.link/images/drake.jpg",
				"example":{"text":[],"url":""},
				"source":"","keywords":["choice","comparison"]
			}
		]`)
	}))
	t.Cleanup(server.Close)

	provider, err := NewMemegenProvider(MemegenConfig{
		BaseURL: server.URL + "/gateway/", APIKey: "catalog-key",
	})
	require.NoError(t, err)

	first, err := provider.Templates(context.Background())
	require.NoError(t, err)
	require.False(t, first.Stale)
	require.Len(t, first.Templates, 1)
	template := first.Templates[0]
	require.Equal(t, "drake", template.ID)
	require.Equal(t, "Drakeposting", template.Name)
	require.Equal(t, 2, template.Lines)
	require.Equal(t, []string{"animated", "default", "yes"}, template.Styles)
	require.Equal(t, []string{"Reação", "choice", "comparison"}, template.Keywords)
	require.Equal(t, []string{"Old choice", "New choice"}, template.Example.Text)
	require.True(t, template.Animated)
	require.Contains(t, template.SearchTerms, "reacao")
	require.Contains(t, template.SearchTerms, "old choice")

	// Returned slices are copies; callers cannot corrupt the shared cache.
	first.Templates[0].Name = "mutated"
	first.Templates[0].Styles[0] = "mutated"
	second, err := provider.Templates(context.Background())
	require.NoError(t, err)
	require.Equal(t, "Drakeposting", second.Templates[0].Name)
	require.Equal(t, "animated", second.Templates[0].Styles[0])
	require.EqualValues(t, 1, requests.Load())

	results, err := provider.Search(context.Background(), "reacao", 10)
	require.NoError(t, err)
	require.Len(t, results.Templates, 1)
	require.Equal(t, "drake", results.Templates[0].ID)

	results, err = provider.Search(context.Background(), "DRÁKE", 10)
	require.NoError(t, err)
	require.Len(t, results.Templates, 1)
	require.EqualValues(t, 1, requests.Load())
}

func TestMemegenCatalogPreservesExampleCaptionOrderAndDuplicates(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(writer, `[{
			"id":"ordered","name":"Ordered example","lines":4,"overlays":0,
			"example":{"text":["","  z setup  ","a payoff","z setup"],"url":""}
		}]`)
	}))
	t.Cleanup(server.Close)
	provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL})

	catalog, err := provider.Templates(context.Background())
	require.NoError(t, err)
	require.Len(t, catalog.Templates, 1)
	require.Equal(t, []string{"", "z setup", "a payoff", "z setup"}, catalog.Templates[0].Example.Text)
}

func TestMemegenCatalogDropsOptionalNonURLMetadataWithoutFailing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(writer, `[
			{"id":"kermit","name":"Kermit","lines":2,"overlays":0,"source":"top","blank":"not a URL","example":{"text":["","payoff"],"url":"relative"}},
			{"id":"INVALID","name":"Ignored","lines":2,"overlays":0}
		]`)
	}))
	t.Cleanup(server.Close)
	provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL})

	catalog, err := provider.Templates(context.Background())
	require.NoError(t, err)
	require.Len(t, catalog.Templates, 1)
	require.Equal(t, "kermit", catalog.Templates[0].ID)
	require.Empty(t, catalog.Templates[0].SourceURL)
	require.Empty(t, catalog.Templates[0].BlankURL)
	require.Empty(t, catalog.Templates[0].Example.URL)
	require.Equal(t, []string{"", "payoff"}, catalog.Templates[0].Example.Text)
}

func TestMemegenTemplateImageProxiesOnlyAllowedCatalogHosts(t *testing.T) {
	var imageRequests atomic.Int32
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/templates":
			writer.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(writer).Encode([]map[string]any{{
				"id": "aag", "name": "Ancient Aliens", "lines": 1, "overlays": 0,
				"blank": server.URL + "/images/aag.png",
			}})
		case "/images/aag.png":
			imageRequests.Add(1)
			require.Equal(t, "template-key", request.Header.Get("X-API-KEY"))
			writer.Header().Set("Content-Type", "image/png")
			_, _ = writer.Write(tinyPNG)
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL, APIKey: "template-key"})

	image, err := provider.TemplateImage(context.Background(), "aag")
	require.NoError(t, err)
	require.Equal(t, tinyPNG, image.Data)
	require.Equal(t, "image/png", image.MIMEType)
	require.Equal(t, "png", image.Extension)
	require.Equal(t, "aag", image.TemplateID)
	require.EqualValues(t, 1, imageRequests.Load())

	provider.cacheMu.Lock()
	provider.cache.templates[0].BlankURL = "https://attacker.invalid/aag.png"
	provider.cache.byID["aag"] = provider.cache.templates[0]
	provider.cacheMu.Unlock()
	_, err = provider.TemplateImage(context.Background(), "aag")
	require.ErrorIs(t, err, ErrUnsafeResponseURL)
	require.EqualValues(t, 1, imageRequests.Load())
}

func TestMemegenCatalogUsesStaleCacheAndBacksOffAfterRefreshFailure(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		if requests.Add(1) > 1 {
			writer.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		writeAAGCatalog(writer)
	}))
	t.Cleanup(server.Close)
	provider, err := NewMemegenProvider(MemegenConfig{
		BaseURL: server.URL, CacheTTL: time.Hour, StaleTTL: 24 * time.Hour,
	})
	require.NoError(t, err)
	now := time.Date(2026, time.August, 9, 12, 0, 0, 0, time.UTC)
	provider.now = func() time.Time { return now }

	initial, err := provider.Templates(context.Background())
	require.NoError(t, err)
	require.False(t, initial.Stale)

	now = now.Add(2 * time.Hour)
	stale, err := provider.Templates(context.Background())
	require.NoError(t, err)
	require.True(t, stale.Stale)
	require.Len(t, stale.Templates, 1)
	require.EqualValues(t, 2, requests.Load())

	// A failed refresh has a short cooldown so concurrent traffic does not
	// stampede an unavailable provider.
	again, err := provider.Templates(context.Background())
	require.NoError(t, err)
	require.True(t, again.Stale)
	require.EqualValues(t, 2, requests.Load())

	now = now.Add(23 * time.Hour)
	_, err = provider.Templates(context.Background())
	require.ErrorIs(t, err, ErrUnavailable)
	require.EqualValues(t, 3, requests.Load())
}

func TestMemegenCatalogRefreshOutlivesCallerCancellationWithoutPoisoningCache(t *testing.T) {
	tests := []struct {
		name          string
		callerContext func() (context.Context, context.CancelFunc)
		trigger       func(context.CancelFunc)
		expected      error
	}{
		{
			name: "explicit cancellation",
			callerContext: func() (context.Context, context.CancelFunc) {
				return context.WithCancel(context.Background())
			},
			trigger:  func(cancel context.CancelFunc) { cancel() },
			expected: context.Canceled,
		},
		{
			name: "caller deadline",
			callerContext: func() (context.Context, context.CancelFunc) {
				return context.WithTimeout(context.Background(), 75*time.Millisecond)
			},
			trigger:  func(context.CancelFunc) {},
			expected: context.DeadlineExceeded,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			started := make(chan struct{}, 1)
			release := make(chan struct{})
			var releaseOnce sync.Once
			releaseUpstream := func() { releaseOnce.Do(func() { close(release) }) }
			var requests atomic.Int32
			var upstreamCanceled atomic.Bool
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				requests.Add(1)
				select {
				case started <- struct{}{}:
				default:
				}
				select {
				case <-release:
					writeAAGCatalog(writer)
				case <-request.Context().Done():
					upstreamCanceled.Store(true)
				}
			}))
			t.Cleanup(func() {
				releaseUpstream()
				server.Close()
			})
			provider := mustMemegenProvider(t, MemegenConfig{
				BaseURL: server.URL, RequestTimeout: time.Second,
			})

			callerCtx, cancelCaller := test.callerContext()
			t.Cleanup(cancelCaller)
			firstDone := make(chan error, 1)
			go func() {
				_, err := provider.Templates(callerCtx)
				firstDone <- err
			}()
			select {
			case <-started:
			case <-time.After(time.Second):
				t.Fatal("catalog refresh did not start")
			}
			test.trigger(cancelCaller)

			select {
			case err := <-firstDone:
				require.ErrorIs(t, err, ErrUnavailable)
				require.ErrorIs(t, err, test.expected)
			case <-time.After(2 * time.Second):
				t.Fatal("canceled caller did not return promptly")
			}

			type catalogResult struct {
				catalog Catalog
				err     error
			}
			secondDone := make(chan catalogResult, 1)
			go func() {
				catalog, err := provider.Templates(context.Background())
				secondDone <- catalogResult{catalog: catalog, err: err}
			}()
			releaseUpstream()

			select {
			case second := <-secondDone:
				require.NoError(t, second.err)
				require.Len(t, second.catalog.Templates, 1)
			case <-time.After(2 * time.Second):
				t.Fatal("shared catalog refresh did not complete")
			}
			require.EqualValues(t, 1, requests.Load())
			require.False(t, upstreamCanceled.Load())
			provider.cacheMu.RLock()
			lastTryErr := provider.cache.lastTryErr
			provider.cacheMu.RUnlock()
			require.NoError(t, lastTryErr)
		})
	}
}

func TestMemegenCatalogBoundsAndMapsProviderErrors(t *testing.T) {
	t.Run("body size", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(writer, strings.Repeat("x", 100))
		}))
		t.Cleanup(server.Close)
		provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL, MaxCatalogBytes: 20})
		_, err := provider.Templates(context.Background())
		require.ErrorIs(t, err, ErrResponseTooLarge)
	})

	t.Run("template count", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(writer, `[
				{"id":"a","name":"A","lines":1,"overlays":0},
				{"id":"b","name":"B","lines":1,"overlays":0}
			]`)
		}))
		t.Cleanup(server.Close)
		provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL, MaxTemplates: 1})
		_, err := provider.Templates(context.Background())
		require.ErrorIs(t, err, ErrResponseTooLarge)
	})

	t.Run("rate limit", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			writer.Header().Set("Retry-After", "17")
			writer.WriteHeader(http.StatusTooManyRequests)
		}))
		t.Cleanup(server.Close)
		provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL})
		_, err := provider.Templates(context.Background())
		require.ErrorIs(t, err, ErrRateLimited)
		var providerErr *ProviderError
		require.ErrorAs(t, err, &providerErr)
		require.Equal(t, 17*time.Second, providerErr.RetryAfter)
		require.Equal(t, http.StatusTooManyRequests, providerErr.StatusCode)
	})
}

func TestMemegenStatusErrorsAreOperationAwareAndPrivacySafe(t *testing.T) {
	const privateBody = `{"error":"private launch caption"}`
	tests := []struct {
		name      string
		operation string
		status    int
		expected  error
		rejected  []error
	}{
		{name: "catalog bad request", operation: "catalog", status: http.StatusBadRequest, expected: ErrUnavailable, rejected: []error{ErrInvalidRequest}},
		{name: "catalog not found", operation: "catalog", status: http.StatusNotFound, expected: ErrUnavailable, rejected: []error{ErrNotFound}},
		{name: "download bad request", operation: "download", status: http.StatusBadRequest, expected: ErrUnavailable, rejected: []error{ErrInvalidRequest}},
		{name: "download not found", operation: "download", status: http.StatusNotFound, expected: ErrUnavailable, rejected: []error{ErrNotFound}},
		{name: "download path too long", operation: "download", status: http.StatusRequestURITooLong, expected: ErrInvalidRequest, rejected: []error{ErrUnavailable}},
		{name: "render bad request", operation: "render", status: http.StatusBadRequest, expected: ErrInvalidRequest, rejected: []error{ErrUnavailable}},
		{name: "render template not found", operation: "render", status: http.StatusNotFound, expected: ErrNotFound, rejected: []error{ErrUnavailable}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			privateURL, err := url.Parse("https://memegen.example/private-launch-caption")
			require.NoError(t, err)
			response := &http.Response{
				StatusCode: test.status,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(privateBody)),
				Request:    &http.Request{URL: privateURL},
			}
			t.Cleanup(func() { _ = response.Body.Close() })

			err = statusProviderError(test.operation, response)
			require.ErrorIs(t, err, test.expected)
			for _, rejected := range test.rejected {
				require.NotErrorIs(t, err, rejected)
			}
			var providerErr *ProviderError
			require.ErrorAs(t, err, &providerErr)
			require.Equal(t, test.operation, providerErr.Operation)
			require.Equal(t, test.status, providerErr.StatusCode)
			require.NotContains(t, err.Error(), "private launch caption")
			require.NotContains(t, err.Error(), "private-launch-caption")
		})
	}
}

func TestMemegenCatalogHonorsProviderTimeout(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		<-request.Context().Done()
		return nil, request.Context().Err()
	})}
	provider := mustMemegenProvider(t, MemegenConfig{
		BaseURL: "https://memegen.example", Client: client, RequestTimeout: 5 * time.Millisecond,
	})

	_, err := provider.Templates(context.Background())
	require.ErrorIs(t, err, ErrUnavailable)
	require.ErrorIs(t, err, context.DeadlineExceeded)
}

func TestMemegenRenderPostHonorsRenderTimeout(t *testing.T) {
	elapsed := make(chan time.Duration, 1)
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		switch request.URL.Path {
		case "/templates":
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body: io.NopCloser(strings.NewReader(
					`[{"id":"aag","name":"Ancient Aliens","lines":1,"overlays":0}]`)),
				Request: request,
			}, nil
		case "/images":
			startedAt := time.Now()
			<-request.Context().Done()
			elapsed <- time.Since(startedAt)
			return nil, request.Context().Err()
		default:
			return nil, errors.New("unexpected Memegen test request")
		}
	})}
	provider := mustMemegenProvider(t, MemegenConfig{
		BaseURL:        "https://memegen.example",
		Client:         client,
		RequestTimeout: 10 * time.Millisecond,
		RenderTimeout:  120 * time.Millisecond,
	})

	_, err := provider.Render(context.Background(), RenderRequest{TemplateID: "aag", Text: []string{"caption"}})
	require.ErrorIs(t, err, ErrUnavailable)
	select {
	case duration := <-elapsed:
		require.GreaterOrEqual(t, duration, 70*time.Millisecond)
		require.Less(t, duration, time.Second)
	case <-time.After(time.Second):
		t.Fatal("render request did not observe its deadline")
	}
}

func TestMemegenRenderPostDoesNotFollowRedirects(t *testing.T) {
	var redirected atomic.Int32
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/templates":
			writeAAGCatalog(writer)
		case "/images":
			http.Redirect(writer, request, server.URL+"/redirected", http.StatusTemporaryRedirect)
		case "/redirected":
			redirected.Add(1)
			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(writer).Encode(map[string]string{"url": server.URL + "/result.png"})
		case "/result.png":
			writer.Header().Set("Content-Type", "image/png")
			_, _ = writer.Write(tinyPNG)
		}
	}))
	t.Cleanup(server.Close)
	provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL})

	_, err := provider.Render(context.Background(), RenderRequest{TemplateID: "aag", Text: []string{"caption"}})
	require.ErrorIs(t, err, ErrUnavailable)
	require.Zero(t, redirected.Load())
}

func TestMemegenRenderPostsRawTextAndReturnsValidatedImage(t *testing.T) {
	privateCaption := "private draft / with ? and & symbols"
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/templates":
			writeAAGCatalog(writer)
		case "/images":
			require.Equal(t, http.MethodPost, request.Method)
			require.NotContains(t, request.URL.String(), privateCaption)
			require.Equal(t, "render-key", request.Header.Get("X-API-KEY"))
			var payload memegenRenderRequest
			require.NoError(t, json.NewDecoder(request.Body).Decode(&payload))
			require.Equal(t, "aag", payload.TemplateID)
			require.Equal(t, []string{privateCaption, "bottom"}, payload.Text)
			require.Equal(t, []string{"default"}, payload.Style)
			require.Equal(t, "png", payload.Extension)
			require.False(t, payload.Redirect)
			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(writer).Encode(map[string]string{
				"url": server.URL + "/rendered.png?canonical=1",
			})
		case "/rendered.png":
			require.Equal(t, "1", request.URL.Query().Get("canonical"))
			require.Equal(t, "render-key", request.Header.Get("X-API-KEY"))
			writer.Header().Set("Content-Type", "image/png")
			_, _ = writer.Write(tinyPNG)
		default:
			http.NotFound(writer, request)
		}
	}))
	t.Cleanup(server.Close)

	provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL, APIKey: "render-key"})
	image, err := provider.Render(context.Background(), RenderRequest{
		TemplateID: "aag", Text: []string{privateCaption, "bottom"}, Styles: []string{"default"}, Extension: "png",
	})
	require.NoError(t, err)
	require.Equal(t, tinyPNG, image.Data)
	require.Equal(t, "image/png", image.MIMEType)
	require.Equal(t, "png", image.Extension)
	require.Equal(t, "aag", image.TemplateID)
}

func TestMemegenRenderRetriesTransientCanonicalDownload(t *testing.T) {
	var downloads atomic.Int32
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/templates":
			writeAAGCatalog(writer)
		case "/images":
			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(writer).Encode(map[string]string{"url": server.URL + "/result.png"})
		case "/result.png":
			if downloads.Add(1) == 1 {
				writer.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			writer.Header().Set("Content-Type", "image/png")
			_, _ = writer.Write(tinyPNG)
		}
	}))
	t.Cleanup(server.Close)
	provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL})

	image, err := provider.Render(context.Background(), RenderRequest{TemplateID: "aag", Text: []string{"caption"}})
	require.NoError(t, err)
	require.Equal(t, tinyPNG, image.Data)
	require.EqualValues(t, 2, downloads.Load())
}

func TestMemegenRenderDoesNotRetryPermanentCanonicalDownloadFailure(t *testing.T) {
	var downloads atomic.Int32
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/templates":
			writeAAGCatalog(writer)
		case "/images":
			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(writer).Encode(map[string]string{"url": server.URL + "/result.png"})
		case "/result.png":
			downloads.Add(1)
			writer.WriteHeader(http.StatusBadRequest)
		}
	}))
	t.Cleanup(server.Close)
	provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL})

	_, err := provider.Render(context.Background(), RenderRequest{TemplateID: "aag", Text: []string{"caption"}})
	require.ErrorIs(t, err, ErrUnavailable)
	require.EqualValues(t, 1, downloads.Load())
}

func TestMemegenRenderSerializesHTTPSOverlayReplacements(t *testing.T) {
	overlays := []string{
		"https://media.openpost.social/one.png?signature=first",
		"https://media.openpost.social/two.png?signature=second",
	}
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/templates":
			writer.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(writer).Encode([]map[string]any{{
				"id": "3hd", "name": "Three-Headed Dragon", "lines": 3, "overlays": 3,
				"styles": []string{"default"},
			}})
		case "/images":
			var payload memegenRenderRequest
			require.NoError(t, json.NewDecoder(request.Body).Decode(&payload))
			require.Equal(t, overlays, payload.Style)
			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(writer).Encode(map[string]string{"url": server.URL + "/result.png"})
		case "/result.png":
			writer.Header().Set("Content-Type", "image/png")
			_, _ = writer.Write(tinyPNG)
		}
	}))
	t.Cleanup(server.Close)
	provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL})

	image, err := provider.Render(context.Background(), RenderRequest{
		TemplateID: "3hd", Text: []string{"one", "two", "three"}, OverlayURLs: overlays,
	})
	require.NoError(t, err)
	require.Equal(t, tinyPNG, image.Data)
}

func TestMemegenRenderRejectsUnsafeOrAmbiguousOverlayReplacements(t *testing.T) {
	var postRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/templates" {
			writer.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(writer).Encode([]map[string]any{{
				"id": "drake", "name": "Drakeposting", "lines": 2, "overlays": 1,
				"styles": []string{"default"},
			}})
			return
		}
		postRequests.Add(1)
	}))
	t.Cleanup(server.Close)
	provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL})

	tests := []RenderRequest{
		{TemplateID: "drake", OverlayURLs: []string{"http://media.example/image.png"}},
		{TemplateID: "drake", OverlayURLs: []string{"https://127.0.0.1/image.png"}},
		{TemplateID: "drake", OverlayURLs: []string{"https://localhost/image.png"}},
		{TemplateID: "drake", OverlayURLs: []string{"https://user:password@media.example/image.png"}},
		{TemplateID: "drake", OverlayURLs: []string{"https://media.example/image.png#fragment"}},
		{TemplateID: "drake", OverlayURLs: []string{"https://media.example/one.png", "https://media.example/two.png"}},
		{TemplateID: "drake", Styles: []string{"default"}, OverlayURLs: []string{"https://media.example/image.png"}},
	}
	for _, request := range tests {
		_, err := provider.Render(context.Background(), request)
		require.ErrorIs(t, err, ErrInvalidRequest)
	}
	require.Zero(t, postRequests.Load())
}

func TestMemegenRenderRejectsInvalidInputBeforePostingCaptions(t *testing.T) {
	var postRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/templates" {
			writeAAGCatalog(writer)
			return
		}
		postRequests.Add(1)
		writer.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(server.Close)
	provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL})

	tests := []RenderRequest{
		{TemplateID: "AAG", Text: []string{"one"}},
		{TemplateID: "unknown", Text: []string{"one"}},
		{TemplateID: "aag", Text: []string{"one", "two", "three"}},
		{TemplateID: "aag", Text: []string{strings.Repeat("private", 40)}},
		{TemplateID: "aag", Text: []string{"one"}, Styles: []string{"https://attacker.invalid/overlay.png"}},
		{TemplateID: "aag", Text: []string{"one"}, Extension: "svg"},
		{TemplateID: "aag", Text: []string{"one"}, Layout: "bottom"},
		{TemplateID: "aag", Text: []string{"one"}, Font: "../../../font"},
	}
	for _, request := range tests {
		_, err := provider.Render(context.Background(), request)
		require.Error(t, err)
		require.True(t, errors.Is(err, ErrInvalidRequest) || errors.Is(err, ErrNotFound))
		require.NotContains(t, err.Error(), "private")
	}
	require.Zero(t, postRequests.Load())
}

func TestValidateCaptionsBoundsUnicodeByVisibleCharacters(t *testing.T) {
	require.NoError(t, validateCaptions([]string{strings.Repeat("é", 100)}, 1))
	require.ErrorIs(t, validateCaptions([]string{strings.Repeat("é", 101)}, 1), ErrInvalidRequest)
	require.NoError(t, ValidateMemegenCaption(strings.Repeat("?", 100)))
	require.ErrorIs(t, ValidateMemegenCaption(strings.Repeat("?", 101)), ErrInvalidRequest)
	require.NoError(t, ValidateMemegenCaption(strings.Repeat("😀", 50)))
	require.ErrorIs(t, ValidateMemegenCaption(strings.Repeat("😀", 51)), ErrInvalidRequest)
	require.ErrorIs(t, ValidateMemegenCaption(strings.Repeat("😀", 30)+strings.Repeat("?", 41)), ErrInvalidRequest)
	require.ErrorIs(t, ValidateMemegenCaption("safe%00looking"), ErrInvalidRequest)
}

func TestMemegenRenderErrorsNeverExposeCaptionsOrProviderBodies(t *testing.T) {
	privateCaption := "unreleased acquisition announcement"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/templates" {
			writeAAGCatalog(writer)
			return
		}
		writer.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(writer, `{"error":"`+privateCaption+`"}`)
	}))
	t.Cleanup(server.Close)
	provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL})

	_, err := provider.Render(context.Background(), RenderRequest{TemplateID: "aag", Text: []string{privateCaption}})
	require.ErrorIs(t, err, ErrUnavailable)
	require.NotContains(t, err.Error(), privateCaption)
	require.NotContains(t, err.Error(), "acquisition")
}

func TestMemegenRenderRejectsUnsafeCanonicalURL(t *testing.T) {
	privateCaption := "private caption in canonical path"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/templates" {
			writeAAGCatalog(writer)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(writer).Encode(map[string]string{
			"url": "http://127.0.0.1:1/images/aag/" + privateCaption + ".png",
		})
	}))
	t.Cleanup(server.Close)
	provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL})

	_, err := provider.Render(context.Background(), RenderRequest{TemplateID: "aag", Text: []string{privateCaption}})
	require.ErrorIs(t, err, ErrUnsafeResponseURL)
	require.NotContains(t, err.Error(), privateCaption)
}

func TestMemegenRenderBoundsAndValidatesDownloadedImage(t *testing.T) {
	tests := []struct {
		name        string
		contentType string
		body        []byte
		maximum     int64
		expected    error
	}{
		{name: "body size", contentType: "image/png", body: append(tinyPNG, make([]byte, 32)...), maximum: 16, expected: ErrResponseTooLarge},
		{name: "declared MIME", contentType: "text/html", body: tinyPNG, maximum: 1024, expected: ErrInvalidResponse},
		{name: "detected MIME", contentType: "image/png", body: []byte("not a png"), maximum: 1024, expected: ErrInvalidResponse},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				switch request.URL.Path {
				case "/templates":
					writeAAGCatalog(writer)
				case "/images":
					writer.Header().Set("Content-Type", "application/json")
					writer.WriteHeader(http.StatusCreated)
					_ = json.NewEncoder(writer).Encode(map[string]string{"url": server.URL + "/result.png"})
				case "/result.png":
					writer.Header().Set("Content-Type", test.contentType)
					_, _ = writer.Write(test.body)
				}
			}))
			t.Cleanup(server.Close)
			provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL, MaxImageBytes: test.maximum})
			_, err := provider.Render(context.Background(), RenderRequest{TemplateID: "aag", Text: []string{"caption"}})
			require.ErrorIs(t, err, test.expected)
		})
	}
}

func TestMemegenRenderRejectsRedirectOutsideAllowlist(t *testing.T) {
	outside := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "image/png")
		_, _ = writer.Write(tinyPNG)
	}))
	t.Cleanup(outside.Close)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/templates":
			writeAAGCatalog(writer)
		case "/images":
			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(writer).Encode(map[string]string{"url": server.URL + "/redirect"})
		case "/redirect":
			http.Redirect(writer, request, outside.URL+"/image.png", http.StatusFound)
		}
	}))
	t.Cleanup(server.Close)
	provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL})

	_, err := provider.Render(context.Background(), RenderRequest{TemplateID: "aag", Text: []string{"caption"}})
	require.ErrorIs(t, err, ErrUnsafeResponseURL)
}

func TestMemegenRenderRedirectScopesAPIKeyToBaseHost(t *testing.T) {
	provider := mustMemegenProvider(t, MemegenConfig{
		BaseURL: "https://memegen.example", APIKey: "private-render-key",
		AllowedRenderHosts: []string{"cdn.example"},
	})
	tests := []struct {
		name        string
		destination string
		expectedKey string
		expectedErr error
	}{
		{
			name: "same host retains key", destination: "https://memegen.example/result.png",
			expectedKey: "private-render-key",
		},
		{
			name: "allowed cross host strips key", destination: "https://cdn.example/result.png",
		},
		{
			name: "rejected cross host also strips key", destination: "https://attacker.example/result.png",
			expectedErr: ErrUnsafeResponseURL,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			destination, err := url.Parse(test.destination)
			require.NoError(t, err)
			request := &http.Request{URL: destination, Header: make(http.Header)}
			request.Header.Set("X-API-KEY", "private-render-key")
			via := []*http.Request{{URL: provider.baseURL}}

			err = provider.checkRenderRedirect(request, via)
			if test.expectedErr == nil {
				require.NoError(t, err)
			} else {
				require.ErrorIs(t, err, test.expectedErr)
			}
			require.Equal(t, test.expectedKey, request.Header.Get("X-API-KEY"))
		})
	}
}

func TestMemegenRenderDoesNotForwardAPIKeyToAllowedRedirectHost(t *testing.T) {
	redirectedKey := make(chan string, 1)
	cdn := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		redirectedKey <- request.Header.Get("X-API-KEY")
		writer.Header().Set("Content-Type", "image/png")
		_, _ = writer.Write(tinyPNG)
	}))
	t.Cleanup(cdn.Close)
	cdnURL, err := url.Parse(cdn.URL)
	require.NoError(t, err)

	var server *httptest.Server
	server = httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/templates":
			writeAAGCatalog(writer)
		case "/images":
			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(writer).Encode(map[string]string{"url": server.URL + "/redirect"})
		case "/redirect":
			http.Redirect(writer, request, cdn.URL+"/result.png", http.StatusFound)
		}
	}))
	t.Cleanup(server.Close)
	provider := mustMemegenProvider(t, MemegenConfig{
		BaseURL: server.URL, APIKey: "private-render-key", Client: server.Client(),
		AllowedRenderHosts: []string{cdnURL.Host},
	})

	image, err := provider.Render(context.Background(), RenderRequest{TemplateID: "aag", Text: []string{"caption"}})
	require.NoError(t, err)
	require.Equal(t, tinyPNG, image.Data)
	select {
	case apiKey := <-redirectedKey:
		require.Empty(t, apiKey)
	case <-time.After(time.Second):
		t.Fatal("allowed redirect host did not receive the image request")
	}
}

func TestMemegenRenderBoundsSameOriginRedirects(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/templates":
			writeAAGCatalog(writer)
		case "/images":
			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(writer).Encode(map[string]string{"url": server.URL + "/redirect/1"})
		case "/redirect/1":
			http.Redirect(writer, request, server.URL+"/redirect/2", http.StatusFound)
		case "/redirect/2":
			http.Redirect(writer, request, server.URL+"/redirect/3", http.StatusFound)
		case "/redirect/3":
			writer.Header().Set("Content-Type", "image/png")
			_, _ = writer.Write(tinyPNG)
		}
	}))
	t.Cleanup(server.Close)
	provider := mustMemegenProvider(t, MemegenConfig{BaseURL: server.URL, MaxRedirects: 2})

	_, err := provider.Render(context.Background(), RenderRequest{TemplateID: "aag", Text: []string{"caption"}})
	require.ErrorIs(t, err, ErrUnsafeResponseURL)
}

func TestMemegenHealthReportsStaleButUsableCatalog(t *testing.T) {
	var fail atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		if fail.Load() {
			writer.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		writeAAGCatalog(writer)
	}))
	t.Cleanup(server.Close)
	provider := mustMemegenProvider(t, MemegenConfig{
		BaseURL: server.URL, CacheTTL: time.Hour, StaleTTL: 24 * time.Hour,
	})
	now := time.Date(2026, time.August, 9, 12, 0, 0, 0, time.UTC)
	provider.now = func() time.Time { return now }
	_, err := provider.Templates(context.Background())
	require.NoError(t, err)
	fail.Store(true)
	now = now.Add(2 * time.Hour)

	health, err := provider.Health(context.Background())
	require.NoError(t, err)
	require.True(t, health.Available)
	require.True(t, health.Ready)
	require.True(t, health.CatalogCached)
	require.True(t, health.CatalogStale)
	require.Equal(t, 1, health.TemplateCount)
}

func writeAAGCatalog(writer http.ResponseWriter) {
	const id = "aag"
	writer.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(writer).Encode([]map[string]any{{
		"id": id, "name": "Ancient Aliens Guy", "lines": 2, "overlays": 0,
		"styles": []string{"default"},
		"blank":  "https://api.memegen.link/images/" + id + ".jpg",
		"example": map[string]any{
			"text": []string{"top", "bottom"},
			"url":  "https://api.memegen.link/images/" + id + "/top/bottom.jpg",
		},
		"source": "https://example.test/source", "keywords": []string{"example"},
	}})
}

func mustMemegenProvider(t *testing.T, config MemegenConfig) *MemegenProvider {
	t.Helper()
	provider, err := NewMemegenProvider(config)
	require.NoError(t, err)
	return provider
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}
