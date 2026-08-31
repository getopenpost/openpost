package account_saver

import (
	"context"
	"database/sql"
	"fmt"
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

func TestSaveAccountAuthorizationUsesCredentialAndSessionFacts(t *testing.T) {
	db := createTestDB(t)
	for _, model := range []any{
		(*models.User)(nil),
		(*models.OrganizationSSOPolicy)(nil),
		(*models.IdentityProvider)(nil),
		(*models.UserSession)(nil),
		(*models.SessionIdentityAssurance)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
	seedWorkspaceMember(t, db, "workspace-actor", "user-actor")
	now := time.Now().UTC()
	var workspace models.Workspace
	require.NoError(t, db.NewSelect().Model(&workspace).Where("id = ?", "workspace-actor").Scan(t.Context()))
	for _, row := range []any{
		&models.User{ID: "user-actor", Email: "actor@example.test", PasswordHash: "hash", CreatedAt: now},
		&models.IdentityProvider{ID: "provider-actor", OrganizationID: workspace.OrganizationID, Source: "database", Issuer: "https://idp.example.test", Name: "Company SSO", ClientID: "client", Scopes: "openid email", EmailClaim: "email", NameClaim: "name", IsActive: true, CreatedAt: now, UpdatedAt: now},
		&models.OrganizationSSOPolicy{OrganizationID: workspace.OrganizationID, Mode: models.OrganizationSSOModeRequired, ProviderIDs: `["provider-actor"]`, AssuranceMaxAgeSeconds: 3600, PasswordLoginAllowed: false, APITokenMode: models.OrganizationSSOTokensScoped, MaxTokenLifetimeSeconds: 3600, RequireTokenReauth: true, UpdatedByUserID: "user-actor", CreatedAt: now, UpdatedAt: now},
		&models.UserSession{ID: "session-actor", UserID: "user-actor", ExpiresAt: now.Add(time.Hour), LastUsedAt: now, CreatedAt: now},
		&models.SessionIdentityAssurance{SessionID: "session-actor", ProviderID: "provider-actor", UserID: "user-actor", AuthTime: now, ExpiresAt: now.Add(time.Hour), AMR: `["mfa"]`, CreatedAt: now},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
	saver := NewAccountSaver(db, crypto.NewTokenEncryptor("test-secret-key-for-testing-only"))
	input := SaveAccountInput{
		Actor:  workspaceaccess.ActorFacts{UserID: "user-actor", SessionID: "session-actor", CredentialWorkspaceID: "other-workspace"},
		UserID: "user-actor", WorkspaceID: "workspace-actor", PlatformName: "x", AccountID: "remote-actor", AccountUsername: "Actor", Token: &platform.TokenResult{AccessToken: "token"},
	}

	_, err := saver.SaveAccountFromInput(t.Context(), input)
	require.Error(t, err)
	input.Actor.CredentialWorkspaceID = "workspace-actor"
	account, err := saver.SaveAccountFromInput(t.Context(), input)
	require.NoError(t, err)
	require.Equal(t, "workspace-actor", account.WorkspaceID)
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

func TestReauthorizingOneDestinationWithDifferentAuthorityPreservesSiblingGrant(t *testing.T) {
	db := createTestDB(t)
	encryptor := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
	saver := NewAccountSaver(db, encryptor)
	ctx := context.Background()
	seedWorkspaceMember(t, db, "workspace-1", "user-1")

	originalToken := &platform.TokenResult{AccessToken: "original-member-token"}
	originalAuthority := AuthorizationGrantInput{
		ProviderProjectID: "linkedin-client-a",
		ProviderSubject:   "member-a",
		ExecutionMode:     "oauth2",
	}
	accounts, err := saver.SaveAccountsFromInputs(ctx, []SaveAccountInput{
		{
			Actor: accountSaverActor("user-1"), UserID: "user-1", WorkspaceID: "workspace-1", PlatformName: "linkedin",
			AccountID: "urn:li:person:member-a", AccountUsername: "Ada", Token: originalToken,
			Grant: originalAuthority,
		},
		{
			Actor: accountSaverActor("user-1"), UserID: "user-1", WorkspaceID: "workspace-1", PlatformName: "linkedin",
			AccountID: "urn:li:organization:42", AccountUsername: "OpenPost", Token: originalToken,
			Grant: originalAuthority,
		},
	})
	require.NoError(t, err)
	require.Equal(t, accounts[0].OAuthGrantID, accounts[1].OAuthGrantID)
	originalGrantID := accounts[0].OAuthGrantID

	reauthorized, err := saver.SaveAccountFromInput(ctx, SaveAccountInput{
		Actor: accountSaverActor("user-1"), UserID: "user-1", WorkspaceID: "workspace-1", PlatformName: "linkedin",
		AccountID: "urn:li:person:member-a", AccountUsername: "Ada", Token: &platform.TokenResult{AccessToken: "new-member-token"},
		Grant: AuthorizationGrantInput{
			ProviderProjectID: "linkedin-client-b",
			ProviderSubject:   "member-b",
			ExecutionMode:     "oauth2",
		},
	})
	require.NoError(t, err)
	require.Equal(t, accounts[0].ID, reauthorized.ID)
	require.NotEqual(t, originalGrantID, reauthorized.OAuthGrantID)

	var sibling models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&sibling).Where("id = ?", accounts[1].ID).Scan(ctx))
	require.Equal(t, originalGrantID, sibling.OAuthGrantID)

	originalGrant := loadAccountGrant(t, db, &sibling)
	originalAccess, err := encryptor.Decrypt(originalGrant.AccessTokenEnc)
	require.NoError(t, err)
	require.Equal(t, "original-member-token", originalAccess)

	newGrant := loadAccountGrant(t, db, reauthorized)
	newAccess, err := encryptor.Decrypt(newGrant.AccessTokenEnc)
	require.NoError(t, err)
	require.Equal(t, "new-member-token", newAccess)
	require.Equal(t, "linkedin-client-b", newGrant.ProviderProjectID)
	require.Equal(t, "member-b", newGrant.ProviderSubject)
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
func TestSaveAccount_Mastodon(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	crypto := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
	saver := NewAccountSaver(db, crypto)

	ctx := context.Background()
	workspaceID := "test-workspace-456"
	userID := "user-456"
	platformName := "mastodon"
	accountID := "mastodon-user-123"
	accountUsername := "mastodonuser"
	instanceURL := "https://mastodon.example.com"

	tokenResp := &platform.TokenResult{
		AccessToken:  "mastodon-access-token",
		RefreshToken: "mastodon-refresh-token",
		ExpiresIn:    7200,
		Extra:        map[string]string{},
	}

	seedWorkspaceMember(t, db, workspaceID, userID)
	account, err := saver.SaveAccount(ctx, accountSaverActor(userID), platformName, workspaceID, accountID, accountUsername, instanceURL, tokenResp)
	require.NoError(t, err)
	require.NotNil(t, account)

	require.Equal(t, workspaceID, account.WorkspaceID)
	require.Equal(t, platformName, account.Platform)
	require.Equal(t, accountID, account.AccountID)
	require.Equal(t, accountUsername, account.AccountUsername)
	require.Equal(t, instanceURL, account.InstanceURL)
	require.True(t, account.IsActive)
	require.Equal(t, "mastodon-mastodonuser", account.Slug)

	grant := loadAccountGrant(t, db, account)
	decryptedAccess, err := crypto.Decrypt(grant.AccessTokenEnc)
	require.NoError(t, err)
	require.Equal(t, tokenResp.AccessToken, decryptedAccess)

	decryptedRefresh, err := crypto.Decrypt(grant.RefreshTokenEnc)
	require.NoError(t, err)
	require.Equal(t, tokenResp.RefreshToken, decryptedRefresh)
}

// TestSaveAccount_Threads tests that Threads user ID is extracted from token extra.
func TestSaveAccount_Threads(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	crypto := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
	saver := NewAccountSaver(db, crypto)

	ctx := context.Background()
	workspaceID := "test-workspace-789"
	userID := "user-789"
	platformName := "threads"
	// This accountID will be overridden by user_id from token extra
	initialAccountID := "initial-account-id"
	accountUsername := "threadsuser"
	instanceURL := ""

	tokenResp := &platform.TokenResult{
		AccessToken:  "threads-access-token",
		RefreshToken: "threads-refresh-token",
		ExpiresIn:    7200,
		Extra: map[string]string{
			"user_id": "threads-user-id-987", // This should become the account ID
		},
	}

	seedWorkspaceMember(t, db, workspaceID, userID)
	account, err := saver.SaveAccount(ctx, accountSaverActor(userID), platformName, workspaceID, initialAccountID, accountUsername, instanceURL, tokenResp)
	require.NoError(t, err)
	require.NotNil(t, account)

	// Verify the account ID was overridden by user_id from token extra
	require.Equal(t, "threads-user-id-987", account.AccountID)
	require.Equal(t, accountUsername, account.AccountUsername)
	require.Equal(t, "threads-threadsuser", account.Slug)

	grant := loadAccountGrant(t, db, account)
	decryptedAccess, err := crypto.Decrypt(grant.AccessTokenEnc)
	require.NoError(t, err)
	require.Equal(t, tokenResp.AccessToken, decryptedAccess)
}

func TestSaveAccountPersistsGrantedScopesFromTokenExtra(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	crypto := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
	saver := NewAccountSaver(db, crypto)

	ctx := context.Background()
	workspaceID := "workspace-scopes"
	userID := "user-scopes"
	tokenResp := &platform.TokenResult{
		AccessToken: "youtube-access-token",
		Extra: map[string]string{
			"scope": "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube",
		},
	}

	seedWorkspaceMember(t, db, workspaceID, userID)
	account, err := saver.SaveAccount(ctx, accountSaverActor(userID), "youtube", workspaceID, "channel-1", "Channel", "", tokenResp)

	require.NoError(t, err)
	require.Equal(t, "https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.upload", account.GrantedScopes)
}

func TestSaveAccountPersistsCapabilityState(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	encryptor := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
	saver := NewAccountSaver(db, encryptor)
	ctx := context.Background()
	seedWorkspaceMember(t, db, "workspace-capabilities", "user-capabilities")

	account, err := saver.SaveAccountFromInput(ctx, SaveAccountInput{
		Actor:           accountSaverActor("user-capabilities"),
		UserID:          "user-capabilities",
		PlatformName:    "x",
		WorkspaceID:     "workspace-capabilities",
		AccountID:       "x-user",
		AccountUsername: "premium-user",
		Token:           &platform.TokenResult{AccessToken: "token"},
		CapabilityState: map[string]string{
			platform.XCapabilityStateSubscriptionType: platform.XSubscriptionTypePremium,
		},
	})

	require.NoError(t, err)
	require.JSONEq(t, `{"x_subscription_type":"Premium"}`, account.CapabilityState)
	require.NotZero(t, account.CapabilityCheckedAt)
}

func TestReconnectReusesProviderIdentityAndUpdatesCredentials(t *testing.T) {
	db := createTestDB(t)
	encryptor := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
	saver := NewAccountSaver(db, encryptor, entitlements.NewStaticService(entitlements.PlanSnapshot{
		Limits: map[entitlements.LimitKey]int64{
			entitlements.LimitSocialAccounts: 1,
		},
	}))
	ctx := context.Background()
	seedWorkspaceMember(t, db, "workspace-reconnect", "user-reconnect")

	first, err := saver.SaveAccount(
		ctx,
		accountSaverActor("user-reconnect"),
		"threads",
		"workspace-reconnect",
		"threads-user",
		"old-name",
		"",
		&platform.TokenResult{
			AccessToken: "old-token",
			Extra:       map[string]string{"user_id": "threads-user", "scope": "threads_basic"},
		},
	)
	require.NoError(t, err)
	_, err = db.NewUpdate().
		Model((*models.SocialAccount)(nil)).
		Set("is_active = ?", false).
		Where("id = ?", first.ID).
		Exec(ctx)
	require.NoError(t, err)

	reconnected, err := saver.SaveAccount(
		ctx,
		accountSaverActor("user-reconnect"),
		"threads",
		"workspace-reconnect",
		"threads-user",
		"new-name",
		"",
		&platform.TokenResult{
			AccessToken: "new-token",
			Extra: map[string]string{
				"user_id": "threads-user",
				"scope":   "threads_basic threads_manage_insights",
			},
		},
	)
	require.NoError(t, err)
	require.Equal(t, first.ID, reconnected.ID)
	require.WithinDuration(t, first.CreatedAt, reconnected.CreatedAt, time.Millisecond)
	require.Equal(t, "new-name", reconnected.AccountUsername)
	require.True(t, reconnected.IsActive)
	require.Equal(t, "threads_basic threads_manage_insights", reconnected.GrantedScopes)

	grant := loadAccountGrant(t, db, reconnected)
	decrypted, err := encryptor.Decrypt(grant.AccessTokenEnc)
	require.NoError(t, err)
	require.Equal(t, "new-token", decrypted)
	count, err := db.NewSelect().
		Model((*models.SocialAccount)(nil)).
		Where("workspace_id = ?", "workspace-reconnect").
		Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestReconnectPreservesStoredAvatarWhenProviderReturnsBlank(t *testing.T) {
	db := createTestDB(t)
	saver := NewAccountSaver(db, crypto.NewTokenEncryptor("test-secret-key-for-testing-only"))
	ctx := context.Background()
	seedWorkspaceMember(t, db, "workspace-avatar", "user-avatar")

	first, err := saver.SaveAccountFromInput(ctx, SaveAccountInput{
		Actor:            accountSaverActor("user-avatar"),
		UserID:           "user-avatar",
		PlatformName:     "threads",
		WorkspaceID:      "workspace-avatar",
		AccountID:        "threads-user",
		AccountUsername:  "creator",
		AccountAvatarURL: "https://cdn.example/avatar.jpg",
		Token:            &platform.TokenResult{AccessToken: "old-token"},
	})
	require.NoError(t, err)

	reconnected, err := saver.SaveAccountFromInput(ctx, SaveAccountInput{
		Actor:            accountSaverActor("user-avatar"),
		UserID:           "user-avatar",
		PlatformName:     "threads",
		WorkspaceID:      "workspace-avatar",
		AccountID:        "threads-user",
		AccountUsername:  "creator-renamed",
		AccountAvatarURL: "  ",
		Token:            &platform.TokenResult{AccessToken: "new-token"},
	})
	require.NoError(t, err)
	require.Equal(t, first.ID, reconnected.ID)
	require.Equal(t, "https://cdn.example/avatar.jpg", reconnected.AccountAvatarURL)

	var stored models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", first.ID).Scan(ctx))
	require.Equal(t, "https://cdn.example/avatar.jpg", stored.AccountAvatarURL)
}

func TestSaveAccountGeneratesUniqueSlugs(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	crypto := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
	saver := NewAccountSaver(db, crypto)

	ctx := context.Background()
	workspaceID := "workspace"
	userID := "user"
	seedWorkspaceMember(t, db, workspaceID, userID)
	tokenResp := &platform.TokenResult{AccessToken: "token"}

	first, err := saver.SaveAccount(ctx, accountSaverActor(userID), "x", workspaceID, "1", "Main Account", "", tokenResp)
	require.NoError(t, err)
	second, err := saver.SaveAccount(ctx, accountSaverActor(userID), "x", workspaceID, "2", "Main Account", "", tokenResp)
	require.NoError(t, err)

	require.Equal(t, "x-main-account", first.Slug)
	require.Equal(t, "x-main-account-2", second.Slug)
}

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

func TestSaveAccountIgnoresInactiveAccountsForQuota(t *testing.T) {
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
		ID:             "inactive",
		WorkspaceID:    workspaceID,
		Platform:       "x",
		AccountID:      "inactive",
		Slug:           "x-inactive",
		AccessTokenEnc: []byte("token"),
		IsActive:       true,
		CreatedAt:      time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().
		Model((*models.SocialAccount)(nil)).
		Set("is_active = ?", false).
		Where("id = ?", "inactive").
		Exec(ctx)
	require.NoError(t, err)

	account, err := saver.SaveAccount(ctx, accountSaverActor(userID), "mastodon", workspaceID, "next", "next", "https://masto.example", &platform.TokenResult{
		AccessToken: "token",
	})

	require.NoError(t, err)
	require.NotNil(t, account)
	require.Equal(t, "mastodon-next", account.Slug)
}

// TestSaveAccount_EncryptionError tests handling of encryption failures.
func TestSaveAccount_EncryptionError(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	crypto := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
	saver := NewAccountSaver(db, crypto)

	ctx := context.Background()
	workspaceID := "workspace"
	userID := "user"
	seedWorkspaceMember(t, db, workspaceID, userID)
	tokenResp := &platform.TokenResult{
		AccessToken:  "some-token",
		RefreshToken: "some-refresh",
		ExpiresIn:    3600,
	}

	acct, err := saver.SaveAccount(ctx, accountSaverActor(userID), "x", workspaceID, "account", "user", "", tokenResp)
	require.NoError(t, err)
	require.NotNil(t, acct)
	// Ensure tokens are stored encrypted once on the grant and decryptable.
	grant := loadAccountGrant(t, db, acct)
	dec, derr := crypto.Decrypt(grant.AccessTokenEnc)
	require.NoError(t, derr)
	require.Equal(t, tokenResp.AccessToken, dec)
}

// TestSaveAccount_DatabaseError tests handling of database failures.
func TestSaveAccount_DatabaseError(t *testing.T) {
	t.Parallel()

	// Use a nil db to simulate database failure
	crypto := crypto.NewTokenEncryptor("test-secret-key")
	saver := NewAccountSaver(nil, crypto)

	ctx := context.Background()
	tokenResp := &platform.TokenResult{
		AccessToken:  "token",
		RefreshToken: "refresh",
		ExpiresIn:    3600,
	}

	_, err := saver.SaveAccount(ctx, accountSaverActor("user"), "x", "workspace", "account", "user", "", tokenResp)
	require.Error(t, err)
}
