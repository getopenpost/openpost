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

	// Every built-in prompt must ship with a filled-in example so applying a
	// prompt can drop a ready-to-publish post into the composer.
	var prompts []models.Prompt
	require.NoError(t, db.NewSelect().Model(&prompts).Scan(context.Background()))
	for _, prompt := range prompts {
		require.NotEmpty(t, prompt.Text, "prompt %s missing text", prompt.ID)
		require.NotEmpty(t, prompt.Example, "prompt %s missing example", prompt.ID)
		require.NotEmpty(t, prompt.Category, "prompt %s missing category", prompt.ID)
	}

	// Seeding again must refresh the example on rows created by an older build
	// that predates the example column (upsert, not insert-only).
	firstPrompt := handler.builtinPrompts[0]
	require.NotEqual(t, "stale-example", firstPrompt.Example)
	_, err = db.NewUpdate().
		Model((*models.Prompt)(nil)).
		Set("example = ?", "stale-example").
		Where("id = ?", firstPrompt.ID).
		Exec(context.Background())
	require.NoError(t, err)

	restartedHandler := NewPromptHandler(db, testAuthenticator{})
	require.NoError(t, restartedHandler.seedBuiltInPrompts(context.Background()))
	var refreshed models.Prompt
	require.NoError(t, db.NewSelect().Model(&refreshed).Where("id = ?", firstPrompt.ID).Scan(context.Background()))
	require.Equal(t, firstPrompt.Example, refreshed.Example)

	restartedCount, err := db.NewSelect().Model((*models.Prompt)(nil)).Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, count, restartedCount)
}
