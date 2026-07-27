package account_saver

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/uptrace/bun"
)

var slugUnsafeChars = regexp.MustCompile(`[^a-z0-9]+`)

// AccountSaver handles saving social account information to the database.
// This service extracts the duplicated account-saving logic from the OAuth handler.
type AccountSaver struct {
	db          *bun.DB
	crypto      *crypto.TokenEncryptor
	entitlement entitlements.Service
}

type SaveAccountInput struct {
	UserID           string
	PlatformName     string
	WorkspaceID      string
	AccountID        string
	AccountUsername  string
	AccountAvatarURL string
	InstanceURL      string
	Token            *platform.TokenResult
	CapabilityState  map[string]string
}

// NewAccountSaver creates a new AccountSaver instance.
func NewAccountSaver(db *bun.DB, crypto *crypto.TokenEncryptor, entitlement ...entitlements.Service) *AccountSaver {
	entitlementService := entitlements.Service(entitlements.NewSelfHostedService())
	if len(entitlement) > 0 && entitlement[0] != nil {
		entitlementService = entitlement[0]
	}
	return &AccountSaver{
		db:          db,
		crypto:      crypto,
		entitlement: entitlementService,
	}
}

func (s *AccountSaver) SetEntitlement(entitlement entitlements.Service) {
	if entitlement != nil {
		s.entitlement = entitlement
	}
}

// SaveAccount saves a social account with encrypted tokens.
// It handles the common logic of extracting account info, encrypting tokens,
// and inserting into the social_accounts table.
//
//nolint:gocyclo
func (s *AccountSaver) SaveAccount(ctx context.Context, userID, platformName, workspaceID, accountID, accountUsername, instanceURL string, tokenResp *platform.TokenResult) (*models.SocialAccount, error) {
	return s.SaveAccountFromInput(ctx, SaveAccountInput{
		UserID:          userID,
		PlatformName:    platformName,
		WorkspaceID:     workspaceID,
		AccountID:       accountID,
		AccountUsername: accountUsername,
		InstanceURL:     instanceURL,
		Token:           tokenResp,
	})
}

func (s *AccountSaver) SaveAccountFromInput(ctx context.Context, input SaveAccountInput) (*models.SocialAccount, error) {
	accounts, err := s.SaveAccountsFromInputs(ctx, []SaveAccountInput{input})
	if err != nil {
		return nil, err
	}
	return accounts[0], nil
}

// SaveAccountsFromInputs validates quota once and inserts every selected
// identity in one transaction. This is used when one OAuth grant connects
// several Pages or organizations.
//
//nolint:gocyclo // Validation, encryption, slug allocation, and inserts must complete as one transaction.
func (s *AccountSaver) SaveAccountsFromInputs(ctx context.Context, inputs []SaveAccountInput) ([]*models.SocialAccount, error) {
	if len(inputs) == 0 {
		return nil, fmt.Errorf("at least one account is required")
	}
	first := inputs[0]
	if err := s.validateSaveAccountInput(ctx, first); err != nil {
		return nil, err
	}
	for _, input := range inputs {
		if input.UserID != first.UserID || input.WorkspaceID != first.WorkspaceID {
			return nil, fmt.Errorf("selected accounts must belong to the same user and workspace")
		}
		if input.Token == nil {
			return nil, fmt.Errorf("token response is required")
		}
	}
	if err := s.checkSocialAccountQuota(ctx, first.WorkspaceID, int64(len(inputs))); err != nil {
		return nil, err
	}

	var existingSlugs []string
	if err := s.db.NewSelect().
		Model((*models.SocialAccount)(nil)).
		Column("slug").
		Where("workspace_id = ?", first.WorkspaceID).
		Where("is_active = ?", true).
		Scan(ctx, &existingSlugs); err != nil {
		return nil, fmt.Errorf("loading account slugs: %w", err)
	}
	usedSlugs := make(map[string]struct{}, len(existingSlugs)+len(inputs))
	for _, slug := range existingSlugs {
		usedSlugs[slug] = struct{}{}
	}

	accounts := make([]*models.SocialAccount, 0, len(inputs))
	for _, input := range inputs {
		input.AccountID = accountIDFromToken(input.AccountID, input.Token)
		encAccess, encRefresh, err := s.encryptAccountTokens(input.Token)
		if err != nil {
			return nil, err
		}
		capabilityState, capabilityCheckedAt, err := encodeCapabilityState(input.CapabilityState)
		if err != nil {
			return nil, err
		}
		baseSlug := defaultSlug(input.PlatformName, input.AccountUsername, input.AccountID, input.InstanceURL)
		account := &models.SocialAccount{
			ID:                  uuid.New().String(),
			WorkspaceID:         input.WorkspaceID,
			Slug:                nextAvailableSlug(baseSlug, usedSlugs),
			Platform:            input.PlatformName,
			AccountID:           input.AccountID,
			AccountUsername:     input.AccountUsername,
			AccountAvatarURL:    input.AccountAvatarURL,
			InstanceURL:         input.InstanceURL,
			AccessTokenEnc:      encAccess,
			RefreshTokenEnc:     encRefresh,
			TokenExpiresAt:      tokenExpiresAt(input.Token),
			GrantedScopes:       grantedScopesFromToken(input.Token),
			CapabilityState:     capabilityState,
			CapabilityCheckedAt: capabilityCheckedAt,
			IsActive:            true,
			CreatedAt:           time.Now().UTC(),
		}
		usedSlugs[account.Slug] = struct{}{}
		accounts = append(accounts, account)
	}

	if err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		for _, account := range accounts {
			if _, err := tx.NewInsert().Model(account).Exec(txCtx); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}

	for _, account := range accounts {
		if err := tokenmanager.ScheduleRefreshJob(ctx, s.db, account.ID, account.TokenExpiresAt); err != nil {
			log.Printf("[AccountSaver] Failed to schedule refresh job for account %s: %v", account.ID, err)
		}
	}

	return accounts, nil
}

