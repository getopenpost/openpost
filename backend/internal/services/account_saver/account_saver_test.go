package account_saver

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
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
	return sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
}

func TestDiscordBotAccountStoresGuildReferenceWithoutGlobalBotToken(t *testing.T) {
	db := createTestDB(t)
	encryptor := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
	saver := NewAccountSaver(db, encryptor)
	seedWorkspaceMember(t, db, "workspace-discord", "user-discord")

	const globalBotToken = "instance-global-discord-bot-secret"
	account, err := saver.SaveAccountFromInput(t.Context(), SaveAccountInput{
		Actor:           accountSaverActor("user-discord"),
		UserID:          "user-discord",
		PlatformName:    "discord",
		WorkspaceID:     "workspace-discord",
		AccountID:       "guild-100",
		AccountUsername: "OpenPost Guild",
		Token:           &platform.TokenResult{AccessToken: "discord-guild:guild-100", TokenType: "Installation", Extra: map[string]string{"scope": "bot"}},
		CapabilityState: map[string]string{"connection_type": "bot", "discord_guild_id": "guild-100"},
		Grant:           AuthorizationGrantInput{ProviderProjectID: "discord-app", ProviderSubject: "user-1", ExecutionMode: "bot_oauth2"},
	})
	require.NoError(t, err)
	require.Equal(t, "guild-100", account.AccountID)
	require.Empty(t, account.AccessTokenEnc)
	require.Contains(t, account.CapabilityState, `"connection_type":"bot"`)

	grant := loadAccountGrant(t, db, account)
	storedCredential, err := encryptor.Decrypt(grant.AccessTokenEnc)
	require.NoError(t, err)
	require.Equal(t, "discord-guild:guild-100", storedCredential)
	for _, stored := range []string{storedCredential, account.CapabilityState, grant.AuthorizationEvidence, account.AccountUsername} {
		require.False(t, strings.Contains(stored, globalBotToken))
	}
}

// TestSaveAccount_X tests saving an X (Twitter) account.
func TestSaveAccount_X(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	crypto := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
	saver := NewAccountSaver(db, crypto)

	ctx := context.Background()
	workspaceID := "test-workspace-123"
	userID := "user-123"
	platformName := "x"
	accountID := "1234567890"
	accountUsername := "testuser"
	instanceURL := "" // Not used for X

	// Mock token response
	tokenResp := &platform.TokenResult{
		AccessToken:  "x-access-token-123",
		RefreshToken: "x-refresh-token-456",
		ExpiresIn:    7200, // 2 hours
		Extra:        map[string]string{},
	}

	seedWorkspaceMember(t, db, workspaceID, userID)
	account, err := saver.SaveAccount(ctx, accountSaverActor(userID), platformName, workspaceID, accountID, accountUsername, instanceURL, tokenResp)
	require.NoError(t, err)
	require.NotNil(t, account)

	// Verify account fields
	require.Equal(t, workspaceID, account.WorkspaceID)
	require.Equal(t, platformName, account.Platform)
	require.Equal(t, accountID, account.AccountID)
	require.Equal(t, accountUsername, account.AccountUsername)
	require.Equal(t, instanceURL, account.InstanceURL)
	require.True(t, account.IsActive)
	require.Equal(t, "x-testuser", account.Slug)
	require.NotZero(t, account.ID)
	require.NotZero(t, account.CreatedAt)

	grant := loadAccountGrant(t, db, account)
	// Verify tokens are encrypted once on the grant, not copied to the destination.
	require.Empty(t, account.AccessTokenEnc)
	require.Empty(t, account.RefreshTokenEnc)
	require.NotEqual(t, tokenResp.AccessToken, string(grant.AccessTokenEnc))
	require.NotEqual(t, tokenResp.RefreshToken, string(grant.RefreshTokenEnc))

	// Verify decryption works
	decryptedAccess, err := crypto.Decrypt(grant.AccessTokenEnc)
	require.NoError(t, err)
	require.Equal(t, tokenResp.AccessToken, decryptedAccess)

	decryptedRefresh, err := crypto.Decrypt(grant.RefreshTokenEnc)
	require.NoError(t, err)
	require.Equal(t, tokenResp.RefreshToken, decryptedRefresh)

	// Verify expiration is set (within reasonable range)
	require.WithinDuration(t, time.Now().UTC().Add(2*time.Hour), grant.AccessTokenExpiresAt, 10*time.Second)

	var jobs []models.Job
	err = db.NewSelect().Model(&jobs).Where("type = ?", "refresh_token").Scan(ctx)
	require.NoError(t, err)
	require.Len(t, jobs, 1)
}

