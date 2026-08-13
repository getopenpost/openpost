package identity

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type policyTestFixture struct {
	db        *bun.DB
	user      models.User
	workspace models.Workspace
	provider  models.IdentityProvider
	session   models.UserSession
}

func newPolicyTestFixture(t *testing.T) policyTestFixture {
	t.Helper()

	fake := newFakeOIDCIssuer(t)
	_, db := newIdentityTestService(t, fake)
	now := time.Now().UTC()
	fixture := policyTestFixture{
		db: db,
		user: models.User{
			ID: "policy-user", Email: "policy@example.com", PasswordHash: "hash", CreatedAt: now,
		},
		workspace: models.Workspace{
			ID: "policy-workspace", OrganizationID: "policy-org", Name: "Policy workspace", CreatedAt: now,
		},
		provider: models.IdentityProvider{
			ID: "policy-provider", OrganizationID: "policy-org", Source: "database",
			Issuer: "https://idp.example.com", Name: "Company SSO", ClientID: "client",
			Scopes: "openid profile email", EmailClaim: "email", NameClaim: "name",
			PictureClaim: "picture", IsActive: true, CreatedAt: now, UpdatedAt: now,
		},
		session: models.UserSession{
			ID: "policy-session", UserID: "policy-user", ExpiresAt: now.Add(24 * time.Hour),
			LastUsedAt: now, CreatedAt: now,
		},
	}
	organization := models.Organization{
		ID: "policy-org", Name: "Policy organization", CreatedByID: fixture.user.ID, CreatedAt: now, UpdatedAt: now,
	}
	member := models.OrganizationMember{
		OrganizationID: organization.ID, UserID: fixture.user.ID,
		Role: models.OrganizationRoleOwner, CreatedAt: now,
	}
	workspaceMember := models.WorkspaceMember{
		WorkspaceID: fixture.workspace.ID, UserID: fixture.user.ID, Role: models.WorkspaceRoleAdmin,
	}
	for _, row := range []any{
		&fixture.user, &organization, &member, &fixture.workspace, &workspaceMember,
		&fixture.provider, &fixture.session,
	} {
		_, err := db.NewInsert().Model(row).Exec(context.Background())
		require.NoError(t, err)
	}
	return fixture
}

func (f policyTestFixture) setPolicy(t *testing.T, tokenMode string) {
	t.Helper()
	now := time.Now().UTC()
	_, err := f.db.NewInsert().Model(&models.OrganizationSSOPolicy{
		OrganizationID: f.workspace.OrganizationID, Mode: models.OrganizationSSOModeRequired,
		ProviderIDs: `["policy-provider"]`, AssuranceMaxAgeSeconds: 3600,
		PasswordLoginAllowed: false, APITokenMode: tokenMode,
		MaxTokenLifetimeSeconds: 3600, RequireTokenReauth: true,
		UpdatedByUserID: f.user.ID, CreatedAt: now, UpdatedAt: now,
	}).Column(
		"organization_id",
		"mode",
		"provider_ids",
		"assurance_max_age_seconds",
		"password_login_allowed",
		"api_token_mode",
		"max_token_lifetime_seconds",
		"require_token_reauth",
		"updated_by_user_id",
		"created_at",
		"updated_at",
	).On("CONFLICT (organization_id) DO UPDATE").
		Set("mode = EXCLUDED.mode").
		Set("provider_ids = EXCLUDED.provider_ids").
		Set("assurance_max_age_seconds = EXCLUDED.assurance_max_age_seconds").
		Set("api_token_mode = EXCLUDED.api_token_mode").
		Exec(context.Background())
	require.NoError(t, err)
}

func (f policyTestFixture) setAssurance(t *testing.T, providerID string, authTime, expiresAt time.Time) {
	t.Helper()
	_, err := f.db.NewInsert().Model(&models.SessionIdentityAssurance{
		SessionID: f.session.ID, ProviderID: providerID, UserID: f.user.ID,
		AuthTime: authTime, ExpiresAt: expiresAt, AMR: `["mfa"]`, CreatedAt: authTime,
	}).On("CONFLICT (session_id, provider_id) DO UPDATE").
		Set("auth_time = EXCLUDED.auth_time").
		Set("expires_at = EXCLUDED.expires_at").
		Exec(context.Background())
	require.NoError(t, err)
}

