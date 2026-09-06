package memes

import (
	"context"
	"errors"
	"fmt"
	"time"
)

const BuiltinProviderKey = "openpost"

var (
	ErrDisabled          = errors.New("meme provider is disabled")
	ErrInvalidRequest    = errors.New("invalid meme provider request")
	ErrNotFound          = errors.New("meme template not found")
	ErrUnauthorized      = errors.New("meme provider authorization failed")
	ErrRateLimited       = errors.New("meme provider rate limited")
	ErrUnavailable       = errors.New("meme provider unavailable")
	ErrInvalidResponse   = errors.New("invalid meme provider response")
	ErrResponseTooLarge  = errors.New("meme provider response is too large")
	ErrUnsafeResponseURL = errors.New("meme provider returned an unsafe URL")
)

// ErrorKind is stable enough for handlers to map provider failures without
// parsing human-readable error messages.
type ErrorKind string

const (
	ErrorKindDisabled          ErrorKind = "disabled"
	ErrorKindInvalidRequest    ErrorKind = "invalid_request"
	ErrorKindNotFound          ErrorKind = "not_found"
	ErrorKindUnauthorized      ErrorKind = "unauthorized"
	ErrorKindRateLimited       ErrorKind = "rate_limited"
	ErrorKindUnavailable       ErrorKind = "unavailable"
	ErrorKindInvalidResponse   ErrorKind = "invalid_response"
	ErrorKindResponseTooLarge  ErrorKind = "response_too_large"
	ErrorKindUnsafeResponseURL ErrorKind = "unsafe_response_url"
)

// ProviderError deliberately excludes response bodies and user captions from
// Error() so render failures never leak draft content into logs.
type ProviderError struct {
	Kind       ErrorKind
	Operation  string
	StatusCode int
	RetryAfter time.Duration
	Cause      error
}

func (e *ProviderError) Error() string {
	if e == nil {
		return "meme provider error"
	}
	if e.StatusCode > 0 {
		return fmt.Sprintf("meme provider %s failed with HTTP %d", e.Operation, e.StatusCode)
	}
	return fmt.Sprintf("meme provider %s failed: %s", e.Operation, e.Kind)
}

func (e *ProviderError) Unwrap() error { return e.Cause }

func (e *ProviderError) Is(target error) bool {
	if e == nil {
		return false
	}
	if target == sentinelForKind(e.Kind) {
		return true
	}
	return e.Cause != nil && errors.Is(e.Cause, target)
}

func sentinelForKind(kind ErrorKind) error {
	switch kind {
	case ErrorKindDisabled:
		return ErrDisabled
	case ErrorKindInvalidRequest:
		return ErrInvalidRequest
	case ErrorKindNotFound:
		return ErrNotFound
	case ErrorKindUnauthorized:
		return ErrUnauthorized
	case ErrorKindRateLimited:
		return ErrRateLimited
	case ErrorKindUnavailable:
		return ErrUnavailable
	case ErrorKindInvalidResponse:
		return ErrInvalidResponse
	case ErrorKindResponseTooLarge:
		return ErrResponseTooLarge
	case ErrorKindUnsafeResponseURL:
		return ErrUnsafeResponseURL
	default:
		return nil
	}
}

type TemplateExample struct {
	Text []string `json:"text"`
	URL  string   `json:"url"`
}

// Template is a normalized OpenPost template. SearchTerms are generated from
// stable discovery fields so callers do not need to reproduce normalization.
type Template struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Lines       int              `json:"lines"`
	Overlays    int              `json:"overlays"`
	Styles      []string         `json:"styles"`
	BlankURL    string           `json:"blank_url"`
	Example     TemplateExample  `json:"example"`
	SourceURL   string           `json:"source_url"`
	Keywords    []string         `json:"keywords"`
	SearchTerms []string         `json:"search_terms"`
	Animated    bool             `json:"animated"`
	Semantic    TemplateSemantic `json:"semantic"`
	searchText  string
}

// TemplateSemantic gives AI and user interfaces the visual joke contract for
// a built-in template. CaptionRoles always follow the rendered field order.
type TemplateSemantic struct {
	Visual       string   `json:"visual"`
	Meaning      string   `json:"meaning"`
	Mechanism    string   `json:"mechanism"`
	CaptionRoles []string `json:"caption_roles"`
	Tags         []string `json:"tags"`
}

type Catalog struct {
	Templates   []Template `json:"templates"`
	RefreshedAt time.Time  `json:"refreshed_at"`
	Stale       bool       `json:"stale"`
	Revision    string     `json:"revision,omitempty"`
}

type RenderRequest struct {
	TemplateID    string         `json:"template_id"`
	Text          []string       `json:"text"`
	Styles        []string       `json:"styles,omitempty"`
	OverlayURLs   []string       `json:"overlay_urls,omitempty"`
	OverlayImages []OverlayImage `json:"-"`
	Extension     string         `json:"extension,omitempty"`
	Layout        string         `json:"layout,omitempty"`
	Font          string         `json:"font,omitempty"`
}

// OverlayImage keeps workspace media inside OpenPost's process. The built-in
// renderer only reads these bounded bytes.
type OverlayImage struct {
	Data     []byte
	MIMEType string
}

type RenderedImage struct {
	Data       []byte `json:"-"`
	MIMEType   string `json:"mime_type"`
	Extension  string `json:"extension"`
	TemplateID string `json:"template_id"`
}

type Health struct {
	Available     bool      `json:"available"`
	Ready         bool      `json:"ready"`
	CatalogCached bool      `json:"catalog_cached"`
	CatalogStale  bool      `json:"catalog_stale"`
	TemplateCount int       `json:"template_count"`
	RefreshedAt   time.Time `json:"refreshed_at,omitempty"`
}

type Provider interface {
	Key() string
	Available() bool
	Health(context.Context) (Health, error)
	Templates(context.Context) (Catalog, error)
	Search(context.Context, string, int) (Catalog, error)
	Render(context.Context, RenderRequest) (RenderedImage, error)
}

// TemplateImageProvider is an optional provider capability for safely loading
// catalog images through the backend. OpenPost uses it instead of exposing
// provider URLs or server-only credentials to browsers.
type TemplateImageProvider interface {
	TemplateImage(context.Context, string) (RenderedImage, error)
}
