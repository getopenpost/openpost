package account_saver

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
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

func TestSaveAccountMovesBlueskyDIDBetweenPDSes(t *testing.T) {
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
				ProviderProjectID: instanceURL,
				ProviderSubject:   "did:plc:selfhostedexample000000",
				ExecutionMode:     "app_password",
				Evidence:          map[string]string{"pds_url": instanceURL},
			},
		})
		require.NoError(t, err)
		return account
	}

	first := save("https://old-pds.example/")
	moved := save("https://new-pds.example/")
	require.Equal(t, first.ID, moved.ID)
	require.Equal(t, first.OAuthGrantID, moved.OAuthGrantID)
	require.Equal(t, "https://new-pds.example", moved.InstanceURL)

	count, err := db.NewSelect().Model((*models.SocialAccount)(nil)).
		Where("workspace_id = ? AND platform = ?", "workspace-bluesky", "bluesky").Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)

	var grant models.OAuthGrant
	require.NoError(t, db.NewSelect().Model(&grant).Where("id = ?", moved.OAuthGrantID).Scan(t.Context()))
	require.Equal(t, "https://new-pds.example", grant.InstanceURL)
	require.Equal(t, "https://new-pds.example", grant.ProviderProjectID)
	require.JSONEq(t, `{"pds_url":"https://new-pds.example","source":"account_connection"}`, grant.AuthorizationEvidence)
}

func TestSaveAccountBackfillsLegacyBlueskyInstanceWithoutChangingIdentity(t *testing.T) {
	db := createTestDB(t)
	saver := NewAccountSaver(db, crypto.NewTokenEncryptor("test-secret-key-for-testing-only"))
	seedWorkspaceMember(t, db, "workspace-bluesky", "user-bluesky")
	now := time.Now().UTC()
	const did = "did:plc:legacybluesky0000000000"
	grant := &models.OAuthGrant{
		ID: "legacy-grant", WorkspaceID: "workspace-bluesky", Provider: "bluesky",
		ProviderProjectID: platform.BlueskyDefaultPDSURL, ProviderSubject: did,
		AccessTokenEnc: []byte("legacy"), TokenVersion: 1, ExecutionMode: "app_password",
		AuthorizationEvidence: `{}`, ValidationStatus: "valid", CreatedAt: now, UpdatedAt: now,
	}
	_, err := db.NewInsert().Model(grant).Exec(t.Context())
	require.NoError(t, err)
	legacy := &models.SocialAccount{
		ID: "legacy-account", WorkspaceID: "workspace-bluesky", Platform: "bluesky", AccountID: did,
		AccountUsername: "legacy.bsky.social", Slug: "bluesky-legacy", OAuthGrantID: grant.ID,
		AccessTokenEnc: []byte{}, IsActive: true, CreatedAt: now,
	}
	_, err = db.NewInsert().Model(legacy).Exec(t.Context())
	require.NoError(t, err)

	account, err := saver.SaveAccountFromInput(t.Context(), SaveAccountInput{
		Actor: accountSaverActor("user-bluesky"), UserID: "user-bluesky", PlatformName: "bluesky",
		WorkspaceID: "workspace-bluesky", AccountID: did, AccountUsername: "legacy.bsky.social",
		InstanceURL: platform.BlueskyDefaultPDSURL + "/",
		Token:       &platform.TokenResult{AccessToken: "new-access", RefreshToken: "new-refresh", ExpiresIn: 3600},
		Grant: AuthorizationGrantInput{
			ProviderProjectID: platform.BlueskyDefaultPDSURL, ProviderSubject: did,
			ExecutionMode: "app_password", Evidence: map[string]string{"pds_url": platform.BlueskyDefaultPDSURL},
		},
	})
	require.NoError(t, err)
	require.Equal(t, legacy.ID, account.ID)
	require.Equal(t, grant.ID, account.OAuthGrantID)
	require.Equal(t, platform.BlueskyDefaultPDSURL, account.InstanceURL)

	require.NoError(t, db.NewSelect().Model(grant).Where("id = ?", grant.ID).Scan(t.Context()))
	require.Equal(t, platform.BlueskyDefaultPDSURL, grant.InstanceURL)
}

type interleavedEntitlement struct {
	entitlements.Service
	beforeCheck func()
}

func (s *interleavedEntitlement) Check(ctx context.Context, req entitlements.Request) (entitlements.Decision, error) {
	if s.beforeCheck != nil {
		fn := s.beforeCheck
		s.beforeCheck = nil
		fn()
	}
	return s.Service.Check(ctx, req)
}
func TestSaveAccountRechecksQuotaAfterCompetingConnection(t *testing.T) {
	db := createTestDB(t)
	seedWorkspaceMember(t, db, "ws", "user")
	encryptor := crypto.NewTokenEncryptor("test")
	policy := &interleavedEntitlement{Service: entitlements.NewStaticService(entitlements.PlanSnapshot{PlanID: "limited", Limits: map[entitlements.LimitKey]int64{entitlements.LimitSocialAccounts: 1}})}
	saver := NewAccountSaver(db, encryptor, policy)
	policy.beforeCheck = func() {
		_, err := NewAccountSaver(db, encryptor).SaveAccount(t.Context(), accountSaverActor("user"), "x", "ws", "competitor", "competitor", "", &platform.TokenResult{AccessToken: "token"})
		require.NoError(t, err)
	}
	_, err := saver.SaveAccount(t.Context(), accountSaverActor("user"), "x", "ws", "late", "late", "", &platform.TokenResult{AccessToken: "token"})
	require.ErrorContains(t, err, "limit")
	count, err := db.NewSelect().Model((*models.SocialAccount)(nil)).Where("workspace_id = ? AND is_active = ?", "ws", true).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

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
	require.Equal(t, 1, deletionCount)
}

func TestYouTubeReconnectRestoresRetiredDestinationIdentity(t *testing.T) {
	db := createTestDB(t)
	seedWorkspaceMember(t, db, "youtube-reconnect", "youtube-user")
	digest := sha256.Sum256([]byte("youtube-reconnect" + "\x00" + "channel"))
	retired := &models.SocialAccount{ID: "original-destination", WorkspaceID: "youtube-reconnect", Slug: "retired", Platform: "youtube", AccountID: fmt.Sprintf("retired-youtube:%x", digest), AccessTokenEnc: []byte{}, IsActive: false}
	_, err := db.NewInsert().Model(retired).Exec(t.Context())
	require.NoError(t, err)
	saver := NewAccountSaver(db, crypto.NewTokenEncryptor("test-secret-key-for-testing-only"))
	restored, err := saver.SaveAccountFromInput(t.Context(), SaveAccountInput{Actor: accountSaverActor("youtube-user"), UserID: "youtube-user", WorkspaceID: "youtube-reconnect", PlatformName: "youtube", AccountID: "channel", AccountUsername: "Channel", ProfileFetchedAt: time.Now().UTC(), Token: &platform.TokenResult{AccessToken: "new-consent"}})
	require.NoError(t, err)
	require.Equal(t, retired.ID, restored.ID, "reconsent must restore the destination referenced by existing drafts")
	require.Equal(t, "channel", restored.AccountID)
	require.True(t, restored.IsActive)
}
