package capabilities

import (
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
)

const (
	ProviderBluesky   = "bluesky"
	ProviderDiscord   = "discord"
	ProviderFacebook  = "facebook"
	ProviderInstagram = "instagram"
	ProviderLinkedIn  = "linkedin"
	ProviderMastodon  = "mastodon"
	ProviderThreads   = "threads"
	ProviderTikTok    = "tiktok"
	ProviderX         = "x"
	ProviderYouTube   = "youtube"
)

type Profile struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

const (
	IntentPost       = models.PublishingIntentPost
	IntentThread     = models.PublishingIntentThread
	IntentStory      = models.PublishingIntentStory
	IntentShortVideo = models.PublishingIntentShortVideo
	IntentVideo      = models.PublishingIntentVideo

	MediaShapeText          = "text"
	MediaShapeLink          = "link"
	MediaShapeSingleImage   = "single_image"
	MediaShapeMultipleImage = "multiple_images"
	MediaShapeMixedMedia    = "mixed_media"
	MediaShapeDocument      = "document"
	MediaShapeVideo         = "video"

	SettingScopeDestination = "destination"
	SettingScopeSegment     = "segment"
	SettingScopeMediaItem   = "media_item"
)

type SettingConstraint struct {
	Minimum       *float64 `json:"minimum,omitempty"`
	Maximum       *float64 `json:"maximum,omitempty"`
	MinItems      int      `json:"min_items,omitempty"`
	MaxItems      int      `json:"max_items,omitempty"`
	MinLength     int      `json:"min_length,omitempty"`
	MaxLength     int      `json:"max_length,omitempty"`
	Pattern       string   `json:"pattern,omitempty"`
	Accept        []string `json:"accept,omitempty"`
	UniqueItems   bool     `json:"unique_items,omitempty"`
	LocalDateTime bool     `json:"local_date_time,omitempty"`
}

type TextConstraint struct {
	Required             bool `json:"required"`
	MinLength            int  `json:"min_length,omitempty"`
	MaxLength            int  `json:"max_length,omitempty"`
	RecommendedMaxLength int  `json:"recommended_max_length,omitempty"`
}

type ContentConstraint struct {
	Body        TextConstraint `json:"body"`
	Title       TextConstraint `json:"title"`
	Description TextConstraint `json:"description"`
	AltText     TextConstraint `json:"alt_text"`
}

type SettingCondition struct {
	Key      string `json:"key"`
	Operator string `json:"operator" enum:"equals,not_equals,present,absent,in"`
	Value    any    `json:"value,omitempty"`
}

// SettingDefinition describes the meaning and placement of a provider option.
// Type and Label remain compatibility mirrors for clients that predate the
// semantic setting contract.
type SettingDefinition struct {
	Key                string             `json:"key"`
	MessageKey         string             `json:"message_key"`
	Label              string             `json:"label"`
	Group              string             `json:"group" enum:"content,conversation,distribution,disclosure,media_accessibility"`
	Control            string             `json:"control"`
	Type               string             `json:"type"`
	Scope              string             `json:"scope" enum:"destination,segment,media_item"`
	Intents            []string           `json:"intents,omitempty"`
	OutputProfiles     []string           `json:"output_profiles,omitempty"`
	MediaShapes        []string           `json:"media_shapes,omitempty"`
	Required           bool               `json:"required"`
	RequiredPolicy     string             `json:"required_policy,omitempty" enum:"never,always,when_available"`
	Default            any                `json:"default,omitempty"`
	Constraints        SettingConstraint  `json:"constraints,omitempty"`
	Dependencies       []SettingCondition `json:"dependencies,omitempty"`
	Conflicts          []SettingCondition `json:"conflicts,omitempty"`
	Options            []string           `json:"options,omitempty"`
	OptionsSource      string             `json:"options_source,omitempty"`
	Capability         string             `json:"capability,omitempty"`
	AccessRequirements []string           `json:"access_requirements,omitempty"`
	UnavailableReason  string             `json:"unavailable_reason,omitempty"`
	Help               string             `json:"help,omitempty"`
}

// SettingField is retained as a source compatibility alias for integrations
// compiled against the first capability catalog.
type SettingField = SettingDefinition

type MediaConstraint struct {
	MinCount               int      `json:"min_count"`
	MaxCount               int      `json:"max_count"`
	AllowedMIMEs           []string `json:"allowed_mimes"`
	AspectRatios           []string `json:"aspect_ratios,omitempty"`
	MaxDurationSeconds     int      `json:"max_duration_seconds,omitempty"`
	MaxSizeBytes           int64    `json:"max_size_bytes,omitempty"`
	MinWidth               int      `json:"min_width,omitempty"`
	MaxWidth               int      `json:"max_width,omitempty"`
	MinHeight              int      `json:"min_height,omitempty"`
	MaxHeight              int      `json:"max_height,omitempty"`
	AllowedVideoCodecs     []string `json:"allowed_video_codecs,omitempty"`
	AllowedAudioCodecs     []string `json:"allowed_audio_codecs,omitempty"`
	MaxFrameRate           float64  `json:"max_frame_rate,omitempty"`
	AudioPolicy            string   `json:"audio_policy,omitempty" enum:"optional,required,forbidden"`
	RequiresPublicURL      bool     `json:"requires_public_url"`
	RequiresHTTPSFetchable bool     `json:"requires_https_fetchable"`
}

type Capability struct {
	Provider             string              `json:"provider"`
	Profile              string              `json:"profile"`
	OutputProfile        string              `json:"output_profile"`
	Intents              []string            `json:"intents"`
	MediaShapes          []string            `json:"media_shapes"`
	Label                string              `json:"label"`
	ValidationCategories []string            `json:"validation_categories,omitempty"`
	TextLimit            int                 `json:"text_limit,omitempty"`
	TitleRequired        bool                `json:"title_required,omitempty"`
	DescriptionRequired  bool                `json:"description_required,omitempty"`
	NativeScheduling     bool                `json:"native_scheduling"`
	OpenPostQueued       bool                `json:"openpost_queued"`
	RequiresAppReview    bool                `json:"requires_app_review"`
	RequiresPublicMedia  bool                `json:"requires_public_media"`
	Media                MediaConstraint     `json:"media"`
	Content              ContentConstraint   `json:"content"`
	Settings             []SettingDefinition `json:"settings,omitempty"`
	Caveats              []string            `json:"caveats,omitempty"`
	Metadata             map[string]string   `json:"metadata,omitempty"`
	CapabilityRevision   string              `json:"capability_revision"`
	ExpiresAt            string              `json:"expires_at,omitempty"`
	UnavailableReason    string              `json:"unavailable_reason,omitempty"`
}

type MediaItem struct {
	ID              string
	MimeType        string
	Size            int64
	Width           int
	Height          int
	DurationMS      int64
	FrameRate       float64
	VideoCodec      string
	AudioCodec      string
	AudioChannels   int
	AltText         string
	AnalysisStatus  string
	AnalysisError   string
	PublicURLReady  bool
	PublicURLStatus int
	PublicURLError  string
	URL             string
}

type ValidationIssue struct {
	Severity        string         `json:"severity"`
	Code            string         `json:"code"`
	Message         string         `json:"message"`
	FallbackMessage string         `json:"fallback_message"`
	Parameters      map[string]any `json:"parameters,omitempty"`
	Provider        string         `json:"provider,omitempty"`
	Profile         string         `json:"profile,omitempty"`
	OutputProfile   string         `json:"output_profile,omitempty"`
	SegmentID       string         `json:"segment_id,omitempty"`
	Scope           string         `json:"scope,omitempty"`
	ScopeID         string         `json:"scope_id,omitempty"`
	MediaID         string         `json:"media_id,omitempty"`
	Field           string         `json:"field,omitempty"`
}

type ResolveInput struct {
	Intent                 string
	CreationPreset         string
	RequestedOutputProfile string
	SourceURL              string
	Segments               []ResolveSegment
	Settings               map[string]any
}

type ResolveSegment struct {
	ID    string
	Body  string
	Title string
	URL   string
	Media []MediaItem
}

type ResolvedCapability struct {
	Capability
	Compatible              bool                   `json:"compatible"`
	FormatSelectionRequired bool                   `json:"format_selection_required"`
	SegmentStrategy         string                 `json:"segment_strategy" enum:"preserve,join"`
	AvailableFormats        []DestinationFormat    `json:"available_formats"`
	ActiveConstraints       map[string]any         `json:"active_constraints"`
	SettingGroups           []ResolvedSettingGroup `json:"setting_groups"`
	DynamicOptions          map[string][]Option    `json:"dynamic_options,omitempty"`
	Issues                  []ValidationIssue      `json:"issues"`
}

type DestinationFormat struct {
	OutputProfile string `json:"output_profile"`
	Profile       string `json:"profile"`
	Label         string `json:"label"`
	Compatible    bool   `json:"compatible"`
}

type Option struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type ResolvedSettingGroup struct {
	Key      string              `json:"key"`
	Settings []SettingDefinition `json:"settings"`
}

func Profiles() []Profile {
	return []Profile{
		{Key: models.ContentProfileShortText, Name: "Short text", Description: "Fast text-first posts for timelines and feeds."},
		{Key: models.ContentProfileThread, Name: "Thread", Description: "Ordered multi-segment posts and reply chains."},
		{Key: models.ContentProfileLinkShare, Name: "Link share", Description: "URL-driven posts with platform link metadata."},
		{Key: models.ContentProfileImagePost, Name: "Image post", Description: "Single image or simple media feed posts."},
		{Key: models.ContentProfileCarousel, Name: "Carousel", Description: "Multi-image or mixed media swipes."},
		{Key: models.ContentProfileStory, Name: "Story", Description: "Ephemeral vertical story publishing."},
		{Key: models.ContentProfileShortVideo, Name: "Short video", Description: "Reels, Shorts, TikTok, and short-form video."},
		{Key: models.ContentProfileLongVideo, Name: "Long video", Description: "YouTube and feed video uploads with metadata."},
	}
}

