package capabilities

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/openpost/backend/internal/providerlimits"
	"github.com/stretchr/testify/require"
)

type platformTextFixture struct {
	Constants struct {
		XStandardCharLimit         int `json:"x_standard_char_limit"`
		XPremiumCharLimit          int `json:"x_premium_char_limit"`
		YouTubeDescriptionMaxBytes int `json:"youtube_description_max_bytes"`
		XTransformedURLLength      int `json:"x_transformed_url_length"`
		MastodonURLLength          int `json:"mastodon_url_length"`
	} `json:"constants"`
	Limits map[string]int `json:"limits"`
	Counts []struct {
		Platform string `json:"platform"`
		Text     string `json:"text"`
		Expected int    `json:"expected"`
	} `json:"counts"`
}

func loadPlatformTextFixture(t *testing.T) platformTextFixture {
	t.Helper()
	_, caller, _, ok := runtime.Caller(0)
	require.True(t, ok, "runtime caller is available")
	path := filepath.Join(filepath.Dir(caller), "..", "..", "..", "..",
		"packages", "platform-text", "conformance", "fixtures.json")
	raw, err := os.ReadFile(path)
	require.NoError(t, err, "shared platform-text fixture is readable")
	var fixture platformTextFixture
	require.NoError(t, json.Unmarshal(raw, &fixture))
	require.NotEmpty(t, fixture.Limits)
	require.NotEmpty(t, fixture.Counts)
	return fixture
}

// TestPlatformTextLimitsMatchSharedFixture guards the drift described in
// getopenpost/openpost#415: the TypeScript composer and the Go validators
// carry the same text limits in different languages. ProviderTextLimit is
// the generic per-provider limit the composer mirrors, so it must equal the
// fixture value for every shared platform.
func TestPlatformTextLimitsMatchSharedFixture(t *testing.T) {
	fixture := loadPlatformTextFixture(t)

	for provider, want := range fixture.Limits {
		limit, ok := ProviderTextLimit(provider)
		require.True(t, ok, "provider %q has a Go text limit", provider)
		require.Equal(t, want, limit, "provider %q text limit", provider)
	}

	t.Run("X tiers", func(t *testing.T) {
		standard, ok := ProviderTextLimit(ProviderX)
		require.True(t, ok)
		require.Equal(t, fixture.Constants.XStandardCharLimit, standard)
		for _, capability := range All() {
			if capability.Provider == ProviderX {
				require.Equal(t, fixture.Constants.XPremiumCharLimit, capability.TextLimit,
					"X catalog entry %s", capability.Profile)
			}
		}
	})

	t.Run("YouTube description", func(t *testing.T) {
		require.Equal(t, fixture.Constants.YouTubeDescriptionMaxBytes,
			providerlimits.YouTubeDescriptionMaxBytes)
		for _, capability := range All() {
			if capability.Provider == ProviderYouTube {
				require.Equal(t, providerlimits.YouTubeDescriptionMaxBytes, capability.TextLimit,
					"YouTube catalog entry %s", capability.Profile)
			}
		}
	})

	t.Run("URL shortening lengths", func(t *testing.T) {
		require.Equal(t, fixture.Constants.XTransformedURLLength, providerlimits.XTransformedURLLength)
		require.Equal(t, fixture.Constants.MastodonURLLength, providerlimits.MastodonCountedURLLength)
	})
}

// TestPlatformTextCountsMatchSharedFixture exercises the Go counters against
// the same inputs the TypeScript counter asserts, so X weighted counting and
// Mastodon URL shortening stay identical in both languages.
func TestPlatformTextCountsMatchSharedFixture(t *testing.T) {
	fixture := loadPlatformTextFixture(t)
	for _, count := range fixture.Counts {
		require.Equal(t, count.Expected, TextLength(count.Platform, count.Text),
			"platform %q text %q", count.Platform, count.Text)
	}
}
