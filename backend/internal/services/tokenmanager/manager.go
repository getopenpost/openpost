package tokenmanager

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
)

const (
	defaultRefreshLeaseDuration = 2 * time.Minute
	defaultRefreshWaitInterval  = 25 * time.Millisecond
)

type TokenManager struct {
	db            *bun.DB
	crypto        *crypto.TokenEncryptor
	providerMu    sync.RWMutex
	providers     map[string]platform.Adapter
	leaseDuration time.Duration
	waitInterval  time.Duration
}

func NewTokenManager(db *bun.DB, encryptor *crypto.TokenEncryptor) *TokenManager {
	return &TokenManager{
		db:            db,
		crypto:        encryptor,
		providers:     make(map[string]platform.Adapter),
		leaseDuration: defaultRefreshLeaseDuration,
		waitInterval:  defaultRefreshWaitInterval,
	}
}

func (tm *TokenManager) SetProvider(platformName string, adapter platform.Adapter) {
	tm.providerMu.Lock()
	defer tm.providerMu.Unlock()
	tm.providers[platformName] = adapter
}

func (tm *TokenManager) GetValidAccessToken(ctx context.Context, accountID string) (string, error) {
	account, grant, err := tm.loadAccountAndGrant(ctx, accountID)
	if err != nil {
		return "", err
	}
	if err := activeCredentialError(account, grant); err != nil {
		return "", err
	}

	if account.OAuthGrantID == "" {
		return tm.getValidLegacyAccessToken(ctx, account)
	}
	if grant.AccessTokenExpiresAt.IsZero() {
		return tm.crypto.Decrypt(grant.AccessTokenEnc)
	}

	now := time.Now().UTC()
	if grant.AccessTokenExpiresAt.Before(now.Add(refreshLeadTime)) {
		provider, err := tm.providerForAccount(account)
		if err != nil {
			return "", err
		}
		capability := provider.RefreshCapability()
		if !capability.Supported {
			if grant.AccessTokenExpiresAt.After(now) {
				return tm.crypto.Decrypt(grant.AccessTokenEnc)
			}
			return "", fmt.Errorf("token expired for account %s and provider does not support refresh", account.ID)
		}
		return tm.refreshGrant(ctx, account, grant, provider, capability)
	}
	return tm.crypto.Decrypt(grant.AccessTokenEnc)
}

func (tm *TokenManager) ForceRefreshAccessToken(ctx context.Context, accountID string) (string, error) {
	account, grant, err := tm.loadAccountAndGrant(ctx, accountID)
	if err != nil {
		return "", err
	}
	if err := activeCredentialError(account, grant); err != nil {
		return "", err
	}
	if account.OAuthGrantID == "" {
		return tm.forceRefreshLegacyAccessToken(ctx, account)
	}
	return tm.forceRefreshGrant(ctx, account, grant)
}

// ForceRefreshGrant is used by grant-scoped durable jobs. One active sibling
// destination supplies provider routing; the credential itself remains on the
// grant and is updated once for every sibling.
func (tm *TokenManager) ForceRefreshGrant(ctx context.Context, grantID string) (string, error) {
	var grant models.OAuthGrant
	if err := tm.db.NewSelect().Model(&grant).Where("id = ?", grantID).Scan(ctx); err != nil {
		return "", err
	}
	var account models.SocialAccount
	if err := tm.db.NewSelect().Model(&account).
		Where("oauth_grant_id = ? AND workspace_id = ? AND is_active = ?", grant.ID, grant.WorkspaceID, true).
		Order("created_at ASC", "id ASC").
		Limit(1).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", fmt.Errorf("oauth grant %s has no active destination", grant.ID)
		}
		return "", err
	}
	if err := activeCredentialError(&account, &grant); err != nil {
		return "", err
	}
	return tm.forceRefreshGrant(ctx, &account, &grant)
}

