package platform

import (
	"context"
	"encoding/json"
	"fmt"
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
			return nil, businessErr
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
					return nil, edgeErr
				}
				pages = append(pages, edgePages...)
			}
		}
	}

	return mergePublishableMetaPages(pages), nil
}

func fetchMetaGraphEdge[T any](ctx context.Context, firstURL, label string, budget *metaGraphBudget) ([]T, error) {
	initial, err := url.Parse(firstURL)
	if err != nil || initial.Scheme != "https" || initial.Host == "" {
		return nil, fmt.Errorf("%s URL is invalid", label)
	}
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

		body, requestErr := DoRequest(ctx, http.MethodGet, nextURL, nil, nil)
		if requestErr != nil {
			return nil, fmt.Errorf("%s: %w", label, requestErr)
		}
		var response struct {
			Data   []T `json:"data"`
			Paging struct {
				Next string `json:"next"`
			} `json:"paging"`
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if decodeErr := json.Unmarshal(body, &response); decodeErr != nil {
			return nil, fmt.Errorf("decoding %s: %w", label, decodeErr)
		}
		if response.Error.Message != "" {
			return nil, fmt.Errorf("%s returned an error", label)
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
