package connectors

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

type Store struct {
	db  *bun.DB
	now func() time.Time
}

func NewStore(db *bun.DB) *Store {
	return &Store{db: db, now: func() time.Time { return time.Now().UTC() }}
}

func (s *Store) SyncRegistry(ctx context.Context, registry *Registry) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("connector store is unavailable")
	}
	entries := registry.All()
	now := s.now()
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		ids := make([]string, 0, len(entries))
		for _, entry := range entries {
			ids = append(ids, entry.InstallationID)
		}
		disable := tx.NewUpdate().Model((*models.ProviderInstallation)(nil)).
			Set("status = ?", "disabled").
			Set("status_detail = ?", "Connector is not present in the current operator configuration.").
			Set("updated_at = ?", now).
			Where("kind = ?", "connector")
		if len(ids) > 0 {
			disable = disable.Where("id NOT IN (?)", bun.List(ids))
		}
		if _, err := disable.Exec(txCtx); err != nil {
			return fmt.Errorf("disable removed connector installations: %w", err)
		}

		for _, entry := range entries {
			if entry.Manifest.Provider.ID == "" {
				if _, err := tx.NewUpdate().Model((*models.ProviderInstallation)(nil)).
					Set("status = ?", entry.Status).
					Set("status_detail = ?", safeStatusDetail(entry.StatusDetail)).
					Set("required = ?", entry.Required).
					Set("config_fingerprint = ?", entry.ConfigFingerprint).
					Set("last_seen_at = ?", now).
					Set("updated_at = ?", now).
					Where("id = ? AND kind = ?", entry.InstallationID, "connector").Exec(txCtx); err != nil {
					return fmt.Errorf("update unavailable connector installation %s: %w", entry.InstallationID, err)
				}
				continue
			}
			manifestJSON, err := json.Marshal(entry.Manifest)
			if err != nil {
				return fmt.Errorf("encode connector manifest %s: %w", entry.InstallationID, err)
			}
			row := &models.ProviderInstallation{
				ID: entry.InstallationID, Kind: "connector",
				ProviderID: entry.Manifest.Provider.ID, DisplayName: entry.Manifest.Provider.DisplayName,
				Description:     entry.Manifest.Provider.Description,
				ProtocolVersion: entry.Manifest.ProtocolVersion, ImplementationVersion: entry.Manifest.ImplementationVersion,
				CapabilityRevision: entry.Manifest.CapabilityRevision, ManifestJSON: string(manifestJSON),
				ConfigFingerprint: entry.ConfigFingerprint, Status: entry.Status,
				StatusDetail: safeStatusDetail(entry.StatusDetail), Required: entry.Required,
				LastSeenAt: now, CreatedAt: now, UpdatedAt: now,
			}
			if _, err := tx.NewInsert().Model(row).
				On("CONFLICT (id) DO UPDATE").
				Set("kind = EXCLUDED.kind").
				Set("provider_id = EXCLUDED.provider_id").
				Set("display_name = EXCLUDED.display_name").
				Set("description = EXCLUDED.description").
				Set("protocol_version = EXCLUDED.protocol_version").
				Set("implementation_version = EXCLUDED.implementation_version").
				Set("capability_revision = EXCLUDED.capability_revision").
				Set("manifest_json = EXCLUDED.manifest_json").
				Set("config_fingerprint = EXCLUDED.config_fingerprint").
				Set("status = EXCLUDED.status").
				Set("status_detail = EXCLUDED.status_detail").
				Set("required = EXCLUDED.required").
				Set("last_seen_at = EXCLUDED.last_seen_at").
				Set("updated_at = EXCLUDED.updated_at").
				Exec(txCtx); err != nil {
				return fmt.Errorf("store connector installation %s: %w", entry.InstallationID, err)
			}
		}
		return nil
	})
}

func (s *Store) BindAccount(ctx context.Context, binding models.ProviderAccountBinding) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("connector store is unavailable")
	}
	if binding.SocialAccountID == "" || binding.WorkspaceID == "" || binding.InstallationID == "" || binding.ExternalAccountID == "" {
		return fmt.Errorf("connector account binding identity is required")
	}
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).
		Where("id = ? AND workspace_id = ?", binding.SocialAccountID, binding.WorkspaceID).Scan(ctx); err != nil {
		return fmt.Errorf("load connector social account: %w", err)
	}
	var installation models.ProviderInstallation
	if err := s.db.NewSelect().Model(&installation).
		Where("id = ? AND kind = ?", binding.InstallationID, "connector").Scan(ctx); err != nil {
		return fmt.Errorf("load connector installation: %w", err)
	}
	if account.Platform != installation.ProviderID {
		return fmt.Errorf("connector account provider does not match its installation")
	}
	now := s.now()
	binding.CreatedAt = now
	binding.UpdatedAt = now
	_, err := s.db.NewInsert().Model(&binding).
		On("CONFLICT (social_account_id) DO UPDATE").
		Set("workspace_id = EXCLUDED.workspace_id").
		Set("installation_id = EXCLUDED.installation_id").
		Set("connection_ref = EXCLUDED.connection_ref").
		Set("external_account_id = EXCLUDED.external_account_id").
		Set("capability_revision = EXCLUDED.capability_revision").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("store connector account binding: %w", err)
	}
	return nil
}

