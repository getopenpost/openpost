package account_saver

import (
	"context"
	"database/sql"
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
	if err := s.validateSaveAccountInput(ctx, input); err != nil {
		return nil, err
	}
	input.AccountID = accountIDFromToken(input.AccountID, input.Token)

	if err := s.CheckSocialAccountQuota(ctx, input.WorkspaceID); err != nil {
		return nil, err
	}

	encAccess, encRefresh, err := s.encryptAccountTokens(input.Token)
	if err != nil {
		return nil, err
	}
	expiresAt := tokenExpiresAt(input.Token)

	account := &models.SocialAccount{
		ID:               uuid.New().String(),
		WorkspaceID:      input.WorkspaceID,
		Slug:             "",
		Platform:         input.PlatformName,
		AccountID:        input.AccountID,
		AccountUsername:  input.AccountUsername,
		AccountAvatarURL: input.AccountAvatarURL,
		InstanceURL:      input.InstanceURL,
		AccessTokenEnc:   encAccess,
		RefreshTokenEnc:  encRefresh,
		TokenExpiresAt:   expiresAt,
		GrantedScopes:    grantedScopesFromToken(input.Token),
		IsActive:         true,
		CreatedAt:        time.Now().UTC(),
	}
	account.Slug = s.uniqueSlug(ctx, input.WorkspaceID, defaultSlug(input.PlatformName, input.AccountUsername, input.AccountID, input.InstanceURL))

	if _, err := s.db.NewInsert().Model(account).Exec(ctx); err != nil {
		return nil, err
	}

	if err := tokenmanager.ScheduleRefreshJob(ctx, s.db, account.ID, expiresAt); err != nil {
		log.Printf("[AccountSaver] Failed to schedule refresh job for account %s: %v", account.ID, err)
	}

	return account, nil
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
		Amount:      1,
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

func (s *AccountSaver) uniqueSlug(ctx context.Context, workspaceID, base string) string {
	if base == "" {
		base = "account"
	}
	for i := 0; ; i++ {
		candidate := base
		if i > 0 {
			candidate = fmt.Sprintf("%s-%d", base, i+1)
		}

		var existing models.SocialAccount
		err := s.db.NewSelect().
			Model(&existing).
			Where("workspace_id = ?", workspaceID).
			Where("slug = ?", candidate).
			Where("is_active = ?", true).
			Scan(ctx)
		if err != nil {
			if err == sql.ErrNoRows {
				return candidate
			}
			return base
		}
	}
}