func (tm *TokenManager) forceRefreshGrant(ctx context.Context, account *models.SocialAccount, grant *models.OAuthGrant) (string, error) {
	provider, err := tm.providerForAccount(account)
	if err != nil {
		return "", err
	}
	capability := provider.RefreshCapability()
	if !capability.Supported {
		return "", fmt.Errorf("token refresh is not supported for platform %s", account.Platform)
	}
	return tm.refreshGrant(ctx, account, grant, provider, capability)
}

func (tm *TokenManager) loadAccountAndGrant(ctx context.Context, accountID string) (*models.SocialAccount, *models.OAuthGrant, error) {
	account := new(models.SocialAccount)
	if err := tm.db.NewSelect().Model(account).Where("id = ?", accountID).Scan(ctx); err != nil {
		return nil, nil, err
	}
	if account.OAuthGrantID == "" {
		return account, &models.OAuthGrant{
			AccessTokenEnc:       account.AccessTokenEnc,
			RefreshTokenEnc:      account.RefreshTokenEnc,
			AccessTokenExpiresAt: account.TokenExpiresAt,
			GrantedScopes:        account.GrantedScopes,
		}, nil
	}
	grant := new(models.OAuthGrant)
	if err := tm.db.NewSelect().Model(grant).
		Where("id = ? AND workspace_id = ?", account.OAuthGrantID, account.WorkspaceID).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, fmt.Errorf("oauth grant for account %s is missing or belongs to another workspace", account.ID)
		}
		return nil, nil, err
	}
	return account, grant, nil
}

func activeCredentialError(account *models.SocialAccount, grant *models.OAuthGrant) error {
	if !account.IsActive {
		return fmt.Errorf("account is disconnected: %s", account.ErrorMessage)
	}
	if grant != nil && !grant.RevokedAt.IsZero() {
		return fmt.Errorf("oauth grant is revoked for account %s", account.ID)
	}
	return nil
}

func (tm *TokenManager) providerForAccount(account *models.SocialAccount) (platform.Adapter, error) {
	providerKey := account.Platform
	if account.Platform == "mastodon" {
		providerKey = "mastodon:" + account.InstanceURL
	}
	tm.providerMu.RLock()
	provider, ok := tm.providers[providerKey]
	tm.providerMu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("unsupported platform for token refresh: %s (instance: %s)", account.Platform, account.InstanceURL)
	}
	return provider, nil
}

func (tm *TokenManager) refreshGrant(ctx context.Context, account *models.SocialAccount, initial *models.OAuthGrant, provider platform.Adapter, capability platform.RefreshCapability) (string, error) {
	initialVersion := initial.TokenVersion
	for {
		grant, owner, acquired, err := tm.acquireRefreshLease(ctx, initial.ID, initialVersion)
		if err != nil {
			return "", err
		}
		if !acquired {
			token, retry, err := tm.waitForGrantRefresh(ctx, initial.ID, initialVersion)
			if !retry || err != nil {
				return token, err
			}
			continue
		}

		input, err := tm.refreshInputForGrant(grant, capability.CredentialSource)
		if err != nil {
			tm.releaseRefreshLease(ctx, grant.ID, grant.WorkspaceID, owner, "credential_unavailable")
			return "", err
		}
		tokenResp, err := provider.RefreshToken(ctx, input)
		if err != nil {
			log.Printf("[TokenManager] Failed to refresh grant %s for %s: %v", grant.ID, account.Platform, err)
			tm.releaseRefreshLease(ctx, grant.ID, grant.WorkspaceID, owner, "provider_refresh_failed")
			return "", fmt.Errorf("failed to refresh token: %w", err)
		}
		return tm.persistRefreshedGrant(ctx, account, grant, owner, tokenResp)
	}
}

