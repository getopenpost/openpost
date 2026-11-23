package providerreadiness

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRequestScopedServiceDoesNotOutliveItsRequest(t *testing.T) {
	t.Parallel()
	input := healthyInput()
	ledger := &fakeLedger{}
	base := NewService(ledger, ServiceOptions{Now: func() time.Time { return input.Now }})

	base.RequestScoped().Decide(t.Context(), decisionRequest(input))
	base.RequestScoped().Decide(t.Context(), decisionRequest(input))

	require.Equal(t, 2, ledger.approvalReads, "each request reads again instead of reusing process memory")
}
