package account_saver

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

func accountSaverActor(userID string) workspaceaccess.ActorFacts {
	return workspaceaccess.ActorFacts{UserID: userID}
}

// createTestDB creates an in-memory SQLite database for testing.
func createTestDB(t *testing.T) *bun.DB {
	sqldb, err := openInMemorySQLite()
	require.NoError(t, err)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	// Initialize schema
	for _, model := range []any{(*models.Organization)(nil), (*models.Workspace)(nil)} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	_, err = db.NewCreateTable().
		Model((*models.OAuthGrant)(nil)).
		IfNotExists().
		Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewCreateTable().
		Model((*models.WorkspaceFirstConnection)(nil)).
		IfNotExists().
		Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewCreateTable().
		Model((*models.SocialAccount)(nil)).
		IfNotExists().
		Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewCreateTable().
		Model((*models.WorkspaceMember)(nil)).
		IfNotExists().
		Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewCreateTable().
		Model((*models.Job)(nil)).
		IfNotExists().
		Exec(context.Background())
	require.NoError(t, err)

	return db
}

func seedWorkspaceMember(t *testing.T, db *bun.DB, workspaceID, userID string) {
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.Organization{ID: "organization-" + workspaceID, Name: workspaceID, CreatedAt: now, UpdatedAt: now}).On("CONFLICT DO NOTHING").Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: workspaceID, OrganizationID: "organization-" + workspaceID, Name: workspaceID, CreatedAt: now}).On("CONFLICT DO NOTHING").Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: workspaceID,
		UserID:      userID,
		Role:        "admin",
	}).Exec(context.Background())
	require.NoError(t, err)
}

func loadAccountGrant(t *testing.T, db *bun.DB, account *models.SocialAccount) models.OAuthGrant {
	t.Helper()
	require.NotEmpty(t, account.OAuthGrantID)
	var grant models.OAuthGrant
	require.NoError(t, db.NewSelect().Model(&grant).Where("id = ?", account.OAuthGrantID).Scan(context.Background()))
	return grant
}

