package automationcatalog

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCatalogFailsClosedAndKeepsAccessSeparateFromExposure(t *testing.T) {
	t.Parallel()

	create, ok := Lookup("create-publication")
	require.True(t, ok)
	require.Equal(t, AccessWrite, create.Access)
	require.Equal(t, ExposureAlpha, create.Exposure)
	require.Equal(t, EffectLocalMutation, create.Effect)
	require.Equal(t, RetryIdempotentTransient, create.Retry)
	require.Equal(t, IdempotencyRequired, create.Idempotency)
	completeUpload, ok := Lookup("complete-media-upload-session")
	require.True(t, ok)
	require.Equal(t, IdempotencyNatural, completeUpload.Idempotency)
	require.Equal(t, RetryTransient, completeUpload.Retry)

	deleteMedia, ok := Lookup("delete-media")
	require.True(t, ok)
	require.Equal(t, AccessWrite, deleteMedia.Access)
	require.Equal(t, ExposureDisabled, deleteMedia.Exposure)
	require.Equal(t, EffectDestructive, deleteMedia.Effect)

	_, ok = Lookup("delete-organization")
	require.False(t, ok)
}

func TestAllReturnsUniqueDefensiveSnapshot(t *testing.T) {
	t.Parallel()

	operations := All()
	require.NotEmpty(t, operations)
	seen := make(map[string]struct{}, len(operations))
	for _, operation := range operations {
		require.NotEmpty(t, operation.OperationID)
		_, duplicate := seen[operation.OperationID]
		require.False(t, duplicate, "duplicate operation %q", operation.OperationID)
		seen[operation.OperationID] = struct{}{}
	}

	operations[0].OperationID = "changed-by-caller"
	_, exists := Lookup("changed-by-caller")
	require.False(t, exists)
}
