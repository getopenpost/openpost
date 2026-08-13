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

func TestResolveChoosesFormatsPerDestinationForMultiSegmentSource(t *testing.T) {
	segments := []ResolveSegment{
		{ID: "segment-1", Body: "First"},
		{ID: "segment-2", Body: "Second"},
	}

	x := Resolve(ProviderX, ResolveInput{CreationPreset: IntentPost, Segments: segments})
	require.Equal(t, models.ContentProfileThread, x.Profile)
	require.Equal(t, "preserve", x.SegmentStrategy)

	linkedIn := Resolve(ProviderLinkedIn, ResolveInput{CreationPreset: IntentPost, Segments: segments})
	require.NotEqual(t, models.ContentProfileThread, linkedIn.Profile)
	require.Equal(t, "join", linkedIn.SegmentStrategy)
	requireNoIssueCode(t, linkedIn.Issues, "unsupported_destination")
}

func TestResolvePreservesExplicitDestinationFormat(t *testing.T) {
	resolved := Resolve(ProviderInstagram, ResolveInput{
		CreationPreset:         IntentPost,
		RequestedOutputProfile: "instagram.story",
		Segments:               []ResolveSegment{{ID: "segment-1", Body: "Caption"}},
	})

	require.Equal(t, "instagram.story", resolved.OutputProfile)
	require.Equal(t, models.ContentProfileStory, resolved.Profile)
	require.False(t, resolved.Compatible)
	requireIssueCode(t, resolved.Issues, "media_required")
}

func TestResolveDoesNotInferStoryWithoutStoryPreset(t *testing.T) {
	video := MediaItem{
		ID: "video-1", MimeType: "video/mp4", Size: 1024, Width: 1080, Height: 1920,
		DurationMS: 20_000, AnalysisStatus: "ready", PublicURLReady: true, PublicURLStatus: 200,
	}
	resolved := Resolve(ProviderInstagram, ResolveInput{
		CreationPreset: IntentPost,
		Segments:       []ResolveSegment{{ID: "segment-1", Body: "Caption", Media: []MediaItem{video}}},
	})

	require.NotEqual(t, models.ContentProfileStory, resolved.Profile)
	require.NotEqual(t, "instagram.story", resolved.OutputProfile)
	require.True(t, resolved.FormatSelectionRequired)
	requireIssueCode(t, resolved.Issues, "format_selection_required")
}

func TestResolveRequiresFormatOnlyForGenuinelyAmbiguousDestinations(t *testing.T) {
	image := MediaItem{ID: "image-1", MimeType: "image/jpeg", Size: 1024, Width: 1080, Height: 1080, PublicURLReady: true, PublicURLStatus: 200}
	video := MediaItem{ID: "video-1", MimeType: "video/mp4", Size: 1024, Width: 1080, Height: 1920, DurationMS: 20_000, AnalysisStatus: "ready", PublicURLReady: true, PublicURLStatus: 200}
	tests := []struct {
		name     string
		provider string
		media    []MediaItem
		want     bool
	}{
		{name: "Instagram image can be feed or Story", provider: ProviderInstagram, media: []MediaItem{image}, want: true},
		{name: "Instagram video can be Reel or Story", provider: ProviderInstagram, media: []MediaItem{video}, want: true},
		{name: "Facebook image can be photo or Story", provider: ProviderFacebook, media: []MediaItem{image}, want: true},
		{name: "Facebook video has multiple delivery formats", provider: ProviderFacebook, media: []MediaItem{video}, want: true},
		{name: "TikTok video has one format", provider: ProviderTikTok, media: []MediaItem{video}, want: false},
		{name: "YouTube format is inferred", provider: ProviderYouTube, media: []MediaItem{video}, want: false},
		{name: "X format is inferred", provider: ProviderX, media: []MediaItem{image}, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolved := Resolve(tt.provider, ResolveInput{CreationPreset: IntentPost, Segments: []ResolveSegment{{ID: "segment-1", Body: "Caption", Title: "Title", Media: tt.media}}})
			require.Equal(t, tt.want, resolved.FormatSelectionRequired)
			if tt.want {
				requireIssueCode(t, resolved.Issues, "format_selection_required")
			} else {
				requireNoIssueCode(t, resolved.Issues, "format_selection_required")
			}
		})
	}
}

