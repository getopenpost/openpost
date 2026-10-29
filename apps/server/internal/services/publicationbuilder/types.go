package publicationbuilder

import (
	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/screenshottemplates"
)

type DestinationPolicy string

const (
	DestinationPolicyRecommend  DestinationPolicy = "recommend"
	DestinationPolicyRequireAll DestinationPolicy = "require_all"

	MaxDirectionOutcomeCharacters         = 200
	MaxDirectionInstructionsCharacters    = 10_000
	MaxDirectionAudienceCharacters        = 1_000
	MaxDirectionAngleCharacters           = 1_500
	MaxDirectionToneCharacters            = 500
	MaxDirectionMediaPreferenceCharacters = 500
	MaxContextNotesCharacters             = 10_000
)

type DirectionInput struct {
	Instructions    string `json:"instructions,omitempty" maxLength:"10000" doc:"Author's writing requirements, kept separate from source evidence and the short outcome"`
	Outcome         string `json:"outcome,omitempty" maxLength:"200"`
	Audience        string `json:"audience,omitempty" maxLength:"1000"`
	Angle           string `json:"angle,omitempty" maxLength:"1500"`
	ToneAdjustment  string `json:"tone_adjustment,omitempty" maxLength:"500"`
	MediaPreference string `json:"media_preference,omitempty" maxLength:"500"`
}

type VoiceDefinition struct {
	Identity   string         `json:"identity,omitempty"`
	Guidance   string         `json:"guidance,omitempty"`
	Language   string         `json:"language,omitempty"`
	Avoidances []string       `json:"avoidances,omitempty"`
	Examples   []VoiceExample `json:"examples,omitempty"`
}

type VoiceExample struct {
	Platform string `json:"platform,omitempty"`
	Body     string `json:"body"`
}

type VoiceSnapshot struct {
	ID         string          `json:"id,omitempty"`
	Name       string          `json:"name,omitempty"`
	Revision   int             `json:"revision,omitempty"`
	Definition VoiceDefinition `json:"definition"`
}

type SourceMaterial struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Label       string `json:"label"`
	MIMEType    string `json:"mime_type,omitempty"`
	Text        string `json:"text,omitempty"`
	Publishable bool   `json:"publishable,omitempty" doc:"Whether the user allowed this source asset to appear in the post"`
}

type OutputProfile struct {
	Key           string   `json:"key"`
	TextLimit     int      `json:"text_limit"`
	MaxSegments   int      `json:"max_segments"`
	MediaMinCount int      `json:"media_min_count,omitempty"`
	MediaMaxCount int      `json:"media_max_count"`
	AllowedMIMEs  []string `json:"allowed_mimes,omitempty"`
}

type Destination struct {
	AccountID             string          `json:"account_id"`
	Platform              string          `json:"platform"`
	Label                 string          `json:"label"`
	AllowedOutputProfiles []OutputProfile `json:"allowed_output_profiles"`
	Voice                 VoiceSnapshot   `json:"voice"`
}

type BuildInput struct {
	SeriesCount       int                 `json:"series_count,omitempty" minimum:"0" maximum:"3"`
	OptionCount       int                 `json:"option_count,omitempty" enum:"0,4" doc:"Generate four complete alternatives; zero keeps the single-package workflow"`
	Idea              string              `json:"idea"`
	Sources           []SourceMaterial    `json:"sources,omitempty"`
	Parts             []ai.MultimodalPart `json:"-"`
	Images            []ai.Image          `json:"-"`
	Files             []ai.File           `json:"-"`
	Audio             []ai.Audio          `json:"-"`
	Videos            []ai.Video          `json:"-"`
	Destinations      []Destination       `json:"destinations"`
	Direction         DirectionInput      `json:"direction"`
	DestinationPolicy DestinationPolicy   `json:"destination_policy"`
}

type Claim struct {
	Text       string   `json:"text"`
	Status     string   `json:"status"`
	SourceRefs []string `json:"source_refs,omitempty"`
}

