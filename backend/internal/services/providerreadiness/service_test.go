package providerreadiness

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/platform"
)

func TestServiceProjectsOneHealthyLedgerDecision(t *testing.T) {
	t.Parallel()
	input := healthyInput()
	ledger := &fakeLedger{
		approval: &ApprovalReview{Evidence: input.Approval},
		control:  input.Control,
		local:    input.LocalEvidence,
		live:     input.LiveEvidence,
	}
	service := NewService(ledger, ServiceOptions{Now: func() time.Time { return input.Now }})

	decision, err := service.Require(t.Context(), decisionRequest(input))
	if err != nil {
		t.Fatal(err)
	}
	if decision.State != EffectiveStateHealthy || !decision.Executable || !decision.Advertisable {
		t.Fatalf("unexpected healthy decision: %#v", decision)
	}
}

func TestServiceFailsClosedWhenLedgerIsMissingOrUnavailable(t *testing.T) {
	t.Parallel()
	input := healthyInput()

	missing := NewService(&fakeLedger{
		approvalErr: ErrLedgerFactNotFound,
		controlErr:  ErrLedgerFactNotFound,
		localErr:    ErrLedgerFactNotFound,
		liveErr:     ErrLedgerFactNotFound,
	}, ServiceOptions{Now: func() time.Time { return input.Now }})
	decision := missing.Decide(t.Context(), decisionRequest(input))
	if decision.State != EffectiveStateDegraded || decision.Executable || decision.Advertisable {
		t.Fatalf("missing ledger facts did not fail closed: %#v", decision)
	}
	if !hasBlocker(decision.Blockers, BlockerUnknownRuntimeControl) || !hasBlocker(decision.Blockers, BlockerLiveEvidenceMissing) {
		t.Fatalf("missing facts were not reported: %#v", decision.Blockers)
	}

	unavailable := NewService(&fakeLedger{approvalErr: errors.New("database unavailable")}, ServiceOptions{
		Now: func() time.Time { return input.Now },
	})
	decision = unavailable.Decide(t.Context(), decisionRequest(input))
	if decision.State != EffectiveStateDegraded || decision.Executable || len(decision.Blockers) != 1 ||
		decision.Blockers[0].Code != BlockerReadinessUnavailable {
		t.Fatalf("repository failure did not return one safe degraded decision: %#v", decision)
	}
	if _, err := unavailable.Require(t.Context(), decisionRequest(input)); err == nil {
		t.Fatal("Require accepted a repository failure")
	}
}

func TestServiceEnvironmentDisableHasPriorityAndSkipsLedger(t *testing.T) {
	t.Parallel()
	input := healthyInput()
	ledger := &fakeLedger{approvalErr: errors.New("must not be queried")}
	service := NewService(ledger, ServiceOptions{
		Now:               func() time.Time { return input.Now },
		DisabledProviders: []string{input.Subject.Provider},
	})

	decision := service.Decide(t.Context(), decisionRequest(input))
	if decision.State != EffectiveStateDisabled || decision.Executable || !hasBlocker(decision.Blockers, BlockerDisabled) {
		t.Fatalf("environment kill switch did not win: %#v", decision)
	}
	if ledger.reads != 0 {
		t.Fatalf("disabled provider performed %d ledger reads", ledger.reads)
	}
}

