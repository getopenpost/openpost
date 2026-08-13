package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/ratelimit"
	"github.com/openpost/backend/internal/stockmedia"
	"github.com/uptrace/bun"
)

const (
	stockSearchLimit    = 60
	stockSelectionLimit = 30
)

type StockMediaHandler struct {
	db       *bun.DB
	enabled  bool
	adapters map[string]stockmedia.Adapter
	limiter  *ratelimit.Limiter
	now      func() time.Time
}

func NewStockMediaHandler(
	db *bun.DB,
	enabled bool,
	pexelsKey string,
	unsplashKey string,
	pixabayKey string,
) *StockMediaHandler {
	adapters := make(map[string]stockmedia.Adapter)
	if enabled {
		if strings.TrimSpace(pexelsKey) != "" {
			adapters["pexels"] = stockmedia.NewPexels(pexelsKey, nil)
		}
		if strings.TrimSpace(unsplashKey) != "" {
			adapters["unsplash"] = stockmedia.NewUnsplash(unsplashKey, nil)
		}
		if strings.TrimSpace(pixabayKey) != "" {
			adapters["pixabay"] = stockmedia.NewPixabay(pixabayKey, nil)
		}
	}
	return &StockMediaHandler{
		db: db, enabled: enabled, adapters: adapters, limiter: ratelimit.New(),
		now: func() time.Time { return time.Now().UTC() },
	}
}

