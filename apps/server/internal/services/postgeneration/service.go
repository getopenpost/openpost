package postgeneration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/services/aiprompts"
	"github.com/rivo/uniseg"
)

const (
	maxIdeaLength       = 4000
	maxDestinationCount = 12
	maxGeneratedLength  = 12000
	maxOutputTokens     = 6000
	generationTimeout   = 30 * time.Second
)

var (
	ErrInvalidInput    = errors.New("invalid post generation input")
	ErrInvalidResponse = errors.New("invalid post generation response")
)

type Builder interface {
	Build(context.Context, Input) (Result, error)
}

type Destination struct {
	AccountID string
	Platform  string
	Profile   string
}

type Input struct {
	Idea         string
	Destinations []Destination
}

type Rendition struct {
	AccountID string `json:"social_account_id"`
	Body      string `json:"body"`
}

type Result struct {
	SourceText string      `json:"source_text"`
	Renditions []Rendition `json:"renditions"`
	Model      string      `json:"model"`
}

type Service struct {
	generator ai.Generator
	model     string
	prompts   aiprompts.Resolver
}

type promptDestination struct {
	Target        string `json:"target"`
	Platform      string `json:"platform"`
	Profile       string `json:"profile,omitempty"`
	MaxCharacters int    `json:"max_characters,omitempty"`
}

type normalizedTarget struct {
	AccountID     string
	Platform      string
	MaxCharacters int
}

type generationPrompt struct {
	Idea         string              `json:"idea"`
	Destinations []promptDestination `json:"destinations"`
}

type generationResponse struct {
	SourceText string `json:"source_text"`
	Renditions []struct {
		Target string `json:"target"`
		Body   string `json:"body"`
	} `json:"renditions"`
}

func New(generator ai.Generator, model string, prompts aiprompts.Resolver) (*Service, error) {
	if generator == nil || strings.TrimSpace(model) == "" {
		return nil, ErrInvalidInput
	}
	if prompts == nil {
		prompts = aiprompts.BuiltinResolver{}
	}
	return &Service{generator: generator, model: strings.TrimSpace(model), prompts: prompts}, nil
}

func (s *Service) Build(ctx context.Context, input Input) (Result, error) {
	prompt, targets, err := normalizeInput(input)
	if err != nil {
		return Result{}, err
	}
	promptJSON, err := json.Marshal(prompt)
	if err != nil {
		return Result{}, fmt.Errorf("marshal post generation prompt: %w", err)
	}
	platforms := uniquePlatforms(prompt.Destinations)
	instructions, err := s.prompts.ResolvePostGeneration(ctx, platforms)
	if err != nil {
		return Result{}, fmt.Errorf("resolve post generation prompts: %w", err)
	}

	generationContext, cancel := context.WithTimeout(ctx, generationTimeout)
	defer cancel()
	generated, err := s.generator.Generate(generationContext, ai.GenerateRequest{
		Model:           s.model,
		SystemPrompt:    composeSystemPrompt(instructions, platforms),
		UserPrompt:      string(promptJSON),
		ResponseSchema:  postGenerationResponseSchema(prompt.Destinations),
		MaxOutputTokens: maxOutputTokens,
		ReasoningEffort: ai.ReasoningEffortLow,
	})
	if err != nil {
		return Result{}, err
	}

	return resultFromGeneration(generated, targets, s.model)
}

func uniquePlatforms(destinations []promptDestination) []string {
	platforms := make([]string, 0, len(destinations))
	seen := make(map[string]struct{}, len(destinations))
	for _, destination := range destinations {
		if _, exists := seen[destination.Platform]; exists {
			continue
		}
		seen[destination.Platform] = struct{}{}
		platforms = append(platforms, destination.Platform)
	}
	return platforms
}

func resultFromGeneration(generated ai.GenerateResult, targets map[string]normalizedTarget, fallbackModel string) (Result, error) {
	parsed, err := parseResponse(generated.Text)
	if err != nil {
		return Result{}, err
	}
	renditions := make([]Rendition, 0, len(parsed.Renditions))
	seen := make(map[string]struct{}, len(parsed.Renditions))
	for _, rendition := range parsed.Renditions {
		target, ok := targets[rendition.Target]
		body := normalizeWritingPunctuation(rendition.Body)
		if !ok || body == "" || len(body) > maxGeneratedLength {
			return Result{}, ErrInvalidResponse
		}
		if _, duplicate := seen[rendition.Target]; duplicate {
			return Result{}, ErrInvalidResponse
		}
		seen[rendition.Target] = struct{}{}
		body = fitTextToLimit(target.Platform, body, target.MaxCharacters)
		renditions = append(renditions, Rendition{AccountID: target.AccountID, Body: body})
	}
	if len(seen) != len(targets) {
		return Result{}, ErrInvalidResponse
	}
	sourceText := normalizeWritingPunctuation(parsed.SourceText)
	if sourceText == "" || len(sourceText) > maxGeneratedLength {
		return Result{}, ErrInvalidResponse
	}
	model := strings.TrimSpace(generated.Model)
	if model == "" {
		model = fallbackModel
	}
	return Result{SourceText: sourceText, Renditions: renditions, Model: model}, nil
}

