package handlers

import (
	"context"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

type AccessTokenSource interface {
	GetValidAccessToken(ctx context.Context, accountID string) (string, error)
}

type DestinationOptionsHandler struct {
	db          *bun.DB
	auth        middleware.Authenticator
	providers   map[string]platform.Adapter
	tokenSource AccessTokenSource
}

func NewDestinationOptionsHandler(db *bun.DB, auth middleware.Authenticator, providers map[string]platform.Adapter, tokenSource AccessTokenSource) *DestinationOptionsHandler {
	return &DestinationOptionsHandler{
		db:          db,
		auth:        auth,
		providers:   providers,
		tokenSource: tokenSource,
	}
}

type DestinationOptionsInput struct {
	AccountID  string `path:"account_id" doc:"Connected social account ID"`
	RegionCode string `query:"region_code" default:"US" doc:"ISO 3166-1 alpha-2 region code"`
	Language   string `query:"language" default:"en" doc:"Language code for provider labels"`
}

type DestinationOptionsOutput struct {
	Body struct {
		Options map[string][]platform.DestinationOption `json:"options"`
	}
}

type PublishingOptionsInput struct {
	AccountID string `path:"account_id" doc:"Connected social account ID"`
	Source    string `path:"source" doc:"Publishing option source"`
	Search    string `query:"search" doc:"Case-insensitive label search"`
	Locale    string `query:"locale" default:"en" doc:"BCP 47 locale"`
	Region    string `query:"region" default:"US" doc:"ISO 3166-1 alpha-2 region"`
	Cursor    string `query:"cursor" doc:"Opaque pagination cursor"`
	Context   string `query:"context" doc:"Optional output profile or setting context"`
	Limit     int    `query:"limit" default:"25" minimum:"1" maximum:"100" doc:"Page size"`
}

type PublishingOptionsOutput struct {
	Body struct {
		Options    []platform.DestinationOption `json:"options"`
		NextCursor string                       `json:"next_cursor,omitempty"`
	}
}

func (h *DestinationOptionsHandler) RegisterRoutes(api huma.API) {
	h.registerPublishingOptions(api)
	huma.Register(api, huma.Operation{
		OperationID: "get-account-destination-options",
		Method:      http.MethodGet,
		Path:        "/accounts/{account_id}/destination-options",
		Summary:     "List account-specific publishing options",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 502},
	}, func(ctx context.Context, input *DestinationOptionsInput) (*DestinationOptionsOutput, error) {
		var account models.SocialAccount
		if err := h.db.NewSelect().
			Model(&account).
			Where("id = ? AND is_active = ?", input.AccountID, true).
			Scan(ctx); err != nil {
			return nil, huma.Error404NotFound("connected account not found")
		}
		if err := providerReadinessWorkspaceAccess(ctx, h.db, account.WorkspaceID, middleware.GetUserID(ctx)); err != nil {
			return nil, err
		}

		adapter := h.adapterForDestinationAccount(account)
		if adapter == nil {
			return nil, huma.Error400BadRequest("provider is not configured")
		}
		optionProvider, ok := adapter.(platform.DestinationOptionsProvider)
		if !ok {
			return nil, huma.Error400BadRequest("provider does not expose account-specific publishing options")
		}
		if h.tokenSource == nil {
			return nil, huma.Error502BadGateway("provider access token service is unavailable")
		}
		accessToken, err := h.tokenSource.GetValidAccessToken(ctx, account.ID)
		if err != nil {
			return nil, huma.Error502BadGateway("failed to authorize provider options")
		}
		options, err := optionProvider.ListDestinationOptions(ctx, accessToken, platform.DestinationOptionsInput{
			RegionCode: input.RegionCode,
			Language:   input.Language,
		})
		if err != nil {
			return nil, huma.Error502BadGateway("failed to load provider publishing options")
		}

		output := &DestinationOptionsOutput{}
		output.Body.Options = options
		return output, nil
	})
}

