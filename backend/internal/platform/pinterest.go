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
	if req == nil {
		return PublishResult{}, fmt.Errorf("pinterest publish request is required")
	}
	if err := p.ValidatePublishingTarget(ctx, accessToken, accountID, req.Settings); err != nil {
		return PublishResult{}, err
	}
	return PublishResult{}, fmt.Errorf("pinterest Pin publishing is not implemented")
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