func All() []Capability {
	text := MediaConstraint{MinCount: 0, MaxCount: 0}
	linkedinImage := MediaConstraint{MinCount: 1, MaxCount: 1, AllowedMIMEs: []string{"image/jpeg", "image/png", "image/gif"}}
	feedImages := MediaConstraint{MinCount: 1, MaxCount: 10, AllowedMIMEs: []string{"image/jpeg", "image/png", "image/webp"}}
	document := MediaConstraint{MinCount: 1, MaxCount: 1, AllowedMIMEs: []string{
		"application/pdf",
		"application/msword",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.ms-powerpoint",
		"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	}, MaxSizeBytes: 100 * 1024 * 1024}
	publicImages := feedImages
	publicImages.RequiresPublicURL = true
	publicImages.RequiresHTTPSFetchable = true
	publicImage := publicImages
	publicImage.MaxCount = 1
	publicCarousel := publicImages
	publicCarousel.MinCount = 2
	publicMedia := MediaConstraint{
		MinCount:               1,
		MaxCount:               10,
		AllowedMIMEs:           []string{"image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"},
		RequiresPublicURL:      true,
		RequiresHTTPSFetchable: true,
	}
	publicMediaCarousel := publicMedia
	publicMediaCarousel.MinCount = 2
	threadsThreadMedia := publicMedia
	threadsThreadMedia.MinCount = 0
	threadsCarousel := MediaConstraint{
		MinCount:               2,
		MaxCount:               20,
		AllowedMIMEs:           []string{"image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"},
		RequiresPublicURL:      true,
		RequiresHTTPSFetchable: true,
	}
	publicStory := publicMedia
	publicStory.MaxCount = 1
	video := MediaConstraint{MinCount: 1, MaxCount: 1, AllowedMIMEs: []string{"video/mp4", "video/quicktime"}, MaxSizeBytes: 2 * 1024 * 1024 * 1024}
	shortVideo := video
	shortVideo.MaxDurationSeconds = 180
	shortVideo.AspectRatios = []string{"9:16", "1:1"}
	blueskyVideo := MediaConstraint{MinCount: 1, MaxCount: 1, AllowedMIMEs: []string{"video/mp4"}, MaxSizeBytes: 100 * 1024 * 1024}
	xVideo := MediaConstraint{MinCount: 1, MaxCount: 1, AllowedMIMEs: []string{"video/mp4"}, MaxSizeBytes: 512 * 1024 * 1024, MaxDurationSeconds: 140}
	mastodonVideo := MediaConstraint{MinCount: 1, MaxCount: 1, AllowedMIMEs: []string{"video/mp4", "video/quicktime", "video/webm"}, MaxSizeBytes: 99 * 1024 * 1024}
	linkedinVideo := MediaConstraint{MinCount: 1, MaxCount: 1, AllowedMIMEs: []string{"video/mp4"}, MaxSizeBytes: 500 * 1024 * 1024, MaxDurationSeconds: 30 * 60}
	tiktokVideo := MediaConstraint{MinCount: 1, MaxCount: 1, AllowedMIMEs: []string{"video/mp4", "video/quicktime", "video/webm"}, MaxSizeBytes: 4 * 1024 * 1024 * 1024, MaxDurationSeconds: 10 * 60, AspectRatios: []string{"9:16", "1:1"}}
	tiktokVideo.RequiresPublicURL = true
	tiktokVideo.RequiresHTTPSFetchable = true
	discordVideo := MediaConstraint{MinCount: 1, MaxCount: 1, AllowedMIMEs: []string{"video/mp4", "video/quicktime", "video/webm"}, MaxSizeBytes: 10 * 1024 * 1024}
	publicShortVideo := shortVideo
	publicShortVideo.RequiresPublicURL = true
	publicShortVideo.RequiresHTTPSFetchable = true
	tiktokPhotos := MediaConstraint{
		MinCount:               1,
		MaxCount:               35,
		AllowedMIMEs:           []string{"image/jpeg", "image/webp"},
		MaxSizeBytes:           20 * 1024 * 1024,
		RequiresPublicURL:      true,
		RequiresHTTPSFetchable: true,
	}
	longVideo := video
	longVideo.MaxDurationSeconds = 43200
	xThreadMedia := MediaConstraint{
		MinCount:           0,
		MaxCount:           4,
		AllowedMIMEs:       []string{"image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime"},
		MaxSizeBytes:       512 * 1024 * 1024,
		MaxDurationSeconds: 140,
	}

	defaultQueued := func(c Capability) Capability {
		c.OpenPostQueued = true
		if c.OutputProfile == "" {
			c.OutputProfile = outputProfileFor(c.Provider, c.Profile, c.Media)
		}
		c.Intents = intentsFor(c.Profile)
		c.MediaShapes = mediaShapesFor(c.Profile, c.Media)
		c.Settings = normalizeSettingDefinitions(c)
		c.ValidationCategories = validationCategories(c)
		c.CapabilityRevision = "2026-08-03.1"
		return c
	}

	return []Capability{
		defaultQueued(Capability{Provider: ProviderX, Profile: models.ContentProfileShortText, Label: "X post", TextLimit: 25_000, Media: text, Settings: xSettings(), Caveats: []string{"Text limits are reduced unless the connected account reports an active X subscription."}}),
		defaultQueued(Capability{Provider: ProviderX, Profile: models.ContentProfileThread, Label: "X thread", TextLimit: 25_000, Media: xThreadMedia, Settings: xSettings(), Caveats: []string{"Text and video limits are reduced unless the connected account reports an active X subscription."}}),
		defaultQueued(Capability{Provider: ProviderX, Profile: models.ContentProfileLinkShare, Label: "X link", TextLimit: 25_000, Media: text, Settings: append(linkSettings(), xSettings()...), Caveats: []string{"Text limits are reduced unless the connected account reports an active X subscription."}}),
		defaultQueued(Capability{Provider: ProviderX, Profile: models.ContentProfileImagePost, Label: "X image post", TextLimit: 25_000, Media: MediaConstraint{MinCount: 1, MaxCount: 4, AllowedMIMEs: []string{"image/jpeg", "image/png", "image/webp", "image/gif"}}, Settings: xSettings(), Caveats: []string{"Text limits are reduced unless the connected account reports an active X subscription."}}),
		defaultQueued(Capability{Provider: ProviderX, Profile: models.ContentProfileShortVideo, Label: "X video", TextLimit: 25_000, Media: xVideo, Settings: xSettings(), Caveats: []string{"Text and video limits are reduced unless the connected account reports an active X subscription."}}),
		defaultQueued(Capability{Provider: ProviderX, Profile: models.ContentProfileLongVideo, Label: "X video", TextLimit: 25_000, Media: xVideo, Settings: xSettings(), Caveats: []string{"Text and video limits are expanded only when the connected account reports an active X subscription."}}),

		defaultQueued(Capability{Provider: ProviderBluesky, Profile: models.ContentProfileShortText, Label: "Bluesky post", TextLimit: 300, Media: text, Settings: blueskySettings()}),
		defaultQueued(Capability{Provider: ProviderBluesky, Profile: models.ContentProfileThread, Label: "Bluesky thread", TextLimit: 300, Media: MediaConstraint{MinCount: 0, MaxCount: 4, AllowedMIMEs: []string{"image/jpeg", "image/png", "image/webp", "video/mp4"}}, Settings: blueskySettings()}),
		defaultQueued(Capability{Provider: ProviderBluesky, Profile: models.ContentProfileLinkShare, Label: "Bluesky link", TextLimit: 300, Media: text, Settings: blueskySettings()}),
		defaultQueued(Capability{Provider: ProviderBluesky, Profile: models.ContentProfileImagePost, Label: "Bluesky images", TextLimit: 300, Media: MediaConstraint{MinCount: 1, MaxCount: 4, AllowedMIMEs: []string{"image/jpeg", "image/png", "image/webp"}}, Settings: blueskySettings()}),
		defaultQueued(Capability{Provider: ProviderBluesky, Profile: models.ContentProfileShortVideo, Label: "Bluesky video", TextLimit: 300, Media: blueskyVideo, Settings: blueskySettings()}),

		defaultQueued(Capability{Provider: ProviderMastodon, Profile: models.ContentProfileShortText, Label: "Mastodon post", TextLimit: 500, Media: text, Settings: mastodonSettings()}),
		defaultQueued(Capability{Provider: ProviderMastodon, Profile: models.ContentProfileThread, Label: "Mastodon thread", TextLimit: 500, Media: MediaConstraint{MinCount: 0, MaxCount: 4, AllowedMIMEs: []string{"image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4"}}, Settings: mastodonSettings()}),
		defaultQueued(Capability{Provider: ProviderMastodon, Profile: models.ContentProfileLinkShare, Label: "Mastodon link", TextLimit: 500, Media: text, Settings: append(linkSettings(), mastodonSettings()...)}),
		defaultQueued(Capability{Provider: ProviderMastodon, Profile: models.ContentProfileImagePost, Label: "Mastodon media", TextLimit: 500, Media: MediaConstraint{MinCount: 1, MaxCount: 4, AllowedMIMEs: []string{"image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4"}}, Settings: mastodonSettings()}),
		defaultQueued(Capability{Provider: ProviderMastodon, Profile: models.ContentProfileShortVideo, Label: "Mastodon video", TextLimit: 500, Media: mastodonVideo, Settings: mastodonSettings()}),
		defaultQueued(Capability{Provider: ProviderMastodon, Profile: models.ContentProfileLongVideo, Label: "Mastodon video", TextLimit: 500, Media: mastodonVideo, Settings: mastodonSettings()}),

		defaultQueued(Capability{Provider: ProviderThreads, Profile: models.ContentProfileShortText, Label: "Threads post", TextLimit: 500, Media: text, Settings: threadsSettings()}),
		defaultQueued(Capability{Provider: ProviderThreads, Profile: models.ContentProfileThread, Label: "Threads thread", TextLimit: 500, Media: threadsThreadMedia, RequiresPublicMedia: true, Settings: threadsSettings()}),
		defaultQueued(Capability{Provider: ProviderThreads, Profile: models.ContentProfileLinkShare, Label: "Threads link", TextLimit: 500, Media: text, Settings: append(linkSettings(), threadsSettings()...)}),
		defaultQueued(Capability{Provider: ProviderThreads, Profile: models.ContentProfileImagePost, Label: "Threads media", TextLimit: 500, Media: publicImage, RequiresPublicMedia: true, Settings: threadsSettings()}),
		defaultQueued(Capability{Provider: ProviderThreads, Profile: models.ContentProfileCarousel, Label: "Threads carousel", TextLimit: 500, Media: threadsCarousel, RequiresPublicMedia: true, Settings: threadsSettings()}),
		defaultQueued(Capability{Provider: ProviderThreads, Profile: models.ContentProfileShortVideo, Label: "Threads video", TextLimit: 500, Media: publicShortVideo, RequiresPublicMedia: true, Settings: threadsSettings()}),

		defaultQueued(Capability{Provider: ProviderLinkedIn, Profile: models.ContentProfileShortText, Label: "LinkedIn post", TextLimit: 3000, Media: text, Settings: linkedinSettings()}),
		defaultQueued(Capability{Provider: ProviderLinkedIn, Profile: models.ContentProfileThread, Label: "LinkedIn root plus comments", TextLimit: 1250, Media: text, Settings: linkedinSettings()}),
		defaultQueued(Capability{Provider: ProviderLinkedIn, Profile: models.ContentProfileLinkShare, Label: "LinkedIn article", TextLimit: 3000, Media: text, Settings: append(linkSettings(), linkedinSettings()...)}),
		defaultQueued(Capability{Provider: ProviderLinkedIn, Profile: models.ContentProfileImagePost, Label: "LinkedIn image", TextLimit: 3000, Media: linkedinImage, Settings: linkedinSettings()}),
		defaultQueued(Capability{Provider: ProviderLinkedIn, Profile: models.ContentProfileCarousel, Label: "LinkedIn document", TextLimit: 3000, Media: document, Settings: append([]SettingField{{Key: "document_title", Label: "Document title", Type: "text", Required: true}}, linkedinSettings()...)}),
		defaultQueued(Capability{Provider: ProviderLinkedIn, Profile: models.ContentProfileCarousel, OutputProfile: "linkedin.multi_image", Label: "LinkedIn multi-image post", TextLimit: 3000, Media: MediaConstraint{MinCount: 2, MaxCount: 20, AllowedMIMEs: []string{"image/jpeg", "image/png", "image/gif"}}, Settings: linkedinSettings()}),
		defaultQueued(Capability{Provider: ProviderLinkedIn, Profile: models.ContentProfileShortVideo, Label: "LinkedIn video", TextLimit: 3000, Media: linkedinVideo, Settings: linkedinSettings()}),
		defaultQueued(Capability{Provider: ProviderLinkedIn, Profile: models.ContentProfileLongVideo, Label: "LinkedIn video", TextLimit: 3000, Media: linkedinVideo, Settings: linkedinSettings()}),

		defaultQueued(Capability{Provider: ProviderFacebook, Profile: models.ContentProfileShortText, Label: "Facebook Page post", TextLimit: 63206, Media: text, Settings: facebookSettings()}),
		defaultQueued(Capability{Provider: ProviderFacebook, Profile: models.ContentProfileLinkShare, Label: "Facebook Page link", TextLimit: 63206, Media: text, Settings: facebookSettings()}),
		defaultQueued(Capability{Provider: ProviderFacebook, Profile: models.ContentProfileImagePost, Label: "Facebook Page photo", TextLimit: 63206, Media: publicImage, RequiresPublicMedia: true, Settings: facebookSettings()}),
		defaultQueued(Capability{Provider: ProviderFacebook, Profile: models.ContentProfileCarousel, Label: "Facebook multi-photo", TextLimit: 63206, Media: publicCarousel, RequiresPublicMedia: true, Settings: facebookSettings()}),
		defaultQueued(Capability{Provider: ProviderFacebook, Profile: models.ContentProfileStory, Label: "Facebook Page Story", Media: publicStory, RequiresPublicMedia: true, RequiresAppReview: true, Settings: facebookSettings()}),
		defaultQueued(Capability{Provider: ProviderFacebook, Profile: models.ContentProfileShortVideo, Label: "Facebook Reel/video", TextLimit: 63206, Media: publicShortVideo, RequiresPublicMedia: true, Settings: facebookSettings()}),
		defaultQueued(Capability{Provider: ProviderFacebook, Profile: models.ContentProfileLongVideo, Label: "Facebook video", TextLimit: 63206, Media: longVideo, RequiresPublicMedia: true, Settings: facebookSettings()}),

		defaultQueued(Capability{Provider: ProviderInstagram, Profile: models.ContentProfileImagePost, Label: "Instagram feed", TextLimit: 2200, Media: publicImage, RequiresPublicMedia: true, Settings: instagramSettings()}),
		defaultQueued(Capability{Provider: ProviderInstagram, Profile: models.ContentProfileCarousel, Label: "Instagram carousel", TextLimit: 2200, Media: publicMediaCarousel, RequiresPublicMedia: true, Settings: instagramSettings()}),
		defaultQueued(Capability{Provider: ProviderInstagram, Profile: models.ContentProfileStory, Label: "Instagram Story", Media: publicStory, RequiresPublicMedia: true, RequiresAppReview: true, Settings: instagramSettings()}),
		defaultQueued(Capability{Provider: ProviderInstagram, Profile: models.ContentProfileShortVideo, Label: "Instagram Reel", TextLimit: 2200, Media: publicShortVideo, RequiresPublicMedia: true, Settings: instagramSettings()}),

		defaultQueued(Capability{Provider: ProviderYouTube, Profile: models.ContentProfileShortVideo, Label: "YouTube Short", TextLimit: 5000, TitleRequired: true, DescriptionRequired: false, Media: shortVideo, Settings: youtubeSettings(), Caveats: []string{"Unaudited Google projects can force uploads private."}}),
		defaultQueued(Capability{Provider: ProviderYouTube, Profile: models.ContentProfileLongVideo, Label: "YouTube video", TextLimit: 5000, TitleRequired: true, DescriptionRequired: false, Media: longVideo, Settings: youtubeSettings(), Caveats: []string{"Unaudited Google projects can force uploads private."}}),

		defaultQueued(Capability{Provider: ProviderTikTok, Profile: models.ContentProfileShortVideo, Label: "TikTok video", TextLimit: 2200, Media: tiktokVideo, RequiresPublicMedia: true, RequiresAppReview: true, Settings: tiktokSettings()}),
		defaultQueued(Capability{Provider: ProviderTikTok, Profile: models.ContentProfileCarousel, Label: "TikTok photo post", TextLimit: 4000, Media: tiktokPhotos, RequiresPublicMedia: true, RequiresAppReview: true, Settings: tiktokSettings()}),

		defaultQueued(Capability{Provider: ProviderDiscord, Profile: models.ContentProfileShortText, Label: "Discord message", TextLimit: 2000, Media: text}),
		defaultQueued(Capability{Provider: ProviderDiscord, Profile: models.ContentProfileImagePost, Label: "Discord attachment", TextLimit: 2000, Media: MediaConstraint{MinCount: 1, MaxCount: 10, AllowedMIMEs: []string{"image/jpeg", "image/png", "image/webp", "image/gif"}, MaxSizeBytes: 10 * 1024 * 1024}}),
		defaultQueued(Capability{Provider: ProviderDiscord, Profile: models.ContentProfileShortVideo, Label: "Discord video", TextLimit: 2000, Media: discordVideo}),
		defaultQueued(Capability{Provider: ProviderDiscord, Profile: models.ContentProfileLongVideo, Label: "Discord video", TextLimit: 2000, Media: discordVideo}),
	}
}

//nolint:gocyclo
func outputProfileFor(provider, profile string, media MediaConstraint) string {
	suffix := "post"
	switch profile {
	case models.ContentProfileThread:
		suffix = "thread"
	case models.ContentProfileStory:
		suffix = "story"
	case models.ContentProfileShortVideo:
		switch provider {
		case ProviderInstagram, ProviderFacebook:
			suffix = "reel"
		case ProviderYouTube:
			suffix = "short"
		default:
			suffix = "video"
		}
	case models.ContentProfileLongVideo:
		suffix = "video"
	case models.ContentProfileCarousel:
		switch {
		case provider == ProviderLinkedIn && acceptsDocument(media.AllowedMIMEs):
			suffix = "document"
		case provider == ProviderTikTok:
			suffix = "photo"
		default:
			suffix = "carousel"
		}
	case models.ContentProfileImagePost:
		switch provider {
		case ProviderFacebook:
			suffix = "photo"
		case ProviderInstagram:
			suffix = "feed"
		}
	case models.ContentProfileLinkShare:
		switch provider {
		case ProviderLinkedIn:
			suffix = "article"
		default:
			suffix = "post"
		}
	}
	return provider + "." + suffix
}

func intentsFor(profile string) []string {
	switch profile {
	case models.ContentProfileThread:
		return []string{IntentThread}
	case models.ContentProfileStory:
		return []string{IntentStory}
	case models.ContentProfileShortVideo:
		return []string{IntentShortVideo}
	case models.ContentProfileLongVideo:
		return []string{IntentVideo}
	default:
		return []string{IntentPost}
	}
}

func mediaShapesFor(profile string, media MediaConstraint) []string {
	if profile == models.ContentProfileLinkShare {
		return []string{MediaShapeLink}
	}
	if media.MaxCount == 0 {
		return []string{MediaShapeText}
	}
	if acceptsDocument(media.AllowedMIMEs) {
		return []string{MediaShapeDocument}
	}
	hasImage := false
	hasVideo := false
	for _, mimeType := range media.AllowedMIMEs {
		hasImage = hasImage || strings.HasPrefix(mimeType, "image/")
		hasVideo = hasVideo || strings.HasPrefix(mimeType, "video/")
	}
	shapes := []string{}
	if hasImage {
		shapes = append(shapes, MediaShapeSingleImage)
		if media.MaxCount > 1 {
			shapes = append(shapes, MediaShapeMultipleImage)
		}
	}
	if hasVideo {
		shapes = append(shapes, MediaShapeVideo)
	}
	if hasImage && hasVideo && media.MaxCount > 1 {
		shapes = append(shapes, MediaShapeMixedMedia)
	}
	if media.MinCount == 0 {
		shapes = append(shapes, MediaShapeText, MediaShapeLink)
	}
	return uniqueStrings(shapes)
}

func normalizeSettingDefinitions(capability Capability) []SettingDefinition {
	out := make([]SettingDefinition, 0, len(capability.Settings)+2)
	for _, raw := range capability.Settings {
		definition := raw
		if definition.Control == "" {
			definition.Control = legacyControl(definition.Type)
		}
		if definition.Type == "" {
			definition.Type = definition.Control
		}
		if definition.Scope == "" {
			definition.Scope = SettingScopeDestination
		}
		if definition.Group == "" {
			definition.Group = settingGroup(definition.Key)
		}
		if definition.MessageKey == "" {
			definition.MessageKey = "publishing.setting." + strings.ReplaceAll(definition.Key, "_", ".")
		}
		if len(definition.Intents) == 0 {
			definition.Intents = append([]string(nil), capability.Intents...)
		}
		if len(definition.OutputProfiles) == 0 {
			definition.OutputProfiles = []string{capability.OutputProfile}
		}
		if len(definition.MediaShapes) == 0 {
			definition.MediaShapes = append([]string(nil), capability.MediaShapes...)
		}
		if definition.Required && definition.RequiredPolicy == "" {
			definition.RequiredPolicy = "always"
		} else if definition.RequiredPolicy == "" {
			definition.RequiredPolicy = "never"
		}
		out = append(out, definition)
	}
	if altShapes := altTextMediaShapes(capability); len(altShapes) > 0 {
		out = append(out, SettingDefinition{
			Key:            "alt_text",
			MessageKey:     "publishing.setting.alt.text",
			Label:          "Alt text",
			Group:          "media_accessibility",
			Control:        "alt_text",
			Type:           "textarea",
			Scope:          SettingScopeMediaItem,
			Intents:        append([]string(nil), capability.Intents...),
			OutputProfiles: []string{capability.OutputProfile},
			MediaShapes:    altShapes,
			RequiredPolicy: "never",
		})
	}
	return out
}

func altTextMediaShapes(capability Capability) []string {
	switch capability.Provider {
	case ProviderX, ProviderMastodon, ProviderBluesky:
		return filterMediaShapes(capability.MediaShapes, MediaShapeSingleImage, MediaShapeMultipleImage, MediaShapeMixedMedia, MediaShapeVideo)
	case ProviderLinkedIn, ProviderInstagram, ProviderThreads:
		return filterMediaShapes(capability.MediaShapes, MediaShapeSingleImage, MediaShapeMultipleImage, MediaShapeMixedMedia)
	default:
		return nil
	}
}

func filterMediaShapes(shapes []string, allowed ...string) []string {
	out := []string{}
	for _, shape := range shapes {
		if slices.Contains(allowed, shape) {
			out = append(out, shape)
		}
	}
	return out
}

func legacyControl(fieldType string) string {
	switch fieldType {
	case "textarea":
		return "long_text"
	case "media":
		return "media_picker"
	case "json":
		return "structured"
	default:
		return fieldType
	}
}

func settingGroup(key string) string {
	switch key {
	case "poll_options", "poll_duration_minutes", "poll_expires_in_seconds", "poll_multiple", "poll_hide_totals",
		"reply_settings", "reply_control", "reply_approvals", "visibility", "reshare_disabled", "first_comment":
		return "conversation"
	case "paid_partnership", "made_with_ai", "brand_content_toggle", "brand_organic_toggle",
		"is_aigc", "contains_synthetic_media", "self_declared_made_for_kids", "paid_placement", "music_usage_confirmed":
		return "disclosure"
	case "thumbnail_media_id", "cover_media_id", "thumbnail_timestamp_ms", "cover_timestamp_ms",
		"caption_media_id", "collaborators", "user_tags", "product_tags", "location_id":
		return "media_accessibility"
	case "privacy", "privacy_level", "playlist_id", "category_id", "notify_subscribers",
		"content_posting_method", "community_id", "topic_tag", "text_format_preset_id":
		return "distribution"
	default:
		return "content"
	}
}

func uniqueStrings(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

// Resolve selects a destination format from source shape and an optional creation
// preset. A requested output profile always wins so explicit user choices are never
// silently replaced when the source changes.
func Resolve(provider string, input ResolveInput) ResolvedCapability {
	provider = strings.ToLower(strings.TrimSpace(provider))
	preset := normalizeIntent(firstNonEmptyCapability(input.CreationPreset, input.Intent))
	inputShape := resolveMediaShape(input.Segments, input.SourceURL)
	shape := intendedMediaShape(preset, inputShape)
	issues := []ValidationIssue{}
	selected := selectDestinationCapability(provider, input, shape, preset)
	availableFormats := destinationFormats(provider, input, shape, preset)
	formatSelectionRequired := destinationFormatSelectionRequired(provider, input, shape)
	if selected == nil {
		message := fmt.Sprintf("%s does not expose a publishing format", provider)
		issues = append(issues, validationIssue("unsupported_destination", message, provider, "", "output_profile"))
		return ResolvedCapability{
			Capability: Capability{
				Provider:           provider,
				Intents:            []string{preset},
				MediaShapes:        []string{shape},
				CapabilityRevision: "2026-08-03.1",
			},
			Compatible:       false,
			SegmentStrategy:  "preserve",
			AvailableFormats: availableFormats,
			ActiveConstraints: map[string]any{
				"creation_preset":   preset,
				"media_shape":       shape,
				"input_media_shape": inputShape,
			},
			Issues: issues,
		}
	}

	intent := firstCapabilityIntent(*selected)
	if formatSelectionRequired {
		message := fmt.Sprintf("Choose how this content should be published on %s", providerDisplayName(provider))
		issues = append(issues, validationIssue("format_selection_required", message, provider, selected.Profile, "output_profile"))
	}
	activeSettings := make([]SettingDefinition, 0, len(selected.Settings))
	for _, setting := range selected.Settings {
		if settingApplies(setting, intent, selected.OutputProfile, shape) {
			activeSettings = append(activeSettings, setting)
		}
	}
	selected.Settings = activeSettings
	segmentStrategy := destinationSegmentStrategy(*selected, len(input.Segments))
	effectiveSegments := destinationSegments(input.Segments, segmentStrategy)
	for _, segment := range effectiveSegments {
		segmentIssues := validateCapability(
			*selected,
			segment.Body,
			segment.Title,
			"",
			segment.Media,
			input.Settings,
		)
		for index := range segmentIssues {
			segmentIssues[index].SegmentID = segment.ID
			segmentIssues[index].Scope = SettingScopeSegment
			segmentIssues[index].ScopeID = segment.ID
			segmentIssues[index].OutputProfile = selected.OutputProfile
		}
		issues = append(issues, segmentIssues...)
	}
	return ResolvedCapability{
		Capability:              *selected,
		Compatible:              !hasErrorIssues(issues),
		FormatSelectionRequired: formatSelectionRequired,
		SegmentStrategy:         segmentStrategy,
		AvailableFormats:        availableFormats,
		ActiveConstraints: map[string]any{
			"creation_preset":   preset,
			"intent":            intent,
			"media_shape":       shape,
			"input_media_shape": inputShape,
			"text_limit":        selected.TextLimit,
			"media":             selected.Media,
			"segment_count":     len(effectiveSegments),
		},
		SettingGroups: groupSettings(activeSettings),
		Issues:        issues,
	}
}

func providerDisplayName(provider string) string {
	switch provider {
	case ProviderX:
		return "X"
	case ProviderLinkedIn:
		return "LinkedIn"
	case ProviderTikTok:
		return "TikTok"
	case ProviderYouTube:
		return "YouTube"
	case ProviderFacebook:
		return "Facebook"
	case ProviderInstagram:
		return "Instagram"
	case ProviderMastodon:
		return "Mastodon"
	case ProviderBluesky:
		return "Bluesky"
	case ProviderThreads:
		return "Threads"
	case ProviderDiscord:
		return "Discord"
	default:
		return provider
	}
}

func selectDestinationCapability(provider string, input ResolveInput, shape, preset string) *Capability {
	requested := strings.TrimSpace(input.RequestedOutputProfile)
	if requested != "" {
		if candidate, ok := bestOutputCapability(provider, requested, shape); ok {
			return &candidate
		}
		return nil
	}
	var selected *Capability
	bestScore := -1 << 30
	for _, candidate := range All() {
		if candidate.Provider != provider {
			continue
		}
		score := destinationCapabilityScore(candidate, input, shape, preset)
		if score <= bestScore {
			continue
		}
		candidateCopy := candidate
		selected = &candidateCopy
		bestScore = score
	}
	return selected
}

func destinationCapabilityScore(candidate Capability, input ResolveInput, shape, preset string) int {
	return destinationMediaShapeScore(candidate, shape) +
		destinationThreadScore(candidate, len(input.Segments)) +
		destinationPresetScore(candidate, preset, len(input.Segments)) +
		destinationSourceShapeScore(candidate, input, shape)
}

func destinationMediaShapeScore(candidate Capability, shape string) int {
	if slices.Contains(candidate.MediaShapes, shape) {
		return 120
	}
	return -80
}

func destinationThreadScore(candidate Capability, segmentCount int) int {
	threadPreferred := destinationThreadPreferred(candidate, segmentCount)
	if candidate.Profile == models.ContentProfileThread {
		if threadPreferred {
			return 90
		}
		return -35
	}
	if segmentCount > 1 && !threadPreferred {
		return 35
	}
	return 0
}

func destinationPresetScore(candidate Capability, preset string, segmentCount int) int {
	score := 0
	if candidate.Profile == models.ContentProfileStory && preset != IntentStory {
		score -= 160
	}
	switch preset {
	case IntentThread:
		if candidate.Profile == models.ContentProfileThread && destinationThreadPreferred(candidate, segmentCount) {
			score += 45
		}
	case IntentStory:
		if candidate.Profile == models.ContentProfileStory {
			score += 180
		}
	case IntentShortVideo:
		if candidate.Profile == models.ContentProfileShortVideo {
			score += 150
		}
	case IntentVideo:
		if candidate.Profile == models.ContentProfileLongVideo {
			score += 150
		}
	}
	return score
}

func destinationThreadPreferred(candidate Capability, segmentCount int) bool {
	return segmentCount > 1 && slices.Contains(
		[]string{ProviderX, ProviderThreads, ProviderBluesky, ProviderMastodon},
		candidate.Provider,
	)
}

func destinationSourceShapeScore(candidate Capability, input ResolveInput, shape string) int {
	switch shape {
	case MediaShapeDocument:
		if candidate.OutputProfile == ProviderLinkedIn+".document" {
			return 120
		}
	case MediaShapeMultipleImage, MediaShapeMixedMedia:
		if candidate.Profile == models.ContentProfileCarousel {
			return 80
		}
	case MediaShapeSingleImage:
		if candidate.Profile == models.ContentProfileImagePost {
			return 70
		}
	case MediaShapeLink:
		if candidate.Profile == models.ContentProfileLinkShare {
			return 70
		}
	case MediaShapeText:
		if candidate.Profile == models.ContentProfileShortText {
			return 60
		}
	case MediaShapeVideo:
		return destinationVideoShapeScore(candidate, input.Segments)
	}
	return 0
}

func destinationVideoShapeScore(candidate Capability, segments []ResolveSegment) int {
	shortForm := sourceLooksShortForm(segments)
	if candidate.Profile == models.ContentProfileShortVideo && shortForm {
		return 45
	}
	if candidate.Provider == ProviderYouTube && candidate.Profile == models.ContentProfileLongVideo && !shortForm {
		return 45
	}
	return 0
}

func sourceLooksShortForm(segments []ResolveSegment) bool {
	for _, segment := range segments {
		for _, media := range segment.Media {
			if !strings.HasPrefix(strings.ToLower(media.MimeType), "video/") {
				continue
			}
			// Shorts are inferred only when both facts needed for a certain
			// classification are available. A short landscape video is still a
			// regular YouTube video, and incomplete media analysis must not guess.
			return media.Width > 0 && media.Height > 0 && media.Height >= media.Width &&
				media.DurationMS > 0 && media.DurationMS <= 180_000
		}
	}
	return false
}

func destinationFormatSelectionRequired(provider string, input ResolveInput, shape string) bool {
	if strings.TrimSpace(input.RequestedOutputProfile) != "" {
		return false
	}
	if !slices.Contains([]string{ProviderInstagram, ProviderFacebook, ProviderTikTok}, provider) {
		return false
	}

	profiles := map[string]struct{}{}
	for _, candidate := range All() {
		if candidate.Provider != provider || !slices.Contains(candidate.MediaShapes, shape) {
			continue
		}
		profiles[candidate.OutputProfile] = struct{}{}
	}
	return len(profiles) > 1
}

func destinationFormats(provider string, input ResolveInput, shape, preset string) []DestinationFormat {
	seen := map[string]struct{}{}
	formats := []DestinationFormat{}
	for _, candidate := range All() {
		if candidate.Provider != provider {
			continue
		}
		if _, exists := seen[candidate.OutputProfile]; exists {
			continue
		}
		selected, ok := bestOutputCapability(provider, candidate.OutputProfile, shape)
		if !ok {
			continue
		}
		formats = append(formats, DestinationFormat{
			OutputProfile: selected.OutputProfile,
			Profile:       selected.Profile,
			Label:         selected.Label,
			// Compatibility here describes whether the current source shape can
			// become this format. Missing provider settings and unfinished media
			// processing remain validation issues, but must not hide a valid format
			// from the user's explicit Instagram or Facebook choice.
			Compatible: slices.Contains(selected.MediaShapes, shape),
		})
		seen[selected.OutputProfile] = struct{}{}
	}
	sort.SliceStable(formats, func(i, j int) bool {
		left := Capability{Provider: provider, Profile: formats[i].Profile, OutputProfile: formats[i].OutputProfile}
		right := Capability{Provider: provider, Profile: formats[j].Profile, OutputProfile: formats[j].OutputProfile}
		return destinationCapabilityScore(left, input, shape, preset) > destinationCapabilityScore(right, input, shape, preset)
	})
	return formats
}

func bestOutputCapability(provider, outputProfile, shape string) (Capability, bool) {
	var fallback *Capability
	for _, candidate := range All() {
		if candidate.Provider != provider || candidate.OutputProfile != outputProfile {
			continue
		}
		candidateCopy := candidate
		if slices.Contains(candidate.MediaShapes, shape) {
			return candidateCopy, true
		}
		if fallback == nil {
			fallback = &candidateCopy
		}
	}
	if fallback != nil {
		return *fallback, true
	}
	return Capability{}, false
}

func destinationSegmentStrategy(capability Capability, segmentCount int) string {
	if segmentCount > 1 && capability.Profile != models.ContentProfileThread {
		return "join"
	}
	return "preserve"
}

func destinationSegments(segments []ResolveSegment, strategy string) []ResolveSegment {
	if strategy != "join" || len(segments) < 2 {
		return segments
	}
	joined := ResolveSegment{ID: segments[0].ID, Title: segments[0].Title, URL: segments[0].URL}
	bodies := make([]string, 0, len(segments))
	for _, segment := range segments {
		if body := strings.TrimSpace(segment.Body); body != "" {
			bodies = append(bodies, body)
		}
		joined.Media = append(joined.Media, segment.Media...)
	}
	joined.Body = strings.Join(bodies, "\n\n")
	return []ResolveSegment{joined}
}

func firstCapabilityIntent(capability Capability) string {
	if len(capability.Intents) == 0 {
		return IntentPost
	}
	return capability.Intents[0]
}

// ApplyAccountConstraints replaces account-varying text and media limits, then
// revalidates every segment against the effective connected-account capability.
func ApplyAccountConstraints(resolved *ResolvedCapability, segments []ResolveSegment, constraints map[string]any) {
	if resolved == nil {
		return
	}
	applyResolvedConstraintValues(resolved, constraints)

	issues := make([]ValidationIssue, 0, len(resolved.Issues))
	for _, issue := range resolved.Issues {
		if issue.Scope != SettingScopeSegment {
			issues = append(issues, issue)
		}
	}
	for _, segment := range segments {
		issues = append(issues, validateAccountConstraintSegment(*resolved, segment, constraints)...)
	}
	resolved.Issues = issues
	resolved.Compatible = !hasErrorIssues(issues)
}

func applyResolvedConstraintValues(resolved *ResolvedCapability, constraints map[string]any) {
	if value, ok := constraintInt(constraints["text_limit"]); ok && value > 0 {
		resolved.TextLimit = value
	}
	if value, ok := constraintInt(constraints["media_max_count"]); ok && value > 0 {
		resolved.Media.MaxCount = value
	}
	if value, ok := constraintInt(constraints["max_video_duration_seconds"]); ok && value > 0 {
		resolved.Media.MaxDurationSeconds = value
	}
	if value, ok := constraintInt64(constraints["max_video_size_bytes"]); ok && value > 0 {
		resolved.Media.MaxSizeBytes = value
	}
	if values := constraintStrings(constraints["allowed_mimes"]); len(values) > 0 {
		resolved.Media.AllowedMIMEs = values
		resolved.MediaShapes = mediaShapesFor(resolved.Profile, resolved.Media)
	}
}

func constraintStrings(value any) []string {
	switch typed := value.(type) {
	case []string:
		return uniqueStrings(typed)
	case []any:
		values := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				values = append(values, text)
			}
		}
		return uniqueStrings(values)
	default:
		return nil
	}
}

func validateAccountConstraintSegment(resolved ResolvedCapability, segment ResolveSegment, constraints map[string]any) []ValidationIssue {
	segmentIssues := validateCapability(
		resolved.Capability,
		segment.Body,
		segment.Title,
		"",
		segment.Media,
		nil,
	)
	for index := range segmentIssues {
		segmentIssues[index].SegmentID = segment.ID
		segmentIssues[index].Scope = SettingScopeSegment
		segmentIssues[index].ScopeID = segment.ID
		segmentIssues[index].OutputProfile = resolved.OutputProfile
	}
	if maxVideoSizeBytes, ok := constraintInt64(constraints["max_video_size_bytes"]); ok && maxVideoSizeBytes > 0 {
		for _, media := range segment.Media {
			if strings.HasPrefix(strings.ToLower(media.MimeType), "video/") &&
				media.Size > maxVideoSizeBytes &&
				!hasMediaValidationIssue(segmentIssues, media.ID, "media_size") {
				segmentIssues = append(segmentIssues, ValidationIssue{
					Severity:        "error",
					Code:            "media_size",
					Message:         "Video file is too large for this account",
					FallbackMessage: "Video file is too large for this account",
					Provider:        resolved.Provider,
					Profile:         resolved.Profile,
					OutputProfile:   resolved.OutputProfile,
					SegmentID:       segment.ID,
					Scope:           SettingScopeSegment,
					ScopeID:         segment.ID,
					MediaID:         media.ID,
					Field:           "media",
				})
			}
		}
	}
	return segmentIssues
}

func hasMediaValidationIssue(issues []ValidationIssue, mediaID, code string) bool {
	for _, issue := range issues {
		if issue.MediaID == mediaID && issue.Code == code {
			return true
		}
	}
	return false
}

func constraintInt(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case float64:
		return int(typed), true
	case json.Number:
		parsed, err := typed.Int64()
		return int(parsed), err == nil
	default:
		return 0, false
	}
}

