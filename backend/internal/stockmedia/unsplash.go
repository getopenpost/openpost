package stockmedia

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

const (
	unsplashAPIBase     = "https://api.unsplash.com"
	unsplashProviderURL = "https://unsplash.com"
	unsplashLicenseURL  = "https://unsplash.com/license"
)

type UnsplashAdapter struct {
	key    string
	client *http.Client
}

func NewUnsplash(key string, client *http.Client) *UnsplashAdapter {
	return &UnsplashAdapter{key: strings.TrimSpace(key), client: Client(client)}
}

func (a *UnsplashAdapter) Key() string { return "unsplash" }
func (a *UnsplashAdapter) Capabilities() Capabilities {
	return Capabilities{
		Photos:       true,
		PhotoFilters: []string{"orientation", "color", "order", "content_filter", "collections"},
	}
}

type unsplashPhoto struct {
	ID          string `json:"id"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	Description string `json:"description"`
	Alt         string `json:"alt_description"`
	URLs        struct {
		Thumb string `json:"thumb"`
		Small string `json:"small"`
		Full  string `json:"full"`
		Raw   string `json:"raw"`
	} `json:"urls"`
	Links struct {
		HTML             string `json:"html"`
		DownloadLocation string `json:"download_location"`
	} `json:"links"`
	User struct {
		Name  string `json:"name"`
		Links struct {
			HTML string `json:"html"`
		} `json:"links"`
	} `json:"user"`
}

func (a *UnsplashAdapter) Search(ctx context.Context, query SearchQuery) (SearchPage, error) {
	query, err := NormalizeQuery(query)
	if err != nil {
		return SearchPage{}, err
	}
	if query.Kind != "photo" {
		return SearchPage{}, errorsUnsupportedKind("unsplash", query.Kind)
	}
	values := url.Values{
		"query":    []string{query.Query},
		"page":     []string{IntString(query.Page)},
		"per_page": []string{IntString(query.PerPage)},
	}
	if query.Orientation != "" {
		orientation := query.Orientation
		if orientation == "square" {
			orientation = "squarish"
		}
		values.Set("orientation", orientation)
	}
	if query.Color != "" {
		values.Set("color", query.Color)
	}
	if query.Order != "" {
		values.Set("order_by", query.Order)
	}
	if query.ContentFilter != "" {
		values.Set("content_filter", query.ContentFilter)
	}
	if query.Collections != "" {
		values.Set("collections", query.Collections)
	}
	var payload struct {
		Total      int             `json:"total"`
		TotalPages int             `json:"total_pages"`
		Results    []unsplashPhoto `json:"results"`
	}
	if err := a.get(ctx, APIURL(unsplashAPIBase+"/search/photos", values), &payload); err != nil {
		return SearchPage{}, err
	}
	result := SearchPage{
		Page: query.Page, PerPage: query.PerPage, Total: payload.Total,
		HasMore: query.Page < payload.TotalPages, Provider: a.Key(), ProviderURL: unsplashProviderURL,
	}
	for _, photo := range payload.Results {
		result.Items = append(result.Items, normalizeUnsplashPhoto(photo))
	}
	return result, nil
}

func (a *UnsplashAdapter) Resolve(ctx context.Context, externalID string) (ResolvedAsset, error) {
	var photo unsplashPhoto
	if err := a.get(ctx, unsplashAPIBase+"/photos/"+url.PathEscape(strings.TrimSpace(externalID)), &photo); err != nil {
		return ResolvedAsset{}, err
	}
	download := photo.URLs.Full
	if download == "" {
		download = photo.URLs.Raw
	}
	return ResolvedAsset{
		Asset: normalizeUnsplashPhoto(photo), DownloadURL: SafeHTTPSURL(download), MIMEType: "image/jpeg",
	}, nil
}

func (a *UnsplashAdapter) TrackSelection(ctx context.Context, externalID string) error {
	var photo unsplashPhoto
	if err := a.get(ctx, unsplashAPIBase+"/photos/"+url.PathEscape(strings.TrimSpace(externalID)), &photo); err != nil {
		return err
	}
	if SafeHTTPSURL(photo.Links.DownloadLocation) == "" {
		return ErrNotFound
	}
	var tracked any
	return a.get(ctx, photo.Links.DownloadLocation, &tracked)
}

func (a *UnsplashAdapter) get(ctx context.Context, rawURL string, destination any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Client-ID "+a.key)
	req.Header.Set("Accept-Version", "v1")
	resp, err := Request(ctx, a.client, req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(destination); err != nil {
		return fmt.Errorf("%w: invalid Unsplash response", ErrUnavailable)
	}
	return nil
}

func normalizeUnsplashPhoto(photo unsplashPhoto) Asset {
	title := strings.TrimSpace(photo.Description)
	if title == "" {
		title = strings.TrimSpace(photo.Alt)
	}
	return Asset{
		ExternalID: photo.ID, Kind: "photo", Title: title, Width: photo.Width, Height: photo.Height,
		ThumbnailURL: SafeHTTPSURL(photo.URLs.Thumb), PreviewURL: SafeHTTPSURL(photo.URLs.Small),
		SourceURL: SafeHTTPSURL(photo.Links.HTML), CreatorName: strings.TrimSpace(photo.User.Name),
		CreatorURL: SafeHTTPSURL(photo.User.Links.HTML), Provider: "unsplash", ProviderURL: unsplashProviderURL,
		AttributionText: "Photo by " + strings.TrimSpace(photo.User.Name) + " on Unsplash",
		LicenseName:     "Unsplash License", LicenseURL: unsplashLicenseURL,
	}
}

func errorsUnsupportedKind(provider, kind string) error {
	return fmt.Errorf("%s does not support %s search", provider, kind)
}
