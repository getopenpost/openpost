package publisher

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestPublicationNotificationCohortDeduplicatesJobRetriesOnly(t *testing.T) {
	publication := &models.Publication{Revision: 7}
	lockedAt := time.Date(2026, time.July, 27, 12, 0, 0, 0, time.UTC)

	firstAttempt := WithJobExecution(context.Background(), "job-1", 1, lockedAt)
	secondAttempt := WithJobExecution(context.Background(), "job-1", 2, lockedAt.Add(time.Minute))
	manualRetry := WithJobExecution(context.Background(), "job-2", 1, lockedAt.Add(2*time.Minute))

	require.Equal(t, "job:job-1", publicationNotificationCohort(firstAttempt, publication))
	require.Equal(t, "job:job-1", publicationNotificationCohort(secondAttempt, publication))
	require.Equal(t, "job:job-2", publicationNotificationCohort(manualRetry, publication))
	require.Equal(t, "revision:7", publicationNotificationCohort(context.Background(), publication))
}
