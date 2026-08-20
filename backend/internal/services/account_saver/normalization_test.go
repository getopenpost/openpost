package account_saver

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
)

func TestIsNewlyInsertedDistinguishesInsertedVsReactivatedVsActive(t *testing.T) {
	t.Parallel()
	db := createTestDB(t)
	enc := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
	saver := NewAccountSaver(db, enc)
	ctx := context.Background()
	workspaceID := "ws-norm-1"
	userID := "user-norm-1"
	seedWorkspaceMember(t, db, workspaceID, userID)
	actor := workspaceaccess.ActorFacts{UserID: userID}

	// Inserted
	acc1, err := saver.SaveAccount(ctx, actor, "threads", workspaceID, "remote-1", "alice", "", &platform.TokenResult{AccessToken: "tok1"})
	require.NoError(t, err)
	require.True(t, acc1.IsNewlyInserted, "genuinely inserted row must be marked new")
	require.Equal(t, workspaceID, acc1.WorkspaceID)

	// Reactivated: deactivate then save same identity
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("is_active = ?", false).Where("id = ?", acc1.ID).Exec(ctx)
	require.NoError(t, err)
	accReactivated, err := saver.SaveAccount(ctx, actor, "threads", workspaceID, "remote-1", "alice", "", &platform.TokenResult{AccessToken: "tok2"})
	require.NoError(t, err)
	require.Equal(t, acc1.ID, accReactivated.ID)
	require.False(t, accReactivated.IsNewlyInserted, "reactivated row must not be considered new")
	require.True(t, accReactivated.IsActive)

	// Active reauth: save same active identity again
	accReauth, err := saver.SaveAccount(ctx, actor, "threads", workspaceID, "remote-1", "alice", "", &platform.TokenResult{AccessToken: "tok3"})
	require.NoError(t, err)
	require.Equal(t, acc1.ID, accReauth.ID)
	require.False(t, accReauth.IsNewlyInserted, "active reauth must not be considered new")
}

func TestSharedGrantsDoNotEraseAccountLevelState(t *testing.T) {
	t.Parallel()
	db := createTestDB(t)
	enc := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
	saver := NewAccountSaver(db, enc)
	ctx := context.Background()
	workspaceID := "ws-shared"
	userID := "user-shared"
	seedWorkspaceMember(t, db, workspaceID, userID)
	actor := workspaceaccess.ActorFacts{UserID: userID}
	token := &platform.TokenResult{AccessToken: "member-token", Extra: map[string]string{"user_id": "member-1"}}

	accounts, err := saver.SaveAccountsFromInputs(ctx, []SaveAccountInput{
		{Actor: actor, UserID: userID, WorkspaceID: workspaceID, PlatformName: "linkedin", AccountID: "urn:li:person:member-1", AccountUsername: "Alice", Token: token, CapabilityState: map[string]string{"linkedin_account_type": "person"}},
		{Actor: actor, UserID: userID, WorkspaceID: workspaceID, PlatformName: "linkedin", AccountID: "urn:li:organization:42", AccountUsername: "OpenPost", Token: token, CapabilityState: map[string]string{"linkedin_account_type": "organization"}},
	})
	require.NoError(t, err)
	require.Len(t, accounts, 2)
	require.True(t, accounts[0].IsNewlyInserted)
	require.True(t, accounts[1].IsNewlyInserted)
	require.Equal(t, accounts[0].OAuthGrantID, accounts[1].OAuthGrantID, "shared grant must be same")
	require.NotEqual(t, accounts[0].ID, accounts[1].ID)
	require.NotEqual(t, accounts[0].Slug, accounts[1].Slug)

	// Reauthorizing one must not change sibling grant
	reauth, err := saver.SaveAccountFromInput(ctx, SaveAccountInput{
		Actor: actor, UserID: userID, PlatformName: "linkedin", WorkspaceID: workspaceID, AccountID: "urn:li:person:member-1", AccountUsername: "Alice", Token: &platform.TokenResult{AccessToken: "new-token"}, Grant: AuthorizationGrantInput{ProviderProjectID: "proj-b", ProviderSubject: "member-b"},
	})
	require.NoError(t, err)
	require.Equal(t, accounts[0].ID, reauth.ID)
	require.NotEqual(t, accounts[0].OAuthGrantID, reauth.OAuthGrantID)
	var sibling models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&sibling).Where("id = ?", accounts[1].ID).Scan(ctx))
	require.Equal(t, accounts[1].OAuthGrantID, sibling.OAuthGrantID, "sibling grant must be preserved")
}

