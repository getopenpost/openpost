package publicationbuilder

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"sync"
	"testing"

	"github.com/openpost/backend/internal/ai"
	"github.com/stretchr/testify/require"
)

type generatorFunc func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error)

func (fn generatorFunc) Generate(ctx context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
	return fn(ctx, request)
}

func TestBuildCreatesIndependentNativeRenditions(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	requests := make([]ai.GenerateRequest, 0, 4)
	generator := generatorFunc(func(_ context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
		mu.Lock()
		requests = append(requests, request)
		mu.Unlock()

		switch {
		case strings.Contains(request.SystemPrompt, "ROLE: director"):
			return ai.GenerateResult{Text: `{
				"canonical_text":"We deleted 15,000 lines and the product got better.",
				"factual_kernel":["15,000 lines were deleted","the product improved"],
				"thesis":"Removing code can be a product improvement.",
				"outcome":"build_authority",
				"audience":"technical founders",
				"angle":"the deletion is the launch",
				"route":"artifact_led",
				"claims":[{"text":"15,000 lines were deleted","status":"user_asserted","source_refs":["idea"]}],
				"media":{"treatment":"use_source","role":"proof","brief":"Show the deletion diff.","source_ref":"media:diff"},
				"destinations":[
					{"account_id":"linkedin-1","include":true,"reason":"The lesson supports an evidence-led argument."},
					{"account_id":"x-1","include":true,"reason":"The exact number supports a compact artifact post."}
				]
			}`, Model: "resolved-model", RequestID: "director-request", Usage: ai.Usage{InputTokens: 10, OutputTokens: 4, TotalTokens: 14}}, nil
		case strings.Contains(request.SystemPrompt, "PLATFORM: linkedin"):
			return ai.GenerateResult{Text: `{
				"account_id":"linkedin-1",
				"objective":"authority",
				"archetype":"artifact_led",
				"output_profile":"linkedin.image",
				"preview":"I deleted 15,000 lines. The product got better.",
				"segments":[{"body":"I deleted 15,000 lines.\n\nThe product got better.\n\nThe hard part was proving which complexity no longer served users."}],
				"media":{"treatment":"use_source","role":"proof","brief":"Crop the deletion summary and keep the exact count readable.","source_ref":"media:diff"},
				"claims":[],"warnings":[],"follow_up_notes":[]
			}`, Model: "resolved-model", RequestID: "linkedin-request", Usage: ai.Usage{InputTokens: 6, OutputTokens: 3, TotalTokens: 9}}, nil
		case strings.Contains(request.SystemPrompt, "PLATFORM: x"):
			return ai.GenerateResult{Text: `{
				"account_id":"x-1",
				"objective":"shares",
				"archetype":"artifact_joke",
				"output_profile":"x.thread",
				"preview":"deleted 15,000 lines. shipped a better product.",
				"segments":[
					{"body":"deleted 15,000 lines. shipped a better product."},
					{"body":"the best refactor was admitting the abstraction had stopped earning its keep."}
				],
				"media":{"treatment":"use_source","role":"proof","brief":"Use the raw diff summary without decorative framing.","source_ref":"media:diff"},
				"claims":[],"warnings":[],"follow_up_notes":[]
			}`, Model: "resolved-model", RequestID: "x-request", Usage: ai.Usage{InputTokens: 7, OutputTokens: 3, TotalTokens: 10}}, nil
		case strings.Contains(request.SystemPrompt, "ROLE: reviewer"):
			return ai.GenerateResult{Text: `{"approved":true,"flags":[],"replacements":[]}`, Model: "resolved-model", RequestID: "review-request", Usage: ai.Usage{InputTokens: 8, OutputTokens: 2, TotalTokens: 10}}, nil
		default:
			t.Fatalf("unexpected generation role: %s", request.SystemPrompt)
			return ai.GenerateResult{}, nil
		}
	})

	service, err := New(generator, Config{Model: "test-model"})
	require.NoError(t, err)
	progress := make([]string, 0, 3)
	buildCtx, trace := withGenerationTrace(context.Background())
	result, err := service.BuildWithProgress(buildCtx, BuildInput{
		Idea: "I deleted 15,000 lines and somehow the product got better.",
		Sources: []SourceMaterial{
			{ID: "media:diff", Kind: "image", Label: "deletion.png", MIMEType: "image/png", Publishable: true},
		},
		Files: []ai.File{{Data: []byte("release notes"), MIMEType: "text/plain", Filename: "release.txt"}},
		Destinations: []Destination{
			{
				AccountID: "linkedin-1", Platform: "linkedin", Label: "Founder LinkedIn",
				AllowedOutputProfiles: []OutputProfile{{
					Key: "linkedin.image", TextLimit: 3000, MaxSegments: 1,
					MediaMaxCount: 1, AllowedMIMEs: []string{"image/jpeg", "image/png", "image/gif"},
				}},
			},
			{
				AccountID: "x-1", Platform: "x", Label: "Founder X",
				AllowedOutputProfiles: []OutputProfile{
					{Key: "x.short_text", TextLimit: 280, MaxSegments: 1},
					{
						Key: "x.thread", TextLimit: 280, MaxSegments: 10,
						MediaMaxCount: 4, AllowedMIMEs: []string{"image/jpeg", "image/png", "video/mp4"},
					},
				},
			},
		},
		DestinationPolicy: DestinationPolicyRecommend,
	}, func(phase string) error {
		progress = append(progress, phase)
		return nil
	})
	require.NoError(t, err)
	require.Equal(t, []string{BuildPhaseDirecting, BuildPhaseDrafting, BuildPhaseReviewing}, progress)
	require.Equal(t, "We deleted 15,000 lines and the product got better.", result.CanonicalText)
	require.Len(t, result.Destinations, 2)
	require.Equal(t, "linkedin.image", result.Destinations[0].OutputProfile)
	require.Len(t, result.Destinations[0].Segments, 1)
	require.Equal(t, "x.thread", result.Destinations[1].OutputProfile)
	require.Len(t, result.Destinations[1].Segments, 2)
	require.NotEqual(t, result.Destinations[0].Segments[0].Body, result.Destinations[1].Segments[0].Body)
	model, requestID, usageJSON := trace.encoded()
	require.Equal(t, "resolved-model", model)
	require.Equal(t, "director-request", requestID)
	var usage generationUsage
	require.NoError(t, json.Unmarshal([]byte(usageJSON), &usage))
	require.Len(t, usage.Calls, 4)
	require.EqualValues(t, 31, usage.InputTokens)
	require.EqualValues(t, 12, usage.OutputTokens)
	require.EqualValues(t, 43, usage.TotalTokens)

	mu.Lock()
	defer mu.Unlock()
	require.Len(t, requests, 4)
	for _, request := range requests {
		require.NotContains(t, request.SystemPrompt, "15,000")
		require.NotNil(t, request.ResponseSchema)
	}
	directorRequests := 0
	for _, request := range requests {
		if strings.Contains(request.SystemPrompt, "ROLE: director") {
			directorRequests++
			require.Len(t, request.Files, 1)
			continue
		}
		require.Empty(t, request.Files)
	}
	require.Equal(t, 1, directorRequests)
}

