package capabilities

import (
	"strings"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestValidateBlocksMissingMediaAnalysisForVideoProfiles(t *testing.T) {
	issues := Validate(ProviderTikTok, models.ContentProfileShortVideo, "caption", "", "", []MediaItem{{
		ID:             "video-1",
		MimeType:       "video/mp4",
		Size:           1024,
		AnalysisStatus: "pending",
	}}, map[string]any{"content_posting_method": "DIRECT_POST", "privacy_level": "SELF_ONLY"})

	requireIssueCode(t, issues, "media_analysis_pending")
}

func TestValidateBlocksFailedPublicURLVerification(t *testing.T) {
	issues := Validate(ProviderInstagram, models.ContentProfileShortVideo, "caption", "", "", []MediaItem{{
		ID:              "video-1",
		MimeType:        "video/mp4",
		Size:            1024,
		Width:           1080,
		Height:          1920,
		DurationMS:      20_000,
		AnalysisStatus:  "ready",
		PublicURLReady:  false,
		PublicURLError:  "403 forbidden",
		PublicURLStatus: 403,
		URL:             "https://cdn.example/video.mp4",
	}}, map[string]any{})

	requireIssueCode(t, issues, "public_url_unreachable")
	requireNoIssueCode(t, issues, "https_media_required")
}

func TestValidateTrustsVerifiedPublicMediaInsteadOfBrowserURL(t *testing.T) {
	issues := Validate(ProviderInstagram, models.ContentProfileImagePost, "caption", "", "", []MediaItem{{
		ID:              "image-1",
		MimeType:        "image/jpeg",
		Size:            1024,
		Width:           1080,
		Height:          1080,
		PublicURLReady:  true,
		PublicURLStatus: 200,
		URL:             "/media/image-1",
	}}, map[string]any{})

	requireNoIssueCode(t, issues, "public_url_unreachable")
	requireNoIssueCode(t, issues, "https_media_required")
}

func TestResolveMediaFirstIntentsBeforeMediaIsAttached(t *testing.T) {
	tests := []struct {
		name         string
		provider     string
		intent       string
		wantProfile  string
		wantShape    string
		wantMessage  string
		wantSettings bool
	}{
		{
			name:         "YouTube Short",
			provider:     ProviderYouTube,
			intent:       IntentShortVideo,
			wantProfile:  models.ContentProfileShortVideo,
			wantShape:    MediaShapeVideo,
			wantMessage:  "Add a video.",
			wantSettings: true,
		},
		{
			name:         "LinkedIn video",
			provider:     ProviderLinkedIn,
			intent:       IntentVideo,
			wantProfile:  models.ContentProfileLongVideo,
			wantShape:    MediaShapeVideo,
			wantMessage:  "Add a video.",
			wantSettings: true,
		},
		{
			name:        "Facebook Story",
			provider:    ProviderFacebook,
			intent:      IntentStory,
			wantProfile: models.ContentProfileStory,
			wantShape:   MediaShapeSingleImage,
			wantMessage: "Add an image or video.",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolved := Resolve(tt.provider, ResolveInput{
				Intent:   tt.intent,
				Segments: []ResolveSegment{{ID: "segment-1", Body: "Caption"}},
			})

			require.Equal(t, tt.wantProfile, resolved.Profile)
			require.Equal(t, tt.wantShape, resolved.ActiveConstraints["media_shape"])
			require.Equal(t, MediaShapeText, resolved.ActiveConstraints["input_media_shape"])
			requireIssueCode(t, resolved.Issues, "media_required")
			require.Equal(t, tt.wantMessage, issueMessage(resolved.Issues, "media_required"))
			for _, issue := range resolved.Issues {
				require.NotEqual(t, "unsupported_intent_shape", issue.Code)
			}
			if tt.wantSettings {
				require.NotEmpty(t, resolved.Settings)
			}
		})
	}
}

func TestCapabilitiesExposeValidationCategories(t *testing.T) {
	capability, ok := Find(ProviderYouTube, models.ContentProfileLongVideo)

	require.True(t, ok)
	require.Contains(t, capability.ValidationCategories, "duration")
	require.Contains(t, capability.ValidationCategories, "title")
	require.Contains(t, capability.ValidationCategories, "thumbnail")
}

func issueMessage(issues []ValidationIssue, code string) string {
	for _, issue := range issues {
		if issue.Code == code {
			return issue.Message
		}
	}
	return ""
}

func issueCodes(issues []ValidationIssue) []string {
	codes := make([]string, 0, len(issues))
	for _, issue := range issues {
		codes = append(codes, issue.Code)
	}
	return codes
}

