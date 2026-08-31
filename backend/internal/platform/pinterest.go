package platform

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	pinterestAuthorizationURL = "https://www.pinterest.com/oauth/"
	pinterestAPIBaseURL       = "https://api.pinterest.com/v5"
	pinterestTokenURL         = pinterestAPIBaseURL + "/oauth/token"
	pinterestPageSize         = 100
)

var pinterestOAuthScopes = []string{
	"boards:read",
	"boards:write",
	"pins:read",
	"pins:write",
	"user_accounts:read",
}

type PinterestAdapter struct {
	clientID     string
	clientSecret string
	redirectURI  string
}

func NewPinterestAdapter(clientID, clientSecret, redirectURI string) *PinterestAdapter {
	return &PinterestAdapter{clientID: clientID, clientSecret: clientSecret, redirectURI: redirectURI}
}

func (p *PinterestAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID:     p.clientID,
		ExecutionMode: "oauth2",
		Evidence:      map[string]string{"protocol": "oauth2", "exchange": "authorization_code"},
	}
}

func (p *PinterestAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	query := url.Values{
		oauthParamClientID:    {p.clientID},
		oauthParamRedirectURI: {p.redirectURI},
		"response_type":       {oauthResponseType},
		"scope":               {strings.Join(pinterestOAuthScopes, ",")},
		"state":               {state},
	}
	return pinterestAuthorizationURL + "?" + query.Encode(), nil
}

func (p *PinterestAdapter) ExchangeCode(ctx context.Context, code string, _ map[string]string) (*TokenResult, error) {
	if strings.TrimSpace(code) == "" {
		return nil, fmt.Errorf("pinterest token exchange requires an authorization code")
	}
	return p.exchangeToken(ctx, map[string]string{
		grantType:             oauthGrantAuthCode,
		oauthParamCode:        code,
		oauthParamRedirectURI: p.redirectURI,
	}, "pinterest token exchange")
}

func (p *PinterestAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{Supported: true, CredentialSource: RefreshCredentialRefreshToken}
}

func (p *PinterestAdapter) RefreshToken(ctx context.Context, input RefreshTokenInput) (*TokenResult, error) {
	if strings.TrimSpace(input.RefreshToken) == "" {
		return nil, fmt.Errorf("pinterest refresh requires a refresh token")
	}
	return p.exchangeToken(ctx, map[string]string{
		grantType:                             oauthGrantRefresh,
		string(RefreshCredentialRefreshToken): input.RefreshToken,
	}, "pinterest token refresh")
}

