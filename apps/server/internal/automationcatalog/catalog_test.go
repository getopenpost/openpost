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
	listMedia, ok := Lookup("list-media")
	require.True(t, ok)
	require.Equal(t, "offset", listMedia.Pagination.Style)
	require.Equal(t, "media", listMedia.Result.BodyPath)
	require.NotEmpty(t, listMedia.Selectors)

	getJob, ok := Lookup("get-job")
	require.True(t, ok)
	require.Equal(t, AccessRead, getJob.Access)
	require.Equal(t, ExposureAlpha, getJob.Exposure)
	require.Equal(t, EffectQuery, getJob.Effect)
	require.Equal(t, RetryTransient, getJob.Retry)
	require.Equal(t, IdempotencyNone, getJob.Idempotency)
	require.Equal(t, "$.id", getJob.Result.IDPath)

	deleteMedia, ok := Lookup("delete-media")
	require.True(t, ok)
	require.Equal(t, AccessWrite, deleteMedia.Access)
	require.Equal(t, ExposureDisabled, deleteMedia.Exposure)
	require.Equal(t, EffectDestructive, deleteMedia.Effect)

	_, ok = Lookup("delete-organization")
	require.False(t, ok)
}