func (tm *TokenManager) acquireRefreshLease(ctx context.Context, grantID string, expectedVersion int64) (*models.OAuthGrant, string, bool, error) {
	now := time.Now().UTC()
	owner := uuid.NewString()
	result, err := tm.db.NewUpdate().Model((*models.OAuthGrant)(nil)).
		Set("refresh_lease_owner = ?", owner).
		Set("refresh_lease_expires_at = ?", now.Add(tm.leaseDuration)).
		Set("last_refresh_started_at = ?", now).
		Set("last_refresh_error = ''").
		Set("updated_at = ?", now).
		Where("id = ? AND token_version = ? AND revoked_at IS NULL", grantID, expectedVersion).
		Where("refresh_lease_owner = '' OR refresh_lease_expires_at IS NULL OR refresh_lease_expires_at <= ?", now).
		Exec(ctx)
	if err != nil {
		return nil, "", false, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return nil, "", false, err
	}
	var grant models.OAuthGrant
	if err := tm.db.NewSelect().Model(&grant).Where("id = ?", grantID).Scan(ctx); err != nil {
		return nil, "", false, err
	}
	return &grant, owner, rows == 1, nil
}

func (tm *TokenManager) waitForGrantRefresh(ctx context.Context, grantID string, initialVersion int64) (string, bool, error) {
	ticker := time.NewTicker(tm.waitInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return "", false, ctx.Err()
		case <-ticker.C:
			var grant models.OAuthGrant
			if err := tm.db.NewSelect().Model(&grant).Where("id = ?", grantID).Scan(ctx); err != nil {
				return "", false, err
			}
			if !grant.RevokedAt.IsZero() {
				return "", false, fmt.Errorf("oauth grant %s was revoked during refresh", grant.ID)
			}
			if grant.TokenVersion != initialVersion {
				token, err := tm.crypto.Decrypt(grant.AccessTokenEnc)
				return token, false, err
			}
			if grant.RefreshLeaseOwner == "" || grant.RefreshLeaseExpiresAt.Before(time.Now().UTC()) {
				return "", true, nil
			}
		}
	}
}

func (tm *TokenManager) refreshInputForGrant(grant *models.OAuthGrant, source platform.RefreshCredentialSource) (platform.RefreshTokenInput, error) {
	input := platform.RefreshTokenInput{}
	if source == platform.RefreshCredentialAccessToken {
		accessToken, err := tm.crypto.Decrypt(grant.AccessTokenEnc)
		if err != nil {
			return input, fmt.Errorf("failed to decrypt access token: %w", err)
		}
		input.AccessToken = accessToken
	}
	if source == platform.RefreshCredentialRefreshToken {
		if len(grant.RefreshTokenEnc) == 0 {
			return input, fmt.Errorf("no refresh token available for grant %s", grant.ID)
		}
		refreshToken, err := tm.crypto.Decrypt(grant.RefreshTokenEnc)
		if err != nil {
			return input, fmt.Errorf("failed to decrypt refresh token: %w", err)
		}
		input.RefreshToken = refreshToken
	}
	return input, nil
}

