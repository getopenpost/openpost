package postgeneration

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/capabilities"
)

const shortenSystemPrompt = `You tighten social post copy so it fits a character limit.
Keep the author's meaning, voice, language, line breaks, @mentions, #hashtags and URLs exactly as written.
Prefer small edits: remove filler words, use shorter synonyms, merge clauses. Never add new ideas, emoji or hashtags.
Only when small edits cannot reach the limit, drop the least important detail.
Never use em dashes or en dashes. Return only data that matches the supplied JSON Schema.`

type ShortenInput struct {
	Text          string
	Platform      string
	MaxCharacters int
}

type ShortenResult struct {
	Text string `json:"text"`
	// Truncated reports that the model could not fit the limit and the text was cut.
	Truncated bool   `json:"truncated"`
	Model     string `json:"model"`
}

type shortenPrompt struct {
	Text          string `json:"text"`
	Platform      string `json:"platform"`
	MaxCharacters int    `json:"max_characters"`
	CurrentLength int    `json:"current_length"`
	Previous      string `json:"previous_attempt,omitempty"`
}

func (s *Service) Shorten(ctx context.Context, input ShortenInput) (ShortenResult, error) {
	text := strings.TrimSpace(input.Text)
	platform := strings.TrimSpace(input.Platform)
	if text == "" || len(text) > maxGeneratedLength || platform == "" || input.MaxCharacters <= 0 {
		return ShortenResult{}, ErrInvalidInput
	}
	if capabilities.TextLength(platform, text) <= input.MaxCharacters {
		return ShortenResult{Text: text, Model: s.model}, nil
	}

	candidate, model, previous := text, s.model, ""
	for attempt := 0; attempt < 2; attempt++ {
		prompt, err := json.Marshal(shortenPrompt{
			Text:          text,
			Platform:      platform,
			MaxCharacters: input.MaxCharacters,
			CurrentLength: capabilities.TextLength(platform, text),
			Previous:      previous,
		})
		if err != nil {
			return ShortenResult{}, fmt.Errorf("marshal shorten prompt: %w", err)
		}
		generationContext, cancel := context.WithTimeout(ctx, generationTimeout)
		generated, err := s.generator.Generate(generationContext, ai.GenerateRequest{
			Model:           s.model,
			SystemPrompt:    shortenSystemPrompt,
			UserPrompt:      string(prompt),
			ResponseSchema:  shortenResponseSchema(),
			MaxOutputTokens: maxOutputTokens,
			ReasoningEffort: ai.ReasoningEffortLow,
		})
		cancel()
		if err != nil {
			return ShortenResult{}, err
		}
		var parsed struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(strings.TrimSpace(generated.Text)), &parsed); err != nil {
			return ShortenResult{}, ErrInvalidResponse
		}
		candidate = normalizeWritingPunctuation(parsed.Text)
		if candidate == "" || len(candidate) > maxGeneratedLength {
			return ShortenResult{}, ErrInvalidResponse
		}
		if m := strings.TrimSpace(generated.Model); m != "" {
			model = m
		}
		if capabilities.TextLength(platform, candidate) <= input.MaxCharacters {
			return ShortenResult{Text: candidate, Model: model}, nil
		}
		previous = candidate
	}
	cut := fitTextToLimit(platform, candidate, input.MaxCharacters)
	if cut == "" {
		return ShortenResult{}, ErrInvalidResponse
	}
	return ShortenResult{Text: cut, Truncated: true, Model: model}, nil
}

func shortenResponseSchema() *ai.JSONSchema {
	return &ai.JSONSchema{
		Name:        "openpost_post_shorten",
		Description: "The shortened post text",
		Schema: map[string]any{
			"type":                 "object",
			"additionalProperties": false,
			"required":             []string{"text"},
			"properties": map[string]any{
				"text": map[string]any{"type": "string", "minLength": 1, "maxLength": maxGeneratedLength},
			},
		},
	}
}
