package capabilities

import (
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestCaptionResetDoesNotBlockPublishing(t *testing.T) {
	imageMedia := []MediaItem{{ID: "image", MimeType: "image/jpeg", Size: 1024, Width: 1080, Height: 1080, URL: "https://example.com/image.jpg", PublicURLReady: true}}
	for _, provider := range []string{ProviderInstagram, ProviderDiscord, ProviderFacebook} {
		contents := []struct {
			name, profile, body string
			media               []MediaItem
		}{
			{name: "image only", profile: models.ContentProfileImagePost, media: imageMedia},
			{name: "image caption", profile: models.ContentProfileImagePost, body: "Hello 🌍 #launch", media: imageMedia},
		}
		// Instagram feed has no text-only profile; Facebook and Discord do.
		if provider != ProviderInstagram {
			contents = append([]struct {
				name, profile, body string
				media               []MediaItem
			}{{name: "text only", profile: models.ContentProfileShortText, body: "hi"}}, contents...)
		}
		for _, content := range contents {
			t.Run(provider+"/"+content.name, func(t *testing.T) {
				// Compare with the same post without the composer's reset marker:
				// genuine media/format restrictions must remain unchanged.
				baseline := Validate(provider, content.profile, content.body, "", "", content.media, nil)
				actual := Validate(provider, content.profile, content.body, "", "", content.media, map[string]any{"caption_mentions": nil})
				require.Equal(t, baseline, actual)
				requireNoIssueCode(t, actual, "unsupported_setting")
			})
		}
	}
}

func TestCaptionAuthorshipIsNotAProviderSetting(t *testing.T) {
	for _, provider := range []string{ProviderYouTube, ProviderPeerTube, ProviderFacebook} {
		t.Run(provider, func(t *testing.T) {
			field := "description"
			if provider == ProviderFacebook {
				field = "video_description"
			}
			settings := map[string]any{"caption_mentions": map[string]any{
				"field": field, "body": "Hello", "mentions": map[string]any{"version": 1, "spans": []any{}},
			}}
			issues := Validate(provider, models.ContentProfileLongVideo, "Hello", "Title", "Hello", nil, settings)
			requireNoIssueCode(t, issues, "unsupported_setting")
		})
	}
}

func TestUnsupportedSettingNullIsAbsent(t *testing.T) {
	capability := Capability{Provider: ProviderDiscord, Label: "Discord attachment"}
	require.Empty(t, validateUnsupportedSettings(capability, map[string]any{"unknown_option": nil}))
	for _, value := range []any{false, 0, "value", map[string]any{}} {
		requireIssueCode(t, validateUnsupportedSettings(capability, map[string]any{"unknown_option": value}), "unsupported_setting")
	}
}

func TestDefaultSettingsNullIsAbsent(t *testing.T) {
	resolved := Resolve(ProviderYouTube, ResolveInput{
		RequestedOutputProfile: "youtube.video", Context: ResolveContextSocialSetDefaults,
	})
	for _, key := range []string{"unknown_option", "caption_mentions"} {
		require.Empty(t, ValidateDefaultSettings(resolved.Capability, SettingScopeDestination, map[string]any{key: nil}, map[string]any{}))
	}
	requireIssueCode(t, ValidateDefaultSettings(resolved.Capability, SettingScopeDestination, map[string]any{"unknown_option": "value"}, map[string]any{}), "unsupported_setting")
}
