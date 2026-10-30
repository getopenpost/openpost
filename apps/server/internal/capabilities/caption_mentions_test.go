package capabilities

import (
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestCaptionResetDoesNotBlockPublishing(t *testing.T) {
	for _, provider := range []string{ProviderInstagram, ProviderDiscord, ProviderFacebook} {
		for _, content := range []struct {
			name, body string
			media      []MediaItem
		}{
			{name: "text only", body: "hi"},
			{name: "image only", media: []MediaItem{{ID: "image", MimeType: "image/jpeg", Size: 1024, Width: 1080, Height: 1080, URL: "https://example.com/image.jpg", PublicURLReady: true}}},
			{name: "image caption", body: "Hello 🌍 #launch", media: []MediaItem{{ID: "image", MimeType: "image/jpeg", Size: 1024, Width: 1080, Height: 1080, URL: "https://example.com/image.jpg", PublicURLReady: true}}},
		} {
			t.Run(provider+"/"+content.name, func(t *testing.T) {
				// Compare with the same post without the composer's reset marker:
				// genuine media/format restrictions must remain unchanged.
				baseline := Validate(provider, models.ContentProfileImagePost, content.body, "", "", content.media, nil)
				actual := Validate(provider, models.ContentProfileImagePost, content.body, "", "", content.media, map[string]any{"caption_mentions": nil})
				require.Equal(t, baseline, actual)
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