func constraintInt64(value any) (int64, bool) {
	switch typed := value.(type) {
	case int:
		return int64(typed), true
	case int64:
		return typed, true
	case float64:
		return int64(typed), true
	case json.Number:
		parsed, err := typed.Int64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

func intendedMediaShape(intent, inputShape string) string {
	if inputShape != MediaShapeText {
		return inputShape
	}
	switch intent {
	case IntentShortVideo, IntentVideo:
		return MediaShapeVideo
	case IntentStory:
		return MediaShapeSingleImage
	default:
		return inputShape
	}
}

func normalizeIntent(intent string) string {
	switch strings.TrimSpace(intent) {
	case "", models.ContentProfileShortText, models.ContentProfileLinkShare, models.ContentProfileImagePost, models.ContentProfileCarousel:
		return IntentPost
	case models.ContentProfileLongVideo:
		return IntentVideo
	default:
		return strings.TrimSpace(intent)
	}
}

func resolveMediaShape(segments []ResolveSegment, sourceURL string) string {
	media := []MediaItem{}
	for _, segment := range segments {
		media = append(media, segment.Media...)
		if sourceURL == "" {
			sourceURL = segment.URL
		}
	}
	if len(media) == 0 {
		if strings.TrimSpace(sourceURL) != "" {
			return MediaShapeLink
		}
		return MediaShapeText
	}
	hasImage := false
	hasVideo := false
	hasDocument := false
	for _, item := range media {
		hasImage = hasImage || strings.HasPrefix(strings.ToLower(item.MimeType), "image/")
		hasVideo = hasVideo || strings.HasPrefix(strings.ToLower(item.MimeType), "video/")
		hasDocument = hasDocument || strings.HasPrefix(strings.ToLower(item.MimeType), "application/")
	}
	switch {
	case hasDocument:
		return MediaShapeDocument
	case hasImage && hasVideo:
		return MediaShapeMixedMedia
	case hasVideo:
		return MediaShapeVideo
	case len(media) > 1:
		return MediaShapeMultipleImage
	default:
		return MediaShapeSingleImage
	}
}

func settingApplies(setting SettingDefinition, intent, outputProfile, shape string) bool {
	return (len(setting.Intents) == 0 || slices.Contains(setting.Intents, intent)) &&
		(len(setting.OutputProfiles) == 0 || slices.Contains(setting.OutputProfiles, outputProfile)) &&
		(len(setting.MediaShapes) == 0 || slices.Contains(setting.MediaShapes, shape))
}

func groupSettings(settings []SettingDefinition) []ResolvedSettingGroup {
	order := []string{"content", "conversation", "distribution", "disclosure", "media_accessibility"}
	groups := make([]ResolvedSettingGroup, 0, len(order))
	for _, key := range order {
		group := ResolvedSettingGroup{Key: key}
		for _, setting := range settings {
			if setting.Group == key {
				group.Settings = append(group.Settings, setting)
			}
		}
		if len(group.Settings) > 0 {
			groups = append(groups, group)
		}
	}
	return groups
}

func hasErrorIssues(issues []ValidationIssue) bool {
	for _, issue := range issues {
		if issue.Severity == "error" {
			return true
		}
	}
	return false
}

func validationIssue(code, message, provider, profile, field string) ValidationIssue {
	return ValidationIssue{
		Severity:        "error",
		Code:            code,
		Message:         message,
		FallbackMessage: message,
		Provider:        provider,
		Profile:         profile,
		Field:           field,
	}
}

// ProviderTextLimit returns the provider's generic post limit when short text is
// supported, otherwise the conservative limit across its publication profiles.
func ProviderTextLimit(provider string) (int, bool) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == ProviderX {
		// Legacy post validation has no connected-account context, so it must
		// keep X's standard limit. Account-aware publications use the resolver.
		return 280, true
	}
	limit := 0
	for _, capability := range All() {
		if capability.Provider != provider || capability.TextLimit <= 0 {
			continue
		}
		if capability.Profile == models.ContentProfileShortText {
			return capability.TextLimit, true
		}
		if limit == 0 || capability.TextLimit < limit {
			limit = capability.TextLimit
		}
	}
	return limit, limit > 0
}

func Find(provider, profile string) (Capability, bool) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	profile = strings.TrimSpace(profile)
	for _, capability := range All() {
		if capability.Provider == provider && capability.Profile == profile {
			return capability, true
		}
	}
	return Capability{}, false
}

