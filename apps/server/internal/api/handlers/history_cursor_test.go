package handlers

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTimestampIDCursorRejectsMalformedValues(t *testing.T) {
	t.Parallel()

	for _, value := range []string{"", "not-a-time|id", "2026-08-09T12:00:00Z|"} {
		_, err := parseTimestampIDCursor(value)
		require.ErrorIs(t, err, errInvalidHistoryCursor)
	}
}
