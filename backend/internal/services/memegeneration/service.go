// Package memegeneration turns a user idea and a bounded template shortlist
// into validated, renderer-ready meme suggestions. It deliberately does not
// fetch templates, render images, persist recipes, or expose an HTTP contract.
package memegeneration

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/openpost/backend/internal/ai"
)

const (
	DefaultModel = "openai/gpt-5.6-luna"

	DefaultCandidateCount = 3
	MaxCandidateCount     = 4
	MaxCandidateTemplates = 16

	MaxIdeaCharacters         = 1000
	MaxToneCharacters         = 100
	MaxTemplateIDCharacters   = 80
	MaxTemplateNameCharacters = 120
	MaxTemplateLines          = 10
	MaxTemplateOverlays       = 10
	MaxTemplateKeywords       = 12
	MaxKeywordCharacters      = 60
	MaxExampleLineCharacters  = 240
	MaxSemanticCharacters     = 300
	MaxVisualCharacters       = 180
	MaxMechanismCharacters    = 60
	MaxCaptionRoleCharacters  = 80
	MaxSemanticTags           = 6
	MaxSemanticTagCharacters  = 40

	MaxCaptionLineCharacters = 200
	MaxRationaleCharacters   = 300
	MaxAltTextCharacters     = 500

	maxResponseCharacters  = 20_000
	maxOutputTokens        = 1200
	defaultRequestTimeout  = 55 * time.Second
	memeResponseSchemaName = "meme_suggestions"
)

var (
	ErrInvalidInput    = errors.New("invalid meme generation input")
	ErrInvalidResponse = errors.New("invalid meme generation response")
)

// Suggester is the provider-neutral capability consumed by an API or job
// layer. Its inputs contain no provider URLs, credentials, or workspace data.
type Suggester interface {
	Suggest(context.Context, Input) (Result, error)
}

// Input contains the minimum user data needed to write a meme. Templates must
// already be ranked or filtered by the caller; the service will not send an
// entire remote catalog to an AI provider.
type Input struct {
	Idea           string
	Tone           string
	Language       string
	CandidateCount int
	Templates      []Template
}

// Template is provider-neutral metadata for one renderable template. Semantics
// tell the model what the image means and what each rendered field controls.
type Template struct {
	ID           string
	Name         string
	LineCount    int
	OverlayCount int
	Keywords     []string
	ExampleLines []string
	Semantics    SemanticHint
}

// SemanticHint describes a template's joke mechanism and caption order. When
// omitted, the service derives conservative slot-order guidance from LineCount.
type SemanticHint struct {
	Visual       string
	Meaning      string
	Mechanism    string
	CaptionRoles []string
	Tags         []string
}

type Candidate struct {
	TemplateID   string   `json:"template_id"`
	CaptionLines []string `json:"caption_lines"`
	Rationale    string   `json:"rationale"`
	AltText      string   `json:"alt_text"`
}

type Result struct {
	Candidates []Candidate
	Model      string
	RequestID  string
	Usage      ai.Usage
}

type Service struct {
	generator ai.Generator
	model     string
	timeout   time.Duration
}

func New(generator ai.Generator, model string) (*Service, error) {
	if generator == nil {
		return nil, fmt.Errorf("%w: generator is required", ErrInvalidInput)
	}
	model = strings.TrimSpace(model)
	if model == "" {
		return nil, fmt.Errorf("%w: model is required", ErrInvalidInput)
	}
	return &Service{
		generator: generator,
		model:     model,
		timeout:   defaultRequestTimeout,
	}, nil
}

