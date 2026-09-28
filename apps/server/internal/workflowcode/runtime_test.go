package workflowcode

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestEvaluateHasOnlyExplicitInputAndJSONOutput(t *testing.T) {
	value, err := Evaluate(t.Context(), `globalThis.previous = 'private'; return {title: input.title.toUpperCase(), environment: typeof process, network: typeof fetch, filesystem: typeof std};`, map[string]any{"title": "Launch"})
	require.NoError(t, err)
	require.Equal(t, map[string]any{"title": "LAUNCH", "environment": "undefined", "network": "undefined", "filesystem": "undefined"}, value)
	value, err = Evaluate(t.Context(), `return typeof previous;`, nil)
	require.NoError(t, err)
	require.Equal(t, "undefined", value)
}
func TestEvaluateBoundsUntrustedPrograms(t *testing.T) {
	for _, code := range []string{`while(true){}`, `return 'x'.repeat(300000);`, `const data=[]; while(true) data.push('x'.repeat(1000000));`, `return ;`, `return import('std');`} {
		t.Run(code[:min(20, len(code))], func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
			defer cancel()
			_, err := Evaluate(ctx, code, nil)
			require.Error(t, err)
		})
	}
}
