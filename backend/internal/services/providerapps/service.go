package providerapps

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/uptrace/bun"
)

var ErrNotFound = errors.New("provider app not found")

type ValidationError struct {
	Message string
}

func (e ValidationError) Error() string {
	return e.Message
}

type UpsertInput struct {
	Provider       string
	ConnectionMode string
	Name           string
	ClientID       string
	ClientSecret   *string
	RedirectURI    string
	InstanceURL    string
	BotToken       *string
	BotUsername    string
	WebhookSecret  *string
	IsActive       bool
}

type Service struct {
	db        *bun.DB
	encryptor *crypto.TokenEncryptor
}

func NewService(db *bun.DB, encryptor *crypto.TokenEncryptor) *Service {
	return &Service{db: db, encryptor: encryptor}
}

func (s *Service) ListProviderApps(ctx context.Context) ([]models.ProviderApp, error) {
	var apps []models.ProviderApp
	if err := s.db.NewSelect().
		Model(&apps).
		Order("provider ASC", "name ASC", "instance_url ASC").
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("failed to list provider apps: %w", err)
	}
	return apps, nil
}

func (s *Service) ListActiveAppConfigs(ctx context.Context) ([]platform.AppConfig, error) {
	var apps []models.ProviderApp
	if err := s.db.NewSelect().
		Model(&apps).
		Where("is_active = ?", true).
		Order("provider ASC", "name ASC", "instance_url ASC").
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("failed to list provider apps: %w", err)
	}

	configs := make([]platform.AppConfig, 0, len(apps))
	for _, app := range apps {
		config, err := s.toAppConfig(app)
		if err != nil {
			return nil, err
		}
		configs = append(configs, config)
	}
	return configs, nil
}

func (s *Service) UpsertProviderApp(ctx context.Context, input UpsertInput) (models.ProviderApp, bool, error) {
	app := platform.NormalizeAppConfig(platform.AppConfig{
		Provider:       input.Provider,
		ConnectionMode: input.ConnectionMode,
		Name:           input.Name,
		ClientID:       input.ClientID,
		RedirectURI:    input.RedirectURI,
		InstanceURL:    input.InstanceURL,
		BotUsername:    input.BotUsername,
	})

	var existing models.ProviderApp
	err := s.db.NewSelect().
		Model(&existing).
		Where("provider = ? AND instance_url = ?", app.Provider, app.InstanceURL).
		Scan(ctx)
	exists := err == nil
	if err != nil && err != sql.ErrNoRows {
		return models.ProviderApp{}, false, fmt.Errorf("failed to load provider app: %w", err)
	}

	clientSecret, clientSecretEnc, err := s.resolveSecret(input.ClientSecret, existing.ClientSecretEnc)
	if err != nil {
		return models.ProviderApp{}, false, fmt.Errorf("failed to protect provider app client secret: %w", err)
	}
	botToken, botTokenEnc, err := s.resolveSecret(input.BotToken, existing.BotTokenEnc)
	if err != nil {
		return models.ProviderApp{}, false, fmt.Errorf("failed to protect provider app bot token: %w", err)
	}
	webhookSecret, webhookSecretEnc, err := s.resolveSecret(input.WebhookSecret, existing.WebhookSecretEnc)
	if err != nil {
		return models.ProviderApp{}, false, fmt.Errorf("failed to protect provider app webhook secret: %w", err)
	}
	app.ClientSecret = clientSecret
	app.BotToken = botToken
	app.WebhookSecret = webhookSecret
	if err := validateProviderAppConfig(app); err != nil {
		return models.ProviderApp{}, false, err
	}

	now := time.Now().UTC()
	row := models.ProviderApp{
		ID:               existing.ID,
		Provider:         app.Provider,
		ConnectionMode:   app.ConnectionMode,
		Name:             app.Name,
		ClientID:         app.ClientID,
		ClientSecretEnc:  clientSecretEnc,
		RedirectURI:      app.RedirectURI,
		InstanceURL:      app.InstanceURL,
		BotTokenEnc:      botTokenEnc,
		BotUsername:      app.BotUsername,
		WebhookSecretEnc: webhookSecretEnc,
		IsActive:         input.IsActive,
		CreatedAt:        existing.CreatedAt,
		UpdatedAt:        now,
	}
	if !exists {
		row.ID = uuid.NewString()
		row.CreatedAt = now
		_, err = s.db.NewInsert().
			Model(&row).
			Column("id", "provider", "connection_mode", "name", "client_id", "client_secret_encrypted", "redirect_uri", "instance_url", "bot_token_encrypted", "bot_username", "webhook_secret_encrypted", "is_active", "created_at", "updated_at").
			Exec(ctx)
		if err != nil {
			return models.ProviderApp{}, false, fmt.Errorf("failed to save provider app: %w", err)
		}
		return row, false, nil
	}

	_, err = s.db.NewUpdate().
		Model(&row).
		Column("provider", "connection_mode", "name", "client_id", "client_secret_encrypted", "redirect_uri", "instance_url", "bot_token_encrypted", "bot_username", "webhook_secret_encrypted", "is_active", "updated_at").
		WherePK().
		Exec(ctx)
	if err != nil {
		return models.ProviderApp{}, false, fmt.Errorf("failed to update provider app: %w", err)
	}
	return row, true, nil
}

