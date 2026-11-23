package capabilities

import (
	"slices"
	"strings"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/providerlimits"

	"github.com/stretchr/testify/require"
)

func TestValidateInstagramRejectsUnsupportedCollaboratorCombinations(t *testing.T) {
	video := MediaItem{ID: "video-1", MimeType: "video/mp4", Size: 1024, Width: 1080, Height: 1920, DurationMS: 20_000, AnalysisStatus: "ready", PublicURLReady: true, PublicURLStatus: 200}
	for _, test := range []struct {
		name, outputProfile, fallbackProfile, code string
		media                                      []MediaItem
		settings                                   map[string]any
	}{
		{
			name: "trial reel collaborators", outputProfile: "instagram.reel", fallbackProfile: models.ContentProfileShortVideo,
			media: []MediaItem{video}, settings: map[string]any{"is_trial_reel": true, "graduation_strategy": "MANUAL", "collaborators": "one"}, code: "instagram_trial_reel_collaborators_conflict",
		},
		{
			name: "more than three collaborators", outputProfile: "instagram.reel", fallbackProfile: models.ContentProfileShortVideo,
			media: []MediaItem{video}, settings: map[string]any{"collaborators": "one,two,three,four"}, code: "setting_max_items",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			issues := ValidateOutput(ProviderInstagram, test.outputProfile, test.fallbackProfile, "Caption", "", "", test.media, test.settings)
			requireIssueCode(t, issues, test.code)
		})
	}
}

func TestValidateOutputQuoteWithURLRetainsEntitlementError(t *testing.T) {
	issues := ValidateOutput(ProviderX, "x.post", models.ContentProfileShortText, "Read https://example.com/post", "", "", nil,
		map[string]any{"url": "https://example.com/post", "quote_url": "https://x.com/person/status/123"})
	requireNoIssueCode(t, issues, "unsupported_setting")
	requireIssueCode(t, issues, "setting_unavailable")
}

func TestValidateBlocksMastodonPollWithMedia(t *testing.T) {
	issues := Validate(ProviderMastodon, models.ContentProfileImagePost, "caption", "", "", []MediaItem{{
		ID:       "image-1",
		MimeType: "image/jpeg",
		Size:     1024,
	}}, map[string]any{"poll_options": "One\nTwo"})

	requireIssueCode(t, issues, "mastodon_poll_media_conflict")
}

func TestNormalizeMediaTextLinkSettingsPreservesInput(t *testing.T) {
	settings := map[string]any{"url": "https://example.com", "reply_settings": "everyone"}

	normalized := NormalizeMediaTextLinkSettings(ProviderX, 1, settings)
	require.Equal(t, map[string]any{"reply_settings": "everyone"}, normalized)
	require.Equal(t, "https://example.com", settings["url"])

	withoutMedia := NormalizeMediaTextLinkSettings(ProviderX, 0, settings)
	require.Equal(t, settings, withoutMedia)
	unknownProvider := NormalizeMediaTextLinkSettings(ProviderPinterest, 1, settings)
	require.Equal(t, settings, unknownProvider)
}

