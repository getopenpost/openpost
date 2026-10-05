package publicationlink

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLinkChoiceFollowsAccountTextWithoutReplacingExplicitMetadata(t *testing.T) {
	source := map[string]any{"link": map[string]any{"destinations": map[string]any{"account": map[string]any{"mode": "post"}}}}
	settings := map[string]any{"link_url": "https://shared.example/old", "link_title": "Authored title"}
	values, err := Resolve(source, "account", "bluesky", "An account update https://account.example/new", settings, 0)
	require.NoError(t, err)
	require.Equal(t, "https://account.example/new", values["link_url"])
	require.Equal(t, "Authored title", values["link_title"])
	require.Equal(t, "https://shared.example/old", settings["link_url"])
	values, err = Resolve(source, "account", "bluesky", "No URL any more", values, 0)
	require.NoError(t, err)
	require.Empty(t, values["link_url"])
}

func TestCustomAndLegacyURLsRemainIndependentOfCaption(t *testing.T) {
	for _, mode := range []Mode{ModeCustom, ModeLegacy} {
		t.Run(string(mode), func(t *testing.T) {
			source := map[string]any{"link": map[string]any{"destinations": map[string]any{"account": map[string]any{"mode": mode, "url": "https://custom.example/card"}}}}
			settings := map[string]any{"url": "https://legacy.example/card"}
			values, err := Resolve(source, "account", "linkedin", "Caption https://account.example/post", settings, 0)
			require.NoError(t, err)
			if mode == ModeCustom {
				require.Equal(t, "https://custom.example/card", values["url"])
			} else {
				require.Equal(t, "https://legacy.example/card", values["url"])
			}
		})
	}
}

func TestInheritedURLDoesNotCompeteWithMediaButExplicitBlueskyCardDoes(t *testing.T) {
	source := map[string]any{"link": map[string]any{"destinations": map[string]any{"account": map[string]any{"mode": "post"}}}}
	values, err := Resolve(source, "account", "bluesky", "Caption https://example.com", map[string]any{}, 1)
	require.NoError(t, err)
	require.Empty(t, values["link_url"])
	source["link"].(map[string]any)["destinations"].(map[string]any)["account"] = map[string]any{"mode": "custom", "url": "https://example.com"}
	_, err = Resolve(source, "account", "bluesky", "Caption", values, 1)
	require.ErrorContains(t, err, "cannot be combined with media")
}

func TestDestinationQuoteSuppressesInheritedCardWithoutMovingSettingsOwnership(t *testing.T) {
	source := map[string]any{"link": map[string]any{"destinations": map[string]any{"account": map[string]any{"mode": "post"}}}}
	destination := map[string]any{"quote_url": "https://bsky.app/profile/person.test/post/abc", "link_title": "Original title"}
	segment := map[string]any{"link_url": "https://stale.example"}
	values, err := ResolveEffective(source, "account", "bluesky", "Caption https://example.com", destination, segment, 0)
	require.NoError(t, err)
	require.Empty(t, values["link_url"])
	require.NotContains(t, values, "quote_url")
	require.NotContains(t, values, "link_title")
	require.Equal(t, "https://stale.example", segment["link_url"])
	source["link"].(map[string]any)["destinations"].(map[string]any)["account"] = map[string]any{"mode": "custom", "url": "https://example.com"}
	_, err = ResolveEffective(source, "account", "bluesky", "Caption", destination, segment, 0)
	require.ErrorContains(t, err, "cannot be combined with a quote")
}
