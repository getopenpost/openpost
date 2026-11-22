package messaging

import (
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/accountfeatures"
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

func TestHistoryDoesNotCommitAfterAccountEligibilityChanges(t *testing.T) {
	t.Parallel()
	for _, backend := range []string{"sqlite", "postgres"} {
		for _, revoke := range []string{"disconnect", "disable"} {
			t.Run(backend+"/"+revoke, func(t *testing.T) {
				s, db, account, _ := messagingBackendFixture(t, backend)
				features := accountfeatures.NewService(db, map[string]platform.Adapter{"bluesky": &platform.BlueskyAdapter{}}, nil)
				s.SetFeatureGate(features)
				_, err := db.NewInsert().Model(&models.AccountFeature{SocialAccountID: account.ID, WorkspaceID: account.WorkspaceID, Feature: "messaging", Enabled: true, DecidedAt: s.now()}).Exec(t.Context())
				require.NoError(t, err)
				enabled, err := features.IsEffectiveEnabled(t.Context(), account.ID, "messaging")
				require.NoError(t, err)
				require.True(t, enabled)
				fetched := false
				s.SetProvider("bluesky", historyTestProvider{page: platform.FetchMessageHistoryResult{Messages: []platform.ProviderMessage{{ID: "late-history", Direction: "inbound", Body: "after disable"}}}, beforeFetch: func() {
					fetched = true
					if revoke == "disconnect" {
						_, err := db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("is_active=?", false).Where("id=?", account.ID).Exec(t.Context())
						require.NoError(t, err)
					} else {
						_, err := db.NewUpdate().Model((*models.AccountFeature)(nil)).Set("enabled=?", false).Where("social_account_id=?", account.ID).Exec(t.Context())
						require.NoError(t, err)
					}
				}})
				jobErr := s.HandleJob(t.Context(), JobTypeMessagesSync, `{"id":"account","conversation_id":"conversation"}`)
				require.True(t, fetched, "eligibility must change after an admitted provider read: %v", jobErr)
				count, err := db.NewSelect().Model((*models.DirectMessage)(nil)).Where("remote_message_id=?", "late-history").Count(t.Context())
				require.NoError(t, err)
				require.Zero(t, count, "in-flight history must revalidate account eligibility before storage")
			})
		}
	}
}