func TestResolveKeepsMessageSettingsForLinkPostsWithoutLinkShare(t *testing.T) {
	// Discord and Telegram have no link-share format, so a message that
	// carries a link still publishes as a plain message with its settings.
	for _, tc := range []struct {
		provider string
		settings map[string]any
	}{
		{ProviderDiscord, map[string]any{"channel_id": "channel-1", "mention_policy": "none"}},
		{ProviderTelegram, map[string]any{"chat_id": "-100123"}},
	} {
		t.Run(tc.provider, func(t *testing.T) {
			resolved := Resolve(tc.provider, ResolveInput{
				CreationPreset: IntentPost,
				SourceURL:      "https://example.com",
				Settings:       tc.settings,
				Segments:       []ResolveSegment{{ID: "segment-1", Body: "Read https://example.com"}},
			})

			require.Equal(t, models.ContentProfileShortText, resolved.Profile)
			requireNoIssueCode(t, resolved.Issues, "unsupported_setting")
			for key := range tc.settings {
				require.True(t, slices.ContainsFunc(resolved.Settings, func(setting SettingDefinition) bool { return setting.Key == key }), "missing setting %s", key)
			}
		})
	}
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

func TestCapabilityValidatesStructuredTextMediaAndLocalTimeRules(t *testing.T) {
	capability := Capability{
		Provider: ProviderYouTube,
		Profile:  models.ContentProfileLongVideo,
		Label:    "Video",
		Content: ContentConstraint{
			Body:        TextConstraint{MaxLength: 10, RecommendedMaxLength: 5},
			Title:       TextConstraint{Required: true, MinLength: 3},
			Description: TextConstraint{RecommendedMaxLength: 4},
			AltText:     TextConstraint{Required: true, MaxLength: 20},
		},
		Media: MediaConstraint{
			MinCount: 1, MaxCount: 1, AllowedMIMEs: []string{"video/mp4"},
			MinWidth: 720, MaxWidth: 1920, MinHeight: 720, MaxHeight: 1920,
			AllowedVideoCodecs: []string{"h264"}, AllowedAudioCodecs: []string{"aac"},
			MaxFrameRate: 30, AudioPolicy: "required",
		},
		Settings: []SettingDefinition{{
			Key: "publish_at", Label: "Publish at", Type: "datetime-local", Scope: SettingScopeDestination,
			Constraints: SettingConstraint{LocalDateTime: true},
		}},
	}
	issues := validateCapability(capability, "12345678901", "x", "12345", []MediaItem{{
		ID: "video", MimeType: "video/mp4", Width: 640, Height: 2160,
		VideoCodec: "vp9", AudioCodec: "opus", FrameRate: 60,
	}}, map[string]any{"publish_at": "2026-08-12T12:00Z"})

	for _, code := range []string{
		"body_too_long", "title_too_short", "description_recommended_length", "alt_text_required",
		"media_width_min", "media_height_max", "media_video_codec", "media_audio_codec",
		"media_frame_rate", "media_audio_required", "setting_local_datetime_invalid",
	} {
		requireIssueCode(t, issues, code)
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

// requireNoIssueCode fails the test when any validation issue uses the given code.
func requireNoIssueCode(t *testing.T, issues []ValidationIssue, code string) {
	t.Helper()
	for _, issue := range issues {
		require.NotEqual(t, code, issue.Code)
	}
}

func TestYouTubeExplicitDescriptionWinsOverDestinationSetting(t *testing.T) {
	issues := Validate(ProviderYouTube, models.ContentProfileLongVideo, "Body", "Title", strings.Repeat("😀", 1251), []MediaItem{{ID: "video", MimeType: "video/mp4", Size: 1024, AnalysisStatus: "ready"}}, map[string]any{"privacy": "private", "title": "Title", "category_id": "22", "description": "Default description"})
	requireIssueCode(t, issues, "description_invalid")
}

func TestRequiredDemoBlocksDeliveryUntilVideoAttached(t *testing.T) {
	settings := map[string]any{"attachment_requirement": map[string]any{"kind": "video", "brief": "Show the new drag interaction."}}
	issues := ValidateOutput("x", "x.video", "short_video", "This is how it works.", "", "", nil, settings)
	require.True(t, hasAttachmentIssue(issues), "a missing demo must block scheduling and delivery")
	issues = ValidateOutput("x", "x.video", "short_video", "This is how it works.", "", "", []MediaItem{{ID: "image", MimeType: "image/png"}}, settings)
	require.True(t, hasAttachmentIssue(issues), "a screenshot does not fulfill a video requirement")
	issues = ValidateOutput("x", "x.video", "short_video", "This is how it works.", "", "", []MediaItem{{ID: "demo", MimeType: "video/mp4", AnalysisStatus: "ready", Size: 1024, Width: 1920, Height: 1080, DurationMS: 10000}}, settings)
	require.False(t, hasAttachmentIssue(issues))
	for _, issue := range issues {
		require.NotEqual(t, "error", issue.Severity, "matching media must restore complete readiness: %+v", issues)
	}
	resolved := Resolve("x", ResolveInput{RequestedOutputProfile: "x.post", Segments: []ResolveSegment{{ID: "source", Body: "This is how it works."}}, Settings: settings})
	require.False(t, resolved.Compatible, "discovery must show the missing attachment before scheduling")
	require.True(t, hasAttachmentIssue(resolved.Issues))
}

func hasAttachmentIssue(issues []ValidationIssue) bool {
	for _, issue := range issues {
		if issue.Code == "attachment_required" && issue.Severity == "error" {
			return true
		}
	}
	return false
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

func TestAttachmentRequirementsAreSegmentScopedAndValidateShape(t *testing.T) {
	requirement := map[string]any{"attachment_requirement": map[string]any{"kind": "video"}}
	resolved := Resolve("x", ResolveInput{RequestedOutputProfile: "x.thread", Segments: []ResolveSegment{{ID: "first", Body: "Watch the demo", Settings: requirement}, {ID: "reply", Body: "Details"}}})
	require.False(t, resolved.Compatible)
	missing := 0
	for _, issue := range resolved.Issues {
		if issue.Code == "attachment_required" {
			missing++
			require.Equal(t, "first", issue.SegmentID)
		}
	}
	require.Equal(t, 1, missing, "the reply must not inherit the first source's attachment requirement")
	for _, malformed := range []any{"video", true, []string{"video"}, map[string]any{"kind": "audio"}} {
		require.True(t, hasAttachmentIssue(ValidateAttachmentRequirement("x", "x.post", nil, map[string]any{"attachment_requirement": malformed})))
	}
	require.Empty(t, ValidateAttachmentRequirement("x", "x.post", nil, map[string]any{"attachment_requirement": nil}))
}

func TestYouTubePublishTimeReadiness(t *testing.T) {
	for _, scenario := range []struct {
		name, privacy, publishAt string
		wantCode                 string
	}{
		{"private scheduled video", "private", "2030-10-12T20:00:00+08:00", ""},
		{"private unscheduled video", "private", "", ""},
		{"past time follows YouTube behavior", "private", "2020-10-12T12:00:00Z", ""},
		{"invalid time", "private", "tomorrow", "setting_datetime_invalid"},
		{"missing timezone", "private", "2030-10-12T20:00:00", "setting_datetime_invalid"},
		{"public schedule", "public", "2030-10-12T12:00:00Z", "setting_dependency"},
		{"unlisted schedule", "unlisted", "2030-10-12T12:00:00Z", "setting_dependency"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			resolved := Resolve(ProviderYouTube, ResolveInput{
				RequestedOutputProfile: "youtube.video",
				Segments: []ResolveSegment{{ID: "source", Title: "Launch", Media: []MediaItem{{
					ID: "video", MimeType: "video/mp4", Size: 1024, Width: 1920, Height: 1080, DurationMS: 300_000, AnalysisStatus: "ready",
				}}}},
				Settings: map[string]any{"privacy": scenario.privacy, "category_id": "22", "publish_at": scenario.publishAt},
			})
			if scenario.wantCode == "" {
				require.True(t, resolved.Compatible, "%+v", resolved.Issues)
			} else {
				require.False(t, resolved.Compatible)
				requireIssueForField(t, resolved.Issues, scenario.wantCode, "publish_at")
			}
		})
	}
}

func TestYouTubePublishTimeCannotBecomeSocialSetDefault(t *testing.T) {
	resolved := Resolve(ProviderYouTube, ResolveInput{
		RequestedOutputProfile: "youtube.video", Context: ResolveContextSocialSetDefaults,
	})
	for _, field := range resolved.Settings {
		require.NotEqual(t, "publish_at", field.Key, "absolute publish times belong to individual posts")
	}
	values := map[string]any{"privacy": "private", "publish_at": "2030-10-12T12:00:00Z"}
	issues := ValidateDefaultSettings(resolved.Capability, SettingScopeDestination, values, values)
	requireIssueForField(t, issues, "unsupported_setting", "publish_at")
}

func TestBlueskyGIFValidation(t *testing.T) {
	// Single animated GIF up to Bluesky's 100 MB video service limit is allowed.
	resolved := Resolve(ProviderBluesky, ResolveInput{
		Segments: []ResolveSegment{{
			ID:    "seg-1",
			Body:  "Check out this GIF",
			Media: []MediaItem{{ID: "gif-1", MimeType: "image/gif", Size: 5_000_000}},
		}},
	})
	require.True(t, resolved.Compatible, "single Bluesky GIF should be compatible, got %+v", resolved.Issues)
	require.Empty(t, resolved.Issues)

	// Static images on Bluesky still enforce the 2 MB image limit.
	staticOverLimit := Validate(ProviderBluesky, models.ContentProfileImagePost, "Caption", "", "", []MediaItem{
		{ID: "img-1", MimeType: "image/jpeg", Size: blueskyImageMaxBytes + 1},
	}, nil)
	requireIssueCode(t, staticOverLimit, "media_size")

	// Mixing a GIF with another image or GIF is rejected on both single posts and threads.
	for _, profile := range []string{models.ContentProfileImagePost, models.ContentProfileThread} {
		mixed := Validate(ProviderBluesky, profile, "Caption", "", "", []MediaItem{
			{ID: "gif-1", MimeType: "image/gif", Size: 1000},
			{ID: "img-1", MimeType: "image/jpeg", Size: 1000},
		}, nil)
		requireIssueCode(t, mixed, "gif_exclusive")
	}

	// GIFs exceeding 100 MB are rejected.
	tooLarge := Validate(ProviderBluesky, models.ContentProfileImagePost, "Caption", "", "", []MediaItem{
		{ID: "gif-big", MimeType: "image/gif", Size: providerlimits.BlueskyVideoMaxBytes + 1},
	}, nil)
	requireIssueCode(t, tooLarge, "media_size")
}