func (p *PinterestAdapter) exchangeToken(ctx context.Context, values map[string]string, label string) (*TokenResult, error) {
	body, err := DoFormURLEncoded(ctx, http.MethodPost, pinterestTokenURL, values, map[string]string{
		headerAuthorization: "Basic " + base64.StdEncoding.EncodeToString([]byte(p.clientID+":"+p.clientSecret)),
	})
	if err != nil {
		return nil, fmt.Errorf("%s: %w", label, err)
	}
	var response struct {
		AccessToken           string `json:"access_token"`
		RefreshToken          string `json:"refresh_token"`
		ExpiresIn             int    `json:"expires_in"`
		RefreshTokenExpiresIn int    `json:"refresh_token_expires_in"`
		TokenType             string `json:"token_type"`
		Scope                 string `json:"scope"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding %s: %w", label, err)
	}
	if strings.TrimSpace(response.AccessToken) == "" {
		return nil, fmt.Errorf("%s returned no access token", label)
	}
	return &TokenResult{
		AccessToken:      response.AccessToken,
		RefreshToken:     response.RefreshToken,
		ExpiresIn:        response.ExpiresIn,
		RefreshExpiresIn: response.RefreshTokenExpiresIn,
		TokenType:        firstNonEmptyString(response.TokenType, tokenTypeBearer),
		Extra:            map[string]string{"scope": response.Scope},
	}, nil
}

// RevokeAuthorization invalidates the current provider credential before the
// local grant is cleared.
func (p *PinterestAdapter) RevokeAuthorization(ctx context.Context, accessToken string) error {
	if strings.TrimSpace(accessToken) == "" {
		return fmt.Errorf("pinterest revocation requires an access token")
	}
	if _, err := DoFormURLEncoded(ctx, http.MethodPost, pinterestTokenURL+"/revoke", map[string]string{
		"token":           accessToken,
		"token_type_hint": "access_token",
	}, map[string]string{
		headerAuthorization: "Basic " + base64.StdEncoding.EncodeToString([]byte(p.clientID+":"+p.clientSecret)),
	}); err != nil {
		return fmt.Errorf("pinterest token revocation: %w", err)
	}
	return nil
}

func (p *PinterestAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	body, err := DoRequest(ctx, http.MethodGet, pinterestAPIBaseURL+"/user_account", nil, bearerHeaders(accessToken))
	if err != nil {
		return nil, fmt.Errorf("pinterest user account: %w", err)
	}
	var account struct {
		Username     string `json:"username"`
		BusinessName string `json:"business_name"`
		AccountType  string `json:"account_type"`
		ProfileImage string `json:"profile_image"`
	}
	if err := json.Unmarshal(body, &account); err != nil {
		return nil, fmt.Errorf("decoding pinterest user account: %w", err)
	}
	if strings.TrimSpace(account.Username) == "" {
		return nil, fmt.Errorf("pinterest user account returned no username")
	}
	return &UserProfile{
		ID:          account.Username,
		Username:    account.Username,
		DisplayName: firstNonEmptyString(account.BusinessName, account.Username),
		AvatarURL:   account.ProfileImage,
		CapabilityState: map[string]string{
			"pinterest_account_type": account.AccountType,
		},
	}, nil
}

func (p *PinterestAdapter) ListDestinationOptions(ctx context.Context, accessToken string, _ DestinationOptionsInput) (map[string][]DestinationOption, error) {
	boards, err := p.listAllBoards(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	return map[string][]DestinationOption{"pinterest_boards": pinterestBoardOptions(boards)}, nil
}

func (p *PinterestAdapter) SearchPublishingOptions(ctx context.Context, accessToken string, input PublishingOptionsInput) (PublishingOptionsPage, error) {
	switch input.Source {
	case "pinterest_boards":
		if strings.TrimSpace(input.Search) != "" {
			boards, err := p.listAllBoards(ctx, accessToken)
			if err != nil {
				return PublishingOptionsPage{}, err
			}
			return paginatePinterestOptions(pinterestBoardOptions(boards), input.Search, input.Cursor, input.Limit), nil
		}
		page, err := p.listBoardsPage(ctx, accessToken, input.Cursor, input.Limit)
		if err != nil {
			return PublishingOptionsPage{}, err
		}
		return PublishingOptionsPage{Options: pinterestBoardOptions(page.Items), NextCursor: page.Bookmark}, nil
	case "pinterest_sections":
		boardID := pinterestContextBoardID(input.Context)
		if boardID == "" {
			return PublishingOptionsPage{}, nil
		}
		if strings.TrimSpace(input.Search) != "" {
			sections, err := p.listAllSections(ctx, accessToken, boardID)
			if err != nil {
				return PublishingOptionsPage{}, err
			}
			return paginatePinterestOptions(pinterestSectionOptions(sections), input.Search, input.Cursor, input.Limit), nil
		}
		page, err := p.listSectionsPage(ctx, accessToken, boardID, input.Cursor, input.Limit)
		if err != nil {
			return PublishingOptionsPage{}, err
		}
		return PublishingOptionsPage{Options: pinterestSectionOptions(page.Items), NextCursor: page.Bookmark}, nil
	default:
		return PublishingOptionsPage{}, fmt.Errorf("pinterest publishing option source %q is not supported", input.Source)
	}
}

func (p *PinterestAdapter) ValidatePublishingTarget(ctx context.Context, accessToken, accountID string, settings map[string]interface{}) error {
	boardID := settingString(settings, "board_id")
	if boardID == "" {
		return fmt.Errorf("pinterest board is required")
	}
	profile, err := p.GetProfile(ctx, accessToken)
	if err != nil {
		return fmt.Errorf("validate pinterest account access: %w", err)
	}
	if strings.TrimSpace(accountID) != "" && !strings.EqualFold(profile.ID, accountID) {
		return fmt.Errorf("pinterest authorization no longer belongs to the connected account")
	}
	board, err := p.getBoard(ctx, accessToken, boardID)
	if err != nil {
		return fmt.Errorf("validate pinterest board: %w", err)
	}
	if board.Owner.Username == "" || !strings.EqualFold(board.Owner.Username, profile.Username) {
		return fmt.Errorf("pinterest board is not owned by the connected account")
	}

	sectionID := settingString(settings, "section_id")
	if sectionID == "" {
		return nil
	}
	sections, err := p.listAllSections(ctx, accessToken, boardID)
	if err != nil {
		return fmt.Errorf("validate pinterest board section: %w", err)
	}
	for _, section := range sections {
		if section.ID == sectionID {
			return nil
		}
	}
	return fmt.Errorf("pinterest board section does not belong to the selected board")
}

func (p *PinterestAdapter) UploadMedia(_ context.Context, _, _, _ string, _ io.Reader) (string, error) {
	return "", fmt.Errorf("pinterest media upload is not implemented")
}

func (p *PinterestAdapter) Publish(ctx context.Context, accessToken, accountID string, req *PublishRequest) (PublishResult, error) {
	payload, err := buildPinterestPinRequest(req)
	if err != nil {
		return PublishResult{}, err
	}
	if err := p.ValidatePublishingTarget(ctx, accessToken, accountID, req.Settings); err != nil {
		return PublishResult{}, err
	}

	prepared := PublishResult{ProviderState: "create_pin", RetrySafety: PublishRetryNever}
	if err := req.BeginWrite(prepared); err != nil {
		return PublishResult{}, err
	}
	body, err := DoJSON(ctx, http.MethodPost, pinterestAPIBaseURL+"/pins", payload, bearerHeaders(accessToken))
	if err != nil {
		return prepared, fmt.Errorf("creating pinterest Pin: %w", err)
	}
	var response struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return prepared, fmt.Errorf("decoding pinterest Pin create response: %w", err)
	}
	response.ID = strings.TrimSpace(response.ID)
	if response.ID == "" {
		return prepared, fmt.Errorf("pinterest Pin create response is missing an id")
	}
	result := AcceptedPublishResult(response.ID)
	result.ProviderState = "pin_created"
	result.ExternalURL = pinterestPinURL(response.ID)
	if err := req.Checkpoint(result); err != nil {
		return result, err
	}
	return result, nil
}

type pinterestPinCreateRequest struct {
	BoardID        string                  `json:"board_id"`
	BoardSectionID string                  `json:"board_section_id,omitempty"`
	Title          string                  `json:"title,omitempty"`
	Description    string                  `json:"description,omitempty"`
	Link           string                  `json:"link,omitempty"`
	AltText        string                  `json:"alt_text,omitempty"`
	AIDisclosures  *pinterestAIDisclosures `json:"ai_disclosures,omitempty"`
	MediaSource    pinterestPinMediaSource `json:"media_source"`
}

type pinterestPinMediaSource struct {
	SourceType string                  `json:"source_type"`
	URL        string                  `json:"url,omitempty"`
	Items      []pinterestPinMediaItem `json:"items,omitempty"`
}

type pinterestPinMediaItem struct {
	URL         string `json:"url"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	Link        string `json:"link,omitempty"`
}

type pinterestAIDisclosures struct {
	Values []string `json:"values"`
}

func buildPinterestPinRequest(req *PublishRequest) (pinterestPinCreateRequest, error) {
	if req == nil {
		return pinterestPinCreateRequest{}, fmt.Errorf("pinterest publish request is required")
	}
	if err := validatePinterestPublishMedia(req); err != nil {
		return pinterestPinCreateRequest{}, err
	}
	title, description, link, altText, aiDisclosures, err := pinterestPinMetadata(req)
	if err != nil {
		return pinterestPinCreateRequest{}, err
	}
	payload := pinterestPinCreateRequest{
		BoardID:        settingString(req.Settings, "board_id"),
		BoardSectionID: settingString(req.Settings, "section_id"),
		Title:          title,
		Description:    description,
		Link:           link,
		AltText:        altText,
		AIDisclosures:  aiDisclosures,
	}
	if len(req.PlatformMediaIDs) == 1 {
		payload.MediaSource = pinterestPinMediaSource{SourceType: "image_url", URL: req.PlatformMediaIDs[0]}
		return payload, nil
	}

	payload.MediaSource.SourceType = "multiple_image_urls"
	payload.MediaSource.Items = make([]pinterestPinMediaItem, 0, len(req.PlatformMediaIDs))
	for _, mediaURL := range req.PlatformMediaIDs {
		payload.MediaSource.Items = append(payload.MediaSource.Items, pinterestPinMediaItem{
			URL: mediaURL, Title: title, Description: description, Link: link,
		})
	}
	return payload, nil
}

func validatePinterestPublishMedia(req *PublishRequest) error {
	mediaCount := len(req.PlatformMediaIDs)
	if req.Profile == "image_post" && mediaCount != 1 {
		return fmt.Errorf("pinterest image Pins require exactly one image")
	}
	if req.Profile == "carousel" && (mediaCount < 2 || mediaCount > 5) {
		return fmt.Errorf("pinterest multi-image Pins require 2-5 images")
	}
	if req.Profile != "image_post" && req.Profile != "carousel" {
		return fmt.Errorf("pinterest publishing does not support profile %q", req.Profile)
	}
	if len(req.Media) != mediaCount {
		return fmt.Errorf("pinterest publishing requires ordered media metadata for every image")
	}
	for index, item := range req.Media {
		if !pinterestImageMIME(item.MimeType) {
			return fmt.Errorf("pinterest image %d must be JPEG, PNG, or WebP", index+1)
		}
		if item.Size > 20*1024*1024 {
			return fmt.Errorf("pinterest image %d must be 20MB or smaller", index+1)
		}
		if !pinterestSourceURL(req.PlatformMediaIDs[index]) {
			return fmt.Errorf("pinterest image %d requires a public HTTPS URL", index+1)
		}
	}
	return nil
}

func pinterestPinMetadata(req *PublishRequest) (string, string, string, string, *pinterestAIDisclosures, error) {
	title := strings.TrimSpace(firstNonEmptyString(settingString(req.Settings, "pin_title"), req.Title))
	description := strings.TrimSpace(firstNonEmptyString(req.Description, req.Content))
	link := strings.TrimSpace(settingString(req.Settings, "destination_link"))
	if utf8.RuneCountInString(title) > 100 {
		return "", "", "", "", nil, fmt.Errorf("pinterest Pin title must be 100 characters or fewer")
	}
	if utf8.RuneCountInString(description) > 800 {
		return "", "", "", "", nil, fmt.Errorf("pinterest Pin description must be 800 characters or fewer")
	}
	if link != "" && !pinterestDestinationURL(link) {
		return "", "", "", "", nil, fmt.Errorf("pinterest destination link must be an absolute HTTP or HTTPS URL")
	}
	altText := strings.TrimSpace(settingString(req.Settings, "alt_text"))
	if len(req.MediaAltTexts) > 0 && strings.TrimSpace(req.MediaAltTexts[0]) != "" {
		altText = strings.TrimSpace(req.MediaAltTexts[0])
	}
	if utf8.RuneCountInString(altText) > 500 {
		return "", "", "", "", nil, fmt.Errorf("pinterest Pin alt text must be 500 characters or fewer")
	}
	aiDisclosures, err := pinterestAIDisclosure(req.Settings)
	if err != nil {
		return "", "", "", "", nil, err
	}
	return title, description, link, altText, aiDisclosures, nil
}

func pinterestAIDisclosure(settings map[string]interface{}) (*pinterestAIDisclosures, error) {
	raw, present := settings["is_ai_generated"]
	if !present {
		return nil, nil
	}
	value, ok := raw.(bool)
	if !ok {
		return nil, fmt.Errorf("pinterest AI-generated disclosure must be a boolean")
	}
	if !value {
		return nil, nil
	}
	return &pinterestAIDisclosures{Values: []string{"AI_MODIFIED"}}, nil
}

func pinterestImageMIME(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "image/jpeg", "image/png", "image/webp":
		return true
	default:
		return false
	}
}

func pinterestSourceURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil
}

func pinterestDestinationURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != "" && parsed.User == nil
}

func pinterestPinURL(pinID string) string {
	pinID = strings.TrimSpace(pinID)
	if pinID == "" {
		return ""
	}
	for _, char := range pinID {
		if char < '0' || char > '9' {
			return ""
		}
	}
	return "https://www.pinterest.com/pin/" + pinID + "/"
}

func validatePinterestMedia(media []MediaItem) []MediaValidationIssue {
	if len(media) < 1 || len(media) > 5 {
		return []MediaValidationIssue{{Provider: providerPinterest, Severity: severityError, Message: "Pinterest Pins require 1-5 images."}}
	}
	for _, item := range media {
		if !pinterestImageMIME(item.MimeType) {
			return []MediaValidationIssue{{Provider: providerPinterest, MediaID: item.ID, Severity: severityError, Message: "Pinterest Pins support JPEG, PNG, or WebP images only."}}
		}
		if item.Size > 20*1024*1024 {
			return []MediaValidationIssue{{Provider: providerPinterest, MediaID: item.ID, Severity: severityError, Message: "Pinterest images must be 20MB or smaller."}}
		}
	}
	return nil
}

type pinterestBoard struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Privacy string `json:"privacy"`
	Owner   struct {
		Username string `json:"username"`
	} `json:"owner"`
}

