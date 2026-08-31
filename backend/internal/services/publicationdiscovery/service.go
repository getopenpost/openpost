package publicationdiscovery

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/services/sourcecontext"
)

const (
	defaultTimeout      = 90 * time.Second
	defaultResultLimit  = 6
	maxOutputTokens     = 10_000
	webSearchMaxResults = 8
	webSearchMaxUses    = 3
)

type Config struct {
	Model        string
	Timeout      time.Duration
	SourceLoader sourcecontext.Loader
}

type Service struct {
	generator ai.Generator
	model     string
	timeout   time.Duration
	now       func() time.Time
	sources   sourcecontext.Loader
}

func New(generator ai.Generator, config Config) (*Service, error) {
	if generator == nil {
		return nil, fmt.Errorf("%w: AI generator is required", ErrUnavailable)
	}
	model := strings.TrimSpace(config.Model)
	if model == "" {
		return nil, fmt.Errorf("%w: AI model is required", ErrUnavailable)
	}
	if config.SourceLoader == nil {
		return nil, fmt.Errorf("%w: citation source loader is required", ErrUnavailable)
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
		sources:   config.SourceLoader,
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
		ResponseSchema:  discoveryResponseSchema(normalized),
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
	if err := service.loadCitationSources(requestCtx, opportunities); err != nil {
		return Result{}, err
	}
	model := strings.TrimSpace(generated.Model)
	if model == "" {
		model = service.model
	}
	return Result{GeneratedAt: now, Model: model, Opportunities: opportunities}, nil
}

func (service *Service) loadCitationSources(ctx context.Context, opportunities []Opportunity) error {
	documents := make(map[string]sourcecontext.Document)
	for opportunityIndex := range opportunities {
		for sourceIndex := range opportunities[opportunityIndex].Sources {
			source := &opportunities[opportunityIndex].Sources[sourceIndex]
			document, ok := documents[source.URL]
			if !ok {
				loaded, err := service.sources.Load(ctx, source.URL)
				if err != nil {
					if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
						return context.DeadlineExceeded
					}
					if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
						return context.Canceled
					}
					return fmt.Errorf("%w: cited source %d could not be loaded", ErrInvalidOutput, sourceIndex+1)
				}
				document = loaded
				documents[source.URL] = document
			}
			if title, titleErr := requiredText(document.Title, maxSourceTitle); titleErr == nil {
				source.Title = title
			}
		}
	}
	return nil
}

var _ Discoverer = (*Service)(nil)
