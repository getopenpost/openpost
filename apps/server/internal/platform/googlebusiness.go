package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Google Business Profile (GBP) adapter.
//
// Boundary: managed OAuth provider app plus per-location connected accounts.
// Google reviews every Local Post after create, so create acceptance is never
// treated as published. Posts reconcile through a durable publish fence until
// Google reports a terminal state. Rejected posts never become publications;
// operators duplicate them to retry.
//
// Reference checklist (TryPost GBP branch, Postiz GMB provider):
//   - STANDARD, EVENT, and OFFER local post topics.
//   - Location selection filters on the provider-reported local-post
//     operability signal across every account in the grant.
//   - create != published: PROCESSING and SCHEDULED states stay pending with
//     reconcile-only durability.
//   - Rejected reviews never become publications.
//   - Disabled destinations settle pending reviews instead of retrying.
//   - Dead-token refresh is a credential operation, never a republish.
//   - The Google-compatible JPEG derivative must stay alive in BlobStorage
//     until moderation finishes, because Google fetches media by URL.
//   - ExternalURL always comes from the provider-returned searchUrl
//     (Postiz searchUrl lesson); it is never constructed locally.
//   - Location analytics are useful but Google offers no per-post insights,
//     so content analytics stay unsupported and failed analytics empties are
//     never cached as measurements.
//
// GBP remains behind capability flags: analytics and engagement report
// unsupported, composer capabilities require app review and carry an
// unavailable reason until Google API access and live certification exist.
const (
	googleBusinessAccountManagementBaseURL = "https://mybusinessaccountmanagement.googleapis.com/v1"
	googleBusinessInformationBaseURL       = "https://mybusinessbusinessinformation.googleapis.com/v1"
	googleBusinessPostsBaseURL             = "https://mybusiness.googleapis.com/v4"
	googleOAuthRevokeURL                   = "https://oauth2.googleapis.com/revoke"

	googleBusinessPostReferencePrefix = "gbplocalpost1:"
	googleBusinessReconcileDelay      = time.Minute
	googleBusinessLocationsPageSize   = 100

	googleBusinessSummaryMaxRunes    = 1500
	googleBusinessEventTitleMaxRunes = 58
)

var (
	googleBusinessLocationNamePattern = regexp.MustCompile(`^accounts/[^/]+/locations/[^/]+$`)
	googleBusinessPostNamePattern     = regexp.MustCompile(`^accounts/[^/]+/locations/[^/]+/localPosts/[^/]+$`)
)

var googleBusinessOAuthScopes = []string{
	"https://www.googleapis.com/auth/business.manage",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/userinfo.email",
}

var googleBusinessCallToActions = map[string]bool{
	"BOOK": true, "ORDER": true, "SHOP": true,
	"LEARN_MORE": true, "SIGN_UP": true, "CALL": true,
}

// GoogleBusinessAdapter publishes Google Business Profile local posts.
type GoogleBusinessAdapter struct {
	clientID     string
	clientSecret string
	redirectURI  string
}

// NewGoogleBusinessAdapter builds the GBP adapter from instance-owned OAuth material.
func NewGoogleBusinessAdapter(clientID, clientSecret, redirectURI string) *GoogleBusinessAdapter {
	return &GoogleBusinessAdapter{clientID: clientID, clientSecret: clientSecret, redirectURI: redirectURI}
}

// Compile-time seam assertions.
var (
	_ AccountSelectionAdapter    = (*GoogleBusinessAdapter)(nil)
	_ AccountMetadataRefresher   = (*GoogleBusinessAdapter)(nil)
	_ AccountCapabilityProvider  = (*GoogleBusinessAdapter)(nil)
	_ DestinationOptionsProvider = (*GoogleBusinessAdapter)(nil)
	_ PublishingOptionsProvider  = (*GoogleBusinessAdapter)(nil)
	_ PublishingTargetValidator  = (*GoogleBusinessAdapter)(nil)
	_ PublishReconciler          = (*GoogleBusinessAdapter)(nil)
	_ ContentURLResolver         = (*GoogleBusinessAdapter)(nil)
	_ AuthorizationRevoker       = (*GoogleBusinessAdapter)(nil)
)

func (g *GoogleBusinessAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID:     g.clientID,
		ExecutionMode: "oauth2",
		Evidence:      map[string]string{"protocol": "oauth2", "exchange": "authorization_code"},
	}
}

func (g *GoogleBusinessAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	params := url.Values{}
	params.Set(oauthParamClientID, g.clientID)
	params.Set(oauthParamRedirectURI, g.redirectURI)
	params.Set("response_type", oauthResponseType)
	params.Set("scope", strings.Join(googleBusinessOAuthScopes, " "))
	params.Set("state", state)
	params.Set("access_type", "offline")
	params.Set("prompt", "consent")
	params.Set("include_granted_scopes", "true")
	return googleOAuthURL + "?" + params.Encode(), nil
}

func (g *GoogleBusinessAdapter) ExchangeCode(ctx context.Context, code string, _ map[string]string) (*TokenResult, error) {
	if strings.TrimSpace(code) == "" {
		return nil, fmt.Errorf("google business token exchange requires an authorization code")
	}
	return g.exchangeToken(ctx, map[string]string{
		oauthParamClientID:     g.clientID,
		oauthParamClientSecret: g.clientSecret,
		oauthParamCode:         code,
		oauthParamRedirectURI:  g.redirectURI,
		grantType:              oauthGrantAuthCode,
	}, "google business token exchange")
}

