package handlers

import (
	"context"
	"sync"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestSeedBuiltInPromptsIsConcurrentAndRestartSafe(t *testing.T) {
	db := createHandlerTestDB(t, (*models.Prompt)(nil))
	handler := NewPromptHandler(db, testAuthenticator{})

	const callers = 8
	start := make(chan struct{})
	errors := make(chan error, callers)
	var waitGroup sync.WaitGroup
	for range callers {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			<-start
			errors <- handler.seedBuiltInPrompts(context.Background())
		}()
	}
	close(start)
	waitGroup.Wait()
	close(errors)

	for err := range errors {
		require.NoError(t, err)
	}

	count, err := db.NewSelect().Model((*models.Prompt)(nil)).Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, len(handler.builtinPrompts), count)

	restartedHandler := NewPromptHandler(db, testAuthenticator{})
	require.NoError(t, restartedHandler.seedBuiltInPrompts(context.Background()))
	restartedCount, err := db.NewSelect().Model((*models.Prompt)(nil)).Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, count, restartedCount)
}