func (s *Store) BindingForAccount(ctx context.Context, workspaceID, socialAccountID string) (models.ProviderAccountBinding, error) {
	var binding models.ProviderAccountBinding
	err := s.db.NewSelect().Model(&binding).
		Where("workspace_id = ? AND social_account_id = ?", workspaceID, socialAccountID).
		Scan(ctx)
	if err != nil {
		return models.ProviderAccountBinding{}, fmt.Errorf("load connector account binding: %w", err)
	}
	return binding, nil
}

func (s *Store) BeginConnection(ctx context.Context, workspaceID, installationID string, ttl time.Duration) (models.ConnectorConnectionSession, error) {
	if ttl <= 0 || ttl > 24*time.Hour {
		return models.ConnectorConnectionSession{}, fmt.Errorf("connector connection session TTL is invalid")
	}
	now := s.now()
	session := models.ConnectorConnectionSession{
		ID: uuid.NewString(), WorkspaceID: workspaceID, InstallationID: installationID,
		State: "pending", ExpiresAt: now.Add(ttl), CreatedAt: now, UpdatedAt: now,
	}
	if _, err := s.db.NewInsert().Model(&session).Exec(ctx); err != nil {
		return models.ConnectorConnectionSession{}, fmt.Errorf("begin connector connection: %w", err)
	}
	return session, nil
}

func (s *Store) CompleteConnection(
	ctx context.Context,
	sessionID, connectionRef string,
	accounts []ConnectionAccount,
) (models.ConnectorConnectionSession, error) {
	if strings.TrimSpace(connectionRef) == "" || len(accounts) == 0 {
		return models.ConnectorConnectionSession{}, fmt.Errorf("connector connection result is incomplete")
	}
	accountsJSON, err := json.Marshal(accounts)
	if err != nil {
		return models.ConnectorConnectionSession{}, fmt.Errorf("encode connector connection accounts: %w", err)
	}
	now := s.now()
	result, err := s.db.NewUpdate().Model((*models.ConnectorConnectionSession)(nil)).
		Set("state = ?", "complete").
		Set("connection_ref = ?", connectionRef).
		Set("accounts_json = ?", string(accountsJSON)).
		Set("updated_at = ?", now).
		Where("id = ? AND state = ? AND expires_at > ?", sessionID, "pending", now).
		Exec(ctx)
	if err != nil {
		return models.ConnectorConnectionSession{}, fmt.Errorf("complete connector connection: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return models.ConnectorConnectionSession{}, fmt.Errorf("check connector connection completion: %w", err)
	}
	if rows != 1 {
		return models.ConnectorConnectionSession{}, fmt.Errorf("connector connection session is not pending or has expired")
	}
	var session models.ConnectorConnectionSession
	if err := s.db.NewSelect().Model(&session).Where("id = ?", sessionID).Scan(ctx); err != nil {
		return models.ConnectorConnectionSession{}, fmt.Errorf("load completed connector connection: %w", err)
	}
	return session, nil
}

func (s *Store) FailConnection(ctx context.Context, sessionID, kind string) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("connector store is unavailable")
	}
	kind = strings.TrimSpace(kind)
	if len(kind) > 80 {
		kind = kind[:80]
	}
	if kind == "" {
		kind = "connector_error"
	}
	result, err := s.db.NewUpdate().Model((*models.ConnectorConnectionSession)(nil)).
		Set("state = ?", "failed").
		Set("error_kind = ?", kind).
		Set("updated_at = ?", s.now()).
		Where("id = ? AND state = ?", sessionID, "pending").
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("fail connector connection: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check failed connector connection: %w", err)
	}
	if rows != 1 {
		return fmt.Errorf("connector connection session is not pending")
	}
	return nil
}

// SaveConnectionAccounts commits the connector result, OpenPost accounts, and
// opaque execution bindings as one database transaction. Connector credentials
// never enter the social account or OAuth grant tables.
func (s *Store) SaveConnectionAccounts(
	ctx context.Context,
	sessionID string,
	response ConnectionResponse,
) ([]*models.SocialAccount, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("connector store is unavailable")
	}
	if err := validateConnectionResponse(response); err != nil {
		return nil, err
	}
	now := s.now()
	accounts := make([]*models.SocialAccount, 0, len(response.Accounts))
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var err error
		accounts, err = saveConnectionAccountsTx(txCtx, tx, sessionID, response, now)
		return err
	})
	if err != nil {
		return nil, err
	}
	return accounts, nil
}

