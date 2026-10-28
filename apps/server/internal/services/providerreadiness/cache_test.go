package providerreadiness

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRequestScopedServiceSharesProviderFactsWithinOneRequest(t *testing.T) {
	input := healthyInput()
	ledger := &fakeLedger{
		controls: map[Operation]RuntimeControl{
			OperationPublishImmediate: {State: RuntimeControlStateEnabled},
			OperationPublishScheduled: {State: RuntimeControlStateEnabled},
		},
	}
	service := NewService(ledger, ServiceOptions{
		Now: func() time.Time { return input.Now },
	}).RequestScoped()

	immediate := decisionRequest(input)
	immediate.Subject.Operation = OperationPublishImmediate
	scheduled := decisionRequest(input)
	scheduled.Subject.Operation = OperationPublishScheduled
	scheduled.CurrentAccountReferenceHash = immediate.CurrentAccountReferenceHash

	service.Decide(t.Context(), immediate)
	service.Decide(t.Context(), immediate)
	service.Decide(t.Context(), scheduled)

	require.Equal(t, 1, ledger.approvalReads, "provider approval is shared by every account and operation")
	require.Equal(t, 2, ledger.localReads, "local certification is scoped by operation")
	require.Equal(t, 2, ledger.controlReads, "runtime controls are scoped by operation")
	require.Equal(t, 2, ledger.liveReads, "live certification never crosses operations")
}

func TestRequestScopedDecisionsMatchFreshService(t *testing.T) {
	input := healthyInput()
	ledger := &fakeLedger{
		approval: &ApprovalReview{Evidence: input.Approval},
		control:  input.Control,
		local:    input.LocalEvidence,
		live:     input.LiveEvidence,
	}
	freshService := func() *Service {
		return NewService(ledger, ServiceOptions{Now: func() time.Time { return input.Now }})
	}
	immediate := decisionRequest(input)
	scheduled := immediate
	scheduled.Subject.Operation = OperationPublishScheduled

	require.Equal(t,
		freshService().Decide(t.Context(), immediate),
		freshService().RequestScoped().Decide(t.Context(), immediate),
		"request scope must not change the immediate decision",
	)
	require.Equal(t,
		freshService().Decide(t.Context(), scheduled),
		freshService().RequestScoped().Decide(t.Context(), scheduled),
		"request scope must not change the scheduled decision",
	)
}

func TestRequestScopedServiceFreezesFactsForTheRequest(t *testing.T) {
	input := healthyInput()
	ledger := &fakeLedger{
		approval: &ApprovalReview{Evidence: input.Approval},
		control:  input.Control,
		local:    input.LocalEvidence,
		live:     input.LiveEvidence,
	}
	service := NewService(ledger, ServiceOptions{
		Now: func() time.Time { return input.Now },
	}).RequestScoped()
	first := service.Decide(t.Context(), decisionRequest(input))
	require.Equal(t, EffectiveStateHealthy, first.State, "the configured fixture must be executable before the control changes")
	require.True(t, first.Executable)

	ledger.control = RuntimeControl{State: RuntimeControlStateDisabled}
	second := service.Decide(t.Context(), decisionRequest(input))
	require.Equal(t, first, second, "one request sees one consistent snapshot")

	fresh := NewService(ledger, ServiceOptions{Now: func() time.Time { return input.Now }}).
		Decide(t.Context(), decisionRequest(input))
	require.Equal(t, EffectiveStateDisabled, fresh.State, "the next request observes the operator change")
	require.False(t, fresh.Executable, "a disabled runtime control must not stay executable")
	require.NotEqual(t, first, fresh, "the next request observes the operator change")
}

func TestRequestScopedServiceDoesNotOutliveItsRequest(t *testing.T) {
	input := healthyInput()
	ledger := &fakeLedger{}
	base := NewService(ledger, ServiceOptions{Now: func() time.Time { return input.Now }})

	base.RequestScoped().Decide(t.Context(), decisionRequest(input))
	base.RequestScoped().Decide(t.Context(), decisionRequest(input))

	require.Equal(t, 2, ledger.approvalReads, "each request reads again instead of reusing process memory")
}

func TestWithLedgerDoesNotInheritRequestCache(t *testing.T) {
	input := healthyInput()
	first := &fakeLedger{}
	second := &fakeLedger{}
	service := NewService(first, ServiceOptions{Now: func() time.Time { return input.Now }}).RequestScoped()
	service.Decide(t.Context(), decisionRequest(input))

	service.WithLedger(second).Decide(t.Context(), decisionRequest(input))

	require.Equal(t, 1, first.approvalReads)
	require.Equal(t, 1, second.approvalReads, "a different ledger boundary must read its own facts")
}
