package publicationdiscovery

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/services/sourcecontext"
	"github.com/openpost/backend/internal/services/voiceprofiles"
	"github.com/stretchr/testify/require"
)

type discoveryGeneratorFunc func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error)

func (fn discoveryGeneratorFunc) Generate(ctx context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
	return fn(ctx, request)
}

type discoverySourceLoaderFunc func(context.Context, string) (sourcecontext.Document, error)

func (fn discoverySourceLoaderFunc) Load(ctx context.Context, rawURL string) (sourcecontext.Document, error) {
	return fn(ctx, rawURL)
}

func discoveryTestConfig() Config {
	return Config{
		Model: "test-model",
		SourceLoader: discoverySourceLoaderFunc(func(_ context.Context, rawURL string) (sourcecontext.Document, error) {
			return sourcecontext.Document{Title: "Verified source title", CanonicalURL: rawURL, Text: "Verified source body."}, nil
		}),
	}
}

func TestDiscoverReturnsCitedPlanningCardsWithBoundedWebSearch(t *testing.T) {
	t.Parallel()

	fixedNow := time.Date(2026, 8, 23, 14, 0, 0, 0, time.UTC)
	generator := discoveryGeneratorFunc(func(_ context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
		require.Equal(t, "test-model", request.Model)
		require.Equal(t, int64(maxOutputTokens), request.MaxOutputTokens)
		require.Equal(t, ai.ReasoningEffortMedium, request.ReasoningEffort)
		require.Equal(t, ai.WebSearchConfig{
			Enabled: true, MaxResults: webSearchMaxResults, MaxUses: webSearchMaxUses,
			Context: ai.WebSearchContextLow,
		}, request.WebSearch)
		require.NotNil(t, request.ResponseSchema)
		require.Equal(t, "publication_opportunities", request.ResponseSchema.Name)
		require.Empty(t, request.Images)
		require.Empty(t, request.Files)
		require.Contains(t, request.SystemPrompt, "Do not write a post")
		require.Contains(t, request.UserPrompt, `"current_date":"2026-08-23"`)
		require.Contains(t, request.UserPrompt, "Direct technical founder")
		require.Contains(t, request.UserPrompt, "We already covered agent pricing")

		return ai.GenerateResult{Model: "resolved-model", Text: validDiscoveryJSON}, nil
	})
	service, err := New(generator, discoveryTestConfig())
	require.NoError(t, err)
	service.now = func() time.Time { return fixedNow }

	result, err := service.Discover(t.Context(), validDiscoveryInput())
	require.NoError(t, err)
	require.Equal(t, fixedNow, result.GeneratedAt)
	require.Equal(t, "resolved-model", result.Model)
	require.Len(t, result.Opportunities, 1)
	opportunity := result.Opportunities[0]
	require.Equal(t, "opportunity-1", opportunity.ID)
	require.Equal(t, "angle-1", opportunity.Angles[0].ID)
	require.Len(t, opportunity.Angles, 3)
	require.Len(t, opportunity.Sources, 1)
	require.True(t, opportunity.Sources[0].Primary)
	require.Equal(t, "https://openai.com/index/new-model", opportunity.Sources[0].URL)
	require.Equal(t, []string{"linkedin", "x"}, []string{
		opportunity.PlatformTreatments[0].Platform,
		opportunity.PlatformTreatments[1].Platform,
	})
}

func TestDiscoverRejectsPostDraftFieldsAndDoesNotLeakRawOutput(t *testing.T) {
	t.Parallel()

	const privateDraft = "private generated post body"
	malformed := strings.Replace(validDiscoveryJSON, `"hook": "A model release worth reading closely."`,
		`"hook": "A model release worth reading closely.", "post": "`+privateDraft+`"`, 1)
	service, err := New(discoveryGeneratorFunc(func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
		return ai.GenerateResult{Text: malformed}, nil
	}), discoveryTestConfig())
	require.NoError(t, err)
	service.now = func() time.Time { return time.Date(2026, 8, 23, 14, 0, 0, 0, time.UTC) }

	_, err = service.Discover(t.Context(), validDiscoveryInput())
	require.ErrorIs(t, err, ErrInvalidOutput)
	require.NotContains(t, err.Error(), privateDraft)
	require.NotContains(t, err.Error(), "post")
}

func TestDiscoverRejectsStaleMemoryPresentedAsCurrentEvidence(t *testing.T) {
	t.Parallel()

	stale := strings.Replace(validDiscoveryJSON, `"published_at": "2026-08-22"`, `"published_at": "2026-06-01"`, 1)
	service, err := New(discoveryGeneratorFunc(func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
		return ai.GenerateResult{Text: stale}, nil
	}), discoveryTestConfig())
	require.NoError(t, err)
	service.now = func() time.Time { return time.Date(2026, 8, 23, 14, 0, 0, 0, time.UTC) }

	_, err = service.Discover(t.Context(), validDiscoveryInput())
	require.ErrorIs(t, err, ErrInvalidOutput)
	require.ErrorContains(t, err, "recent primary source")
}

