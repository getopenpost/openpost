package mastodonapps

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/netguard"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/uptrace/bun"
)

const (
	defaultScopes             = "read write"
	registrationStatusActive  = "registered"
	defaultRegistrationClient = "OpenPost"
)

type URLValidator func(context.Context, *url.URL) error

type Service struct {
	db          *bun.DB
	encryptor   *crypto.TokenEncryptor
	redirectURI string
	website     string
	clientName  string
	httpClient  *http.Client
	validator   URLValidator
}

type Options struct {
	RedirectURI string
	Website     string
	ClientName  string
	HTTPClient  *http.Client
	Validator   URLValidator
}

func NewService(db *bun.DB, encryptor *crypto.TokenEncryptor, opts Options) *Service {
	clientName := strings.TrimSpace(opts.ClientName)
	if clientName == "" {
		clientName = defaultRegistrationClient
	}
	redirectURI := strings.TrimSpace(opts.RedirectURI)
	if redirectURI == "" {
		redirectURI = "urn:ietf:wg:oauth:2.0:oob"
	}
	return &Service{
		db:          db,
		encryptor:   encryptor,
		redirectURI: redirectURI,
		website:     strings.TrimRight(strings.TrimSpace(opts.Website), "/"),
		clientName:  clientName,
		httpClient:  opts.HTTPClient,
		validator:   opts.Validator,
	}
}

func (s *Service) AdapterForInstance(ctx context.Context, rawInstanceURL string) (platform.Adapter, string, error) {
	instanceURL, host, err := s.normalizeInstanceURL(ctx, rawInstanceURL)
	if err != nil {
		return nil, "", err
	}

	instance, err := s.loadOrRegister(ctx, instanceURL, host)
	if err != nil {
		return nil, "", err
	}
	if !instance.BlockedAt.IsZero() {
		return nil, "", fmt.Errorf("mastodon instance is blocked: %s", instance.BlockReason)
	}
	secret, err := s.encryptor.Decrypt(instance.ClientSecretEnc)
	if err != nil {
		return nil, "", fmt.Errorf("failed to decrypt mastodon app secret: %w", err)
	}

	return platform.NewMastodonAdapter(instance.ClientID, secret, instance.RedirectURI, instance.InstanceURL), instance.InstanceURL, nil
}

func (s *Service) ListActiveAppConfigs(ctx context.Context) ([]platform.AppConfig, error) {
	var instances []models.MastodonInstance
	if err := s.db.NewSelect().
		Model(&instances).
		Where("registration_status = ?", registrationStatusActive).
		Where("blocked_at IS NULL").
		Order("instance_url ASC").
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("failed to list mastodon instances: %w", err)
	}

	configs := make([]platform.AppConfig, 0, len(instances))
	for _, instance := range instances {
		secret, err := s.encryptor.Decrypt(instance.ClientSecretEnc)
		if err != nil {
			return nil, fmt.Errorf("failed to decrypt mastodon instance %s: %w", instance.ID, err)
		}
		configs = append(configs, platform.NormalizeAppConfig(platform.AppConfig{
			Provider:     "mastodon",
			Name:         instance.Host,
			ClientID:     instance.ClientID,
			ClientSecret: secret,
			RedirectURI:  instance.RedirectURI,
			InstanceURL:  instance.InstanceURL,
		}))
	}
	return configs, nil
}