func TestSaveAccountsFromInputsConnectsLinkedInIdentitiesAtomically(t *testing.T) {
	db := createTestDB(t)
	encryptor := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
	saver := NewAccountSaver(db, encryptor)
	ctx := context.Background()
	seedWorkspaceMember(t, db, "workspace-1", "user-1")
	token := &platform.TokenResult{
		AccessToken: "member-token",
		Extra:       map[string]string{"user_id": "member-1", "scope": "w_member_social w_organization_social"},
	}

	accounts, err := saver.SaveAccountsFromInputs(ctx, []SaveAccountInput{
		{
			Actor: accountSaverActor("user-1"), UserID: "user-1", WorkspaceID: "workspace-1", PlatformName: "linkedin",
			AccountID: "urn:li:person:member-1", AccountUsername: "Ada", Token: token,
			CapabilityState: map[string]string{"linkedin_account_type": "person"},
		},
		{
			Actor: accountSaverActor("user-1"), UserID: "user-1", WorkspaceID: "workspace-1", PlatformName: "linkedin",
			AccountID: "urn:li:organization:42", AccountUsername: "OpenPost", Token: token,
			CapabilityState: map[string]string{"linkedin_account_type": "organization"},
		},
	})
	require.NoError(t, err)
	require.Len(t, accounts, 2)
	require.Equal(t, "urn:li:person:member-1", accounts[0].AccountID)
	require.Equal(t, "urn:li:organization:42", accounts[1].AccountID)
	require.NotEqual(t, accounts[0].Slug, accounts[1].Slug)

	var stored []models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&stored).Order("created_at ASC").Scan(ctx))
	require.Len(t, stored, 2)
	require.Equal(t, stored[0].OAuthGrantID, stored[1].OAuthGrantID)
	grant := loadAccountGrant(t, db, &stored[0])
	decrypted, decryptErr := encryptor.Decrypt(grant.AccessTokenEnc)
	require.NoError(t, decryptErr)
	require.Equal(t, "member-token", decrypted)
}

func TestSaveAccountsFromInputsRollsBackEveryIdentity(t *testing.T) {
	db := createTestDB(t)
	encryptor := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
	saver := NewAccountSaver(db, encryptor)
	ctx := context.Background()
	seedWorkspaceMember(t, db, "workspace-1", "user-1")
	_, err := db.ExecContext(ctx, `CREATE UNIQUE INDEX social_accounts_remote_test_idx ON social_accounts (workspace_id, platform, account_id)`)
	require.NoError(t, err)
	token := &platform.TokenResult{AccessToken: "member-token"}

	_, err = saver.SaveAccountsFromInputs(ctx, []SaveAccountInput{
		{Actor: accountSaverActor("user-1"), UserID: "user-1", WorkspaceID: "workspace-1", PlatformName: "linkedin", AccountID: "duplicate", AccountUsername: "One", Token: token},
		{Actor: accountSaverActor("user-1"), UserID: "user-1", WorkspaceID: "workspace-1", PlatformName: "linkedin", AccountID: "duplicate", AccountUsername: "Two", Token: token},
	})
	require.Error(t, err)
	count, countErr := db.NewSelect().Model((*models.SocialAccount)(nil)).Count(ctx)
	require.NoError(t, countErr)
	require.Zero(t, count)
}

// TestSaveAccount_Mastodon tests saving a Mastodon account.

// TestSaveAccount_Threads tests that Threads user ID is extracted from token extra.

func TestSaveAccountRejectsSocialAccountQuota(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	crypto := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
	saver := NewAccountSaver(db, crypto, entitlements.NewStaticService(entitlements.PlanSnapshot{
		Limits: map[entitlements.LimitKey]int64{
			entitlements.LimitSocialAccounts: 1,
		},
	}))

	ctx := context.Background()
	workspaceID := "workspace"
	userID := "user"
	seedWorkspaceMember(t, db, workspaceID, userID)
	_, err := db.NewInsert().Model(&models.SocialAccount{
		ID:             "existing",
		WorkspaceID:    workspaceID,
		Platform:       "x",
		AccountID:      "existing",
		Slug:           "x-existing",
		AccessTokenEnc: []byte("token"),
		IsActive:       true,
		CreatedAt:      time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	account, err := saver.SaveAccount(ctx, accountSaverActor(userID), "mastodon", workspaceID, "next", "next", "https://masto.example", &platform.TokenResult{
		AccessToken: "token",
	})

	require.Nil(t, account)
	require.ErrorContains(t, err, "social_accounts limit exceeded")
	count, err := db.NewSelect().
		Model((*models.SocialAccount)(nil)).
		Where("workspace_id = ?", workspaceID).
		Where("is_active = ?", true).
		Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

// TestSaveAccount_EncryptionError tests handling of encryption failures.

// TestSaveAccount_DatabaseError tests handling of database failures.

func TestSaveAccountKeepsBlueskyDIDsOnDifferentPDSesApart(t *testing.T) {
	db := createTestDB(t)
	saver := NewAccountSaver(db, crypto.NewTokenEncryptor("test-secret-key-for-testing-only"))
	seedWorkspaceMember(t, db, "workspace-bluesky", "user-bluesky")

	save := func(instanceURL string) *models.SocialAccount {
		account, err := saver.SaveAccountFromInput(t.Context(), SaveAccountInput{
			Actor:           accountSaverActor("user-bluesky"),
			UserID:          "user-bluesky",
			PlatformName:    "bluesky",
			WorkspaceID:     "workspace-bluesky",
			AccountID:       "did:plc:selfhostedexample000000",
			AccountUsername: "alice.example",
			InstanceURL:     instanceURL,
			Token:           &platform.TokenResult{AccessToken: "access", RefreshToken: "refresh", ExpiresIn: 3600},
			Grant: AuthorizationGrantInput{
				ProviderProjectID: platform.BlueskyDefaultPDSURL,
				ProviderSubject:   "did:plc:selfhostedexample000000",
				ExecutionMode:     "app_password",
			},
		})
		require.NoError(t, err)
		return account
	}

	hosted := save(platform.BlueskyDefaultPDSURL)
	selfHosted := save("https://pds.example")
	require.NotEqual(t, hosted.ID, selfHosted.ID)
	require.Equal(t, hosted.ID, save(platform.BlueskyDefaultPDSURL).ID)

	count, err := db.NewSelect().Model((*models.SocialAccount)(nil)).
		Where("workspace_id = ? AND platform = ?", "workspace-bluesky", "bluesky").Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 2, count)
}
