package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
)

const (
	metaPageWalkMaxRequests   = 250
	metaPageWalkMaxBusinesses = 100
)

type metaPage struct {
	ID                       string `json:"id"`
	Name                     string `json:"name"`
	Username                 string `json:"username"`
	AccessToken              string `json:"access_token"`
	InstagramBusinessAccount struct {
		ID                string `json:"id"`
		Username          string `json:"username"`
		Name              string `json:"name"`
		ProfilePictureURL string `json:"profile_picture_url"`
		AccountType       string `json:"account_type"`
	} `json:"instagram_business_account"`
	Picture struct {
		Data struct {
			URL string `json:"url"`
		} `json:"data"`
	} `json:"picture"`
}

type facebookPage = metaPage
type instagramPage = metaPage

type metaBusiness struct {
	ID string `json:"id"`
}

type metaGraphBudget struct {
	requests int
}

type metaGraphCollection[T any] struct {
	Data   []T `json:"data"`
	Paging struct {
		Next string `json:"next"`
	} `json:"paging"`
	Error json.RawMessage `json:"error"`
}

func metaGraphEmbeddedError(raw json.RawMessage) error {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	return NewHTTPError(http.StatusBadRequest, nil, []byte(`{"error":`+string(raw)+`}`))
}

func fetchMetaGraphRemaining[T any](ctx context.Context, origin string, page metaGraphCollection[T], label string, budget *metaGraphBudget) ([]T, error) {
	if err := metaGraphEmbeddedError(page.Error); err != nil {
		return nil, fmt.Errorf("%s: %w", label, err)
	}
	initial, err := url.Parse(origin)
	if err != nil {
		return nil, fmt.Errorf("%s URL is invalid", label)
	}
	next, err := validatedMetaNextURL(initial, page.Paging.Next)
	if err != nil {
		return nil, fmt.Errorf("%s pagination: %w", label, err)
	}
	if next == "" {
		return page.Data, nil
	}
	// Continuation tokens are not part of page identity. Carry the original
	// credential separately until fetchMetaGraphEdge moves it into the header.
	nextPage, _ := url.Parse(next)
	query := nextPage.Query()
	if token := initial.Query().Get(oauthParamAccessToken); token != "" {
		query.Set(oauthParamAccessToken, token)
		nextPage.RawQuery = query.Encode()
	}
	remaining, err := fetchMetaGraphEdge[T](ctx, nextPage.String(), label, budget)
	if err != nil {
		return nil, err
	}
	return append(page.Data, remaining...), nil
}

func listMetaManagedPages(
	ctx context.Context,
	graphURL func(string) string,
	token *TokenResult,
	fields string,
	label string,
) ([]metaPage, error) {
	if token == nil || strings.TrimSpace(token.AccessToken) == "" {
		return nil, fmt.Errorf("%s requires an access token", label)
	}
	query := url.Values{
		"fields":              {fields},
		"limit":               {"100"},
		oauthParamAccessToken: {token.AccessToken},
	}
	budget := &metaGraphBudget{}
	pages, err := fetchMetaGraphEdge[metaPage](ctx, graphURL("me/accounts")+"?"+query.Encode(), label+" pages", budget)
	if err != nil {
		return nil, err
	}

	// Business Portfolio edges only add Pages to me/accounts. Meta refuses an
	// agency portfolio's client_pages when the user granted only some client
	// Pages (#522), so a refused portfolio request is skipped and fails the
	// selection only when no Page could be loaded at all.
	var portfolioErr error
	skipPortfolioRequest := func(request string, err error) error {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return err
		}
		if portfolioErr == nil {
			portfolioErr = err
		}
		diagnostics := []any{"provider", label, "request", request}
		var providerErr *HTTPError
		if errors.As(err, &providerErr) {
			diagnostics = append(diagnostics, "status", providerErr.StatusCode, "code", providerErr.Code)
		}
		slog.WarnContext(ctx, "Meta Business Portfolio request failed; skipping it", diagnostics...)
		return nil
	}

	if tokenHasGrantedScope(token, metaBusinessManagementScope) {
		businessQuery := url.Values{
			"limit":               {"100"},
			oauthParamAccessToken: {token.AccessToken},
		}
		businesses, businessErr := fetchMetaGraphEdge[metaBusiness](
			ctx,
			graphURL("me/businesses")+"?"+businessQuery.Encode(),
			label+" Business Portfolios",
			budget,
		)
		if businessErr != nil {
			if err := skipPortfolioRequest("me/businesses", businessErr); err != nil {
				return nil, err
			}
			businesses = nil
		}
		if len(businesses) > metaPageWalkMaxBusinesses {
			return nil, fmt.Errorf("%s Business Portfolio discovery exceeded %d portfolios", label, metaPageWalkMaxBusinesses)
		}
		for _, business := range businesses {
			if strings.TrimSpace(business.ID) == "" {
				continue
			}
			for _, edge := range []string{"owned_pages", "client_pages"} {
				edgePages, edgeErr := fetchMetaGraphEdge[metaPage](
					ctx,
					graphURL(url.PathEscape(business.ID)+"/"+edge)+"?"+query.Encode(),
					label+" Business Portfolio pages",
					budget,
				)
				if edgeErr != nil {
					if err := skipPortfolioRequest(edge, edgeErr); err != nil {
						return nil, err
					}
					continue
				}
				pages = append(pages, edgePages...)
			}
		}
	}

	merged := mergePublishableMetaPages(pages)
	if len(merged) == 0 && portfolioErr != nil {
		return nil, portfolioErr
	}
	return merged, nil
}

