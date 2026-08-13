package providerreadiness

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
)

func TestAppFingerprintTracksIdentityButNotSecretRotation(t *testing.T) {
	t.Parallel()
	app := platform.AppConfig{
		Provider: "x", ClientID: "client-1", ClientSecret: "secret-1",
		RedirectURI: "https://app.example.test/api/v1/accounts/x/callback",
	}
	want, err := AppFingerprint(app)
	if err != nil {
		t.Fatal(err)
	}
	app.ClientSecret = "secret-2"
	got, err := AppFingerprint(app)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("secret rotation changed app fingerprint: %q != %q", got, want)
	}
	app.ClientID = "client-2"
	got, err = AppFingerprint(app)
	if err != nil {
		t.Fatal(err)
	}
	if got == want {
		t.Fatalf("provider app identity change retained fingerprint %q", got)
	}
}

func TestConfigurationCatalogUsesRuntimePrecedenceAndExactInstance(t *testing.T) {
	t.Parallel()
	databaseApp := platform.AppConfig{Provider: "mastodon", ClientID: "db", RedirectURI: "urn:ietf:wg:oauth:2.0:oob", InstanceURL: "https://social.example"}
	environmentApp := databaseApp
	environmentApp.ClientID = "environment"
	catalog, err := NewConfigurationCatalog(
		RuntimeApps([]platform.AppConfig{databaseApp}, ConfigurationSourceDatabase, ProviderEnvironmentProduction),
		RuntimeApps([]platform.AppConfig{environmentApp}, ConfigurationSourceEnvironment, ProviderEnvironmentProduction),
	)
	if err != nil {
		t.Fatal(err)
	}
	configured := catalog.Resolve("mastodon", "https://social.example/", ProviderEnvironmentProduction)
	if configured.Evidence.State != ConfigurationStateConfigured || configured.Evidence.Source != ConfigurationSourceEnvironment {
		t.Fatalf("unexpected configured state: %#v", configured)
	}
	wantFingerprint, err := AppFingerprint(environmentApp)
	if err != nil {
		t.Fatal(err)
	}
	if configured.AppFingerprint != wantFingerprint {
		t.Fatalf("app fingerprint = %q, want %q", configured.AppFingerprint, wantFingerprint)
	}
	missing := catalog.Resolve("mastodon", "https://other.example", ProviderEnvironmentProduction)
	if missing.Evidence.State != ConfigurationStateMissing || missing.AppFingerprint == "" || missing.InstanceFingerprint == "" {
		t.Fatalf("missing exact instance did not retain a valid blocked subject: %#v", missing)
	}
}

func TestManagedAndSelfHostedPublicationContractsHaveDifferentEvidenceGates(t *testing.T) {
	t.Parallel()
	capability := capabilities.Resolve("x", capabilities.ResolveInput{CreationPreset: "post"}).Capability
	managed, err := PublicationContract(capability, OperationPublishImmediate, true, "standard", "x.standard")
	if err != nil {
		t.Fatal(err)
	}
	if !managed.Requirements.RequireLiveEvidence || !managed.Requirements.RequireApproval || !managed.Requirements.RequireProductionDeployment {
		t.Fatalf("managed contract omitted release evidence: %#v", managed.Requirements)
	}
	selfHosted, err := PublicationContract(capability, OperationPublishImmediate, false, "standard", "x.standard")
	if err != nil {
		t.Fatal(err)
	}
	if selfHosted.Requirements.RequireLiveEvidence || selfHosted.Requirements.RequireApproval || selfHosted.Requirements.RequireProductionDeployment {
		t.Fatalf("self-hosted contract inherited managed public-claim gates: %#v", selfHosted.Requirements)
	}
	if !selfHosted.Requirements.RequireConfiguration || !selfHosted.Requirements.RequireAuthorization {
		t.Fatalf("self-hosted contract lost runtime safety gates: %#v", selfHosted.Requirements)
	}
}

func TestPublicationContractBindsTheExactPolicyMode(t *testing.T) {
	t.Parallel()
	capability, ok := capabilities.FindOutput(capabilities.ProviderTikTok, "tiktok.video")
	if !ok {
		t.Fatal("TikTok video capability is missing")
	}
	direct, err := PublicationContract(capability, OperationPublishImmediate, true, "standard", "tiktok.direct_post.public_to_everyone")
	if err != nil {
		t.Fatal(err)
	}
	inbox, err := PublicationContract(capability, OperationPublishImmediate, true, "standard", "tiktok.upload")
	if err != nil {
		t.Fatal(err)
	}
	directDigest, err := direct.Digest()
	if err != nil {
		t.Fatal(err)
	}
	inboxDigest, err := inbox.Digest()
	if err != nil {
		t.Fatal(err)
	}
	if directDigest == inboxDigest || !strings.HasPrefix(directDigest, "sha256:") {
		t.Fatalf("policy modes share a certification contract: %q == %q", directDigest, inboxDigest)
	}
}

