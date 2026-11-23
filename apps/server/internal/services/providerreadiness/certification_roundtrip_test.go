package providerreadiness

import (
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
)

func TestCertificationRoundTrip(t *testing.T) {
	t.Parallel()
	deployments := []struct {
		name                string
		managedProduction   bool
		providerEnvironment ProviderEnvironment
	}{
		{name: "managed", managedProduction: true, providerEnvironment: ProviderEnvironmentProduction},
		{name: "self-hosted", managedProduction: false, providerEnvironment: ProviderEnvironmentDevelopment},
	}
	providers := []struct {
		name       string
		profile    string
		operations []Operation
	}{
		{"telegram", models.ContentProfileShortText, []Operation{OperationPublishImmediate, OperationPublishScheduled, OperationObservation, OperationAnalytics}},
		{"pinterest", models.ContentProfileImagePost, []Operation{OperationPublishImmediate, OperationPublishScheduled, OperationDiscover, OperationAnalytics}},
		{"googlebusiness", models.ContentProfileShortText, []Operation{OperationPublishImmediate, OperationPublishScheduled}},
	}
	for _, provider := range providers {
		for _, deployment := range deployments {
			for _, operation := range provider.operations {
				t.Run(provider.name+"/"+deployment.name+"/"+string(operation), func(t *testing.T) {
					testCertificationRoundTrip(t, provider.name, provider.profile, operation, deployment.managedProduction, deployment.providerEnvironment)
				})
			}
		}
	}
}

