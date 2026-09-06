package publicationdiscovery

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/services/sourcecontext"
)

const (
	defaultTimeout           = 3 * time.Minute
	defaultResultLimit       = 6
	maxOutputTokens          = 10_000
	webSearchMaxResults      = 8
	webSearchMaxUses         = 1
	webSearchMaxTotalResults = webSearchMaxResults * webSearchMaxUses
	webSearchMaxCharacters   = 1_200
	maxCitationLoads         = 4
	citationTimeout          = 30 * time.Second
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

type citationLoad struct {
	url         string
	sourceIndex int
	document    sourcecontext.Document
}

type citationFailure struct {
	err         error
	sourceIndex int
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
			Enabled:                true,
			MaxResults:             webSearchMaxResults,
			MaxUses:                webSearchMaxUses,
			MaxTotalResults:        webSearchMaxTotalResults,
			MaxCharactersPerResult: webSearchMaxCharacters,
			Context:                ai.WebSearchContextLow,
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
	loads := uniqueCitationLoads(opportunities)
	loadContext, cancel := context.WithTimeout(ctx, citationTimeout)
	defer cancel()
	if err := service.loadCitationDocuments(ctx, loadContext, cancel, loads); err != nil {
		return err
	}
	applyCitationTitles(opportunities, loads)
	return nil
}

func uniqueCitationLoads(opportunities []Opportunity) []citationLoad {
	loads := make([]citationLoad, 0)
	loadByURL := make(map[string]struct{})
	for opportunityIndex := range opportunities {
		for sourceIndex := range opportunities[opportunityIndex].Sources {
			url := opportunities[opportunityIndex].Sources[sourceIndex].URL
			if _, exists := loadByURL[url]; exists {
				continue
			}
			loadByURL[url] = struct{}{}
			loads = append(loads, citationLoad{url: url, sourceIndex: sourceIndex})
		}
	}
	return loads
}

func (service *Service) loadCitationDocuments(
	ctx context.Context,
	loadContext context.Context,
	cancel context.CancelFunc,
	loads []citationLoad,
) error {
	jobs := make(chan int)
	var workers sync.WaitGroup
	var failureLock sync.Mutex
	var failure *citationFailure
	for range min(maxCitationLoads, len(loads)) {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range jobs {
				document, err := service.sources.Load(loadContext, loads[index].url)
				loads[index].document = document
				if err == nil {
					continue
				}
				failureLock.Lock()
				if failure == nil {
					failure = &citationFailure{err: err, sourceIndex: loads[index].sourceIndex}
					cancel()
				}
				failureLock.Unlock()
			}
		}()
	}
	for index := range loads {
		jobs <- index
	}
	close(jobs)
	workers.Wait()

	if failure == nil {
		return nil
	}
	return citationFailureError(ctx, loadContext, *failure)
}

func applyCitationTitles(opportunities []Opportunity, loads []citationLoad) {
	documents := make(map[string]sourcecontext.Document, len(loads))
	for _, load := range loads {
		documents[load.url] = load.document
	}
	for opportunityIndex := range opportunities {
		for sourceIndex := range opportunities[opportunityIndex].Sources {
			source := &opportunities[opportunityIndex].Sources[sourceIndex]
			if title, titleErr := requiredText(documents[source.URL].Title, maxSourceTitle); titleErr == nil {
				source.Title = title
			}
		}
	}
}

func citationFailureError(ctx, loadContext context.Context, failure citationFailure) error {
	if errors.Is(failure.err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(loadContext.Err(), context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	if errors.Is(failure.err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
		return context.Canceled
	}
	return fmt.Errorf("%w: cited source %d could not be loaded", ErrInvalidOutput, failure.sourceIndex+1)
}

var _ Discoverer = (*Service)(nil)