func (h *DestinationOptionsHandler) registerPublishingOptions(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "search-account-publishing-options",
		Method:      http.MethodGet,
		Path:        "/accounts/{account_id}/publishing-options/{source}",
		Summary:     "Search one account-specific publishing option collection",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 502},
	}, func(ctx context.Context, input *PublishingOptionsInput) (*PublishingOptionsOutput, error) {
		account, err := h.loadDestinationAccount(ctx, input.AccountID)
		if err != nil {
			return nil, err
		}
		adapter := h.adapterForDestinationAccount(account)
		if adapter == nil {
			return nil, huma.Error400BadRequest("provider is not configured")
		}
		if input.Source == "threads_locations" && strings.TrimSpace(input.Search) == "" {
			return &PublishingOptionsOutput{}, nil
		}
		if requiredScope := publishingOptionsRequiredScope(account.Platform, input.Source); requiredScope != "" && !accountHasGrantedScope(account, requiredScope) {
			return nil, huma.Error403Forbidden("Reconnect this Threads account to grant threads_location_tagging and enable location search")
		}
		if h.tokenSource == nil {
			return nil, huma.Error502BadGateway("provider access token service is unavailable")
		}
		accessToken, err := h.tokenSource.GetValidAccessToken(ctx, account.ID)
		if err != nil {
			return nil, huma.Error502BadGateway("failed to authorize provider options")
		}
		limit := input.Limit
		if limit <= 0 || limit > 100 {
			limit = 25
		}

		var page platform.PublishingOptionsPage
		if searchProvider, ok := adapter.(platform.PublishingOptionsProvider); ok {
			page, err = searchProvider.SearchPublishingOptions(ctx, accessToken, platform.PublishingOptionsInput{
				Source:     input.Source,
				Search:     input.Search,
				Locale:     input.Locale,
				RegionCode: input.Region,
				Cursor:     input.Cursor,
				Context:    map[string]string{"value": input.Context},
				Limit:      limit,
			})
		} else if broadProvider, ok := adapter.(platform.DestinationOptionsProvider); ok {
			var groups map[string][]platform.DestinationOption
			groups, err = broadProvider.ListDestinationOptions(ctx, accessToken, platform.DestinationOptionsInput{
				RegionCode: input.Region,
				Language:   localeLanguage(input.Locale),
			})
			if err == nil {
				page = paginatePublishingOptions(groups[input.Source], input.Search, input.Cursor, limit)
			}
		} else {
			return nil, huma.Error400BadRequest("provider does not expose account-specific publishing options")
		}
		if err != nil {
			log.Printf("failed to load provider publishing options account=%s provider=%s source=%s: %v", account.ID, account.Platform, input.Source, err)
			return nil, huma.Error502BadGateway("failed to load provider publishing options")
		}
		output := &PublishingOptionsOutput{}
		output.Body.Options = page.Options
		output.Body.NextCursor = page.NextCursor
		return output, nil
	})
}

func publishingOptionsRequiredScope(provider, source string) string {
	if provider == "threads" && source == "threads_locations" {
		return "threads_location_tagging"
	}
	return ""
}

func accountHasGrantedScope(account models.SocialAccount, required string) bool {
	for _, granted := range strings.Fields(account.GrantedScopes) {
		if granted == required {
			return true
		}
	}
	return false
}

func (h *DestinationOptionsHandler) loadDestinationAccount(ctx context.Context, accountID string) (models.SocialAccount, error) {
	var account models.SocialAccount
	if err := h.db.NewSelect().
		Model(&account).
		Where("id = ? AND is_active = ?", accountID, true).
		Scan(ctx); err != nil {
		return models.SocialAccount{}, huma.Error404NotFound("connected account not found")
	}
	if err := providerReadinessWorkspaceAccess(ctx, h.db, account.WorkspaceID, middleware.GetUserID(ctx)); err != nil {
		return models.SocialAccount{}, err
	}
	return account, nil
}

func (h *DestinationOptionsHandler) adapterForDestinationAccount(account models.SocialAccount) platform.Adapter {
	key := account.Platform
	if account.Platform == "mastodon" {
		key = "mastodon:" + account.InstanceURL
	}
	return h.providers[key]
}

func paginatePublishingOptions(options []platform.DestinationOption, search, cursor string, limit int) platform.PublishingOptionsPage {
	filtered := make([]platform.DestinationOption, 0, len(options))
	query := strings.ToLower(strings.TrimSpace(search))
	for _, option := range options {
		if query == "" || strings.Contains(strings.ToLower(option.Label), query) {
			filtered = append(filtered, option)
		}
	}
	offset, _ := strconv.Atoi(cursor)
	if offset < 0 || offset > len(filtered) {
		offset = 0
	}
	end := min(offset+limit, len(filtered))
	page := platform.PublishingOptionsPage{Options: filtered[offset:end]}
	if end < len(filtered) {
		page.NextCursor = strconv.Itoa(end)
	}
	return page
}

func localeLanguage(locale string) string {
	locale = strings.TrimSpace(locale)
	if index := strings.IndexAny(locale, "-_"); index >= 0 {
		return locale[:index]
	}
	return locale
}