type pinterestSection struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type pinterestPage[T any] struct {
	Items    []T    `json:"items"`
	Bookmark string `json:"bookmark"`
}

func (p *PinterestAdapter) listBoardsPage(ctx context.Context, accessToken, bookmark string, limit int) (pinterestPage[pinterestBoard], error) {
	limit = pinterestBoundedLimit(limit)
	query := url.Values{"page_size": {strconv.Itoa(limit)}, "privacy": {"ALL"}}
	if bookmark != "" {
		query.Set("bookmark", bookmark)
	}
	return pinterestGetPage[pinterestBoard](ctx, accessToken, pinterestAPIBaseURL+"/boards?"+query.Encode(), "boards")
}

func (p *PinterestAdapter) listAllBoards(ctx context.Context, accessToken string) ([]pinterestBoard, error) {
	items := []pinterestBoard{}
	seenIDs := map[string]struct{}{}
	bookmark := ""
	seenBookmarks := map[string]struct{}{}
	for {
		page, err := p.listBoardsPage(ctx, accessToken, bookmark, pinterestPageSize)
		if err != nil {
			return nil, err
		}
		for _, board := range page.Items {
			if board.ID == "" {
				continue
			}
			if _, duplicate := seenIDs[board.ID]; duplicate {
				continue
			}
			seenIDs[board.ID] = struct{}{}
			items = append(items, board)
		}
		if page.Bookmark == "" {
			return items, nil
		}
		if _, repeated := seenBookmarks[page.Bookmark]; repeated {
			return nil, fmt.Errorf("pinterest boards pagination returned a repeated bookmark")
		}
		seenBookmarks[page.Bookmark] = struct{}{}
		bookmark = page.Bookmark
	}
}

