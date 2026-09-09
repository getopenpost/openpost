package providerreadiness

import (
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
)

func TestTelegramCertificationRoundTrip(t *testing.T) {
	for _, operation := range []Operation{OperationPublishImmediate, OperationPublishScheduled} {
		t.Run(string(operation), func(t *testing.T) {
			db := newProviderReadinessRepositoryTestDB(t)
			now := time.Now().UTC().Truncate(time.Second)
			workspace := models.Workspace{ID: "telegram-workspace", Name: "Telegram"}
			account := models.SocialAccount{ID: "telegram-account", WorkspaceID: workspace.ID, Platform: "telegram", AccountID: "-100123", Slug: "telegram-test", AccessTokenEnc: []byte{}, IsActive: true, CreatedAt: now}
			connection := models.TelegramConnection{SocialAccountID: account.ID, WorkspaceID: workspace.ID, ChatID: account.AccountID, ChatType: "channel", InstalledAt: now, CoverageStartedAt: now, CoverageKind: "since_installation", PermissionsVerifiedAt: now, CreatedAt: now}
			for _, model := range []any{&workspace, &account, &connection} {
				if _, err := db.NewInsert().Model(model).Exec(t.Context()); err != nil {
					t.Fatal(err)
				}
			}
			app := platform.AppConfig{Provider: "telegram", BotUsername: "test_bot", BotToken: "test-token"}
			catalog, err := NewConfigurationCatalog(RuntimeApps([]platform.AppConfig{app}, ConfigurationSourceEnvironment, ProviderEnvironmentProduction))
			if err != nil {
				t.Fatal(err)
			}
			service := NewService(NewRepository(db), ServiceOptions{Configurations: catalog, ManagedProduction: true, EnforceCertification: false, CurrentRevision: strings.Repeat("a", 40), DefaultControl: RuntimeControlStateEnabled, Now: func() time.Time { return now }})
			resolved, err := service.ResolveCertificationContext(t.Context(), account, "telegram.post", operation, map[string]any{"chat_id": account.AccountID}, "")
			if err != nil {
				t.Fatal(err)
			}
			review := ApprovalReview{ID: "review-1", Provider: "telegram", AppFingerprint: resolved.Subject.AppFingerprint, ProviderEnvironment: ProviderEnvironmentProduction, OperatorRef: "operator-1", CreatedAt: now, Evidence: ApprovalEvidence{State: ApprovalStateApproved, Tier: "registered_bot", SourceURL: "https://core.telegram.org/bots", ReviewedAt: now.Add(-time.Hour), ExpiresAt: now.Add(24 * time.Hour)}}
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
			checks := make([]CheckResult, 0, 6)
			for _, kind := range []CheckKind{CheckConnect, CheckAuthorization, publishCheck, CheckFinalResult, CheckRevoke} {
				checks = append(checks, CheckResult{Kind: kind, Outcome: CheckOutcomePassed, CompletedAt: now, ExternalRefHash: "sha256:" + strings.Repeat("b", 64)})
			}
			checks = append(checks, CheckResult{Kind: CheckRefresh, Outcome: CheckOutcomeNotApplicable, NotApplicableReason: "protocol_not_supported", CompletedAt: now})
			evidence := CertificationEvidence{ID: "evidence-1", Kind: EvidenceKindLive, Subject: resolved.Subject, AccountReferenceHash: resolved.AccountReferenceHash, TestedRevision: service.CurrentRevision(), ContractDigest: digest, TestedAt: now, ExpiresAt: now.Add(time.Hour), ApprovalStateAtTest: review.Evidence.State, ApprovalTierAtTest: review.Evidence.Tier, RequiredScopes: resolved.Contract.Requirements.RequiredScopes, GrantedScopes: resolved.Authorization.GrantedScopes, Checks: checks, OperatorRef: "operator-1"}
			if err := service.AppendCertification(t.Context(), review.ID, evidence); err != nil {
				t.Fatal(err)
			}
			capability, found := capabilities.FindOutput("telegram", "telegram.post")
			if !found {
				t.Fatal("Telegram post capability missing")
			}
			decision := service.DecideAccountPublication(t.Context(), account, capability, operation, ExecutionIntentProduction, resolved.Subject.PolicyMode)
			if decision.Executable {
				t.Fatal("live evidence alone allowed production publication")
			}
			evidence.ID = "evidence-local"
			evidence.Kind = EvidenceKindLocal
			if err := service.AppendCertification(t.Context(), review.ID, evidence); err != nil {
				t.Fatal(err)
			}
			decision = service.DecideAccountPublication(t.Context(), account, capability, operation, ExecutionIntentProduction, resolved.Subject.PolicyMode)
			if !decision.Executable {
				t.Fatalf("recorded local and live evidence were not recognized: %#v", decision.Blockers)
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
		})
	}
}
