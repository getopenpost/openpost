package messaging

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func storedMessageFixture(id, remoteID, direction, body, attachments string, deleted bool) *models.DirectMessage {
	now := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	message := &models.DirectMessage{
		ID: id, WorkspaceID: "workspace", ConversationID: "conversation", RemoteMessageID: remoteID,
		Direction: direction, AuthorRemoteID: "friend", Body: body, AttachmentsJSON: attachments,
		SendStatus: "received", RemoteCreatedAt: now, CreatedAt: now, UpdatedAt: now,
	}
	if deleted {
		message.DeletedAt = now
		message.Body = ""
		message.AttachmentsJSON = "[]"
	}
	return message
}

// A message stored before the adapter understood a provider field keeps its
// blank body until the provider describes it again.
func TestCollectionRepairsStoredMessageContent(t *testing.T) {
	s, db, account, _ := messagingFixture(t)
	_, err := db.NewInsert().Model(storedMessageFixture("blank", "remote-message", "inbound", "", "null", false)).Exec(t.Context())
	require.NoError(t, err)
	_, err = s.persistConversations(t.Context(), account, []platform.ProviderConversation{{
		ID: "remote-thread", LastMessageAt: s.now(),
		Messages: []platform.ProviderMessage{{
			ID: "remote-message", Direction: "inbound", Body: "shared a post", RemoteCreatedAt: s.now(),
			Attachments: []platform.MessageAttachment{{Type: "share", URL: "https://www.instagram.com/p/abc/"}},
		}},
	}})
	require.NoError(t, err)
	var stored models.DirectMessage
	require.NoError(t, db.NewSelect().Model(&stored).Where("remote_message_id = ?", "remote-message").Scan(t.Context()))
	require.Equal(t, "blank", stored.ID)
	require.Equal(t, "shared a post", stored.Body)
	require.JSONEq(t, `[{"type":"share","url":"https://www.instagram.com/p/abc/"}]`, stored.AttachmentsJSON)
	var count int
	require.NoError(t, db.NewSelect().Model((*models.DirectMessage)(nil)).ColumnExpr("COUNT(*)").Scan(t.Context(), &count))
	require.Equal(t, 1, count, "a repair must not insert a second copy")
}

// Repairs never rewrite deleted tombstones, authored sends, or messages that
// already have content.
func TestCollectionRepairLeavesDeletedAndAuthoredMessages(t *testing.T) {
	s, db, account, _ := messagingFixture(t)
	for _, row := range []*models.DirectMessage{
		storedMessageFixture("deleted", "deleted-message", "inbound", "", "", true),
		storedMessageFixture("sent", "sent-message", "outbound", "queued text", "null", false),
		storedMessageFixture("kept", "kept-message", "inbound", "original", `[{"type":"image","url":"https://cdn.example/one.png"}]`, false),
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
	_, err := s.persistConversations(t.Context(), account, []platform.ProviderConversation{{
		ID: "remote-thread", LastMessageAt: s.now(),
		Messages: []platform.ProviderMessage{
			{ID: "deleted-message", Direction: "inbound", Body: "resurrected", RemoteCreatedAt: s.now()},
			{ID: "sent-message", Direction: "outbound", Body: "provider copy", RemoteCreatedAt: s.now()},
			{ID: "kept-message", Direction: "inbound", Body: "provider copy", RemoteCreatedAt: s.now()},
		},
	}})
	require.NoError(t, err)
	for id, want := range map[string]struct{ body, attachments string }{
		"deleted": {body: "", attachments: "[]"},
		"sent":    {body: "queued text", attachments: "null"},
		"kept":    {body: "original", attachments: `[{"type":"image","url":"https://cdn.example/one.png"}]`},
	} {
		var stored models.DirectMessage
		require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", id).Scan(t.Context()))
		require.Equal(t, want.body, stored.Body, id)
		require.Equal(t, want.attachments, stored.AttachmentsJSON, id)
	}
}

// Adapters that could not parse a provider timestamp stored the zero time.
// A later sync keeps the provider's real sent time for that message.
func TestCollectionRepairsUntimedMessages(t *testing.T) {
	s, db, account, _ := messagingFixture(t)
	untimed := storedMessageFixture("untimed", "untimed-message", "inbound", "hello", "null", false)
	untimed.RemoteCreatedAt = time.Time{}
	_, err := db.NewInsert().Model(untimed).Exec(t.Context())
	require.NoError(t, err)
	sentAt := time.Date(2026, 10, 24, 10, 0, 0, 0, time.UTC)
	_, err = s.persistConversations(t.Context(), account, []platform.ProviderConversation{{
		ID: "remote-thread", LastMessageAt: sentAt,
		Messages: []platform.ProviderMessage{{ID: "untimed-message", Direction: "inbound", Body: "hello", RemoteCreatedAt: sentAt}},
	}})
	require.NoError(t, err)
	var stored models.DirectMessage
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", "untimed").Scan(t.Context()))
	require.True(t, stored.RemoteCreatedAt.Equal(sentAt))
	require.Equal(t, "hello", stored.Body, "a timed message keeps its content")
}
