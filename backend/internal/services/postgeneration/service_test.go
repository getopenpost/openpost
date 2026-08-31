package postgeneration

import (
	"context"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/services/aiprompts"
	"github.com/stretchr/testify/require"
)

type generatorFunc func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error)

func (f generatorFunc) Generate(ctx context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
	return f(ctx, request)
}

type promptResolverFunc func(context.Context, []string) (aiprompts.PostGenerationInstructions, error)

func (f promptResolverFunc) ResolvePostGeneration(ctx context.Context, platforms []string) (aiprompts.PostGenerationInstructions, error) {
	return f(ctx, platforms)
}

func TestBuildReturnsCanonicalCopyAndEveryRequestedRendition(t *testing.T) {
	var request ai.GenerateRequest
	service, err := New(generatorFunc(func(_ context.Context, input ai.GenerateRequest) (ai.GenerateResult, error) {
		request = input
		return ai.GenerateResult{
			Text:  `{"source_text":"We shipped offline mode. Your drafts now keep moving without a connection.","renditions":[{"target":"target_1","body":"Offline mode is live. Keep drafting even when the connection drops."},{"target":"target_2","body":"We shipped offline mode so your publishing work can continue through unreliable connections."}]}`,
			Model: "openai/gpt-5.6-luna",
		}, nil
	}), "openai/gpt-5.6-luna", promptResolverFunc(func(_ context.Context, platforms []string) (aiprompts.PostGenerationInstructions, error) {
		require.ElementsMatch(t, []string{"x", "linkedin"}, platforms)
		return aiprompts.PostGenerationInstructions{
			Base: "Use the instance writing rules.",
			Platforms: map[string]string{
				"x":        "Use the saved X rules.",
				"linkedin": "Use the saved LinkedIn rules.",
			},
		}, nil
	}))
	require.NoError(t, err)

	result, err := service.Build(t.Context(), Input{
		Idea: "We shipped offline mode for drafting on bad connections.",
		Destinations: []Destination{
			{AccountID: "account-secret-x", Platform: "x", Profile: "short_text"},
			{AccountID: "account-secret-linkedin", Platform: "linkedin", Profile: "short_text"},
		},
	})
	require.NoError(t, err)
	require.Equal(t, "We shipped offline mode. Your drafts now keep moving without a connection.", result.SourceText)
	require.Equal(t, []Rendition{
		{AccountID: "account-secret-x", Body: "Offline mode is live. Keep drafting even when the connection drops."},
		{AccountID: "account-secret-linkedin", Body: "We shipped offline mode so your publishing work can continue through unreliable connections."},
	}, result.Renditions)
	require.Equal(t, "openai/gpt-5.6-luna", result.Model)
	require.NotContains(t, request.UserPrompt, "account-secret")
	require.Contains(t, request.UserPrompt, "target_1")
	require.Contains(t, request.UserPrompt, "linkedin")
	require.Contains(t, request.UserPrompt, `"max_characters":280`)
	require.Contains(t, request.SystemPrompt, "Use the instance writing rules.")
	require.Contains(t, request.SystemPrompt, "Use the saved X rules.")
	require.Contains(t, request.SystemPrompt, "Use the saved LinkedIn rules.")
	require.NotNil(t, request.ResponseSchema)
	require.Equal(t, "openpost_post_generation", request.ResponseSchema.Name)
}

func TestBuildRemovesDashPunctuationFromGeneratedCopy(t *testing.T) {
	service, err := New(generatorFunc(func(_ context.Context, _ ai.GenerateRequest) (ai.GenerateResult, error) {
		return ai.GenerateResult{
			Text: `{"source_text":"Build once—publish everywhere.","renditions":[{"target":"target_1","body":"Write once – adapt for each channel."}]}`,
		}, nil
	}), "openai/gpt-5.6-luna", nil)
	require.NoError(t, err)

	result, err := service.Build(t.Context(), Input{
		Idea:         "Build once and publish everywhere.",
		Destinations: []Destination{{AccountID: "account-1", Platform: "linkedin"}},
	})
	require.NoError(t, err)
	require.Equal(t, "Build once, publish everywhere.", result.SourceText)
	require.Equal(t, "Write once, adapt for each channel.", result.Renditions[0].Body)
	require.NotContains(t, result.SourceText, "—")
	require.NotContains(t, result.Renditions[0].Body, "–")
}

func TestBuildFitsRenditionsToDestinationLimit(t *testing.T) {
	tooLong := strings.Repeat("a", 274) + " 日本語"
	require.Less(t, utf8.RuneCountInString(tooLong), 280)
	service, err := New(generatorFunc(func(_ context.Context, _ ai.GenerateRequest) (ai.GenerateResult, error) {
		return ai.GenerateResult{
			Text: `{"source_text":"Draft","renditions":[{"target":"target_1","body":"` + tooLong + `"}]}`,
		}, nil
	}), "openai/gpt-5.6-luna", nil)
	require.NoError(t, err)

	result, err := service.Build(t.Context(), Input{
		Idea:         "Draft",
		Destinations: []Destination{{AccountID: "account-x", Platform: "x"}},
	})
	require.NoError(t, err)
	require.Equal(t, strings.Repeat("a", 274), result.Renditions[0].Body)
	require.LessOrEqual(t, capabilities.TextLength("x", result.Renditions[0].Body), 280)
}

func TestBuildRejectsMissingOrInventedDestinationOutput(t *testing.T) {
	service, err := New(generatorFunc(func(_ context.Context, _ ai.GenerateRequest) (ai.GenerateResult, error) {
		return ai.GenerateResult{
			Text: `{"source_text":"Draft","renditions":[{"target":"target_2","body":"Invented"}]}`,
		}, nil
	}), "openai/gpt-5.6-luna", nil)
	require.NoError(t, err)

	_, err = service.Build(t.Context(), Input{
		Idea:         "Draft",
		Destinations: []Destination{{AccountID: "account-1", Platform: "x"}},
	})
	require.ErrorIs(t, err, ErrInvalidResponse)
}