func (g *GoogleBusinessAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{Supported: true, CredentialSource: RefreshCredentialRefreshToken}
}

// RefreshToken renews a dead access token. It is a credential operation only:
// callers must reconcile the durable provider reference afterwards, never
// republish the post.
func (g *GoogleBusinessAdapter) RefreshToken(ctx context.Context, input RefreshTokenInput) (*TokenResult, error) {
	if strings.TrimSpace(input.RefreshToken) == "" {
		return nil, fmt.Errorf("google business refresh requires a refresh token")
	}
	return g.exchangeToken(ctx, map[string]string{
		oauthParamClientID:                    g.clientID,
		oauthParamClientSecret:                g.clientSecret,
		grantType:                             oauthGrantRefresh,
		string(RefreshCredentialRefreshToken): input.RefreshToken,
	}, "google business token refresh")
}

func (g *GoogleBusinessAdapter) exchangeToken(ctx context.Context, values map[string]string, label string) (*TokenResult, error) {
	return exchangeGoogleOAuthToken(ctx, values, label)
}

// RevokeAuthorization invalidates the provider credential before OpenPost
// clears the encrypted local grant.
func (g *GoogleBusinessAdapter) RevokeAuthorization(ctx context.Context, accessToken string) error {
	if strings.TrimSpace(accessToken) == "" {
		return fmt.Errorf("google business revocation requires an access token")
	}
	if _, err := DoFormURLEncoded(ctx, http.MethodPost, googleOAuthRevokeURL, map[string]string{"token": accessToken}, nil); err != nil {
		return fmt.Errorf("google business token revocation: %w", err)
	}
	return nil
}

func (g *GoogleBusinessAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	return fetchGoogleUserProfile(ctx, accessToken, "google business google profile")
}

type googleBusinessAccount struct {
	Name        string `json:"name"`
	AccountName string `json:"accountName"`
	Type        string `json:"type"`
}

type googleBusinessLocation struct {
	Name          string `json:"name"`
	Title         string `json:"title"`
	LocationState struct {
		CanOperateLocalPost *bool `json:"canOperateLocalPost"`
		IsVerified          bool  `json:"isVerified"`
		IsPublished         bool  `json:"isPublished"`
	} `json:"locationState"`
	StorefrontAddress struct {
		Locality string `json:"locality"`
		Region   string `json:"region"`
	} `json:"storefrontAddress"`
}

// googleBusinessLocationOperable reports whether the provider says a location
// can receive local posts. The filter is fail-closed: locations that report
// they cannot operate local posts, or that omit the operability signal, are
// excluded from selection and from publish-target revalidation. Live
// certification must confirm the exact locationState field before launch.
func googleBusinessLocationOperable(location googleBusinessLocation) bool {
	if !googleBusinessLocationNamePattern.MatchString(strings.TrimSpace(location.Name)) {
		return false
	}
	if location.LocationState.CanOperateLocalPost == nil {
		return false
	}
	return *location.LocationState.CanOperateLocalPost
}

func (g *GoogleBusinessAdapter) listAccounts(ctx context.Context, accessToken string) ([]googleBusinessAccount, error) {
	accounts := []googleBusinessAccount{}
	pageToken := ""
	for {
		endpoint := googleBusinessAccountManagementBaseURL + "/accounts?pageSize=50"
		if pageToken != "" {
			endpoint += "&pageToken=" + url.QueryEscape(pageToken)
		}
		respBody, err := DoRequest(ctx, http.MethodGet, endpoint, nil, bearerHeaders(accessToken))
		if err != nil {
			return nil, fmt.Errorf("google business accounts: %w", err)
		}
		var response struct {
			Accounts      []googleBusinessAccount `json:"accounts"`
			NextPageToken string                  `json:"nextPageToken"`
		}
		if err := json.Unmarshal(respBody, &response); err != nil {
			return nil, fmt.Errorf("decoding google business accounts: %w", err)
		}
		for _, account := range response.Accounts {
			if strings.TrimSpace(account.Name) != "" {
				accounts = append(accounts, account)
			}
		}
		if response.NextPageToken == "" || response.NextPageToken == pageToken {
			return accounts, nil
		}
		pageToken = response.NextPageToken
	}
}

func (g *GoogleBusinessAdapter) listAccountLocations(ctx context.Context, accessToken, accountName string) ([]googleBusinessLocation, error) {
	locations := []googleBusinessLocation{}
	pageToken := ""
	for {
		params := url.Values{}
		params.Set("pageSize", "100")
		params.Set("readMask", "name,title,storefrontAddress,locationState")
		if pageToken != "" {
			params.Set("pageToken", pageToken)
		}
		endpoint := googleBusinessInformationBaseURL + "/" + accountName + "/locations?" + params.Encode()
		respBody, err := DoRequest(ctx, http.MethodGet, endpoint, nil, bearerHeaders(accessToken))
		if err != nil {
			return nil, fmt.Errorf("google business locations: %w", err)
		}
		var response struct {
			Locations     []googleBusinessLocation `json:"locations"`
			NextPageToken string                   `json:"nextPageToken"`
		}
		if err := json.Unmarshal(respBody, &response); err != nil {
			return nil, fmt.Errorf("decoding google business locations: %w", err)
		}
		locations = append(locations, response.Locations...)
		if response.NextPageToken == "" || response.NextPageToken == pageToken {
			return locations, nil
		}
		pageToken = response.NextPageToken
	}
}

