// Package voiceprofiles owns reusable writing identities and their Workspace
// inheritance rules. Platform-specific writing behavior belongs to the content
// builder, not to a Voice Profile.
package voiceprofiles

import (
	"errors"
	"time"
)

const DefinitionSchemaVersion = 1

var (
	ErrUnavailable      = errors.New("voice profiles are unavailable")
	ErrInvalidInput     = errors.New("invalid voice profile input")
	ErrNotFound         = errors.New("voice profile not found")
	ErrConflict         = errors.New("voice profile conflicts with existing state")
	ErrRevisionConflict = errors.New("voice profile revision changed")
	ErrDefaultRequired  = errors.New("workspace default voice profile is required")
)

// Definition contains identity facts only. It deliberately excludes platform
// rules so one profile can represent the same person or brand on every network.
type Definition struct {
	IdentitySummary      string            `json:"identity_summary,omitempty" doc:"Short description of the person or brand behind the voice"`
	PreferredLanguage    string            `json:"preferred_language,omitempty" doc:"Language or locale this voice normally writes in"`
	Traits               []string          `json:"traits,omitempty" doc:"Stable voice traits"`
	Vocabulary           []string          `json:"vocabulary,omitempty" doc:"Words the voice naturally uses"`
	RecurringExpressions []string          `json:"recurring_expressions,omitempty" doc:"Expressions that sound natural in this voice"`
	Expertise            []string          `json:"expertise,omitempty" doc:"Subjects the voice can discuss from experience"`
	Opinions             []string          `json:"opinions,omitempty" doc:"Established views the builder may draw on"`
	Humor                string            `json:"humor,omitempty" doc:"Humor style and limits"`
	Formality            string            `json:"formality,omitempty" doc:"Formality style and limits"`
	Boundaries           []string          `json:"boundaries,omitempty" doc:"Tone or identity boundaries"`
	ForbiddenPhrases     []string          `json:"forbidden_phrases,omitempty" doc:"Phrases this voice must not use"`
	DislikedPatterns     []string          `json:"disliked_patterns,omitempty" doc:"Writing patterns this voice avoids"`
	Examples             []Example         `json:"examples,omitempty" doc:"Representative writing examples"`
	Corrections          []Correction      `json:"corrections,omitempty" doc:"Accepted edits that explain how the voice should change a draft"`
	InterviewAnswers     []InterviewAnswer `json:"interview_answers,omitempty" doc:"Optional answers used to learn opinions and phrasing"`
}

type Example struct {
	Text      string `json:"text" doc:"Representative text"`
	Platform  string `json:"platform,omitempty" doc:"Optional source platform, used as provenance rather than a style rule"`
	WhyItFits string `json:"why_it_fits,omitempty" doc:"Why this example represents the voice"`
}

type Correction struct {
	Original  string `json:"original" doc:"Generated or draft wording that did not fit"`
	Preferred string `json:"preferred" doc:"Accepted replacement wording"`
	Lesson    string `json:"lesson,omitempty" doc:"Optional general lesson from the edit"`
}

type InterviewAnswer struct {
	Question string `json:"question" doc:"Interview question"`
	Answer   string `json:"answer" doc:"Answer in the profile owner's own words"`
}

type VoiceProfile struct {
	ID                 string     `json:"id"`
	WorkspaceID        string     `json:"workspace_id"`
	Name               string     `json:"name"`
	IsDefault          bool       `json:"is_default"`
	Revision           int        `json:"revision"`
	SchemaVersion      int        `json:"schema_version"`
	Definition         Definition `json:"definition"`
	AssignedAccountIDs []string   `json:"assigned_account_ids"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

// Profile keeps the service API compact while the named contract type stays
// unique in the shared OpenAPI registry.
type Profile = VoiceProfile

type CreateInput struct {
	WorkspaceID string
	CreatedByID string
	Name        string
	IsDefault   bool
	Definition  Definition
}

type UpdateInput struct {
	WorkspaceID      string
	Name             string
	Definition       Definition
	ExpectedRevision int
}

type DeleteInput struct {
	WorkspaceID      string
	ExpectedRevision int
}

type SetDefaultInput struct {
	WorkspaceID      string
	ExpectedRevision int
}

type AssignmentInput struct {
	WorkspaceID    string
	AccountID      string
	VoiceProfileID string
}

type ResolutionSource string

const (
	ResolutionPublicationOverride ResolutionSource = "publication_override"
	ResolutionAccountOverride     ResolutionSource = "account_override"
	ResolutionWorkspaceDefault    ResolutionSource = "workspace_default"
)

type EffectiveProfile struct {
	AccountID string           `json:"account_id"`
	Source    ResolutionSource `json:"source"`
	Profile   Profile          `json:"profile"`
}

type ResolveInput struct {
	WorkspaceID               string
	AccountIDs                []string
	PublicationVoiceProfileID string
}

// DefaultSeed is used inside Workspace-creation transactions. Existing
// Workspaces are handled by the schema migration backfill.
type DefaultSeed struct {
	WorkspaceID string
	CreatedByID string
	Name        string
	Now         time.Time
}
