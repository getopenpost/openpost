package platform

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// The capability cache trusts each adapter to declare every input that can
// change its provider answer. These assertions pin that contract.
func TestAccountCapabilityKeyInputs(t *testing.T) {
	t.Parallel()
	base := AccountCapabilityInput{
		Intent:        "post",
		OutputProfile: "x.post",
		MediaShape:    "text",
		Locale:        "en-US",
		RegionCode:    "US",
		Settings:      map[string]interface{}{"channel_id": " 123 "},
	}

	t.Run("x ignores every input", func(t *testing.T) {
		key := (&XAdapter{}).AccountCapabilityKeyInput(base)
		changed := base
		changed.Intent = "short_video"
		changed.Settings = map[string]interface{}{"community_id": "two"}
		require.Equal(t, key, (&XAdapter{}).AccountCapabilityKeyInput(changed))
	})

	t.Run("bluesky keys media shape intent and profile", func(t *testing.T) {
		key := (&BlueskyAdapter{}).AccountCapabilityKeyInput(base)
		video := base
		video.MediaShape = "short_video"
		require.NotEqual(t, key, (&BlueskyAdapter{}).AccountCapabilityKeyInput(video))
		otherSettings := base
		otherSettings.Settings = map[string]interface{}{"made_with_ai": true}
		require.Equal(t, key, (&BlueskyAdapter{}).AccountCapabilityKeyInput(otherSettings))
	})

	t.Run("discord keys the trimmed channel", func(t *testing.T) {
		key := (&DiscordBotAdapter{}).AccountCapabilityKeyInput(base)
		require.Equal(t, "123", key)
		otherChannel := base
		otherChannel.Settings = map[string]interface{}{"channel_id": "456"}
		require.NotEqual(t, key, (&DiscordBotAdapter{}).AccountCapabilityKeyInput(otherChannel))
	})

	t.Run("tiktok keys only the posting method", func(t *testing.T) {
		direct := base
		direct.Settings = map[string]interface{}{"content_posting_method": "DIRECT_POST"}
		upload := base
		upload.Settings = map[string]interface{}{"content_posting_method": "UPLOAD"}
		require.NotEqual(t,
			(&TikTokAdapter{}).AccountCapabilityKeyInput(direct),
			(&TikTokAdapter{}).AccountCapabilityKeyInput(upload),
		)
		otherPrivacy := direct
		otherPrivacy.Settings = map[string]interface{}{
			"content_posting_method": "DIRECT_POST", "privacy_level": "SELF_ONLY",
		}
		require.Equal(t,
			(&TikTokAdapter{}).AccountCapabilityKeyInput(direct),
			(&TikTokAdapter{}).AccountCapabilityKeyInput(otherPrivacy),
		)
	})

	t.Run("youtube keys language and a normalized region", func(t *testing.T) {
		key := (&YouTubeAdapter{}).AccountCapabilityKeyInput(base)
		empty := base
		empty.RegionCode = ""
		empty.Locale = "de-DE"
		require.NotEqual(t, key, (&YouTubeAdapter{}).AccountCapabilityKeyInput(empty))
		shortLocale := base
		shortLocale.Locale = "en"
		require.Equal(t, key, (&YouTubeAdapter{}).AccountCapabilityKeyInput(shortLocale))
	})

	t.Run("google business ignores locale and region", func(t *testing.T) {
		key := (&GoogleBusinessAdapter{}).AccountCapabilityKeyInput(base)
		changed := base
		changed.Locale = "de-DE"
		changed.RegionCode = "DE"
		require.Equal(t, key, (&GoogleBusinessAdapter{}).AccountCapabilityKeyInput(changed))
	})

	t.Run("instance-based adapters ignore account input", func(t *testing.T) {
		changed := base
		changed.Settings = map[string]interface{}{"anything": "different"}
		require.Equal(t, "", (&MastodonAdapter{}).AccountCapabilityKeyInput(changed))
		require.Equal(t, "", (&PixelfedAdapter{}).AccountCapabilityKeyInput(changed))
		require.Equal(t, "", (&PeerTubeAdapter{}).AccountCapabilityKeyInput(changed))
	})
}