func TestResolveInfersYouTubeShortOnlyFromCompleteQualifyingMetadata(t *testing.T) {
	tests := []struct {
		name       string
		media      MediaItem
		wantOutput string
	}{
		{name: "vertical short video", media: MediaItem{MimeType: "video/mp4", Width: 1080, Height: 1920, DurationMS: 60_000}, wantOutput: "youtube.short"},
		{name: "landscape short video", media: MediaItem{MimeType: "video/mp4", Width: 1920, Height: 1080, DurationMS: 60_000}, wantOutput: "youtube.video"},
		{name: "vertical long video", media: MediaItem{MimeType: "video/mp4", Width: 1080, Height: 1920, DurationMS: 240_000}, wantOutput: "youtube.video"},
		{name: "analysis incomplete", media: MediaItem{MimeType: "video/mp4"}, wantOutput: "youtube.video"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			media := tt.media
			media.ID = "video-1"
			media.Size = 1024
			media.AnalysisStatus = "ready"
			resolved := Resolve(ProviderYouTube, ResolveInput{CreationPreset: IntentPost, Segments: []ResolveSegment{{ID: "segment-1", Title: "Title", Media: []MediaItem{media}}}})
			require.Equal(t, tt.wantOutput, resolved.OutputProfile)
		})
	}
}

func TestResolveInfersUnambiguousFormatsAcrossEveryProvider(t *testing.T) {
	image := MediaItem{ID: "image-1", MimeType: "image/jpeg", Size: 1024, Width: 1080, Height: 1080, PublicURLReady: true, PublicURLStatus: 200}
	secondImage := image
	secondImage.ID = "image-2"
	video := MediaItem{ID: "video-1", MimeType: "video/mp4", Size: 1024, Width: 1080, Height: 1920, DurationMS: 60_000, AnalysisStatus: "ready", PublicURLReady: true, PublicURLStatus: 200}
	document := MediaItem{ID: "document-1", MimeType: "application/pdf", Size: 1024}
	thread := []ResolveSegment{{ID: "segment-1", Body: "First"}, {ID: "segment-2", Body: "Second"}}
	tests := []struct {
		provider string
		segments []ResolveSegment
		want     string
	}{
		{provider: ProviderX, segments: thread, want: "x.thread"},
		{provider: ProviderBluesky, segments: thread, want: "bluesky.thread"},
		{provider: ProviderMastodon, segments: thread, want: "mastodon.thread"},
		{provider: ProviderThreads, segments: thread, want: "threads.thread"},
		{provider: ProviderLinkedIn, segments: []ResolveSegment{{ID: "segment-1", Body: "Document", Media: []MediaItem{document}}}, want: "linkedin.document"},
		{provider: ProviderFacebook, segments: []ResolveSegment{{ID: "segment-1", Body: "Photos", Media: []MediaItem{image, secondImage}}}, want: "facebook.carousel"},
		{provider: ProviderInstagram, segments: []ResolveSegment{{ID: "segment-1", Body: "Photos", Media: []MediaItem{image, secondImage}}}, want: "instagram.carousel"},
		{provider: ProviderYouTube, segments: []ResolveSegment{{ID: "segment-1", Body: "Description", Title: "Title", Media: []MediaItem{video}}}, want: "youtube.short"},
		{provider: ProviderTikTok, segments: []ResolveSegment{{ID: "segment-1", Body: "Photos", Media: []MediaItem{image}}}, want: "tiktok.photo"},
		{provider: ProviderDiscord, segments: []ResolveSegment{{ID: "segment-1", Body: "Video", Media: []MediaItem{video}}}, want: "discord.video"},
	}

	for _, tt := range tests {
		t.Run(tt.provider, func(t *testing.T) {
			resolved := Resolve(tt.provider, ResolveInput{CreationPreset: IntentPost, Segments: tt.segments})
			require.Equal(t, tt.want, resolved.OutputProfile)
			require.False(t, resolved.FormatSelectionRequired)
		})
	}
}