func TestYouTubeCapabilitiesExposeStructuredPublishingSettings(t *testing.T) {
	capability, ok := Find(ProviderYouTube, models.ContentProfileLongVideo)

	require.True(t, ok)
	settings := map[string]SettingField{}
	for _, setting := range capability.Settings {
		settings[setting.Key] = setting
	}
	require.Equal(t, "tags", settings["tags"].Type)
	require.Equal(t, "youtube_categories", settings["category_id"].OptionsSource)
	require.True(t, settings["category_id"].Required)
	require.Equal(t, "youtube_playlists", settings["playlist_id"].OptionsSource)
}

func TestXCapabilitiesExposePostSettings(t *testing.T) {
	capability, ok := Find(ProviderX, models.ContentProfileShortText)

	require.True(t, ok)
	require.Equal(t, 25_000, capability.TextLimit)
	keys := make([]string, 0, len(capability.Settings))
	for _, setting := range capability.Settings {
		keys = append(keys, setting.Key)
	}
	require.Contains(t, keys, "quote_url")
	require.NotContains(t, keys, "quote_tweet_id")
	require.Contains(t, keys, "poll_options")
	require.Contains(t, keys, "poll_duration_minutes")
	require.Contains(t, keys, "reply_settings")
	require.Contains(t, keys, "paid_partnership")
	require.Contains(t, keys, "made_with_ai")
}

func TestApplyAccountConstraintsRevalidatesXTextAndVideo(t *testing.T) {
	segments := []ResolveSegment{{
		ID:   "segment-1",
		Body: strings.Repeat("x", 500),
		Media: []MediaItem{{
			ID:             "video-1",
			MimeType:       "video/mp4",
			Size:           600 * 1024 * 1024,
			DurationMS:     180_000,
			AnalysisStatus: "ready",
		}},
	}}
	resolved := Resolve(ProviderX, ResolveInput{
		Intent:   IntentShortVideo,
		Segments: segments,
	})
	require.NotContains(t, issueCodes(resolved.Issues), "text_too_long")
	require.NotContains(t, issueCodes(resolved.Issues), "media_duration")

	ApplyAccountConstraints(&resolved, segments, map[string]any{
		"text_limit":                 280,
		"max_video_duration_seconds": 140,
		"max_video_size_bytes":       int64(512 * 1024 * 1024),
	})

	require.Contains(t, issueCodes(resolved.Issues), "text_too_long")
	require.Contains(t, issueCodes(resolved.Issues), "media_duration")
	require.Contains(t, issueCodes(resolved.Issues), "media_size")
	require.False(t, resolved.Compatible)

	ApplyAccountConstraints(&resolved, segments, map[string]any{
		"text_limit":                 25_000,
		"max_video_duration_seconds": 4 * 60 * 60,
		"max_video_size_bytes":       int64(16 * 1024 * 1024 * 1024),
	})
	require.NotContains(t, issueCodes(resolved.Issues), "text_too_long")
	require.NotContains(t, issueCodes(resolved.Issues), "media_duration")
	require.NotContains(t, issueCodes(resolved.Issues), "media_size")
	require.True(t, resolved.Compatible)
}

func TestValidateBlocksXMutuallyExclusiveSettings(t *testing.T) {
	issues := Validate(ProviderX, models.ContentProfileImagePost, "caption", "", "", []MediaItem{{
		ID:       "image-1",
		MimeType: "image/jpeg",
		Size:     1024,
	}}, map[string]any{"poll_options": "One\nTwo"})

	requireIssueCode(t, issues, "x_mutually_exclusive_attachment")

	issues = Validate(ProviderX, models.ContentProfileImagePost, "caption", "", "", []MediaItem{{
		ID:       "image-1",
		MimeType: "image/jpeg",
		Size:     1024,
	}}, map[string]any{"quote_tweet_id": "1346889436626259968"})

	requireIssueCode(t, issues, "x_mutually_exclusive_attachment")
}

func TestMastodonCapabilitiesExposeStatusSettings(t *testing.T) {
	capability, ok := Find(ProviderMastodon, models.ContentProfileShortText)

	require.True(t, ok)
	require.False(t, capability.NativeScheduling)
	keys := make([]string, 0, len(capability.Settings))
	for _, setting := range capability.Settings {
		keys = append(keys, setting.Key)
	}
	require.Contains(t, keys, "visibility")
	require.Contains(t, keys, "spoiler_text")
	require.Contains(t, keys, "sensitive")
	require.Contains(t, keys, "language")
	require.NotContains(t, keys, "scheduled_at")
	require.Contains(t, keys, "poll_options")
	require.Contains(t, keys, "poll_expires_in_seconds")
}

