package capabilities

import (
	"strings"
	"testing"

	"github.com/openpost/backend/internal/textcards"
	"github.com/stretchr/testify/require"
)

// TestTextCardCatalogueOptionsParseThroughRenderer guards
// getopenpost/openpost#420: the renderer owns the allowed text-card values
// and defaults, and the capability catalogue derives from it. Every option
// the composer offers must parse successfully through textcards.Parse, so
// adding an option to textcards reaches the composer with no second edit.
// TestProjectTextCardsDoesNotMutateCallerSegments guards destination
// resolution from racing on shared input: joining and card projection rewrite
// the first segment's media, and callers resolve several destinations from the
// same segment slice.
func TestProjectTextCardsDoesNotMutateCallerSegments(t *testing.T) {
	t.Parallel()
	segments := []ResolveSegment{{
		ID:    "segment-1",
		Body:  "hello",
		Media: []MediaItem{{ID: "media-1"}, {ID: "media-1"}},
	}}

	projectTextCards("instagram", "instagram.feed", segments, nil)

	require.Len(t, segments[0].Media, 2, "projection must not rewrite the caller's media")
}

func TestTextCardCatalogueOptionsParseThroughRenderer(t *testing.T) {
	t.Parallel()
	defs := TextCardSettings()
	byKey := make(map[string]SettingDefinition, len(defs))
	for _, def := range defs {
		byKey[def.Key] = def
	}

	require.Equal(t, textcards.ModeOptions, byKey["text_card"].Options, "mode options derive from textcards")
	require.Equal(t, textcards.AppearanceOptions, byKey["text_card_appearance"].Options, "appearance options derive from textcards")
	require.Equal(t, textcards.BackgroundOptions, byKey["text_card_background"].Options, "background options derive from textcards")
	require.Equal(t, textcards.DefaultStyle.Mode, byKey["text_card"].Default)
	require.Equal(t, textcards.DefaultStyle.Appearance, byKey["text_card_appearance"].Default)
	require.Equal(t, textcards.DefaultStyle.Background, byKey["text_card_background"].Default)
	require.Equal(t, textcards.DefaultStyle.Color, byKey["text_card_color"].Default)
	require.Equal(t, textcards.DefaultStyle.ColorEnd, byKey["text_card_color_end"].Default)
	require.Equal(t, textcards.DefaultStyle.Rounded, byKey["text_card_rounded"].Default)
	require.Equal(t, textcards.DefaultStyle.Shadow, byKey["text_card_shadow"].Default)

	for _, mode := range byKey["text_card"].Options {
		style, err := textcards.Parse(map[string]any{"text_card": mode})
		require.NoError(t, err, "catalogue mode %q parses", mode)
		require.Equal(t, mode, style.Mode)
	}
	for _, appearance := range byKey["text_card_appearance"].Options {
		style, err := textcards.Parse(map[string]any{"text_card_appearance": appearance})
		require.NoError(t, err, "catalogue appearance %q parses", appearance)
		require.Equal(t, appearance, style.Appearance)
	}
	for _, background := range byKey["text_card_background"].Options {
		style, err := textcards.Parse(map[string]any{"text_card_background": background})
		require.NoError(t, err, "catalogue background %q parses", background)
		require.Equal(t, background, style.Background)
	}

	empty, err := textcards.Parse(map[string]any{})
	require.NoError(t, err)
	require.Equal(t, textcards.DefaultStyle, empty, "empty settings parse to the owned defaults")
}

