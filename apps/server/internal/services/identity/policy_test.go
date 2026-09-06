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

func TestEvaluateWorkspaceAccessUsesPerWorkspaceExternalApplicationAssurance(t *testing.T) {
	f := newPolicyTestFixture(t)
	f.setPolicy(t, models.OrganizationSSOTokensScoped)
	ctx := context.Background()
	now := time.Now().UTC()

	_, err := f.db.NewCreateTable().Model((*models.ExternalAppWorkspaceGrant)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	_, err = f.db.NewInsert().Model(&models.ExternalApplication{
		ID: "external-app", ClientID: "external-client", Name: "External app", ClientType: "public",
		RedirectURIsJSON: `[]`, AllowedScopes: "workspace:read", CreatedByUserID: f.user.ID, CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = f.db.NewInsert().Model(&models.ExternalAppInstallation{
		ID: "installation-1", ApplicationID: "external-app", SponsorUserID: f.user.ID,
		Scopes: "workspace:read", TokenFamilyID: "family-1", CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = f.db.NewInsert().Model(&models.APIToken{
		ID: "external-token", UserID: f.user.ID, Name: "External app", TokenHash: "external-hash",
		TokenPrefix: "external-prefix", Scope: "external:delegated", InstallationID: "installation-1", CreatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	grant := models.ExternalAppWorkspaceGrant{
		InstallationID: "installation-1", WorkspaceID: f.workspace.ID,
		OrganizationID: f.workspace.OrganizationID, IdentityProviderID: f.provider.ID,
		AssuredAt: now, CredentialExpiresAt: now.Add(time.Hour), CreatedAt: now, UpdatedAt: now,
	}
	_, err = f.db.NewInsert().Model(&grant).Exec(ctx)
	require.NoError(t, err)

	decision, err := EvaluateWorkspaceAccess(ctx, f.db, f.workspace.ID, f.user.ID, "", "external-token")
	require.NoError(t, err)
	require.True(t, decision.Allowed)

	_, err = f.db.NewUpdate().Model((*models.ExternalAppWorkspaceGrant)(nil)).
		Set("credential_expires_at = ?", now.Add(-time.Minute)).Where("installation_id = ?", grant.InstallationID).Exec(ctx)
	require.NoError(t, err)
	decision, err = EvaluateWorkspaceAccess(ctx, f.db, f.workspace.ID, f.user.ID, "", "external-token")
	require.NoError(t, err)
	require.False(t, decision.Allowed)
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

	f.insertToken(t, "other-organization-token", "", "other-org", "", time.Time{})
	decision, err = EvaluateOrganizationAccess(
		ctx, f.db, f.workspace.OrganizationID, f.user.ID, "", "other-organization-token",
	)
	require.NoError(t, err)
	require.False(t, decision.Allowed, "an Organization-bound token must not cross into another Organization when SSO is optional")
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