func encodeCapabilityState(state map[string]string) (string, time.Time, error) {
	if len(state) == 0 {
		return "{}", time.Time{}, nil
	}
	encoded, err := json.Marshal(state)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("encoding account capability state: %w", err)
	}
	return string(encoded), time.Now().UTC(), nil
}

func (s *AccountSaver) validateSaveAccountInput(ctx context.Context, input SaveAccountInput) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("database not initialized")
	}
	if input.UserID == "" {
		return fmt.Errorf("user id is required")
	}
	if input.WorkspaceID == "" {
		return fmt.Errorf("workspace id is required")
	}
	if input.Token == nil {
		return fmt.Errorf("token response is required")
	}

	memberCount, err := s.db.NewSelect().
		Model((*models.WorkspaceMember)(nil)).
		Where("workspace_id = ? AND user_id = ?", input.WorkspaceID, input.UserID).
		Count(ctx)
	if err != nil {
		return fmt.Errorf("validating workspace membership: %w", err)
	}
	if memberCount == 0 {
		return fmt.Errorf("workspace not accessible")
	}
	return nil
}

func (s *AccountSaver) encryptAccountTokens(token *platform.TokenResult) ([]byte, []byte, error) {
	encAccess, err := s.crypto.Encrypt(token.AccessToken)
	if err != nil {
		return nil, nil, err
	}

	var encRefresh []byte
	if token.RefreshToken != "" {
		encRefresh, err = s.crypto.Encrypt(token.RefreshToken)
		if err != nil {
			return nil, nil, err
		}
	}
	return encAccess, encRefresh, nil
}

func accountIDFromToken(fallback string, token *platform.TokenResult) string {
	// LinkedIn selection stores the complete author URN. The shared member
	// token may also carry a person user_id, which must not replace an
	// organization identity.
	if strings.HasPrefix(strings.TrimSpace(fallback), "urn:li:") {
		return fallback
	}
	if token.Extra == nil {
		return fallback
	}
	if uid, ok := token.Extra["user_id"]; ok && uid != "" {
		return uid
	}
	return fallback
}

func tokenExpiresAt(token *platform.TokenResult) time.Time {
	if token.ExpiresIn <= 0 {
		return time.Time{}
	}
	return time.Now().UTC().Add(time.Duration(token.ExpiresIn) * time.Second)
}

func grantedScopesFromToken(token *platform.TokenResult) string {
	if token == nil || token.Extra == nil {
		return ""
	}
	raw := strings.TrimSpace(firstNonEmptyTokenExtra(token.Extra, "scope", "scopes"))
	if raw == "" {
		return ""
	}
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\n' || r == '\t'
	})
	seen := map[string]struct{}{}
	scopes := make([]string, 0, len(parts))
	for _, part := range parts {
		scope := strings.TrimSpace(part)
		if scope == "" {
			continue
		}
		if _, ok := seen[scope]; ok {
			continue
		}
		seen[scope] = struct{}{}
		scopes = append(scopes, scope)
	}
	sort.Strings(scopes)
	return strings.Join(scopes, " ")
}

func firstNonEmptyTokenExtra(extra map[string]string, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(extra[key]); value != "" {
			return value
		}
	}
	return ""
}

func (s *AccountSaver) CheckSocialAccountQuota(ctx context.Context, workspaceID string) error {
	return s.checkSocialAccountQuota(ctx, workspaceID, 1)
}

func (s *AccountSaver) checkSocialAccountQuota(ctx context.Context, workspaceID string, amount int64) error {
	current, err := s.db.NewSelect().
		Model((*models.SocialAccount)(nil)).
		Where("workspace_id = ?", workspaceID).
		Where("is_active = ?", true).
		Count(ctx)
	if err != nil {
		return fmt.Errorf("loading social account usage: %w", err)
	}

	decision, err := s.entitlement.Check(ctx, entitlements.Request{
		WorkspaceID: workspaceID,
		Limit:       entitlements.LimitSocialAccounts,
		Current:     int64(current),
		Amount:      amount,
	})
	if err != nil {
		return fmt.Errorf("checking social account limit: %w", err)
	}
	if !decision.Allowed {
		if decision.Reason != "" {
			return fmt.Errorf("%s", decision.Reason)
		}
		return fmt.Errorf("social account limit exceeded")
	}
	return nil
}

func nextAvailableSlug(base string, used map[string]struct{}) string {
	if base == "" {
		base = "account"
	}
	for i := 0; ; i++ {
		candidate := base
		if i > 0 {
			candidate = fmt.Sprintf("%s-%d", base, i+1)
		}
		if _, exists := used[candidate]; !exists {
			return candidate
		}
	}
}

func defaultSlug(platformName, accountUsername, accountID, instanceURL string) string {
	label := strings.TrimSpace(accountUsername)
	if label == "" {
		label = strings.TrimSpace(accountID)
	}
	if label == "" {
		label = strings.TrimSpace(instanceURL)
	}
	base := strings.Trim(strings.ToLower(platformName+"-"+label), "-")
	base = slugUnsafeChars.ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if len(base) > 63 {
		base = strings.Trim(base[:63], "-")
	}
	if base == "" {
		return strings.ToLower(platformName)
	}
	return base
}
