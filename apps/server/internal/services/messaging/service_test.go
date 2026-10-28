package messaging

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/accountfeatures"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type testGate struct{}

func (testGate) IsEffectiveEnabled(context.Context, string, string) (bool, error) { return true, nil }

type testToken struct{}

func (testToken) GetValidAccessToken(context.Context, string) (string, error) { return "token", nil }

type testProvider struct {
	fetch func() (platform.FetchMessagesResult, error)
	send  func(context.Context) (platform.SendMessageResult, error)
}

func (testProvider) MessagingSupport() platform.MessagingSupport {
	return platform.MessagingSupport{Enabled: true, CanSend: true}
}
func (p testProvider) FetchMessages(context.Context, string, platform.FetchMessagesRequest) (platform.FetchMessagesResult, error) {
	if p.fetch != nil {
		return p.fetch()
	}
	return platform.FetchMessagesResult{}, nil
}
func (p testProvider) SendMessage(ctx context.Context, _ string, _ platform.SendMessageRequest) (platform.SendMessageResult, error) {
	return p.send(ctx)
}

func messagingFixture(t *testing.T) (*Service, *bun.DB, models.SocialAccount, Actor) {
	t.Helper()
	db, err := database.InitDBWithDriver("sqlite", fmt.Sprintf("file:messaging-%d?mode=memory&cache=shared", time.Now().UnixNano()))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))
	now := time.Now().UTC()
	account := models.SocialAccount{ID: "account", WorkspaceID: "workspace", Platform: "bluesky", AccountID: "did:plc:self", Slug: "self", AccessTokenEnc: []byte("token"), IsActive: true}
	for _, row := range []any{
		&models.User{ID: "user", Email: "chat@example.test", PasswordHash: "hash", CreatedAt: now},
		&models.Organization{ID: "org", Name: "Org", CreatedByID: "user", CreatedAt: now, UpdatedAt: now},
		&models.Workspace{ID: "workspace", Name: "Workspace", OrganizationID: "org", CreatedAt: now},
		&models.WorkspaceMember{WorkspaceID: "workspace", UserID: "user", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive, CreatedAt: now},
		&account,
		&models.Conversation{ID: "conversation", WorkspaceID: "workspace", SocialAccountID: "account", Platform: "bluesky", RemoteConversationID: "remote-thread", LastMessageAt: now, CreatedAt: now, UpdatedAt: now},
	} {
		_, err = db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
	s := NewService(db, testToken{}, nil)
	s.SetFeatureGate(testGate{})
	return s, db, account, Actor{UserID: "user"}
}