func (p *PinterestAdapter) getBoard(ctx context.Context, accessToken, boardID string) (pinterestBoard, error) {
	body, err := DoRequest(ctx, http.MethodGet, pinterestAPIBaseURL+"/boards/"+url.PathEscape(boardID), nil, bearerHeaders(accessToken))
	if err != nil {
		return pinterestBoard{}, err
	}
	var board pinterestBoard
	if err := json.Unmarshal(body, &board); err != nil {
		return pinterestBoard{}, fmt.Errorf("decoding pinterest board: %w", err)
	}
	if board.ID == "" {
		return pinterestBoard{}, fmt.Errorf("pinterest board response is missing an id")
	}
	return board, nil
}

func (p *PinterestAdapter) listSectionsPage(ctx context.Context, accessToken, boardID, bookmark string, limit int) (pinterestPage[pinterestSection], error) {
	limit = pinterestBoundedLimit(limit)
	query := url.Values{"page_size": {strconv.Itoa(limit)}}
	if bookmark != "" {
		query.Set("bookmark", bookmark)
	}
	endpoint := pinterestAPIBaseURL + "/boards/" + url.PathEscape(boardID) + "/sections?" + query.Encode()
	return pinterestGetPage[pinterestSection](ctx, accessToken, endpoint, "board sections")
}

