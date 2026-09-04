package tokenmanager

import (
	"context"
	"io"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/stretchr/testify/require"
)

type stubAdapter struct {
	capability platform.RefreshCapability
	tokenResp  *platform.TokenResult
	refreshErr error
	gotInput   platform.RefreshTokenInput
}

func (s *stubAdapter) GenerateAuthURL(string) (string, map[string]string) { return "", nil }
func (s *stubAdapter) ExchangeCode(context.Context, string, map[string]string) (*platform.TokenResult, error) {
	return nil, nil
}
func (s *stubAdapter) RefreshCapability() platform.RefreshCapability { return s.capability }
func (s *stubAdapter) RefreshToken(_ context.Context, input platform.RefreshTokenInput) (*platform.TokenResult, error) {
	s.gotInput = input
	return s.tokenResp, s.refreshErr
}
func (s *stubAdapter) GetProfile(context.Context, string) (*platform.UserProfile, error) {
	return nil, nil
}
func (s *stubAdapter) UploadMedia(context.Context, string, string, string, io.Reader) (string, error) {
	return "", nil
}
func (s *stubAdapter) Publish(context.Context, string, string, *platform.PublishRequest) (platform.PublishResult, error) {
	return platform.PublishResult{}, nil
}

func decryptToken(t *testing.T, encryptor *crypto.TokenEncryptor, ciphertext []byte) string {
	t.Helper()

	value, err := encryptor.Decrypt(ciphertext)
	require.NoError(t, err)
	return value
}

func TestForceRefreshAccessTokenMarksGrantFailedAfterPermanentProviderFailure(t *testing.T) {
	db := newGrantSQLiteDB(t)
	encryptor := crypto.NewTokenEncryptor("grant-concurrency-secret")
	seedSharedGrant(t, db, encryptor)
	manager := NewTokenManager(db, encryptor)
	manager.SetProvider("linkedin", &stubAdapter{
		capability: platform.RefreshCapability{
			Supported:        true,
			CredentialSource: platform.RefreshCredentialRefreshToken,
		},
		refreshErr: &platform.HTTPError{StatusCode: 401, Code: "invalid_grant"},
	})

	_, err := manager.ForceRefreshAccessToken(t.Context(), "destination-person")
	require.Error(t, err)

	var grant models.OAuthGrant
	require.NoError(t, db.NewSelect().Model(&grant).Where("id = ?", "grant-shared").Scan(t.Context()))
	require.Equal(t, "refresh_failed", grant.ValidationStatus)
	require.Empty(t, grant.RefreshLeaseOwner)
	require.Equal(t, "provider_refresh_failed", grant.LastRefreshError)

	var accounts []models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&accounts).Where("oauth_grant_id = ?", grant.ID).Scan(t.Context()))
	for _, account := range accounts {
		require.Contains(t, account.ErrorMessage, "Reconnect")
	}
}