type MediaPlan struct {
	Treatment  string                                          `json:"treatment"`
	Role       string                                          `json:"role"`
	Brief      string                                          `json:"brief"`
	SourceRef  string                                          `json:"source_ref,omitempty" doc:"Exact source ID for source-bound media treatments"`
	TemplateID string                                          `json:"template_id,omitempty"`
	Document   *screenshottemplates.ScreenshotTemplateDocument `json:"document,omitempty" doc:"Validated editable visual recipe, awaiting rendering and upload"`
	AltText    string                                          `json:"alt_text,omitempty"`
}

// ResolvedSource names one source that the finished package may reference.
// It deliberately excludes extracted text and media bytes.
type ResolvedSource struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Label       string `json:"label"`
	MIMEType    string `json:"mime_type,omitempty"`
	Publishable bool   `json:"publishable"`
}

type DestinationDecision struct {
	Media     *MediaPlan `json:"media,omitempty" doc:"Optional destination-specific visual choice for a creative alternative"`
	AccountID string     `json:"account_id"`
	Include   bool       `json:"include"`
	Reason    string     `json:"reason"`
}

type DirectorPlan struct {
	CanonicalText string                `json:"canonical_text"`
	FactualKernel []string              `json:"factual_kernel"`
	Thesis        string                `json:"thesis"`
	Outcome       string                `json:"outcome"`
	Audience      string                `json:"audience"`
	Angle         string                `json:"angle"`
	Route         string                `json:"route"`
	Claims        []Claim               `json:"claims"`
	Media         MediaPlan             `json:"media"`
	Destinations  []DestinationDecision `json:"destinations"`
}

type SegmentPlan struct {
	Body        string `json:"body"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
}

type DestinationPlan struct {
	AccountID     string        `json:"account_id"`
	Platform      string        `json:"platform"`
	Objective     string        `json:"objective"`
	Archetype     string        `json:"archetype"`
	OutputProfile string        `json:"output_profile"`
	Preview       string        `json:"preview"`
	Segments      []SegmentPlan `json:"segments"`
	Media         MediaPlan     `json:"media"`
	Claims        []Claim       `json:"claims"`
	Warnings      []string      `json:"warnings"`
	FollowUpNotes []string      `json:"follow_up_notes"`
}

type SkippedDestination struct {
	AccountID string `json:"account_id"`
	Platform  string `json:"platform"`
	Reason    string `json:"reason"`
}

type ReviewFlag struct {
	AccountID string `json:"account_id,omitempty"`
	Field     string `json:"field"`
	Severity  string `json:"severity"`
	Message   string `json:"message"`
}

type BuildResult struct {
	Series           []SeriesConcept      `json:"series,omitempty"`
	SelectedOptionID string               `json:"selected_option_id,omitempty"`
	Options          []PostOption         `json:"options,omitempty" doc:"Four complete alternatives. Choosing one is an explicit author action"`
	CanonicalText    string               `json:"canonical_text"`
	Sources          []ResolvedSource     `json:"sources,omitempty"`
	Direction        DirectorPlan         `json:"direction"`
	Destinations     []DestinationPlan    `json:"destinations"`
	Skipped          []SkippedDestination `json:"skipped"`
	ReviewFlags      []ReviewFlag         `json:"review_flags"`
}

type PostOption struct {
	ID            string               `json:"id"`
	Label         string               `json:"label"`
	CanonicalText string               `json:"canonical_text"`
	Direction     DirectorPlan         `json:"direction"`
	Destinations  []DestinationPlan    `json:"destinations"`
	Skipped       []SkippedDestination `json:"skipped"`
	ReviewFlags   []ReviewFlag         `json:"review_flags"`
}

func (option PostOption) Result() BuildResult {
	return BuildResult{CanonicalText: option.CanonicalText, Direction: option.Direction, Destinations: option.Destinations, Skipped: option.Skipped, ReviewFlags: option.ReviewFlags}
}
