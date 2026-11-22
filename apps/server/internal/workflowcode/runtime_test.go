package workflowcode

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestEvaluateHasOnlyExplicitInputAndJSONOutput(t *testing.T) {
	t.Parallel()
	value, err := Evaluate(t.Context(), `globalThis.previous = 'private'; return {title: input.title.toUpperCase(), environment: typeof process, network: typeof fetch, filesystem: typeof std};`, map[string]any{"title": "Launch"})
	require.NoError(t, err)
	require.Equal(t, map[string]any{"title": "LAUNCH", "environment": "undefined", "network": "undefined", "filesystem": "undefined"}, value)
	value, err = Evaluate(t.Context(), `return typeof previous;`, nil)
	require.NoError(t, err)
	require.Equal(t, "undefined", value)
}
func TestEvaluateBoundsUntrustedPrograms(t *testing.T) {
	t.Parallel()
	for _, code := range []string{`while(true){}`, `return 'x'.repeat(300000);`, `const data=[]; while(true) data.push('x'.repeat(1000000));`, `return ;`, `return import('std');`} {
		t.Run(code[:min(20, len(code))], func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
			defer cancel()
			_, err := Evaluate(ctx, code, nil)
			require.Error(t, err)
		})
	}
}

func TestEvaluateRejectsExcessConcurrentGuestsAndReleasesSlots(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan struct{}, 4)
	for range 4 {
		go func() { defer func() { done <- struct{}{} }(); _, _ = Evaluate(ctx, `while(true){}`, nil) }()
	}
	require.Eventually(t, func() bool { return len(guests) == 4 }, time.Second, time.Millisecond)
	started := time.Now()
	_, err := Evaluate(t.Context(), `return 1;`, nil)
	require.ErrorContains(t, err, "busy")
	require.Less(t, time.Since(started), time.Second)
	cancel()
	for range 4 {
		<-done
	}
	value, err := Evaluate(t.Context(), `return 1;`, nil)
	require.NoError(t, err)
	require.Equal(t, float64(1), value)
}
