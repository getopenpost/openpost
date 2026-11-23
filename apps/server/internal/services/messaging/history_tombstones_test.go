package messaging

import (
	"testing"

	"github.com/openpost/backend/internal/platform"

	"github.com/stretchr/testify/require"
)

func TestHistoryDeletionPrecedesLaterHistoryMessage(t *testing.T) {
	t.Parallel()
	for _, backend := range []string{"sqlite", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			s, _, account, actor := messagingBackendFixture(t, backend)
			s.SetProvider("bluesky", historyTestProvider{page: platform.FetchMessageHistoryResult{DeletedMessages: []platform.DeletedProviderMessage{{MessageID: "deleted-in-history"}}, NextCursor: "older"}})
			require.NoError(t, s.HandleJob(t.Context(), JobTypeMessagesSync, `{"id":"account","conversation_id":"conversation"}`))
			s.SetProvider("bluesky", historyTestProvider{page: platform.FetchMessageHistoryResult{Messages: []platform.ProviderMessage{{ID: "deleted-in-history", Direction: "inbound", Body: "must stay deleted", RemoteCreatedAt: s.now()}}}})
			require.NoError(t, s.HandleJob(t.Context(), JobTypeMessagesSync, `{"id":"account","conversation_id":"conversation"}`))
			page, err := s.ListMessages(t.Context(), actor, MessageQuery{WorkspaceID: account.WorkspaceID, ConversationID: "conversation"})
			require.NoError(t, err)
			require.Empty(t, page.Items, "history-page deletion identities must survive before message discovery")
		})
	}
}
