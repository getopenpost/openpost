package capabilities

import (
	"strings"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/publicationlink"
	"github.com/stretchr/testify/require"
)

func TestBlueskyVideoLimitsAgreeAcrossAuthoringAndProviderValidation(t *testing.T) {
	platform.RegisterAllMediaValidators()
	for _, test := range []struct {
		name     string
		mime     string
		size     int64
		duration int64
		invalid  bool
	}{
		{"at limits", "video/mp4", 300_000_000, 600_000, false},
		{"over byte limit", "video/mp4", 300_000_001, 600_000, true},
		{"over duration limit", "video/mp4", 1_000, 600_001, true},
		{"MOV rejected", "video/quicktime", 1_000, 1_000, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			for _, profile := range []string{models.ContentProfileShortVideo, models.ContentProfileThread} {
				issues := Validate(ProviderBluesky, profile, "Caption", "", "", []MediaItem{{ID: "video-1", MimeType: test.mime, Size: test.size, DurationMS: test.duration, AnalysisStatus: "ready"}}, nil)
				require.Equal(t, test.invalid, len(issues) > 0, "authoring profile %s: %v", profile, issues)
			}
			issues := platform.MediaValidators[ProviderBluesky]([]platform.MediaItem{{ID: "video-1", MimeType: test.mime, Size: test.size, DurationMS: test.duration}})
			require.Equal(t, test.invalid, len(issues) > 0, "provider: %v", issues)
		})
	}
}

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

func TestResolveCatalogUsesConnectorSuppliedCapabilities(t *testing.T) {
	t.Parallel()

	resolved := ResolveCatalog("io.directus.items", []Capability{{
		Provider: "io.directus.items", Profile: "short_text", OutputProfile: "directus.item",
		Label: "Create Directus item", Intents: []string{"post"}, MediaShapes: []string{MediaShapeText},
		Content: ContentConstraint{Body: TextConstraint{Required: true, MaxLength: 100}},
		Media:   MediaConstraint{MinCount: 0, MaxCount: 0}, CapabilityRevision: "directus-items-v1",
	}}, ResolveInput{
		CreationPreset: "post", RequestedOutputProfile: "directus.item",
		Segments: []ResolveSegment{{ID: "segment-1", Body: "Published through Directus"}},
	})

	if !resolved.Compatible {
		t.Fatalf("connector capability should be compatible: %#v", resolved.Issues)
	}
	if resolved.OutputProfile != "directus.item" || resolved.CapabilityRevision != "directus-items-v1" {
		t.Fatalf("unexpected connector capability: %#v", resolved.Capability)
	}
}

