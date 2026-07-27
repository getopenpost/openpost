package capabilities

import (
	"strings"
	"testing"

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

func TestTextLengthKeepsOtherProvidersAtCodePoints(t *testing.T) {
	require.Equal(t, 3, TextLength(ProviderMastodon, "日本語"))
	require.Equal(t, 5, TextLength(ProviderMastodon, "cafe\u0301"))
}

func TestXWeightedTextLimitHandlesASCIIAndCJK(t *testing.T) {
	const standardLimit = 280
	require.Equal(t, standardLimit, TextLength(ProviderX, strings.Repeat("x", standardLimit)))
	require.Equal(t, standardLimit, TextLength(ProviderX, strings.Repeat("界", standardLimit/2)))
}