func TestResolveAcceptsRequiredDestinationSettings(t *testing.T) {
	video := MediaItem{ID: "video-1", MimeType: "video/mp4", Size: 1024, Width: 1920, Height: 1080, DurationMS: 60_000, AnalysisStatus: "ready"}
	resolved := Resolve(ProviderYouTube, ResolveInput{
		CreationPreset: IntentPost,
		Segments:       []ResolveSegment{{ID: "segment-1", Body: "Description", Title: "Launch walkthrough", Media: []MediaItem{video}}},
		Settings: map[string]any{
			"title":       "Launch walkthrough",
			"privacy":     "private",
			"category_id": "28",
		},
	})

	requireNoIssueCode(t, resolved.Issues, "title_required")
	requireNoIssueCode(t, resolved.Issues, "setting_required")
}

func TestResolveExposesDestinationFormatChoices(t *testing.T) {
	resolved := Resolve(ProviderInstagram, ResolveInput{
		CreationPreset: IntentPost,
		Segments:       []ResolveSegment{{ID: "segment-1", Body: "Caption"}},
	})
	profiles := make([]string, 0, len(resolved.AvailableFormats))
	for _, format := range resolved.AvailableFormats {
		profiles = append(profiles, format.OutputProfile)
	}
	require.Contains(t, profiles, "instagram.feed")
	require.Contains(t, profiles, "instagram.story")
	require.Contains(t, profiles, "instagram.reel")
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
	require.Equal(t, "remote_picker", settings["category_id"].Control)
	require.True(t, settings["category_id"].Required)
	require.Equal(t, "youtube_playlists", settings["playlist_id"].OptionsSource)
	require.Equal(t, "remote_picker", settings["playlist_id"].Control)
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
	require.Contains(t, issueCodes(resolved.Issues), "media_duration")
	require.Contains(t, issueCodes(resolved.Issues), "media_size")

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

func TestVideoCapabilitiesUseSafeProviderSpecificLimits(t *testing.T) {
	tests := []struct {
		provider     string
		profile      string
		maxBytes     int64
		maxDuration  int
		allowedMIMEs []string
	}{
		{ProviderX, models.ContentProfileLongVideo, 512 * 1024 * 1024, 140, []string{"video/mp4"}},
		{ProviderMastodon, models.ContentProfileLongVideo, 99 * 1024 * 1024, 0, []string{"video/mp4", "video/quicktime", "video/webm"}},
		{ProviderLinkedIn, models.ContentProfileLongVideo, 500 * 1024 * 1024, 30 * 60, []string{"video/mp4"}},
		{ProviderTikTok, models.ContentProfileShortVideo, 4 * 1024 * 1024 * 1024, 10 * 60, []string{"video/mp4", "video/quicktime", "video/webm"}},
		{ProviderDiscord, models.ContentProfileLongVideo, 10 * 1024 * 1024, 0, []string{"video/mp4", "video/quicktime", "video/webm"}},
	}

	for _, tt := range tests {
		t.Run(tt.provider+"_"+tt.profile, func(t *testing.T) {
			capability, ok := Find(tt.provider, tt.profile)
			require.True(t, ok)
			require.Equal(t, tt.maxBytes, capability.Media.MaxSizeBytes)
			require.Equal(t, tt.maxDuration, capability.Media.MaxDurationSeconds)
			require.ElementsMatch(t, tt.allowedMIMEs, capability.Media.AllowedMIMEs)
			require.Equal(t, "2026-08-03.1", capability.CapabilityRevision)
		})
	}
}

func TestApplyAccountConstraintsRefreshesVideoMIMEsAndSize(t *testing.T) {
	segments := []ResolveSegment{{
		ID:   "segment-1",
		Body: "Video",
		Media: []MediaItem{{
			ID:             "video-1",
			MimeType:       "video/webm",
			Size:           120 * 1024 * 1024,
			DurationMS:     60_000,
			AnalysisStatus: "ready",
		}},
	}}
	resolved := Resolve(ProviderMastodon, ResolveInput{
		Intent:   IntentVideo,
		Segments: segments,
	})
	require.Contains(t, issueCodes(resolved.Issues), "media_size")
	require.NotContains(t, issueCodes(resolved.Issues), "media_type")

	ApplyAccountConstraints(&resolved, segments, map[string]any{
		"max_video_size_bytes": int64(200 * 1024 * 1024),
		"allowed_mimes":        []any{"video/mp4", "video/webm"},
	})
	require.NotContains(t, issueCodes(resolved.Issues), "media_size")
	require.NotContains(t, issueCodes(resolved.Issues), "media_type")
	require.Contains(t, resolved.Media.AllowedMIMEs, "video/webm")
}

func TestApplyAccountConstraintsUsesMastodonInstanceAttachmentCount(t *testing.T) {
	media := make([]MediaItem, 6)
	for index := range media {
		media[index] = MediaItem{ID: "image", MimeType: "image/jpeg", Size: 1024}
	}
	segments := []ResolveSegment{{ID: "segment-1", Body: "Images", Media: media}}
	resolved := Resolve(ProviderMastodon, ResolveInput{Intent: IntentPost, Segments: segments})
	requireIssueCode(t, resolved.Issues, "media_count")

	ApplyAccountConstraints(&resolved, segments, map[string]any{"media_max_count": 6})
	require.Equal(t, 6, resolved.Media.MaxCount)
	requireNoIssueCode(t, resolved.Issues, "media_count")
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
		{ProviderThreads, models.ContentProfileCarousel, 2, 20},
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
	require.Equal(t, 20, capability.Media.MaxCount)
}

func TestLinkedInImageCapabilitiesMatchMultiImageAPI(t *testing.T) {
	single, ok := Find(ProviderLinkedIn, models.ContentProfileImagePost)
	require.True(t, ok)
	require.ElementsMatch(t, []string{"image/jpeg", "image/png", "image/gif"}, single.Media.AllowedMIMEs)

	var multi Capability
	ok = false
	for _, capability := range All() {
		if capability.Provider == ProviderLinkedIn && capability.OutputProfile == "linkedin.multi_image" {
			multi = capability
			ok = true
			break
		}
	}
	require.True(t, ok)
	require.Equal(t, 2, multi.Media.MinCount)
	require.Equal(t, 20, multi.Media.MaxCount)
	require.ElementsMatch(t, []string{"image/jpeg", "image/png", "image/gif"}, multi.Media.AllowedMIMEs)
}

func TestResolveTransitionsSingleImagesIntoMultiImageProfiles(t *testing.T) {
	for _, provider := range []string{ProviderLinkedIn, ProviderThreads} {
		t.Run(provider, func(t *testing.T) {
			single := Resolve(provider, ResolveInput{
				Intent: IntentPost,
				Segments: []ResolveSegment{{ID: "segment-1", Body: "Caption", Media: []MediaItem{{
					ID: "first", MimeType: "image/jpeg", Size: 1024, PublicURLReady: true, PublicURLStatus: 200,
				}}}},
			})
			require.Equal(t, MediaShapeSingleImage, single.ActiveConstraints["media_shape"])
			require.Equal(t, 1, single.Media.MaxCount)

			multiple := Resolve(provider, ResolveInput{
				Intent: IntentPost,
				Segments: []ResolveSegment{{ID: "segment-1", Body: "Caption", Media: []MediaItem{
					{ID: "first", MimeType: "image/jpeg", Size: 1024, PublicURLReady: true, PublicURLStatus: 200},
					{ID: "second", MimeType: "image/png", Size: 1024, PublicURLReady: true, PublicURLStatus: 200},
				}}},
			})
			require.Equal(t, MediaShapeMultipleImage, multiple.ActiveConstraints["media_shape"])
			require.Equal(t, 20, multiple.Media.MaxCount)
		})
	}
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

func TestValidateOutputUsesMediaShapeForLegacyLinkedInPostProfile(t *testing.T) {
	issues := ValidateOutput(
		ProviderLinkedIn,
		"linkedin.post",
		models.ContentProfileShortText,
		"Image caption",
		"",
		"",
		[]MediaItem{{
			ID:       "image-1",
			MimeType: "image/jpeg",
			Size:     1024,
		}},
		map[string]any{"reshare_disabled": true},
	)

	requireNoIssueCode(t, issues, "media_count")
	requireNoIssueCode(t, issues, "unsupported_setting")
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

func TestTikTokDefaultsToDirectPost(t *testing.T) {
	for _, setting := range tiktokSettings() {
		if setting.Key == "content_posting_method" {
			require.Equal(t, "DIRECT_POST", setting.Default)
			return
		}
	}
	require.Fail(t, "TikTok posting method setting not found")
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