func TestFirstDestinationInvariant(t *testing.T) {
	t.Parallel()
	db := createTestDB(t)
	enc := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
	saver := NewAccountSaver(db, enc)
	ctx := context.Background()
	ws := "ws-first"
	user := "user-first"
	seedWorkspaceMember(t, db, ws, user)
	actor := workspaceaccess.ActorFacts{UserID: user}

	// First connection claims first
	acc1, err := saver.SaveAccount(ctx, actor, "threads", ws, "remote-1", "alice", "", &platform.TokenResult{AccessToken: "t1"})
	require.NoError(t, err)
	require.True(t, acc1.ClaimedFirst)
	require.True(t, acc1.IsNewlyInserted)

	// Second new account does NOT claim first, but IsNewlyInserted true
	acc2, err := saver.SaveAccount(ctx, actor, "threads", ws, "remote-2", "bob", "", &platform.TokenResult{AccessToken: "t2"})
	require.NoError(t, err)
	require.False(t, acc2.ClaimedFirst, "only first destination claims composer")
	require.True(t, acc2.IsNewlyInserted, "second account is still genuinely new even though not first")

	// Reactivated first account should not claim again, but IsNewlyInserted false
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("is_active = ?", false).Where("id = ?", acc1.ID).Exec(ctx)
	require.NoError(t, err)
	acc1Reactivated, err := saver.SaveAccount(ctx, actor, "threads", ws, "remote-1", "alice", "", &platform.TokenResult{AccessToken: "t3"})
	require.NoError(t, err)
	require.False(t, acc1Reactivated.IsNewlyInserted)
	// ClaimedFirst for reactivation should be false because workspace already has first
	require.False(t, acc1Reactivated.ClaimedFirst)
}

func TestAtomicMultiAccountSave(t *testing.T) {
	t.Parallel()
	db := createTestDB(t)
	enc := crypto.NewTokenEncryptor("test-secret-key-for-testing-only")
	saver := NewAccountSaver(db, enc)
	ctx := context.Background()
	ws := "ws-atomic"
	user := "user-atomic"
	seedWorkspaceMember(t, db, ws, user)
	actor := workspaceaccess.ActorFacts{UserID: user}
	token := &platform.TokenResult{AccessToken: "tok"}

	// Attempt with duplicate identity should fail and write nothing
	_, err := saver.SaveAccountsFromInputs(ctx, []SaveAccountInput{
		{Actor: actor, UserID: user, WorkspaceID: ws, PlatformName: "linkedin", AccountID: "dup", AccountUsername: "One", Token: token},
		{Actor: actor, UserID: user, WorkspaceID: ws, PlatformName: "linkedin", AccountID: "dup", AccountUsername: "Two", Token: token},
	})
	require.Error(t, err)
	count, _ := db.NewSelect().Model((*models.SocialAccount)(nil)).Where("workspace_id = ?", ws).Count(ctx)
	require.Equal(t, 0, count, "atomic save must roll back all")

	// Valid multi save
	accounts, err := saver.SaveAccountsFromInputs(ctx, []SaveAccountInput{
		{Actor: actor, UserID: user, WorkspaceID: ws, PlatformName: "linkedin", AccountID: "urn:li:person:1", AccountUsername: "Alice", Token: token},
		{Actor: actor, UserID: user, WorkspaceID: ws, PlatformName: "linkedin", AccountID: "urn:li:organization:42", AccountUsername: "OpenPost", Token: token},
	})
	require.NoError(t, err)
	require.Len(t, accounts, 2)
	require.True(t, accounts[0].IsNewlyInserted)
	require.True(t, accounts[1].IsNewlyInserted)
	_ = time.Now()
}