func (tm *TokenManager) persistRefreshedGrant(ctx context.Context, account *models.SocialAccount, grant *models.OAuthGrant, owner string, tokenResp *platform.TokenResult) (string, error) {
	if tokenResp == nil || tokenResp.AccessToken == "" {
		tm.releaseRefreshLease(ctx, grant.ID, grant.WorkspaceID, owner, "invalid_provider_response")
		return "", fmt.Errorf("provider refresh returned no access token")
	}
	encAccess, err := tm.crypto.Encrypt(tokenResp.AccessToken)
	if err != nil {
		tm.releaseRefreshLease(ctx, grant.ID, grant.WorkspaceID, owner, "credential_encryption_failed")
		return "", fmt.Errorf("failed to encrypt access token: %w", err)
	}
	encRefresh := grant.RefreshTokenEnc
	if tokenResp.RefreshToken != "" {
		encRefresh, err = tm.crypto.Encrypt(tokenResp.RefreshToken)
		if err != nil {
			tm.releaseRefreshLease(ctx, grant.ID, grant.WorkspaceID, owner, "credential_encryption_failed")
			return "", fmt.Errorf("failed to encrypt refresh token: %w", err)
		}
	}
	now := time.Now().UTC()
	expiresAt := grant.AccessTokenExpiresAt
	if tokenResp.ExpiresIn > 0 {
		expiresAt = now.Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	}
	refreshExpiresAt := grant.RefreshTokenExpiresAt
	if tokenResp.RefreshExpiresIn > 0 {
		refreshExpiresAt = now.Add(time.Duration(tokenResp.RefreshExpiresIn) * time.Second)
	}
	scopes := grant.GrantedScopes
	if refreshedScopes := normalizedScopes(tokenResp); refreshedScopes != "" {
		scopes = refreshedScopes
	}
	tokenType := grant.TokenType
	if tokenResp.TokenType != "" {
		tokenType = tokenResp.TokenType
	}

	err = tm.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		result, err := tx.NewUpdate().Model((*models.OAuthGrant)(nil)).
			Set("access_token_encrypted = ?", encAccess).
			Set("refresh_token_encrypted = ?", encRefresh).
			Set("access_token_expires_at = ?", expiresAt).
			Set("refresh_token_expires_at = ?", refreshExpiresAt).
			Set("granted_scopes = ?", scopes).
			Set("token_type = ?", tokenType).
			Set("token_version = token_version + 1").
			Set("refresh_lease_owner = ''").
			Set("refresh_lease_expires_at = NULL").
			Set("last_refresh_finished_at = ?", now).
			Set("last_refresh_error = ''").
			Set("validated_at = ?", now).
			Set("validation_status = 'valid'").
			Set("updated_at = ?", now).
			Where("id = ? AND workspace_id = ? AND token_version = ? AND refresh_lease_owner = ? AND revoked_at IS NULL", grant.ID, grant.WorkspaceID, grant.TokenVersion, owner).
			Exec(txCtx)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rows != 1 {
			return fmt.Errorf("oauth grant %s changed or was revoked during refresh", grant.ID)
		}
		_, err = tx.NewUpdate().Model((*models.SocialAccount)(nil)).
			Set("granted_scopes = ?", scopes).
			Set("error_message = ''").
			Where("oauth_grant_id = ? AND workspace_id = ?", grant.ID, grant.WorkspaceID).
			Exec(txCtx)
		return err
	})
	if err != nil {
		return "", fmt.Errorf("failed to update oauth grant: %w", err)
	}
	if err := ScheduleGrantRefreshJob(ctx, tm.db, grant.ID, expiresAt); err != nil {
		log.Printf("[TokenManager] Failed to schedule refresh job for %s grant %s: %v", account.Platform, grant.ID, err)
	}
	log.Printf("[TokenManager] Successfully refreshed grant %s for %s", grant.ID, account.Platform)
	return tokenResp.AccessToken, nil
}

func (tm *TokenManager) releaseRefreshLease(ctx context.Context, grantID, workspaceID, owner, errorClass string) {
	now := time.Now().UTC()
	_ = tm.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewUpdate().Model((*models.OAuthGrant)(nil)).
			Set("refresh_lease_owner = ''").
			Set("refresh_lease_expires_at = NULL").
			Set("last_refresh_finished_at = ?", now).
			Set("last_refresh_error = ?", errorClass).
			Set("validation_status = 'refresh_failed'").
			Set("updated_at = ?", now).
			Where("id = ? AND workspace_id = ? AND refresh_lease_owner = ?", grantID, workspaceID, owner).
			Exec(txCtx); err != nil {
			return err
		}
		_, err := tx.NewUpdate().Model((*models.SocialAccount)(nil)).
			Set("error_message = ?", "OAuth credential refresh failed. Reconnect this provider grant if the problem continues.").
			Where("oauth_grant_id = ? AND workspace_id = ?", grantID, workspaceID).
			Exec(txCtx)
		return err
	})
}

func normalizedScopes(token *platform.TokenResult) string {
	if token == nil || token.Extra == nil {
		return ""
	}
	return normalizeScopeString(firstNonEmpty(token.Extra["scope"], token.Extra["scopes"]))
}

