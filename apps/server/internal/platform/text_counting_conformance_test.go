package platform

import (
	"strings"
	"testing"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/providerlimits"
	"github.com/stretchr/testify/require"
)

// TestValidateBlueskyTextMatchesCanonicalCounter fails when the delivery-side
// Bluesky validator disagrees with capabilities.TextLength, the single server
// counter (getopenpost/openpost#417). Both sides must make the same
// accept/reject decision at the grapheme and byte boundaries, including for
// text where graphemes and code points diverge.
func TestValidateBlueskyTextMatchesCanonicalCounter(t *testing.T) {
	t.Parallel()
	texts := []string{
		"",
		"Hello, world!",
		"日本語の投稿",
		"café",
		"👍🏽",
		"🇵🇹",
		"👨‍👩‍👧‍👦",
		"a 🇵🇹 👍🏽 ZWJ 👨‍👩‍👧‍👦 mix",
		strings.Repeat("a", 299),
		strings.Repeat("a", 300),
		strings.Repeat("a", 301),
		// Skin-toned thumbs are 1 grapheme but 2 code points each: 300 of
		// them fit in 300 graphemes while exceeding 300 code points.
		strings.Repeat("👍🏽", 299),
		strings.Repeat("👍🏽", 300),
		strings.Repeat("👍🏽", 301),
		// "é" is 1 grapheme but 2 bytes: 1500 fit in 3000 bytes while
		// exceeding 300 graphemes.
		strings.Repeat("é", 300),
		strings.Repeat("é", 1500),
		strings.Repeat("é", 1501),
	}

	for _, text := range texts {
		canonical := capabilities.TextLength(capabilities.ProviderBluesky, text)
		tooLong := canonical > providerlimits.BlueskyPostMaxGraphemes ||
			len(text) > providerlimits.BlueskyPostMaxBytes
		err := validateBlueskyText(text)
		if tooLong {
			require.Error(t, err, "text with %d graphemes and %d bytes must be rejected",
				canonical, len(text))
		} else {
			require.NoError(t, err, "text with %d graphemes and %d bytes must be accepted",
				canonical, len(text))
		}
	}
}

// TestXTextLimitsMatchCanonicalLimits fails when the X adapter's limits
// disagree with the canonical server limits (getopenpost/openpost#417). The
// 280 standard limit is declared once in providerlimits; ProviderTextLimit
// stays the limit owner for account-unaware validation and the catalog
// carries the premium limit.
func TestXTextLimitsMatchCanonicalLimits(t *testing.T) {
	t.Parallel()
	require.Equal(t, 280, providerlimits.XStandardTextLimit, "canonical X standard limit")
	require.Equal(t, 25_000, providerlimits.XPremiumTextLimit, "canonical X premium limit")

	require.Equal(t, providerlimits.XStandardTextLimit, XStandardTextLimit,
		"adapter standard limit must reference the single declaration")
	require.Equal(t, providerlimits.XPremiumTextLimit, XPremiumTextLimit,
		"adapter premium limit must reference the single declaration")

	standard, ok := capabilities.ProviderTextLimit(capabilities.ProviderX)
	require.True(t, ok, "X has a canonical text limit")
	require.Equal(t, XStandardTextLimit, standard,
		"adapter standard limit must match the limit owner")

	for _, capability := range capabilities.All() {
		if capability.Provider != capabilities.ProviderX {
			continue
		}
		require.Equal(t, XPremiumTextLimit, capability.TextLimit,
			"X catalog entry %s", capability.Profile)
	}
}
