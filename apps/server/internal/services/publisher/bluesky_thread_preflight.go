package publisher

import (
	"context"
	"fmt"

	"github.com/openpost/backend/internal/models"
)

// blueskyPreparedSegmentMedia retains the exact, inspected attachment snapshot
// so the publish loop does not repeat object reads or lose recovered dimensions.
type blueskyPreparedSegmentMedia struct {
	attachments   []models.MediaAttachment
	altTexts      []string
	mediaSettings []map[string]interface{}
}

type blueskyThreadPreflightError struct {
	segmentID string
	cause     error
}

func (e *blueskyThreadPreflightError) Error() string {
	return fmt.Sprintf("bluesky thread segment %s preflight failed: %v", e.segmentID, e.cause)
}

func (e *blueskyThreadPreflightError) Unwrap() error {
	return e.cause
}

// prepareBlueskyThreadMedia validates every unpublished segment before the
// caller performs its first provider write. Published segments are not loaded
// or republished, preserving existing resume semantics.
func prepareBlueskyThreadMedia(
	ctx context.Context,
	segments []models.RenditionSegment,
	load func(context.Context, string) ([]models.MediaAttachment, []string, []map[string]interface{}, error),
	check func(context.Context, *models.RenditionSegment, []models.MediaAttachment) error,
) (map[string]blueskyPreparedSegmentMedia, error) {
	prepared := make(map[string]blueskyPreparedSegmentMedia, len(segments))
	for i := range segments {
		segment := &segments[i]
		if segment.Status == models.RenditionStatusPublished {
			continue
		}
		if err := ctx.Err(); err != nil {
			return nil, &blueskyThreadPreflightError{segmentID: segment.ID, cause: err}
		}
		attachments, altTexts, mediaSettings, err := load(ctx, segment.ID)
		if err == nil {
			err = check(ctx, segment, attachments)
		}
		if err != nil {
			return nil, &blueskyThreadPreflightError{segmentID: segment.ID, cause: err}
		}
		prepared[segment.ID] = blueskyPreparedSegmentMedia{
			attachments: attachments, altTexts: altTexts, mediaSettings: mediaSettings,
		}
	}
	return prepared, nil
}
