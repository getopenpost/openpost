package stockmedia

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func response(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestNormalizeQueryAppliesSafeBounds(t *testing.T) {
	query, err := NormalizeQuery(SearchQuery{Query: "  product demo  ", Kind: "", Page: -1, PerPage: 99})
	require.NoError(t, err)
	require.Equal(t, "product demo", query.Query)
	require.Equal(t, "photo", query.Kind)
	require.Equal(t, 1, query.Page)
	require.Equal(t, 40, query.PerPage)

	_, err = NormalizeQuery(SearchQuery{Query: "demo", Kind: "audio"})
	require.EqualError(t, err, "kind must be photo or video")
}

func TestPexelsNormalizesPhotoAndKeepsCredentialServerSide(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		require.Equal(t, "pexels-secret", request.Header.Get("Authorization"))
		require.Equal(t, "desk", request.URL.Query().Get("query"))
		require.Equal(t, "portrait", request.URL.Query().Get("orientation"))
		require.Equal(t, "large", request.URL.Query().Get("size"))
		require.Equal(t, "blue", request.URL.Query().Get("color"))
		require.Equal(t, "pt-BR", request.URL.Query().Get("locale"))
		return response(http.StatusOK, `{
			"page": 1,
			"per_page": 1,
			"total_results": 1,
			"photos": [{
				"id": 42,
				"width": 1920,
				"height": 1080,
				"url": "https://www.pexels.com/photo/42/",
				"photographer": "A Creator",
				"photographer_url": "https://www.pexels.com/@creator/",
				"alt": "Desk setup",
				"src": {
					"medium": "https://images.pexels.com/medium.jpg",
					"large": "https://images.pexels.com/large.jpg",
					"original": "https://images.pexels.com/original.jpg"
				}
			}]
		}`), nil
	})}
	adapter := NewPexels("pexels-secret", client)

	page, err := adapter.Search(context.Background(), SearchQuery{
		Query: "desk", Kind: "photo", Orientation: "portrait", Size: "large", Color: "blue", Locale: "pt-BR",
	})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Equal(t, "photo:42", page.Items[0].ExternalID)
	require.Equal(t, "Photo by A Creator on Pexels", page.Items[0].AttributionText)
	encoded := page.Items[0].Title + page.Items[0].SourceURL + page.Items[0].PreviewURL
	require.NotContains(t, encoded, "pexels-secret")
}

func TestUnsplashMapsProviderSpecificPhotoFilters(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		query := request.URL.Query()
		require.Equal(t, "squarish", query.Get("orientation"))
		require.Equal(t, "teal", query.Get("color"))
		require.Equal(t, "latest", query.Get("order_by"))
		require.Equal(t, "high", query.Get("content_filter"))
		require.Equal(t, "123,456", query.Get("collections"))
		return response(http.StatusOK, `{"total":0,"total_pages":0,"results":[]}`), nil
	})}
	adapter := NewUnsplash("unsplash-secret", client)

	_, err := adapter.Search(context.Background(), SearchQuery{
		Query: "desk", Kind: "photo", Orientation: "square", Color: "teal", Order: "latest",
		ContentFilter: "high", Collections: "123,456",
	})
	require.NoError(t, err)
}

func TestPixabayMapsImageFiltersAndKeepsSafeSearch(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		query := request.URL.Query()
		require.Equal(t, "true", query.Get("safesearch"))
		require.Equal(t, "horizontal", query.Get("orientation"))
		require.Equal(t, "illustration", query.Get("image_type"))
		require.Equal(t, "business", query.Get("category"))
		require.Equal(t, "orange", query.Get("colors"))
		require.Equal(t, "latest", query.Get("order"))
		require.Equal(t, "true", query.Get("editors_choice"))
		require.Equal(t, "1200", query.Get("min_width"))
		require.Equal(t, "800", query.Get("min_height"))
		require.Equal(t, "pt", query.Get("lang"))
		return response(http.StatusOK, `{"totalHits":0,"hits":[]}`), nil
	})}
	adapter := NewPixabay("pixabay-secret", client)

	_, err := adapter.Search(context.Background(), SearchQuery{
		Query: "desk", Kind: "photo", Orientation: "landscape", MediaSubtype: "illustration",
		Category: "business", Color: "orange", Order: "latest", EditorsChoice: true,
		MinWidth: 1200, MinHeight: 800, Locale: "pt",
	})
	require.NoError(t, err)
}

func TestUnsplashSelectionTracksDownloadBeforeResolve(t *testing.T) {
	var requests []string
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests = append(requests, request.URL.String())
		require.Equal(t, "Client-ID unsplash-secret", request.Header.Get("Authorization"))
		if strings.Contains(request.URL.Path, "/download") {
			return response(http.StatusOK, `{"url":"https://images.unsplash.com/file.jpg"}`), nil
		}
		return response(http.StatusOK, `{
			"id":"abc",
			"width":1000,
			"height":1200,
			"alt_description":"Portrait",
			"urls":{
				"thumb":"https://images.unsplash.com/thumb.jpg",
				"small":"https://images.unsplash.com/small.jpg",
				"full":"https://images.unsplash.com/full.jpg"
			},
			"links":{
				"html":"https://unsplash.com/photos/abc",
				"download_location":"https://api.unsplash.com/photos/abc/download"
			},
			"user":{"name":"A Creator","links":{"html":"https://unsplash.com/@creator"}}
		}`), nil
	})}
	adapter := NewUnsplash("unsplash-secret", client)

	require.NoError(t, adapter.TrackSelection(context.Background(), "abc"))
	resolved, err := adapter.Resolve(context.Background(), "abc")
	require.NoError(t, err)
	require.Equal(t, "https://images.unsplash.com/full.jpg", resolved.DownloadURL)
	require.Len(t, requests, 3)
	require.Contains(t, requests[1], "/download")
}

func TestRequestMapsProviderFailures(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return response(http.StatusTooManyRequests, `{}`), nil
	})}
	ctx := context.Background()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.example.test", nil)
	require.NoError(t, err)
	result, err := Request(ctx, client, request)
	if result != nil {
		require.NoError(t, result.Body.Close())
	}
	require.ErrorIs(t, err, ErrRateLimited)
}