func (s *Service) DeleteProviderApp(ctx context.Context, id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return ValidationError{Message: "provider app id is required"}
	}
	_, err := s.db.NewDelete().
		Model((*models.ProviderApp)(nil)).
		Where("id = ?", id).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to delete provider app: %w", err)
	}
	// The desired state already holds when a delete is replayed after its response was lost.
	return nil
}

func (s *Service) toAppConfig(app models.ProviderApp) (platform.AppConfig, error) {
	clientSecret, err := s.encryptor.Decrypt(app.ClientSecretEnc)
	if err != nil {
		return platform.AppConfig{}, fmt.Errorf("failed to decrypt provider app %s (%s): %w", app.ID, app.Provider, err)
	}
	botToken, err := s.encryptor.Decrypt(app.BotTokenEnc)
	if err != nil {
		return platform.AppConfig{}, fmt.Errorf("failed to decrypt provider app %s (%s) bot token: %w", app.ID, app.Provider, err)
	}
	webhookSecret, err := s.encryptor.Decrypt(app.WebhookSecretEnc)
	if err != nil {
		return platform.AppConfig{}, fmt.Errorf("failed to decrypt provider app %s (%s) webhook secret: %w", app.ID, app.Provider, err)
	}

	return platform.NormalizeAppConfig(platform.AppConfig{
		Provider:       app.Provider,
		ConnectionMode: app.ConnectionMode,
		Name:           app.Name,
		ClientID:       app.ClientID,
		ClientSecret:   clientSecret,
		RedirectURI:    app.RedirectURI,
		InstanceURL:    app.InstanceURL,
		BotToken:       botToken,
		BotUsername:    app.BotUsername,
		WebhookSecret:  webhookSecret,
	}), nil
}

func (s *Service) resolveSecret(input *string, existing []byte) (string, []byte, error) {
	if input == nil {
		plaintext, err := s.encryptor.Decrypt(existing)
		return plaintext, existing, err
	}
	plaintext := strings.TrimSpace(*input)
	if plaintext == "" {
		return "", nil, nil
	}
	encrypted, err := s.encryptor.Encrypt(plaintext)
	return plaintext, encrypted, err
}

func validateProviderAppConfig(app platform.AppConfig) error {
	if app.Provider == "" {
		return ValidationError{Message: "provider is required"}
	}
	if !isManagedProviderApp(app.Provider) || (app.Provider == "discord" && app.ConnectionMode != platform.ConnectionModeBot) {
		return ValidationError{Message: fmt.Sprintf("unsupported provider app: %s", app.Provider)}
	}
	if app.Provider != "mastodon" && app.InstanceURL != "" {
		return ValidationError{Message: "instance_url is only supported for mastodon provider apps"}
	}
	switch app.Provider {
	case "pinterest", "telegram", "discord":
		if err := platform.ValidateAppConfig(app); err != nil {
			return ValidationError{Message: err.Error()}
		}
	default:
		if app.ClientID == "" {
			return ValidationError{Message: "client_id is required"}
		}
		if app.Provider == "mastodon" && app.InstanceURL == "" {
			return ValidationError{Message: "instance_url is required for mastodon provider apps"}
		}
	}
	return nil
}

// isManagedProviderApp excludes user-owned Bluesky credentials and Discord
// incoming webhooks. Discord bot, Pinterest, and Telegram applications are
// instance-owned and may be stored in encrypted provider app rows.
func isManagedProviderApp(provider string) bool {
	switch provider {
	case "x", "mastodon", "linkedin", "threads", "facebook", "instagram", "tiktok", "youtube", "pinterest", "telegram", "discord":
		return true
	default:
		return false
	}
}
