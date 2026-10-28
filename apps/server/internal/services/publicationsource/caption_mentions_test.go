package publicationsource

import (
	"github.com/openpost/backend/internal/posttext"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestIndependentCaptionMentionProjection(t *testing.T) {
	caption := &CaptionMentions{Field: "description", Body: "🎬 Hi @alice", Mentions: &posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{{Start: 8, End: 14, Text: "@alice", Target: posttext.MentionTarget{Provider: "workspace", Kind: "profile", ID: "alice", Profiles: []posttext.MentionProfile{{Provider: "youtube", Text: "@alice_video"}}}}}}}
	settings := map[string]any{CaptionMentionsKey: caption}
	field, body, err := DeliveryCaption(settings, "youtube", "")
	require.NoError(t, err)
	require.Equal(t, "description", field)
	require.Equal(t, "🎬 Hi @alice_video", body)
	require.Equal(t, "🎬 Hi @alice", caption.Body)
	caption.Mentions.Spans[0].Target.ID = "other-identity"
	_, body, err = DeliveryCaption(settings, "youtube", "")
	require.NoError(t, err)
	require.Equal(t, "🎬 Hi @alice_video", body)
	caption.Mentions.Spans = []posttext.MentionSpan{}
	_, body, err = DeliveryCaption(settings, "youtube", "")
	require.NoError(t, err)
	require.Equal(t, caption.Body, body)
	settings[CaptionMentionsKey] = nil
	field, _, err = DeliveryCaption(settings, "youtube", "")
	require.NoError(t, err)
	require.Empty(t, field)
}

func TestCaptionMentionValidation(t *testing.T) {
	for _, value := range []any{
		map[string]any{"field": "description", "body": "Hi", "mentions": nil},
		map[string]any{"field": "body", "body": "Hi", "mentions": posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{}}},
		map[string]any{"field": "description", "body": "Hi", "mentions": posttext.Mentions{Version: 2, Spans: []posttext.MentionSpan{}}},
	} {
		_, _, err := DeliveryCaption(map[string]any{CaptionMentionsKey: value}, "youtube", "")
		require.Error(t, err)
	}
	_, _, err := DeliveryCaption(map[string]any{CaptionMentionsKey: CaptionMentions{Field: "description", Body: "Hi", Mentions: &posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{}}}}, "bluesky", "")
	require.Error(t, err)
}