func TestBlueskyCapabilitiesExposeVideoAndPostSettings(t *testing.T) {
	capability, ok := Find(ProviderBluesky, models.ContentProfileShortVideo)

	require.True(t, ok)
	require.Equal(t, 1, capability.Media.MinCount)
	require.Equal(t, 1, capability.Media.MaxCount)
	require.Contains(t, capability.Media.AllowedMIMEs, "video/mp4")
	require.Equal(t, int64(100*1024*1024), capability.Media.MaxSizeBytes)

	keys := make([]string, 0, len(capability.Settings))
	for _, setting := range capability.Settings {
		keys = append(keys, setting.Key)
	}
	require.Contains(t, keys, "link_url")
	require.Contains(t, keys, "quote_url")
	require.NotContains(t, keys, "quote_uri")
	require.NotContains(t, keys, "quote_cid")
	require.Contains(t, keys, "self_labels")
	require.NotContains(t, keys, "mention_dids")
}

func TestLinkedInCapabilitiesExposeDocumentCarousel(t *testing.T) {
	capability, ok := Find(ProviderLinkedIn, models.ContentProfileCarousel)

	require.True(t, ok)
	require.Equal(t, 1, capability.Media.MinCount)
	require.Equal(t, 1, capability.Media.MaxCount)
	require.Contains(t, capability.Media.AllowedMIMEs, "application/pdf")
	require.Contains(t, capability.Media.AllowedMIMEs, "application/vnd.openxmlformats-officedocument.presentationml.presentation")
	require.Equal(t, int64(100*1024*1024), capability.Media.MaxSizeBytes)
	require.Contains(t, capability.ValidationCategories, "document")
}

func TestPublicMediaCountsMatchAdapterPublishingModes(t *testing.T) {
	tests := []struct {
		provider string
		profile  string
		min      int
		max      int
	}{
		{ProviderThreads, models.ContentProfileImagePost, 1, 1},
		{ProviderThreads, models.ContentProfileCarousel, 2, 10},
		{ProviderFacebook, models.ContentProfileImagePost, 1, 1},
		{ProviderFacebook, models.ContentProfileCarousel, 2, 10},
		{ProviderFacebook, models.ContentProfileStory, 1, 1},
		{ProviderInstagram, models.ContentProfileImagePost, 1, 1},
		{ProviderInstagram, models.ContentProfileCarousel, 2, 10},
		{ProviderInstagram, models.ContentProfileStory, 1, 1},
		{ProviderTikTok, models.ContentProfileCarousel, 1, 35},
	}

	for _, tt := range tests {
		t.Run(tt.provider+"/"+tt.profile, func(t *testing.T) {
			capability, ok := Find(tt.provider, tt.profile)
			require.True(t, ok)
			require.Equal(t, tt.min, capability.Media.MinCount)
			require.Equal(t, tt.max, capability.Media.MaxCount)
		})
	}
}

func TestTikTokPhotoCapabilityMatchesDocumentedMediaLimits(t *testing.T) {
	capability, ok := Find(ProviderTikTok, models.ContentProfileCarousel)

	require.True(t, ok)
	require.Equal(t, 4000, capability.TextLimit)
	require.Equal(t, int64(20*1024*1024), capability.Media.MaxSizeBytes)
	require.ElementsMatch(t, []string{"image/jpeg", "image/webp"}, capability.Media.AllowedMIMEs)
}

func TestProviderTextLimitUsesGenericPostOrConservativePublicationLimit(t *testing.T) {
	tests := map[string]int{
		ProviderInstagram: 2200,
		ProviderLinkedIn:  3000,
		ProviderTikTok:    2200,
		ProviderYouTube:   5000,
		ProviderX:         280,
	}
	for provider, want := range tests {
		limit, ok := ProviderTextLimit(provider)
		require.True(t, ok, provider)
		require.Equal(t, want, limit, provider)
	}
}

func TestThreadsCarouselCapabilityAllowsMixedMedia(t *testing.T) {
	capability, ok := Find(ProviderThreads, models.ContentProfileCarousel)

	require.True(t, ok)
	require.Contains(t, capability.Media.AllowedMIMEs, "image/jpeg")
	require.Contains(t, capability.Media.AllowedMIMEs, "video/mp4")
}

