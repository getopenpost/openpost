package publicationbuilder

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/openpost/backend/internal/ai"
	"github.com/stretchr/testify/require"
)

func TestSupportedClaimsRequireKnownSourceReferences(t *testing.T) {
	t.Parallel()
	known := sourceReferenceCatalog{"source:1": {kind: "text"}}
	require.Error(t, validateClaims([]Claim{{Text: "A fact.", Status: "supported"}}, known))
	require.Error(t, validateClaims([]Claim{{Text: "A fact.", Status: "supported", SourceRefs: []string{"missing"}}}, known))
	require.NoError(t, validateClaims([]Claim{{Text: "A fact.", Status: "supported", SourceRefs: []string{"source:1"}}}, known))
}

type generationFunc func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error)

func (generate generationFunc) Generate(ctx context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
	return generate(ctx, request)
}

func TestAnglePlanningUsesSharedContextAndRepairsInvalidOutput(t *testing.T) {
	calls := 0
	service, err := New(generationFunc(func(_ context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
		calls++
		require.Contains(t, request.SystemPrompt, "Honor the author's locked_direction before platform style preferences")
		require.Contains(t, request.UserPrompt, `"source_ledger":[{"id":"idea","kind":"text","label":"","text":"The exporter preserves source audio."}]`)
		require.Contains(t, request.UserPrompt, `"language":"Portuguese"`)
		if calls == 1 {
			return ai.GenerateResult{Text: `{"angles":[]}`}, nil
		}
		require.Contains(t, request.UserPrompt, `"validation_error":"expected 5 angles"`)
		require.Contains(t, request.UserPrompt, `"previous_output":"{\"angles\":[]}"`)
		options := make([]map[string]any, 0, 5)
		for _, id := range []string{"keep_current", "recommended", "evidence_led", "personal_opinion", "contrarian"} {
			options = append(options, map[string]any{
				"id": id, "label": "A direction", "hook": "Keep source audio.", "thesis": "Source audio stays intact.",
				"approach": "Explain the release.", "objective": "clarity", "desired_reaction": "understanding", "evidence": "The release notes.",
				"media": map[string]any{"treatment": "none", "role": "none", "brief": "Text is sufficient.", "source_ref": ""},
			})
		}
		data, err := json.Marshal(map[string]any{"angles": options})
		require.NoError(t, err)
		return ai.GenerateResult{Text: string(data)}, nil
	}), Config{Model: "synthetic-model"})
	require.NoError(t, err)
	options, err := service.PlanAngles(t.Context(), AngleInput{
		Idea:         "The exporter preserves source audio.",
		Destinations: []Destination{{AccountID: "blue", Platform: "bluesky", AllowedOutputProfiles: []OutputProfile{{Key: "post", TextLimit: 300, MaxSegments: 1}}}},
		Voice:        VoiceSnapshot{Definition: VoiceDefinition{Language: "Portuguese"}},
	})
	require.NoError(t, err)
	require.Len(t, options, 5)
	require.Equal(t, 2, calls)
	require.Equal(t, "clarity", options[0].BuildDirection.Outcome)
}

func TestBuildDoesNotRepairProviderFailure(t *testing.T) {
	calls := 0
	failure := &ai.ProviderError{Provider: "synthetic", StatusCode: 503}
	service, err := New(generationFunc(func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
		calls++
		return ai.GenerateResult{}, failure
	}), Config{Model: "synthetic-model"})
	require.NoError(t, err)
	_, err = service.Build(t.Context(), BuildInput{Idea: "A release.", Destinations: []Destination{{AccountID: "blue", Platform: "bluesky", AllowedOutputProfiles: []OutputProfile{{Key: "post", TextLimit: 300, MaxSegments: 1}}}}})
	require.ErrorIs(t, err, failure)
	require.Equal(t, 1, calls, "structured-output repair must not dispatch another request after a provider failure")
}