// listOperableLocations enumerates locations across every account in the
// grant. Single-account enumeration misses locations under additional
// organization accounts, so every account page is walked.
func (g *GoogleBusinessAdapter) listOperableLocations(ctx context.Context, accessToken string) ([]googleBusinessLocation, error) {
	accounts, err := g.listAccounts(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	operable := []googleBusinessLocation{}
	seen := map[string]struct{}{}
	for _, account := range accounts {
		locations, err := g.listAccountLocations(ctx, accessToken, account.Name)
		if err != nil {
			return nil, err
		}
		for _, location := range locations {
			if !googleBusinessLocationOperable(location) {
				continue
			}
			if _, duplicate := seen[location.Name]; duplicate {
				continue
			}
			seen[location.Name] = struct{}{}
			operable = append(operable, location)
		}
	}
	return operable, nil
}

func googleBusinessLocationDescription(location googleBusinessLocation) string {
	parts := []string{}
	if locality := strings.TrimSpace(location.StorefrontAddress.Locality); locality != "" {
		parts = append(parts, locality)
	}
	if region := strings.TrimSpace(location.StorefrontAddress.Region); region != "" {
		parts = append(parts, region)
	}
	return strings.Join(parts, ", ")
}

func googleBusinessLocationOption(location googleBusinessLocation) AccountSelectionOption {
	return AccountSelectionOption{
		ID:          location.Name,
		Username:    firstNonEmptyString(location.Title, location.Name),
		DisplayName: firstNonEmptyString(location.Title, location.Name),
		Description: googleBusinessLocationDescription(location),
		Kind:        "location",
	}
}

func (g *GoogleBusinessAdapter) ListAccountSelections(ctx context.Context, token *TokenResult) ([]AccountSelectionOption, error) {
	if token == nil {
		return nil, fmt.Errorf("google business account selection requires a token")
	}
	locations, err := g.listOperableLocations(ctx, token.AccessToken)
	if err != nil {
		return nil, err
	}
	options := make([]AccountSelectionOption, 0, len(locations))
	for _, location := range locations {
		options = append(options, googleBusinessLocationOption(location))
	}
	return options, nil
}

func (g *GoogleBusinessAdapter) SelectAccount(ctx context.Context, token *TokenResult, selectionID string) (*SelectedAccount, error) {
	if token == nil {
		return nil, fmt.Errorf("google business account selection requires a token")
	}
	selectionID = strings.TrimSpace(selectionID)
	if !googleBusinessLocationNamePattern.MatchString(selectionID) {
		return nil, fmt.Errorf("google business location selection %q is not a valid location", selectionID)
	}
	locations, err := g.listOperableLocations(ctx, token.AccessToken)
	if err != nil {
		return nil, err
	}
	for _, location := range locations {
		if location.Name != selectionID {
			continue
		}
		selectedToken := *token
		selectedToken.Extra = map[string]string{}
		for key, value := range token.Extra {
			selectedToken.Extra[key] = value
		}
		selectedToken.Extra["location_id"] = location.Name
		return &SelectedAccount{
			AccountID:        location.Name,
			AccountUsername:  firstNonEmptyString(location.Title, location.Name),
			AccountAvatarURL: "",
			Token:            &selectedToken,
			CapabilityState: map[string]string{
				"googlebusiness_location_verified": fmt.Sprint(location.LocationState.IsVerified),
			},
		}, nil
	}
	return nil, fmt.Errorf("google business location selection %s is not operable for local posts", selectionID)
}

// RefreshAccountMetadata resolves the current provider-owned name for one
// exact connected location when GetProfile would describe the grant owner.
func (g *GoogleBusinessAdapter) RefreshAccountMetadata(ctx context.Context, accessToken string, input AccountMetadataRequest) (*UserProfile, error) {
	accountID := strings.TrimSpace(input.AccountID)
	if !googleBusinessLocationNamePattern.MatchString(accountID) {
		return nil, fmt.Errorf("google business metadata refresh requires a location resource name")
	}
	locations, err := g.listOperableLocations(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	for _, location := range locations {
		if location.Name != accountID {
			continue
		}
		return &UserProfile{
			ID:          location.Name,
			Username:    firstNonEmptyString(location.Title, location.Name),
			DisplayName: firstNonEmptyString(location.Title, location.Name),
			CapabilityState: map[string]string{
				"googlebusiness_location_verified": fmt.Sprint(location.LocationState.IsVerified),
			},
		}, nil
	}
	return nil, fmt.Errorf("google business location %s is no longer operable for local posts", accountID)
}

func (g *GoogleBusinessAdapter) ListDestinationOptions(ctx context.Context, accessToken string, _ DestinationOptionsInput) (map[string][]DestinationOption, error) {
	locations, err := g.listOperableLocations(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	options := make([]DestinationOption, 0, len(locations))
	for _, location := range locations {
		label := firstNonEmptyString(location.Title, location.Name)
		if description := googleBusinessLocationDescription(location); description != "" {
			label += " (" + description + ")"
		}
		options = append(options, DestinationOption{Value: location.Name, Label: label})
	}
	return map[string][]DestinationOption{"googlebusiness_locations": options}, nil
}

func (g *GoogleBusinessAdapter) SearchPublishingOptions(ctx context.Context, accessToken string, input PublishingOptionsInput) (PublishingOptionsPage, error) {
	if input.Source != "googlebusiness_locations" {
		return PublishingOptionsPage{}, fmt.Errorf("google business publishing option source %q is not supported", input.Source)
	}
	locations, err := g.listOperableLocations(ctx, accessToken)
	if err != nil {
		return PublishingOptionsPage{}, err
	}
	options := make([]DestinationOption, 0, len(locations))
	for _, location := range locations {
		label := firstNonEmptyString(location.Title, location.Name)
		if description := googleBusinessLocationDescription(location); description != "" {
			label += " (" + description + ")"
		}
		options = append(options, DestinationOption{Value: location.Name, Label: label})
	}
	return paginateGoogleBusinessOptions(options, input.Search, input.Cursor, input.Limit), nil
}

func paginateGoogleBusinessOptions(options []DestinationOption, search, cursor string, limit int) PublishingOptionsPage {
	filtered := options
	if trimmed := strings.TrimSpace(search); trimmed != "" {
		filtered = nil
		lowered := strings.ToLower(trimmed)
		for _, option := range options {
			if strings.Contains(strings.ToLower(option.Label), lowered) || strings.Contains(strings.ToLower(option.Value), lowered) {
				filtered = append(filtered, option)
			}
		}
	}
	if limit <= 0 || limit > googleBusinessLocationsPageSize {
		limit = googleBusinessLocationsPageSize
	}
	start := 0
	if cursor != "" {
		for index, option := range filtered {
			if option.Value == cursor {
				start = index + 1
				break
			}
		}
	}
	if start > len(filtered) {
		start = len(filtered)
	}
	end := start + limit
	if end > len(filtered) {
		end = len(filtered)
	}
	page := PublishingOptionsPage{Options: filtered[start:end]}
	if end < len(filtered) {
		page.NextCursor = filtered[end-1].Value
	}
	return page
}

func (g *GoogleBusinessAdapter) ResolveAccountPublishingCapabilities(ctx context.Context, accessToken string, input AccountCapabilityInput) (AccountCapabilityResult, error) {
	options, err := g.ListDestinationOptions(ctx, accessToken, DestinationOptionsInput{
		RegionCode: input.RegionCode,
		Language:   input.Locale,
	})
	if err != nil {
		return AccountCapabilityResult{}, err
	}
	return AccountCapabilityResult{
		Revision: "googlebusiness-account-options-v1",
		Options:  options,
		AvailableFeatures: map[string]bool{
			"post_standard":  true,
			"post_event":     true,
			"post_offer":     true,
			"call_to_action": true,
		},
	}, nil
}

// ValidatePublishingTarget rechecks that the selected location still reports
// local-post operability before any provider mutation begins.
func (g *GoogleBusinessAdapter) ValidatePublishingTarget(ctx context.Context, accessToken, accountID string, settings map[string]interface{}) error {
	location := firstNonEmptyString(settingString(settings, "location_id"), strings.TrimSpace(accountID))
	if !googleBusinessLocationNamePattern.MatchString(location) {
		return fmt.Errorf("google business publishing requires a selected location")
	}
	locations, err := g.listOperableLocations(ctx, accessToken)
	if err != nil {
		return fmt.Errorf("validate google business location: %w", err)
	}
	for _, candidate := range locations {
		if candidate.Name == location {
			return nil
		}
	}
	return fmt.Errorf("google business location is no longer operable for local posts")
}

// GoogleBusinessAnalyticsSupport declares the reporting boundary: location
// analytics are useful and planned through the performance surface, but Google
// offers no per-post insights for local posts, so content analytics stay
// unsupported. Failed analytics empties must never be cached as measurements.
func GoogleBusinessAnalyticsSupport() AnalyticsSupport {
	return AnalyticsSupport{
		Account:            false,
		Content:            false,
		AccountUnavailable: "googlebusiness_location_analytics_pending",
		ContentUnavailable: "google_no_per_post_insights",
	}
}

func (g *GoogleBusinessAdapter) UploadMedia(_ context.Context, _, _, _ string, _ io.Reader) (string, error) {
	return "", fmt.Errorf("google business media is attached by public URL; upload the image to workspace media first")
}

type googleBusinessLocalPostRequest struct {
	LanguageCode string                      `json:"languageCode,omitempty"`
	Summary      string                      `json:"summary,omitempty"`
	TopicType    string                      `json:"topicType"`
	CallToAction *googleBusinessCallToAction `json:"callToAction,omitempty"`
	Event        *googleBusinessEvent        `json:"event,omitempty"`
	Offer        *googleBusinessOffer        `json:"offer,omitempty"`
	Media        []googleBusinessMediaItem   `json:"media,omitempty"`
}

type googleBusinessCallToAction struct {
	ActionType string `json:"actionType"`
	URL        string `json:"url,omitempty"`
}

type googleBusinessEvent struct {
	Title    string                  `json:"title,omitempty"`
	Schedule *googleBusinessSchedule `json:"schedule,omitempty"`
}

type googleBusinessSchedule struct {
	StartDate *googleBusinessDate `json:"startDate,omitempty"`
	StartTime *googleBusinessTime `json:"startTime,omitempty"`
	EndDate   *googleBusinessDate `json:"endDate,omitempty"`
	EndTime   *googleBusinessTime `json:"endTime,omitempty"`
}

type googleBusinessDate struct {
	Year  int `json:"year"`
	Month int `json:"month"`
	Day   int `json:"day"`
}

type googleBusinessTime struct {
	Hours   int `json:"hours"`
	Minutes int `json:"minutes"`
}

type googleBusinessOffer struct {
	CouponCode      string `json:"couponCode,omitempty"`
	RedeemOnlineURL string `json:"redeemOnlineUrl,omitempty"`
	TermsConditions string `json:"termsConditions,omitempty"`
}

type googleBusinessMediaItem struct {
	MediaFormat string `json:"mediaFormat"`
	SourceURL   string `json:"sourceUrl"`
}

type googleBusinessLocalPost struct {
	Name      string `json:"name"`
	State     string `json:"state"`
	SearchURL string `json:"searchUrl"`
}

// googleBusinessPostTopic normalizes the topic_type setting. Only the topics
// Google still accepts for authoring are allowed.
func googleBusinessPostTopic(settings map[string]interface{}) (string, error) {
	topic := strings.ToUpper(strings.TrimSpace(settingString(settings, "topic_type")))
	if topic == "" {
		return "STANDARD", nil
	}
	switch topic {
	case "STANDARD", "EVENT", "OFFER":
		return topic, nil
	default:
		return "", fmt.Errorf("google business topic_type %q is not supported", topic)
	}
}

// googleBusinessSearchURL returns the provider-issued share URL. The URL is
// used exactly as returned and never constructed locally; an unusable value
// yields an empty ExternalURL rather than a fabricated link.
func googleBusinessSearchURL(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || !strings.EqualFold(parsed.Scheme, "https") || parsed.Hostname() == "" || parsed.User != nil {
		return ""
	}
	return trimmed
}

// googleBusinessPostReference wraps a provider post name in a versioned
// durable reference so reconciliation never reparses user input.
func googleBusinessPostReference(postName string) (string, error) {
	postName = strings.TrimSpace(postName)
	if !googleBusinessPostNamePattern.MatchString(postName) {
		return "", fmt.Errorf("google business post reference requires a local post resource name")
	}
	return googleBusinessPostReferencePrefix + postName, nil
}

func googleBusinessPostNameFromReference(reference string) (string, error) {
	if !strings.HasPrefix(reference, googleBusinessPostReferencePrefix) {
		return "", fmt.Errorf("google business reconciliation requires a versioned reference")
	}
	postName := strings.TrimPrefix(reference, googleBusinessPostReferencePrefix)
	if !googleBusinessPostNamePattern.MatchString(postName) {
		return "", fmt.Errorf("google business reconciliation reference is invalid")
	}
	return postName, nil
}

// googleBusinessSubmissionClass is the durable reconciliation state machine.
// create != published: only LIVE settles to accepted. REJECTED is terminal
// and never becomes a publication. Every other state, including PROCESSING
// and SCHEDULED, stays pending with reconcile-only safety so durable jobs
// keep polling instead of replaying the write.
func googleBusinessSubmissionClass(state string) (PublishSubmissionState, PublishRetrySafety) {
	switch strings.ToUpper(strings.TrimSpace(state)) {
	case "LIVE", "PUBLISHED":
		return PublishSubmissionAccepted, PublishRetryNever
	case "REJECTED", "FAILED", "SPAM":
		return PublishSubmissionRejected, PublishRetryNever
	default:
		return PublishSubmissionPending, PublishRetryReconcileOnly
	}
}

func pendingGoogleBusinessPostResult(postName string) (PublishResult, error) {
	reference, err := googleBusinessPostReference(postName)
	if err != nil {
		return PublishResult{}, err
	}
	return PublishResult{
		SubmissionState:   PublishSubmissionPending,
		ProviderState:     "reconciling",
		ProviderReference: reference,
		RetrySafety:       PublishRetryReconcileOnly,
		ReconcileAfter:    googleBusinessReconcileDelay,
	}, nil
}

// settleGoogleBusinessDisabledDestination settles pending reviews when the
// destination can no longer operate local posts. Disabled destinations never
// retry; the operator reconnects or duplicates the post elsewhere.
func settleGoogleBusinessDisabledDestination(reference string) PublishResult {
	return PublishResult{
		SubmissionState:   PublishSubmissionRejected,
		ProviderState:     "destination_disabled",
		ProviderReference: reference,
		RetrySafety:       PublishRetryNever,
	}
}

func buildGoogleBusinessLocalPost(req *PublishRequest) (googleBusinessLocalPostRequest, error) {
	if req == nil {
		return googleBusinessLocalPostRequest{}, fmt.Errorf("google business publish request is required")
	}
	switch req.Profile {
	case "short_text", "image_post":
	default:
		return googleBusinessLocalPostRequest{}, fmt.Errorf("google business publishing does not support profile %q", req.Profile)
	}
	if req.ReplyToID != "" {
		return googleBusinessLocalPostRequest{}, fmt.Errorf("google business thread replies are not supported")
	}
	topic, err := googleBusinessPostTopic(req.Settings)
	if err != nil {
		return googleBusinessLocalPostRequest{}, err
	}
	summary := strings.TrimSpace(req.Content)
	if utf8.RuneCountInString(summary) > googleBusinessSummaryMaxRunes {
		return googleBusinessLocalPostRequest{}, fmt.Errorf("google business summary supports at most %d characters", googleBusinessSummaryMaxRunes)
	}
	media, err := googleBusinessPostMedia(req)
	if err != nil {
		return googleBusinessLocalPostRequest{}, err
	}
	if summary == "" && len(media) == 0 {
		return googleBusinessLocalPostRequest{}, fmt.Errorf("google business posts require text or a photo")
	}
	payload := googleBusinessLocalPostRequest{
		LanguageCode: googleBusinessLanguage(req.Settings),
		Summary:      summary,
		TopicType:    topic,
		Media:        media,
	}
	if err := applyGoogleBusinessTopicFields(req.Settings, topic, &payload); err != nil {
		return googleBusinessLocalPostRequest{}, err
	}
	return payload, nil
}

// applyGoogleBusinessTopicFields attaches the call-to-action, event, and
// offer blocks for one topic. OFFER posts carry no button because Google
// ignores it on that type.
func applyGoogleBusinessTopicFields(settings map[string]interface{}, topic string, payload *googleBusinessLocalPostRequest) error {
	if topic == "OFFER" {
		if callToAction := strings.TrimSpace(settingString(settings, "call_to_action")); callToAction != "" && !strings.EqualFold(callToAction, "none") {
			return fmt.Errorf("google business ignores call-to-action buttons on OFFER posts; remove it")
		}
		offer, err := googleBusinessOfferPayload(settings)
		if err != nil {
			return err
		}
		payload.Offer = offer
	} else {
		action, err := googleBusinessCallToActionPayload(settings)
		if err != nil {
			return err
		}
		payload.CallToAction = action
	}
	if topic == "EVENT" || topic == "OFFER" {
		event, err := googleBusinessEventPayload(settings, topic)
		if err != nil {
			return err
		}
		payload.Event = event
	}
	return nil
}

func googleBusinessLanguage(settings map[string]interface{}) string {
	language := strings.TrimSpace(settingString(settings, "language_code"))
	if language == "" {
		return "en-US"
	}
	return language
}

// googleBusinessPostMedia attaches at most one photo by public URL. Google
// fetches the bytes itself, so the Google-compatible JPEG derivative must
// stay alive in BlobStorage until moderation finishes; deleting it early
// turns review into rejection.
func googleBusinessPostMedia(req *PublishRequest) ([]googleBusinessMediaItem, error) {
	if len(req.PlatformMediaIDs) == 0 {
		if req.Profile == "image_post" {
			return nil, fmt.Errorf("google business photo updates require exactly one image")
		}
		return nil, nil
	}
	if len(req.PlatformMediaIDs) != 1 || len(req.Media) != 1 {
		return nil, fmt.Errorf("google business posts support at most one photo")
	}
	mimeType := strings.ToLower(strings.TrimSpace(req.Media[0].MimeType))
	switch mimeType {
	case "image/jpeg", "image/png":
	default:
		return nil, fmt.Errorf("google business photos must be JPEG or PNG")
	}
	sourceURL := strings.TrimSpace(req.PlatformMediaIDs[0])
	parsed, err := url.Parse(sourceURL)
	if err != nil || !strings.EqualFold(parsed.Scheme, "https") || parsed.Hostname() == "" || parsed.User != nil {
		return nil, fmt.Errorf("google business photos require a public HTTPS URL")
	}
	return []googleBusinessMediaItem{{MediaFormat: "PHOTO", SourceURL: sourceURL}}, nil
}

func googleBusinessCallToActionPayload(settings map[string]interface{}) (*googleBusinessCallToAction, error) {
	action := strings.ToUpper(strings.TrimSpace(settingString(settings, "call_to_action")))
	if action == "" || action == "NONE" {
		return nil, nil
	}
	if !googleBusinessCallToActions[action] {
		return nil, fmt.Errorf("google business call-to-action %q is not supported", action)
	}
	target := strings.TrimSpace(settingString(settings, "action_url"))
	if target == "" {
		return nil, fmt.Errorf("google business call-to-action requires an action_url")
	}
	parsed, err := url.Parse(target)
	if err != nil || (parsed.Hostname() == "" && parsed.Scheme != "tel") || parsed.User != nil {
		return nil, fmt.Errorf("google business action_url must be an absolute HTTP, HTTPS, or tel URL")
	}
	if action == "CALL" {
		if !strings.EqualFold(parsed.Scheme, "tel") {
			return nil, fmt.Errorf("google business CALL actions require a tel: URL")
		}
	} else if !strings.EqualFold(parsed.Scheme, "http") && !strings.EqualFold(parsed.Scheme, "https") {
		return nil, fmt.Errorf("google business action_url must be an absolute HTTP or HTTPS URL")
	}
	return &googleBusinessCallToAction{ActionType: action, URL: target}, nil
}

func googleBusinessEventPayload(settings map[string]interface{}, topic string) (*googleBusinessEvent, error) {
	title := strings.TrimSpace(settingString(settings, "event_title"))
	if title == "" {
		return nil, fmt.Errorf("google business %s posts require an event_title", strings.ToLower(topic))
	}
	if utf8.RuneCountInString(title) > googleBusinessEventTitleMaxRunes {
		return nil, fmt.Errorf("google business event titles support at most %d characters", googleBusinessEventTitleMaxRunes)
	}
	schedule, err := googleBusinessSchedulePayload(settings)
	if err != nil {
		return nil, err
	}
	return &googleBusinessEvent{Title: title, Schedule: schedule}, nil
}

func googleBusinessSchedulePayload(settings map[string]interface{}) (*googleBusinessSchedule, error) {
	startDate, err := googleBusinessDateValue(settingString(settings, "event_start_date"), "event_start_date")
	if err != nil {
		return nil, err
	}
	if startDate == nil {
		return nil, fmt.Errorf("google business event posts require an event_start_date")
	}
	schedule := &googleBusinessSchedule{StartDate: startDate}
	startTime, err := googleBusinessTimeValue(settingString(settings, "event_start_time"), "event_start_time")
	if err != nil {
		return nil, err
	}
	schedule.StartTime = startTime
	endDate, err := googleBusinessDateValue(settingString(settings, "event_end_date"), "event_end_date")
	if err != nil {
		return nil, err
	}
	schedule.EndDate = endDate
	endTime, err := googleBusinessTimeValue(settingString(settings, "event_end_time"), "event_end_time")
	if err != nil {
		return nil, err
	}
	schedule.EndTime = endTime
	return schedule, nil
}

func googleBusinessDateValue(raw, field string) (*googleBusinessDate, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}
	parsed, err := time.Parse("2006-01-02", trimmed)
	if err != nil {
		return nil, fmt.Errorf("google business %s must use YYYY-MM-DD", field)
	}
	return &googleBusinessDate{Year: parsed.Year(), Month: int(parsed.Month()), Day: parsed.Day()}, nil
}

func googleBusinessTimeValue(raw, field string) (*googleBusinessTime, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}
	parsed, err := time.Parse("15:04", trimmed)
	if err != nil {
		return nil, fmt.Errorf("google business %s must use HH:MM", field)
	}
	return &googleBusinessTime{Hours: parsed.Hour(), Minutes: parsed.Minute()}, nil
}

func googleBusinessOfferPayload(settings map[string]interface{}) (*googleBusinessOffer, error) {
	coupon := strings.TrimSpace(settingString(settings, "offer_coupon_code"))
	redeemURL := strings.TrimSpace(settingString(settings, "offer_redeem_url"))
	terms := strings.TrimSpace(settingString(settings, "offer_terms"))
	if coupon == "" && redeemURL == "" {
		return nil, fmt.Errorf("google business OFFER posts require an offer_coupon_code or offer_redeem_url")
	}
	if redeemURL != "" {
		parsed, err := url.Parse(redeemURL)
		if err != nil || (!strings.EqualFold(parsed.Scheme, "http") && !strings.EqualFold(parsed.Scheme, "https")) || parsed.Hostname() == "" || parsed.User != nil {
			return nil, fmt.Errorf("google business offer_redeem_url must be an absolute HTTP or HTTPS URL")
		}
	}
	return &googleBusinessOffer{CouponCode: coupon, RedeemOnlineURL: redeemURL, TermsConditions: terms}, nil
}

func (g *GoogleBusinessAdapter) Publish(ctx context.Context, accessToken, accountID string, req *PublishRequest) (PublishResult, error) {
	if req == nil {
		return PublishResult{}, fmt.Errorf("google business publish request is required")
	}
	if req.ResumeProviderReference != "" {
		return g.ReconcilePublish(ctx, accessToken, accountID, req.ResumeProviderReference)
	}
	if req.ResumeProviderState == "creating" {
		return PublishResult{ProviderState: "creating", RetrySafety: PublishRetryNever}, fmt.Errorf("google business local post create outcome is ambiguous; OpenPost will not replay it")
	}
	if err := g.ValidatePublishingTarget(ctx, accessToken, accountID, req.Settings); err != nil {
		return PublishResult{}, err
	}
	payload, err := buildGoogleBusinessLocalPost(req)
	if err != nil {
		return PublishResult{}, err
	}
	location := firstNonEmptyString(settingString(req.Settings, "location_id"), strings.TrimSpace(accountID))

	prepared := PublishResult{ProviderState: "creating", RetrySafety: PublishRetryNever}
	if err := req.BeginWrite(prepared); err != nil {
		return PublishResult{}, err
	}
	respBody, err := DoJSON(ctx, http.MethodPost, googleBusinessPostsBaseURL+"/"+location+"/localPosts", payload, bearerHeaders(accessToken))
	if err != nil {
		return prepared, fmt.Errorf("creating google business local post: %w", err)
	}
	var post googleBusinessLocalPost
	if err := json.Unmarshal(respBody, &post); err != nil {
		return prepared, fmt.Errorf("decoding google business local post create: %w", err)
	}
	post.Name = strings.TrimSpace(post.Name)
	if !googleBusinessPostNamePattern.MatchString(post.Name) {
		return prepared, fmt.Errorf("google business local post create response is missing a post name")
	}
	pending, err := pendingGoogleBusinessPostResult(post.Name)
	if err != nil {
		return prepared, err
	}
	// create != published: even when Google echoes LIVE immediately, the
	// durable job confirms it through reconciliation before settling.
	if err := req.Checkpoint(pending); err != nil {
		return pending, fmt.Errorf("checkpointing google business local post: %w", err)
	}
	return pending, nil
}

// ReconcilePublish performs a read-only lookup for a previously created post.
// It never recreates the write. Authentication failures bubble up so the
// credential layer refreshes the dead token; the durable job then reconciles
// the same reference instead of republishing.
func (g *GoogleBusinessAdapter) ReconcilePublish(ctx context.Context, accessToken, _ string, providerReference string) (PublishResult, error) {
	postName, err := googleBusinessPostNameFromReference(strings.TrimSpace(providerReference))
	if err != nil {
		return PublishResult{SubmissionState: PublishSubmissionRejected, RetrySafety: PublishRetryNever}, err
	}
	post, err := fetchGoogleBusinessPost(ctx, accessToken, postName)
	if err != nil {
		return googleBusinessReconcileFailure(postName, providerReference, err)
	}
	return settleGoogleBusinessPost(postName, providerReference, post)
}

// fetchGoogleBusinessPost performs the read-only lookup for one created post.
func fetchGoogleBusinessPost(ctx context.Context, accessToken, postName string) (googleBusinessLocalPost, error) {
	respBody, err := DoRequest(ctx, http.MethodGet, googleBusinessPostsBaseURL+"/"+postName, nil, bearerHeaders(accessToken))
	if err != nil {
		return googleBusinessLocalPost{}, err
	}
	var post googleBusinessLocalPost
	if err := json.Unmarshal(respBody, &post); err != nil {
		return googleBusinessLocalPost{}, fmt.Errorf("decoding google business local post reconciliation: %w", err)
	}
	if strings.TrimSpace(post.Name) != "" && strings.TrimSpace(post.Name) != postName {
		return googleBusinessLocalPost{}, fmt.Errorf("google business reconciliation returned a mismatched post")
	}
	return post, nil
}

// googleBusinessReconcileFailure maps a lookup failure to a durable outcome.
// Missing posts stay pending for eventual consistency; other client errors
// settle as rejected; transport and server errors stay pending with the
// original error so the durable job retries the read, never the write.
func googleBusinessReconcileFailure(postName, providerReference string, err error) (PublishResult, error) {
	pending, pendingErr := pendingGoogleBusinessPostResult(postName)
	if pendingErr != nil {
		return PublishResult{SubmissionState: PublishSubmissionRejected, RetrySafety: PublishRetryNever}, pendingErr
	}
	var providerErr *HTTPError
	if errors.As(err, &providerErr) {
		if providerErr.StatusCode == http.StatusNotFound {
			return pending, nil
		}
		if googleBusinessReconcileTerminal(providerErr.StatusCode) {
			return PublishResult{
				SubmissionState: PublishSubmissionRejected, ProviderState: "reconciliation_failed",
				ProviderReference: providerReference, RetrySafety: PublishRetryNever,
			}, fmt.Errorf("google business reconcile local post: %w", err)
		}
	}
	return pending, fmt.Errorf("google business reconcile local post: %w", err)
}

func googleBusinessReconcileTerminal(statusCode int) bool {
	if statusCode < 400 || statusCode >= 500 {
		return false
	}
	return statusCode != http.StatusRequestTimeout && statusCode != http.StatusTooManyRequests
}

// settleGoogleBusinessPost settles a fetched post through the durable state
// machine: only LIVE accepts, REJECTED is terminal, everything else stays
// pending with reconcile-only safety.
func settleGoogleBusinessPost(postName, providerReference string, post googleBusinessLocalPost) (PublishResult, error) {
	submission, safety := googleBusinessSubmissionClass(post.State)
	switch submission {
	case PublishSubmissionAccepted:
		reference, err := googleBusinessPostReference(postName)
		if err != nil {
			return PublishResult{SubmissionState: PublishSubmissionRejected, RetrySafety: PublishRetryNever}, err
		}
		result := AcceptedPublishResult(postName)
		result.ProviderState = "published"
		result.ProviderReference = reference
		result.ExternalURL = googleBusinessSearchURL(post.SearchURL)
		return result, nil
	case PublishSubmissionRejected:
		return PublishResult{
			SubmissionState: PublishSubmissionRejected, ProviderState: "rejected",
			ProviderReference: providerReference, RetrySafety: safety,
		}, fmt.Errorf("google business rejected the local post")
	default:
		pending, err := pendingGoogleBusinessPostResult(postName)
		if err != nil {
			return PublishResult{SubmissionState: PublishSubmissionRejected, RetrySafety: PublishRetryNever}, err
		}
		return pending, nil
	}
}

// ResolveContentURL returns the provider-issued search URL for a published
// post. Workers persist it so page reads never call the provider.
func (g *GoogleBusinessAdapter) ResolveContentURL(ctx context.Context, accessToken, _, externalID string) (string, error) {
	postName := strings.TrimSpace(externalID)
	if !googleBusinessPostNamePattern.MatchString(postName) {
		return "", fmt.Errorf("google business content URL resolution requires a local post resource name")
	}
	respBody, err := DoRequest(ctx, http.MethodGet, googleBusinessPostsBaseURL+"/"+postName, nil, bearerHeaders(accessToken))
	if err != nil {
		return "", fmt.Errorf("google business content URL: %w", err)
	}
	var post googleBusinessLocalPost
	if err := json.Unmarshal(respBody, &post); err != nil {
		return "", fmt.Errorf("decoding google business content URL: %w", err)
	}
	searchURL := googleBusinessSearchURL(post.SearchURL)
	if searchURL == "" {
		return "", fmt.Errorf("google business post has no shareable URL yet")
	}
	return searchURL, nil
}

func validateGoogleBusinessMedia(media []MediaItem) []MediaValidationIssue {
	if len(media) == 0 {
		return nil
	}
	if len(media) > 1 {
		return []MediaValidationIssue{{
			Provider: providerGoogleBusiness,
			Severity: severityError,
			Message:  "Google Business posts support at most one photo.",
		}}
	}
	mimeType := strings.ToLower(strings.TrimSpace(media[0].MimeType))
	if mimeType != "image/jpeg" && mimeType != "image/png" {
		return []MediaValidationIssue{{
			Provider: providerGoogleBusiness,
			MediaID:  media[0].ID,
			Severity: severityError,
			Message:  "Google Business posts support JPEG or PNG photos.",
		}}
	}
	return nil
}