func fetchMetaGraphEdge[T any](ctx context.Context, firstURL, label string, budget *metaGraphBudget) ([]T, error) {
	initial, err := url.Parse(firstURL)
	if err != nil || initial.Scheme != "https" || initial.Host == "" {
		return nil, fmt.Errorf("%s URL is invalid", label)
	}
	query := initial.Query()
	accessToken := query.Get(oauthParamAccessToken)
	query.Del(oauthParamAccessToken)
	initial.RawQuery = query.Encode()
	nextURL := initial.String()
	seen := make(map[string]struct{})
	var items []T
	for nextURL != "" {
		if budget.requests >= metaPageWalkMaxRequests {
			return nil, fmt.Errorf("%s pagination exceeded %d requests", label, metaPageWalkMaxRequests)
		}
		if _, exists := seen[nextURL]; exists {
			return nil, fmt.Errorf("%s pagination repeated a page", label)
		}
		seen[nextURL] = struct{}{}
		budget.requests++

		headers := map[string]string{}
		if accessToken != "" {
			headers[headerAuthorization] = bearerPrefix + accessToken
		}
		body, requestErr := doMetaRequest(ctx, http.MethodGet, nextURL, nil, headers)
		if requestErr != nil {
			return nil, fmt.Errorf("%s: %w", label, requestErr)
		}
		var response metaGraphCollection[T]
		if decodeErr := json.Unmarshal(body, &response); decodeErr != nil {
			return nil, fmt.Errorf("decoding %s: %w", label, decodeErr)
		}
		if responseErr := metaGraphEmbeddedError(response.Error); responseErr != nil {
			return nil, fmt.Errorf("%s returned an error: %w", label, responseErr)
		}
		items = append(items, response.Data...)
		nextURL, err = validatedMetaNextURL(initial, response.Paging.Next)
		if err != nil {
			return nil, fmt.Errorf("%s pagination: %w", label, err)
		}
	}
	return items, nil
}

func validatedMetaNextURL(initial *url.URL, rawNext string) (string, error) {
	rawNext = strings.TrimSpace(rawNext)
	if rawNext == "" {
		return "", nil
	}
	next, err := url.Parse(rawNext)
	if err != nil {
		return "", fmt.Errorf("next URL is invalid")
	}
	next = initial.ResolveReference(next)
	if next.Scheme != initial.Scheme || next.Host != initial.Host {
		return "", fmt.Errorf("next URL changed host")
	}
	query := next.Query()
	query.Del(oauthParamAccessToken)
	next.RawQuery = query.Encode()
	return next.String(), nil
}

func tokenHasGrantedScope(token *TokenResult, scope string) bool {
	if token == nil {
		return false
	}
	for _, granted := range strings.Fields(token.Extra["scope"]) {
		if granted == scope {
			return true
		}
	}
	return false
}

func mergePublishableMetaPages(pages []metaPage) []metaPage {
	merged := make([]metaPage, 0, len(pages))
	indexes := make(map[string]int, len(pages))
	for _, page := range pages {
		page.ID = strings.TrimSpace(page.ID)
		if page.ID == "" {
			continue
		}
		if index, exists := indexes[page.ID]; exists {
			merged[index] = mergeMetaPage(merged[index], page)
			continue
		}
		indexes[page.ID] = len(merged)
		merged = append(merged, page)
	}
	publishable := merged[:0]
	for _, page := range merged {
		if strings.TrimSpace(page.AccessToken) != "" {
			publishable = append(publishable, page)
		}
	}
	return publishable
}

func mergeMetaPage(current, candidate metaPage) metaPage {
	if current.Name == "" {
		current.Name = candidate.Name
	}
	if current.Username == "" {
		current.Username = candidate.Username
	}
	if current.AccessToken == "" {
		current.AccessToken = candidate.AccessToken
	}
	if current.Picture.Data.URL == "" {
		current.Picture = candidate.Picture
	}
	if current.InstagramBusinessAccount.ID == "" {
		current.InstagramBusinessAccount = candidate.InstagramBusinessAccount
	}
	return current
}

// Meta access tokens travel in headers, including provider continuation URLs.
// The Graph API does not require redirects for these credentialed operations.
func doMetaRequest(ctx context.Context, method, rawURL string, body io.Reader, headers map[string]string) ([]byte, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("invalid Meta request URL")
	}
	query := parsed.Query()
	if token := query.Get(oauthParamAccessToken); token != "" {
		query.Del(oauthParamAccessToken)
		parsed.RawQuery = query.Encode()
		copied := make(map[string]string, len(headers)+1)
		for key, value := range headers {
			copied[key] = value
		}
		if copied[headerAuthorization] == "" {
			copied[headerAuthorization] = bearerPrefix + token
		}
		headers = copied
	}
	return DoRequestNoRedirect(ctx, method, parsed.String(), body, headers)
}
