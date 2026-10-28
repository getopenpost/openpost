package capabilities

import (
	"strings"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestTextLengthBoundariesMatchProviderLimits(t *testing.T) {
	longURL := "https://example.com/" + strings.Repeat("a", 80)

	t.Run("X weighted URL boundary", func(t *testing.T) {
		atLimit := strings.Repeat("a", 256) + " " + longURL
		overLimit := strings.Repeat("a", 257) + " " + longURL
		require.Equal(t, 280, TextLength(ProviderX, atLimit))
		require.Equal(t, 281, TextLength(ProviderX, overLimit))
		standard, ok := ProviderTextLimit(ProviderX)
		require.True(t, ok, "X has a canonical text limit")
		require.Equal(t, 280, standard)
	})

	t.Run("Bluesky grapheme boundary", func(t *testing.T) {
		// Skin-toned thumbs are 1 grapheme but 2 code points each, so the
		// boundary must be measured in graphemes, not code points.
		atLimit := strings.Repeat("👍🏽", 300)
		overLimit := strings.Repeat("👍🏽", 301)
		require.Equal(t, 300, TextLength(ProviderBluesky, atLimit))
		require.Equal(t, 301, TextLength(ProviderBluesky, overLimit))
		issues := Validate(ProviderBluesky, models.ContentProfileShortText, atLimit, "", "", nil, nil)
		for _, issue := range issues {
			require.NotEqual(t, "text_too_long", issue.Code, issue.Message)
		}
		issues = Validate(ProviderBluesky, models.ContentProfileShortText, overLimit, "", "", nil, nil)
		require.NotEmpty(t, issues)
		require.Equal(t, "text_too_long", issues[0].Code)
	})

	t.Run("Mastodon URL validation", func(t *testing.T) {
		body := strings.Repeat("a", 450) + " " + longURL
		issues := Validate(ProviderMastodon, models.ContentProfileShortText, body, "", "", nil, nil)
		requireNoIssueCode(t, issues, "text_too_long")
		issues = Validate(ProviderMastodon, models.ContentProfileShortText, strings.Repeat("a", 477)+" "+longURL, "", "", nil, nil)
		requireIssueCode(t, issues, "text_too_long")
	})

	t.Run("Mastodon remote mention boundary", func(t *testing.T) {
		// "@alice@example.social" counts as "@alice" (6 characters) even
		// though the raw mention is 20 characters.
		atLimit := strings.Repeat("a", 493) + " @alice@example.social"
		overLimit := strings.Repeat("a", 494) + " @alice@example.social"
		require.Equal(t, 500, TextLength(ProviderMastodon, atLimit))
		require.Equal(t, 501, TextLength(ProviderMastodon, overLimit))
		issues := Validate(ProviderMastodon, models.ContentProfileShortText, atLimit, "", "", nil, nil)
		for _, issue := range issues {
			require.NotEqual(t, "text_too_long", issue.Code, issue.Message)
		}
		issues = Validate(ProviderMastodon, models.ContentProfileShortText, overLimit, "", "", nil, nil)
		require.NotEmpty(t, issues)
		require.Equal(t, "text_too_long", issues[0].Code)
	})
}

func TestTextLengthKeepsOtherProvidersAtCodePoints(t *testing.T) {
	require.Equal(t, 3, TextLength(ProviderMastodon, "日本語"))
	require.Equal(t, 5, TextLength(ProviderMastodon, "cafe\u0301"))
}
