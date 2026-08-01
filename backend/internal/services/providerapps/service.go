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
	Provider     string
	Name         string
	ClientID     string
	ClientSecret *string
	RedirectURI  string
	InstanceURL  string
	IsActive     bool
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
		Provider:    input.Provider,
		Name:        input.Name,
		ClientID:    input.ClientID,
		RedirectURI: input.RedirectURI,
		InstanceURL: input.InstanceURL,
	})
	if err := validateProviderAppConfig(app); err != nil {
		return models.ProviderApp{}, false, err
	}

	var existing models.ProviderApp
	err := s.db.NewSelect().
		Model(&existing).
		Where("provider = ? AND instance_url = ?", app.Provider, app.InstanceURL).
		Scan(ctx)
	exists := err == nil
	if err != nil && err != sql.ErrNoRows {
		return models.ProviderApp{}, false, fmt.Errorf("failed to load provider app: %w", err)
	}

	secretEnc := existing.ClientSecretEnc
	if input.ClientSecret != nil {
		encrypted, err := s.encryptor.Encrypt(strings.TrimSpace(*input.ClientSecret))
		if err != nil {
			return models.ProviderApp{}, false, fmt.Errorf("failed to encrypt provider app secret: %w", err)
		}
		secretEnc = encrypted
	}

	now := time.Now().UTC()
	row := models.ProviderApp{
		ID:              existing.ID,
		Provider:        app.Provider,
		Name:            app.Name,
		ClientID:        app.ClientID,
		ClientSecretEnc: secretEnc,
		RedirectURI:     app.RedirectURI,
		InstanceURL:     app.InstanceURL,
		IsActive:        input.IsActive,
		CreatedAt:       existing.CreatedAt,
		UpdatedAt:       now,
	}
	if !exists {
		row.ID = uuid.NewString()
		row.CreatedAt = now
		_, err = s.db.NewInsert().
			Model(&row).
			Column("id", "provider", "name", "client_id", "client_secret_encrypted", "redirect_uri", "instance_url", "is_active", "created_at", "updated_at").
			Exec(ctx)
		if err != nil {
			return models.ProviderApp{}, false, fmt.Errorf("failed to save provider app: %w", err)
		}
		return row, false, nil
	}

	_, err = s.db.NewUpdate().
		Model(&row).
		Column("provider", "name", "client_id", "client_secret_encrypted", "redirect_uri", "instance_url", "is_active", "updated_at").
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
	result, err := s.db.NewDelete().
		Model((*models.ProviderApp)(nil)).
		Where("id = ?", id).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to delete provider app: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to inspect provider app deletion: %w", err)
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) toAppConfig(app models.ProviderApp) (platform.AppConfig, error) {
	secret, err := s.encryptor.Decrypt(app.ClientSecretEnc)
	if err != nil {
		return platform.AppConfig{}, fmt.Errorf("failed to decrypt provider app %s (%s): %w", app.ID, app.Provider, err)
	}

	return platform.NormalizeAppConfig(platform.AppConfig{
		Provider:     app.Provider,
		Name:         app.Name,
		ClientID:     app.ClientID,
		ClientSecret: secret,
		RedirectURI:  app.RedirectURI,
		InstanceURL:  app.InstanceURL,
	}), nil
}

func validateProviderAppConfig(app platform.AppConfig) error {
	if app.Provider == "" {
		return ValidationError{Message: "provider is required"}
	}
	if !platform.IsAppProviderSupported(app.Provider) {
		return ValidationError{Message: fmt.Sprintf("unsupported provider app: %s", app.Provider)}
	}
	if app.Provider != "bluesky" && app.ClientID == "" {
		return ValidationError{Message: "client_id is required"}
	}
	if app.Provider == "mastodon" && app.InstanceURL == "" {
		return ValidationError{Message: "instance_url is required for mastodon provider apps"}
	}
	return nil
}
