package handlers

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestMediaBatchDeletionAlreadyCompleteSupportsIdempotentReplay(t *testing.T) {
	t.Parallel()

	require.False(t, mediaBatchDeletionAlreadyComplete(models.MediaAttachment{}))
	require.True(t, mediaBatchDeletionAlreadyComplete(models.MediaAttachment{TrashedAt: time.Now()}))
}
