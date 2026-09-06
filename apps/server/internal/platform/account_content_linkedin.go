package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const linkedinScopeOrganizationSocialRead = "r_organization_social"

type linkedinAccountContentResponse struct {
	Elements []struct {
		ID             string `json:"id"`
		Author         string `json:"author"`
		Commentary     string `json:"commentary"`
		PublishedAt    int64  `json:"publishedAt"`
		LifecycleState string `json:"lifecycleState"`
	} `json:"elements"`
	Paging struct {
		Start int `json:"start"`
		Links []struct {
			Rel string `json:"rel"`
		} `json:"links"`
	} `json:"paging"`
}

func (l *LinkedInAdapter) AccountContentDiscoverySupport(input AnalyticsAccountContext) AccountContentDiscoverySupport {
	accountType := linkedinAnalyticsAccountType(input.AccountID, input.CapabilityState)
	if accountType != "organization" || !strings.HasPrefix(linkedInAuthorURN(input.AccountID), "urn:li:organization:") {
		return AccountContentDiscoverySupport{
			UnavailableReason: "LinkedIn member account-history discovery is not certified for this OpenPost installation.",
		}
	}
	if !l.enableOrganizations {
		return AccountContentDiscoverySupport{
			UnavailableReason: "LinkedIn organization account-history discovery requires approved Community Management API access for this OpenPost installation.",
		}
	}
	return AccountContentDiscoverySupport{
		Supported:      true,
		RequiredScopes: []string{linkedinScopeOrganizationSocialRead},
		MaxPageSize:    AccountContentMaxPageSize,
	}
}

func (l *LinkedInAdapter) DiscoverAccountContent(ctx context.Context, accessToken string, input AccountContentDiscoveryRequest) (AccountContentPage, error) {
	support := l.AccountContentDiscoverySupport(AnalyticsAccountContext{
		AccountID:       input.AccountID,
		GrantedScopes:   strings.Join(input.GrantedScopes, " "),
		CapabilityState: input.CapabilityState,
	})
	if !support.Supported {
		return AccountContentPage{}, NewAccountContentDiscoveryError(AccountContentDiscoveryUnsupported, "linkedin_identity_not_certified", 0)
	}
	if missing := MissingAnalyticsScopes(strings.Join(input.GrantedScopes, " "), support.RequiredScopes); len(missing) > 0 {
		return AccountContentPage{}, NewAccountContentDiscoveryError(AccountContentDiscoveryPermissionRequired, "missing_scope", 0)
	}
	start, err := linkedinDiscoveryStart(input.Cursor)
	if err != nil {
		return AccountContentPage{}, err
	}
	authorURN := linkedInAuthorURN(input.AccountID)
	pageSize := min(max(1, input.PageSize), AccountContentMaxPageSize)
	query := url.Values{
		"q":      {"author"},
		"author": {authorURN},
		"count":  {strconv.Itoa(pageSize)},
		"start":  {strconv.Itoa(start)},
	}
	body, err := DoRequest(
		ctx,
		http.MethodGet,
		"https://api.linkedin.com/rest/posts?"+query.Encode(),
		nil,
		linkedinHeaders(accessToken, linkedInAPIVersion()),
	)
	if err != nil {
		return AccountContentPage{}, fmt.Errorf("linkedin organization posts: %w", err)
	}
	var response linkedinAccountContentResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return AccountContentPage{}, fmt.Errorf("decoding linkedin organization posts: %w", err)
	}
	return linkedinAccountContentPage(response, authorURN, start, input.PublishedAfter), nil
}

func linkedinAccountContentPage(response linkedinAccountContentResponse, authorURN string, start int, publishedAfter time.Time) AccountContentPage {
	page := AccountContentPage{Coverage: AccountContentCoverage{
		Status:      AccountContentDiscoveryComplete,
		Description: "Organization posts in the requested LinkedIn account history window are complete.",
	}}
	seen := make(map[string]struct{}, len(response.Elements))
	for _, post := range response.Elements {
		item, ok := normalizeLinkedInAccountContentPost(post.ID, post.Author, post.Commentary, post.LifecycleState, post.PublishedAt, authorURN, publishedAfter)
		if !ok {
			continue
		}
		if _, duplicate := seen[item.ProviderContentID]; duplicate {
			continue
		}
		seen[item.ProviderContentID] = struct{}{}
		page.Items = append(page.Items, item)
		if page.BackfillWatermark.IsZero() || item.PublishedAt.Before(page.BackfillWatermark) {
			page.BackfillWatermark = item.PublishedAt
		}
	}
	if linkedinDiscoveryHasNext(response) && len(response.Elements) > 0 {
		page.NextCursor = strconv.Itoa(start + len(response.Elements))
		page.Coverage.Status = AccountContentDiscoveryPartial
		page.Coverage.Description = "More organization posts remain in the requested LinkedIn account history window."
	}
	return page
}

func normalizeLinkedInAccountContentPost(id, author, commentary, lifecycle string, publishedMilliseconds int64, expectedAuthor string, publishedAfter time.Time) (AccountContentItem, bool) {
	id = strings.TrimSpace(id)
	if _, ok := linkedinAnalyticsEntity(id); !ok || strings.TrimSpace(author) != expectedAuthor || (lifecycle != "" && lifecycle != "PUBLISHED") {
		return AccountContentItem{}, false
	}
	publishedAt := time.UnixMilli(publishedMilliseconds).UTC()
	if publishedMilliseconds <= 0 || (!publishedAfter.IsZero() && publishedAt.Before(publishedAfter)) {
		return AccountContentItem{}, false
	}
	item, err := NormalizeAccountContentItem(providerLinkedIn, AccountContentItem{
		ProviderContentID: id,
		ContentProfile:    "short_text",
		Text:              commentary,
		ExternalURL:       "https://www.linkedin.com/feed/update/" + id,
		PublishedAt:       publishedAt,
		Origin:            AccountContentOriginExternal,
		OriginConfidence:  AccountContentOriginConfidenceExact,
	})
	return item, err == nil
}

func linkedinDiscoveryHasNext(response linkedinAccountContentResponse) bool {
	for _, link := range response.Paging.Links {
		if strings.EqualFold(strings.TrimSpace(link.Rel), "next") {
			return true
		}
	}
	return false
}

func linkedinDiscoveryStart(cursor string) (int, error) {
	cursor = strings.TrimSpace(cursor)
	if cursor == "" {
		return 0, nil
	}
	start, err := strconv.Atoi(cursor)
	if err != nil || start < 0 {
		return 0, NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, "invalid_cursor", 0)
	}
	return start, nil
}
