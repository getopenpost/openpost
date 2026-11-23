package publicationsource

import (
	"encoding/json"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/posttext"
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

func TestReusableMentionProjectionPreservesJoinedSourceDecisionsAndPollSuffix(t *testing.T) {
	mention := posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{{Start: 4, End: 10, Text: "@guest", Target: posttext.MentionTarget{Provider: "workspace", Kind: "profile", ID: "saved", Profiles: []posttext.MentionProfile{{Provider: "x", Text: "@guest_x"}}}}}}
	settings, err := json.Marshal(map[string]any{"mentions": mention})
	require.NoError(t, err)
	canonical := []models.PublicationSegment{{ID: "one", Body: " Hi @guest ", SettingsJSON: string(settings)}, {ID: "two", Body: "Plain @guest", SettingsJSON: "{}"}}
	body, projection, err := DeliveryText(canonical, "one", "", nil, nil, true, "Hi @guest\n\nPlain @guest\n\nPoll: Which?", "x", "")
	require.NoError(t, err)
	require.Equal(t, "Hi @guest_x\n\nPlain @guest\n\nPoll: Which?", body)
	require.Empty(t, projection.Spans)
	require.Equal(t, []posttext.ByteRange{{Start: 13, End: 25}}, projection.LegacyRanges)
	empty := ""
	overrides, _ := json.Marshal([]RenditionSourceOverride{{PublicationSegmentID: "one", BodyOverride: &empty, Mentions: &posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{}}}})
	body, _, err = DeliveryText(canonical, "one", string(overrides), nil, nil, true, "Plain @guest", "x", "")
	require.NoError(t, err)
	require.Equal(t, "Plain @guest", body)
}
