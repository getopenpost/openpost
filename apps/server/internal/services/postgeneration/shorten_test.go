package postgeneration

import (
	"context"
	"strings"
	"testing"

	"github.com/openpost/backend/internal/ai"
	"github.com/stretchr/testify/require"
)

type scriptedGenerator struct {
	replies []string
	prompts []string
}

func (g *scriptedGenerator) Generate(_ context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
	g.prompts = append(g.prompts, request.UserPrompt)
	reply := g.replies[len(g.prompts)-1]
	return ai.GenerateResult{Text: reply}, nil
}

func newShortenService(t *testing.T, replies ...string) (*Service, *scriptedGenerator) {
	t.Helper()
	generator := &scriptedGenerator{replies: replies}
	service, err := New(generator, "test-model", nil)
	require.NoError(t, err)
	return service, generator
}

func TestShortenRetriesOnceThenCutsAtAWordBoundary(t *testing.T) {
	service, generator := newShortenService(t,
		`{"text":"alpha beta gamma delta epsilon"}`,
		`{"text":"alpha beta gamma delta epsilon"}`,
	)
	result, err := service.Shorten(context.Background(), ShortenInput{
		Text:          "alpha beta gamma delta epsilon zeta",
		Platform:      "x",
		MaxCharacters: 20,
	})
	require.NoError(t, err)
	require.Len(t, generator.prompts, 2)
	require.True(t, result.Truncated)
	require.Equal(t, "alpha beta gamma", result.Text)
	require.True(t, strings.Contains(generator.prompts[1], "previous_attempt"))
}
