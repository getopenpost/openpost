package capabilities

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

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

// TestPlatformTextCountsMatchSharedFixture exercises the Go counters against
// the same inputs the TypeScript counter asserts, so X weighted counting and
// Mastodon URL shortening stay identical in both languages.
func TestPlatformTextCountsMatchSharedFixture(t *testing.T) {
	t.Parallel()
	fixture := loadPlatformTextFixture(t)
	for _, count := range fixture.Counts {
		require.Equal(t, count.Expected, TextLength(count.Platform, count.Text),
			"platform %q text %q", count.Platform, count.Text)
	}
}