func FindOutput(provider, outputProfile string) (Capability, bool) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	outputProfile = strings.TrimSpace(outputProfile)
	for _, capability := range All() {
		if capability.Provider == provider && capability.OutputProfile == outputProfile {
			return capability, true
		}
	}
	return Capability{}, false
}

func Validate(provider, profile, body, title, description string, media []MediaItem, settings map[string]any) []ValidationIssue {
	capability, ok := Find(provider, profile)
	if !ok {
		message := fmt.Sprintf("%s does not support %s", provider, profile)
		return []ValidationIssue{validationIssue("unsupported_profile", message, provider, profile, "profile")}
	}
	return validateCapability(capability, body, title, description, media, settings)
}

func ValidateOutput(provider, outputProfile, fallbackProfile, body, title, description string, media []MediaItem, settings map[string]any) []ValidationIssue {
	shape := resolveMediaShape([]ResolveSegment{{Media: media}}, "")
	if capability, ok := findOutputForValidation(provider, outputProfile, fallbackProfile, shape); ok {
		intent := ""
		if len(capability.Intents) > 0 {
			intent = capability.Intents[0]
		}
		active := make([]SettingDefinition, 0, len(capability.Settings))
		for _, setting := range capability.Settings {
			if settingApplies(setting, intent, capability.OutputProfile, shape) {
				active = append(active, setting)
			}
		}
		capability.Settings = active
		return validateCapability(capability, body, title, description, media, settings)
	}
	return Validate(provider, fallbackProfile, body, title, description, media, settings)
}