func TestPublicationPolicyAndScopesAreExactToAccountAndDeliveryMode(t *testing.T) {
	t.Parallel()
	tiktok, ok := capabilities.FindOutput(capabilities.ProviderTikTok, "tiktok.video")
	if !ok {
		t.Fatal("TikTok video capability is missing")
	}
	account := models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: capabilities.ProviderTikTok,
	}
	directMode := PublicationPolicyMode(account, tiktok, map[string]any{
		"content_posting_method": "DIRECT_POST", "privacy_level": "PUBLIC_TO_EVERYONE",
	})
	uploadMode := PublicationPolicyMode(account, tiktok, map[string]any{"content_posting_method": "UPLOAD"})
	if directMode == uploadMode {
		t.Fatalf("TikTok direct and upload modes collapsed into %q", directMode)
	}
	directScopes := RequiredScopesForSubject(Subject{
		Provider: capabilities.ProviderTikTok, AccountKind: "standard", OutputProfile: tiktok.OutputProfile,
		Operation: OperationPublishImmediate, PolicyMode: directMode,
	})
	uploadScopes := RequiredScopesForSubject(Subject{
		Provider: capabilities.ProviderTikTok, AccountKind: "standard", OutputProfile: tiktok.OutputProfile,
		Operation: OperationPublishImmediate, PolicyMode: uploadMode,
	})
	if sameStringSet(directScopes, uploadScopes) || !slices.Contains(directScopes, "video.publish") ||
		!slices.Contains(uploadScopes, "video.upload") {
		t.Fatalf("TikTok policy scopes are not exact: direct=%v upload=%v", directScopes, uploadScopes)
	}

	person := RequiredScopesForSubject(Subject{
		Provider: capabilities.ProviderLinkedIn, AccountKind: "person", OutputProfile: "linkedin.post",
		Operation: OperationPublishImmediate, PolicyMode: "linkedin.person",
	})
	organization := RequiredScopesForSubject(Subject{
		Provider: capabilities.ProviderLinkedIn, AccountKind: "organization", OutputProfile: "linkedin.post",
		Operation: OperationPublishImmediate, PolicyMode: "linkedin.organization",
	})
	if sameStringSet(person, organization) || !slices.Contains(person, "w_member_social") ||
		!slices.Contains(organization, "w_organization_social") {
		t.Fatalf("LinkedIn account scopes are not exact: person=%v organization=%v", person, organization)
	}
}

func TestAuthorizationForAccountUsesCanonicalGrantState(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.August, 9, 12, 0, 0, 0, time.UTC)
	account := models.SocialAccount{IsActive: true, GrantedScopes: "stale.scope"}
	grant := &models.OAuthGrant{
		ID: "grant-1", ValidationStatus: "valid", ValidatedAt: now.Add(-time.Hour),
		GrantedScopes: "users.read tweet.write", AccessTokenExpiresAt: now.Add(time.Hour),
	}
	evidence := AuthorizationForAccount(account, grant, now)
	if evidence.State != AuthorizationStateValid || len(evidence.GrantedScopes) != 2 || evidence.GrantedScopes[0] != "tweet.write" {
		t.Fatalf("unexpected authorization evidence: %#v", evidence)
	}
	grant.ValidationStatus = "legacy_unverified"
	evidence = AuthorizationForAccount(account, grant, now)
	if evidence.State != AuthorizationStateReconnectRequired || evidence.ReasonCode != "grant_unverified" {
		t.Fatalf("unverified grant did not fail closed: %#v", evidence)
	}
}

func TestAccountReferenceHashIsStableAndDoesNotExposeIdentity(t *testing.T) {
	t.Parallel()
	account := models.SocialAccount{
		ID: "internal-account-123", WorkspaceID: "private-workspace-456", Platform: capabilities.ProviderX,
		AccountID: "provider-account", AccountUsername: "private-handle",
	}
	first, err := AccountReferenceHash(account)
	if err != nil {
		t.Fatal(err)
	}
	second, err := AccountReferenceHash(account)
	if err != nil {
		t.Fatal(err)
	}
	if first != second || !strings.HasPrefix(first, "sha256:") {
		t.Fatalf("account reference is not a stable digest: %q %q", first, second)
	}
	for _, raw := range []string{account.ID, account.WorkspaceID, account.AccountID, account.AccountUsername} {
		if strings.Contains(first, raw) {
			t.Fatalf("account reference leaked %q", raw)
		}
	}
	other := account
	other.ID = "internal-account-789"
	otherHash, err := AccountReferenceHash(other)
	if err != nil {
		t.Fatal(err)
	}
	if otherHash == first {
		t.Fatal("different accounts shared one account reference")
	}
}
