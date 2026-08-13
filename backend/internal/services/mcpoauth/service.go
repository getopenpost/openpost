package mcpoauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/netguard"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

const (
	AuthorizationCodeLifetime = 10 * time.Minute
	CodeChallengeMethodS256   = "S256"
	MaxClientMetadataBytes    = 128 * 1024
)

var (
	ErrInvalidRequest      = errors.New("invalid oauth request")
	ErrInvalidClient       = errors.New("invalid oauth client")
	ErrInvalidGrant        = errors.New("invalid oauth grant")
	ErrUnsupportedGrant    = errors.New("unsupported oauth grant")
	ErrUnsupportedPKCE     = errors.New("unsupported pkce method")
	ErrUnsupportedScope    = errors.New("unsupported oauth scope")
	ErrUnsupportedResource = errors.New("unsupported oauth resource")
	ErrWorkspaceNotAllowed = errors.New("workspace not accessible")
)

var clientMetadataURLPolicy = netguard.URLPolicy{
	Label:            "oauth client metadata URL",
	AllowedSchemes:   []string{"https"},
	AllowCustomPorts: true,
}

type Service struct {
	db         *bun.DB
	tokens     *apitokens.Service
	httpClient *http.Client
	now        func() time.Time
}

type AuthorizationRequest struct {
	UserID              string
	WorkspaceID         string
	ResponseType        string
	ClientID            string
	RedirectURI         string
	Scope               string
	State               string
	CodeChallenge       string
	CodeChallengeMethod string
	Resource            string
	ExpectedResource    string
	OrganizationID      string
	IdentityProviderID  string
	AssuredAt           time.Time
	TokenExpiresAt      time.Time
}

type AuthorizationResult struct {
	RedirectURL string
	Code        string
}

type TokenRequest struct {
	GrantType        string
	Code             string
	RedirectURI      string
	ClientID         string
	CodeVerifier     string
	Resource         string
	ExpectedResource string
}

type TokenResult struct {
	AccessToken string
	TokenPrefix string
	Scope       string
	ExpiresIn   int
	Resource    string
}

type clientMetadata struct {
	ClientName              string   `json:"client_name"`
	RedirectURIs            []string `json:"redirect_uris"`
	TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
	GrantTypes              []string `json:"grant_types"`
	ResponseTypes           []string `json:"response_types"`
	Scope                   string   `json:"scope"`
}

func NewService(db *bun.DB, tokens *apitokens.Service) *Service {
	return &Service{
		db:         db,
		tokens:     tokens,
		httpClient: netguard.NewHTTPClient(5*time.Second, clientMetadataURLPolicy),
		now: func() time.Time {
			return time.Now().UTC()
		},
	}
}

func (s *Service) SetHTTPClient(client *http.Client) {
	if client != nil {
		s.httpClient = client
	}
}

func (s *Service) CreateAuthorizationCode(ctx context.Context, input AuthorizationRequest) (*AuthorizationResult, error) {
	if strings.TrimSpace(input.ResponseType) != "code" {
		return nil, ErrInvalidRequest
	}
	if strings.TrimSpace(input.UserID) == "" {
		return nil, ErrInvalidRequest
	}
	workspaceID, err := s.normalizeWorkspaceScope(ctx, input.UserID, input.WorkspaceID)
	if err != nil {
		return nil, err
	}
	scope, err := normalizeScope(input.Scope)
	if err != nil {
		return nil, err
	}
	resource, err := normalizeResource(input.Resource, input.ExpectedResource)
	if err != nil {
		return nil, err
	}
	if err := validatePKCE(input.CodeChallenge, input.CodeChallengeMethod); err != nil {
		return nil, err
	}
	redirectURI, err := validateRedirectURI(input.RedirectURI)
	if err != nil {
		return nil, err
	}
	clientName, err := s.resolveClient(ctx, input.ClientID, redirectURI.String(), scope)
	if err != nil {
		return nil, err
	}

	code, codeHash, err := generateSecretHash()
	if err != nil {
		return nil, err
	}
	model := &models.MCPOAuthCode{
		ID:                  uuid.NewString(),
		CodeHash:            codeHash,
		UserID:              strings.TrimSpace(input.UserID),
		ClientID:            strings.TrimSpace(input.ClientID),
		ClientName:          clientName,
		RedirectURI:         redirectURI.String(),
		Scope:               scope,
		WorkspaceID:         workspaceID,
		OrganizationID:      strings.TrimSpace(input.OrganizationID),
		IdentityProviderID:  strings.TrimSpace(input.IdentityProviderID),
		AssuredAt:           input.AssuredAt,
		TokenExpiresAt:      input.TokenExpiresAt,
		Resource:            resource,
		CodeChallenge:       strings.TrimSpace(input.CodeChallenge),
		CodeChallengeMethod: CodeChallengeMethodS256,
		ExpiresAt:           s.now().Add(AuthorizationCodeLifetime),
		CreatedAt:           s.now(),
	}
	if _, err := s.db.NewInsert().Model(model).Exec(ctx); err != nil {
		return nil, err
	}

	return &AuthorizationResult{
		RedirectURL: buildRedirect(redirectURI.String(), map[string]string{
			"code":  code,
			"state": input.State,
			"iss":   issuerFromResource(resource),
		}),
		Code: code,
	}, nil
}

