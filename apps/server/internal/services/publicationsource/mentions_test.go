package publicationsource

import (
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/posttext"
	"github.com/stretchr/testify/require"
)

func TestStandaloneDestinationSegmentKeepsWholeOverrideMentions(t *testing.T) {
	canonical := []models.PublicationSegment{{ID: "source-1", Body: "Canonical text", SettingsJSON: "{}"}}
	body := "Extra reply for @Acme"
	mentions := posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{{
		Start: 16, End: 21, Text: "@Acme",
		Target: posttext.MentionTarget{Provider: "linkedin", Kind: "page", ID: "urn:li:organization:123"},
	}}}
	settings := map[string]any{posttext.SettingsKey: mentions}

	resolved, projection, err := ResolveMentions(canonical, "", "", &body, settings, false)
	require.NoError(t, err)
	require.Equal(t, body, resolved)
	require.NotNil(t, projection)
	require.Equal(t, mentions.Spans, projection.Spans)

	resolved, projection, err = ResolveMentions(canonical, "", "", &body, map[string]any{}, false)
	require.NoError(t, err)
	require.Equal(t, body, resolved)
	require.Nil(t, projection)

	_, _, err = ResolveMentions(canonical, "", "", nil, settings, false)
	require.ErrorIs(t, err, posttext.ErrInvalid)
}