func (f policyTestFixture) insertToken(
	t *testing.T,
	id, providerID, organizationID, workspaceID string,
	assuredAt time.Time,
) {
	t.Helper()
	_, err := f.db.NewInsert().Model(&models.APIToken{
		ID: id, UserID: f.user.ID, Name: id, TokenHash: "hash-" + id, TokenPrefix: id,
		Scope: "cli:full", WorkspaceID: workspaceID, OrganizationID: organizationID,
		IdentityProviderID: providerID, AssuredAt: assuredAt, CreatedAt: time.Now().UTC(),
	}).Exec(context.Background())
	require.NoError(t, err)
}

func TestEvaluateWorkspaceAccessAuthorizationMatrix(t *testing.T) {
	f := newPolicyTestFixture(t)
	ctx := context.Background()
	now := time.Now().UTC()

	decision, err := EvaluateWorkspaceAccess(ctx, f.db, f.workspace.ID, f.user.ID, f.session.ID, "")
	require.NoError(t, err)
	require.True(t, decision.Allowed)
	require.False(t, decision.SSORequired)

	f.setPolicy(t, models.OrganizationSSOTokensScoped)

	decision, err = EvaluateWorkspaceAccess(ctx, f.db, f.workspace.ID, f.user.ID, f.session.ID, "")
	require.NoError(t, err)
	require.False(t, decision.Allowed)
	require.True(t, decision.SSORequired)
	require.Equal(t, f.provider.ID, decision.ProviderID)

	f.setAssurance(t, f.provider.ID, now, now.Add(time.Hour))
	decision, err = EvaluateWorkspaceAccess(ctx, f.db, f.workspace.ID, f.user.ID, f.session.ID, "")
	require.NoError(t, err)
	require.True(t, decision.Allowed)

	f.setAssurance(t, f.provider.ID, now.Add(-2*time.Hour), now.Add(-time.Hour))
	decision, err = EvaluateWorkspaceAccess(ctx, f.db, f.workspace.ID, f.user.ID, f.session.ID, "")
	require.NoError(t, err)
	require.False(t, decision.Allowed)

	f.insertToken(t, "valid-token", f.provider.ID, f.workspace.OrganizationID, f.workspace.ID, now)
	decision, err = EvaluateWorkspaceAccess(ctx, f.db, f.workspace.ID, f.user.ID, "", "valid-token")
	require.NoError(t, err)
	require.True(t, decision.Allowed)

	f.insertToken(t, "unbound-token", "", "", f.workspace.ID, time.Time{})
	decision, err = EvaluateWorkspaceAccess(ctx, f.db, f.workspace.ID, f.user.ID, "", "unbound-token")
	require.NoError(t, err)
	require.False(t, decision.Allowed)

	f.insertToken(t, "wrong-workspace-token", f.provider.ID, f.workspace.OrganizationID, "another-workspace", now)
	decision, err = EvaluateWorkspaceAccess(ctx, f.db, f.workspace.ID, f.user.ID, "", "wrong-workspace-token")
	require.NoError(t, err)
	require.False(t, decision.Allowed)

	f.insertToken(t, "stale-token", f.provider.ID, f.workspace.OrganizationID, f.workspace.ID, now.Add(-2*time.Hour))
	decision, err = EvaluateWorkspaceAccess(ctx, f.db, f.workspace.ID, f.user.ID, "", "stale-token")
	require.NoError(t, err)
	require.False(t, decision.Allowed)

	f.setPolicy(t, models.OrganizationSSOTokensDeny)
	decision, err = EvaluateWorkspaceAccess(ctx, f.db, f.workspace.ID, f.user.ID, "", "valid-token")
	require.NoError(t, err)
	require.False(t, decision.Allowed)
}

