package tokenmanager

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type stubAdapter struct {
	capability platform.RefreshCapability
	tokenResp  *platform.TokenResult
	gotInput   platform.RefreshTokenInput
}

func (s *stubAdapter) GenerateAuthURL(string) (string, map[string]string) { return "", nil }
func (s *stubAdapter) ExchangeCode(context.Context, string, map[string]string) (*platform.TokenResult, error) {
	return nil, nil
}
func (s *stubAdapter) RefreshCapability() platform.RefreshCapability { return s.capability }
func (s *stubAdapter) RefreshToken(_ context.Context, input platform.RefreshTokenInput) (*platform.TokenResult, error) {
	s.gotInput = input
	return s.tokenResp, nil
}
func (s *stubAdapter) GetProfile(context.Context, string) (*platform.UserProfile, error) {
	return nil, nil
}
func (s *stubAdapter) UploadMedia(context.Context, string, string, string, io.Reader) (string, error) {
	return "", nil
}
func (s *stubAdapter) Publish(context.Context, string, string, *platform.PublishRequest) (string, error) {
	return "", nil
}

func createTestDB(t *testing.T) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []interface{}{(*models.SocialAccount)(nil), (*models.Job)(nil)} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}

	return db
}

func insertAccount(t *testing.T, db *bun.DB, encryptor *crypto.TokenEncryptor, account *models.SocialAccount, accessToken, refreshToken string) {
	t.Helper()

	encAccess, err := encryptor.Encrypt(accessToken)
	require.NoError(t, err)
	account.AccessTokenEnc = encAccess

	if refreshToken != "" {
		encRefresh, err := encryptor.Encrypt(refreshToken)
		require.NoError(t, err)
		account.RefreshTokenEnc = encRefresh
	}

	_, err = db.NewInsert().Model(account).Exec(context.Background())
	require.NoError(t, err)
}

func decryptToken(t *testing.T, encryptor *crypto.TokenEncryptor, ciphertext []byte) string {
	t.Helper()

	value, err := encryptor.Decrypt(ciphertext)
	require.NoError(t, err)
	return value
}

func TestForceRefreshAccessTokenUsesAccessTokenCredential(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	encryptor := crypto.NewTokenEncryptor("test-secret-key")
	manager := NewTokenManager(db, encryptor)
	adapter := &stubAdapter{
		capability: platform.RefreshCapability{
			Supported:        true,
			CredentialSource: platform.RefreshCredentialAccessToken,
		},
		tokenResp: &platform.TokenResult{
			AccessToken: "new-access-token",
			ExpiresIn:   3600,
		},
	}
	manager.SetProvider("threads", adapter)

	account := &models.SocialAccount{
		ID:             "acc-threads",
		Platform:       "threads",
		AccountID:      "threads-user",
		WorkspaceID:    "ws-1",
		IsActive:       true,
		TokenExpiresAt: time.Now().UTC().Add(2 * time.Minute),
	}
	insertAccount(t, db, encryptor, account, "old-access-token", "")

	token, err := manager.ForceRefreshAccessToken(context.Background(), account.ID)
	require.NoError(t, err)
	require.Equal(t, "new-access-token", token)
	require.Equal(t, "old-access-token", adapter.gotInput.AccessToken)
	require.Empty(t, adapter.gotInput.RefreshToken)

	stored := new(models.SocialAccount)
	err = db.NewSelect().Model(stored).Where("id = ?", account.ID).Scan(context.Background())
	require.NoError(t, err)
	require.Equal(t, "new-access-token", decryptToken(t, encryptor, stored.AccessTokenEnc))

	var jobs []models.Job
	err = db.NewSelect().Model(&jobs).Where("type = ?", "refresh_token").Scan(context.Background())
	require.NoError(t, err)
	require.Len(t, jobs, 1)
}

