package handlers

import (
	"encoding/json"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/posttext"
	"github.com/openpost/backend/internal/services/publicationsource"
	"github.com/stretchr/testify/require"
)

func TestNativeCaptionLegacyClearAndProjectionEcho(t *testing.T) {
	t.Parallel()
	caption := &publicationsource.CaptionMentions{Field: "description", Body: "Hi @alice", Mentions: &posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{{Start: 3, End: 9, Text: "@alice", Target: posttext.MentionTarget{Provider: "workspace", Kind: "profile", ID: "caption-person", Profiles: []posttext.MentionProfile{{Provider: "youtube", Text: "@alice_video"}}}}}}}
	data, err := json.Marshal(map[string]any{publicationsource.CaptionMentionsKey: caption})
	require.NoError(t, err)
	old := models.RenditionSegment{SettingsJSON: string(data)}
	account := models.SocialAccount{Platform: "youtube"}
	t.Run("replacement cannot silently discard selected caption identities", func(t *testing.T) {
		require.ErrorIs(t, preserveRenditionSegmentMentions(&RenditionInput{}, []models.RenditionSegment{old}, nil, account), posttext.ErrMetadataRequired)
	})
	for _, actual := range []string{"", "Hi @alice_video"} {
		input := &RenditionInput{Settings: map[string]any{"description": actual}}
		next := &RenditionSegmentInput{Description: actual}
		require.NoError(t, preserveCaptionMentionInput(input, next, old, account))
		kept, err := publicationsource.ReadCaptionMentions(next.Settings)
		require.NoError(t, err)
		if actual == "" {
			require.Empty(t, kept.Body)
			require.Empty(t, kept.Mentions.Spans)
			require.Equal(t, "", input.Settings["description"])
		} else {
			require.Equal(t, "Hi @alice", kept.Body)
			require.Equal(t, "caption-person", kept.Mentions.Spans[0].Target.ID)
			require.Equal(t, 3, kept.Mentions.Spans[0].Start)
			require.Equal(t, "Hi @alice", input.Settings["description"])
		}
	}
}