//nolint:gocyclo
func ValidateMediaSettings(provider, outputProfile, fallbackProfile string, media MediaItem, settings map[string]any) []ValidationIssue {
	shape := resolveMediaShape([]ResolveSegment{{Media: []MediaItem{media}}}, "")
	capability, ok := findOutputForValidation(provider, outputProfile, fallbackProfile, shape)
	if !ok {
		capability, ok = Find(provider, fallbackProfile)
	}
	if !ok {
		return []ValidationIssue{validationIssue("unsupported_profile", fmt.Sprintf("%s does not support %s", provider, fallbackProfile), provider, fallbackProfile, "profile")}
	}
	intent := ""
	if len(capability.Intents) > 0 {
		intent = capability.Intents[0]
	}
	active := make([]SettingDefinition, 0, len(capability.Settings))
	for _, field := range capability.Settings {
		if field.Scope == SettingScopeMediaItem && settingApplies(field, intent, capability.OutputProfile, shape) {
			active = append(active, field)
		}
	}
	capability.Settings = active
	issues := validateUnsupportedSettings(capability, settings)
	for _, field := range active {
		value := settingsValue(settings, field.Key)
		if field.Required && settingDependenciesMet(field, settings, 1) && (value == "" || (field.Type == "boolean" && !settingBooleanValue(settings, field.Key))) {
			issues = append(issues, settingValidationIssue(capability, field, "setting_required", fmt.Sprintf("%s is required", field.Label)))
			continue
		}
		if value == "" || (field.Type == "boolean" && !settingBooleanValue(settings, field.Key)) {
			continue
		}
		issues = append(issues, validateSettingDefinition(capability, field, settings, 1)...)
	}
	for index := range issues {
		issues[index].MediaID = media.ID
		issues[index].Scope = SettingScopeMediaItem
		issues[index].ScopeID = media.ID
		if issues[index].FallbackMessage == "" {
			issues[index].FallbackMessage = issues[index].Message
		}
	}
	return issues
}

// findOutputForValidation resolves historical output-profile collisions using
// the content that is being validated. LinkedIn text and single-image
// renditions both used linkedin.post, so selecting the first catalog match
// incorrectly applied the text-only media limit to image posts.
func findOutputForValidation(provider, outputProfile, fallbackProfile, shape string) (Capability, bool) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	outputProfile = strings.TrimSpace(outputProfile)
	fallbackProfile = strings.TrimSpace(fallbackProfile)

	var shapeMatch *Capability
	for _, candidate := range All() {
		if candidate.Provider != provider || candidate.OutputProfile != outputProfile {
			continue
		}
		if !slices.Contains(candidate.MediaShapes, shape) {
			continue
		}
		candidateCopy := candidate
		if candidate.Profile == fallbackProfile {
			return candidateCopy, true
		}
		if shapeMatch == nil {
			shapeMatch = &candidateCopy
		}
	}
	if shapeMatch != nil {
		return *shapeMatch, true
	}
	return Capability{}, false
}

//nolint:gocyclo
func validateCapability(capability Capability, body, title, description string, media []MediaItem, settings map[string]any) []ValidationIssue {
	provider := capability.Provider
	profile := capability.Profile
	issues := []ValidationIssue{}
	if capability.TextLimit > 0 && TextLength(provider, body) > capability.TextLimit {
		issues = append(issues, ValidationIssue{Severity: "error", Code: "text_too_long", Message: fmt.Sprintf("Text is over the %d character limit", capability.TextLimit), Provider: provider, Profile: profile, Field: "body"})
	}
	if capability.TitleRequired && strings.TrimSpace(title) == "" {
		issues = append(issues, ValidationIssue{Severity: "error", Code: "title_required", Message: "Title is required", Provider: provider, Profile: profile, Field: "title"})
	}
	if capability.DescriptionRequired && strings.TrimSpace(description) == "" {
		issues = append(issues, ValidationIssue{Severity: "error", Code: "description_required", Message: "Description is required", Provider: provider, Profile: profile, Field: "description"})
	}
	issues = append(issues, validateTextConstraint(capability, "body", body, capability.Content.Body)...)
	issues = append(issues, validateTextConstraint(capability, "title", title, capability.Content.Title)...)
	issues = append(issues, validateTextConstraint(capability, "description", description, capability.Content.Description)...)
	if len(media) < capability.Media.MinCount {
		issues = append(issues, ValidationIssue{
			Severity: "error",
			Code:     "media_required",
			Message:  missingMediaMessage(capability),
			Provider: provider,
			Profile:  profile,
			Field:    "media",
		})
	} else if len(media) > capability.Media.MaxCount {
		issues = append(issues, ValidationIssue{
			Severity: "error",
			Code:     "media_count",
			Message:  fmt.Sprintf("Remove media until this destination has no more than %d item(s).", capability.Media.MaxCount),
			Provider: provider,
			Profile:  profile,
			Field:    "media",
		})
	}
	for _, item := range media {
		issues = append(issues, validateMediaItem(capability, item)...)
	}
	issues = append(issues, validateUnsupportedSettings(capability, settings)...)
	for _, field := range capability.Settings {
		value := settingsValue(settings, field.Key)
		switch field.Key {
		case "title":
			value = firstNonEmptyCapability(value, title)
		case "description":
			value = firstNonEmptyCapability(value, description)
		}
		if field.Required && settingDependenciesMet(field, settings, len(media)) && (value == "" || (field.Type == "boolean" && !settingBooleanValue(settings, field.Key))) {
			issues = append(issues, settingValidationIssue(capability, field, "setting_required", fmt.Sprintf("%s is required", field.Label)))
			continue
		}
		if value == "" || (field.Type == "boolean" && !settingBooleanValue(settings, field.Key)) {
			continue
		}
		issues = append(issues, validateSettingDefinition(capability, field, settings, len(media))...)
	}
	issues = append(issues, validateProviderSettings(provider, profile, len(media), settings)...)
	for index := range issues {
		if issues[index].FallbackMessage == "" {
			issues[index].FallbackMessage = issues[index].Message
		}
		if issues[index].OutputProfile == "" {
			issues[index].OutputProfile = capability.OutputProfile
		}
	}
	return issues
}

func missingMediaMessage(capability Capability) string {
	hasImage := false
	hasVideo := false
	for _, mimeType := range capability.Media.AllowedMIMEs {
		hasImage = hasImage || strings.HasPrefix(mimeType, "image/")
		hasVideo = hasVideo || strings.HasPrefix(mimeType, "video/")
	}
	switch {
	case hasVideo && !hasImage && capability.Media.MinCount == 1:
		return "Add a video."
	case hasImage && !hasVideo && capability.Media.MinCount == 1:
		return "Add an image."
	case hasImage && hasVideo && capability.Media.MinCount == 1:
		return "Add an image or video."
	default:
		return fmt.Sprintf("Add at least %d media item(s).", capability.Media.MinCount)
	}
}

