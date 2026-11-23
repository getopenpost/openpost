package account_saver

import (
	"context"

	"database/sql"

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

func TestAccountPhotoObjectsAreRemovedWhenBatchSaveRollsBack(t *testing.T) {
	db := createTestDB(t)
	seedWorkspaceMember(t, db, "ws", "user")
	saver := NewAccountSaver(db, crypto.NewTokenEncryptor("test-secret-key-for-testing-only"))
	cache := &avatarCacheStub{url: "/avatars/avatar_account_uncommitted.jpg"}
	saver.SetAvatarCache(cache)
	// Fail the real database transaction after downloading, not a mocked write.
	_, err := db.ExecContext(t.Context(), `CREATE TRIGGER reject_account BEFORE INSERT ON social_accounts BEGIN SELECT RAISE(ABORT, 'write failed'); END`)
	require.NoError(t, err)
	_, err = saver.SaveAccountFromInput(t.Context(), SaveAccountInput{Actor: accountSaverActor("user"), UserID: "user", WorkspaceID: "ws", PlatformName: "threads", AccountID: "profile", AccountUsername: "Profile", AccountAvatarURL: "https://cdn.example/photo", Token: &platform.TokenResult{AccessToken: "token"}})
	require.ErrorContains(t, err, "write failed")
	require.Equal(t, []string{cache.url}, cache.deleted)
	count, err := db.NewSelect().Model((*models.SocialAccount)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
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

func TestYouTubeConnectionPersistsActualProfileFetchTime(t *testing.T) {
	db := createTestDB(t)
	saver := NewAccountSaver(db, crypto.NewTokenEncryptor("test-secret-key-for-testing-only"))
	seedWorkspaceMember(t, db, "youtube-workspace", "youtube-user")
	fetched := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	input := SaveAccountInput{Actor: accountSaverActor("youtube-user"), UserID: "youtube-user", WorkspaceID: "youtube-workspace", PlatformName: "youtube", AccountID: "channel", AccountUsername: "Channel", AccountAvatarURL: "/avatars/avatar_account_old.png", ProfileFetchedAt: fetched, Token: &platform.TokenResult{AccessToken: "token"}}
	account, err := saver.SaveAccountFromInput(t.Context(), input)
	require.NoError(t, err)
	var stored models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", account.ID).Scan(t.Context()))
	require.Equal(t, fetched, stored.ProfileFetchedAt.UTC())
	input.ProfileFetchedAt = fetched.Add(time.Hour)
	input.AccountAvatarURL = ""
	_, err = saver.SaveAccountFromInput(t.Context(), input)
	require.NoError(t, err)
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", account.ID).Scan(t.Context()))
	require.Equal(t, input.ProfileFetchedAt, stored.ProfileFetchedAt.UTC())
	require.Empty(t, stored.AccountAvatarURL, "a fresh profile must not renew an unfetched old photo")
	deletionCount, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", "storage_delete").Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, deletionCount)
}
