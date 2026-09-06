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
	pexelsAPIBase     = "https://api.pexels.com"
	pexelsProviderURL = "https://www.pexels.com"
	pexelsLicenseURL  = "https://www.pexels.com/license/"
)

type PexelsAdapter struct {
	key    string
	client *http.Client
}

func NewPexels(key string, client *http.Client) *PexelsAdapter {
	return &PexelsAdapter{key: strings.TrimSpace(key), client: Client(client)}
}

func (a *PexelsAdapter) Key() string { return "pexels" }
func (a *PexelsAdapter) Capabilities() Capabilities {
	return Capabilities{
		Photos: true, Videos: true,
		PhotoFilters: []string{"orientation", "size", "color", "locale"},
		VideoFilters: []string{"orientation", "size", "locale"},
	}
}

type pexelsPhoto struct {
	ID              int    `json:"id"`
	Width           int    `json:"width"`
	Height          int    `json:"height"`
	URL             string `json:"url"`
	Photographer    string `json:"photographer"`
	PhotographerURL string `json:"photographer_url"`
	Alt             string `json:"alt"`
	Src             struct {
		Large2X  string `json:"large2x"`
		Large    string `json:"large"`
		Medium   string `json:"medium"`
		Original string `json:"original"`
	} `json:"src"`
}

