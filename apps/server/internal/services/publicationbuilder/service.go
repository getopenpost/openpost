package publicationbuilder

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/openpost/backend/internal/ai"
)

const defaultTimeout = 90 * time.Second

type Config struct {
	Model   string
	Timeout time.Duration
}

type Service struct {
	generator ai.Generator
	model     string
	timeout   time.Duration
}

func New(generator ai.Generator, config Config) (*Service, error) {
	if generator == nil {
		return nil, errors.New("publication builder AI generator is required")
	}
	model := strings.TrimSpace(config.Model)
	if model == "" {
		return nil, errors.New("publication builder AI model is required")
	}
	timeout := config.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	return &Service{generator: generator, model: model, timeout: timeout}, nil
}

func (service *Service) Build(ctx context.Context, input BuildInput) (BuildResult, error) {
	return service.BuildWithProgress(ctx, input, nil)
}

func (service *Service) BuildWithProgress(
	ctx context.Context,
	input BuildInput,
	report func(string) error,
) (BuildResult, error) {
	if err := validateBuildInput(input); err != nil {
		return BuildResult{}, err
	}
	if input.DestinationPolicy == "" {
		input.DestinationPolicy = DestinationPolicyRecommend
	}
	supported, skipped := partitionDestinations(input.Destinations)
	if len(supported) == 0 {
		return BuildResult{}, errors.New("none of the selected destinations can be adapted")
	}
	requestCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	if err := reportBuildProgress(report, BuildPhaseDirecting); err != nil {
		return BuildResult{}, err
	}
	director, err := service.direct(requestCtx, input, supported)
	if err != nil {
		return BuildResult{}, err
	}
	if err := reportBuildProgress(report, BuildPhaseDrafting); err != nil {
		return BuildResult{}, err
	}
	destinationPlans, decisionSkips, err := service.draftDestinations(requestCtx, input, director, supported)
	if err != nil {
		return BuildResult{}, err
	}
	skipped = append(skipped, decisionSkips...)
	if err := reportBuildProgress(report, BuildPhaseReviewing); err != nil {
		return BuildResult{}, err
	}
	flags, replacements, approved, err := service.review(requestCtx, input, director, destinationPlans)
	if err != nil {
		return BuildResult{}, err
	}
	if !approved {
		if len(replacements) == 0 {
			return BuildResult{}, errors.New("publication review rejected the generated package")
		}
		if err := applyReviewReplacements(destinationPlans, replacements, supported, sourceReferenceCatalogFor(input)); err != nil {
			return BuildResult{}, err
		}
		secondFlags, _, secondApproved, err := service.review(requestCtx, input, director, destinationPlans)
		if err != nil {
			return BuildResult{}, err
		}
		flags = append(flags, secondFlags...)
		if !secondApproved {
			return BuildResult{}, errors.New("publication review rejected the repaired package")
		}
	}

	return BuildResult{
		CanonicalText: director.CanonicalText,
		Direction:     director,
		Destinations:  destinationPlans,
		Skipped:       skipped,
		ReviewFlags:   flags,
	}, nil
}

func reportBuildProgress(report func(string) error, phase string) error {
	if report == nil {
		return nil
	}
	if err := report(phase); err != nil {
		return fmt.Errorf("record publication build phase %s: %w", phase, err)
	}
	return nil
}

func (service *Service) direct(ctx context.Context, input BuildInput, supported []Destination) (DirectorPlan, error) {
	prompt, err := directorPrompt(input, supported)
	if err != nil {
		return DirectorPlan{}, err
	}
	generated, err := service.generator.Generate(ctx, ai.GenerateRequest{
		Model: service.model, SystemPrompt: directorSystemPrompt, UserPrompt: prompt,
		Parts: input.Parts, Images: input.Images, Files: input.Files, Audio: input.Audio, Videos: input.Videos,
		ResponseSchema: directorResponseSchema(len(supported)), MaxOutputTokens: 4_000,
		ReasoningEffort: ai.ReasoningEffortMedium,
	})
	if err != nil {
		return DirectorPlan{}, fmt.Errorf("generate publication direction: %w", err)
	}
	service.recordGeneration(ctx, "director", "", generated)
	var plan DirectorPlan
	if err := decodeStrictJSON(generated.Text, &plan); err != nil {
		return DirectorPlan{}, fmt.Errorf("validate publication direction: %w", err)
	}
	if err := validateDirector(plan, supported, sourceReferenceCatalogFor(input), input.Direction, input.DestinationPolicy); err != nil {
		return DirectorPlan{}, fmt.Errorf("validate publication direction: %w", err)
	}
	return plan, nil
}

