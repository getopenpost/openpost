package publisher

import (
	"context"
	"errors"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestBlueskyThreadPreflightRejectsInvalidLaterSegmentBeforePublishing(t *testing.T) {
	segments := []models.RenditionSegment{{ID: "first"}, {ID: "second"}, {ID: "third"}}
	var operations []string
	load := func(_ context.Context, segmentID string) ([]models.MediaAttachment, []string, []map[string]interface{}, error) {
		operations = append(operations, "load:"+segmentID)
		return blueskyGalleryStoredMedia(5), []string{"alt"}, nil, nil
	}
	check := func(_ context.Context, segment *models.RenditionSegment, _ []models.MediaAttachment) error {
		operations = append(operations, "check:"+segment.ID)
		if segment.ID == "second" {
			return errors.New("final gallery object missing")
		}
		return nil
	}
	prepared, err := prepareBlueskyThreadMedia(t.Context(), segments, load, check)
	require.ErrorContains(t, err, "final gallery object missing")
	require.Nil(t, prepared, "a partially checked thread must never be returned for publication")
	var failure *blueskyThreadPreflightError
	require.ErrorAs(t, err, &failure)
	require.Equal(t, "second", failure.segmentID)
	require.Equal(t, []string{"load:first", "check:first", "load:second", "check:second"}, operations)
	// The production publisher only enters its provider-write loop after a
	// successful prepareBlueskyThreadMedia return.
}

func TestBlueskyThreadPreflightSkipsPublishedAndPreservesRecoveredDimensions(t *testing.T) {
	segments := []models.RenditionSegment{
		{ID: "already-published", Status: models.RenditionStatusPublished},
		{ID: "pending-first"},
		{ID: "pending-last"},
	}
	var loaded []string
	load := func(_ context.Context, segmentID string) ([]models.MediaAttachment, []string, []map[string]interface{}, error) {
		loaded = append(loaded, segmentID)
		attachments := blueskyGalleryStoredMedia(5)
		attachments[0].Width, attachments[0].Height = 0, 0
		return attachments, []string{"alt"}, []map[string]interface{}{{"key": "value"}}, nil
	}
	prepared, err := prepareBlueskyThreadMedia(t.Context(), segments, load,
		func(_ context.Context, _ *models.RenditionSegment, media []models.MediaAttachment) error {
			media[0].Width, media[0].Height = 32, 17
			return nil
		})
	require.NoError(t, err)
	require.Equal(t, []string{"pending-first", "pending-last"}, loaded)
	require.NotContains(t, prepared, "already-published")
	require.Len(t, prepared, 2)
	require.Equal(t, 32, prepared["pending-first"].attachments[0].Width)
	require.Equal(t, 17, prepared["pending-last"].attachments[0].Height)
	require.Equal(t, "alt", prepared["pending-first"].altTexts[0])
	require.Equal(t, "value", prepared["pending-last"].mediaSettings[0]["key"])
}

func TestBlueskyThreadPreflightFailsClosedOnLoadErrorAndCancellation(t *testing.T) {
	segments := []models.RenditionSegment{{ID: "pending"}}
	prepared, err := prepareBlueskyThreadMedia(t.Context(), segments,
		func(context.Context, string) ([]models.MediaAttachment, []string, []map[string]interface{}, error) {
			return nil, nil, nil, errors.New("cannot load segment media")
		},
		func(context.Context, *models.RenditionSegment, []models.MediaAttachment) error {
			t.Fatal("must not validate after failed load")
			return nil
		})
	require.Nil(t, prepared)
	require.ErrorContains(t, err, "cannot load segment media")

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	prepared, err = prepareBlueskyThreadMedia(ctx, segments,
		func(context.Context, string) ([]models.MediaAttachment, []string, []map[string]interface{}, error) {
			t.Fatal("must not load after cancellation")
			return nil, nil, nil, nil
		},
		func(context.Context, *models.RenditionSegment, []models.MediaAttachment) error {
			return nil
		})
	require.Nil(t, prepared)
	require.ErrorIs(t, err, context.Canceled)
}