func TestAuthorizeTokenCreationRequiresAndInheritsSSOAssurance(t *testing.T) {
	f := newPolicyTestFixture(t)
	f.setPolicy(t, models.OrganizationSSOTokensScoped)
	ctx := context.Background()

	_, err := AuthorizeTokenCreation(ctx, f.db, f.user.ID, f.session.ID, f.workspace.ID, time.Time{})
	require.ErrorIs(t, err, ErrReauthRequired)

	now := time.Now().UTC()
	f.setAssurance(t, f.provider.ID, now, now.Add(time.Hour))
	decision, err := AuthorizeTokenCreation(
		ctx, f.db, f.user.ID, f.session.ID, f.workspace.ID, now.Add(24*time.Hour),
	)
	require.NoError(t, err)
	require.True(t, decision.Allowed)
	require.Equal(t, f.workspace.OrganizationID, decision.OrganizationID)
	require.Equal(t, f.provider.ID, decision.ProviderID)
	require.WithinDuration(t, now, decision.AssuredAt, time.Second)
	require.WithinDuration(t, now.Add(time.Hour), decision.ExpiresAt, 2*time.Second)

	f.setPolicy(t, models.OrganizationSSOTokensDeny)
	_, err = AuthorizeTokenCreation(ctx, f.db, f.user.ID, f.session.ID, f.workspace.ID, time.Time{})
	require.ErrorIs(t, err, ErrTokenPolicyDenied)
}

func TestEvaluateOrganizationAccessRejectsWorkspaceBoundTokens(t *testing.T) {
	f := newPolicyTestFixture(t)
	ctx := context.Background()

	f.insertToken(t, "workspace-bound-token", "", "", f.workspace.ID, time.Time{})
	decision, err := EvaluateOrganizationAccess(
		ctx, f.db, f.workspace.OrganizationID, f.user.ID, "", "workspace-bound-token",
	)
	require.NoError(t, err)
	require.False(t, decision.Allowed)
	require.Contains(t, decision.Reason, "Workspace-bound")

	f.insertToken(t, "all-workspace-token", "", "", "", time.Time{})
	decision, err = EvaluateOrganizationAccess(
		ctx, f.db, f.workspace.OrganizationID, f.user.ID, "", "all-workspace-token",
	)
	require.NoError(t, err)
	require.True(t, decision.Allowed)
}

func TestEvaluateOrganizationAccessRequiresBrowserSSOAssurance(t *testing.T) {
	f := newPolicyTestFixture(t)
	f.setPolicy(t, models.OrganizationSSOTokensScoped)
	ctx := context.Background()
	now := time.Now().UTC()

	decision, err := EvaluateOrganizationAccess(
		ctx, f.db, f.workspace.OrganizationID, f.user.ID, f.session.ID, "",
	)
	require.NoError(t, err)
	require.False(t, decision.Allowed)
	require.True(t, decision.SSORequired)

	f.setAssurance(t, f.provider.ID, now, now.Add(time.Hour))
	decision, err = EvaluateOrganizationAccess(
		ctx, f.db, f.workspace.OrganizationID, f.user.ID, f.session.ID, "",
	)
	require.NoError(t, err)
	require.True(t, decision.Allowed)

	f.insertToken(t, "organization-token", f.provider.ID, f.workspace.OrganizationID, f.workspace.ID, now)
	decision, err = EvaluateOrganizationAccess(
		ctx, f.db, f.workspace.OrganizationID, f.user.ID, "", "organization-token",
	)
	require.NoError(t, err)
	require.False(t, decision.Allowed)
	require.Contains(t, decision.Reason, "Workspace-bound")

	f.insertToken(t, "personal-token", "", "", "", time.Time{})
	decision, err = EvaluateOrganizationAccess(
		ctx, f.db, f.workspace.OrganizationID, f.user.ID, "", "personal-token",
	)
	require.NoError(t, err)
	require.False(t, decision.Allowed)
}