func (service *Service) draftDestinations(
	ctx context.Context,
	input BuildInput,
	director DirectorPlan,
	supported []Destination,
) ([]DestinationPlan, []SkippedDestination, error) {
	decisions := make(map[string]DestinationDecision, len(director.Destinations))
	for _, decision := range director.Destinations {
		decisions[decision.AccountID] = decision
	}
	included := make([]Destination, 0, len(supported))
	skipped := make([]SkippedDestination, 0)
	for _, destination := range supported {
		decision := decisions[destination.AccountID]
		if !decision.Include {
			skipped = append(skipped, SkippedDestination{AccountID: destination.AccountID, Platform: destination.Platform, Reason: decision.Reason})
			continue
		}
		included = append(included, destination)
	}

	type generatedPlan struct {
		index int
		plan  DestinationPlan
		err   error
	}
	results := make(chan generatedPlan, len(included))
	var wait sync.WaitGroup
	for index, destination := range included {
		index, destination := index, destination
		wait.Add(1)
		go func() {
			defer wait.Done()
			policy, _ := policyFor(destination.Platform)
			prompt, err := adapterPrompt(input, director, destination)
			if err != nil {
				results <- generatedPlan{index: index, err: err}
				return
			}
			generated, err := service.generator.Generate(ctx, ai.GenerateRequest{
				Model: service.model, SystemPrompt: adapterSystemPrompt(policy), UserPrompt: prompt,
				ResponseSchema:  adapterResponseSchema(destination, policy),
				MaxOutputTokens: 3_000, ReasoningEffort: ai.ReasoningEffortLow,
			})
			if err != nil {
				results <- generatedPlan{index: index, err: fmt.Errorf("generate %s rendition: %w", destination.Platform, err)}
				return
			}
			service.recordGeneration(ctx, "adapter", destination.AccountID, generated)
			var plan DestinationPlan
			if err := decodeStrictJSON(generated.Text, &plan); err != nil {
				results <- generatedPlan{index: index, err: fmt.Errorf("validate %s rendition: %w", destination.Platform, err)}
				return
			}
			plan.Platform = destination.Platform
			if !policy.Native {
				plan.Warnings = append([]string{"Basic adaptation: OpenPost does not yet have a native creative model for this platform."}, plan.Warnings...)
			}
			if err := validateDestinationPlan(plan, destination, policy, sourceReferenceCatalogFor(input)); err != nil {
				results <- generatedPlan{index: index, err: fmt.Errorf("validate %s rendition: %w", destination.Platform, err)}
				return
			}
			results <- generatedPlan{index: index, plan: plan}
		}()
	}
	go func() {
		wait.Wait()
		close(results)
	}()

	plans := make([]DestinationPlan, len(included))
	for result := range results {
		if result.err != nil {
			return nil, nil, result.err
		}
		plans[result.index] = result.plan
	}
	return plans, skipped, nil
}

type reviewReplacement struct {
	AccountID string        `json:"account_id"`
	Preview   string        `json:"preview,omitempty"`
	Segments  []SegmentPlan `json:"segments"`
}

type reviewResult struct {
	Approved     bool                `json:"approved"`
	Flags        []ReviewFlag        `json:"flags"`
	Replacements []reviewReplacement `json:"replacements"`
}

