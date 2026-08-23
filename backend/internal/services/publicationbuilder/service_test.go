package publicationbuilder

import (
	"context"
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
				"media":{"treatment":"use_source","role":"proof","brief":"Show the deletion diff."},
				"destinations":[
					{"account_id":"linkedin-1","include":true,"reason":"The lesson supports an evidence-led argument."},
					{"account_id":"x-1","include":true,"reason":"The exact number supports a compact artifact post."}
				]
			}`}, nil
		case strings.Contains(request.SystemPrompt, "PLATFORM: linkedin"):
			return ai.GenerateResult{Text: `{
				"account_id":"linkedin-1",
				"objective":"authority",
				"archetype":"artifact_led",
				"output_profile":"linkedin.short_text",
				"preview":"I deleted 15,000 lines. The product got better.",
				"segments":[{"body":"I deleted 15,000 lines.\n\nThe product got better.\n\nThe hard part was proving which complexity no longer served users."}],
				"media":{"treatment":"use_source","role":"proof","brief":"Crop the deletion summary and keep the exact count readable."},
				"claims":[],"warnings":[],"follow_up_notes":[]
			}`}, nil
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
				"media":{"treatment":"use_source","role":"proof","brief":"Use the raw diff summary without decorative framing."},
				"claims":[],"warnings":[],"follow_up_notes":[]
			}`}, nil
		case strings.Contains(request.SystemPrompt, "ROLE: reviewer"):
			return ai.GenerateResult{Text: `{"approved":true,"flags":[],"replacements":[]}`}, nil
		default:
			t.Fatalf("unexpected generation role: %s", request.SystemPrompt)
			return ai.GenerateResult{}, nil
		}
	})

	service, err := New(generator, Config{Model: "test-model"})
	require.NoError(t, err)
	progress := make([]string, 0, 3)
	result, err := service.BuildWithProgress(context.Background(), BuildInput{
		Idea:    "I deleted 15,000 lines and somehow the product got better.",
		Sources: []SourceMaterial{{ID: "idea", Kind: "text", Label: "Idea", Text: "I deleted 15,000 lines and somehow the product got better."}},
		Files:   []ai.File{{Data: []byte("release notes"), MIMEType: "text/plain", Filename: "release.txt"}},
		Destinations: []Destination{
			{
				AccountID: "linkedin-1", Platform: "linkedin", Label: "Founder LinkedIn",
				AllowedOutputProfiles: []OutputProfile{{Key: "linkedin.short_text", TextLimit: 3000, MaxSegments: 1}},
			},
			{
				AccountID: "x-1", Platform: "x", Label: "Founder X",
				AllowedOutputProfiles: []OutputProfile{
					{Key: "x.short_text", TextLimit: 280, MaxSegments: 1},
					{Key: "x.thread", TextLimit: 280, MaxSegments: 10},
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
	require.Equal(t, "linkedin.short_text", result.Destinations[0].OutputProfile)
	require.Len(t, result.Destinations[0].Segments, 1)
	require.Equal(t, "x.thread", result.Destinations[1].OutputProfile)
	require.Len(t, result.Destinations[1].Segments, 2)
	require.NotEqual(t, result.Destinations[0].Segments[0].Body, result.Destinations[1].Segments[0].Body)

	mu.Lock()
	defer mu.Unlock()
	require.Len(t, requests, 4)
	for _, request := range requests {
		require.NotContains(t, request.SystemPrompt, "15,000")
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
			require.Error(t, validateDirector(plan, destinations, map[string]struct{}{}, DestinationPolicyRecommend))
		})
	}

	invalidRoute := base
	invalidRoute.Route = "viral_magic"
	require.Error(t, validateDirector(invalidRoute, destinations, map[string]struct{}{}, DestinationPolicyRecommend))
	require.NoError(t, validateDirector(base, destinations, map[string]struct{}{}, DestinationPolicyRecommend))
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

	require.Error(t, validateDestinationPlan(plan, destination, policy, map[string]struct{}{}))
	plan.Preview = "A useful native post."
	require.NoError(t, validateDestinationPlan(plan, destination, policy, map[string]struct{}{}))
}