func TestTextCardsResolveTheDeliveredMediaShape(t *testing.T) {
	t.Parallel()
	for _, provider := range []string{ProviderInstagram, ProviderPixelfed} {
		t.Run(provider, func(t *testing.T) {
			resolved := Resolve(provider, ResolveInput{Settings: map[string]any{"text_card": "always"}, Segments: []ResolveSegment{{ID: "source", Body: "A small release worth sharing."}}})
			require.True(t, resolved.Compatible, "%+v", resolved.Issues)
			require.Equal(t, MediaShapeSingleImage, resolved.ActiveConstraints["media_shape"])
			withPhoto := Resolve(provider, ResolveInput{Settings: map[string]any{"text_card": "always"}, Segments: []ResolveSegment{{ID: "source", Body: "A small release worth sharing.", Media: []MediaItem{{ID: "photo", MimeType: "image/jpeg", Width: 1080, Height: 1350, PublicURLReady: true}}}}})
			require.True(t, withPhoto.Compatible, "%+v", withPhoto.Issues)
			require.Equal(t, provider+".carousel", withPhoto.OutputProfile)
			withLink := Resolve(provider, ResolveInput{Settings: map[string]any{"text_card": "always", "url": "https://example.com/post"}, Segments: []ResolveSegment{{ID: "source", Body: "Read https://example.com/post"}}})
			require.True(t, withLink.Compatible, "%+v", withLink.Issues)
		})
	}
}

func TestTextCardsRespectNativeFormatsAndCarouselLimits(t *testing.T) {
	t.Parallel()
	story := Resolve(ProviderInstagram, ResolveInput{CreationPreset: "story", Settings: map[string]any{"text_card": "text_only"}, Segments: []ResolveSegment{{Body: "A story worth sharing."}}})
	require.True(t, story.Compatible, "%+v", story.Issues)
	require.Equal(t, "instagram.story", story.OutputProfile)
	photos := make([]MediaItem, 10)
	for i := range photos {
		photos[i] = MediaItem{ID: strings.Repeat("p", i+1), MimeType: "image/jpeg", Width: 1080, Height: 1350, PublicURLReady: true}
	}
	tooMany := Resolve(ProviderInstagram, ResolveInput{Settings: map[string]any{"text_card": "always"}, Segments: []ResolveSegment{{Body: "A caption.", Media: photos}}})
	require.False(t, tooMany.Compatible, "the generated image counts toward the carousel limit")
	unchanged := Resolve(ProviderInstagram, ResolveInput{RequestedOutputProfile: "instagram.carousel", Settings: map[string]any{"text_card": "text_only"}, Segments: []ResolveSegment{{Body: "A caption.", Media: photos}}})
	require.True(t, unchanged.Compatible, "%+v", unchanged.Issues)
	for _, mode := range []string{"off", "text_only"} {
		issues := ValidateOutput(ProviderInstagram, "instagram.carousel", "", strings.Repeat("x", 2201), "", "", photos, map[string]any{"text_card": mode})
		for _, issue := range issues {
			require.NotEqual(t, "text_card_invalid", issue.Code, "an ordinary media post uses native caption limits")
		}
	}
	reel := Resolve(ProviderInstagram, ResolveInput{RequestedOutputProfile: "instagram.reel", Settings: map[string]any{"text_card": "always"}, Segments: []ResolveSegment{{Body: "A reel still needs a video."}}})
	require.False(t, reel.Compatible)
	for _, issue := range reel.Issues {
		require.NotEqual(t, "text_card_applied", issue.Code)
	}
}

func TestTextCardsDeduplicateSharedSourceAttachments(t *testing.T) {
	t.Parallel()
	photos := []MediaItem{{ID: "one", MimeType: "image/jpeg", Width: 1080, Height: 1350}, {ID: "two", MimeType: "image/jpeg", Width: 1080, Height: 1350}, {ID: "three", MimeType: "image/jpeg", Width: 1080, Height: 1350}}
	resolved := Resolve(ProviderPixelfed, ResolveInput{Settings: map[string]any{"text_card": "always"}, Segments: []ResolveSegment{{ID: "a", Body: "First", Media: photos}, {ID: "b", Body: "Second", Media: photos}}})
	require.True(t, resolved.Compatible, "%+v", resolved.Issues)
}
