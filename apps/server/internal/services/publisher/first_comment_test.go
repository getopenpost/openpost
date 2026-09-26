package publisher

import (
	"context"
	"errors"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

type firstCommentFakeAdapter struct {
	fakePublisherAdapter
	commentErr error
	commentID  string
	postedTo   string
	postedMsg  string
	calls      int
}

func (f *firstCommentFakeAdapter) PostFirstComment(_ context.Context, _, _, externalID, message string) (string, error) {
	f.calls++
	f.postedTo = externalID
	f.postedMsg = message
	if f.commentErr != nil {
		return "", f.commentErr
	}
	if f.commentID != "" {
		return f.commentID, nil
	}
	return "comment-1", nil
}

func TestFirstCommentMessageIsCapabilityGated(t *testing.T) {
	require.Equal(t, "hi", firstCommentMessageForPublish("instagram", map[string]any{"first_comment": "hi"}))
	require.Equal(t, "hi", firstCommentMessageForPublish("youtube", map[string]any{"first_comment": "hi"}))
	require.Equal(t, "hi", firstCommentMessageForPublish("linkedin", map[string]any{"first_comment": "hi"}))
	require.Empty(t, firstCommentMessageForPublish("x", map[string]any{"first_comment": "hi"}))
	require.Empty(t, firstCommentMessageForPublish("instagram", map[string]any{}))
}

func TestFirstCommentSettingsPreferRootSegment(t *testing.T) {
	got := firstCommentSettingsForSegments(
		map[string]any{"first_comment": "destination"},
		[]models.RenditionSegment{{SettingsJSON: `{"first_comment":"segment"}`}},
	)
	require.Equal(t, "segment", got["first_comment"])
	require.Equal(t, "destination", firstCommentSettingsForSegments(map[string]any{"first_comment": "destination"}, nil)["first_comment"])
}

func TestPublishFirstCommentBestEffortNeverFailsParent(t *testing.T) {
	service := NewService(nil, nil)
	publication := &models.Publication{ID: "pub-1", WorkspaceID: "ws-1"}
	rendition := &models.Rendition{ID: "ren-1", Platform: "instagram"}

	failing := &firstCommentFakeAdapter{commentErr: errors.New("provider down")}
	require.NotPanics(t, func() {
		service.publishFirstCommentBestEffort(context.Background(), publication, rendition, failing, "token", "acct-1", "media-1", map[string]any{"first_comment": "Nice!"})
	})
	require.Equal(t, 1, failing.calls)
	require.Equal(t, "media-1", failing.postedTo)

	quiet := &firstCommentFakeAdapter{}
	require.NotPanics(t, func() {
		service.publishFirstCommentBestEffort(context.Background(), publication, rendition, quiet, "token", "acct-1", "media-1", map[string]any{})
	})
	require.Equal(t, 0, quiet.calls, "empty message posts no child operation")

	unsupported := &fakePublisherAdapter{}
	require.NotPanics(t, func() {
		service.publishFirstCommentBestEffort(context.Background(), publication, &models.Rendition{ID: "ren-2", Platform: "x"}, unsupported, "token", "acct-1", "post-1", map[string]any{"first_comment": "hi"})
	})

	_ = platform.SupportsFirstComment
}
