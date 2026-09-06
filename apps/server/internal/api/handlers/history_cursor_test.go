package handlers

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestTimestampIDCursorRoundTrip(t *testing.T) {
	t.Parallel()

	timestamp := time.Date(2026, time.August, 9, 12, 34, 56, 789, time.UTC)
	parsed, err := parseTimestampIDCursor(encodeTimestampIDCursor(timestamp, "publication-2"))

	require.NoError(t, err)
	require.Equal(t, timestamp, parsed.Timestamp)
	require.Equal(t, "publication-2", parsed.ID)
}

func TestTimestampIDCursorRejectsMalformedValues(t *testing.T) {
	t.Parallel()

	for _, value := range []string{"", "not-a-time|id", "2026-08-09T12:00:00Z|"} {
		_, err := parseTimestampIDCursor(value)
		require.ErrorIs(t, err, errInvalidHistoryCursor)
	}
}
