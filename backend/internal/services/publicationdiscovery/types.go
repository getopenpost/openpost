// Package publicationdiscovery finds current, web-sourced content opportunities.
// It does not draft, persist, schedule, or publish social posts.
package publicationdiscovery

import (
	"context"
	"errors"
	"time"

	"github.com/openpost/backend/internal/services/voiceprofiles"
)

var (
	ErrInvalidInput  = errors.New("invalid publication discovery input")
	ErrInvalidOutput = errors.New("invalid publication discovery output")
	ErrUnavailable   = errors.New("publication discovery is unavailable")
)

// Discoverer is the narrow capability used by the HTTP layer.
type Discoverer interface {
	Discover(context.Context, Input) (Result, error)
}

// VoiceContext is an authorized snapshot supplied by the caller. It excludes
// profile and account IDs so entity authority never crosses this AI seam.
type VoiceContext struct {
	Name       string                   `json:"name" maxLength:"80" doc:"Display name for the selected writing identity"`
	Definition voiceprofiles.Definition `json:"definition" doc:"Identity, expertise, views, and representative writing"`
}

// RecentPublicationSummary is novelty context, not evidence for current facts.
// It excludes Publication IDs because Discover only needs to avoid repetition.
type RecentPublicationSummary struct {
	PublishedAt time.Time `json:"published_at" doc:"When this recent Publication was published or created"`
	Summary     string    `json:"summary" maxLength:"800" doc:"Short factual summary of what the Publication said"`
	Platforms   []string  `json:"platforms,omitempty" maxItems:"5" uniqueItems:"true" doc:"Platforms that received the Publication"`
	Topics      []string  `json:"topics,omitempty" maxItems:"12" uniqueItems:"true" doc:"Topics already covered"`
}

type Input struct {
	Focus              string                     `json:"focus,omitempty" maxLength:"1000" doc:"Optional subject, project, niche, or current objective"`
	Audience           string                     `json:"audience,omitempty" maxLength:"500" doc:"People the opportunities should matter to"`
	Voice              VoiceContext               `json:"voice" doc:"Authorized Voice Profile context without entity IDs"`
	Platforms          []string                   `json:"platforms" minItems:"1" maxItems:"5" uniqueItems:"true" doc:"Selected native destination platforms"`
	RecentPublications []RecentPublicationSummary `json:"recent_publications,omitempty" maxItems:"30" doc:"Recent work used only to avoid repetition"`
	Limit              int                        `json:"limit,omitempty" minimum:"1" maximum:"8" default:"6" doc:"Maximum opportunity cards to return"`
}

type Angle struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Thesis   string `json:"thesis"`
	Approach string `json:"approach"`
}

type SourceCitation struct {
	Title       string `json:"title"`
	URL         string `json:"url"`
	Publisher   string `json:"publisher"`
	PublishedAt string `json:"published_at"`
	Supports    string `json:"supports"`
	Primary     bool   `json:"primary"`
}

type PlatformTreatment struct {
	Platform  string `json:"platform"`
	Objective string `json:"objective"`
	Format    string `json:"format"`
	Rationale string `json:"rationale"`
	Media     string `json:"media"`
}

// Opportunity contains planning material only. Hook is a short preview, not a
// publishable post. Selecting an angle supplies context to the normal Builder.
type Opportunity struct {
	ID                 string              `json:"id"`
	Title              string              `json:"title"`
	WhyItFits          string              `json:"why_it_fits"`
	WhyNow             string              `json:"why_now"`
	SignalDate         string              `json:"signal_date"`
	Hook               string              `json:"hook"`
	Angles             []Angle             `json:"angles"`
	Sources            []SourceCitation    `json:"-"`
	PlatformTreatments []PlatformTreatment `json:"platform_treatments"`
}

type DiscoveryResult struct {
	GeneratedAt   time.Time     `json:"generated_at"`
	Model         string        `json:"model"`
	Opportunities []Opportunity `json:"opportunities"`
}

// Result keeps the service interface compact while DiscoveryResult provides a
// unique shared OpenAPI schema name.
type Result = DiscoveryResult