func (s *Service) Suggest(ctx context.Context, input Input) (Result, error) {
	if s == nil || s.generator == nil {
		return Result{}, fmt.Errorf("%w: generator is unavailable", ErrInvalidInput)
	}

	normalized, err := normalizeInput(input)
	if err != nil {
		return Result{}, err
	}
	userPrompt, err := buildUserPrompt(normalized)
	if err != nil {
		return Result{}, fmt.Errorf("%w: prompt could not be prepared", ErrInvalidInput)
	}

	requestCtx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	request := ai.GenerateRequest{
		Model:           s.model,
		SystemPrompt:    systemPrompt,
		UserPrompt:      userPrompt,
		ResponseSchema:  memeResponseSchema(normalized),
		MaxOutputTokens: maxOutputTokens,
		ReasoningEffort: ai.ReasoningEffortLow,
	}
	generated, err := s.generator.Generate(requestCtx, request)
	if err != nil {
		return Result{}, err
	}

	candidates, err := parseAndValidateResponse(generated.Text, normalized)
	if errors.Is(err, ErrInvalidResponse) && requestCtx.Err() == nil {
		firstUsage := generated.Usage
		retryRequest := request
		retryRequest.UserPrompt += "\n\nCorrection: the previous response did not satisfy the required candidate count, allowed template IDs, exact per-template caption line counts, or bounded text fields. Return a fresh response that exactly matches the schema."
		generated, err = s.generator.Generate(requestCtx, retryRequest)
		if err != nil {
			return Result{}, err
		}
		generated.Usage = combinedUsage(firstUsage, generated.Usage)
		candidates, err = parseAndValidateResponse(generated.Text, normalized)
	}
	if err != nil {
		return Result{}, err
	}

	model := strings.TrimSpace(generated.Model)
	if model == "" {
		model = s.model
	}
	return Result{
		Candidates: candidates,
		Model:      model,
		RequestID:  generated.RequestID,
		Usage:      generated.Usage,
	}, nil
}

func memeResponseSchema(input normalizedInput) *ai.JSONSchema {
	candidateSchemas := make([]any, 0, len(input.Templates))
	for _, template := range input.Templates {
		candidateSchemas = append(candidateSchemas, memeCandidateSchema(template))
	}
	candidateItems := map[string]any{"anyOf": candidateSchemas}
	return &ai.JSONSchema{
		Name:        memeResponseSchemaName,
		Description: "Validated meme suggestions using only the supplied template IDs.",
		Schema: map[string]any{
			"type":                 "object",
			"additionalProperties": false,
			"required":             []string{"candidates"},
			"properties": map[string]any{
				"candidates": map[string]any{
					"anyOf": []any{
						map[string]any{"type": "array", "minItems": 0, "maxItems": 0, "items": candidateItems},
						map[string]any{
							"type": "array", "minItems": input.CandidateCount, "maxItems": input.CandidateCount,
							"items": candidateItems,
						},
					},
				},
			},
		},
	}
}

func memeCandidateSchema(template Template) map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"template_id", "caption_lines", "rationale", "alt_text"},
		"properties": map[string]any{
			"template_id": map[string]any{"type": "string", "enum": []string{template.ID}},
			"caption_lines": map[string]any{
				"type": "array", "minItems": template.LineCount, "maxItems": template.LineCount,
				"items": map[string]any{"type": "string", "minLength": 1, "maxLength": MaxCaptionLineCharacters},
			},
			"rationale": map[string]any{"type": "string", "minLength": 1, "maxLength": MaxRationaleCharacters},
			"alt_text":  map[string]any{"type": "string", "minLength": 1, "maxLength": MaxAltTextCharacters},
		},
	}
}

func combinedUsage(first, second ai.Usage) ai.Usage {
	result := ai.Usage{
		InputTokens:  first.InputTokens + second.InputTokens,
		OutputTokens: first.OutputTokens + second.OutputTokens,
		TotalTokens:  first.TotalTokens + second.TotalTokens,
	}
	if first.CostUSD != nil || second.CostUSD != nil {
		cost := 0.0
		if first.CostUSD != nil {
			cost += *first.CostUSD
		}
		if second.CostUSD != nil {
			cost += *second.CostUSD
		}
		result.CostUSD = &cost
	}
	return result
}