func (h *StockMediaHandler) ProviderKeys() []string {
	keys := make([]string, 0, len(h.adapters))
	for key := range h.adapters {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

type StockProviderResponse struct {
	Key          string   `json:"key"`
	Name         string   `json:"name"`
	ProviderURL  string   `json:"provider_url"`
	Photos       bool     `json:"photos"`
	Videos       bool     `json:"videos"`
	Audio        bool     `json:"audio"`
	PhotoFilters []string `json:"photo_filters,omitempty"`
	VideoFilters []string `json:"video_filters,omitempty"`
	Attribution  string   `json:"attribution"`
}

type ListStockProvidersOutput struct {
	Body struct {
		Enabled   bool                    `json:"enabled"`
		Providers []StockProviderResponse `json:"providers"`
	}
}

type SearchStockMediaInput struct {
	Provider      string `query:"provider" required:"true" enum:"pexels,unsplash,pixabay"`
	Query         string `query:"query" required:"true" minLength:"1" maxLength:"120"`
	Kind          string `query:"kind" default:"photo" enum:"photo,video"`
	Orientation   string `query:"orientation" enum:"landscape,portrait,square"`
	Size          string `query:"size" enum:"small,medium,large"`
	Color         string `query:"color" maxLength:"80"`
	Locale        string `query:"locale" maxLength:"12"`
	Order         string `query:"order" enum:"relevant,latest,popular"`
	ContentFilter string `query:"content_filter" enum:"low,high"`
	Collections   string `query:"collections" maxLength:"500"`
	Category      string `query:"category" maxLength:"40"`
	MediaSubtype  string `query:"media_subtype" enum:"all,photo,illustration,vector"`
	EditorsChoice bool   `query:"editors_choice"`
	MinWidth      int    `query:"min_width" minimum:"0" maximum:"20000"`
	MinHeight     int    `query:"min_height" minimum:"0" maximum:"20000"`
	Page          int    `query:"page" default:"1" minimum:"1" maximum:"500"`
	PerPage       int    `query:"per_page" default:"24" minimum:"1" maximum:"40"`
}

type SearchStockMediaOutput struct {
	CacheControl string                `header:"Cache-Control"`
	Body         stockmedia.SearchPage `json:"body"`
}

type SelectStockMediaInput struct {
	Body struct {
		Provider   string `json:"provider" required:"true" enum:"pexels,unsplash,pixabay"`
		ExternalID string `json:"external_id" required:"true" minLength:"1" maxLength:"160"`
	}
}

type SelectStockMediaOutput struct {
	Body stockmedia.ResolvedAsset
}

func (h *StockMediaHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-stock-media-providers",
		Method:      http.MethodGet,
		Path:        "/stock-media/providers",
		Summary:     "List configured stock media providers",
		Tags:        []string{tagVideoEditor},
	}, func(context.Context, *struct{}) (*ListStockProvidersOutput, error) {
		out := &ListStockProvidersOutput{}
		out.Body.Enabled = h.enabled && len(h.adapters) > 0
		for _, key := range h.ProviderKeys() {
			adapter := h.adapters[key]
			capabilities := adapter.Capabilities()
			out.Body.Providers = append(out.Body.Providers, StockProviderResponse{
				Key: key, Name: stockProviderName(key), ProviderURL: stockProviderURL(key),
				Photos: capabilities.Photos, Videos: capabilities.Videos, Audio: capabilities.Audio,
				PhotoFilters: capabilities.PhotoFilters, VideoFilters: capabilities.VideoFilters,
				Attribution: stockProviderAttribution(key),
			})
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "search-stock-media",
		Method:      http.MethodGet,
		Path:        "/stock-media/search",
		Summary:     "Search configured stock photo and video providers",
		Tags:        []string{tagVideoEditor},
		Errors:      []int{400, 404, 429, 502, 503},
	}, func(ctx context.Context, input *SearchStockMediaInput) (*SearchStockMediaOutput, error) {
		if !h.allow(ctx, "search", stockSearchLimit) {
			return nil, huma.Error429TooManyRequests("stock search limit reached; try again in one minute")
		}
		adapter, err := h.adapter(input.Provider)
		if err != nil {
			return nil, err
		}
		query, err := stockmedia.NormalizeQuery(stockmedia.SearchQuery{
			Query: input.Query, Kind: input.Kind, Orientation: input.Orientation,
			Size: input.Size, Color: input.Color, Locale: input.Locale, Order: input.Order,
			ContentFilter: input.ContentFilter, Collections: input.Collections,
			Category: input.Category, MediaSubtype: input.MediaSubtype,
			EditorsChoice: input.EditorsChoice, MinWidth: input.MinWidth, MinHeight: input.MinHeight,
			Page: input.Page, PerPage: input.PerPage,
		})
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		page, hit, err := h.cachedSearch(ctx, adapter, query)
		if err != nil {
			return nil, stockMediaError(err)
		}
		out := &SearchStockMediaOutput{}
		out.CacheControl = "public, max-age=60"
		out.Body = page
		if hit {
			out.CacheControl = "public, max-age=300"
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "select-stock-media",
		Method:      http.MethodPost,
		Path:        "/stock-media/selections",
		Summary:     "Resolve a selected stock asset and record provider attribution events",
		Tags:        []string{tagVideoEditor},
		Errors:      []int{400, 404, 429, 502, 503},
	}, func(ctx context.Context, input *SelectStockMediaInput) (*SelectStockMediaOutput, error) {
		if !h.allow(ctx, "selection", stockSelectionLimit) {
			return nil, huma.Error429TooManyRequests("stock selection limit reached; try again in one minute")
		}
		adapter, err := h.adapter(input.Body.Provider)
		if err != nil {
			return nil, err
		}
		externalID := strings.TrimSpace(input.Body.ExternalID)
		if err := adapter.TrackSelection(ctx, externalID); err != nil {
			return nil, stockMediaError(err)
		}
		resolved, err := adapter.Resolve(ctx, externalID)
		if err != nil {
			return nil, stockMediaError(err)
		}
		sanitizeStockAsset(&resolved.Asset)
		if resolved.DownloadURL == "" {
			return nil, huma.Error404NotFound("the selected stock asset is no longer available")
		}
		return &SelectStockMediaOutput{Body: resolved}, nil
	})
}

func (h *StockMediaHandler) adapter(key string) (stockmedia.Adapter, error) {
	if !h.enabled {
		return nil, huma.Error503ServiceUnavailable("stock media is not enabled on this OpenPost instance")
	}
	adapter := h.adapters[strings.ToLower(strings.TrimSpace(key))]
	if adapter == nil {
		return nil, huma.Error404NotFound("stock provider is not configured on this OpenPost instance")
	}
	return adapter, nil
}

func (h *StockMediaHandler) allow(ctx context.Context, action string, limit int) bool {
	ip := strings.TrimSpace(middleware.GetClientIP(ctx))
	if ip == "" {
		ip = "unknown"
	}
	return h.limiter.Allow("stock:"+action+":"+ip, limit, time.Minute)
}

func (h *StockMediaHandler) cachedSearch(
	ctx context.Context,
	adapter stockmedia.Adapter,
	query stockmedia.SearchQuery,
) (stockmedia.SearchPage, bool, error) {
	keyBytes, _ := json.Marshal(query)
	hash := sha256.Sum256(keyBytes)
	queryHash := hex.EncodeToString(hash[:])
	now := h.now()
	if h.db != nil {
		var cached models.StockSearchCache
		err := h.db.NewSelect().Model(&cached).
			Where("provider = ? AND media_kind = ? AND query_hash = ?", adapter.Key(), query.Kind, queryHash).
			Where("expires_at > ?", now).
			Scan(ctx)
		if err == nil {
			var page stockmedia.SearchPage
			if json.Unmarshal([]byte(cached.NormalizedResponseJSON), &page) == nil {
				return page, true, nil
			}
		}
	}
	page, err := adapter.Search(ctx, query)
	if err != nil {
		return stockmedia.SearchPage{}, false, err
	}
	for index := range page.Items {
		sanitizeStockAsset(&page.Items[index])
	}
	if h.db != nil {
		encoded, err := json.Marshal(page)
		if err == nil {
			ttl := 15 * time.Minute
			if adapter.Key() == "pixabay" {
				ttl = 24 * time.Hour
			}
			cache := &models.StockSearchCache{
				Provider: adapter.Key(), MediaKind: query.Kind, QueryHash: queryHash,
				NormalizedResponseJSON: string(encoded), ExpiresAt: now.Add(ttl),
				CreatedAt: now, UpdatedAt: now,
			}
			_, _ = h.db.NewInsert().Model(cache).
				On("CONFLICT (provider, media_kind, query_hash) DO UPDATE").
				Set("normalized_response_json = EXCLUDED.normalized_response_json").
				Set("expires_at = EXCLUDED.expires_at").
				Set("updated_at = EXCLUDED.updated_at").
				Exec(ctx)
		}
	}
	return page, false, nil
}

func sanitizeStockAsset(asset *stockmedia.Asset) {
	asset.Title = cleanStockText(asset.Title, 240)
	asset.CreatorName = cleanStockText(asset.CreatorName, 120)
	asset.AttributionText = cleanStockText(asset.AttributionText, 320)
}

func cleanStockText(value string, max int) string {
	value = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.TrimSpace(value))
	runes := []rune(value)
	if len(runes) > max {
		runes = runes[:max]
	}
	return string(runes)
}

func stockMediaError(err error) error {
	switch {
	case errors.Is(err, stockmedia.ErrNotFound):
		return huma.Error404NotFound("the stock asset is no longer available")
	case errors.Is(err, stockmedia.ErrRateLimited):
		return huma.Error429TooManyRequests("the stock provider is rate limited; try again later")
	case errors.Is(err, stockmedia.ErrUnavailable):
		return huma.Error503ServiceUnavailable("the stock provider is temporarily unavailable")
	default:
		var providerErr *stockmedia.HTTPError
		if errors.As(err, &providerErr) {
			return huma.Error502BadGateway(fmt.Sprintf("stock provider request failed with HTTP %d", providerErr.StatusCode))
		}
		return huma.Error400BadRequest(err.Error())
	}
}

func stockProviderName(key string) string {
	switch key {
	case "pexels":
		return "Pexels"
	case "unsplash":
		return "Unsplash"
	case "pixabay":
		return "Pixabay"
	default:
		return key
	}
}

func stockProviderURL(key string) string {
	switch key {
	case "pexels":
		return "https://www.pexels.com"
	case "unsplash":
		return "https://unsplash.com"
	case "pixabay":
		return "https://pixabay.com"
	default:
		return ""
	}
}

func stockProviderAttribution(key string) string {
	switch key {
	case "pexels":
		return "Photos and videos provided by Pexels"
	case "unsplash":
		return "Photos provided by Unsplash"
	case "pixabay":
		return "Images and videos provided by Pixabay"
	default:
		return ""
	}
}