//nolint:gocyclo
func validateSettingDefinition(capability Capability, field SettingDefinition, settings map[string]any, mediaCount int) []ValidationIssue {
	issues := []ValidationIssue{}
	if field.UnavailableReason != "" {
		return []ValidationIssue{settingValidationIssue(capability, field, "setting_unavailable", field.UnavailableReason)}
	}
	for _, dependency := range field.Dependencies {
		if !settingConditionMatches(dependency, settings, mediaCount) {
			issues = append(issues, settingValidationIssue(capability, field, "setting_dependency", fmt.Sprintf("%s requires %s", field.Label, dependency.Key)))
		}
	}
	for _, conflict := range field.Conflicts {
		if settingConditionMatches(conflict, settings, mediaCount) {
			issues = append(issues, settingValidationIssue(capability, field, "setting_conflict", fmt.Sprintf("%s conflicts with %s", field.Label, conflict.Key)))
		}
	}
	value := settingsValue(settings, field.Key)
	if field.Control == "media_tags" {
		return validateMediaTagsSetting(capability, field, value)
	}
	if len(field.Options) > 0 && !slices.Contains(field.Options, value) {
		issues = append(issues, settingValidationIssue(capability, field, "setting_option_invalid", fmt.Sprintf("%s is not a supported choice", field.Label)))
	}
	if field.Control == "poll" || field.Type == "tags" {
		items := splitSettingItems(value)
		if field.Constraints.MinItems > 0 && len(items) < field.Constraints.MinItems {
			issues = append(issues, settingValidationIssue(capability, field, "setting_min_items", fmt.Sprintf("%s requires at least %d values", field.Label, field.Constraints.MinItems)))
		}
		if field.Constraints.MaxItems > 0 && len(items) > field.Constraints.MaxItems {
			issues = append(issues, settingValidationIssue(capability, field, "setting_max_items", fmt.Sprintf("%s supports at most %d values", field.Label, field.Constraints.MaxItems)))
		}
		for _, item := range items {
			if field.Constraints.MinLength > 0 && len([]rune(item)) < field.Constraints.MinLength {
				issues = append(issues, settingValidationIssue(capability, field, "setting_item_too_short", fmt.Sprintf("%s contains a value that is too short", field.Label)))
				break
			}
			if field.Constraints.MaxLength > 0 && len([]rune(item)) > field.Constraints.MaxLength {
				issues = append(issues, settingValidationIssue(capability, field, "setting_item_too_long", fmt.Sprintf("%s contains a value that is too long", field.Label)))
				break
			}
		}
		return issues
	}
	if field.Constraints.MinLength > 0 && len([]rune(value)) < field.Constraints.MinLength {
		issues = append(issues, settingValidationIssue(capability, field, "setting_too_short", fmt.Sprintf("%s is too short", field.Label)))
	}
	if field.Constraints.MaxLength > 0 && len([]rune(value)) > field.Constraints.MaxLength {
		issues = append(issues, settingValidationIssue(capability, field, "setting_too_long", fmt.Sprintf("%s is too long", field.Label)))
	}
	if field.Constraints.Minimum != nil || field.Constraints.Maximum != nil {
		number, err := strconv.ParseFloat(value, 64)
		if err != nil {
			issues = append(issues, settingValidationIssue(capability, field, "setting_number_invalid", fmt.Sprintf("%s must be a number", field.Label)))
		} else {
			if field.Constraints.Minimum != nil && number < *field.Constraints.Minimum {
				issues = append(issues, settingValidationIssue(capability, field, "setting_below_minimum", fmt.Sprintf("%s must be at least %v", field.Label, *field.Constraints.Minimum)))
			}
			if field.Constraints.Maximum != nil && number > *field.Constraints.Maximum {
				issues = append(issues, settingValidationIssue(capability, field, "setting_above_maximum", fmt.Sprintf("%s must be at most %v", field.Label, *field.Constraints.Maximum)))
			}
		}
	}
	if field.Constraints.Pattern != "" {
		// Pattern enforcement is intentionally limited to URL controls here;
		// catalog patterns are otherwise consumed by generated clients.
		if field.Type == "url" {
			parsed, err := url.Parse(value)
			if err != nil || parsed.Scheme == "" || parsed.Host == "" {
				issues = append(issues, settingValidationIssue(capability, field, "setting_url_invalid", fmt.Sprintf("%s must be a valid URL", field.Label)))
			}
		}
	} else if field.Type == "url" {
		parsed, err := url.Parse(value)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			issues = append(issues, settingValidationIssue(capability, field, "setting_url_invalid", fmt.Sprintf("%s must be a valid URL", field.Label)))
		}
	}
	if field.Constraints.LocalDateTime {
		if strings.ContainsAny(value, "Zz+") {
			issues = append(issues, settingValidationIssue(capability, field, "setting_local_datetime_invalid", fmt.Sprintf("%s must be a local date and time without a timezone", field.Label)))
		} else if _, err := time.Parse("2006-01-02T15:04", value); err != nil {
			issues = append(issues, settingValidationIssue(capability, field, "setting_local_datetime_invalid", fmt.Sprintf("%s must use YYYY-MM-DDTHH:MM", field.Label)))
		}
	}
	return issues
}

func validateTextConstraint(capability Capability, field, value string, constraint TextConstraint) []ValidationIssue {
	length := TextLength(capability.Provider, value)
	if constraint.Required && strings.TrimSpace(value) == "" {
		return []ValidationIssue{{Severity: "error", Code: field + "_required", Message: capabilityFieldLabel(field) + " is required", Provider: capability.Provider, Profile: capability.Profile, Field: field}}
	}
	if constraint.MinLength > 0 && length < constraint.MinLength {
		return []ValidationIssue{{Severity: "error", Code: field + "_too_short", Message: fmt.Sprintf("%s must contain at least %d characters", capabilityFieldLabel(field), constraint.MinLength), Provider: capability.Provider, Profile: capability.Profile, Field: field}}
	}
	if constraint.MaxLength > 0 && length > constraint.MaxLength {
		return []ValidationIssue{{Severity: "error", Code: field + "_too_long", Message: fmt.Sprintf("%s is over the %d character limit", capabilityFieldLabel(field), constraint.MaxLength), Provider: capability.Provider, Profile: capability.Profile, Field: field}}
	}
	if constraint.RecommendedMaxLength > 0 && length > constraint.RecommendedMaxLength {
		return []ValidationIssue{{Severity: "warning", Code: field + "_recommended_length", Message: fmt.Sprintf("Keep %s at %d characters or fewer when possible", field, constraint.RecommendedMaxLength), Provider: capability.Provider, Profile: capability.Profile, Field: field}}
	}
	return nil
}

func capabilityFieldLabel(field string) string {
	field = strings.ReplaceAll(field, "_", " ")
	if field == "" {
		return "Field"
	}
	return strings.ToUpper(field[:1]) + field[1:]
}

func validateMediaTagsSetting(capability Capability, field SettingDefinition, value string) []ValidationIssue {
	var tags []map[string]interface{}
	if err := json.Unmarshal([]byte(value), &tags); err != nil {
		return []ValidationIssue{settingValidationIssue(capability, field, "setting_json_invalid", fmt.Sprintf("%s must contain valid structured tags", field.Label))}
	}
	if field.Constraints.MaxItems > 0 && len(tags) > field.Constraints.MaxItems {
		return []ValidationIssue{settingValidationIssue(capability, field, "setting_max_items", fmt.Sprintf("%s supports at most %d values", field.Label, field.Constraints.MaxItems))}
	}
	requiredKey := "username"
	if field.Key == "product_tags" {
		requiredKey = "product_id"
	}
	issues := []ValidationIssue{}
	for _, tag := range tags {
		if strings.TrimSpace(fmt.Sprint(tag[requiredKey])) == "" {
			issues = append(issues, settingValidationIssue(capability, field, "setting_tag_value_required", fmt.Sprintf("%s requires %s", field.Label, requiredKey)))
			break
		}
		for _, coordinate := range []string{"x", "y"} {
			raw, exists := tag[coordinate]
			if !exists {
				if field.Key == "user_tags" {
					issues = append(issues, settingValidationIssue(capability, field, "setting_tag_coordinate_required", fmt.Sprintf("%s requires %s coordinates for images", field.Label, coordinate)))
				}
				continue
			}
			value, ok := raw.(float64)
			if !ok || value < 0 || value > 1 {
				issues = append(issues, settingValidationIssue(capability, field, "setting_tag_coordinate_invalid", fmt.Sprintf("%s %s must be between 0 and 1", field.Label, coordinate)))
			}
		}
	}
	return issues
}

func settingValidationIssue(capability Capability, field SettingDefinition, code, message string) ValidationIssue {
	return ValidationIssue{
		Severity:        "error",
		Code:            code,
		Message:         message,
		FallbackMessage: message,
		Parameters:      map[string]any{"setting": field.Key},
		Provider:        capability.Provider,
		Profile:         capability.Profile,
		OutputProfile:   capability.OutputProfile,
		Scope:           field.Scope,
		Field:           field.Key,
	}
}

func settingConditionMatches(condition SettingCondition, settings map[string]any, mediaCount int) bool {
	var value any
	present := false
	if condition.Key == "media" {
		value = mediaCount
		present = mediaCount > 0
	} else {
		value, present = settings[condition.Key]
		present = present && value != nil && strings.TrimSpace(fmt.Sprint(value)) != ""
	}
	switch condition.Operator {
	case "present":
		return present
	case "absent":
		return !present
	case "equals":
		return present && fmt.Sprint(value) == fmt.Sprint(condition.Value)
	case "not_equals":
		return !present || fmt.Sprint(value) != fmt.Sprint(condition.Value)
	case "in":
		expected, ok := condition.Value.([]string)
		return ok && slices.Contains(expected, fmt.Sprint(value))
	default:
		return false
	}
}

func settingDependenciesMet(field SettingDefinition, settings map[string]any, mediaCount int) bool {
	for _, dependency := range field.Dependencies {
		if !settingConditionMatches(dependency, settings, mediaCount) {
			return false
		}
	}
	return true
}

func settingBooleanValue(settings map[string]any, key string) bool {
	value, exists := settings[key]
	if !exists {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		parsed, _ := strconv.ParseBool(strings.TrimSpace(typed))
		return parsed
	default:
		return false
	}
}