func TestSocialSetPresetFieldsAreCommonToEveryShapeOfSelectedOutput(t *testing.T) {
	for _, scenario := range []struct {
		provider string
		output   string
		present  []string
		absent   []string
	}{
		{ProviderX, "x.thread", []string{"reply_settings", "made_with_ai"}, []string{"poll_options", "poll_duration_minutes"}},
		{ProviderX, "x.video", []string{"reply_settings"}, []string{"poll_options"}},
		{ProviderTikTok, "tiktok.video", []string{"duet", "stitch", "is_aigc"}, []string{"photo_title"}},
		{ProviderFacebook, "facebook.video", []string{"video_title", "first_comment"}, []string{"text_format_preset_id"}},
	} {
		resolved := Resolve(scenario.provider, ResolveInput{
			RequestedOutputProfile: scenario.output,
			Context:                ResolveContextSocialSetDefaults,
		})
		fields := map[string]bool{}
		for _, field := range resolved.Settings {
			fields[field.Key] = true
		}
		for _, key := range scenario.present {
			require.True(t, fields[key], "%s should offer %s", scenario.output, key)
		}
		for _, key := range scenario.absent {
			require.False(t, fields[key], "%s should hide %s", scenario.output, key)
		}
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

func TestValidateInstagramStoryWarnsWhenCollaboratorsWillBeOmitted(t *testing.T) {
	story, found := Find(ProviderInstagram, models.ContentProfileStory)
	require.True(t, found)
	for _, setting := range story.Settings {
		require.NotEqual(t, "collaborators", setting.Key)
	}

	issues := ValidateOutput(ProviderInstagram, "instagram.story", models.ContentProfileStory, "", "", "", []MediaItem{{
		ID: "image-1", MimeType: "image/jpeg", Size: 1024, Width: 1080, Height: 1920, PublicURLReady: true, PublicURLStatus: 200,
	}}, map[string]any{"collaborators": "one,two,three,four"})
	requireIssueCode(t, issues, "instagram_story_collaborators_omitted")
	for _, issue := range issues {
		require.NotEqual(t, "error", issue.Severity)
	}
}

func TestValidateOutputAcceptsResolvedLinkURL(t *testing.T) {
	// Every format that allows text without attachments must accept the URI
	// projection produced by the composer's canonical link choice.
	for _, capability := range All() {
		if capability.Media.MinCount > 0 {
			continue
		}
		for _, mode := range []string{"post", "custom"} {
			t.Run(capability.Provider+"/"+capability.Profile+"/"+mode, func(t *testing.T) {
				body := "Read this: https://example.com/post"
				source := map[string]any{"link": map[string]any{"destinations": map[string]any{"account": map[string]any{"mode": mode, "url": "https://example.com/custom"}}}}
				settings, err := publicationlink.Resolve(source, "account", capability.Provider, body, nil, 0)
				require.NoError(t, err)
				issues := ValidateOutput(capability.Provider, capability.OutputProfile, capability.Profile, body, "A title", "", nil, settings)
				for _, issue := range issues {
					require.NotEqual(t, "unsupported_setting", issue.Code, issue.Message)
				}
			})
		}
	}
}

func TestValidateOutputPreservesTextFormatLinkChoices(t *testing.T) {
	for _, profile := range []string{models.ContentProfileShortText, models.ContentProfileThread} {
		for _, mode := range []string{"post", "custom", "no link"} {
			t.Run(profile+"/"+mode, func(t *testing.T) {
				body := "Read https://example.com/post"
				choiceMode := mode
				if mode == "no link" {
					body, choiceMode = "A text update", "post"
				}
				source := map[string]any{"link": map[string]any{"destinations": map[string]any{"account": map[string]any{"mode": choiceMode, "url": "https://example.com/custom"}}}}
				settings, err := publicationlink.Resolve(source, "account", ProviderLinkedIn, body, nil, 0)
				require.NoError(t, err)
				wantURL := "https://example.com/post"
				switch mode {
				case "custom":
					wantURL = "https://example.com/custom"
				case "no link":
					wantURL = ""
				}
				require.Equal(t, wantURL, settings["url"])
				output := "linkedin.post"
				if profile == models.ContentProfileThread {
					output = "linkedin.thread"
				}
				resolved := Resolve(ProviderLinkedIn, ResolveInput{RequestedOutputProfile: output, SourceURL: wantURL, Segments: []ResolveSegment{{Body: body}}})
				require.True(t, resolved.Compatible, "%v", resolved.Issues)
				require.Equal(t, output, resolved.OutputProfile)
				for _, issue := range ValidateOutput(ProviderLinkedIn, output, profile, body, "", "", nil, settings) {
					require.NotEqual(t, "error", issue.Severity, issue.Message)
				}
			})
		}
	}
}

func TestValidateOutputQuoteWithURLRetainsEntitlementError(t *testing.T) {
	issues := ValidateOutput(ProviderX, "x.post", models.ContentProfileShortText, "Read https://example.com/post", "", "", nil,
		map[string]any{"url": "https://example.com/post", "quote_url": "https://x.com/person/status/123"})
	requireNoIssueCode(t, issues, "unsupported_setting")
	requireIssueCode(t, issues, "setting_unavailable")
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

func TestValidateTikTokPhotoShortSideLimit(t *testing.T) {
	issues := ValidateOutput(ProviderTikTok, "tiktok.photo", models.ContentProfileCarousel, "Caption", "", "", []MediaItem{
		{ID: "portrait", MimeType: "image/jpeg", Size: 1024, Width: 1080, Height: 1440, PublicURLReady: true, PublicURLStatus: 200},
		{ID: "oversized", MimeType: "image/jpeg", Size: 1024, Width: 2172, Height: 2896, PublicURLReady: true, PublicURLStatus: 200},
	}, map[string]any{"content_posting_method": "DIRECT_POST", "privacy_level": "SELF_ONLY", "music_usage_confirmed": true})
	require.Len(t, issues, 1)
	require.Equal(t, "media_short_side_max", issues[0].Code)
	require.Equal(t, "oversized", issues[0].MediaID)
	require.Contains(t, issues[0].Message, "2172x2896")
	require.Contains(t, issues[0].Message, "1080 pixels on the shorter side")
}

func TestBlueskyImageValidationEnforcesProviderByteLimit(t *testing.T) {
	for _, test := range []struct {
		name      string
		size      int64
		wantIssue bool
	}{
		{name: "at limit", size: 2_000_000},
		{name: "over limit", size: 2_000_001, wantIssue: true},
		{name: "screenshot", size: 4_203_031, wantIssue: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			issues := Validate(
				ProviderBluesky,
				models.ContentProfileImagePost,
				"Caption",
				"",
				"",
				[]MediaItem{{ID: "image-1", MimeType: "image/png", Size: test.size}},
				map[string]any{},
			)

			if test.wantIssue {
				requireIssueCode(t, issues, "media_size")
				for _, issue := range issues {
					if issue.Code == "media_size" {
						require.Equal(t, map[string]any{"size_bytes": test.size, "max_size_bytes": int64(2_000_000)}, issue.Parameters)
						require.Contains(t, issue.Message, "MB")
					}
				}
				return
			}
			requireNoIssueCode(t, issues, "media_size")
		})
	}

	issues := Validate(
		ProviderBluesky,
		models.ContentProfileThread,
		"Caption",
		"",
		"",
		[]MediaItem{{ID: "video-1", MimeType: "video/mp4", Size: 2_000_001, AnalysisStatus: "ready"}},
		map[string]any{},
	)
	requireNoIssueCode(t, issues, "media_size")
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

func TestApplyAccountConstraintsRevalidatesXTextAndVideo(t *testing.T) {
	segments := []ResolveSegment{{
		ID:   "segment-1",
		Body: strings.Repeat("x", 500),
		Media: []MediaItem{{
			ID:             "video-1",
			MimeType:       "video/mp4",
			Size:           9 * 1024 * 1024 * 1024,
			Width:          1920,
			Height:         1080,
			DurationMS:     1_500_000,
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

	ApplyAccountConstraints(&resolved, AccountConstraintInput{Segments: segments, Constraints: map[string]any{
		"text_limit":                 280,
		"max_video_duration_seconds": 20 * 60,
		"max_video_size_bytes":       int64(8 * 1024 * 1024 * 1024),
	}})

	require.Contains(t, issueCodes(resolved.Issues), "text_too_long")
	require.Contains(t, issueCodes(resolved.Issues), "media_duration")
	require.Contains(t, issueCodes(resolved.Issues), "media_size")
	require.False(t, resolved.Compatible)

	ApplyAccountConstraints(&resolved, AccountConstraintInput{Segments: segments, Constraints: map[string]any{
		"text_limit":                 25_000,
		"max_video_duration_seconds": 125 * 60,
		"max_video_size_bytes":       int64(16 * 1024 * 1024 * 1024),
	}})
	require.NotContains(t, issueCodes(resolved.Issues), "text_too_long")
	require.NotContains(t, issueCodes(resolved.Issues), "media_duration")
	require.NotContains(t, issueCodes(resolved.Issues), "media_size")
	require.True(t, resolved.Compatible)
}

func TestXVideoValidationBlocksAspectRatiosOutsideProviderRange(t *testing.T) {
	invalidVideo := MediaItem{
		ID: "video-1", MimeType: "video/mp4", Size: 1024,
		Width: 4000, Height: 1000, DurationMS: 30_000, AnalysisStatus: "ready",
	}

	videoIssues := Validate(
		ProviderX,
		models.ContentProfileShortVideo,
		"Caption",
		"",
		"",
		[]MediaItem{invalidVideo},
		map[string]any{},
	)
	requireIssueCode(t, videoIssues, "media_video_aspect_range")

	thread := Resolve(ProviderX, ResolveInput{
		CreationPreset: IntentPost,
		Segments: []ResolveSegment{
			{ID: "segment-1", Body: "First"},
			{ID: "segment-2", Body: "Second", Media: []MediaItem{invalidVideo}},
		},
	})
	requireIssueCode(t, thread.Issues, "media_video_aspect_range")
}

func TestXVideoValidationAcceptsProviderAspectRatioBoundaries(t *testing.T) {
	for name, dimensions := range map[string][2]int{
		"one to three": {1000, 3000},
		"three to one": {3000, 1000},
	} {
		t.Run(name, func(t *testing.T) {
			issues := Validate(
				ProviderX,
				models.ContentProfileShortVideo,
				"Caption",
				"",
				"",
				[]MediaItem{{
					ID: "video-1", MimeType: "video/mp4", Size: 1024,
					Width: dimensions[0], Height: dimensions[1], DurationMS: 30_000, AnalysisStatus: "ready",
				}},
				map[string]any{},
			)
			requireNoIssueCode(t, issues, "media_video_aspect_range")
		})
	}
}

func TestVideoCapabilitiesUseSafeProviderSpecificLimits(t *testing.T) {
	tests := []struct {
		provider     string
		profile      string
		maxBytes     int64
		maxDuration  int
		allowedMIMEs []string
	}{
		{ProviderX, models.ContentProfileLongVideo, 8 * 1024 * 1024 * 1024, 20 * 60, []string{"video/mp4"}},
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
			require.Equal(t, "2026-09-26.1", capability.CapabilityRevision)
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
	require.NotContains(t, issueCodes(resolved.Issues), "media_mime")

	ApplyAccountConstraints(&resolved, AccountConstraintInput{Segments: segments, Constraints: map[string]any{
		"max_video_size_bytes": int64(200 * 1024 * 1024),
		"allowed_mimes":        []any{"video/mp4"},
	}})
	require.NotContains(t, issueCodes(resolved.Issues), "media_size")
	require.Contains(t, issueCodes(resolved.Issues), "media_mime")

	ApplyAccountConstraints(&resolved, AccountConstraintInput{Segments: segments, Constraints: map[string]any{
		"max_video_size_bytes": int64(200 * 1024 * 1024),
		"allowed_mimes":        []any{"video/mp4", "video/webm"},
	}})
	require.NotContains(t, issueCodes(resolved.Issues), "media_size")
	require.NotContains(t, issueCodes(resolved.Issues), "media_mime")
	require.Contains(t, resolved.Media.AllowedMIMEs, "video/webm")
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

func TestValidateBlocksMastodonPollWithMedia(t *testing.T) {
	issues := Validate(ProviderMastodon, models.ContentProfileImagePost, "caption", "", "", []MediaItem{{
		ID:       "image-1",
		MimeType: "image/jpeg",
		Size:     1024,
	}}, map[string]any{"poll_options": "One\nTwo"})

	requireIssueCode(t, issues, "mastodon_poll_media_conflict")
}

func TestValidateAllowsInlineURLsWithMedia(t *testing.T) {
	for _, test := range []struct {
		provider        string
		outputProfile   string
		fallbackProfile string
		media           []MediaItem
	}{
		{ProviderFacebook, "facebook.photo", models.ContentProfileImagePost, []MediaItem{{ID: "image-1", MimeType: "image/jpeg", Size: 1024}}},
		{ProviderInstagram, "instagram.feed", models.ContentProfileImagePost, []MediaItem{{ID: "image-1", MimeType: "image/jpeg", Size: 1024}}},
		{ProviderThreads, "threads.post", models.ContentProfileImagePost, []MediaItem{{ID: "image-1", MimeType: "image/jpeg", Size: 1024}}},
		{ProviderX, "x.post", models.ContentProfileImagePost, []MediaItem{{ID: "image-1", MimeType: "image/jpeg", Size: 1024}}},
		{ProviderMastodon, "mastodon.post", models.ContentProfileImagePost, []MediaItem{{ID: "image-1", MimeType: "image/jpeg", Size: 1024}}},
		{ProviderPixelfed, "pixelfed.post", models.ContentProfileImagePost, []MediaItem{{ID: "image-1", MimeType: "image/jpeg", Size: 1024}}},
		{ProviderLinkedIn, "linkedin.multi_image", models.ContentProfileCarousel, []MediaItem{
			{ID: "image-1", MimeType: "image/jpeg", Size: 1024},
			{ID: "image-2", MimeType: "image/jpeg", Size: 1024},
		}},
	} {
		t.Run(test.provider, func(t *testing.T) {
			issues := ValidateOutput(test.provider, test.outputProfile, test.fallbackProfile, "Caption https://example.com", "", "", test.media, map[string]any{
				"url": "https://example.com",
			})
			requireNoIssueCode(t, issues, "unsupported_setting")
		})
	}
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

func TestResolveDropsStaleNativeLinkSettingsOutsideLinkShare(t *testing.T) {
	thread, ok := Find(ProviderThreads, models.ContentProfileThread)
	require.True(t, ok)
	resolved := Resolve(ProviderThreads, ResolveInput{
		CreationPreset:         IntentThread,
		RequestedOutputProfile: thread.OutputProfile,
		Settings:               map[string]any{"url": "https://example.com", "reply_control": "everyone"},
		Segments:               []ResolveSegment{{ID: "segment-1", Body: "A thread without a link"}},
	})

	require.Equal(t, models.ContentProfileThread, resolved.Profile)
	requireNoIssueCode(t, resolved.Issues, "unsupported_setting")

	linkResolved := Resolve(ProviderThreads, ResolveInput{
		CreationPreset: IntentPost,
		SourceURL:      "https://example.com",
		Settings:       map[string]any{"url": "https://example.com"},
		Segments:       []ResolveSegment{{ID: "segment-1", Body: "A link share"}},
	})

	require.Equal(t, models.ContentProfileLinkShare, linkResolved.Profile)
	requireNoIssueCode(t, linkResolved.Issues, "unsupported_setting")
}

func TestProviderSettingsRejectCrossProviderKeys(t *testing.T) {
	t.Parallel()

	issues := Validate(ProviderPinterest, models.ContentProfileImagePost, "caption", "", "", []MediaItem{{
		ID: "image-1", MimeType: "image/jpeg", Size: 1024,
	}}, map[string]any{"board_id": "board-1", "chat_id": "-100123"})
	requireIssueCode(t, issues, "unsupported_setting")

	issues = Validate(ProviderTelegram, models.ContentProfileShortText, "hello", "", "", nil, map[string]any{
		"chat_id": "-100123", "channel_id": "discord-channel",
	})
	requireIssueCode(t, issues, "unsupported_setting")
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

// TestValidateOutputAcceptsAuthoredMentionsOutsideProviderCatalog guards the
// shared authored-metadata boundary for every provider and output format.
func TestValidateOutputAcceptsAuthoredMentionsOutsideProviderCatalog(t *testing.T) {
	t.Parallel()

	for _, capability := range All() {
		t.Run(capability.Provider+"/"+capability.Profile+"/cleared", func(t *testing.T) {
			issues := ValidateOutput(capability.Provider, capability.OutputProfile, capability.Profile,
				"Thanks for the idea!", "A title", "", nil,
				map[string]any{"mentions": map[string]any{"version": 1, "spans": []any{}}})
			for _, issue := range issues {
				require.False(t, issue.Code == "unsupported_setting" && issue.Field == "mentions", issue.Message)
			}
		})
	}
	for _, test := range []struct {
		provider string
		target   map[string]any
	}{
		{ProviderBluesky, map[string]any{"provider": "bluesky", "kind": "person", "id": "did:plc:ewvi7nxzyoun6zhxrhs64oiz"}},
		{ProviderMastodon, map[string]any{"provider": "mastodon", "kind": "person", "id": "123", "handle": "alice", "authority": "https://mastodon.social"}},
		{ProviderLinkedIn, map[string]any{"provider": "linkedin", "kind": "page", "id": "urn:li:organization:123"}},
	} {
		t.Run(test.provider+"/selected", func(t *testing.T) {
			settings := map[string]any{"mentions": map[string]any{
				"version": 1,
				"spans":   []any{map[string]any{"start": 8, "end": 14, "text": "@alice", "target": test.target}},
			}}
			issues := ValidateOutput(test.provider, test.provider+".post", models.ContentProfileShortText,
				"🚀 Hi @alice", "", "", nil, settings)
			requireNoIssueCode(t, issues, "unsupported_setting")
		})
	}
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

	requireIssueForField(t, tiktokIssues, "setting_required", "music_usage_confirmed")

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

// requireNoIssueCode fails the test when any validation issue uses the given code.
func requireNoIssueCode(t *testing.T, issues []ValidationIssue, code string) {
	t.Helper()
	for _, issue := range issues {
		require.NotEqual(t, code, issue.Code)
	}
}

func TestThreadVideoAttachmentsAgreeWithPublisher(t *testing.T) {
	platform.RegisterAllMediaValidators()
	for _, provider := range []string{ProviderX, ProviderBluesky} {
		for _, test := range []struct {
			name    string
			mimes   []string
			invalid bool
		}{
			{"video", []string{"video/mp4"}, false},
			{"images", []string{"image/jpeg", "image/jpeg"}, false},
			{"mixed", []string{"video/mp4", "image/jpeg"}, true},
			{"videos", []string{"video/mp4", "video/mp4"}, true},
		} {
			t.Run(provider+"/"+test.name, func(t *testing.T) {
				media := make([]MediaItem, 0, len(test.mimes))
				providerMedia := make([]platform.MediaItem, 0, len(test.mimes))
				for _, mime := range test.mimes {
					media = append(media, MediaItem{ID: "media", MimeType: mime, Size: 1000, DurationMS: 1000, Width: 1080, Height: 1920, AnalysisStatus: "ready"})
					providerMedia = append(providerMedia, platform.MediaItem{ID: "media", MimeType: mime, Size: 1000})
				}
				issues := Validate(provider, models.ContentProfileThread, "Caption", "", "", media, nil)
				require.Equal(t, test.invalid, len(issues) > 0, "%v", issues)
				require.Equal(t, test.invalid, len(platform.ValidateMedia(provider, providerMedia)) > 0)
			})
		}
	}
}

func TestYouTubeDescriptionValidationMatchesUploadContract(t *testing.T) {
	for _, fixture := range []struct {
		name, text string
		invalid    bool
	}{
		{"accent boundary", strings.Repeat("é", 2500), false},
		{"accent overflow", strings.Repeat("é", 2501), true},
		{"CJK boundary", strings.Repeat("界", 1666) + "ab", false},
		{"CJK overflow", strings.Repeat("界", 1667), true},
		{"emoji boundary", strings.Repeat("😀", 1250), false},
		{"emoji overflow", strings.Repeat("😀", 1251), true},
		{"opening bracket", "Launch <now", true}, {"closing bracket", "Launch now>", true},
	} {
		for _, source := range []string{"body", "description", "setting"} {
			t.Run(fixture.name+"/"+source, func(t *testing.T) {
				body, description := "", ""
				settings := map[string]any{"title": "Launch", "privacy": "private", "category_id": "22"}
				switch source {
				case "body":
					body = fixture.text
				case "description":
					description = fixture.text
				case "setting":
					settings["description"] = fixture.text
				}
				issues := Validate(ProviderYouTube, models.ContentProfileLongVideo, body, "Launch", description, []MediaItem{{ID: "video", MimeType: "video/mp4", Size: 1024, AnalysisStatus: "ready"}}, settings)
				var relevant []ValidationIssue
				for _, issue := range issues {
					if issue.Field == "body" || issue.Field == "description" || issue.Field == "settings.description" {
						relevant = append(relevant, issue)
					}
				}
				if fixture.invalid {
					require.NotEmpty(t, relevant)
				} else {
					require.Empty(t, relevant)
				}
			})
		}
	}
}

func TestYouTubeExplicitDescriptionWinsOverDestinationSetting(t *testing.T) {
	issues := Validate(ProviderYouTube, models.ContentProfileLongVideo, "Body", "Title", strings.Repeat("😀", 1251), []MediaItem{{ID: "video", MimeType: "video/mp4", Size: 1024, AnalysisStatus: "ready"}}, map[string]any{"privacy": "private", "title": "Title", "category_id": "22", "description": "Default description"})
	requireIssueCode(t, issues, "description_invalid")
}

func TestAccountImageLimitsReachMediaValidation(t *testing.T) {
	resolved := Resolve(ProviderMastodon, ResolveInput{RequestedOutputProfile: "mastodon.post"})
	ApplyAccountConstraints(&resolved, AccountConstraintInput{Constraints: map[string]any{"max_image_size_bytes": int64(1000), "max_image_pixels": int64(10000)}, Segments: []ResolveSegment{{Media: []MediaItem{{ID: "image", MimeType: "image/png", Size: 1001, Width: 200, Height: 100}}}}})
	require.Equal(t, int64(1000), resolved.Media.MaxImageSizeBytes)
	requireIssueCode(t, resolved.Issues, "media_size")
	requireIssueCode(t, resolved.Issues, "media_pixels_max")
}