func (s *Service) DenyRedirect(ctx context.Context, input AuthorizationRequest) (*AuthorizationResult, error) {
	redirectURI, err := validateRedirectURI(input.RedirectURI)
	if err != nil {
		return nil, err
	}
	scope, err := normalizeScope(input.Scope)
	if err != nil {
		return nil, err
	}
	if _, err := normalizeResource(input.Resource, input.ExpectedResource); err != nil {
		return nil, err
	}
	if _, err := s.resolveClient(ctx, input.ClientID, redirectURI.String(), scope); err != nil {
		return nil, err
	}
	return &AuthorizationResult{
		RedirectURL: buildRedirect(redirectURI.String(), map[string]string{
			"error":             "access_denied",
			"error_description": "The user denied the OpenPost MCP connection.",
			"state":             input.State,
		}),
	}, nil
}

func (s *Service) ExchangeCode(ctx context.Context, input TokenRequest) (*TokenResult, error) {
	if strings.TrimSpace(input.GrantType) != "authorization_code" {
		return nil, ErrUnsupportedGrant
	}
	if strings.TrimSpace(input.CodeVerifier) == "" {
		return nil, ErrInvalidRequest
	}
	redirectURI, err := validateRedirectURI(input.RedirectURI)
	if err != nil {
		return nil, ErrInvalidGrant
	}

	code, err := s.validExchangeCode(ctx, input, redirectURI.String())
	if err != nil {
		return nil, err
	}
	now := s.now()
	if err := s.consumeCode(ctx, code.ID, now); err != nil {
		return nil, err
	}

	expiresAt := code.TokenExpiresAt
	if expiresAt.IsZero() {
		expiresAt = now.Add(apitokens.DefaultExpiration)
	}
	generated, err := s.tokens.GenerateTokenWithOptions(ctx, code.UserID, tokenName(*code), code.Scope, apitokens.GenerateOptions{
		ExpiresAt:          &expiresAt,
		WorkspaceID:        code.WorkspaceID,
		OrganizationID:     code.OrganizationID,
		IdentityProviderID: code.IdentityProviderID,
		AssuredAt:          code.AssuredAt,
		Audience:           code.Resource,
		ClientID:           code.ClientID,
	})
	if err != nil {
		return nil, err
	}
	return &TokenResult{
		AccessToken: generated.Token,
		TokenPrefix: generated.Model.TokenPrefix,
		Scope:       generated.Model.Scope,
		ExpiresIn:   int(expiresAt.Sub(now).Seconds()),
		Resource:    code.Resource,
	}, nil
}

func (s *Service) validExchangeCode(ctx context.Context, input TokenRequest, redirectURI string) (*models.MCPOAuthCode, error) {
	code, err := s.loadCode(ctx, input.Code)
	if err != nil {
		return nil, err
	}
	if !code.ExpiresAt.After(s.now()) || !code.ConsumedAt.IsZero() {
		return nil, ErrInvalidGrant
	}
	if code.ClientID != strings.TrimSpace(input.ClientID) || code.RedirectURI != redirectURI {
		return nil, ErrInvalidGrant
	}
	if err := validateExchangeResource(input, code.Resource); err != nil {
		return nil, err
	}
	if err := validateCodeVerifier(code.CodeChallenge, input.CodeVerifier); err != nil {
		return nil, err
	}
	return code, nil
}