func splitSettingItems(value string) []string {
	items := strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == '\n' })
	out := make([]string, 0, len(items))
	for _, item := range items {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func firstNonEmptyCapability(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func validateUnsupportedSettings(capability Capability, settings map[string]any) []ValidationIssue {
	if len(settings) == 0 {
		return nil
	}
	known := map[string]struct{}{}
	for _, field := range capability.Settings {
		known[field.Key] = struct{}{}
	}
	issues := []ValidationIssue{}
	for key, value := range settings {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if _, ok := known[key]; ok {
			continue
		}
		if legacySettingSupported(capability.Provider, key) {
			continue
		}
		if strings.TrimSpace(fmt.Sprint(value)) == "" {
			continue
		}
		issues = append(issues, ValidationIssue{
			Severity: "error",
			Code:     "unsupported_setting",
			Message:  fmt.Sprintf("%s is not supported for %s", key, capability.Label),
			Provider: capability.Provider,
			Profile:  capability.Profile,
			Field:    key,
		})
	}
	return issues
}

func legacySettingSupported(provider, key string) bool {
	switch provider {
	case ProviderX:
		return key == "quote_tweet_id"
	case ProviderBluesky:
		return key == "quote_uri" || key == "quote_cid" || key == "mention_dids"
	default:
		return false
	}
}

func validateProviderSettings(provider, profile string, mediaCount int, settings map[string]any) []ValidationIssue {
	switch provider {
	case ProviderX:
		return validateXSettings(profile, mediaCount, settings)
	case ProviderMastodon:
		return validateMastodonSettings(profile, mediaCount, settings)
	case ProviderTikTok:
		return validateTikTokSettings(profile, mediaCount, settings)
	default:
		return nil
	}
}

func validateXSettings(profile string, mediaCount int, settings map[string]any) []ValidationIssue {
	attachmentKinds := 0
	if mediaCount > 0 {
		attachmentKinds++
	}
	if settingsValue(settings, "quote_url") != "" || settingsValue(settings, "quote_tweet_id") != "" {
		attachmentKinds++
	}
	if settingsValue(settings, "poll_options") != "" {
		attachmentKinds++
	}
	if attachmentKinds <= 1 {
		return nil
	}
	return []ValidationIssue{{
		Severity: "error",
		Code:     "x_mutually_exclusive_attachment",
		Message:  "X posts can include only one of media, poll, or quote post.",
		Provider: ProviderX,
		Profile:  profile,
		Field:    "settings",
	}}
}

func validateMastodonSettings(profile string, mediaCount int, settings map[string]any) []ValidationIssue {
	if mediaCount == 0 || settingsValue(settings, "poll_options") == "" {
		return nil
	}
	return []ValidationIssue{{
		Severity: "error",
		Code:     "mastodon_poll_media_conflict",
		Message:  "Mastodon polls cannot be combined with media attachments.",
		Provider: ProviderMastodon,
		Profile:  profile,
		Field:    "poll_options",
	}}
}

func validateTikTokSettings(profile string, mediaCount int, settings map[string]any) []ValidationIssue {
	if profile != models.ContentProfileCarousel || settingsValue(settings, "cover_index") == "" {
		return nil
	}
	index, err := strconv.Atoi(settingsValue(settings, "cover_index"))
	if err == nil && index >= 0 && index < mediaCount {
		return nil
	}
	return []ValidationIssue{{
		Severity: "error",
		Code:     "tiktok_cover_index_invalid",
		Message:  "TikTok cover image must select one of the attached photos.",
		Provider: ProviderTikTok,
		Profile:  profile,
		Field:    "cover_index",
	}}
}

//nolint:gocyclo
func validateMediaItem(capability Capability, item MediaItem) []ValidationIssue {
	issues := []ValidationIssue{}
	if len(capability.Media.AllowedMIMEs) > 0 && !mimeAllowed(item.MimeType, capability.Media.AllowedMIMEs) {
		issues = append(issues, ValidationIssue{Severity: "error", Code: "media_mime", Message: fmt.Sprintf("%s is not accepted for %s", item.MimeType, capability.Label), Provider: capability.Provider, Profile: capability.Profile, MediaID: item.ID})
	}
	if capability.Media.MaxSizeBytes > 0 && item.Size > capability.Media.MaxSizeBytes {
		issues = append(issues, ValidationIssue{Severity: "error", Code: "media_size", Message: "Media file is too large", Provider: capability.Provider, Profile: capability.Profile, MediaID: item.ID})
	}
	for _, boundary := range []struct {
		invalid bool
		code    string
		message string
	}{
		{capability.Media.MinWidth > 0 && item.Width < capability.Media.MinWidth, "media_width_min", fmt.Sprintf("Media width must be at least %d pixels", capability.Media.MinWidth)},
		{capability.Media.MaxWidth > 0 && item.Width > capability.Media.MaxWidth, "media_width_max", fmt.Sprintf("Media width must be at most %d pixels", capability.Media.MaxWidth)},
		{capability.Media.MinHeight > 0 && item.Height < capability.Media.MinHeight, "media_height_min", fmt.Sprintf("Media height must be at least %d pixels", capability.Media.MinHeight)},
		{capability.Media.MaxHeight > 0 && item.Height > capability.Media.MaxHeight, "media_height_max", fmt.Sprintf("Media height must be at most %d pixels", capability.Media.MaxHeight)},
	} {
		if boundary.invalid {
			issues = append(issues, ValidationIssue{Severity: "error", Code: boundary.code, Message: boundary.message, Provider: capability.Provider, Profile: capability.Profile, MediaID: item.ID})
		}
	}
	if len(capability.Media.AllowedVideoCodecs) > 0 && !stringSliceContainsFold(capability.Media.AllowedVideoCodecs, item.VideoCodec) {
		issues = append(issues, ValidationIssue{Severity: "error", Code: "media_video_codec", Message: "Video codec is not supported", Provider: capability.Provider, Profile: capability.Profile, MediaID: item.ID})
	}
	if len(capability.Media.AllowedAudioCodecs) > 0 && item.AudioCodec != "" && !stringSliceContainsFold(capability.Media.AllowedAudioCodecs, item.AudioCodec) {
		issues = append(issues, ValidationIssue{Severity: "error", Code: "media_audio_codec", Message: "Audio codec is not supported", Provider: capability.Provider, Profile: capability.Profile, MediaID: item.ID})
	}
	if capability.Media.MaxFrameRate > 0 && item.FrameRate > capability.Media.MaxFrameRate {
		issues = append(issues, ValidationIssue{Severity: "error", Code: "media_frame_rate", Message: fmt.Sprintf("Video frame rate must be %.2f fps or lower", capability.Media.MaxFrameRate), Provider: capability.Provider, Profile: capability.Profile, MediaID: item.ID})
	}
	if capability.Media.AudioPolicy == "required" && item.AudioChannels == 0 {
		issues = append(issues, ValidationIssue{Severity: "error", Code: "media_audio_required", Message: "Video must include audio", Provider: capability.Provider, Profile: capability.Profile, MediaID: item.ID})
	}
	if capability.Media.AudioPolicy == "forbidden" && item.AudioChannels > 0 {
		issues = append(issues, ValidationIssue{Severity: "error", Code: "media_audio_forbidden", Message: "Video must not include audio", Provider: capability.Provider, Profile: capability.Profile, MediaID: item.ID})
	}
	issues = append(issues, validateTextConstraint(capability, "alt_text", item.AltText, capability.Content.AltText)...)
	if strings.HasPrefix(item.MimeType, "video/") && item.AnalysisStatus != "" && item.AnalysisStatus != "ready" && item.AnalysisStatus != "failed" {
		issues = append(issues, ValidationIssue{Severity: "error", Code: "media_analysis_pending", Message: "Video analysis must finish before scheduling or publishing", Provider: capability.Provider, Profile: capability.Profile, MediaID: item.ID})
	}
	if strings.HasPrefix(item.MimeType, "video/") && item.AnalysisStatus == "failed" {
		issues = append(issues, ValidationIssue{Severity: "error", Code: "media_analysis_failed", Message: firstNonEmpty(item.AnalysisError, "Video analysis failed"), Provider: capability.Provider, Profile: capability.Profile, MediaID: item.ID})
	}
	if capability.Media.MaxDurationSeconds > 0 && item.DurationMS > int64(capability.Media.MaxDurationSeconds)*1000 {
		issues = append(issues, ValidationIssue{Severity: "error", Code: "media_duration", Message: fmt.Sprintf("Video must be %d seconds or less", capability.Media.MaxDurationSeconds), Provider: capability.Provider, Profile: capability.Profile, MediaID: item.ID})
	}
	if len(capability.Media.AspectRatios) > 0 && item.Width > 0 && item.Height > 0 && !ratioAllowed(item.Width, item.Height, capability.Media.AspectRatios) {
		issues = append(issues, ValidationIssue{Severity: "warning", Code: "media_aspect", Message: "Media should be vertical or square for this profile", Provider: capability.Provider, Profile: capability.Profile, MediaID: item.ID})
	}
	if capability.Media.RequiresPublicURL && !item.PublicURLReady {
		issues = append(issues, ValidationIssue{Severity: "error", Code: "public_url_unreachable", Message: firstNonEmpty(item.PublicURLError, "Media publishing to this account requires a public HTTPS media URL. Ask an OpenPost administrator to configure OPENPOST_MEDIA_URL."), Provider: capability.Provider, Profile: capability.Profile, MediaID: item.ID})
	} else if !capability.Media.RequiresPublicURL && capability.Media.RequiresHTTPSFetchable && item.URL != "" {
		parsed, err := url.Parse(item.URL)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
			issues = append(issues, ValidationIssue{Severity: "error", Code: "https_media_required", Message: "Public media URL must be HTTPS", Provider: capability.Provider, Profile: capability.Profile, MediaID: item.ID})
		}
	}
	return issues
}

func stringSliceContainsFold(values []string, candidate string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), strings.TrimSpace(candidate)) {
			return true
		}
	}
	return false
}