func TestManagedProductionKeepsUncertifiedOperationsUsableButNotAdvertisable(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.August, 11, 12, 0, 0, 0, time.UTC)
	xApp := platform.AppConfig{
		Provider: capabilities.ProviderX, ClientID: "provider-app-1",
		RedirectURI: "https://app.openpost.test/api/v1/accounts/x/callback",
	}
	linkedinApp := platform.AppConfig{
		Provider: capabilities.ProviderLinkedIn, ClientID: "provider-app-2",
		RedirectURI: "https://app.openpost.test/api/v1/accounts/linkedin/callback",
	}
	catalog, err := NewConfigurationCatalog(RuntimeApps(
		[]platform.AppConfig{xApp, linkedinApp}, ConfigurationSourceEnvironment, ProviderEnvironmentProduction,
	))
	if err != nil {
		t.Fatal(err)
	}
	ledger := &fakeLedger{
		approvalErr: ErrLedgerFactNotFound, controlErr: ErrLedgerFactNotFound,
		localErr: ErrLedgerFactNotFound, liveErr: ErrLedgerFactNotFound,
	}
	service := NewService(ledger, ServiceOptions{
		Now: func() time.Time { return now }, Configurations: catalog,
		ManagedProduction: true, DefaultControl: RuntimeControlStateEnabled,
	})

	connection := service.DecideConnection(t.Context(), capabilities.ProviderX, "", ExecutionIntentProduction)
	if connection.State != EffectiveStateHealthy || !connection.Connectable {
		t.Fatalf("uncertified production connection was blocked: %#v", connection)
	}

	capability, ok := capabilities.FindOutput(capabilities.ProviderX, "x.post")
	if !ok {
		t.Fatal("X post capability is missing")
	}
	publication := service.DecidePublication(t.Context(), PublicationDecisionInput{
		Provider: capabilities.ProviderX, AccountKind: "standard", Capability: capability,
		Operation: OperationPublishImmediate, Intent: ExecutionIntentProduction, PolicyMode: "x.standard",
		CurrentAccountReferenceHash: "sha256:" + strings.Repeat("f", 64),
		Authorization: AuthorizationEvidence{
			State: AuthorizationStateValid, ValidatedAt: now.Add(-time.Hour),
		},
	})
	if publication.State != EffectiveStateHealthy || !publication.Publishable {
		t.Fatalf("uncertified production publication was blocked: %#v", publication)
	}
	if publication.Advertisable {
		t.Fatalf("uncertified production publication became advertisable: %#v", publication)
	}

	linkedinCapability, ok := capabilities.FindOutput(capabilities.ProviderLinkedIn, "linkedin.post")
	if !ok {
		t.Fatal("LinkedIn post capability is missing")
	}
	linkedinPublication := service.DecidePublication(t.Context(), PublicationDecisionInput{
		Provider: capabilities.ProviderLinkedIn, AccountKind: "person", Capability: linkedinCapability,
		Operation: OperationPublishImmediate, Intent: ExecutionIntentProduction, PolicyMode: "linkedin.person",
		CurrentAccountReferenceHash: "sha256:" + strings.Repeat("e", 64),
		Authorization: AuthorizationEvidence{
			State: AuthorizationStateValid, ValidatedAt: now.Add(-time.Hour),
		},
	})
	if linkedinPublication.State != EffectiveStateHealthy || !linkedinPublication.Publishable {
		t.Fatalf("legacy LinkedIn authorization without recorded scopes was blocked: %#v", linkedinPublication)
	}
}

func TestServiceKeepsImplementationSeparateFromConfiguration(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.August, 9, 12, 0, 0, 0, time.UTC)
	ledger := &fakeLedger{
		approvalErr: ErrLedgerFactNotFound, controlErr: ErrLedgerFactNotFound,
		localErr: ErrLedgerFactNotFound, liveErr: ErrLedgerFactNotFound,
	}
	catalog, err := NewConfigurationCatalog()
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(ledger, ServiceOptions{
		Now: func() time.Time { return now }, Configurations: catalog,
		DefaultControl: RuntimeControlStateEnabled,
	})

	connection := service.DecideConnection(t.Context(), capabilities.ProviderX, "", ExecutionIntentProduction)
	if connection.State != EffectiveStateNeedsConfiguration || !hasBlocker(connection.Blockers, BlockerMissingConfiguration) {
		t.Fatalf("implemented connection without config collapsed into unsupported: %#v", connection)
	}

	capability, ok := capabilities.FindOutput(capabilities.ProviderBluesky, "bluesky.post")
	if !ok {
		t.Fatal("Bluesky post capability is missing")
	}
	publication := service.DecidePublication(t.Context(), PublicationDecisionInput{
		Provider: capabilities.ProviderBluesky, AccountKind: "standard", Capability: capability,
		Operation: OperationPublishImmediate, Intent: ExecutionIntentProduction, PolicyMode: "immediate",
		CurrentAccountReferenceHash: "sha256:" + strings.Repeat("f", 64),
		Authorization: AuthorizationEvidence{
			State: AuthorizationStateValid, ValidatedAt: now.Add(-time.Hour), ExpiresAt: now.Add(time.Hour),
		},
	})
	if publication.State != EffectiveStateNeedsConfiguration || !hasBlocker(publication.Blockers, BlockerMissingConfiguration) {
		t.Fatalf("implemented publication without config collapsed into unsupported: %#v", publication)
	}

	unsupported := service.DecideConnection(t.Context(), "not_a_provider", "", ExecutionIntentProduction)
	if unsupported.State != EffectiveStateUnsupported || !hasBlocker(unsupported.Blockers, BlockerUnsupported) {
		t.Fatalf("unknown provider did not remain unsupported: %#v", unsupported)
	}
}