func (s *Service) loadCode(ctx context.Context, rawCode string) (*models.MCPOAuthCode, error) {
	var code models.MCPOAuthCode
	if err := s.db.NewSelect().Model(&code).Where("code_hash = ?", hashSecret(strings.TrimSpace(rawCode))).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrInvalidGrant
		}
		return nil, err
	}
	return &code, nil
}

func (s *Service) consumeCode(ctx context.Context, codeID string, consumedAt time.Time) error {
	result, err := s.db.NewUpdate().
		Model((*models.MCPOAuthCode)(nil)).
		Set("consumed_at = ?", consumedAt).
		Where("id = ? AND consumed_at IS NULL", codeID).
		Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrInvalidGrant
	}
	return nil
}

func (s *Service) normalizeWorkspaceScope(ctx context.Context, userID, workspaceID string) (string, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return "", nil
	}
	allowed, err := workspaceaccess.Allows(ctx, s.db, workspaceID, strings.TrimSpace(userID))
	if err != nil {
		return "", err
	}
	if !allowed {
		return "", ErrWorkspaceNotAllowed
	}
	return workspaceID, nil
}

func (s *Service) resolveClient(ctx context.Context, clientID, redirectURI, scope string) (string, error) {
	clientID = strings.TrimSpace(clientID)
	if clientID == "" {
		return "", ErrInvalidClient
	}
	clientURL, err := validateClientMetadataURL(clientID)
	if err != nil {
		return resolveFallbackClient(clientID, redirectURI)
	}

	metadata, err := s.fetchClientMetadata(ctx, clientURL.String())
	if err != nil {
		return "", err
	}
	if err := validateClientMetadata(metadata, redirectURI, scope); err != nil {
		return "", err
	}
	if strings.TrimSpace(metadata.ClientName) != "" {
		return strings.TrimSpace(metadata.ClientName), nil
	}
	return fallbackClientName(clientID), nil
}

func resolveFallbackClient(clientID, redirectURI string) (string, error) {
	if fallbackRedirectAllowed(redirectURI) {
		return fallbackClientName(clientID), nil
	}
	return "", ErrInvalidClient
}

func (s *Service) fetchClientMetadata(ctx context.Context, clientURL string) (clientMetadata, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, clientURL, nil)
	if err != nil {
		return clientMetadata{}, ErrInvalidClient
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return clientMetadata{}, ErrInvalidClient
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return clientMetadata{}, ErrInvalidClient
	}
	var metadata clientMetadata
	decoder := json.NewDecoder(io.LimitReader(resp.Body, MaxClientMetadataBytes))
	if err := decoder.Decode(&metadata); err != nil {
		return clientMetadata{}, ErrInvalidClient
	}
	return metadata, nil
}

func validateClientMetadata(metadata clientMetadata, redirectURI, scope string) error {
	if len(metadata.RedirectURIs) == 0 || !slices.Contains(metadata.RedirectURIs, redirectURI) {
		return ErrInvalidClient
	}
	if metadata.TokenEndpointAuthMethod != "" && metadata.TokenEndpointAuthMethod != "none" {
		return ErrInvalidClient
	}
	if len(metadata.GrantTypes) > 0 && !slices.Contains(metadata.GrantTypes, "authorization_code") {
		return ErrInvalidClient
	}
	if len(metadata.ResponseTypes) > 0 && !slices.Contains(metadata.ResponseTypes, "code") {
		return ErrInvalidClient
	}
	if metadata.Scope != "" && !clientMetadataAllowsScope(metadata.Scope, scope) {
		return ErrUnsupportedScope
	}
	return nil
}

func clientMetadataAllowsScope(rawScopes, requestedScope string) bool {
	requestedScope = strings.TrimSpace(requestedScope)
	found := false
	for _, scope := range strings.Fields(rawScopes) {
		switch scope {
		case apitokens.ScopeMCPRead, apitokens.ScopeMCP:
		default:
			return false
		}
		if scope == requestedScope {
			found = true
		}
	}
	return found
}