func TestMetaCarouselAndStoryCapabilitiesMatchPublishingPaths(t *testing.T) {
	mixedMediaMIMEs := []string{"image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"}

	facebookCarousel, ok := Find(ProviderFacebook, models.ContentProfileCarousel)
	require.True(t, ok)
	require.ElementsMatch(t, []string{"image/jpeg", "image/png", "image/webp"}, facebookCarousel.Media.AllowedMIMEs)

	facebookStory, ok := Find(ProviderFacebook, models.ContentProfileStory)
	require.True(t, ok)
	require.Equal(t, 1, facebookStory.Media.MinCount)
	require.Equal(t, 1, facebookStory.Media.MaxCount)
	require.ElementsMatch(t, mixedMediaMIMEs, facebookStory.Media.AllowedMIMEs)

	instagramCarousel, ok := Find(ProviderInstagram, models.ContentProfileCarousel)
	require.True(t, ok)
	require.Equal(t, 2, instagramCarousel.Media.MinCount)
	require.Equal(t, 10, instagramCarousel.Media.MaxCount)
	require.ElementsMatch(t, mixedMediaMIMEs, instagramCarousel.Media.AllowedMIMEs)

	instagramStory, ok := Find(ProviderInstagram, models.ContentProfileStory)
	require.True(t, ok)
	require.Equal(t, 1, instagramStory.Media.MinCount)
	require.Equal(t, 1, instagramStory.Media.MaxCount)
	require.ElementsMatch(t, mixedMediaMIMEs, instagramStory.Media.AllowedMIMEs)
}

func TestValidateBlocksMastodonPollWithMedia(t *testing.T) {
	issues := Validate(ProviderMastodon, models.ContentProfileImagePost, "caption", "", "", []MediaItem{{
		ID:       "image-1",
		MimeType: "image/jpeg",
		Size:     1024,
	}}, map[string]any{"poll_options": "One\nTwo"})

	requireIssueCode(t, issues, "mastodon_poll_media_conflict")
}

func TestValidateFlagsUnsupportedProviderSettings(t *testing.T) {
	issues := Validate(ProviderYouTube, models.ContentProfileLongVideo, "caption", "Title", "", []MediaItem{{
		ID:             "video-1",
		MimeType:       "video/mp4",
		Size:           1024,
		AnalysisStatus: "ready",
	}}, map[string]any{"privacy": "private", "unsupported_field": "value"})

	requireIssueCode(t, issues, "unsupported_setting")
}

func TestValidateRequiresExplicitConsentWithoutGenericQuotaWarnings(t *testing.T) {
	tiktokIssues := Validate(ProviderTikTok, models.ContentProfileShortVideo, "caption", "", "", []MediaItem{{
		ID:              "video-1",
		MimeType:        "video/mp4",
		Size:            1024,
		AnalysisStatus:  "ready",
		PublicURLReady:  true,
		PublicURLStatus: 200,
		URL:             "https://cdn.example/video.mp4",
	}}, map[string]any{"content_posting_method": "DIRECT_POST", "privacy_level": "SELF_ONLY"})

	requireIssueCode(t, tiktokIssues, "setting_required")

	youtubeIssues := Validate(ProviderYouTube, models.ContentProfileLongVideo, "caption", "Title", "", []MediaItem{{
		ID:             "video-1",
		MimeType:       "video/mp4",
		Size:           1024,
		AnalysisStatus: "ready",
	}}, map[string]any{"privacy": "private"})

	requireNoIssueCode(t, youtubeIssues, "quota_warning")
	requireNoIssueCode(t, youtubeIssues, "provider_audit_required")
}

func TestTikTokPrivacyIsRequiredOnlyForDirectPost(t *testing.T) {
	media := []MediaItem{{
		ID:              "video-1",
		MimeType:        "video/mp4",
		Size:            1024,
		AnalysisStatus:  "ready",
		PublicURLReady:  true,
		PublicURLStatus: 200,
		URL:             "https://cdn.example/video.mp4",
	}}

	directIssues := Validate(ProviderTikTok, models.ContentProfileShortVideo, "caption", "", "", media, map[string]any{
		"content_posting_method": "DIRECT_POST",
		"music_usage_confirmed":  true,
	})
	requireIssueForField(t, directIssues, "setting_required", "privacy_level")

	inboxIssues := Validate(ProviderTikTok, models.ContentProfileShortVideo, "caption", "", "", media, map[string]any{
		"content_posting_method": "UPLOAD",
		"music_usage_confirmed":  true,
	})
	for _, issue := range inboxIssues {
		require.False(t, issue.Code == "setting_required" && issue.Field == "privacy_level", inboxIssues)
	}
}

func requireIssueCode(t *testing.T, issues []ValidationIssue, code string) {
	t.Helper()
	for _, issue := range issues {
		if issue.Code == code {
			return
		}
	}
	require.Failf(t, "missing validation issue", "code %q not found in %#v", code, issues)
}

func requireIssueForField(t *testing.T, issues []ValidationIssue, code, field string) {
	t.Helper()
	for _, issue := range issues {
		if issue.Code == code && issue.Field == field {
			return
		}
	}
	require.Failf(t, "missing validation issue", "code %q for field %q not found in %#v", code, field, issues)
}

func requireNoIssueCode(t *testing.T, issues []ValidationIssue, code string) {
	t.Helper()
	for _, issue := range issues {
		require.NotEqual(t, code, issue.Code)
	}
}