// A provider can deliver its outbound echo while the HTTP send is still returning.
// The admitted local ID must survive so clients can reconcile their optimistic bubble.
func TestSendReconcilesEchoBeforeAcceptance(t *testing.T) {
	s, db, account, actor := messagingFixture(t)
	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	s.now = func() time.Time { return createdAt }
	sentAt := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	readAt := sentAt.Add(time.Minute)
	echo := platform.FetchMessageEventsResult{
		Conversations: []platform.ProviderConversation{{
			ID: "remote-thread", LastMessageAt: sentAt,
			Messages: []platform.ProviderMessage{{
				ID: "remote-message", Direction: "outbound", Body: "hello",
				AuthorRemoteID: account.AccountID, RemoteCreatedAt: sentAt,
				Attachments:    []platform.MessageAttachment{{Type: "image", URL: "https://provider.example/image.png", Name: "image.png", MimeType: "image/png"}},
				ReactionsKnown: true, Reactions: []platform.ProviderMessageReaction{{ActorRemoteID: "friend", Value: "heart"}, {ActorRemoteID: "friend", Value: "smile"}},
			}},
		}},
		ReadStates: []platform.ProviderReadState{{ConversationID: "remote-thread", MessageID: "remote-message", ActorRemoteID: "friend", ReadAt: readAt}},
	}
	var queued *models.DirectMessage
	s.SetProvider("bluesky", testProvider{send: func(ctx context.Context) (platform.SendMessageResult, error) {
		// Both copies may already own reactions. Merging must deduplicate their
		// shared reaction without discarding either copy's distinct reaction.
		_, err := db.NewRaw(`INSERT INTO message_reactions(message_id,actor_remote_id,value) VALUES(?,?,?),(?,?,?)`, queued.ID, "friend", "heart", queued.ID, "viewer", "like").Exec(ctx)
		if err != nil {
			return platform.SendMessageResult{}, err
		}
		err = s.ApplyProviderEvents(ctx, account.ID, echo)
		return platform.SendMessageResult{RemoteMessageID: "remote-message"}, err
	}})
	var err error
	queued, err = s.QueueMessage(t.Context(), actor, "conversation", "hello", "echo-operation")
	require.NoError(t, err)
	require.NoError(t, s.HandleJob(t.Context(), JobTypeMessageSend, `{"id":"`+queued.ID+`"}`))
	// Replay the exact remote identity after acceptance, as a delayed callback
	// or REST repair would. It must still resolve to the admitted message.
	require.NoError(t, s.ApplyProviderEvents(t.Context(), account.ID, platform.FetchMessageEventsResult{Conversations: echo.Conversations}))
	page, err := s.ListMessages(t.Context(), actor, MessageQuery{WorkspaceID: "workspace", ConversationID: "conversation"})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	message := page.Items[0]
	require.Equal(t, queued.ID, message.ID)
	require.Equal(t, "echo-operation", message.ClientOperationID)
	require.True(t, queued.CreatedAt.Equal(message.CreatedAt))
	require.Equal(t, "sent", message.SendStatus)
	require.Equal(t, "remote-message", message.RemoteMessageID)
	t.Run("provider metadata", func(t *testing.T) {
		require.True(t, sentAt.Equal(message.RemoteCreatedAt))
		require.True(t, readAt.Equal(message.ProviderReadAt), "the echo's read receipt must survive acceptance")
		require.Equal(t, account.AccountID, message.AuthorRemoteID)
		require.JSONEq(t, `[{"type":"image","url":"https://provider.example/image.png","name":"image.png","mime_type":"image/png"}]`, message.AttachmentsJSON)
	})
	t.Run("reactions", func(t *testing.T) {
		var reactions []struct{ MessageID, ActorRemoteID, Value string }
		require.NoError(t, db.NewRaw(`SELECT message_id,actor_remote_id,value FROM message_reactions`).Scan(t.Context(), &reactions))
		require.ElementsMatch(t, []struct{ MessageID, ActorRemoteID, Value string }{
			{queued.ID, "friend", "heart"}, {queued.ID, "friend", "smile"}, {queued.ID, "viewer", "like"},
		}, reactions)
	})
	replay, err := s.QueueMessage(t.Context(), actor, "conversation", "hello", "echo-operation")
	require.NoError(t, err)
	require.Equal(t, queued.ID, replay.ID)
	var jobs int
	require.NoError(t, db.NewSelect().Model((*models.Job)(nil)).ColumnExpr("COUNT(*)").Scan(t.Context(), &jobs))
	require.Equal(t, 1, jobs)
}

func TestUnreadAndArchiveSurviveIncomingCollection(t *testing.T) {
	s, _, account, actor := messagingFixture(t)
	read, archived := false, true
	require.NoError(t, s.SetConversationState(t.Context(), actor, "workspace", "conversation", &read, &archived))
	page, err := s.ListConversations(t.Context(), actor, ConversationQuery{WorkspaceID: "workspace", UnreadOnly: true, Archived: true})
	require.NoError(t, err)
	require.Len(t, page.Items, 1, "mark unread must restore an unread indicator")
	_, err = s.persistConversations(t.Context(), account, []platform.ProviderConversation{{ID: "remote-thread", LastMessageAt: s.now(), Messages: []platform.ProviderMessage{{ID: "incoming", Direction: "inbound", Body: "new reply", RemoteCreatedAt: s.now()}}}})
	require.NoError(t, err)
	page, err = s.ListConversations(t.Context(), actor, ConversationQuery{WorkspaceID: "workspace", UnreadOnly: true})
	require.NoError(t, err)
	require.Len(t, page.Items, 1, "new incoming messages must reopen archived chats")
}

func TestMessageOperationReplayAndConflict(t *testing.T) {
	s, db, _, actor := messagingFixture(t)
	s.SetProvider("bluesky", testProvider{})
	first, err := s.QueueMessage(t.Context(), actor, "conversation", "same text", "operation-1")
	require.NoError(t, err)
	replay, err := s.QueueMessage(t.Context(), actor, "conversation", "same text", "operation-1")
	require.NoError(t, err)
	require.Equal(t, first.ID, replay.ID)
	require.Equal(t, "operation-1", replay.ClientOperationID)
	_, err = s.QueueMessage(t.Context(), actor, "conversation", "changed text", "operation-1")
	require.ErrorIs(t, err, ErrOperationConflict)
	other, err := s.QueueMessage(t.Context(), actor, "conversation", "same text", "operation-2")
	require.NoError(t, err)
	require.NotEqual(t, first.ID, other.ID, "identical text is not an idempotency key")
	count, err := db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 2, count)
}

