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

func response(body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestPexelsNormalizesPhotoAndKeepsCredentialServerSide(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		require.Equal(t, "pexels-secret", request.Header.Get("Authorization"))
		require.Equal(t, "desk", request.URL.Query().Get("query"))
		require.Equal(t, "portrait", request.URL.Query().Get("orientation"))
		require.Equal(t, "large", request.URL.Query().Get("size"))
		require.Equal(t, "blue", request.URL.Query().Get("color"))
		require.Equal(t, "pt-BR", request.URL.Query().Get("locale"))
		return response(`{
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

func TestUnsplashSelectionTracksDownloadBeforeResolve(t *testing.T) {
	var requests []string
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests = append(requests, request.URL.String())
		require.Equal(t, "Client-ID unsplash-secret", request.Header.Get("Authorization"))
		if strings.Contains(request.URL.Path, "/download") {
			return response(`{"url":"https://images.unsplash.com/file.jpg"}`), nil
		}
		return response(`{
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

func TestPixabayResolveReturnsTheOriginalPhoto(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		require.Equal(t, "pixabay.com", request.URL.Host)
		require.Equal(t, "42", request.URL.Query().Get("id"))
		return response(`{"hits":[{
			"id":42,
			"pageURL":"https://pixabay.com/photos/example-42/",
			"tags":"example",
			"webformatURL":"https://cdn.pixabay.com/photo/web.jpg",
			"largeImageURL":"https://cdn.pixabay.com/photo/large.jpg",
			"fullHDURL":"https://cdn.pixabay.com/photo/fullhd.jpg",
			"imageURL":"https://cdn.pixabay.com/photo/original.png",
			"imageWidth":4000,
			"imageHeight":3000,
			"user":"A Creator",
			"user_id":7
		}]}`), nil
	})}

	resolved, err := NewPixabay("key", client).Resolve(context.Background(), "photo:42")
	require.NoError(t, err)
	require.Equal(t, "https://cdn.pixabay.com/photo/original.png", resolved.DownloadURL)
	require.Equal(t, "image/png", resolved.MIMEType)
	require.Equal(t, "photo:42", resolved.ExternalID)
	require.Equal(t, 4000, resolved.Width)
	require.Equal(t, 3000, resolved.Height)
}