func TestServiceModelsDynamicMastodonBootstrapWithoutWeakeningExactInstanceChecks(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.August, 9, 12, 0, 0, 0, time.UTC)
	ledger := &fakeLedger{
		approvalErr: ErrLedgerFactNotFound, controlErr: ErrLedgerFactNotFound,
		localErr: ErrLedgerFactNotFound, liveErr: ErrLedgerFactNotFound,
	}
	catalog, err := NewConfigurationCatalog()
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(ledger, ServiceOptions{
		Now: func() time.Time { return now }, Configurations: catalog,
		DynamicRegistrationProviders: []string{capabilities.ProviderMastodon},
		DefaultControl:               RuntimeControlStateEnabled,
	})

	generic := service.DecideConnection(t.Context(), capabilities.ProviderMastodon, "", ExecutionIntentProduction)
	if generic.State != EffectiveStateHealthy || !generic.Connectable || generic.Facts.Configuration != ConfigurationStateDynamic {
		t.Fatalf("dynamic Mastodon bootstrap was not connectable: %#v", generic)
	}
	exact := service.DecideConnection(t.Context(), capabilities.ProviderMastodon, "https://social.example", ExecutionIntentProduction)
	if exact.State != EffectiveStateNeedsConfiguration || exact.Connectable {
		t.Fatalf("unregistered exact Mastodon instance was accepted: %#v", exact)
	}
	if err := service.RegisterRuntimeApp(RuntimeApp{
		Config: platform.AppConfig{
			Provider: capabilities.ProviderMastodon, ClientID: "client-1",
			RedirectURI: "https://openpost.example/api/v1/accounts/mastodon/callback",
			InstanceURL: "https://social.example",
		},
		Source: ConfigurationSourceDynamic, ProviderEnvironment: ProviderEnvironmentDevelopment,
	}); err != nil {
		t.Fatal(err)
	}
	exact = service.DecideConnection(t.Context(), capabilities.ProviderMastodon, "https://social.example", ExecutionIntentProduction)
	if exact.State != EffectiveStateHealthy || !exact.Connectable || exact.Facts.Configuration != ConfigurationStateConfigured {
		t.Fatalf("registered exact Mastodon instance was not connectable: %#v", exact)
	}
}