func TestDirectorValidationRequiresAnActionableRoute(t *testing.T) {
	t.Parallel()
	base := DirectorPlan{
		CanonicalText: "A canonical draft.", FactualKernel: []string{"A supplied fact."},
		Thesis: "The thesis.", Outcome: "authority", Audience: "founders", Angle: "show the proof",
		Route: "artifact_led", Media: MediaPlan{Treatment: "none", Role: "none", Brief: "No media."},
		Destinations: []DestinationDecision{{AccountID: "x-1", Include: true, Reason: "Strong native fit."}},
	}
	destinations := []Destination{{AccountID: "x-1", Platform: "x"}}

	for name, mutate := range map[string]func(*DirectorPlan){
		"thesis":   func(plan *DirectorPlan) { plan.Thesis = "" },
		"outcome":  func(plan *DirectorPlan) { plan.Outcome = "" },
		"audience": func(plan *DirectorPlan) { plan.Audience = "" },
		"angle":    func(plan *DirectorPlan) { plan.Angle = "" },
		"route":    func(plan *DirectorPlan) { plan.Route = "" },
	} {
		t.Run(name, func(t *testing.T) {
			plan := base
			mutate(&plan)
			require.Error(t, validateDirector(plan, destinations, sourceReferenceCatalog{}, DirectionInput{}, DestinationPolicyRecommend))
		})
	}

	invalidRoute := base
	invalidRoute.Route = "viral_magic"
	require.Error(t, validateDirector(invalidRoute, destinations, sourceReferenceCatalog{}, DirectionInput{}, DestinationPolicyRecommend))
	require.NoError(t, validateDirector(base, destinations, sourceReferenceCatalog{}, DirectionInput{}, DestinationPolicyRecommend))
}