// openInMemorySQLite creates an in-memory SQLite database.
func openInMemorySQLite() (*sql.DB, error) {
	return sql.Open(sqliteshim.ShimName, fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
}

func TestSaveAccountsFromInputsKeepsDestinationsDistinctFromGrantSubject(t *testing.T) {
	for _, tc := range []struct {
		provider, firstID, secondID, scope    string
		firstCapabilities, secondCapabilities map[string]string
	}{
		{"linkedin", "urn:li:person:member-1", "urn:li:organization:42", "w_member_social w_organization_social", map[string]string{"linkedin_account_type": "person"}, map[string]string{"linkedin_account_type": "organization"}},
		{"facebook", "page-1", "page-2", "pages_show_list pages_manage_posts", nil, nil},
		{"youtube", "channel-1", "channel-2", "https://www.googleapis.com/auth/youtube.upload", nil, nil},
	} {
		t.Run(tc.provider, func(t *testing.T) {
			db := createTestDB(t)
			encryptor := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
			saver := NewAccountSaver(db, encryptor)
			ctx := context.Background()
			seedWorkspaceMember(t, db, "workspace-1", "user-1")
			token := &platform.TokenResult{
				AccessToken: "member-token",
				Extra:       map[string]string{"user_id": "member-1", "scope": tc.scope},
			}

			accounts, err := saver.SaveAccountsFromInputs(ctx, []SaveAccountInput{
				{
					Actor: accountSaverActor("user-1"), UserID: "user-1", WorkspaceID: "workspace-1", PlatformName: tc.provider,
					AccountID: tc.firstID, AccountUsername: "Ada", Token: token,
					CapabilityState: tc.firstCapabilities,
				},
				{
					Actor: accountSaverActor("user-1"), UserID: "user-1", WorkspaceID: "workspace-1", PlatformName: tc.provider,
					AccountID: tc.secondID, AccountUsername: "OpenPost", Token: token,
					CapabilityState: tc.secondCapabilities,
				},
			})
			require.NoError(t, err)
			require.Len(t, accounts, 2)
			require.Equal(t, tc.firstID, accounts[0].AccountID)
			require.Equal(t, tc.secondID, accounts[1].AccountID)
			require.NotEqual(t, accounts[0].Slug, accounts[1].Slug)

			var stored []models.SocialAccount
			require.NoError(t, db.NewSelect().Model(&stored).Order("created_at ASC").Scan(ctx))
			require.Len(t, stored, 2)
			require.Equal(t, stored[0].OAuthGrantID, stored[1].OAuthGrantID)
			grant := loadAccountGrant(t, db, &stored[0])
			require.Equal(t, "member-1", grant.ProviderSubject)
			decrypted, decryptErr := encryptor.Decrypt(grant.AccessTokenEnc)
			require.NoError(t, decryptErr)
			require.Equal(t, "member-token", decrypted)
		})
	}
}

func TestClientConnectionPersistsGrantAndRejectsRevokedMembership(t *testing.T) {
	db := createTestDB(t)
	saver := NewAccountSaver(db, crypto.NewTokenEncryptor("test-secret-key-for-testing-only"))
	seedWorkspaceMember(t, db, "workspace-client", "client")
	_, err := db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role = ?", models.WorkspaceRoleClient).Where("workspace_id = ? AND user_id = ?", "workspace-client", "client").Exec(t.Context())
	require.NoError(t, err)
	input := SaveAccountInput{Actor: accountSaverActor("client"), UserID: "client", WorkspaceID: "workspace-client", PlatformName: "linkedin", AccountID: "urn:li:person:client", AccountUsername: "Client", Token: &platform.TokenResult{AccessToken: "client-token", Extra: map[string]string{"user_id": "client", "scope": "w_member_social"}}}
	account, err := saver.SaveAccountFromInput(t.Context(), input)
	require.NoError(t, err)
	require.NotEmpty(t, loadAccountGrant(t, db, account).ID)
	_, err = db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role = ?", models.WorkspaceRoleViewer).Where("workspace_id = ? AND user_id = ?", "workspace-client", "client").Exec(t.Context())
	require.NoError(t, err)
	_, err = saver.SaveAccountFromInput(t.Context(), input)
	require.Error(t, err)
}

// TestSaveAccount_Mastodon tests saving a Mastodon account.

// TestSaveAccount_Threads tests that Threads user ID is extracted from token extra.

// TestSaveAccount_EncryptionError tests handling of encryption failures.

// TestSaveAccount_DatabaseError tests handling of database failures.

// The account-save boundary covers single connections and multi-destination OAuth.
func TestAccountPhotosSurviveReconnectAndFailedDownloads(t *testing.T) {
	db := createTestDB(t)
	seedWorkspaceMember(t, db, "ws", "user")
	saver := NewAccountSaver(db, crypto.NewTokenEncryptor("test-secret-key-for-testing-only"))
	cache := &avatarCacheStub{url: "/avatars/avatar_account_first.jpg"}
	saver.SetAvatarCache(cache)
	input := SaveAccountInput{Actor: accountSaverActor("user"), UserID: "user", WorkspaceID: "ws", PlatformName: "facebook", AccountID: "page", AccountUsername: "Page", AccountAvatarURL: "https://cdn.example/photo?signature=temporary", Token: &platform.TokenResult{AccessToken: "token"}}
	account, err := saver.SaveAccountFromInput(t.Context(), input)
	require.NoError(t, err)
	require.Equal(t, cache.url, account.AccountAvatarURL)
	var stored models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", account.ID).Scan(t.Context()))
	require.Equal(t, cache.url, stored.AccountAvatarURL)
	require.Empty(t, cache.deleted)

	// Download failures do not break connection or overwrite an existing photo.
	cache.err = errors.New("provider unavailable")
	reconnected, err := saver.SaveAccountFromInput(t.Context(), input)
	require.NoError(t, err)
	require.Equal(t, account.ID, reconnected.ID)
	require.Equal(t, account.AccountAvatarURL, reconnected.AccountAvatarURL)
	require.Empty(t, cache.deleted)
	input.AccountID = "new-page"
	withoutPhoto, err := saver.SaveAccountFromInput(t.Context(), input)
	require.NoError(t, err)
	require.Empty(t, withoutPhoto.AccountAvatarURL, "never persist a temporary URL when caching fails")

	// A successful replacement retires the previous stored object after commit.
	cache.err = nil
	cache.url = "/avatars/avatar_account_replaced.jpg"
	input.AccountID = "page"
	replacement, err := saver.SaveAccountFromInput(t.Context(), input)
	require.NoError(t, err)
	require.Equal(t, cache.url, replacement.AccountAvatarURL)
	require.Equal(t, []string{account.AccountAvatarURL}, cache.deleted)

	// Providers that omit a picture preserve the last saved version.
	input.AccountAvatarURL = ""
	unchanged, err := saver.SaveAccountFromInput(t.Context(), input)
	require.NoError(t, err)
	require.Equal(t, replacement.AccountAvatarURL, unchanged.AccountAvatarURL)
}

type avatarCacheStub struct {
	url     string
	err     error
	deleted []string
}

func (c *avatarCacheStub) CacheAvatar(context.Context, string, string) (string, error) {
	return c.url, c.err
}
func (c *avatarCacheStub) Delete(_ context.Context, url string) error {
	c.deleted = append(c.deleted, url)
	return nil
}
