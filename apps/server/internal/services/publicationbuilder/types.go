package publicationbuilder

import "github.com/openpost/backend/internal/ai"

type DestinationPolicy string

const (
	DestinationPolicyRecommend  DestinationPolicy = "recommend"
	DestinationPolicyRequireAll DestinationPolicy = "require_all"

	MaxDirectionOutcomeCharacters         = 200
	MaxDirectionAudienceCharacters        = 1_000
	MaxDirectionAngleCharacters           = 1_500
	MaxDirectionToneCharacters            = 500
	MaxDirectionMediaPreferenceCharacters = 500
	MaxContextNotesCharacters             = 10_000
)

type DirectionInput struct {
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
	Treatment string `json:"treatment"`
	Role      string `json:"role"`
	Brief     string `json:"brief"`
	SourceRef string `json:"source_ref,omitempty" doc:"Exact source ID for source-bound media treatments"`
}

// ResolvedSource names one source that the finished package may reference.
// It deliberately excludes extracted text and media bytes.
type ResolvedSource struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Label       string `json:"label"`
	Publishable bool   `json:"publishable"`
}

type DestinationDecision struct {
	AccountID string `json:"account_id"`
	Include   bool   `json:"include"`
	Reason    string `json:"reason"`
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
	CanonicalText string               `json:"canonical_text"`
	Sources       []ResolvedSource     `json:"sources,omitempty"`
	Direction     DirectorPlan         `json:"direction"`
	Destinations  []DestinationPlan    `json:"destinations"`
	Skipped       []SkippedDestination `json:"skipped"`
	ReviewFlags   []ReviewFlag         `json:"review_flags"`
}
