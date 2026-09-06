package models

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCommunicationModelsOmitEmptyTimestamps(t *testing.T) {
	for name, value := range map[string]any{
		"engagement":   EngagementItem{ID: "engagement-1"},
		"conversation": Conversation{ID: "conversation-1"},
	} {
		t.Run(name, func(t *testing.T) {
			payload, err := json.Marshal(value)
			if err != nil {
				t.Fatalf("marshal model: %v", err)
			}
			for _, field := range []string{
				"read_at",
				"archived_at",
				"remote_created_at",
				"messaging_window_expires_at",
			} {
				if strings.Contains(string(payload), `"`+field+`"`) {
					t.Fatalf("zero %s must not be exposed as a real timestamp: %s", field, payload)
				}
			}
		})
	}
}