func composeSystemPrompt(instructions aiprompts.PostGenerationInstructions, platforms []string) string {
	var sections []string
	if base := strings.TrimSpace(instructions.Base); base != "" {
		sections = append(sections, base)
	}
	var platformSections []string
	for _, platform := range platforms {
		instruction := strings.TrimSpace(instructions.Platforms[platform])
		if instruction == "" {
			continue
		}
		platformSections = append(platformSections, fmt.Sprintf("[%s]\n%s", platform, instruction))
	}
	if len(platformSections) > 0 {
		sections = append(sections, "Platform instructions:\n"+strings.Join(platformSections, "\n\n"))
	}
	sections = append(sections, aiprompts.FixedPostGenerationOutputPrompt)
	return strings.Join(sections, "\n\n")
}

func postGenerationResponseSchema(destinations []promptDestination) *ai.JSONSchema {
	targets := make([]string, 0, len(destinations))
	for _, destination := range destinations {
		targets = append(targets, destination.Target)
	}
	return &ai.JSONSchema{
		Name:        "openpost_post_generation",
		Description: "Canonical source copy and one rendition for every requested social destination",
		Schema: map[string]any{
			"type":                 "object",
			"additionalProperties": false,
			"required":             []string{"source_text", "renditions"},
			"properties": map[string]any{
				"source_text": map[string]any{"type": "string", "minLength": 1, "maxLength": maxGeneratedLength},
				"renditions": map[string]any{
					"type": "array", "minItems": len(targets), "maxItems": len(targets),
					"items": map[string]any{
						"type":                 "object",
						"additionalProperties": false,
						"required":             []string{"target", "body"},
						"properties": map[string]any{
							"target": map[string]any{"type": "string", "enum": targets},
							"body":   map[string]any{"type": "string", "minLength": 1, "maxLength": maxGeneratedLength},
						},
					},
				},
			},
		},
	}
}

func normalizeWritingPunctuation(text string) string {
	replacer := strings.NewReplacer(
		" — ", ", ",
		"— ", ", ",
		" —", ", ",
		"—", ", ",
		" – ", ", ",
		"– ", ", ",
		" –", ", ",
		"–", ", ",
	)
	return strings.TrimSpace(replacer.Replace(text))
}

func normalizeInput(input Input) (generationPrompt, map[string]normalizedTarget, error) {
	idea := strings.TrimSpace(input.Idea)
	if idea == "" || len(idea) > maxIdeaLength || len(input.Destinations) == 0 || len(input.Destinations) > maxDestinationCount {
		return generationPrompt{}, nil, ErrInvalidInput
	}
	prompt := generationPrompt{Idea: idea, Destinations: make([]promptDestination, 0, len(input.Destinations))}
	targets := make(map[string]normalizedTarget, len(input.Destinations))
	accountIDs := make(map[string]struct{}, len(input.Destinations))
	for index, destination := range input.Destinations {
		accountID := strings.TrimSpace(destination.AccountID)
		platform := strings.TrimSpace(destination.Platform)
		if accountID == "" || platform == "" {
			return generationPrompt{}, nil, ErrInvalidInput
		}
		if _, duplicate := accountIDs[accountID]; duplicate {
			return generationPrompt{}, nil, ErrInvalidInput
		}
		accountIDs[accountID] = struct{}{}
		target := fmt.Sprintf("target_%d", index+1)
		maxCharacters, _ := capabilities.ProviderTextLimit(platform)
		targets[target] = normalizedTarget{AccountID: accountID, Platform: platform, MaxCharacters: maxCharacters}
		prompt.Destinations = append(prompt.Destinations, promptDestination{Target: target, Platform: platform, Profile: strings.TrimSpace(destination.Profile), MaxCharacters: maxCharacters})
	}
	return prompt, targets, nil
}

func fitTextToLimit(platform, text string, limit int) string {
	text = strings.TrimSpace(text)
	if limit <= 0 || capabilities.TextLength(platform, text) <= limit {
		return text
	}

	boundaries := []int{0}
	graphemes := uniseg.NewGraphemes(text)
	for graphemes.Next() {
		_, end := graphemes.Positions()
		boundaries = append(boundaries, end)
	}

	left, right, best := 1, len(boundaries)-1, 0
	for left <= right {
		middle := left + (right-left)/2
		candidate := strings.TrimSpace(text[:boundaries[middle]])
		if capabilities.TextLength(platform, candidate) <= limit {
			best = middle
			left = middle + 1
			continue
		}
		right = middle - 1
	}
	if best == 0 {
		return ""
	}

	candidate := strings.TrimSpace(text[:boundaries[best]])
	if best < len(boundaries)-1 && !endsAtWordBoundary(candidate, text[boundaries[best]:]) {
		if boundary := strings.LastIndexFunc(candidate, unicode.IsSpace); boundary > 0 {
			candidate = strings.TrimSpace(candidate[:boundary])
		}
	}
	return candidate
}

func endsAtWordBoundary(candidate, remainder string) bool {
	if candidate == "" || remainder == "" {
		return true
	}
	last, _ := utf8.DecodeLastRuneInString(candidate)
	first, _ := utf8.DecodeRuneInString(remainder)
	return unicode.IsSpace(last) || unicode.IsSpace(first)
}

func parseResponse(raw string) (generationResponse, error) {
	text := strings.TrimSpace(raw)
	if strings.HasPrefix(text, "```") {
		text = strings.TrimPrefix(text, "```json")
		text = strings.TrimPrefix(text, "```")
		text = strings.TrimSuffix(strings.TrimSpace(text), "```")
	}
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.DisallowUnknownFields()
	var response generationResponse
	if err := decoder.Decode(&response); err != nil {
		return generationResponse{}, ErrInvalidResponse
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return generationResponse{}, ErrInvalidResponse
	}
	return response, nil
}
