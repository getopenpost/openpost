package stockmedia

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

const (
	pixabayAPIBase     = "https://pixabay.com/api/"
	pixabayProviderURL = "https://pixabay.com"
	pixabayLicenseURL  = "https://pixabay.com/service/license-summary/"
)

type PixabayAdapter struct {
	key    string
	client *http.Client
}

func NewPixabay(key string, client *http.Client) *PixabayAdapter {
	return &PixabayAdapter{key: strings.TrimSpace(key), client: Client(client)}
}

func (a *PixabayAdapter) Key() string { return "pixabay" }
func (a *PixabayAdapter) Capabilities() Capabilities {
	return Capabilities{
		Photos: true, Videos: true,
		PhotoFilters: []string{"orientation", "media_subtype", "category", "color", "order", "editors_choice", "min_dimensions", "locale"},
		VideoFilters: []string{"orientation", "category", "order", "editors_choice", "min_dimensions", "locale"},
	}
}

type pixabayImage struct {
	ID            int    `json:"id"`
	PageURL       string `json:"pageURL"`
	Tags          string `json:"tags"`
	WebformatURL  string `json:"webformatURL"`
	LargeImageURL string `json:"largeImageURL"`
	ImageWidth    int    `json:"imageWidth"`
	ImageHeight   int    `json:"imageHeight"`
	User          string `json:"user"`
	UserImageURL  string `json:"userImageURL"`
	UserID        int    `json:"user_id"`
}

type pixabayVideoFile struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Size   int64  `json:"size"`
}

type pixabayVideo struct {
	ID        int    `json:"id"`
	PageURL   string `json:"pageURL"`
	Tags      string `json:"tags"`
	Duration  int    `json:"duration"`
	PictureID string `json:"picture_id"`
	User      string `json:"user"`
	UserID    int    `json:"user_id"`
	Videos    struct {
		Large  pixabayVideoFile `json:"large"`
		Medium pixabayVideoFile `json:"medium"`
		Small  pixabayVideoFile `json:"small"`
		Tiny   pixabayVideoFile `json:"tiny"`
	} `json:"videos"`
}

func (a *PixabayAdapter) Search(ctx context.Context, query SearchQuery) (SearchPage, error) {
	query, err := NormalizeQuery(query)
	if err != nil {
		return SearchPage{}, err
	}
	endpoint := pixabayAPIBase
	if query.Kind == "video" {
		endpoint += "videos/"
	}
	values := url.Values{
		"key":        []string{a.key},
		"q":          []string{query.Query},
		"page":       []string{IntString(query.Page)},
		"per_page":   []string{IntString(query.PerPage)},
		"safesearch": []string{"true"},
	}
	applyPixabayFilters(values, query)
	var raw json.RawMessage
	if err := a.get(ctx, APIURL(endpoint, values), &raw); err != nil {
		return SearchPage{}, err
	}
	result := SearchPage{
		Page: query.Page, PerPage: query.PerPage, Provider: a.Key(), ProviderURL: pixabayProviderURL,
	}
	if query.Kind == "photo" {
		var payload struct {
			TotalHits int            `json:"totalHits"`
			Hits      []pixabayImage `json:"hits"`
		}
		if err := json.Unmarshal(raw, &payload); err != nil {
			return SearchPage{}, fmt.Errorf("%w: invalid Pixabay response", ErrUnavailable)
		}
		result.Total = payload.TotalHits
		for _, image := range payload.Hits {
			result.Items = append(result.Items, normalizePixabayImage(image))
		}
	} else {
		var payload struct {
			TotalHits int            `json:"totalHits"`
			Hits      []pixabayVideo `json:"hits"`
		}
		if err := json.Unmarshal(raw, &payload); err != nil {
			return SearchPage{}, fmt.Errorf("%w: invalid Pixabay response", ErrUnavailable)
		}
		result.Total = payload.TotalHits
		for _, video := range payload.Hits {
			result.Items = append(result.Items, normalizePixabayVideo(video))
		}
	}
	result.HasMore = query.Page*query.PerPage < result.Total
	return result, nil
}

func applyPixabayFilters(values url.Values, query SearchQuery) {
	if query.Orientation != "" && query.Orientation != "square" {
		orientation := map[string]string{"landscape": "horizontal", "portrait": "vertical"}[query.Orientation]
		if orientation != "" {
			values.Set("orientation", orientation)
		}
	}
	if query.Kind == "photo" && query.MediaSubtype != "" {
		values.Set("image_type", query.MediaSubtype)
	}
	if query.Category != "" {
		values.Set("category", query.Category)
	}
	if query.Kind == "photo" && query.Color != "" {
		values.Set("colors", query.Color)
	}
	if query.Order != "" {
		values.Set("order", query.Order)
	}
	if query.EditorsChoice {
		values.Set("editors_choice", "true")
	}
	if query.MinWidth > 0 {
		values.Set("min_width", IntString(query.MinWidth))
	}
	if query.MinHeight > 0 {
		values.Set("min_height", IntString(query.MinHeight))
	}
	if query.Locale != "" {
		values.Set("lang", query.Locale)
	}
}