func (s *Service) loadOrRegister(ctx context.Context, instanceURL, host string) (models.MastodonInstance, error) {
	var instance models.MastodonInstance
	err := s.db.NewSelect().
		Model(&instance).
		Where("instance_url = ?", instanceURL).
		Scan(ctx)
	if err == nil {
		return instance, nil
	}
	if err != sql.ErrNoRows {
		return instance, fmt.Errorf("failed to load mastodon instance: %w", err)
	}

	app, err := s.registerApp(ctx, instanceURL)
	if err != nil {
		return instance, err
	}
	secretEnc, err := s.encryptor.Encrypt(app.ClientSecret)
	if err != nil {
		return instance, fmt.Errorf("failed to encrypt mastodon app secret: %w", err)
	}

	now := time.Now().UTC()
	instance = models.MastodonInstance{
		ID:                 uuid.NewString(),
		InstanceURL:        instanceURL,
		Host:               host,
		ClientID:           app.ClientID,
		ClientSecretEnc:    secretEnc,
		RedirectURI:        s.redirectURI,
		Scopes:             defaultScopes,
		RegistrationStatus: registrationStatusActive,
		LastVerifiedAt:     now,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	if _, err := s.db.NewInsert().Model(&instance).Exec(ctx); err != nil {
		var existing models.MastodonInstance
		if selectErr := s.db.NewSelect().
			Model(&existing).
			Where("instance_url = ?", instanceURL).
			Scan(ctx); selectErr == nil {
			return existing, nil
		}
		return instance, fmt.Errorf("failed to save mastodon instance app: %w", err)
	}
	return instance, nil
}

type appRegistrationResponse struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
}

func (s *Service) registerApp(ctx context.Context, instanceURL string) (appRegistrationResponse, error) {
	form := url.Values{}
	form.Set("client_name", s.clientName)
	form.Set("redirect_uris", s.redirectURI)
	form.Set("scopes", defaultScopes)
	if s.website != "" {
		form.Set("website", s.website)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, instanceURL+"/api/v1/apps", strings.NewReader(form.Encode()))
	if err != nil {
		return appRegistrationResponse{}, fmt.Errorf("failed to build mastodon app registration request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := s.client().Do(req)
	if err != nil {
		return appRegistrationResponse{}, fmt.Errorf("failed to register mastodon app: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return appRegistrationResponse{}, fmt.Errorf("mastodon app registration returned HTTP %d", resp.StatusCode)
	}
	var app appRegistrationResponse
	if err := json.NewDecoder(resp.Body).Decode(&app); err != nil {
		return appRegistrationResponse{}, fmt.Errorf("failed to decode mastodon app registration: %w", err)
	}
	if strings.TrimSpace(app.ClientID) == "" || strings.TrimSpace(app.ClientSecret) == "" {
		return appRegistrationResponse{}, fmt.Errorf("mastodon app registration response missing credentials")
	}
	return app, nil
}

func (s *Service) normalizeInstanceURL(ctx context.Context, raw string) (string, string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", "", fmt.Errorf("instance_url is required")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed == nil || parsed.Hostname() == "" {
		return "", "", fmt.Errorf("instance_url must be a valid URL")
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	parsed.Host = strings.ToLower(parsed.Host)
	parsed.User = nil
	parsed.Path = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	if err := s.validateURL(ctx, parsed); err != nil {
		return "", "", err
	}
	return strings.TrimRight(parsed.String(), "/"), parsed.Hostname(), nil
}

func (s *Service) validateURL(ctx context.Context, instanceURL *url.URL) error {
	validator := s.validator
	if validator == nil {
		validator = defaultValidateURL
	}
	return validator(ctx, instanceURL)
}

func defaultValidateURL(ctx context.Context, instanceURL *url.URL) error {
	return netguard.ValidateURL(ctx, instanceURL, mastodonURLPolicy())
}

func (s *Service) client() *http.Client {
	if s.httpClient != nil {
		return s.httpClient
	}
	client := netguard.NewHTTPClient(20*time.Second, mastodonURLPolicy())
	client.CheckRedirect = func(req *http.Request, _ []*http.Request) error {
		return s.validateURL(req.Context(), req.URL)
	}
	return client
}

func mastodonURLPolicy() netguard.URLPolicy {
	return netguard.URLPolicy{
		Label:            "instance_url",
		AllowedSchemes:   []string{"https"},
		AllowCustomPorts: false,
	}
}
