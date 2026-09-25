package capabilities

import (
	"strings"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestTextLengthUsesXWeightedCounting(t *testing.T) {
	tests := []struct {
		name string
		text string
		want int
	}{
		{name: "ASCII", text: "Hello, world!", want: 13},
		{name: "emoji", text: "Hello, world! 👋", want: 16},
		{name: "emoji sequence", text: "👨‍👩‍👧‍👦", want: 2},
		{name: "flag", text: "🇵🇹", want: 2},
		{name: "CJK", text: "日本語", want: 6},
		{name: "URL", text: "See https://example.com/this/is/a/long/path", want: 27},
		{name: "NFC normalization", text: "cafe\u0301", want: 4},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Equal(t, test.want, TextLength(ProviderX, test.text))
		})
	}
}

func TestTextLengthUsesGraphemesForBluesky(t *testing.T) {
	tests := []struct {
		name string
		text string
		want int
	}{
		{name: "ASCII", text: "Hello, world!", want: 13},
		{name: "CJK", text: "日本語", want: 3},
		{name: "combining mark", text: "café", want: 4},
		{name: "skin tone", text: "👍🏽", want: 1},
		{name: "flag", text: "🇵🇹", want: 1},
		{name: "ZWJ sequence", text: "👨‍👩‍👧‍👦", want: 1},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Equal(t, test.want, TextLength(ProviderBluesky, test.text))
		})
	}

	// 151 skin-toned thumbs are 151 graphemes and 302 code points: within
	// Bluesky's 300-grapheme limit, so the body must validate.
	body := strings.Repeat("👍🏽", 151)
	issues := Validate(ProviderBluesky, models.ContentProfileShortText, body, "", "", nil, nil)
	for _, issue := range issues {
		require.NotEqual(t, "text_too_long", issue.Code, issue.Message)
	}
	issues = Validate(ProviderBluesky, models.ContentProfileShortText, strings.Repeat("👍🏽", 301), "", "", nil, nil)
	require.NotEmpty(t, issues)
	require.Equal(t, "text_too_long", issues[0].Code)
}

func TestTextLengthKeepsOtherProvidersAtCodePoints(t *testing.T) {
	require.Equal(t, 3, TextLength(ProviderMastodon, "日本語"))
	require.Equal(t, 5, TextLength(ProviderMastodon, "cafe\u0301"))
}

func TestTextLengthUsesUTF8BytesForThreads(t *testing.T) {
	tests := []struct {
		name string
		text string
		want int
	}{
		{name: "ASCII", text: "OpenPost", want: 8},
		{name: "accented letter", text: "é", want: 2},
		{name: "curly apostrophe", text: "’", want: 3},
		{name: "emoji", text: "👋", want: 4},
		{name: "ZWJ emoji", text: "👨‍👩‍👧‍👦", want: 25},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Equal(t, test.want, TextLength(ProviderThreads, test.text))
		})
	}
}