func TestDirectorValidationEnforcesLockedDirection(t *testing.T) {
	t.Parallel()
	plan := DirectorPlan{
		CanonicalText: "A canonical draft.", FactualKernel: []string{"A supplied fact."},
		Thesis: "The thesis.", Outcome: "authority", Audience: "founders", Angle: "show the proof",
		Route: "artifact_led", Media: MediaPlan{Treatment: "none", Role: "none", Brief: "No media."},
		Destinations: []DestinationDecision{{AccountID: "x-1", Include: true, Reason: "Strong native fit."}},
	}
	destinations := []Destination{{AccountID: "x-1", Platform: "x"}}
	locked := DirectionInput{Outcome: "discussion", Audience: "technical founders", Angle: "lead with the artifact"}
	require.ErrorContains(t, validateDirector(plan, destinations, sourceReferenceCatalog{}, locked, DestinationPolicyRecommend), "locked outcome")
	plan.Outcome = locked.Outcome
	require.ErrorContains(t, validateDirector(plan, destinations, sourceReferenceCatalog{}, locked, DestinationPolicyRecommend), "locked audience")
	plan.Audience = locked.Audience
	require.ErrorContains(t, validateDirector(plan, destinations, sourceReferenceCatalog{}, locked, DestinationPolicyRecommend), "locked angle")
	plan.Angle = locked.Angle
	require.NoError(t, validateDirector(plan, destinations, sourceReferenceCatalog{}, locked, DestinationPolicyRecommend))
}

func TestSupportedClaimsRequireKnownSourceReferences(t *testing.T) {
	t.Parallel()
	known := sourceReferenceCatalog{"source:1": {kind: "text"}}
	require.Error(t, validateClaims([]Claim{{Text: "A fact.", Status: "supported"}}, known))
	require.Error(t, validateClaims([]Claim{{Text: "A fact.", Status: "supported", SourceRefs: []string{"missing"}}}, known))
	require.NoError(t, validateClaims([]Claim{{Text: "A fact.", Status: "supported", SourceRefs: []string{"source:1"}}}, known))
}

func TestSourceBoundMediaRequiresAnExactPublishableSource(t *testing.T) {
	t.Parallel()
	sources := sourceReferenceCatalog{
		"media:image":   {kind: "image", publishable: true},
		"media:video":   {kind: "video", publishable: true},
		"media:private": {kind: "image"},
	}

	require.Error(t, validateMediaPlan(MediaPlan{Treatment: "annotate_source", Role: "proof", Brief: "Mark it."}, sources))
	require.Error(t, validateMediaPlan(MediaPlan{Treatment: "annotate_source", Role: "proof", Brief: "Mark it.", SourceRef: "missing"}, sources))
	require.Error(t, validateMediaPlan(MediaPlan{Treatment: "annotate_source", Role: "proof", Brief: "Mark it.", SourceRef: "media:private"}, sources))
	require.Error(t, validateMediaPlan(MediaPlan{Treatment: "annotate_source", Role: "proof", Brief: "Mark it.", SourceRef: "media:video"}, sources))
	require.NoError(t, validateMediaPlan(MediaPlan{Treatment: "annotate_source", Role: "proof", Brief: "Mark it.", SourceRef: "media:image"}, sources))
	require.NoError(t, validateMediaPlan(MediaPlan{Treatment: "edit_existing_video", Role: "demo", Brief: "Trim it.", SourceRef: "media:video"}, sources))
	require.Error(t, validateMediaPlan(MediaPlan{Treatment: "concept_image", Role: "attention", Brief: "Create it.", SourceRef: "media:image"}, sources))
}

func TestGenerationUsageIsBoundedAndContainsNoGeneratedText(t *testing.T) {
	t.Parallel()
	ctx, trace := withGenerationTrace(context.Background())
	notANumber := math.NaN()
	for range maxGenerationCalls + 8 {
		recordGeneration(ctx, "adapter", strings.Repeat("é", maxGenerationAccount+20), ai.GenerateResult{
			Text:      "private generated post body",
			Model:     strings.Repeat("m", maxGenerationModel+20),
			RequestID: strings.Repeat("r", maxGenerationRequest+20),
			Usage: ai.Usage{
				InputTokens: -1, OutputTokens: maxGenerationTokens + 1,
				TotalTokens: maxGenerationTokens + 1, CostUSD: &notANumber,
			},
		})
	}
	_, _, usageJSON := trace.encoded()
	require.NotContains(t, usageJSON, "private generated post body")
	var usage generationUsage
	require.NoError(t, json.Unmarshal([]byte(usageJSON), &usage))
	require.Len(t, usage.Calls, maxGenerationCalls)
	require.Len(t, []rune(usage.Calls[0].AccountID), maxGenerationAccount)
	require.Len(t, []rune(usage.Calls[0].Model), maxGenerationModel)
	require.Len(t, []rune(usage.Calls[0].RequestID), maxGenerationRequest)
	require.Zero(t, usage.Calls[0].InputTokens)
	require.Equal(t, maxGenerationTokens, usage.OutputTokens)
	require.Equal(t, maxGenerationTokens, usage.TotalTokens)
	require.Zero(t, usage.CostUSD)
}