func testCertificationRoundTrip(t *testing.T, provider, profile string, operation Operation, managedProduction bool, providerEnvironment ProviderEnvironment) {
	t.Helper()
	db := newProviderReadinessRepositoryTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	workspace := models.Workspace{ID: "workspace-1", Name: "Certification"}
	account := models.SocialAccount{ID: "account-1", WorkspaceID: workspace.ID, Platform: provider, AccountID: "-100123", Slug: "test-account", AccessTokenEnc: []byte{}, IsActive: true, CreatedAt: now}
	connection := models.TelegramConnection{SocialAccountID: account.ID, WorkspaceID: workspace.ID, ChatID: account.AccountID, ChatType: "channel", InstalledAt: now, CoverageStartedAt: now, CoverageKind: "since_installation", PermissionsVerifiedAt: now, CreatedAt: now}
	for _, model := range []any{&workspace, &account} {
		if _, err := db.NewInsert().Model(model).Exec(t.Context()); err != nil {
			t.Fatal(err)
		}
	}
	if provider == "telegram" {
		if _, err := db.NewInsert().Model(&connection).Exec(t.Context()); err != nil {
			t.Fatal(err)
		}
	}
	app := platform.AppConfig{Provider: provider, BotUsername: "test_bot", BotToken: "test-token"}
	if provider != "telegram" {
		app = platform.AppConfig{Provider: provider, ClientID: "test-client", ClientSecret: "test-secret", RedirectURI: "https://openpost.test/callback"}
		grant := models.OAuthGrant{ID: "grant-1", WorkspaceID: workspace.ID, Provider: provider, AccessTokenEnc: []byte("encrypted"), GrantedScopes: "https://www.googleapis.com/auth/business.manage", ValidationStatus: "valid", ValidatedAt: now}
		if provider == "pinterest" {
			grant.GrantedScopes = "boards:read boards:write pins:read pins:write user_accounts:read"
		}
		if _, err := db.NewInsert().Model(&grant).Exec(t.Context()); err != nil {
			t.Fatal(err)
		}
		account.OAuthGrantID = grant.ID
		if _, err := db.NewUpdate().Model(&account).Column("oauth_grant_id").WherePK().Exec(t.Context()); err != nil {
			t.Fatal(err)
		}
	}
	catalog, err := NewConfigurationCatalog(RuntimeApps([]platform.AppConfig{app}, ConfigurationSourceEnvironment, providerEnvironment))
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(NewRepository(db), ServiceOptions{Configurations: catalog, ManagedProduction: managedProduction, EnforceCertification: false, CurrentRevision: strings.Repeat("a", 40), DefaultControl: RuntimeControlStateEnabled, Now: func() time.Time { return now }})
	capability, found := capabilities.Find(provider, profile)
	if !found {
		t.Fatal("provider capability missing")
	}
	outputProfile := ""
	if operation.IsPublish() {
		outputProfile = capability.OutputProfile
	}
	resolved, err := service.ResolveCertificationContext(t.Context(), account, outputProfile, operation, map[string]any{"chat_id": account.AccountID}, "")
	if err != nil {
		t.Fatal(err)
	}
	review := ApprovalReview{ID: "review-1", Provider: provider, AppFingerprint: resolved.Subject.AppFingerprint, ProviderEnvironment: providerEnvironment, OperatorRef: "operator-1", CreatedAt: now, Evidence: ApprovalEvidence{State: ApprovalStateApproved, Tier: "standard", SourceURL: "https://openpost.test/provider-review", ReviewedAt: now.Add(-time.Hour), ExpiresAt: now.Add(24 * time.Hour)}}
	if provider == "telegram" {
		review.Evidence.Tier = "registered_bot"
	}
	if err := service.AppendApprovalReview(t.Context(), review); err != nil {
		t.Fatal(err)
	}
	digest, err := resolved.Contract.Digest()
	if err != nil {
		t.Fatal(err)
	}
	publishCheck := CheckPublishImmediate
	if operation == OperationPublishScheduled {
		publishCheck = CheckPublishScheduled
	}
	checkKinds := []CheckKind{CheckConnect, CheckAuthorization, publishCheck, CheckFinalResult, CheckRevoke}
	if !operation.IsPublish() {
		operationCheck := CheckAnalytics
		if operation == OperationDiscover {
			operationCheck = CheckDiscovery
		}
		if operation == OperationObservation {
			operationCheck = CheckObservation
		}
		checkKinds = []CheckKind{CheckConnect, CheckAuthorization, operationCheck, CheckRevoke}
	}
	checks := make([]CheckResult, 0, 6)
	for _, kind := range checkKinds {
		checks = append(checks, CheckResult{Kind: kind, Outcome: CheckOutcomePassed, CompletedAt: now, ExternalRefHash: "sha256:" + strings.Repeat("b", 64)})
	}
	refresh := CheckResult{Kind: CheckRefresh, Outcome: CheckOutcomePassed, CompletedAt: now, ExternalRefHash: "sha256:" + strings.Repeat("b", 64)}
	if provider == "telegram" {
		refresh.Outcome = CheckOutcomeNotApplicable
		refresh.NotApplicableReason = "protocol_not_supported"
	}
	checks = append(checks, refresh)
	evidence := CertificationEvidence{ID: "evidence-1", Kind: EvidenceKindLive, Subject: resolved.Subject, AccountReferenceHash: resolved.AccountReferenceHash, TestedRevision: service.CurrentRevision(), ContractDigest: digest, TestedAt: now, ExpiresAt: now.Add(time.Hour), ApprovalStateAtTest: review.Evidence.State, ApprovalTierAtTest: review.Evidence.Tier, RequiredScopes: resolved.Contract.Requirements.RequiredScopes, GrantedScopes: resolved.Authorization.GrantedScopes, Checks: checks, OperatorRef: "operator-1"}
	if err := service.AppendCertification(t.Context(), review.ID, evidence); err != nil {
		t.Fatal(err)
	}
	decide := func() Decision {
		if operation.IsPublish() {
			return service.DecideAccountPublication(t.Context(), account, capability, operation, ExecutionIntentProduction, resolved.Subject.PolicyMode)
		}
		return service.DecideAccountOperation(t.Context(), account, operation, ExecutionIntentProduction)
	}
	decision := decide()
	if decision.Executable {
		t.Fatal("live evidence alone allowed production execution")
	}
	evidence.ID = "evidence-local"
	evidence.Kind = EvidenceKindLocal
	if err := service.AppendCertification(t.Context(), review.ID, evidence); err != nil {
		t.Fatal(err)
	}
	decision = decide()
	if !decision.Executable {
		t.Fatalf("recorded local and live evidence were not recognized: %#v", decision.Blockers)
	}
	if provider != "telegram" || !operation.IsPublish() {
		return
	}
	imageCapability, found := capabilities.Find("telegram", "image_post")
	if !found {
		t.Fatal("Telegram image capability missing")
	}
	decision = service.DecideAccountPublication(t.Context(), account, imageCapability, operation, ExecutionIntentProduction, resolved.Subject.PolicyMode)
	if !decision.Executable {
		t.Fatalf("evidence for the shared Telegram post output did not cover its image format: %#v", decision.Blockers)
	}
	imageCapability.TextLimit--
	decision = service.DecideAccountPublication(t.Context(), account, imageCapability, operation, ExecutionIntentProduction, resolved.Subject.PolicyMode)
	if decision.Executable {
		t.Fatal("changed image constraints reused old certification evidence")
	}
}
