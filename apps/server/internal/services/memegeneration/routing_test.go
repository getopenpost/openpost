package memegeneration

import (
	"context"
	"encoding/json"

	"testing"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/memes"

	"github.com/stretchr/testify/require"
)

type generationFunc func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error)

func (fn generationFunc) Generate(ctx context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
	return fn(ctx, request)
}

func TestSemanticRoutingUsesWholeCatalogAndSelectedImage(t *testing.T) {
	provider, err := memes.NewBuiltinProvider()
	require.NoError(t, err)
	calls := 0
	service, err := New(generationFunc(func(_ context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
		calls++
		if calls == 1 {
			require.Equal(t, "meme_template_selection", request.ResponseSchema.Name)
			require.Contains(t, request.UserPrompt, `"id":"drake"`)
			require.Contains(t, request.UserPrompt, `"id":"3hd"`)
			return ai.GenerateResult{Text: `{"template_ids":["drake"]}`, Usage: ai.Usage{TotalTokens: 11}}, nil
		}
		require.Equal(t, "meme_suggestions", request.ResponseSchema.Name)
		require.Contains(t, request.UserPrompt, "short, dry, no marketing")
		require.Contains(t, request.UserPrompt, "drake")
		require.NotEmpty(t, request.Images)
		require.Equal(t, "image/jpeg", request.Images[0].MIMEType)
		body, _ := json.Marshal(map[string]any{"candidates": []Candidate{{TemplateID: "drake", CaptionLines: []string{"more code", "more features"}, Rationale: "Reject extra code in favor of the result.", AltText: "Drake rejects more code and prefers more features."}}})
		return ai.GenerateResult{Text: string(body), Usage: ai.Usage{TotalTokens: 17}}, nil
	}), "test-model")
	require.NoError(t, err)
	service.SetTemplateProvider(provider)
	result, err := service.Suggest(context.Background(), Input{Idea: "Fewer lines, more features", CandidateCount: 1, VoiceGuidance: "short, dry, no marketing", Templates: []Template{{ID: "old-shortlist", Name: "Old shortlist", LineCount: 1}}})
	require.NoError(t, err)
	require.Equal(t, 2, calls)
	require.Equal(t, "drake", result.Candidates[0].TemplateID)
	require.Equal(t, int64(28), result.Usage.TotalTokens)
}
