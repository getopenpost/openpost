package handlers

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/services/communications"
	"github.com/stretchr/testify/require"
)

func TestEngagementCursorIsOpaqueAndRejectsInvalidValues(t *testing.T) {
	cursor := &communications.EngagementCursor{
		OccurredAt: time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC),
		CreatedAt:  time.Date(2026, 8, 10, 11, 0, 0, 0, time.UTC),
		ID:         "engagement-1",
	}
	encoded := encodeEngagementCursor(cursor)
	require.NotEmpty(t, encoded)
	require.NotContains(t, encoded, "engagement-1")

	parsed, err := parseEngagementCursor(encoded)
	require.NoError(t, err)
	require.Equal(t, cursor, parsed)

	for _, value := range []string{"not-a-cursor", "e30", ""} {
		parsed, err := parseEngagementCursor(value)
		if value == "" {
			require.NoError(t, err)
			require.Nil(t, parsed)
			continue
		}
		require.Error(t, err)
	}
}