func saveConnectionAccountsTx(
	ctx context.Context,
	tx bun.Tx,
	sessionID string,
	response ConnectionResponse,
	now time.Time,
) ([]*models.SocialAccount, error) {
	session, installation, err := loadConnectionContext(ctx, tx, sessionID, now)
	if err != nil {
		return nil, err
	}
	usedSlugs, err := loadActiveAccountSlugs(ctx, tx, session.WorkspaceID)
	if err != nil {
		return nil, err
	}
	accounts := make([]*models.SocialAccount, 0, len(response.Accounts))
	for _, external := range response.Accounts {
		account, err := saveConnectionAccount(ctx, tx, session, installation, external, response.ConnectionRef, usedSlugs, now)
		if err != nil {
			return nil, err
		}
		accounts = append(accounts, account)
	}
	if err := completeConnectionSession(ctx, tx, session, response, now); err != nil {
		return nil, err
	}
	claimed, err := claimFirstConnection(ctx, tx, session, accounts[0].ID, now)
	if err != nil {
		return nil, err
	}
	accounts[0].ClaimedFirst = claimed
	return accounts, nil
}

func loadConnectionContext(
	ctx context.Context,
	tx bun.Tx,
	sessionID string,
	now time.Time,
) (*models.ConnectorConnectionSession, *models.ProviderInstallation, error) {
	session := new(models.ConnectorConnectionSession)
	if err := tx.NewSelect().Model(session).
		Where("id = ? AND state = ? AND expires_at > ?", sessionID, "pending", now).
		Scan(ctx); err != nil {
		return nil, nil, fmt.Errorf("load pending connector connection: %w", err)
	}
	installation := new(models.ProviderInstallation)
	if err := tx.NewSelect().Model(installation).
		Where("id = ? AND kind = ?", session.InstallationID, "connector").
		Scan(ctx); err != nil {
		return nil, nil, fmt.Errorf("load connector installation: %w", err)
	}
	if installation.Status != InstallationStatusAvailable {
		return nil, nil, fmt.Errorf("connector installation is not available")
	}
	return session, installation, nil
}

func loadActiveAccountSlugs(ctx context.Context, tx bun.Tx, workspaceID string) (map[string]string, error) {
	var active []models.SocialAccount
	if err := tx.NewSelect().Model(&active).
		Where("workspace_id = ? AND is_active = ?", workspaceID, true).
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("load Workspace account slugs: %w", err)
	}
	usedSlugs := make(map[string]string, len(active))
	for index := range active {
		usedSlugs[active[index].Slug] = active[index].ID
	}
	return usedSlugs, nil
}

func saveConnectionAccount(
	ctx context.Context,
	tx bun.Tx,
	session *models.ConnectorConnectionSession,
	installation *models.ProviderInstallation,
	external ConnectionAccount,
	connectionRef string,
	usedSlugs map[string]string,
	now time.Time,
) (*models.SocialAccount, error) {
	account, err := loadOrCreateConnectionAccount(ctx, tx, session, installation, external, usedSlugs, now)
	if err != nil {
		return nil, err
	}
	account.AccountUsername = firstConnectorLabel(external)
	account.AccountAvatarURL = external.AvatarURL
	account.IsActive = true
	account.ErrorMessage = ""
	if err := persistConnectionAccount(ctx, tx, account); err != nil {
		return nil, err
	}
	if err := persistAccountBinding(ctx, tx, session, installation, external, connectionRef, account.ID, now); err != nil {
		return nil, err
	}
	return account, nil
}

func loadOrCreateConnectionAccount(
	ctx context.Context,
	tx bun.Tx,
	session *models.ConnectorConnectionSession,
	installation *models.ProviderInstallation,
	external ConnectionAccount,
	usedSlugs map[string]string,
	now time.Time,
) (*models.SocialAccount, error) {
	var binding models.ProviderAccountBinding
	err := tx.NewSelect().Model(&binding).
		Where("workspace_id = ? AND installation_id = ? AND external_account_id = ?",
			session.WorkspaceID, session.InstallationID, external.ID).
		Scan(ctx)
	if err == nil {
		account := new(models.SocialAccount)
		if err := tx.NewSelect().Model(account).
			Where("id = ? AND workspace_id = ?", binding.SocialAccountID, session.WorkspaceID).
			Scan(ctx); err != nil {
			return nil, fmt.Errorf("load connector account: %w", err)
		}
		return account, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load existing connector account binding: %w", err)
	}
	account := &models.SocialAccount{
		ID: uuid.NewString(), WorkspaceID: session.WorkspaceID,
		Platform: installation.ProviderID, AccountID: external.ID,
		AccessTokenEnc: []byte("connector-managed"), CapabilityState: "{}",
		CreatedAt: now, IsNewlyInserted: true,
	}
	account.Slug = nextConnectorSlug(firstConnectorLabel(external), usedSlugs)
	usedSlugs[account.Slug] = account.ID
	return account, nil
}