func validateExchangeResource(input TokenRequest, codeResource string) error {
	if input.Resource != "" && strings.TrimSpace(input.Resource) != codeResource {
		return ErrUnsupportedResource
	}
	if input.ExpectedResource != "" && strings.TrimRight(strings.TrimSpace(input.ExpectedResource), "/") != codeResource {
		return ErrUnsupportedResource
	}
	return nil
}

func normalizeScope(scope string) (string, error) {
	parts := strings.Fields(scope)
	if len(parts) == 0 {
		return apitokens.ScopeMCP, nil
	}
	if len(parts) == 1 {
		switch parts[0] {
		case apitokens.ScopeMCPRead, apitokens.ScopeMCP:
			return parts[0], nil
		}
	}
	return "", ErrUnsupportedScope
}

func normalizeResource(resource, expected string) (string, error) {
	expected = strings.TrimRight(strings.TrimSpace(expected), "/")
	resource = strings.TrimRight(strings.TrimSpace(resource), "/")
	if expected == "" {
		return resource, nil
	}
	if resource == "" {
		return expected, nil
	}
	if resource != expected {
		return "", ErrUnsupportedResource
	}
	return resource, nil
}

func validatePKCE(challenge, method string) error {
	if strings.TrimSpace(method) != CodeChallengeMethodS256 {
		return ErrUnsupportedPKCE
	}
	if !validCodeParam(challenge) {
		return ErrInvalidRequest
	}
	return nil
}

func validateCodeVerifier(challenge, verifier string) error {
	if !validCodeParam(verifier) {
		return ErrInvalidGrant
	}
	sum := sha256.Sum256([]byte(verifier))
	expected := base64.RawURLEncoding.EncodeToString(sum[:])
	if subtle.ConstantTimeCompare([]byte(expected), []byte(challenge)) != 1 {
		return ErrInvalidGrant
	}
	return nil
}

func validCodeParam(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) < 43 || len(value) > 128 {
		return false
	}
	for _, r := range value {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '.' || r == '_' || r == '~' {
			continue
		}
		return false
	}
	return true
}

func validateRedirectURI(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.Fragment != "" || parsed.User != nil {
		return nil, ErrInvalidRequest
	}
	if !oauthURLSchemeAllowed(parsed.Scheme, parsed.Hostname()) {
		return nil, ErrInvalidRequest
	}
	return parsed, nil
}

func validateClientMetadataURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.Fragment != "" || parsed.User != nil {
		return nil, ErrInvalidClient
	}
	if parsed.Scheme != "https" {
		return nil, ErrInvalidClient
	}
	return parsed, nil
}

func oauthURLSchemeAllowed(scheme, host string) bool {
	return scheme == "https" || (scheme == "http" && isLoopbackHost(host))
}

func fallbackRedirectAllowed(raw string) bool {
	parsed, err := validateRedirectURI(raw)
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	switch host {
	case "chatgpt.com", "chat.openai.com":
		return strings.HasPrefix(parsed.EscapedPath(), "/connector")
	default:
		return isLoopbackHost(host)
	}
}

func isLoopbackHost(host string) bool {
	host = strings.Trim(strings.ToLower(host), "[]")
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func generateSecretHash() (string, string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", err
	}
	secret := base64.RawURLEncoding.EncodeToString(buf)
	return secret, hashSecret(secret), nil
}

func hashSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func buildRedirect(raw string, params map[string]string) string {
	redirect, _ := url.Parse(raw)
	query := redirect.Query()
	for key, value := range params {
		if strings.TrimSpace(value) == "" {
			continue
		}
		query.Set(key, value)
	}
	redirect.RawQuery = query.Encode()
	return redirect.String()
}

func issuerFromResource(resource string) string {
	if resource == "" {
		return ""
	}
	parsed, err := url.Parse(resource)
	if err != nil {
		return ""
	}
	parsed.Path = ""
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/")
}

func fallbackClientName(clientID string) string {
	parsed, err := url.Parse(clientID)
	if err == nil && parsed.Hostname() != "" {
		return parsed.Hostname()
	}
	return clientID
}

func tokenName(code models.MCPOAuthCode) string {
	if strings.TrimSpace(code.ClientName) != "" {
		return strings.TrimSpace(code.ClientName)
	}
	return "OpenPost MCP"
}
