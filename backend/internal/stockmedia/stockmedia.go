package stockmedia

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var (
	ErrNotFound    = errors.New("stock media not found")
	ErrRateLimited = errors.New("stock media provider rate limited")
	ErrUnavailable = errors.New("stock media provider unavailable")
)

type Capabilities struct {
	Photos bool `json:"photos"`
	Videos bool `json:"videos"`
	Audio  bool `json:"audio"`
}

type SearchQuery struct {
	Query       string
	Kind        string
	Orientation string
	Page        int
	PerPage     int
}

type Asset struct {
	ExternalID      string `json:"external_id"`
	Kind            string `json:"kind"`
	Title           string `json:"title"`
	Width           int    `json:"width"`
	Height          int    `json:"height"`
	DurationSeconds int    `json:"duration_seconds,omitempty"`
	ThumbnailURL    string `json:"thumbnail_url"`
	PreviewURL      string `json:"preview_url,omitempty"`
	SourceURL       string `json:"source_url"`
	CreatorName     string `json:"creator_name"`
	CreatorURL      string `json:"creator_url"`
	Provider        string `json:"provider"`
	ProviderURL     string `json:"provider_url"`
	AttributionText string `json:"attribution_text"`
	LicenseName     string `json:"license_name"`
	LicenseURL      string `json:"license_url"`
}

type SearchPage struct {
	Items       []Asset `json:"items"`
	Page        int     `json:"page"`
	PerPage     int     `json:"per_page"`
	Total       int     `json:"total"`
	HasMore     bool    `json:"has_more"`
	Provider    string  `json:"provider"`
	ProviderURL string  `json:"provider_url"`
}

type ResolvedAsset struct {
	Asset
	DownloadURL string `json:"download_url"`
	MIMEType    string `json:"mime_type"`
}

type Adapter interface {
	Key() string
	Capabilities() Capabilities
	Search(context.Context, SearchQuery) (SearchPage, error)
	Resolve(context.Context, string) (ResolvedAsset, error)
	TrackSelection(context.Context, string) error
}

type HTTPError struct {
	StatusCode int
	Body       string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("stock provider returned HTTP %d", e.StatusCode)
}

func Request(ctx context.Context, client *http.Client, req *http.Request) (*http.Response, error) {
	resp, err := client.Do(req.WithContext(ctx))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return resp, nil
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusNotFound:
		return nil, ErrNotFound
	case http.StatusTooManyRequests:
		return nil, ErrRateLimited
	default:
		return nil, &HTTPError{StatusCode: resp.StatusCode}
	}
}

func Client(client *http.Client) *http.Client {
	if client != nil {
		return client
	}
	return &http.Client{Timeout: 12 * time.Second}
}

func NormalizeQuery(query SearchQuery) (SearchQuery, error) {
	query.Query = strings.TrimSpace(query.Query)
	query.Kind = strings.ToLower(strings.TrimSpace(query.Kind))
	query.Orientation = strings.ToLower(strings.TrimSpace(query.Orientation))
	if query.Query == "" || len([]rune(query.Query)) > 120 {
		return query, errors.New("query must contain between 1 and 120 characters")
	}
	if query.Kind == "" {
		query.Kind = "photo"
	}
	if query.Kind != "photo" && query.Kind != "video" {
		return query, errors.New("kind must be photo or video")
	}
	switch query.Orientation {
	case "", "landscape", "portrait", "square":
	default:
		return query, errors.New("orientation must be landscape, portrait, or square")
	}
	if query.Page < 1 {
		query.Page = 1
	}
	if query.PerPage < 1 {
		query.PerPage = 24
	}
	if query.PerPage > 40 {
		query.PerPage = 40
	}
	return query, nil
}

func APIURL(base string, values url.Values) string {
	if len(values) == 0 {
		return base
	}
	return base + "?" + values.Encode()
}

func IntString(value int) string {
	return strconv.Itoa(value)
}

func SafeHTTPSURL(value string) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return ""
	}
	return parsed.String()
}
