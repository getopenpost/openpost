package capabilities_test

import (
	"testing"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestCatalogSettingsHaveAConsumer(t *testing.T) {
	declared := map[string]map[string]capabilities.SettingDefinition{}
	for _, capability := range capabilities.All() {
		if declared[capability.Provider] == nil {
			declared[capability.Provider] = map[string]capabilities.SettingDefinition{}
		}
		for _, setting := range capability.Settings {
			declared[capability.Provider][setting.Key] = setting
		}
	}

	for provider, settings := range declared {
		contract := platform.PublishingSettingsContract(provider)
		consumed := map[string]bool{}
		for _, key := range append(contract.AdapterKeys, contract.PipelineKeys...) {
			consumed[key] = true
			_, exists := settings[key]
			require.Truef(t, exists, "%s adapter consumes %q but the capability catalog does not declare it", provider, key)
		}
		for key, setting := range settings {
			if setting.UnavailableReason != "" {
				continue
			}
			require.Truef(t, consumed[key], "%s declares %q but no adapter or publication pipeline consumes it", provider, key)
		}
	}
}

func TestMediaSettingScopesMatchAdapterContract(t *testing.T) {
	mediaKeys := map[string]bool{
		"alt_text":     true,
		"focal_point":  true,
		"tagged_users": true,
		"user_tags":    true,
		"product_tags": true,
	}
	for _, capability := range capabilities.All() {
		for _, setting := range capability.Settings {
			if !mediaKeys[setting.Key] {
				continue
			}
			require.Equalf(t, capabilities.SettingScopeMediaItem, setting.Scope, "%s %s must be media-item scoped", capability.Provider, setting.Key)
		}
	}
}

func TestIntentSpecificControlsDoNotLeak(t *testing.T) {
	photo := capabilities.Resolve(capabilities.ProviderTikTok, capabilities.ResolveInput{
		Intent: capabilities.IntentPost,
		Segments: []capabilities.ResolveSegment{{
			ID:    "photo",
			Media: []capabilities.MediaItem{{ID: "image", MimeType: "image/jpeg", PublicURLReady: true, URL: "https://example.test/image.jpg"}},
		}},
	})
	video := capabilities.Resolve(capabilities.ProviderTikTok, capabilities.ResolveInput{
		Intent: capabilities.IntentShortVideo,
		Segments: []capabilities.ResolveSegment{{
			ID:    "video",
			Media: []capabilities.MediaItem{{ID: "video", MimeType: "video/mp4", PublicURLReady: true, URL: "https://example.test/video.mp4", AnalysisStatus: "ready"}},
		}},
	})
	require.Contains(t, settingKeys(photo.Settings), "cover_index")
	require.NotContains(t, settingKeys(photo.Settings), "duet")
	require.Contains(t, settingKeys(video.Settings), "duet")
	require.NotContains(t, settingKeys(video.Settings), "cover_index")

	youtubePost := capabilities.Resolve(capabilities.ProviderYouTube, capabilities.ResolveInput{
		Intent:   capabilities.IntentPost,
		Segments: []capabilities.ResolveSegment{{ID: "post", Body: "hello"}},
	})
	require.False(t, youtubePost.Compatible)
	require.Empty(t, youtubePost.Settings)
}

func settingKeys(settings []capabilities.SettingDefinition) []string {
	keys := make([]string, 0, len(settings))
	for _, setting := range settings {
		keys = append(keys, setting.Key)
	}
	return keys
}