func TestServiceAppendsOnlyEvidenceForTheCurrentRuntimeContract(t *testing.T) {
	t.Parallel()
	app := platform.AppConfig{
		Provider: capabilities.ProviderX, ClientID: "provider-app-1",
		RedirectURI: "https://app.openpost.test/api/v1/accounts/x/callback",
	}
	catalog, err := NewConfigurationCatalog(RuntimeApps(
		[]platform.AppConfig{app},
		ConfigurationSourceEnvironment,
		ProviderEnvironmentProduction,
	))
	if err != nil {
		t.Fatal(err)
	}
	fingerprint, err := AppFingerprint(app)
	if err != nil {
		t.Fatal(err)
	}
	capability, ok := capabilities.FindOutput(capabilities.ProviderX, "x.post")
	if !ok {
		t.Fatal("X post capability is missing")
	}
	contract, err := PublicationContract(capability, OperationPublishImmediate, true, "standard", "x.standard")
	if err != nil {
		t.Fatal(err)
	}
	contractDigest, err := contract.Digest()
	if err != nil {
		t.Fatal(err)
	}
	ledger := &fakeLedger{}
	service := NewService(ledger, ServiceOptions{
		Configurations: catalog, ManagedProduction: true, EnforceCertification: true,
		CurrentRevision: strings.Repeat("a", 40),
	})
	evidence := CertificationEvidence{
		ID: "certification-1", Kind: EvidenceKindLive,
		Subject: Subject{
			Provider: capabilities.ProviderX, AppFingerprint: fingerprint,
			DeploymentEnvironment: DeploymentEnvironmentProduction,
			ProviderEnvironment:   ProviderEnvironmentProduction,
			AccountKind:           "standard", OutputProfile: capability.OutputProfile,
			Operation: OperationPublishImmediate, PolicyMode: "x.standard",
		},
		TestedRevision: strings.Repeat("a", 40), ContractDigest: contractDigest,
		TestedAt:       time.Now().UTC().Add(-time.Minute),
		RequiredScopes: append([]string(nil), contract.Requirements.RequiredScopes...),
	}
	for _, requirement := range contract.Requirements.RequiredLiveChecks {
		externalReference := ""
		if checkRequiresExternalReference(requirement.Kind) {
			externalReference = "sha256:" + strings.Repeat("e", 64)
		}
		evidence.Checks = append(evidence.Checks, CheckResult{
			Kind: requirement.Kind, Outcome: CheckOutcomePassed,
			ExternalRefHash: externalReference, CompletedAt: time.Now().UTC(),
		})
	}
	if err := service.AppendCertification(t.Context(), "approval-1", evidence); err != nil {
		t.Fatal(err)
	}
	if ledger.appendedCertification == nil || ledger.appendedCertification.ContractDigest != contractDigest {
		t.Fatalf("certification was not appended: %#v", ledger.appendedCertification)
	}

	stalePolicy := evidence
	stalePolicy.ID = "certification-2"
	stalePolicy.Subject.PolicyMode = "inbox"
	if err := service.AppendCertification(t.Context(), "approval-1", stalePolicy); err == nil {
		t.Fatal("accepted evidence whose policy mode did not match its contract")
	}

	wrongApp := evidence
	wrongApp.ID = "certification-3"
	wrongApp.Subject.AppFingerprint = "sha256:" + strings.Repeat("f", 64)
	if err := service.AppendCertification(t.Context(), "approval-1", wrongApp); err == nil {
		t.Fatal("accepted evidence for an app absent from the effective runtime")
	}
}

func decisionRequest(input EvaluationInput) DecisionRequest {
	return DecisionRequest{
		Implemented:                 input.Implemented,
		Subject:                     input.Subject,
		CurrentAccountReferenceHash: input.CurrentAccountReferenceHash,
		Intent:                      input.Intent,
		CurrentRevision:             input.CurrentRevision,
		Contract:                    input.Contract,
		Configuration:               input.Configuration,
		Authorization:               input.Authorization,
		Policy:                      input.Policy,
	}
}

type fakeLedger struct {
	approval              *ApprovalReview
	approvalErr           error
	control               RuntimeControl
	controlErr            error
	local                 *CertificationEvidence
	localErr              error
	live                  *CertificationEvidence
	liveErr               error
	reads                 int
	appendedCertification *CertificationEvidence
}

func (f *fakeLedger) LatestApprovalReview(context.Context, Subject) (*ApprovalReview, error) {
	f.reads++
	return f.approval, f.approvalErr
}

func (f *fakeLedger) ApprovalReviewByID(context.Context, string) (*ApprovalReview, error) {
	return f.approval, f.approvalErr
}

func (f *fakeLedger) LatestCertification(_ context.Context, _ Subject, kind EvidenceKind, _ string) (*CertificationEvidence, error) {
	f.reads++
	if kind == EvidenceKindLocal {
		return f.local, f.localErr
	}
	return f.live, f.liveErr
}

func (f *fakeLedger) EffectiveRuntimeControl(context.Context, Subject, time.Time) (RuntimeControl, error) {
	f.reads++
	return f.control, f.controlErr
}

func (*fakeLedger) AppendApprovalReview(context.Context, ApprovalReview) error {
	return errors.New("not implemented")
}

func (f *fakeLedger) AppendCertification(_ context.Context, _ string, evidence CertificationEvidence) error {
	f.appendedCertification = &evidence
	return nil
}

func (*fakeLedger) AppendRuntimeControl(context.Context, RuntimeControlEvent) error {
	return errors.New("not implemented")
}