func TestInboxEventsReplayDeleteAndAuthorization(t *testing.T) {
	s, db, account, actor := messagingFixture(t)
	initial, err := s.Changes(t.Context(), actor, "workspace", "", 0)
	require.NoError(t, err)
	batch := platform.FetchMessageEventsResult{NextCursor: "revision-1", Conversations: []platform.ProviderConversation{{ID: "remote-thread", LastMessageAt: s.now(), LastRemoteMessageID: "inbound-1", LastMessagePreview: "private body", Messages: []platform.ProviderMessage{{ID: "inbound-1", Direction: "inbound", Body: "private body", RemoteCreatedAt: s.now()}}}}}
	require.NoError(t, s.ApplyProviderEvents(t.Context(), account.ID, batch))
	require.NoError(t, s.ApplyProviderEvents(t.Context(), account.ID, batch))
	page, err := s.ListConversations(t.Context(), actor, ConversationQuery{WorkspaceID: "workspace", UnreadOnly: true, Search: "private body"})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Equal(t, 1, page.Items[0].UnreadCount)
	changes, err := s.Changes(t.Context(), actor, "workspace", initial.Cursor, 0)
	require.NoError(t, err)
	require.Len(t, changes.Messages, 1)
	require.Equal(t, "private body", changes.Messages[0].Body)
	require.NoError(t, s.ApplyProviderEvents(t.Context(), account.ID, platform.FetchMessageEventsResult{NextCursor: "revision-2", DeletedMessages: []platform.DeletedProviderMessage{{MessageID: "inbound-1"}}}))
	removed, err := s.Changes(t.Context(), actor, "workspace", changes.Cursor, 0)
	require.NoError(t, err)
	require.Len(t, removed.Messages, 1)
	require.Empty(t, removed.Messages[0].Body)
	require.False(t, removed.Messages[0].DeletedAt.IsZero())
	var checkpoint string
	require.NoError(t, db.NewRaw(`SELECT cursor FROM message_event_checkpoints WHERE social_account_id=?`, account.ID).Scan(t.Context(), &checkpoint))
	require.Equal(t, "revision-2", checkpoint)
	_, err = db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("status=?", models.WorkspaceMemberStatusInactive).Where("workspace_id=? AND user_id=?", "workspace", actor.UserID).Exec(t.Context())
	require.NoError(t, err)
	_, err = s.Changes(t.Context(), actor, "workspace", removed.Cursor, 0)
	require.ErrorIs(t, err, ErrAccessDenied)
}

func TestRetryNeverReplaysAnAmbiguousProviderWrite(t *testing.T) {
	s, _, _, actor := messagingFixture(t)
	calls := 0
	s.SetProvider("bluesky", testProvider{send: func(context.Context) (platform.SendMessageResult, error) {
		calls++
		return platform.SendMessageResult{}, context.DeadlineExceeded
	}})
	message, err := s.QueueMessage(t.Context(), actor, "conversation", "keep this text", "ambiguous-operation")
	require.NoError(t, err)
	require.Error(t, s.HandleJob(t.Context(), JobTypeMessageSend, `{"id":"`+message.ID+`"}`))
	page, err := s.ListMessages(t.Context(), actor, MessageQuery{WorkspaceID: "workspace", ConversationID: "conversation"})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Equal(t, "ambiguous", page.Items[0].SendStatus)
	require.Equal(t, "keep this text", page.Items[0].Body)
	_, err = s.RetryMessage(t.Context(), actor, "workspace", "conversation", message.ID)
	require.ErrorIs(t, err, ErrRetryUnsafe)
	replay, err := s.QueueMessage(t.Context(), actor, "conversation", "keep this text", "ambiguous-operation")
	require.NoError(t, err)
	require.Equal(t, message.ID, replay.ID)
	require.Equal(t, 1, calls)
}