func TestForceRefreshAccessTokenPreservesStoredRefreshToken(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	encryptor := crypto.NewTokenEncryptor("test-secret-key")
	manager := NewTokenManager(db, encryptor)
	adapter := &stubAdapter{
		capability: platform.RefreshCapability{
			Supported:        true,
			CredentialSource: platform.RefreshCredentialRefreshToken,
		},
		tokenResp: &platform.TokenResult{
			AccessToken: "new-linkedin-access-token",
			ExpiresIn:   7200,
		},
	}
	manager.SetProvider("linkedin", adapter)

	account := &models.SocialAccount{
		ID:             "acc-linkedin",
		Platform:       "linkedin",
		AccountID:      "linkedin-user",
		WorkspaceID:    "ws-1",
		IsActive:       true,
		TokenExpiresAt: time.Now().UTC().Add(2 * time.Minute),
	}
	insertAccount(t, db, encryptor, account, "old-linkedin-access-token", "old-refresh-token")

	_, err := manager.ForceRefreshAccessToken(context.Background(), account.ID)
	require.NoError(t, err)
	require.Equal(t, "old-refresh-token", adapter.gotInput.RefreshToken)

	stored := new(models.SocialAccount)
	err = db.NewSelect().Model(stored).Where("id = ?", account.ID).Scan(context.Background())
	require.NoError(t, err)
	require.Equal(t, "old-refresh-token", decryptToken(t, encryptor, stored.RefreshTokenEnc))
	require.Equal(t, "new-linkedin-access-token", decryptToken(t, encryptor, stored.AccessTokenEnc))
}

func TestForceRefreshAccessTokenUsesMastodonInstanceURLProviderKey(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	encryptor := crypto.NewTokenEncryptor("test-secret-key")
	manager := NewTokenManager(db, encryptor)
	adapter := &stubAdapter{
		capability: platform.RefreshCapability{
			Supported:        true,
			CredentialSource: platform.RefreshCredentialRefreshToken,
		},
		tokenResp: &platform.TokenResult{
			AccessToken:  "new-mastodon-access-token",
			RefreshToken: "new-mastodon-refresh-token",
			ExpiresIn:    3600,
		},
	}
	manager.SetProvider("mastodon:https://mastodon.social", adapter)

	account := &models.SocialAccount{
		ID:             "acc-mastodon",
		Platform:       "mastodon",
		InstanceURL:    "https://mastodon.social",
		AccountID:      "mastodon-user",
		WorkspaceID:    "ws-1",
		IsActive:       true,
		TokenExpiresAt: time.Now().UTC().Add(2 * time.Minute),
	}
	insertAccount(t, db, encryptor, account, "old-mastodon-access-token", "old-mastodon-refresh-token")

	token, err := manager.ForceRefreshAccessToken(context.Background(), account.ID)
	require.NoError(t, err)
	require.Equal(t, "new-mastodon-access-token", token)
	require.Equal(t, "old-mastodon-refresh-token", adapter.gotInput.RefreshToken)
}

func TestForceRefreshAccessTokenUpdatesExpiryFromBlueskyRefresh(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	encryptor := crypto.NewTokenEncryptor("test-secret-key")
	manager := NewTokenManager(db, encryptor)
	adapter := &stubAdapter{
		capability: platform.RefreshCapability{
			Supported:        true,
			CredentialSource: platform.RefreshCredentialRefreshToken,
		},
		tokenResp: &platform.TokenResult{
			AccessToken:  "new-bluesky-access-token",
			RefreshToken: "new-bluesky-refresh-token",
			ExpiresIn:    7200,
		},
	}
	manager.SetProvider("bluesky", adapter)

	account := &models.SocialAccount{
		ID:             "acc-bluesky",
		Platform:       "bluesky",
		AccountID:      "did:plc:test",
		WorkspaceID:    "ws-1",
		IsActive:       true,
		TokenExpiresAt: time.Now().UTC().Add(1 * time.Minute),
	}
	insertAccount(t, db, encryptor, account, "old-bluesky-access-token", "old-bluesky-refresh-token")

	beforeRefresh := time.Now().UTC()
	token, err := manager.ForceRefreshAccessToken(context.Background(), account.ID)
	require.NoError(t, err)
	require.Equal(t, "new-bluesky-access-token", token)
	require.Equal(t, "old-bluesky-refresh-token", adapter.gotInput.RefreshToken)

	stored := new(models.SocialAccount)
	err = db.NewSelect().Model(stored).Where("id = ?", account.ID).Scan(context.Background())
	require.NoError(t, err)
	require.WithinDuration(t, beforeRefresh.Add(2*time.Hour), stored.TokenExpiresAt, 10*time.Second)

	var pendingJob models.Job
	err = db.NewSelect().
		Model(&pendingJob).
		Where("type = ?", "refresh_token").
		Where("status = ?", "pending").
		Order("run_at DESC").
		Limit(1).
		Scan(context.Background())
	require.NoError(t, err)
	require.WithinDuration(t, stored.TokenExpiresAt.Add(-refreshLeadTime), pendingJob.RunAt, 10*time.Second)
}
