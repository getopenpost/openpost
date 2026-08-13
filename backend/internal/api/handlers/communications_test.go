package handlers

import (
	"encoding/base64"
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

func TestConversationCursorIsOpaqueAndRejectsInvalidValues(t *testing.T) {
	cursor := &communications.ConversationCursor{
		OccurredAt: time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC),
		ID:         "conversation-1",
	}
	encoded := encodeConversationCursor(cursor)
	require.NotEmpty(t, encoded)
	require.NotContains(t, encoded, "conversation-1")
	parsed, err := parseConversationCursor(encoded)
	require.NoError(t, err)
	require.Equal(t, cursor, parsed)

	for _, value := range []string{"not-a-cursor", "e30"} {
		_, err := parseConversationCursor(value)
		require.Error(t, err)
	}
}

func TestMessageCursorIsOpaqueAndRejectsInvalidValues(t *testing.T) {
	cursor := &communications.MessageCursor{
		OccurredAt: time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC),
		CreatedAt:  time.Date(2026, 8, 10, 12, 0, 1, 0, time.UTC),
		ID:         "message-1",
	}
	encoded := encodeMessageCursor(cursor)
	require.NotContains(t, encoded, "message-1")
	parsed, err := parseMessageCursor(encoded)
	require.NoError(t, err)
	require.Equal(t, cursor, parsed)

	for _, value := range []string{"not-base64", base64.RawURLEncoding.EncodeToString([]byte(`{"id":"message-1"}`))} {
		_, err := parseMessageCursor(value)
		require.Error(t, err)
	}
}
