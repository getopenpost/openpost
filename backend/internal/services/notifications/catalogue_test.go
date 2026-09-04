package notifications

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTypedOutcomesRejectMissingOrUnsafeSemanticFacts(t *testing.T) {
	_, err := NewOwnershipTransferOutcome("nominee-1", "", "Organization")
	require.ErrorIs(t, err, ErrInvalidOutcome)

	_, err = NewOwnershipTransferOutcome("nominee-1", "transfer-1", "\x00secret")
	require.ErrorIs(t, err, ErrInvalidOutcome)
}