func persistConnectionAccount(ctx context.Context, tx bun.Tx, account *models.SocialAccount) error {
	if account.IsNewlyInserted {
		if _, err := tx.NewInsert().Model(account).Exec(ctx); err != nil {
			return fmt.Errorf("create connector account: %w", err)
		}
		return nil
	}
	if _, err := tx.NewUpdate().Model(account).
		Column("account_username", "account_avatar_url", "is_active", "error_message").
		WherePK().Exec(ctx); err != nil {
		return fmt.Errorf("update connector account: %w", err)
	}
	return nil
}

func persistAccountBinding(
	ctx context.Context,
	tx bun.Tx,
	session *models.ConnectorConnectionSession,
	installation *models.ProviderInstallation,
	external ConnectionAccount,
	connectionRef, accountID string,
	now time.Time,
) error {
	binding := &models.ProviderAccountBinding{
		SocialAccountID: accountID, WorkspaceID: session.WorkspaceID,
		InstallationID: session.InstallationID, ConnectionRef: connectionRef,
		ExternalAccountID: external.ID, CapabilityRevision: installation.CapabilityRevision,
		CreatedAt: now, UpdatedAt: now,
	}
	if _, err := tx.NewInsert().Model(binding).
		On("CONFLICT (social_account_id) DO UPDATE").
		Set("connection_ref = EXCLUDED.connection_ref").
		Set("external_account_id = EXCLUDED.external_account_id").
		Set("capability_revision = EXCLUDED.capability_revision").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx); err != nil {
		return fmt.Errorf("store connector account binding: %w", err)
	}
	return nil
}

func completeConnectionSession(
	ctx context.Context,
	tx bun.Tx,
	session *models.ConnectorConnectionSession,
	response ConnectionResponse,
	now time.Time,
) error {
	accountsJSON, err := json.Marshal(response.Accounts)
	if err != nil {
		return fmt.Errorf("encode connector connection accounts: %w", err)
	}
	if _, err := tx.NewUpdate().Model(session).
		Set("state = ?", "complete").
		Set("connection_ref = ?", response.ConnectionRef).
		Set("accounts_json = ?", string(accountsJSON)).
		Set("updated_at = ?", now).
		WherePK().Exec(ctx); err != nil {
		return fmt.Errorf("complete connector connection: %w", err)
	}
	return nil
}

func claimFirstConnection(
	ctx context.Context,
	tx bun.Tx,
	session *models.ConnectorConnectionSession,
	accountID string,
	now time.Time,
) (bool, error) {
	claim := &models.WorkspaceFirstConnection{
		WorkspaceID: session.WorkspaceID, AccountID: accountID,
		OriginKey: "connector:" + session.ID, CreatedAt: now,
	}
	result, err := tx.NewInsert().Model(claim).On("CONFLICT (workspace_id) DO NOTHING").Exec(ctx)
	if err != nil {
		return false, fmt.Errorf("claim first Workspace connection: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("check first Workspace connection: %w", err)
	}
	return rows == 1, nil
}

func firstConnectorLabel(account ConnectionAccount) string {
	for _, value := range []string{account.Username, account.DisplayName, account.ID} {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return "destination"
}

func nextConnectorSlug(label string, used map[string]string) string {
	var normalized strings.Builder
	lastDash := false
	for _, r := range strings.ToLower(label) {
		valid := r >= 'a' && r <= 'z' || r >= '0' && r <= '9'
		if valid {
			normalized.WriteRune(r)
			lastDash = false
		} else if normalized.Len() > 0 && !lastDash {
			normalized.WriteByte('-')
			lastDash = true
		}
		if normalized.Len() >= 50 {
			break
		}
	}
	base := strings.Trim(normalized.String(), "-")
	if base == "" {
		base = "destination"
	}
	for suffix := 1; ; suffix++ {
		candidate := base
		if suffix > 1 {
			candidate = fmt.Sprintf("%s-%d", base, suffix)
		}
		if _, exists := used[candidate]; !exists {
			return candidate
		}
	}
}

func safeStatusDetail(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	if len(value) > 240 {
		value = value[:240]
	}
	return value
}