func validationCategories(c Capability) []string {
	categories := []string{"media_count", "mime"}
	if c.Media.MaxDurationSeconds > 0 {
		categories = append(categories, "duration")
	}
	if len(c.Media.AspectRatios) > 0 {
		categories = append(categories, "aspect")
	}
	if acceptsDocument(c.Media.AllowedMIMEs) {
		categories = append(categories, "document")
	}
	if c.RequiresPublicMedia || c.Media.RequiresPublicURL {
		categories = append(categories, "public_url")
	}
	if c.TitleRequired {
		categories = append(categories, "title")
	}
	if c.DescriptionRequired {
		categories = append(categories, "description")
	}
	for _, setting := range c.Settings {
		if setting.Type == "media" && strings.Contains(setting.Key, "thumbnail") {
			categories = append(categories, "thumbnail")
			break
		}
	}
	if c.RequiresAppReview {
		categories = append(categories, "app_review")
	}
	return categories
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func mimeAllowed(mimeType string, allowed []string) bool {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	for _, candidate := range allowed {
		candidate = strings.ToLower(candidate)
		if candidate == mimeType {
			return true
		}
		if strings.HasSuffix(candidate, "/*") && strings.HasPrefix(mimeType, strings.TrimSuffix(candidate, "*")) {
			return true
		}
	}
	return false
}

func ratioAllowed(width, height int, ratios []string) bool {
	actual := float64(width) / float64(height)
	for _, ratio := range ratios {
		switch ratio {
		case "9:16":
			if math.Abs(actual-(9.0/16.0)) < 0.08 {
				return true
			}
		case "1:1":
			if math.Abs(actual-1) < 0.08 {
				return true
			}
		case "16:9":
			if math.Abs(actual-(16.0/9.0)) < 0.08 {
				return true
			}
		}
	}
	return false
}

func acceptsDocument(allowed []string) bool {
	for _, mimeType := range allowed {
		switch strings.ToLower(strings.TrimSpace(mimeType)) {
		case "application/pdf",
			"application/msword",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			"application/vnd.ms-powerpoint",
			"application/vnd.openxmlformats-officedocument.presentationml.presentation":
			return true
		}
	}
	return false
}

func settingsValue(settings map[string]any, key string) string {
	if settings == nil {
		return ""
	}
	if value, ok := settings[key]; ok {
		return strings.TrimSpace(fmt.Sprint(value))
	}
	return ""
}

func linkSettings() []SettingField {
	return []SettingField{{Key: "url", Label: "URL", Type: "url", Control: "url", Required: true}}
}

func xSettings() []SettingField {
	return []SettingField{
		{Key: "quote_url", Label: "Quote post", Type: "url", Control: "quote_url", MediaShapes: []string{MediaShapeText}, Conflicts: []SettingCondition{{Key: "poll_options", Operator: "present"}}, Capability: "enterprise_quote", UnavailableReason: "Quote publishing requires X Enterprise API access."},
		{Key: "poll_options", Label: "Poll", Type: "textarea", Control: "poll", Scope: SettingScopeSegment, MediaShapes: []string{MediaShapeText}, Constraints: SettingConstraint{MinItems: 2, MaxItems: 4, MinLength: 1, MaxLength: 25}, Conflicts: []SettingCondition{{Key: "media", Operator: "present"}, {Key: "quote_url", Operator: "present"}}, Help: "Add 2–4 options. Polls cannot include media or a quote."},
		{Key: "poll_duration_minutes", Label: "Poll duration", Type: "number", Scope: SettingScopeSegment, Constraints: SettingConstraint{Minimum: float64Pointer(5), Maximum: float64Pointer(10080)}, Dependencies: []SettingCondition{{Key: "poll_options", Operator: "present"}}},
		{Key: "reply_settings", Label: "Who can reply", Type: "select", Options: []string{"following", "mentionedUsers", "subscribers", "verified"}},
		{Key: "community_id", Label: "Community", Type: "select", Control: "remote_picker", OptionsSource: "x_communities", Capability: "communities", UnavailableReason: "X has not granted this account access to Community publishing options."},
		{Key: "location_id", Label: "Location", Type: "select", Control: "remote_picker", OptionsSource: "x_locations", Capability: "geo", UnavailableReason: "X has not granted this account access to location publishing options."},
		{Key: "paid_partnership", Label: "Paid partnership", Type: "boolean"},
		{Key: "made_with_ai", Label: "Made with AI", Type: "boolean"},
		{Key: "tagged_users", Label: "Tag people", Type: "tags", Control: "user_picker", Scope: SettingScopeMediaItem, MediaShapes: []string{MediaShapeSingleImage, MediaShapeMultipleImage}},
	}
}

func mastodonSettings() []SettingField {
	return []SettingField{
		{Key: "visibility", Label: "Visibility", Type: "select", Options: []string{"public", "unlisted", "private", "direct"}},
		{Key: "spoiler_text", Label: "Content warning", Type: "text"},
		{Key: "sensitive", Label: "Sensitive media", Type: "boolean"},
		{Key: "language", Label: "Language", Type: "tags", Control: "language", Help: "BCP 47 language tag."},
		{Key: "poll_options", Label: "Poll", Type: "textarea", Control: "poll", Scope: SettingScopeSegment, MediaShapes: []string{MediaShapeText}, Constraints: SettingConstraint{MinItems: 2, MaxItems: 4}, Conflicts: []SettingCondition{{Key: "media", Operator: "present"}}, Help: "Poll limits come from the connected Mastodon server."},
		{Key: "poll_expires_in_seconds", Label: "Poll duration", Type: "number", Scope: SettingScopeSegment, Dependencies: []SettingCondition{{Key: "poll_options", Operator: "present"}}},
		{Key: "poll_multiple", Label: "Allow multiple choices", Type: "boolean", Scope: SettingScopeSegment, Dependencies: []SettingCondition{{Key: "poll_options", Operator: "present"}}},
		{Key: "poll_hide_totals", Label: "Hide totals until the poll ends", Type: "boolean", Scope: SettingScopeSegment, Dependencies: []SettingCondition{{Key: "poll_options", Operator: "present"}}},
		{Key: "quote_url", Label: "Quote post", Type: "url", Control: "quote_url", Capability: "quote_policy", UnavailableReason: "The connected instance has not advertised a compatible quote-post API."},
		{Key: "interaction_policy", Label: "Who can interact", Type: "select", Capability: "interaction_policy", UnavailableReason: "The connected instance has not advertised interaction policies."},
		{Key: "focal_point", Label: "Focal point", Type: "text", Control: "focal_point", Scope: SettingScopeMediaItem},
	}
}

func blueskySettings() []SettingField {
	return []SettingField{
		{Key: "link_url", Label: "Link card URL", Type: "url"},
		{Key: "link_title", Label: "Link card title", Type: "text"},
		{Key: "link_description", Label: "Link card description", Type: "textarea"},
		{Key: "quote_url", Label: "Quote post", Type: "url", Control: "quote_url"},
		{Key: "languages", Label: "Languages", Type: "tags", Control: "language"},
		{Key: "self_labels", Label: "Content labels", Type: "tags", Control: "chips", Options: []string{"porn", "sexual", "nudity", "graphic-media"}},
		{Key: "reply_gate", Label: "Who can reply", Type: "select", Options: []string{"everyone", "mentioned", "following", "followers", "nobody"}},
		{Key: "thread_gate", Label: "Thread replies", Type: "select", Scope: SettingScopeSegment, Options: []string{"inherit", "everyone", "mentioned", "following", "followers", "nobody"}},
	}
}

func linkedinSettings() []SettingField {
	return []SettingField{
		{Key: "visibility", Label: "Visibility", Type: "select", Options: []string{"PUBLIC", "CONNECTIONS"}},
		{Key: "reshare_disabled", Label: "Disable reshares", Type: "boolean"},
		{Key: "poll_options", Label: "Poll", Type: "textarea", Control: "poll", Scope: SettingScopeSegment, MediaShapes: []string{MediaShapeText}, Constraints: SettingConstraint{MinItems: 2, MaxItems: 4, MaxLength: 30}, Capability: "polls"},
		{Key: "poll_duration", Label: "Poll duration", Type: "select", Scope: SettingScopeSegment, Options: []string{"ONE_DAY", "THREE_DAYS", "ONE_WEEK", "TWO_WEEKS"}, Dependencies: []SettingCondition{{Key: "poll_options", Operator: "present"}}},
		{Key: "article_title", Label: "Article title", Type: "text"},
		{Key: "article_description", Label: "Article description", Type: "textarea"},
		{Key: "thumbnail_media_id", Label: "Video thumbnail", Type: "media", Control: "media_picker", MediaShapes: []string{MediaShapeVideo}, UnavailableReason: "LinkedIn does not expose thumbnail upload for this publishing flow."},
		{Key: "caption_media_id", Label: "Caption file", Type: "media", Control: "captions_file", MediaShapes: []string{MediaShapeVideo}, UnavailableReason: "LinkedIn does not expose caption upload for this publishing flow."},
		{Key: "first_comment", Label: "First comment", Type: "textarea", Control: "follow_up", Scope: SettingScopeSegment},
	}
}

func facebookSettings() []SettingField {
	return []SettingField{
		{Key: "url", Label: "URL", Type: "url"},
		{Key: "text_format_preset_id", Label: "Text background", Type: "select", Control: "remote_picker", OptionsSource: "facebook_text_presets", MediaShapes: []string{MediaShapeText}, UnavailableReason: "The connected Page has not returned text background presets."},
		{Key: "video_title", Label: "Video title", Type: "text", MediaShapes: []string{MediaShapeVideo}},
		{Key: "video_description", Label: "Video description", Type: "textarea", MediaShapes: []string{MediaShapeVideo}},
		{Key: "thumbnail_media_id", Label: "Thumbnail", Type: "media", Control: "media_picker", MediaShapes: []string{MediaShapeVideo}, UnavailableReason: "Facebook does not accept a thumbnail URL for this video publishing flow."},
		{Key: "first_comment", Label: "First comment", Type: "textarea", Control: "follow_up", Scope: SettingScopeSegment},
		{Key: "share_to_feed", Label: "Share Reel to feed", Type: "boolean", Intents: []string{IntentShortVideo}},
	}
}

func instagramSettings() []SettingField {
	return []SettingField{
		{Key: "is_trial_reel", Label: "Trial Reel", Type: "boolean", Intents: []string{IntentShortVideo}},
		{Key: "graduation_strategy", Label: "Trial graduation", Type: "select", Required: true, Intents: []string{IntentShortVideo}, Options: []string{"MANUAL", "SS_PERFORMANCE"}, Dependencies: []SettingCondition{{Key: "is_trial_reel", Operator: "equals", Value: true}}},
		{Key: "collaborators", Label: "Collaborators", Type: "tags", Control: "user_picker"},
		{Key: "location_id", Label: "Location", Type: "select", Control: "remote_picker", OptionsSource: "instagram_locations"},
		{Key: "user_tags", Label: "Tag people", Type: "json", Control: "media_tags", Scope: SettingScopeMediaItem, MediaShapes: []string{MediaShapeSingleImage, MediaShapeMultipleImage}, Constraints: SettingConstraint{MaxItems: 20}},
		{Key: "product_tags", Label: "Tag products", Type: "json", Control: "media_tags", Scope: SettingScopeMediaItem, MediaShapes: []string{MediaShapeSingleImage, MediaShapeMultipleImage}, Constraints: SettingConstraint{MaxItems: 5}, Capability: "product_tags", UnavailableReason: "Product tags require an eligible Instagram Shopping account."},
		{Key: "cover_media_id", Label: "Cover image", Type: "media", Control: "media_picker", Intents: []string{IntentShortVideo}},
		{Key: "thumbnail_timestamp_ms", Label: "Cover frame", Type: "number", Control: "cover_frame", Intents: []string{IntentShortVideo}},
		{Key: "share_to_feed", Label: "Share Reel to feed", Type: "boolean", Intents: []string{IntentShortVideo}},
	}
}

func threadsSettings() []SettingField {
	return []SettingField{
		{Key: "poll_options", Label: "Poll", Type: "textarea", Control: "poll", Scope: SettingScopeSegment, MediaShapes: []string{MediaShapeText}, Constraints: SettingConstraint{MinItems: 2, MaxItems: 4, MinLength: 1, MaxLength: 25}, Conflicts: []SettingCondition{{Key: "url", Operator: "present"}}},
		{Key: "text_attachment_plaintext", Label: "Text attachment", Type: "textarea", Control: "long_text", MediaShapes: []string{MediaShapeText}, Constraints: SettingConstraint{MaxLength: 10000}, Conflicts: []SettingCondition{{Key: "poll_options", Operator: "present"}, {Key: "url", Operator: "present"}, {Key: "gif_id", Operator: "present"}}, Help: "Add up to 10,000 characters as a long-form text attachment."},
		{Key: "text_attachment_link_url", Label: "Text attachment link", Type: "url", Control: "quote_url", MediaShapes: []string{MediaShapeText}, Dependencies: []SettingCondition{{Key: "text_attachment_plaintext", Operator: "present"}}, Conflicts: []SettingCondition{{Key: "url", Operator: "present"}}},
		{Key: "gif_id", Label: "GIF", Type: "select", Control: "gif_picker", MediaShapes: []string{MediaShapeText}, Conflicts: []SettingCondition{{Key: "poll_options", Operator: "present"}, {Key: "url", Operator: "present"}, {Key: "text_attachment_plaintext", Operator: "present"}}, Capability: "gif_search", UnavailableReason: "GIF attachments require a configured GIPHY search provider."},
		{Key: "reply_control", Label: "Who can reply", Type: "select", Options: []string{"everyone", "accounts_you_follow", "mentioned_only", "parent_post_author_only", "followers_only"}},
		{Key: "topic_tag", Label: "Topic", Type: "text"},
		{Key: "location_id", Label: "Location", Type: "select", Control: "remote_picker", OptionsSource: "threads_locations"},
		{Key: "spoiler", Label: "Mark media as a spoiler", Type: "boolean", MediaShapes: []string{MediaShapeSingleImage, MediaShapeMultipleImage, MediaShapeVideo, MediaShapeMixedMedia}},
		{Key: "ghost_post", Label: "Ghost post", Type: "boolean", Capability: "ghost_posts", UnavailableReason: "Ghost posts are not available for this connected account."},
		{Key: "reply_approvals", Label: "Require reply approval", Type: "boolean", Capability: "reply_approvals", UnavailableReason: "Reply approvals are not available for this connected account."},
	}
}

func youtubeSettings() []SettingField {
	return []SettingField{
		{Key: "privacy", Label: "Privacy", Type: "select", Required: true, Options: []string{"public", "unlisted", "private"}},
		{Key: "title", Label: "Title", Type: "text", Required: true, Constraints: SettingConstraint{MaxLength: 100}},
		{Key: "description", Label: "Description", Type: "textarea"},
		{Key: "tags", Label: "Tags", Type: "tags", Help: "Add terms that help people find the video."},
		{Key: "category_id", Label: "Category", Type: "select", Control: "remote_picker", Required: true, OptionsSource: "youtube_categories"},
		{Key: "playlist_id", Label: "Playlist", Type: "select", Control: "remote_picker", OptionsSource: "youtube_playlists"},
		{Key: "thumbnail_media_id", Label: "Thumbnail", Type: "media", Control: "media_picker"},
		{Key: "caption_media_id", Label: "Caption file", Type: "media", Control: "captions_file"},
		{Key: "caption_language", Label: "Caption language", Type: "text", Control: "language", Dependencies: []SettingCondition{{Key: "caption_media_id", Operator: "present"}}},
		{Key: "license", Label: "License", Type: "select", Default: "youtube", Options: []string{"youtube", "creativeCommon"}},
		{Key: "embeddable", Label: "Allow embedding", Type: "boolean", Default: true},
		{Key: "self_declared_made_for_kids", Label: "Made for kids", Type: "boolean"},
		{Key: "contains_synthetic_media", Label: "Synthetic media", Type: "boolean"},
		{Key: "paid_placement", Label: "Contains paid promotion", Type: "boolean"},
		{Key: "notify_subscribers", Label: "Notify subscribers", Type: "boolean"},
	}
}

func tiktokSettings() []SettingField {
	directPost := []SettingCondition{{Key: "content_posting_method", Operator: "equals", Value: "DIRECT_POST"}}
	return []SettingField{
		{Key: "content_posting_method", Label: "Posting method", Type: "select", Required: true, Default: "DIRECT_POST", Options: []string{"DIRECT_POST", "UPLOAD"}},
		{Key: "privacy_level", Label: "Privacy", Type: "select", Control: "remote_picker", Required: true, RequiredPolicy: "when_available", OptionsSource: "tiktok_privacy_levels", Help: "Choose from the options returned for this TikTok creator.", Dependencies: directPost},
		{Key: "duet", Label: "Allow Duet", Type: "boolean", MediaShapes: []string{MediaShapeVideo}, Dependencies: directPost},
		{Key: "stitch", Label: "Allow Stitch", Type: "boolean", MediaShapes: []string{MediaShapeVideo}, Dependencies: directPost},
		{Key: "comment", Label: "Allow comments", Type: "boolean", Dependencies: directPost},
		{Key: "photo_title", Label: "Photo post title", Type: "text", MediaShapes: []string{MediaShapeSingleImage, MediaShapeMultipleImage}, Constraints: SettingConstraint{MaxLength: 90}},
		{Key: "cover_index", Label: "Cover image", Type: "number", Control: "cover_index", MediaShapes: []string{MediaShapeSingleImage, MediaShapeMultipleImage}},
		{Key: "auto_add_music", Label: "Auto-add music", Type: "boolean", MediaShapes: []string{MediaShapeSingleImage, MediaShapeMultipleImage}, Dependencies: directPost},
		{Key: "brand_content_toggle", Label: "Branded content", Type: "boolean", Dependencies: directPost},
		{Key: "brand_organic_toggle", Label: "Brand organic", Type: "boolean", Dependencies: directPost},
		{Key: "music_usage_confirmed", Label: "I confirm I can use this music", Type: "boolean", Required: true, Dependencies: directPost},
		{Key: "is_aigc", Label: "AI-generated content", Type: "boolean", MediaShapes: []string{MediaShapeVideo}, Dependencies: directPost},
		{Key: "cover_timestamp_ms", Label: "Cover frame", Type: "number", Control: "cover_frame", MediaShapes: []string{MediaShapeVideo}, Dependencies: directPost},
	}
}

func float64Pointer(value float64) *float64 {
	return &value
}