func TestLateReactionSnapshotDoesNotResurrectRemovedReaction(t *testing.T) {
	s, db, account, _ := messagingFixture(t)
	incoming := platform.ProviderMessage{ID: "m1", Direction: "inbound", Body: "hello", RemoteCreatedAt: s.now(), ReactionsKnown: true, Reactions: []platform.ProviderMessageReaction{{ActorRemoteID: "friend", Value: "heart"}}}
	batch := platform.FetchMessageEventsResult{Conversations: []platform.ProviderConversation{{ID: "remote-thread", Messages: []platform.ProviderMessage{incoming}}}}
	require.NoError(t, s.ApplyProviderEvents(t.Context(), account.ID, batch))
	require.NoError(t, s.ApplyProviderEvents(t.Context(), account.ID, platform.FetchMessageEventsResult{Reactions: []platform.ProviderMessageReaction{{ConversationID: "remote-thread", MessageID: "m1", ActorRemoteID: "friend", Value: "heart", Deleted: true}}}))
	// A history response that began earlier can contain this stale snapshot.
	require.NoError(t, s.ApplyProviderEvents(t.Context(), account.ID, batch))
	var count int
	require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM message_reactions`).Scan(t.Context(), &count))
	require.Zero(t, count)
}

func TestUnreadSummaryCountsConversationsBeyondPageOne(t *testing.T) {
	s, db, _, actor := messagingFixture(t)
	for i := range 101 {
		_, err := db.NewInsert().Model(&models.Conversation{ID: fmt.Sprintf("chat-%03d", i), WorkspaceID: "workspace", SocialAccountID: "account", Platform: "bluesky", RemoteConversationID: fmt.Sprintf("remote-%d", i), UnreadCount: 3, CreatedAt: s.now(), UpdatedAt: s.now()}).Exec(t.Context())
		require.NoError(t, err)
	}
	summary, err := s.Summary(t.Context(), actor, "workspace")
	require.NoError(t, err)
	require.Equal(t, 101, summary.UnreadConversations)
	page, err := s.ListConversations(t.Context(), actor, ConversationQuery{WorkspaceID: "workspace", UnreadOnly: true, Limit: 100})
	require.NoError(t, err)
	require.Len(t, page.Items, 100)
	require.NotNil(t, page.NextCursor)
}

func TestAdmissionUsesTransactionBoundFeatureGate(t *testing.T) {
	s, db, _, actor := messagingFixture(t)
	_, err := db.NewInsert().Model(&models.AccountFeature{SocialAccountID: "account", WorkspaceID: "workspace", Feature: "messaging", Enabled: true, DecidedAt: s.now()}).Exec(t.Context())
	require.NoError(t, err)
	s.SetFeatureGate(accountfeatures.NewService(db, map[string]platform.Adapter{"bluesky": &platform.BlueskyAdapter{}}, nil))
	s.SetProvider("bluesky", testProvider{})
	ctx, cancel := context.WithTimeout(t.Context(), 300*time.Millisecond)
	defer cancel()
	_, err = s.QueueMessage(ctx, actor, "conversation", "one connection", "single-pool")
	require.NoError(t, err, "the feature gate must reuse the admission transaction's SQLite connection")
}

func TestForegroundEntryWakesColdAccountAndCoalescesDevices(t *testing.T) {
	s, db, account, actor := messagingFixture(t)
	s.SetProvider("bluesky", testProvider{})
	_, err := db.NewRaw(`INSERT INTO message_event_checkpoints(social_account_id,next_poll_at) VALUES(?,?)`, account.ID, s.now().Add(time.Hour)).Exec(t.Context())
	require.NoError(t, err)
	for _, clientID := range []string{"phone", "browser"} {
		require.NoError(t, s.Heartbeat(t.Context(), actor, Activity{WorkspaceID: "workspace", ClientID: clientID, View: "conversation", ConversationID: "conversation"}))
	}
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() { defer close(done); s.RunCollector(ctx) }()
	defer func() { cancel(); <-done }()
	require.Eventually(t, func() bool {
		count, err := db.NewSelect().Model((*models.Job)(nil)).Where("type=?", JobTypeMessagesSync).Count(t.Context())
		return err == nil && count == 1
	}, 2*time.Second, 10*time.Millisecond)
}

func TestCounterpartReadReceiptsRespectWatermarksAndNeverRegress(t *testing.T) {
	for _, receiptKind := range []string{"watermark", "message ID"} {
		t.Run(receiptKind, func(t *testing.T) {
			s, db, account, actor := messagingFixture(t)
			at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
			require.NoError(t, s.ApplyProviderEvents(t.Context(), account.ID, platform.FetchMessageEventsResult{Conversations: []platform.ProviderConversation{
				{ID: "remote-thread", LastRemoteMessageID: "inbound", LastMessageAt: at.Add(time.Minute), Messages: []platform.ProviderMessage{
					{ID: "before", Direction: "outbound", RemoteCreatedAt: at.Add(-time.Second)},
					{ID: "boundary", Direction: "outbound", RemoteCreatedAt: at},
					{ID: "after", Direction: "outbound", RemoteCreatedAt: at.Add(time.Second)},
					{ID: "inbound", Direction: "inbound", RemoteCreatedAt: at.Add(-time.Minute)},
					{ID: "unknown-time", Direction: "outbound"},
				}},
				{ID: "other-thread", Messages: []platform.ProviderMessage{{ID: "other", Direction: "outbound", RemoteCreatedAt: at.Add(-time.Minute)}}},
			}}))
			initial, err := s.Changes(t.Context(), actor, "workspace", "", 0)
			require.NoError(t, err)
			read := platform.ProviderReadState{ConversationID: "remote-thread", ActorRemoteID: "friend", ReadAt: at}
			if receiptKind == "message ID" {
				read.MessageID = "boundary"
			}
			apply := func(read platform.ProviderReadState) {
				t.Helper()
				require.NoError(t, s.ApplyProviderEvents(t.Context(), account.ID, platform.FetchMessageEventsResult{ReadStates: []platform.ProviderReadState{read}}))
			}
			apply(read)
			changes, err := s.Changes(t.Context(), actor, "workspace", initial.Cursor, 0)
			require.NoError(t, err)
			wantIDs := []string{"boundary"}
			if receiptKind == "watermark" {
				wantIDs = append(wantIDs, "before")
			}
			changedIDs := make([]string, 0, len(changes.Messages))
			for _, message := range changes.Messages {
				changedIDs = append(changedIDs, message.RemoteMessageID)
			}
			require.ElementsMatch(t, wantIDs, changedIDs, "only read outbound messages should be emitted")
			// Both a delayed receipt and its replay must leave the later read time intact.
			read.ReadAt = at.Add(-time.Millisecond)
			apply(read)
			apply(read)
			// A viewer's timestamp-only receipt and an anonymous receipt must not
			// mark provider reads or clear the viewer's incoming unread state.
			apply(platform.ProviderReadState{ConversationID: "remote-thread", ActorRemoteID: account.AccountID, ReadAt: at.Add(time.Hour)})
			apply(platform.ProviderReadState{ConversationID: "remote-thread", ReadAt: at.Add(time.Hour)})
			var messages []models.DirectMessage
			require.NoError(t, db.NewSelect().Model(&messages).Scan(t.Context()))
			for _, message := range messages {
				if message.RemoteMessageID == "boundary" || (receiptKind == "watermark" && message.RemoteMessageID == "before") {
					require.True(t, at.Equal(message.ProviderReadAt), "read time regressed for %s", message.RemoteMessageID)
				} else {
					require.True(t, message.ProviderReadAt.IsZero(), "unrelated message %s was marked read", message.RemoteMessageID)
				}
			}
			var conversation models.Conversation
			require.NoError(t, db.NewSelect().Model(&conversation).Where("id=?", "conversation").Scan(t.Context()))
			require.Equal(t, 1, conversation.UnreadCount)
			require.True(t, conversation.ReadAt.IsZero())
		})
	}
}

func TestManualRefreshReturnsCoalescedWorkspaceCollectionReceipts(t *testing.T) {
	s, db, _, actor := messagingFixture(t)
	s.SetProvider("bluesky", testProvider{})
	queued, err := s.RefreshWorkspace(t.Context(), actor, "workspace", true)
	require.NoError(t, err)
	require.Equal(t, 1, queued)
	first, err := s.ActiveRefreshJobIDs(t.Context(), actor, "workspace")
	require.NoError(t, err)
	require.Len(t, first, 1)
	queued, err = s.RefreshWorkspace(t.Context(), actor, "workspace", true)
	require.NoError(t, err)
	require.Zero(t, queued)
	again, err := s.ActiveRefreshJobIDs(t.Context(), actor, "workspace")
	require.NoError(t, err)
	require.Equal(t, first, again)
	_, err = s.ActiveRefreshJobIDs(t.Context(), Actor{UserID: actor.UserID, CredentialWorkspaceID: "other"}, "workspace")
	require.ErrorIs(t, err, ErrAccessDenied)
	_, err = db.NewUpdate().Model((*models.Job)(nil)).Set("status='completed'").Where("id=?", first[0]).Exec(t.Context())
	require.NoError(t, err)
	finished, err := s.ActiveRefreshJobIDs(t.Context(), actor, "workspace")
	require.NoError(t, err)
	require.Empty(t, finished)
}