func TestPasswordCredentialPolicyIsOrganizationScoped(t *testing.T) {
	f := newPolicyTestFixture(t)
	f.setPolicy(t, models.OrganizationSSOTokensScoped)
	policy, err := PolicyForOrganization(context.Background(), f.db, f.workspace.OrganizationID)
	require.NoError(t, err)
	require.Equal(t, models.OrganizationSSOModeRequired, policy.Mode)
	require.False(t, policy.PasswordLoginAllowed)

	allowed, err := PasswordCredentialAllowed(context.Background(), f.db, f.user.ID)
	require.NoError(t, err)
	require.False(t, allowed)

	now := time.Now().UTC()
	secondOrganization := models.Organization{
		ID: "personal-org", Name: "Personal", CreatedByID: f.user.ID, CreatedAt: now, UpdatedAt: now,
	}
	secondMembership := models.OrganizationMember{
		OrganizationID: secondOrganization.ID, UserID: f.user.ID,
		Role: models.OrganizationRoleOwner, CreatedAt: now,
	}
	_, err = f.db.NewInsert().Model(&secondOrganization).Exec(context.Background())
	require.NoError(t, err)
	_, err = f.db.NewInsert().Model(&secondMembership).Exec(context.Background())
	require.NoError(t, err)

	allowed, err = PasswordCredentialAllowed(context.Background(), f.db, f.user.ID)
	require.NoError(t, err)
	require.True(t, allowed)

	_, err = f.db.NewUpdate().Model((*models.User)(nil)).
		Set("is_break_glass = ?", true).Where("id = ?", f.user.ID).Exec(context.Background())
	require.NoError(t, err)
	allowed, err = PasswordCredentialAllowed(context.Background(), f.db, f.user.ID)
	require.NoError(t, err)
	require.True(t, allowed)
}

func TestValidatePolicyRequiresProviderForEnforcement(t *testing.T) {
	policy := DefaultPolicy("org")
	policy.Mode = models.OrganizationSSOModeRequired
	policy.ProviderIDs = nil

	require.Error(t, ValidatePolicy(policy))

	policy.ProviderIDs = []string{"provider"}
	require.NoError(t, ValidatePolicy(policy))
}

func TestPolicyFromModelNormalizesStoredAPITokenModes(t *testing.T) {
	for _, test := range []struct {
		name     string
		stored   string
		expected string
	}{
		{name: "retired allow", stored: "allow", expected: models.OrganizationSSOTokensScoped},
		{name: "scoped", stored: models.OrganizationSSOTokensScoped, expected: models.OrganizationSSOTokensScoped},
		{name: "deny", stored: models.OrganizationSSOTokensDeny, expected: models.OrganizationSSOTokensDeny},
		{name: "unknown fails closed", stored: "unexpected", expected: models.OrganizationSSOTokensDeny},
	} {
		t.Run(test.name, func(t *testing.T) {
			policy, err := policyFromModel(models.OrganizationSSOPolicy{
				OrganizationID: "org",
				ProviderIDs:    "[]",
				APITokenMode:   test.stored,
			})
			require.NoError(t, err)
			require.Equal(t, test.expected, policy.APITokenMode)
		})
	}
}

func TestValidatePolicyRejectsRetiredOrganizationWideTokenMode(t *testing.T) {
	policy := DefaultPolicy("org")
	policy.APITokenMode = "allow"

	_, err := NormalizePolicyInput(policy)
	require.ErrorContains(t, err, "invalid api token mode")

	policy.APITokenMode = models.OrganizationSSOTokensScoped
	require.NoError(t, ValidatePolicy(policy))
	policy.APITokenMode = models.OrganizationSSOTokensDeny
	require.NoError(t, ValidatePolicy(policy))
}

func TestNativeOIDCHandoffsArePurposeBoundAndOneTime(t *testing.T) {
	fake := newFakeOIDCIssuer(t)
	service, db := newIdentityTestService(t, fake)
	now := time.Now().UTC()
	user := &models.User{ID: "native-user", Email: "native@example.com", CreatedAt: now}
	session := &models.UserSession{
		ID: "native-session", UserID: user.ID, ExpiresAt: now.Add(time.Hour),
		LastUsedAt: now, CreatedAt: now,
	}
	_, err := db.NewInsert().Model(user).Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(session).Exec(context.Background())
	require.NoError(t, err)

	code, err := service.CreateNativeLoginHandoff(context.Background(), user.ID, session.ID, "jwt-value")
	require.NoError(t, err)
	result, err := service.ConsumeNativeHandoff(context.Background(), code)
	require.NoError(t, err)
	require.Equal(t, "login", result.Purpose)
	require.Equal(t, "jwt-value", result.Payload)
	_, err = service.ConsumeNativeHandoff(context.Background(), code)
	require.ErrorIs(t, err, ErrNativeHandoff)

	code, err = service.CreateNativeReauthHandoff(
		context.Background(), user.ID, session.ID, "account.export", "grant-value",
	)
	require.NoError(t, err)
	result, err = service.ConsumeNativeHandoff(context.Background(), code)
	require.NoError(t, err)
	require.Equal(t, "reauth", result.Purpose)
	require.Equal(t, "account.export", result.Action)
	require.Equal(t, "grant-value", result.Payload)
}

