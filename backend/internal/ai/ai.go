package ai

import (
	"context"
	"errors"
	"fmt"
)

// Generator is the provider-neutral boundary for model generation.
type Generator interface {
	Generate(context.Context, GenerateRequest) (GenerateResult, error)
}

type ReasoningEffort string

const (
	ReasoningEffortNone    ReasoningEffort = "none"
	ReasoningEffortMinimal ReasoningEffort = "minimal"
	ReasoningEffortLow     ReasoningEffort = "low"
	ReasoningEffortMedium  ReasoningEffort = "medium"
	ReasoningEffortHigh    ReasoningEffort = "high"
)

type ImageDetail string

const (
	ImageDetailAuto     ImageDetail = "auto"
	ImageDetailLow      ImageDetail = "low"
	ImageDetailHigh     ImageDetail = "high"
	ImageDetailOriginal ImageDetail = "original"
)

// Image contains image bytes and the metadata needed to build a multimodal
// request. Adapters must not retain the bytes after Generate returns.
type Image struct {
	Data     []byte
	MIMEType string
	Detail   ImageDetail
}

// File contains document bytes and the metadata needed to build a multimodal
// request. Callers must apply feature-specific byte limits before Generate.
// Adapters must not retain the bytes after Generate returns.
type File struct {
	Data     []byte
	MIMEType string
	Filename string
}

// Audio contains source audio for a multimodal request. The adapter validates
// the declared format before it sends any bytes.
type Audio struct {
	Data     []byte
	MIMEType string
}

// Video contains source video for a multimodal request. Callers must apply
// feature-specific byte and duration limits before Generate.
type Video struct {
	Data     []byte
	MIMEType string
}

// MultimodalPart binds one exact source identifier to one media payload.
// Parts preserve caller order across media types. Adapters send the identifier
// as bounded metadata next to its payload, never as instructions.
type MultimodalPart struct {
	SourceID string
	Image    *Image
	File     *File
	Audio    *Audio
	Video    *Video
}

type WebSearchContext string

const (
	WebSearchContextLow    WebSearchContext = "low"
	WebSearchContextMedium WebSearchContext = "medium"
	WebSearchContextHigh   WebSearchContext = "high"
)

// WebSearchConfig enables current web search for one request. The provider
// adapter keeps this bounded so feature code cannot start an unbounded crawl.
type WebSearchConfig struct {
	Enabled    bool
	MaxResults int
	MaxUses    int
	Context    WebSearchContext
}

type GenerateRequest struct {
	Model           string
	SystemPrompt    string
	UserPrompt      string
	ResponseSchema  *JSONSchema
	Parts           []MultimodalPart
	Images          []Image
	Files           []File
	Audio           []Audio
	Videos          []Video
	WebSearch       WebSearchConfig
	MaxOutputTokens int64
	ReasoningEffort ReasoningEffort
}

// JSONSchema asks a generator adapter to constrain its response to one strict,
// machine-owned shape. Human-editable prompt text must not define this shape.
type JSONSchema struct {
	Name        string
	Description string
	Schema      map[string]any
}

type Usage struct {
	InputTokens  int64
	OutputTokens int64
	TotalTokens  int64
	CostUSD      *float64
}

type GenerateResult struct {
	Text      string
	Model     string
	RequestID string
	Usage     Usage
}

var ErrEmptyResponse = errors.New("AI generation returned an empty response")

// ProviderError exposes only operationally useful metadata. In particular, it
// does not retain or expose provider response bodies, prompts, media, or keys.
type ProviderError struct {
	Provider   string
	StatusCode int
}

func (e *ProviderError) Error() string {
	provider := e.Provider
	if provider == "" {
		provider = "AI"
	}
	if e.StatusCode > 0 {
		return fmt.Sprintf("%s provider request failed with status %d", provider, e.StatusCode)
	}
	return fmt.Sprintf("%s provider request failed", provider)
}