func TestDiscoverValidatesCallerContextBeforeGeneration(t *testing.T) {
	t.Parallel()

	called := false
	service, err := New(discoveryGeneratorFunc(func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
		called = true
		return ai.GenerateResult{}, nil
	}), discoveryTestConfig())
	require.NoError(t, err)
	input := validDiscoveryInput()
	input.Platforms = []string{"instagram"}

	_, err = service.Discover(t.Context(), input)
	require.ErrorIs(t, err, ErrInvalidInput)
	require.False(t, called)
}

func TestNewRequiresGeneratorAndModel(t *testing.T) {
	t.Parallel()

	_, err := New(nil, discoveryTestConfig())
	require.ErrorIs(t, err, ErrUnavailable)
	config := discoveryTestConfig()
	config.Model = ""
	_, err = New(discoveryGeneratorFunc(func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
		return ai.GenerateResult{}, errors.New("not called")
	}), config)
	require.ErrorIs(t, err, ErrUnavailable)
}

func TestDiscoverRejectsAnUnreachableGeneratedCitation(t *testing.T) {
	t.Parallel()
	config := discoveryTestConfig()
	config.SourceLoader = discoverySourceLoaderFunc(func(context.Context, string) (sourcecontext.Document, error) {
		return sourcecontext.Document{}, sourcecontext.ErrFetchFailed
	})
	service, err := New(discoveryGeneratorFunc(func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
		return ai.GenerateResult{Text: validDiscoveryJSON}, nil
	}), config)
	require.NoError(t, err)
	service.now = func() time.Time { return time.Date(2026, 8, 23, 14, 0, 0, 0, time.UTC) }

	_, err = service.Discover(t.Context(), validDiscoveryInput())
	require.ErrorIs(t, err, ErrInvalidOutput)
	require.NotContains(t, err.Error(), "openai.com")
}

func TestDiscoverPreservesCitationVerificationDeadline(t *testing.T) {
	t.Parallel()
	config := discoveryTestConfig()
	config.SourceLoader = discoverySourceLoaderFunc(func(context.Context, string) (sourcecontext.Document, error) {
		return sourcecontext.Document{}, context.DeadlineExceeded
	})
	service, err := New(discoveryGeneratorFunc(func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
		return ai.GenerateResult{Text: validDiscoveryJSON}, nil
	}), config)
	require.NoError(t, err)
	service.now = func() time.Time { return time.Date(2026, 8, 23, 14, 0, 0, 0, time.UTC) }

	_, err = service.Discover(t.Context(), validDiscoveryInput())
	require.ErrorIs(t, err, context.DeadlineExceeded)
	require.NotErrorIs(t, err, ErrInvalidOutput)
}

func validDiscoveryInput() Input {
	return Input{
		Focus:    "AI coding tools",
		Audience: "technical founders",
		Voice: VoiceContext{
			Name: "Rodrigo",
			Definition: voiceprofiles.Definition{
				IdentitySummary:  "Direct technical founder",
				Expertise:        []string{"developer tools", "open source"},
				ForbiddenPhrases: []string{"game changer"},
			},
		},
		Platforms: []string{"linkedin", "x"},
		RecentPublications: []RecentPublicationSummary{{
			PublishedAt: time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC),
			Summary:     "We already covered agent pricing.",
			Platforms:   []string{"x"},
			Topics:      []string{"AI agents"},
		}},
		Limit: 4,
	}
}

const validDiscoveryJSON = `{
  "opportunities": [{
    "title": "A new model changes the coding-agent tradeoff",
    "why_it_fits": "The voice has direct experience evaluating developer tools.",
    "why_now": "The vendor published a new model yesterday with concrete capability details.",
    "signal_date": "2026-08-22",
    "hook": "A model release worth reading closely.",
    "angles": [
      {"label": "Founder economics", "thesis": "Compare capability gains with the cost of changing a working stack.", "approach": "Use a practical decision framework."},
      {"label": "Technical limits", "thesis": "Focus on the boundary the release still does not cross.", "approach": "Lead with one documented constraint."},
      {"label": "Open-source response", "thesis": "Ask what the release changes for self-hosted tools.", "approach": "Contrast the official claim with the open-source workflow."}
    ],
    "sources": [{
      "title": "New model announcement",
      "url": "https://openai.com/index/new-model#details",
      "publisher": "OpenAI",
      "published_at": "2026-08-22",
      "supports": "The model release and its documented capabilities.",
      "primary": true
    }],
    "platform_treatments": [
      {"platform": "x", "objective": "conversation", "format": "compressed technical take", "rationale": "Center one sharp tradeoff and invite practitioner replies.", "media": "No visual unless there is a real benchmark artifact."},
      {"platform": "linkedin", "objective": "authority", "format": "evidence-led opinion", "rationale": "Explain the decision framework with enough context.", "media": "Use one annotated source excerpt."}
    ]
  }]
}`
