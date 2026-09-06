package instancesettings

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/openpost/backend/internal/config"
	"github.com/openpost/backend/internal/models"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/uptrace/bun"
)

const encryptedValuePrefix = "openpost-instance-setting:"

type ValidationError struct {
	Key     string
	Message string
}

func (e ValidationError) Error() string {
	if e.Key == "" {
		return e.Message
	}
	return e.Key + " " + e.Message
}

type Update struct {
	Key   string
	Value *string
	Unset bool
}

type State struct {
	Definition        config.ManagedSettingDefinition
	Value             string
	Source            string
	EnvironmentSource string
	DatabaseOverride  bool
	Configured        bool
	SecretConfigured  bool
	RestartPending    bool
	UpdatedAt         time.Time
}

type Service struct {
	db        *bun.DB
	encryptor *servicecrypto.TokenEncryptor
	fallback  map[string]string
	runtime   map[string]string
}

func NewService(db *bun.DB, encryptor *servicecrypto.TokenEncryptor, fallback *config.Config) *Service {
	return &Service{
		db:        db,
		encryptor: encryptor,
		fallback:  managedSnapshot(fallback),
		runtime:   managedSnapshot(fallback),
	}
}

func (s *Service) CaptureRuntime(cfg *config.Config) {
	s.runtime = managedSnapshot(cfg)
}

// ApplyStored applies encrypted administrator overrides after environment and
// default configuration has loaded. Removing an override restores that
// original environment or default fallback on the next restart.
func (s *Service) ApplyStored(ctx context.Context, cfg *config.Config) error {
	rows, err := s.listRows(ctx)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if _, ok := config.ManagedSettingDefinitionFor(row.Key); !ok {
			continue
		}
		value, err := s.decrypt(row)
		if err != nil {
			return err
		}
		if err := cfg.ApplyManagedValue(row.Key, value); err != nil {
			return fmt.Errorf("failed to apply stored instance setting %s: %w", row.Key, err)
		}
	}
	return nil
}

func (s *Service) List(ctx context.Context) ([]State, error) {
	rows, err := s.listRows(ctx)
	if err != nil {
		return nil, err
	}
	stored := make(map[string]models.InstanceSetting, len(rows))
	storedValues := make(map[string]string, len(rows))
	for _, row := range rows {
		if _, ok := config.ManagedSettingDefinitionFor(row.Key); !ok {
			continue
		}
		value, err := s.decrypt(row)
		if err != nil {
			return nil, err
		}
		stored[row.Key] = row
		storedValues[row.Key] = value
	}

	definitions := config.ManagedSettingDefinitions()
	states := make([]State, 0, len(definitions))
	for _, definition := range definitions {
		state := State{Definition: definition, Source: "default"}
		desired := s.fallback[definition.Key]
		if environmentSource, configured := config.ManagedEnvironmentSource(definition.Key); configured {
			state.Source = "environment"
			state.EnvironmentSource = environmentSource
		}
		row, hasStoredValue := stored[definition.Key]
		if hasStoredValue {
			state.DatabaseOverride = true
			state.UpdatedAt = row.UpdatedAt
			state.Source = "database"
			desired = storedValues[definition.Key]
		}
		state.Configured = desired != ""
		state.SecretConfigured = definition.Secret && desired != ""
		state.RestartPending = desired != s.runtime[definition.Key]
		if !definition.Secret {
			state.Value = desired
		}
		states = append(states, state)
	}
	return states, nil
}

func (s *Service) Save(ctx context.Context, userID string, updates []Update) (bool, error) {
	if len(updates) == 0 {
		return false, ValidationError{Message: "at least one setting update is required"}
	}
	if err := s.validateUpdates(updates); err != nil {
		return false, err
	}
	if err := s.validateCandidate(ctx, updates); err != nil {
		return false, err
	}
	if err := s.persistUpdates(ctx, userID, updates); err != nil {
		return false, err
	}
	return s.hasPendingRestart(ctx)
}

func (s *Service) validateUpdates(updates []Update) error {
	seen := make(map[string]struct{}, len(updates))
	for i := range updates {
		updates[i].Key = strings.TrimSpace(updates[i].Key)
		definition, ok := config.ManagedSettingDefinitionFor(updates[i].Key)
		if !ok {
			return ValidationError{Key: updates[i].Key, Message: "is not an administrator-managed setting"}
		}
		if _, duplicate := seen[updates[i].Key]; duplicate {
			return ValidationError{Key: updates[i].Key, Message: "was included more than once"}
		}
		seen[updates[i].Key] = struct{}{}
		if updates[i].Unset == (updates[i].Value != nil) {
			return ValidationError{Key: updates[i].Key, Message: "must provide exactly one of value or unset"}
		}
		if updates[i].Value != nil {
			validated, err := config.ValidateManagedValue(definition, *updates[i].Value)
			if err != nil {
				return ValidationError{Key: updates[i].Key, Message: err.Error()}
			}
			updates[i].Value = &validated
		}
	}
	return nil
}