func normalizeScopeString(raw string) string {
	seen := map[string]struct{}{}
	parts := make([]string, 0)
	for _, scope := range strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\n' || r == '\t'
	}) {
		if _, ok := seen[scope]; ok {
			continue
		}
		seen[scope] = struct{}{}
		parts = append(parts, scope)
	}
	sort.Strings(parts)
	return strings.Join(parts, " ")
}

// Legacy account credential support is intentionally read-only except for old
// fixtures and rolling upgrade jobs. Migration 073 moves every production row
// to OAuthGrant before the application serves requests.
func (tm *TokenManager) getValidLegacyAccessToken(ctx context.Context, account *models.SocialAccount) (string, error) {
	if account.TokenExpiresAt.IsZero() {
		return tm.crypto.Decrypt(account.AccessTokenEnc)
	}
	now := time.Now().UTC()
	if account.TokenExpiresAt.Before(now.Add(refreshLeadTime)) {
		provider, err := tm.providerForAccount(account)
		if err != nil {
			return "", err
		}
		capability := provider.RefreshCapability()
		if !capability.Supported {
			if account.TokenExpiresAt.After(now) {
				return tm.crypto.Decrypt(account.AccessTokenEnc)
			}
			return "", fmt.Errorf("token expired for account %s and provider does not support refresh", account.ID)
		}
		return tm.refreshLegacyToken(ctx, account, provider, capability)
	}
	return tm.crypto.Decrypt(account.AccessTokenEnc)
}

func (tm *TokenManager) forceRefreshLegacyAccessToken(ctx context.Context, account *models.SocialAccount) (string, error) {
	provider, err := tm.providerForAccount(account)
	if err != nil {
		return "", err
	}
	capability := provider.RefreshCapability()
	if !capability.Supported {
		return "", fmt.Errorf("token refresh is not supported for platform %s", account.Platform)
	}
	return tm.refreshLegacyToken(ctx, account, provider, capability)
}

func (tm *TokenManager) refreshLegacyToken(ctx context.Context, account *models.SocialAccount, provider platform.Adapter, capability platform.RefreshCapability) (string, error) {
	grant := &models.OAuthGrant{ID: account.ID, AccessTokenEnc: account.AccessTokenEnc, RefreshTokenEnc: account.RefreshTokenEnc}
	input, err := tm.refreshInputForGrant(grant, capability.CredentialSource)
	if err != nil {
		return "", err
	}
	tokenResp, err := provider.RefreshToken(ctx, input)
	if err != nil {
		_, _ = tm.db.NewUpdate().Model(account).Set("error_message = ?", err.Error()).Where("id = ?", account.ID).Exec(ctx)
		return "", fmt.Errorf("failed to refresh token: %w", err)
	}
	return tm.persistLegacyTokens(ctx, account, tokenResp)
}

func (tm *TokenManager) persistLegacyTokens(ctx context.Context, account *models.SocialAccount, tokenResp *platform.TokenResult) (string, error) {
	encAccess, err := tm.crypto.Encrypt(tokenResp.AccessToken)
	if err != nil {
		return "", err
	}
	encRefresh := account.RefreshTokenEnc
	if tokenResp.RefreshToken != "" {
		encRefresh, err = tm.crypto.Encrypt(tokenResp.RefreshToken)
		if err != nil {
			return "", err
		}
	}
	expiresAt := account.TokenExpiresAt
	if tokenResp.ExpiresIn > 0 {
		expiresAt = time.Now().UTC().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	}
	if _, err := tm.db.NewUpdate().Model(account).
		Set("access_token_encrypted = ?", encAccess).
		Set("refresh_token_encrypted = ?", encRefresh).
		Set("token_expires_at = ?", expiresAt).
		Set("error_message = ''").
		Where("id = ?", account.ID).
		Exec(ctx); err != nil {
		return "", err
	}
	if err := ScheduleRefreshJob(ctx, tm.db, account.ID, expiresAt); err != nil {
		log.Printf("[TokenManager] Failed to schedule legacy refresh job for account %s: %v", account.ID, err)
	}
	return tokenResp.AccessToken, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