func (p *PinterestAdapter) listAllSections(ctx context.Context, accessToken, boardID string) ([]pinterestSection, error) {
	items := []pinterestSection{}
	bookmark := ""
	seenBookmarks := map[string]struct{}{}
	for {
		page, err := p.listSectionsPage(ctx, accessToken, boardID, bookmark, pinterestPageSize)
		if err != nil {
			return nil, err
		}
		items = append(items, page.Items...)
		if page.Bookmark == "" {
			return items, nil
		}
		if _, repeated := seenBookmarks[page.Bookmark]; repeated {
			return nil, fmt.Errorf("pinterest board sections pagination returned a repeated bookmark")
		}
		seenBookmarks[page.Bookmark] = struct{}{}
		bookmark = page.Bookmark
	}
}

func pinterestGetPage[T any](ctx context.Context, accessToken, endpoint, label string) (pinterestPage[T], error) {
	body, err := DoRequest(ctx, http.MethodGet, endpoint, nil, bearerHeaders(accessToken))
	if err != nil {
		return pinterestPage[T]{}, fmt.Errorf("pinterest %s: %w", label, err)
	}
	var page pinterestPage[T]
	if err := json.Unmarshal(body, &page); err != nil {
		return pinterestPage[T]{}, fmt.Errorf("decoding pinterest %s: %w", label, err)
	}
	return page, nil
}

func pinterestBoardOptions(items []pinterestBoard) []DestinationOption {
	options := make([]DestinationOption, 0, len(items))
	for _, board := range items {
		if board.ID == "" {
			continue
		}
		options = append(options, DestinationOption{Value: board.ID, Label: firstNonEmptyString(board.Name, board.ID)})
	}
	return options
}

func pinterestSectionOptions(items []pinterestSection) []DestinationOption {
	options := make([]DestinationOption, 0, len(items))
	for _, section := range items {
		if section.ID == "" {
			continue
		}
		options = append(options, DestinationOption{Value: section.ID, Label: firstNonEmptyString(section.Name, section.ID)})
	}
	return options
}

func pinterestContextBoardID(contextValues map[string]string) string {
	raw := strings.TrimSpace(contextValues["value"])
	if raw == "" {
		return ""
	}
	var settings map[string]interface{}
	if json.Unmarshal([]byte(raw), &settings) != nil {
		return ""
	}
	return settingString(settings, "board_id")
}

func pinterestBoundedLimit(limit int) int {
	if limit <= 0 || limit > pinterestPageSize {
		return pinterestPageSize
	}
	return limit
}

func paginatePinterestOptions(options []DestinationOption, search, cursor string, limit int) PublishingOptionsPage {
	query := strings.ToLower(strings.TrimSpace(search))
	filtered := make([]DestinationOption, 0, len(options))
	for _, option := range options {
		if query == "" || strings.Contains(strings.ToLower(option.Label), query) {
			filtered = append(filtered, option)
		}
	}
	limit = pinterestBoundedLimit(limit)
	offset, _ := strconv.Atoi(cursor)
	if offset < 0 || offset > len(filtered) {
		offset = 0
	}
	end := min(offset+limit, len(filtered))
	page := PublishingOptionsPage{Options: filtered[offset:end]}
	if end < len(filtered) {
		page.NextCursor = strconv.Itoa(end)
	}
	return page
}