func TestReviewReplacementRetainsValidatedClaimLedger(t *testing.T) {
	t.Parallel()
	destination := Destination{
		AccountID: "x-1", Platform: "x",
		AllowedOutputProfiles: []OutputProfile{{Key: "x.short_text", TextLimit: 280, MaxSegments: 1}},
	}
	plans := []DestinationPlan{{
		AccountID: "x-1", Platform: "x", Objective: "shares", Archetype: "technical_opinion",
		OutputProfile: "x.short_text", Preview: "Original", Segments: []SegmentPlan{{Body: "Original"}},
		Media:  MediaPlan{Treatment: "none", Role: "none", Brief: "No media."},
		Claims: []Claim{{Text: "A supplied fact.", Status: "supported", SourceRefs: []string{"source:1"}}},
	}}
	err := applyReviewReplacements(
		plans,
		[]reviewReplacement{{AccountID: "x-1", Preview: "Repaired", Segments: []SegmentPlan{{Body: "Repaired"}}}},
		[]Destination{destination},
		sourceReferenceCatalog{"source:1": {kind: "text"}},
	)
	require.NoError(t, err)
	require.Equal(t, "Repaired", plans[0].Segments[0].Body)
}

func TestDestinationValidationRequiresAUsefulPreview(t *testing.T) {
	t.Parallel()
	destination := Destination{
		AccountID: "x-1", Platform: "x",
		AllowedOutputProfiles: []OutputProfile{{Key: "x.short_text", TextLimit: 280, MaxSegments: 1}},
	}
	policy, ok := policyFor("x")
	require.True(t, ok)
	plan := DestinationPlan{
		AccountID: "x-1", Platform: "x", Objective: "shares", Archetype: "technical_opinion",
		OutputProfile: "x.short_text", Segments: []SegmentPlan{{Body: "A useful native post."}},
		Media: MediaPlan{Treatment: "none", Role: "none", Brief: "No media."},
	}

	require.Error(t, validateDestinationPlan(plan, destination, policy, sourceReferenceCatalog{}))
	plan.Preview = "A useful native post."
	require.NoError(t, validateDestinationPlan(plan, destination, policy, sourceReferenceCatalog{}))
}

func TestDestinationValidationUsesFrozenTextAndSourceMediaLimits(t *testing.T) {
	t.Parallel()
	policy, ok := policyFor("x")
	require.True(t, ok)
	destination := Destination{
		AccountID: "x-1", Platform: "x",
		AllowedOutputProfiles: []OutputProfile{
			{Key: "x.short_text", TextLimit: 280, MaxSegments: 1},
			{
				Key: "x.thread", TextLimit: 280, MaxSegments: 10,
				MediaMaxCount: 4, AllowedMIMEs: []string{"image/jpeg", "image/png", "video/mp4"},
			},
		},
	}
	base := DestinationPlan{
		AccountID: "x-1", Platform: "x", Objective: "shares", Archetype: "technical_opinion",
		OutputProfile: "x.short_text", Preview: "A useful native post.",
		Segments: []SegmentPlan{{Body: strings.Repeat("x", 281)}},
		Media:    MediaPlan{Treatment: "none", Role: "none", Brief: "No media."},
	}
	require.ErrorContains(t, validateDestinationPlan(base, destination, policy, sourceReferenceCatalog{}), "text limit of 280")

	base.OutputProfile = "x.thread"
	base.Segments[0].Body = "A supported-length post."
	base.Media = MediaPlan{Treatment: "use_source", Role: "proof", Brief: "Attach the supplied proof.", SourceRef: "media:proof"}
	document := sourceReferenceCatalog{
		"media:proof": {kind: "document", mimeType: "application/pdf", publishable: true},
	}
	require.ErrorContains(t, validateDestinationPlan(base, destination, policy, document), "does not accept the selected source media")
	unknownMIME := sourceReferenceCatalog{
		"media:proof": {kind: "image", publishable: true},
	}
	require.ErrorContains(t, validateDestinationPlan(base, destination, policy, unknownMIME), "does not accept the selected source media")

	image := sourceReferenceCatalog{
		"media:proof": {kind: "image", mimeType: "image/png", publishable: true},
	}
	require.NoError(t, validateDestinationPlan(base, destination, policy, image))
}
