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

	page, err := adapter.Search(context.Background(), SearchQuery{Query: "desk", Kind: "photo"})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Equal(t, "photo:42", page.Items[0].ExternalID)
	require.Equal(t, "Photo by A Creator on Pexels", page.Items[0].AttributionText)
	encoded := page.Items[0].Title + page.Items[0].SourceURL + page.Items[0].PreviewURL
	require.NotContains(t, encoded, "pexels-secret")
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
