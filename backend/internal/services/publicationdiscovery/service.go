package publicationdiscovery

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/openpost/backend/internal/ai"
)

const (
	defaultTimeout      = 90 * time.Second
	defaultResultLimit  = 6
	maxOutputTokens     = 10_000
	webSearchMaxResults = 8
	webSearchMaxUses    = 3
)

type Config struct {
	Model   string
	Timeout time.Duration
}

type Service struct {
	generator ai.Generator
	model     string
	timeout   time.Duration
	now       func() time.Time
}

func New(generator ai.Generator, config Config) (*Service, error) {
	if generator == nil {
		return nil, fmt.Errorf("%w: AI generator is required", ErrUnavailable)
	}
	model := strings.TrimSpace(config.Model)
	if model == "" {
		return nil, fmt.Errorf("%w: AI model is required", ErrUnavailable)
	}
	timeout := config.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	return &Service{
		generator: generator,
		model:     model,
		timeout:   timeout,
		now:       func() time.Time { return time.Now().UTC() },
	}, nil
}

func (service *Service) Discover(ctx context.Context, input Input) (Result, error) {
	if service == nil || service.generator == nil || service.now == nil {
		return Result{}, ErrUnavailable
	}
	now := service.now().UTC()
	normalized, err := validateAndNormalizeInput(input, now)
	if err != nil {
		return Result{}, err
	}
	prompt, err := discoveryPrompt(normalized, now)
	if err != nil {
		return Result{}, fmt.Errorf("%w: could not encode discovery context", ErrInvalidInput)
	}

	requestCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()
	generated, err := service.generator.Generate(requestCtx, ai.GenerateRequest{
		Model:           service.model,
		SystemPrompt:    discoverySystemPrompt,
		UserPrompt:      prompt,
		MaxOutputTokens: maxOutputTokens,
		ReasoningEffort: ai.ReasoningEffortMedium,
		WebSearch: ai.WebSearchConfig{
			Enabled:    true,
			MaxResults: webSearchMaxResults,
			MaxUses:    webSearchMaxUses,
			Context:    ai.WebSearchContextLow,
		},
	})
	if err != nil {
		return Result{}, fmt.Errorf("discover publication opportunities: %w", err)
	}

	var output generatedResult
	if err := decodeStrictOutput(generated.Text, &output); err != nil {
		return Result{}, fmt.Errorf("%w: structured response was rejected", ErrInvalidOutput)
	}
	opportunities, err := validateAndNormalizeOutput(output, normalized, now)
	if err != nil {
		return Result{}, err
	}
	model := strings.TrimSpace(generated.Model)
	if model == "" {
		model = service.model
	}
	return Result{GeneratedAt: now, Model: model, Opportunities: opportunities}, nil
}

var _ Discoverer = (*Service)(nil)