func (s *Service) persistUpdates(ctx context.Context, userID string, updates []Update) error {
	now := time.Now().UTC()
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		for _, update := range updates {
			if update.Unset {
				if _, err := tx.NewDelete().Model((*models.InstanceSetting)(nil)).Where("key = ?", update.Key).Exec(ctx); err != nil {
					return fmt.Errorf("failed to remove instance setting: %w", err)
				}
				continue
			}
			encrypted, err := s.encrypt(*update.Value)
			if err != nil {
				return err
			}
			row := models.InstanceSetting{Key: update.Key, ValueEncrypted: encrypted, UpdatedByID: userID, CreatedAt: now, UpdatedAt: now}
			_, err = tx.NewInsert().Model(&row).
				Column("key", "value_encrypted", "updated_by_id", "created_at", "updated_at").
				On("CONFLICT (key) DO UPDATE").
				Set("value_encrypted = EXCLUDED.value_encrypted").
				Set("updated_by_id = EXCLUDED.updated_by_id").
				Set("updated_at = EXCLUDED.updated_at").
				Exec(ctx)
			if err != nil {
				return fmt.Errorf("failed to save instance setting: %w", err)
			}
		}
		return nil
	})
}

func (s *Service) hasPendingRestart(ctx context.Context) (bool, error) {
	states, err := s.List(ctx)
	if err != nil {
		return false, err
	}
	for _, state := range states {
		if state.RestartPending {
			return true, nil
		}
	}
	return false, nil
}

func (s *Service) validateCandidate(ctx context.Context, updates []Update) error {
	candidateValues := make(map[string]string, len(s.fallback))
	for key, value := range s.fallback {
		candidateValues[key] = value
	}
	rows, err := s.listRows(ctx)
	if err != nil {
		return err
	}
	for _, row := range rows {
		value, err := s.decrypt(row)
		if err != nil {
			return err
		}
		candidateValues[row.Key] = value
	}
	for _, update := range updates {
		if update.Unset {
			candidateValues[update.Key] = s.fallback[update.Key]
		} else {
			candidateValues[update.Key] = *update.Value
		}
	}

	candidate := &config.Config{}
	for _, definition := range config.ManagedSettingDefinitions() {
		if err := candidate.ApplyManagedValue(definition.Key, candidateValues[definition.Key]); err != nil {
			return ValidationError{Key: definition.Key, Message: err.Error()}
		}
	}
	if err := candidate.ValidateManagedSettings(); err != nil {
		return ValidationError{Message: err.Error()}
	}
	return nil
}

func (s *Service) listRows(ctx context.Context) ([]models.InstanceSetting, error) {
	var rows []models.InstanceSetting
	if err := s.db.NewSelect().Model(&rows).Order("key ASC").Scan(ctx); err != nil {
		return nil, fmt.Errorf("failed to list instance settings: %w", err)
	}
	return rows, nil
}

func (s *Service) encrypt(value string) ([]byte, error) {
	encrypted, err := s.encryptor.Encrypt(encryptedValuePrefix + value)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt instance setting: %w", err)
	}
	return encrypted, nil
}

func (s *Service) decrypt(row models.InstanceSetting) (string, error) {
	plaintext, err := s.encryptor.Decrypt(row.ValueEncrypted)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt instance setting %s: %w", row.Key, err)
	}
	if !strings.HasPrefix(plaintext, encryptedValuePrefix) {
		return "", fmt.Errorf("instance setting %s has an invalid encrypted value", row.Key)
	}
	return strings.TrimPrefix(plaintext, encryptedValuePrefix), nil
}

func managedSnapshot(cfg *config.Config) map[string]string {
	values := make(map[string]string, len(config.ManagedSettingDefinitions()))
	if cfg == nil {
		return values
	}
	for _, definition := range config.ManagedSettingDefinitions() {
		value, err := cfg.ManagedValue(definition.Key)
		if err == nil {
			values[definition.Key] = value
		}
	}
	return values
}