func (a *PixabayAdapter) Resolve(ctx context.Context, externalID string) (ResolvedAsset, error) {
	kind, id, ok := strings.Cut(strings.TrimSpace(externalID), ":")
	if !ok {
		return ResolvedAsset{}, ErrNotFound
	}
	values := url.Values{"key": []string{a.key}, "id": []string{id}}
	var raw json.RawMessage
	endpoint := pixabayAPIBase
	if kind == "video" {
		endpoint += "videos/"
	}
	if err := a.get(ctx, APIURL(endpoint, values), &raw); err != nil {
		return ResolvedAsset{}, err
	}
	if kind == "photo" {
		var payload struct {
			Hits []pixabayImage `json:"hits"`
		}
		if json.Unmarshal(raw, &payload) != nil || len(payload.Hits) == 0 {
			return ResolvedAsset{}, ErrNotFound
		}
		item := payload.Hits[0]
		return ResolvedAsset{
			Asset: normalizePixabayImage(item), DownloadURL: SafeHTTPSURL(item.LargeImageURL), MIMEType: "image/jpeg",
		}, nil
	}
	if kind == "video" {
		var payload struct {
			Hits []pixabayVideo `json:"hits"`
		}
		if json.Unmarshal(raw, &payload) != nil || len(payload.Hits) == 0 {
			return ResolvedAsset{}, ErrNotFound
		}
		item := payload.Hits[0]
		file := bestPixabayVideo(item)
		return ResolvedAsset{
			Asset: normalizePixabayVideo(item), DownloadURL: SafeHTTPSURL(file.URL), MIMEType: "video/mp4",
		}, nil
	}
	return ResolvedAsset{}, ErrNotFound
}

func (a *PixabayAdapter) TrackSelection(context.Context, string) error { return nil }

func (a *PixabayAdapter) get(ctx context.Context, rawURL string, destination any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	resp, err := Request(ctx, a.client, req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(destination); err != nil {
		return fmt.Errorf("%w: invalid Pixabay response", ErrUnavailable)
	}
	return nil
}

func normalizePixabayImage(item pixabayImage) Asset {
	return Asset{
		ExternalID: "photo:" + strconv.Itoa(item.ID), Kind: "photo", Title: strings.TrimSpace(item.Tags),
		Width: item.ImageWidth, Height: item.ImageHeight, ThumbnailURL: SafeHTTPSURL(item.WebformatURL),
		PreviewURL: SafeHTTPSURL(item.LargeImageURL), SourceURL: SafeHTTPSURL(item.PageURL),
		CreatorName: strings.TrimSpace(item.User), CreatorURL: pixabayCreatorURL(item.UserID),
		Provider: "pixabay", ProviderURL: pixabayProviderURL,
		AttributionText: "Image by " + strings.TrimSpace(item.User) + " on Pixabay",
		LicenseName:     "Pixabay Content License", LicenseURL: pixabayLicenseURL,
	}
}

func normalizePixabayVideo(item pixabayVideo) Asset {
	file := bestPixabayVideo(item)
	return Asset{
		ExternalID: "video:" + strconv.Itoa(item.ID), Kind: "video", Title: strings.TrimSpace(item.Tags),
		Width: file.Width, Height: file.Height, DurationSeconds: item.Duration,
		ThumbnailURL: SafeHTTPSURL("https://i.vimeocdn.com/video/" + item.PictureID + "_640x360.jpg"),
		PreviewURL:   SafeHTTPSURL(file.URL), SourceURL: SafeHTTPSURL(item.PageURL),
		CreatorName: strings.TrimSpace(item.User), CreatorURL: pixabayCreatorURL(item.UserID),
		Provider: "pixabay", ProviderURL: pixabayProviderURL,
		AttributionText: "Video by " + strings.TrimSpace(item.User) + " on Pixabay",
		LicenseName:     "Pixabay Content License", LicenseURL: pixabayLicenseURL,
	}
}

func bestPixabayVideo(item pixabayVideo) pixabayVideoFile {
	for _, file := range []pixabayVideoFile{item.Videos.Large, item.Videos.Medium, item.Videos.Small, item.Videos.Tiny} {
		if SafeHTTPSURL(file.URL) != "" && file.Width <= 1920 && file.Height <= 1920 {
			return file
		}
	}
	return item.Videos.Tiny
}

func pixabayCreatorURL(userID int) string {
	if userID <= 0 {
		return pixabayProviderURL
	}
	return pixabayProviderURL + "/users/" + strconv.Itoa(userID) + "/"
}
