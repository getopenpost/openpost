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
	MaxCandidateTemplates = 32

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
	MaxCaptionRoleCharacters  = 80

	MaxCaptionLineCharacters = 200
	MaxRationaleCharacters   = 300
	MaxAltTextCharacters     = 500

	maxResponseCharacters = 20_000
	maxOutputTokens       = 1200
	defaultRequestTimeout = 30 * time.Second
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

// Template is provider-neutral metadata for one renderable template. The
// optional Semantics field supports a small set of hand-reviewed overrides for
// ambiguous or high-use templates without duplicating a whole provider catalog.
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
	Meaning      string
	CaptionRoles []string
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

	generated, err := s.generator.Generate(requestCtx, ai.GenerateRequest{
		Model:           s.model,
		SystemPrompt:    systemPrompt,
		UserPrompt:      userPrompt,
		MaxOutputTokens: maxOutputTokens,
		ReasoningEffort: ai.ReasoningEffortLow,
	})
	if err != nil {
		return Result{}, err
	}

	candidates, err := parseAndValidateResponse(generated.Text, normalized)
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