func TestListLinkableProvidersStaysWithinUserOrganizations(t *testing.T) {
	f := newPolicyTestFixture(t)
	now := time.Now().UTC()
	otherOrganization := &models.Organization{
		ID: "other-org", Name: "Other", CreatedByID: f.user.ID, CreatedAt: now, UpdatedAt: now,
	}
	otherProvider := &models.IdentityProvider{
		ID: "other-provider", OrganizationID: otherOrganization.ID, Source: "database",
		Issuer: "https://other.example.com", Name: "Other SSO", ClientID: "client",
		Scopes: "openid", EmailClaim: "email", NameClaim: "name", PictureClaim: "picture",
		IsActive: true, CreatedAt: now, UpdatedAt: now,
	}
	_, err := f.db.NewInsert().Model(otherOrganization).Exec(context.Background())
	require.NoError(t, err)
	_, err = f.db.NewInsert().Model(otherProvider).Exec(context.Background())
	require.NoError(t, err)

	service := NewService(f.db, nil, Config{})
	providers, err := service.ListLinkableProviders(context.Background(), f.user.ID)
	require.NoError(t, err)
	ids := make([]string, 0, len(providers))
	for _, provider := range providers {
		ids = append(ids, provider.ID)
	}
	require.Contains(t, ids, EnvironmentProviderID)
	require.Contains(t, ids, f.provider.ID)
	require.NotContains(t, ids, otherProvider.ID)
}

func TestUpsertProviderCannotMutateAnotherOrganizationProvider(t *testing.T) {
	f := newPolicyTestFixture(t)
	ctx := context.Background()
	now := time.Now().UTC()
	otherOrganization := &models.Organization{
		ID: "provider-owner-org", Name: "Provider owner", CreatedByID: f.user.ID,
		CreatedAt: now, UpdatedAt: now,
	}
	otherProvider := &models.IdentityProvider{
		ID: "provider-owned-elsewhere", OrganizationID: otherOrganization.ID, Source: "database",
		Issuer: "https://owner.example.com", Name: "Owner SSO", ClientID: "owner-client",
		Scopes: "openid", EmailClaim: "email", NameClaim: "name", PictureClaim: "picture",
		IsActive: true, CreatedAt: now, UpdatedAt: now,
	}
	_, err := f.db.NewInsert().Model(otherOrganization).Exec(ctx)
	require.NoError(t, err)
	_, err = f.db.NewInsert().Model(otherProvider).Exec(ctx)
	require.NoError(t, err)

	service := NewService(f.db, nil, Config{})
	_, err = service.UpsertProvider(ctx, ProviderUpsertInput{
		ID:             otherProvider.ID,
		OrganizationID: f.workspace.OrganizationID,
		Name:           "Attacker update",
		Issuer:         "https://attacker.example.com",
		ClientID:       "attacker-client",
		Scopes:         []string{"openid"},
		IsActive:       true,
		ActorUserID:    f.user.ID,
	})
	require.ErrorIs(t, err, ErrProviderNotFound)

	var stored models.IdentityProvider
	require.NoError(t, f.db.NewSelect().Model(&stored).Where("id = ?", otherProvider.ID).Scan(ctx))
	require.Equal(t, otherOrganization.ID, stored.OrganizationID)
	require.Equal(t, otherProvider.Issuer, stored.Issuer)
	require.Equal(t, otherProvider.ClientID, stored.ClientID)
}