func (service *Service) review(
	ctx context.Context,
	input BuildInput,
	director DirectorPlan,
	destinations []DestinationPlan,
) ([]ReviewFlag, []reviewReplacement, bool, error) {
	prompt, err := reviewerPrompt(input, director, destinations)
	if err != nil {
		return nil, nil, false, err
	}
	generated, err := service.generator.Generate(ctx, ai.GenerateRequest{
		Model: service.model, SystemPrompt: reviewerSystemPrompt, UserPrompt: prompt,
		ResponseSchema: reviewerResponseSchema(), MaxOutputTokens: 2_000, ReasoningEffort: ai.ReasoningEffortMedium,
	})
	if err != nil {
		return nil, nil, false, fmt.Errorf("review publication package: %w", err)
	}
	service.recordGeneration(ctx, "reviewer", "", generated)
	var result reviewResult
	if err := decodeStrictJSON(generated.Text, &result); err != nil {
		return nil, nil, false, fmt.Errorf("validate publication review: %w", err)
	}
	if result.Approved && len(result.Replacements) > 0 {
		return nil, nil, false, errors.New("validate publication review: approved review cannot include replacements")
	}
	return result.Flags, result.Replacements, result.Approved, nil
}

func (service *Service) recordGeneration(ctx context.Context, stage, accountID string, generated ai.GenerateResult) {
	if strings.TrimSpace(generated.Model) == "" {
		generated.Model = service.model
	}
	recordGeneration(ctx, stage, accountID, generated)
}

func applyReviewReplacements(
	plans []DestinationPlan,
	replacements []reviewReplacement,
	destinations []Destination,
	sources sourceReferenceCatalog,
) error {
	byAccount := make(map[string]int, len(plans))
	destinationByAccount := make(map[string]Destination, len(destinations))
	for index, plan := range plans {
		byAccount[plan.AccountID] = index
	}
	for _, destination := range destinations {
		destinationByAccount[destination.AccountID] = destination
	}
	seen := map[string]struct{}{}
	for _, replacement := range replacements {
		index, ok := byAccount[replacement.AccountID]
		if !ok {
			return fmt.Errorf("review replacement selected unknown account %q", replacement.AccountID)
		}
		if _, duplicate := seen[replacement.AccountID]; duplicate {
			return fmt.Errorf("review replacement repeated account %q", replacement.AccountID)
		}
		seen[replacement.AccountID] = struct{}{}
		plans[index].Segments = replacement.Segments
		if replacement.Preview != "" {
			plans[index].Preview = replacement.Preview
		}
		destination := destinationByAccount[replacement.AccountID]
		policy, _ := policyFor(destination.Platform)
		if err := validateDestinationPlan(plans[index], destination, policy, sources); err != nil {
			return fmt.Errorf("validate review replacement: %w", err)
		}
	}
	return nil
}

func partitionDestinations(destinations []Destination) ([]Destination, []SkippedDestination) {
	supported := make([]Destination, 0, len(destinations))
	skipped := make([]SkippedDestination, 0)
	for _, destination := range destinations {
		if _, ok := policyFor(destination.Platform); ok {
			supported = append(supported, destination)
			continue
		}
		skipped = append(skipped, SkippedDestination{
			AccountID: destination.AccountID,
			Platform:  destination.Platform,
			Reason:    "OpenPost does not have a native builder adapter for this platform yet.",
		})
	}
	return supported, skipped
}

type sourceReference struct {
	kind        string
	mimeType    string
	publishable bool
}

type sourceReferenceCatalog map[string]sourceReference

func sourceReferenceCatalogFor(input BuildInput) sourceReferenceCatalog {
	result := make(sourceReferenceCatalog, len(input.Sources)+1)
	if strings.TrimSpace(input.Idea) != "" {
		result["idea"] = sourceReference{kind: "text"}
	}
	for _, source := range input.Sources {
		result[source.ID] = sourceReference{
			kind:        strings.ToLower(strings.TrimSpace(source.Kind)),
			mimeType:    strings.ToLower(strings.TrimSpace(source.MIMEType)),
			publishable: source.Publishable,
		}
	}
	return result
}