type pexelsVideoFile struct {
	ID       int    `json:"id"`
	Quality  string `json:"quality"`
	FileType string `json:"file_type"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Link     string `json:"link"`
}

type pexelsVideo struct {
	ID         int                        `json:"id"`
	Width      int                        `json:"width"`
	Height     int                        `json:"height"`
	Duration   int                        `json:"duration"`
	URL        string                     `json:"url"`
	User       struct{ Name, URL string } `json:"user"`
	Image      string                     `json:"image"`
	VideoFiles []pexelsVideoFile          `json:"video_files"`
}

func (a *PexelsAdapter) Search(ctx context.Context, query SearchQuery) (SearchPage, error) {
	query, err := NormalizeQuery(query)
	if err != nil {
		return SearchPage{}, err
	}
	path := "/v1/search"
	if query.Kind == "video" {
		path = "/videos/search"
	}
	values := url.Values{
		"query":    []string{query.Query},
		"page":     []string{IntString(query.Page)},
		"per_page": []string{IntString(query.PerPage)},
	}
	if query.Orientation != "" {
		values.Set("orientation", query.Orientation)
	}
	if query.Size != "" {
		values.Set("size", query.Size)
	}
	if query.Kind == "photo" && query.Color != "" {
		values.Set("color", query.Color)
	}
	if query.Locale != "" {
		values.Set("locale", query.Locale)
	}
	var payload struct {
		Page     int           `json:"page"`
		PerPage  int           `json:"per_page"`
		Total    int           `json:"total_results"`
		NextPage string        `json:"next_page"`
		Photos   []pexelsPhoto `json:"photos"`
		Videos   []pexelsVideo `json:"videos"`
	}
	if err := a.get(ctx, APIURL(pexelsAPIBase+path, values), &payload); err != nil {
		return SearchPage{}, err
	}
	result := SearchPage{
		Page: payload.Page, PerPage: payload.PerPage, Total: payload.Total,
		HasMore: payload.NextPage != "", Provider: a.Key(), ProviderURL: pexelsProviderURL,
	}
	for _, photo := range payload.Photos {
		result.Items = append(result.Items, normalizePexelsPhoto(photo))
	}
	for _, video := range payload.Videos {
		result.Items = append(result.Items, normalizePexelsVideo(video))
	}
	return result, nil
}

func (a *PexelsAdapter) Resolve(ctx context.Context, externalID string) (ResolvedAsset, error) {
	kind, id, ok := strings.Cut(strings.TrimSpace(externalID), ":")
	if !ok {
		return ResolvedAsset{}, ErrNotFound
	}
	switch kind {
	case "photo":
		var photo pexelsPhoto
		if err := a.get(ctx, pexelsAPIBase+"/v1/photos/"+url.PathEscape(id), &photo); err != nil {
			return ResolvedAsset{}, err
		}
		asset := normalizePexelsPhoto(photo)
		return ResolvedAsset{Asset: asset, DownloadURL: SafeHTTPSURL(photo.Src.Original), MIMEType: "image/jpeg"}, nil
	case "video":
		var video pexelsVideo
		if err := a.get(ctx, pexelsAPIBase+"/videos/videos/"+url.PathEscape(id), &video); err != nil {
			return ResolvedAsset{}, err
		}
		asset := normalizePexelsVideo(video)
		file := bestPexelsVideoFile(video.VideoFiles)
		if file.Link == "" {
			return ResolvedAsset{}, ErrNotFound
		}
		return ResolvedAsset{Asset: asset, DownloadURL: SafeHTTPSURL(file.Link), MIMEType: file.FileType}, nil
	default:
		return ResolvedAsset{}, ErrNotFound
	}
}

func (a *PexelsAdapter) TrackSelection(context.Context, string) error { return nil }

func (a *PexelsAdapter) get(ctx context.Context, rawURL string, destination any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", a.key)
	resp, err := Request(ctx, a.client, req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(destination); err != nil {
		return fmt.Errorf("%w: invalid Pexels response", ErrUnavailable)
	}
	return nil
}

func normalizePexelsPhoto(photo pexelsPhoto) Asset {
	thumb := photo.Src.Medium
	preview := photo.Src.Large
	if preview == "" {
		preview = photo.Src.Large2X
	}
	return Asset{
		ExternalID: "photo:" + strconv.Itoa(photo.ID), Kind: "photo", Title: strings.TrimSpace(photo.Alt),
		Width: photo.Width, Height: photo.Height, ThumbnailURL: SafeHTTPSURL(thumb),
		PreviewURL: SafeHTTPSURL(preview), SourceURL: SafeHTTPSURL(photo.URL),
		CreatorName: strings.TrimSpace(photo.Photographer), CreatorURL: SafeHTTPSURL(photo.PhotographerURL),
		Provider: "pexels", ProviderURL: pexelsProviderURL,
		AttributionText: "Photo by " + strings.TrimSpace(photo.Photographer) + " on Pexels",
		LicenseName:     "Pexels License", LicenseURL: pexelsLicenseURL,
	}
}

func normalizePexelsVideo(video pexelsVideo) Asset {
	preview := bestPexelsVideoFile(video.VideoFiles).Link
	return Asset{
		ExternalID: "video:" + strconv.Itoa(video.ID), Kind: "video", Title: "Pexels video",
		Width: video.Width, Height: video.Height, DurationSeconds: video.Duration,
		ThumbnailURL: SafeHTTPSURL(video.Image), PreviewURL: SafeHTTPSURL(preview), SourceURL: SafeHTTPSURL(video.URL),
		CreatorName: strings.TrimSpace(video.User.Name), CreatorURL: SafeHTTPSURL(video.User.URL),
		Provider: "pexels", ProviderURL: pexelsProviderURL,
		AttributionText: "Video by " + strings.TrimSpace(video.User.Name) + " on Pexels",
		LicenseName:     "Pexels License", LicenseURL: pexelsLicenseURL,
	}
}

func bestPexelsVideoFile(files []pexelsVideoFile) pexelsVideoFile {
	var best pexelsVideoFile
	for _, file := range files {
		if file.FileType != "video/mp4" || SafeHTTPSURL(file.Link) == "" {
			continue
		}
		if file.Width <= 1920 && file.Height <= 1920 && file.Width*file.Height > best.Width*best.Height {
			best = file
		}
	}
	if best.Link == "" {
		for _, file := range files {
			if file.FileType == "video/mp4" && SafeHTTPSURL(file.Link) != "" {
				return file
			}
		}
	}
	return best
}
