package tokenmanager

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/uptrace/bun"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
)

type TokenManager struct {
	db         *bun.DB
	crypto     *crypto.TokenEncryptor
	providerMu sync.RWMutex
	providers  map[string]platform.Adapter
}

func NewTokenManager(db *bun.DB, encryptor *crypto.TokenEncryptor) *TokenManager {
	return &TokenManager{
		db:        db,
		crypto:    encryptor,
		providers: make(map[string]platform.Adapter),
	}
}

func (tm *TokenManager) SetProvider(platformName string, adapter platform.Adapter) {
	tm.providerMu.Lock()
	defer tm.providerMu.Unlock()
	tm.providers[platformName] = adapter
}

func (tm *TokenManager) GetValidAccessToken(ctx context.Context, accountID string) (string, error) {
	account, err := tm.loadAccount(ctx, accountID)
	if err != nil {
		return "", err
	}

	if !account.IsActive {
		return "", fmt.Errorf("account is disconnected: %s", account.ErrorMessage)
	}

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

		return tm.refreshToken(ctx, account, provider, capability)
	}

	return tm.crypto.Decrypt(account.AccessTokenEnc)
}

func (tm *TokenManager) ForceRefreshAccessToken(ctx context.Context, accountID string) (string, error) {
	account, err := tm.loadAccount(ctx, accountID)
	if err != nil {
		return "", err
	}

	if !account.IsActive {
		return "", fmt.Errorf("account is disconnected: %s", account.ErrorMessage)
	}

	provider, err := tm.providerForAccount(account)
	if err != nil {
		return "", err
	}

	capability := provider.RefreshCapability()
	if !capability.Supported {
		return "", fmt.Errorf("token refresh is not supported for platform %s", account.Platform)
	}

	return tm.refreshToken(ctx, account, provider, capability)
}

func (tm *TokenManager) loadAccount(ctx context.Context, accountID string) (*models.SocialAccount, error) {
	account := new(models.SocialAccount)
	err := tm.db.NewSelect().
		Model(account).
		Where("id = ?", accountID).
		Scan(ctx)
	if err != nil {
		return nil, err
	}
	return account, nil
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

func (tm *TokenManager) refreshToken(ctx context.Context, account *models.SocialAccount, provider platform.Adapter, capability platform.RefreshCapability) (string, error) {
	input, err := tm.refreshInputForAccount(account, capability.CredentialSource)
	if err != nil {
		return "", err
	}

	tokenResp, err := provider.RefreshToken(ctx, input)
	if err != nil {
		log.Printf("[TokenManager] Failed to refresh token for %s account %s: %v", account.Platform, account.ID, err)
		_, _ = tm.db.NewUpdate().Model(account).
			Set("error_message = ?", err.Error()).
			Where("id = ?", account.ID).
			Exec(ctx)
		return "", fmt.Errorf("failed to refresh token: %w", err)
	}

	return tm.persistRefreshedTokens(ctx, account, tokenResp)
}

func (tm *TokenManager) refreshInputForAccount(account *models.SocialAccount, source platform.RefreshCredentialSource) (platform.RefreshTokenInput, error) {
	input := platform.RefreshTokenInput{}

	if source == platform.RefreshCredentialAccessToken {
		accessToken, err := tm.crypto.Decrypt(account.AccessTokenEnc)
		if err != nil {
			return input, fmt.Errorf("failed to decrypt access token: %w", err)
		}
		input.AccessToken = accessToken
	}

	if source == platform.RefreshCredentialRefreshToken {
		if len(account.RefreshTokenEnc) == 0 {
			return input, fmt.Errorf("no refresh token available for account %s", account.ID)
		}

		refreshToken, err := tm.crypto.Decrypt(account.RefreshTokenEnc)
		if err != nil {
			return input, fmt.Errorf("failed to decrypt refresh token: %w", err)
		}
		input.RefreshToken = refreshToken
	}

	return input, nil
}

func (tm *TokenManager) persistRefreshedTokens(ctx context.Context, account *models.SocialAccount, tokenResp *platform.TokenResult) (string, error) {
	encAccess, err := tm.crypto.Encrypt(tokenResp.AccessToken)
	if err != nil {
		return "", fmt.Errorf("failed to encrypt access token: %w", err)
	}

	encRefresh := account.RefreshTokenEnc
	if tokenResp.RefreshToken != "" {
		encRefresh, err = tm.crypto.Encrypt(tokenResp.RefreshToken)
		if err != nil {
			return "", fmt.Errorf("failed to encrypt refresh token: %w", err)
		}
	}

	expiresAt := account.TokenExpiresAt
	if tokenResp.ExpiresIn > 0 {
		expiresAt = time.Now().UTC().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	}

	_, err = tm.db.NewUpdate().Model(account).
		Set("access_token_encrypted = ?", encAccess).
		Set("refresh_token_encrypted = ?", encRefresh).
		Set("token_expires_at = ?", expiresAt).
		Set("error_message = ?", "").
		Where("id = ?", account.ID).
		Exec(ctx)

	if err != nil {
		return "", fmt.Errorf("failed to update account tokens: %w", err)
	}

	if err := ScheduleRefreshJob(ctx, tm.db, account.ID, expiresAt); err != nil {
		log.Printf("[TokenManager] Failed to schedule refresh job for %s account %s: %v", account.Platform, account.ID, err)
	}

	log.Printf("[TokenManager] Successfully refreshed token for %s account %s", account.Platform, account.ID)
	return tokenResp.AccessToken, nil
}
