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

type GenerateRequest struct {
	Model           string
	SystemPrompt    string
	UserPrompt      string
	Images          []Image
	MaxOutputTokens int64
	ReasoningEffort ReasoningEffort
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
