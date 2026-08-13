package communications

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type staticTokenSource struct{}

func (staticTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	return "access-token", nil
}

type fakeCommenter struct {
	platform.Adapter
	accountIDs []string
	comments   []platform.Comment
	contentURL string
	likedIDs   []string
	unlikedIDs []string
	replyCalls int
	replyID    string
	replyErr   error
}

func (*fakeCommenter) EngagementSupport() platform.EngagementSupport {
	return platform.EngagementSupport{Enabled: true, CanReply: true, CanDelete: true}
}

func (f *fakeCommenter) ListComments(_ context.Context, _ string, accountID, _ string) ([]platform.Comment, error) {
	f.accountIDs = append(f.accountIDs, accountID)
	return f.comments, nil
}

func (f *fakeCommenter) ReplyToComment(context.Context, string, string, string, string) (string, error) {
	f.replyCalls++
	return f.replyID, f.replyErr
}

func (*fakeCommenter) HideComment(context.Context, string, string, string) error {
	return nil
}

func (*fakeCommenter) DeleteComment(context.Context, string, string, string) error {
	return nil
}

func (f *fakeCommenter) LikeComment(_ context.Context, _, _, commentID string) error {
	f.likedIDs = append(f.likedIDs, commentID)
	return nil
}

func (f *fakeCommenter) UnlikeComment(_ context.Context, _, _, commentID string) error {
	f.unlikedIDs = append(f.unlikedIDs, commentID)
	return nil
}

func (f *fakeCommenter) ResolveContentURL(context.Context, string, string, string) (string, error) {
	return f.contentURL, nil
}

type fakeMessenger struct {
	platform.Adapter
	fetches  int
	sends    int
	requests []platform.FetchMessagesRequest
	result   platform.FetchMessagesResult
	results  map[string]platform.FetchMessagesResult
}

func (f *fakeMessenger) MessagingSupport() platform.MessagingSupport {
	return platform.MessagingSupport{Enabled: true, CanSend: true, RequiresOptIn: true}
}

func (f *fakeMessenger) FetchMessages(_ context.Context, _ string, input platform.FetchMessagesRequest) (platform.FetchMessagesResult, error) {
	f.fetches++
	f.requests = append(f.requests, input)
	if f.results != nil {
		return f.results[input.Cursor], nil
	}
	return f.result, nil
}

func (f *fakeMessenger) SendMessage(context.Context, string, platform.SendMessageRequest) (platform.SendMessageResult, error) {
	f.sends++
	return platform.SendMessageResult{RemoteMessageID: "sent-1", CreatedAt: time.Now().UTC()}, nil
}

func TestMessageSendRecoveryDoesNotReplayAcceptedProviderWrite(t *testing.T) {
	db := communicationsTestDB(t)
	ctx := t.Context()
	now := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)
	account := &models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "facebook",
		AccountID: "page-1", Slug: "page-1", AccessTokenEnc: []byte("token"), IsActive: true,
		CapabilityState: `{"messages_enabled":"true"}`,
	}
	conversation := &models.Conversation{
		ID: "conversation-1", WorkspaceID: "workspace-1", SocialAccountID: account.ID,
		Platform: account.Platform, RemoteConversationID: "remote-conversation-1",
		CreatedAt: now, UpdatedAt: now,
	}
	message := &models.DirectMessage{
		ID: "message-1", WorkspaceID: "workspace-1", ConversationID: conversation.ID,
		Direction: "outbound", Body: "Hello", AttachmentsJSON: "[]", SendStatus: "queued",
		CreatedAt: now, UpdatedAt: now,
	}
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(account).Exec(ctx)
		return err
	}())
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(conversation).Exec(ctx)
		return err
	}())
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(message).Exec(ctx)
		return err
	}())

	messenger := &fakeMessenger{}
	service := NewService(db, staticTokenSource{}, nil)
	service.now = func() time.Time { return now }
	service.SetProvider("facebook", messenger)
	require.NoError(t, service.sendMessage(ctx, message.ID))
	require.Equal(t, 1, messenger.sends)

	_, err := db.NewUpdate().Model((*models.DirectMessage)(nil)).
		Set("send_status = 'queued'").Set("remote_message_id = ''").
		Where("id = ?", message.ID).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.Conversation)(nil)).
		Set("last_remote_message_id = ''").Where("id = ?", conversation.ID).Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, service.sendMessage(ctx, message.ID))
	require.Equal(t, 1, messenger.sends, "recovery after a local commit failure must reuse the accepted message result")
	require.NoError(t, db.NewSelect().Model(message).WherePK().Scan(ctx))
	require.Equal(t, "sent", message.SendStatus)
	require.Equal(t, "sent-1", message.RemoteMessageID)
}

func TestQueuedProviderCommentActionUsesAcceptedFenceAndIdempotentLifecycle(t *testing.T) {
	db := communicationsTestDB(t)
	seedProviderCommentAction(t, db)
	commenter := &fakeCommenter{replyID: "provider-reply-1"}
	service := NewService(db, staticTokenSource{}, nil)
	service.SetProvider("x", commenter)

	jobID, err := QueueProviderCommentAction(t.Context(), db, ProviderCommentActionInput{
		WorkspaceID: "workspace-1", PublicationID: "publication-1",
		RenditionID: "rendition-1", SocialAccountID: "account-1",
		ProviderCommentID: "comment-1", Action: "reply",
		Message: "A private reply body", UserID: "user-1",
	})
	require.NoError(t, err)
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", jobID).Scan(t.Context()))
	require.Equal(t, 1, job.MaxAttempts)
	ctx := providerwrite.WithJobExecution(t.Context(), job.ID, 1, time.Now().UTC())
	require.NoError(t, service.HandleJob(ctx, job.Type, job.Payload))

	// Simulate a crash after provider acceptance and the lifecycle write but
	// before the queue marks the job complete.
	require.NoError(t, service.HandleJob(ctx, job.Type, job.Payload))
	require.Equal(t, 1, commenter.replyCalls)
	var attempt models.ProviderWriteAttempt
	require.NoError(t, db.NewSelect().Model(&attempt).
		Where("operation_id = ?", "provider-comment:"+job.ID).Scan(t.Context()))
	require.Equal(t, providerwrite.StatusAccepted, attempt.Status)
	require.NotContains(t, attempt.PayloadFingerprint, "private reply")
	var events []models.PublicationLifecycleEvent
	require.NoError(t, db.NewSelect().Model(&events).
		Where("idempotency_key = ?", "provider-comment:"+job.ID+":succeeded").Scan(t.Context()))
	require.Len(t, events, 1)
}

func TestQueuedProviderCommentActionNeverReplaysAmbiguousWrite(t *testing.T) {
	db := communicationsTestDB(t)
	seedProviderCommentAction(t, db)
	commenter := &fakeCommenter{replyErr: context.DeadlineExceeded}
	service := NewService(db, staticTokenSource{}, nil)
	service.SetProvider("x", commenter)
	jobID, err := QueueProviderCommentAction(t.Context(), db, ProviderCommentActionInput{
		WorkspaceID: "workspace-1", PublicationID: "publication-1",
		RenditionID: "rendition-1", SocialAccountID: "account-1",
		ProviderCommentID: "comment-1", Action: "reply", Message: "Thanks", UserID: "user-1",
	})
	require.NoError(t, err)
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", jobID).Scan(t.Context()))
	ctx := providerwrite.WithJobExecution(t.Context(), job.ID, 1, time.Now().UTC())
	require.Error(t, service.HandleJob(ctx, job.Type, job.Payload))
	require.Error(t, service.HandleJob(ctx, job.Type, job.Payload))
	require.Equal(t, 1, commenter.replyCalls)
	var attempt models.ProviderWriteAttempt
	require.NoError(t, db.NewSelect().Model(&attempt).
		Where("operation_id = ?", "provider-comment:"+job.ID).Scan(t.Context()))
	require.Equal(t, providerwrite.StatusAmbiguous, attempt.Status)
}

func seedProviderCommentAction(t *testing.T, db *bun.DB) {
	t.Helper()
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "x",
		AccountID: "x-account", Slug: "x-account", AccessTokenEnc: []byte("encrypted"),
		IsActive: true, CreatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		Title: "Launch", ContentProfile: models.ContentProfileShortText,
		SourceText: "Launch", SourceContent: "Launch", Status: models.PublicationStatusPublished,
		Revision: 1, CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: "account-1",
		Platform: "x", Profile: models.ContentProfileShortText, Body: "Launch",
		Status: models.RenditionStatusPublished, ExternalID: "external-1",
		CreatedAt: now, UpdatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)
}

func communicationsTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	for _, model := range []any{
		(*models.SocialAccount)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.PublicationLifecycleEvent)(nil),
		(*models.EngagementItem)(nil),
		(*models.Job)(nil),
		(*models.ProviderWriteAttempt)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.ExecContext(ctx, `
CREATE TABLE conversations (
	id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, social_account_id TEXT NOT NULL,
	platform TEXT NOT NULL, remote_conversation_id TEXT NOT NULL,
	counterpart_remote_id TEXT NOT NULL DEFAULT '', counterpart_name TEXT NOT NULL DEFAULT '',
	counterpart_handle TEXT NOT NULL DEFAULT '', counterpart_avatar_url TEXT NOT NULL DEFAULT '',
	last_message_at TIMESTAMP, last_message_preview TEXT NOT NULL DEFAULT '',
	last_remote_message_id TEXT NOT NULL DEFAULT '', unread_count INTEGER NOT NULL DEFAULT 0,
	read_at TIMESTAMP, archived_at TIMESTAMP, messaging_window_expires_at TIMESTAMP,
	created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NOT NULL,
	UNIQUE (social_account_id, remote_conversation_id)
);
CREATE TABLE direct_messages (
	id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
	remote_message_id TEXT NOT NULL DEFAULT '', direction TEXT NOT NULL,
	author_remote_id TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
	attachments_json TEXT NOT NULL DEFAULT '[]', send_status TEXT NOT NULL DEFAULT 'received',
	error_message TEXT NOT NULL DEFAULT '', remote_created_at TIMESTAMP,
	created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX direct_messages_remote_test_idx
	ON direct_messages (conversation_id, remote_message_id) WHERE remote_message_id <> '';
CREATE UNIQUE INDEX engagement_items_remote_test_idx
	ON engagement_items (social_account_id, remote_id);
CREATE TABLE communication_sync_states (
	id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, capability TEXT NOT NULL,
	subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, social_account_id TEXT NOT NULL,
	platform TEXT NOT NULL, status TEXT NOT NULL, error_code TEXT NOT NULL DEFAULT '',
	error_message TEXT NOT NULL DEFAULT '', cursor TEXT NOT NULL DEFAULT '',
	backfill_complete BOOLEAN NOT NULL DEFAULT FALSE,
	last_attempted_at TIMESTAMP, last_success_at TIMESTAMP, next_sync_at TIMESTAMP,
	empty_streak INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NOT NULL
)`)
	require.NoError(t, err)
	return db
}

func TestMessageSyncRequiresOptInAndIsIdempotent(t *testing.T) {
	db := communicationsTestDB(t)
	ctx := context.Background()
	account := &models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "bluesky",
		AccountID: "did:plc:openpost", AccountUsername: "openpost.test",
		AccessTokenEnc: []byte("encrypted"), CapabilityState: `{}`, IsActive: true,
	}
	_, err := db.NewInsert().Model(account).Exec(ctx)
	require.NoError(t, err)
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	messenger := &fakeMessenger{result: platform.FetchMessagesResult{
		Conversations: []platform.ProviderConversation{{
			ID: "convo-1", CounterpartRemoteID: "did:plc:ada", CounterpartName: "Ada",
			LastMessageAt: now, LastMessagePreview: "Hello", LastRemoteMessageID: "message-1",
			Messages: []platform.ProviderMessage{{
				ID: "message-1", Direction: "inbound", AuthorRemoteID: "did:plc:ada",
				Body: "Hello", RemoteCreatedAt: now,
			}},
		}},
	}}
	service := NewService(db, staticTokenSource{}, nil)
	service.now = func() time.Time { return now }
	service.SetProvider("bluesky", messenger)

	require.NoError(t, service.HandleJob(ctx, JobTypeMessagesSync, `{"id":"account-1"}`))
	require.Zero(t, messenger.fetches)
	var state models.CommunicationSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("id = ?", "messages:account:account-1").Scan(ctx))
	require.Equal(t, "disabled", state.Status)

	account.CapabilityState = `{"messages_enabled":"true"}`
	_, err = db.NewUpdate().Model(account).Column("capability_state_json").WherePK().Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, service.HandleJob(ctx, JobTypeMessagesSync, `{"id":"account-1"}`))
	require.NoError(t, service.HandleJob(ctx, JobTypeMessagesSync, `{"id":"account-1"}`))
	require.Equal(t, 2, messenger.fetches)

	var conversations []models.Conversation
	require.NoError(t, db.NewSelect().Model(&conversations).Scan(ctx))
	require.Len(t, conversations, 1)
	require.Equal(t, 1, conversations[0].UnreadCount)
	var messages []models.DirectMessage
	require.NoError(t, db.NewSelect().Model(&messages).Scan(ctx))
	require.Len(t, messages, 1)
	require.Equal(t, "Hello", messages[0].Body)
}

func TestListMessagesOrdersStoredMessagesByProviderTime(t *testing.T) {
	db := communicationsTestDB(t)
	ctx := context.Background()
	now := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	conversation := &models.Conversation{
		ID: "conversation-1", WorkspaceID: "workspace-1", SocialAccountID: "account-1",
		Platform: "mastodon", RemoteConversationID: "remote-conversation-1",
		CreatedAt: now, UpdatedAt: now,
	}
	_, err := db.NewInsert().Model(conversation).Exec(ctx)
	require.NoError(t, err)
	messages := []models.DirectMessage{
		{
			ID: "message-later", WorkspaceID: "workspace-1", ConversationID: conversation.ID,
			Direction: "inbound", Body: "Later", RemoteCreatedAt: now.Add(time.Minute),
			CreatedAt: now, UpdatedAt: now,
		},
		{
			ID: "message-earlier", WorkspaceID: "workspace-1", ConversationID: conversation.ID,
			Direction: "outbound", Body: "Earlier", RemoteCreatedAt: now.Add(-time.Minute),
			CreatedAt: now.Add(time.Minute), UpdatedAt: now.Add(time.Minute),
		},
	}
	_, err = db.NewInsert().Model(&messages).Exec(ctx)
	require.NoError(t, err)

	service := NewService(db, staticTokenSource{}, nil)
	got, err := service.ListMessages(ctx, "workspace-1", conversation.ID, 100, 0)
	require.NoError(t, err)
	require.Len(t, got, 2)
	require.Equal(t, "message-earlier", got[0].ID)
	require.Equal(t, "message-later", got[1].ID)

	_, err = service.ListMessages(ctx, "workspace-2", conversation.ID, 100, 0)
	require.ErrorIs(t, err, ErrConversationNotFound)
}

func TestMessageSyncAlwaysChecksNewestPageWhileBackfilling(t *testing.T) {
	db := communicationsTestDB(t)
	ctx := context.Background()
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	account := &models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "bluesky",
		AccountID: "did:plc:openpost", AccessTokenEnc: []byte("encrypted"),
		CapabilityState: `{"messages_enabled":"true"}`, IsActive: true,
	}
	_, err := db.NewInsert().Model(account).Exec(ctx)
	require.NoError(t, err)
	conversation := func(id, message string, createdAt time.Time) platform.ProviderConversation {
		return platform.ProviderConversation{
			ID: id, CounterpartRemoteID: "did:plc:" + id, CounterpartName: id,
			LastMessageAt: createdAt, LastMessagePreview: message, LastRemoteMessageID: "message-" + id,
			Messages: []platform.ProviderMessage{{
				ID: "message-" + id, Direction: "inbound", Body: message, RemoteCreatedAt: createdAt,
			}},
		}
	}
	messenger := &fakeMessenger{results: map[string]platform.FetchMessagesResult{
		"": {
			Conversations: []platform.ProviderConversation{conversation("newest", "New", now)},
			NextCursor:    "older-page",
		},
		"older-page": {
			Conversations: []platform.ProviderConversation{conversation("older", "Old", now.Add(-24*time.Hour))},
		},
	}}
	service := NewService(db, staticTokenSource{}, nil)
	service.now = func() time.Time { return now }
	service.SetProvider("bluesky", messenger)

	require.NoError(t, service.HandleJob(ctx, JobTypeMessagesSync, `{"id":"account-1"}`))
	require.Equal(t, []string{""}, []string{messenger.requests[0].Cursor})
	var state models.CommunicationSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("id = ?", "messages:account:account-1").Scan(ctx))
	require.Equal(t, "older-page", state.Cursor)
	require.False(t, state.BackfillComplete)

	require.NoError(t, service.HandleJob(ctx, JobTypeMessagesSync, `{"id":"account-1"}`))
	require.Equal(t, []string{"", "older-page"}, []string{messenger.requests[1].Cursor, messenger.requests[2].Cursor})
	require.NoError(t, db.NewSelect().Model(&state).Where("id = ?", "messages:account:account-1").Scan(ctx))
	require.Empty(t, state.Cursor)
	require.True(t, state.BackfillComplete)

	require.NoError(t, service.HandleJob(ctx, JobTypeMessagesSync, `{"id":"account-1"}`))
	require.Equal(t, "", messenger.requests[3].Cursor)
	require.Len(t, messenger.requests, 4)
	count, countErr := db.NewSelect().Model((*models.Conversation)(nil)).Count(ctx)
	require.NoError(t, countErr)
	require.Equal(t, 2, count)
}

func TestQueueMessageEnforcesProviderWindowBeforeCreatingJob(t *testing.T) {
	db := communicationsTestDB(t)
	ctx := context.Background()
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	account := &models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "facebook", AccountID: "page-1",
		AccessTokenEnc: []byte("encrypted"), CapabilityState: `{"messages_enabled":"true"}`, IsActive: true,
	}
	_, err := db.NewInsert().Model(account).Exec(ctx)
	require.NoError(t, err)
	conversation := &models.Conversation{
		ID: "convo-1", WorkspaceID: "workspace-1", SocialAccountID: "account-1",
		Platform: "facebook", RemoteConversationID: "remote-1",
		MessagingWindowExpiresAt: now.Add(-time.Minute), CreatedAt: now, UpdatedAt: now,
	}
	_, err = db.NewInsert().Model(conversation).Exec(ctx)
	require.NoError(t, err)

	service := NewService(db, staticTokenSource{}, nil)
	service.now = func() time.Time { return now }
	service.SetProvider("facebook", &fakeMessenger{})
	_, err = service.QueueMessage(ctx, "convo-1", "Too late")
	require.ErrorContains(t, err, "reply window has closed")
	count, countErr := db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, countErr)
	require.Zero(t, count)

	conversation.MessagingWindowExpiresAt = now.Add(time.Hour)
	_, err = db.NewUpdate().Model(conversation).Column("messaging_window_expires_at").WherePK().Exec(ctx)
	require.NoError(t, err)
	message, err := service.QueueMessage(ctx, "convo-1", " On time ")
	require.NoError(t, err)
	require.Equal(t, "On time", message.Body)
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("type = ?", JobTypeMessageSend).Scan(ctx))
	require.Equal(t, 1, job.MaxAttempts)
	require.NoError(t, db.NewSelect().Model(conversation).Where("id = ?", "convo-1").Scan(ctx))
	require.Equal(t, "On time", conversation.LastMessagePreview)
}

func TestProviderPostURLUsesStableProviderIdentifiers(t *testing.T) {
	tests := []struct {
		name      string
		rendition models.Rendition
		account   models.SocialAccount
		want      string
	}{
		{
			name:      "x",
			rendition: models.Rendition{Platform: "x", ExternalID: "123"},
			account:   models.SocialAccount{AccountUsername: "openpost"},
			want:      "https://x.com/openpost/status/123",
		},
		{
			name:      "mastodon instance",
			rendition: models.Rendition{Platform: "mastodon", ExternalID: "456"},
			account: models.SocialAccount{
				AccountUsername: "openpost@social.example",
				InstanceURL:     "https://social.example",
			},
			want: "https://social.example/@openpost/456",
		},
		{
			name: "bluesky did and record key",
			rendition: models.Rendition{
				Platform:   "bluesky",
				ExternalID: `{"uri":"at://did:plc:openpost/app.bsky.feed.post/3abc","cid":"cid"}`,
			},
			want: "https://bsky.app/profile/did:plc:openpost/post/3abc",
		},
		{
			name:      "stored canonical URL wins",
			rendition: models.Rendition{Platform: "threads", ExternalURL: "https://www.threads.net/@openpost/post/abc"},
			want:      "https://www.threads.net/@openpost/post/abc",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Equal(t, test.want, providerPostURL(test.rendition, test.account))
		})
	}
}

func TestHistoricalRenditionUsesActiveReplacementAfterReconnect(t *testing.T) {
	db := communicationsTestDB(t)
	ctx := context.Background()
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	original := &models.SocialAccount{
		ID: "account-original", WorkspaceID: "workspace-1", Platform: "x",
		AccountID: "remote-account", AccountUsername: "openpost",
		AccessTokenEnc: []byte("old-encrypted"), IsActive: true,
		CreatedAt: now.Add(-24 * time.Hour),
	}
	replacement := *original
	replacement.ID = "account-reconnected"
	replacement.Slug = "openpost-reconnected"
	replacement.AccessTokenEnc = []byte("new-encrypted")
	replacement.IsActive = true
	replacement.CreatedAt = now
	_, err := db.NewInsert().Model(original).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().
		Model((*models.SocialAccount)(nil)).
		Set("is_active = ?", false).
		Where("id = ?", original.ID).
		Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&replacement).Exec(ctx)
	require.NoError(t, err)
	publication := &models.Publication{
		ID: "publication-1", WorkspaceID: original.WorkspaceID, CreatedByID: "user-1",
		Title: "Launch", SourceContent: "Launch", Status: models.PublicationStatusPublished,
		ActualRunAt: now.Add(-time.Hour), CreatedAt: now.Add(-2 * time.Hour), UpdatedAt: now.Add(-time.Hour),
	}
	_, err = db.NewInsert().Model(publication).Exec(ctx)
	require.NoError(t, err)
	rendition := &models.Rendition{
		ID: "rendition-1", PublicationID: publication.ID, SocialAccountID: original.ID,
		Platform: "x", Profile: "short_text", Status: models.RenditionStatusPublished,
		ExternalID: "provider-post-1", CreatedAt: now, UpdatedAt: now,
	}
	_, err = db.NewInsert().Model(rendition).Exec(ctx)
	require.NoError(t, err)

	commenter := &fakeCommenter{
		contentURL: "https://x.com/openpost/status/provider-post-1",
		comments: []platform.Comment{{
			ID: "comment-1", Text: "Hello", CreatedAt: now.Format(time.RFC3339),
		}},
	}
	service := NewService(db, staticTokenSource{}, nil)
	service.now = func() time.Time { return now }
	service.SetProvider("x", commenter)

	queued, err := service.RefreshWorkspace(ctx, original.WorkspaceID, true)
	require.NoError(t, err)
	require.Equal(t, 1, queued)
	require.NoError(t, service.syncEngagement(ctx, rendition.ID))
	require.Equal(t, []string{replacement.AccountID}, commenter.accountIDs)

	var item models.EngagementItem
	require.NoError(t, db.NewSelect().Model(&item).Where("remote_id = ?", "comment-1").Scan(ctx))
	require.Equal(t, replacement.ID, item.SocialAccountID)
	require.NoError(t, db.NewSelect().Model(rendition).WherePK().Scan(ctx))
	require.Equal(t, commenter.contentURL, rendition.ExternalURL)
}

func TestEngagementPersistenceTracksEditsDeletionAttachmentsAndLocalReadState(t *testing.T) {
	db := communicationsTestDB(t)
	ctx := context.Background()
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	account := models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "mastodon",
		AccountID: "remote-account", AccessTokenEnc: []byte("encrypted"), IsActive: true,
	}
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(&account).Exec(ctx)
		return err
	}())
	rendition := models.Rendition{ID: "rendition-1", PublicationID: "publication-1"}
	publication := models.Publication{ID: "publication-1", CreatedByID: "user-1"}
	service := NewService(db, staticTokenSource{}, nil)

	initial := platform.Comment{
		ID: "comment-1", AuthorID: "reader-1", AuthorName: "Reader",
		AuthorHandle: "@reader", AuthorAvatarURL: "https://cdn.example/avatar.png",
		Text: "First", CreatedAt: now.Format(time.RFC3339),
		CanReply: true, CanLike: true, LikeStateKnown: true,
		Attachments: []platform.CommentAttachment{
			{Type: "image", URL: "https://cdn.example/image.png", AltText: "Preview"},
			{Type: "image", URL: "http://private.example/image.png"},
		},
	}
	newItems, err := service.persistEngagementComments(ctx, rendition, account, publication, []platform.Comment{initial}, now)
	require.NoError(t, err)
	require.Len(t, newItems, 1)

	readAt := now.Add(time.Minute)
	_, err = db.NewUpdate().Model((*models.EngagementItem)(nil)).
		Set("read_at = ?", readAt).
		Where("remote_id = ?", initial.ID).
		Exec(ctx)
	require.NoError(t, err)

	edited := initial
	edited.Text = "Edited"
	edited.UpdatedAt = now.Add(2 * time.Minute).Format(time.RFC3339)
	edited.Liked = true
	edited.CanUnlike = true
	_, err = service.persistEngagementComments(ctx, rendition, account, publication, []platform.Comment{edited}, now.Add(2*time.Minute))
	require.NoError(t, err)

	var item models.EngagementItem
	require.NoError(t, db.NewSelect().Model(&item).Where("remote_id = ?", initial.ID).Scan(ctx))
	require.Equal(t, "Edited", item.Body)
	require.True(t, item.Liked)
	require.True(t, item.CanUnlike)
	require.Equal(t, readAt, item.ReadAt)
	require.False(t, item.EditedAt.IsZero())
	require.JSONEq(t, `[{"type":"image","url":"https://cdn.example/image.png","alt_text":"Preview"}]`, item.AttachmentsJSON)

	unknownLikeState := edited
	unknownLikeState.LikeStateKnown = false
	unknownLikeState.Liked = false
	unknownLikeState.CanLike = true
	unknownLikeState.CanUnlike = true
	_, err = service.persistEngagementComments(
		ctx,
		rendition,
		account,
		publication,
		[]platform.Comment{unknownLikeState},
		now.Add(3*time.Minute),
	)
	require.NoError(t, err)
	require.NoError(t, db.NewSelect().Model(&item).Where("remote_id = ?", initial.ID).Scan(ctx))
	require.True(t, item.Liked)
	require.False(t, item.CanLike)
	require.True(t, item.CanUnlike)

	edited.Deleted = true
	_, err = service.persistEngagementComments(ctx, rendition, account, publication, []platform.Comment{edited}, now.Add(4*time.Minute))
	require.NoError(t, err)
	require.NoError(t, db.NewSelect().Model(&item).Where("remote_id = ?", initial.ID).Scan(ctx))
	require.Empty(t, item.Body)
	require.JSONEq(t, `[]`, item.AttachmentsJSON)
	require.Empty(t, item.AuthorRemoteID)
	require.Empty(t, item.AuthorName)
	require.Empty(t, item.AuthorHandle)
	require.Empty(t, item.AuthorAvatarURL)
	require.False(t, item.CanReply)
	require.False(t, item.CanLike)
	require.False(t, item.DeletedAt.IsZero())
}

func TestEngagementPersistenceIgnoresRepliesFromConnectedAccount(t *testing.T) {
	db := communicationsTestDB(t)
	ctx := context.Background()
	now := time.Date(2026, 8, 11, 13, 21, 0, 0, time.UTC)
	account := models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "mastodon",
		AccountID: "remote-account", AccessTokenEnc: []byte("encrypted"), IsActive: true,
	}
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(&account).Exec(ctx)
		return err
	}())
	publication := models.Publication{
		ID: "publication-1", WorkspaceID: account.WorkspaceID, CreatedByID: "user-1",
		Title: "VPN ad differences", SourceText: "The difference in ads is insane.",
		Status: models.PublicationStatusPublished, CreatedAt: now, UpdatedAt: now,
	}
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(&publication).Exec(ctx)
		return err
	}())
	rendition := models.Rendition{
		ID: "rendition-1", PublicationID: publication.ID, SocialAccountID: account.ID,
		Platform: account.Platform, Status: models.RenditionStatusPublished,
		ExternalID: "status-1", CreatedAt: now, UpdatedAt: now,
	}
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(&rendition).Exec(ctx)
		return err
	}())
	_, err := db.NewInsert().Model(&models.EngagementItem{
		ID: "previously-stored-own-reply", WorkspaceID: account.WorkspaceID, RenditionID: rendition.ID,
		SocialAccountID: account.ID, Platform: account.Platform, RemoteID: "reply-by-connected-account",
		AuthorRemoteID: account.AccountID, Body: "Previously stored own reply", IsOurs: true,
		LastSeenAt: now, CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	service := NewService(db, staticTokenSource{}, nil)

	newItems, err := service.persistEngagementComments(
		ctx,
		rendition,
		account,
		publication,
		[]platform.Comment{
			{
				ID: "reply-by-connected-account", AuthorID: account.AccountID,
				AuthorName: "Rodrigo Dias", AuthorHandle: "@rgo",
				Text: "@PJFDF Yeah haha", CreatedAt: now.Format(time.RFC3339), IsOurs: true,
			},
			{
				ID: "reply-by-someone-else", AuthorID: "remote-reader",
				AuthorName: "A reader", AuthorHandle: "@reader",
				Text: "Same here", CreatedAt: now.Add(time.Minute).Format(time.RFC3339),
			},
		},
		now,
	)
	require.NoError(t, err)
	require.Len(t, newItems, 1)
	require.Equal(t, "reply-by-someone-else", newItems[0].RemoteID)

	count, err := db.NewSelect().Model((*models.EngagementItem)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count, "replies from the connected account must not be stored as engagement")

	_, err = db.NewInsert().Model(&models.EngagementItem{
		ID: "legacy-own-reply", WorkspaceID: account.WorkspaceID, RenditionID: rendition.ID,
		SocialAccountID: account.ID, Platform: account.Platform, RemoteID: "legacy-own-reply",
		AuthorRemoteID: account.AccountID, Body: "An own reply stored before the fix", IsOurs: true,
		LastSeenAt: now, CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)

	page, err := service.ListEngagement(ctx, EngagementQuery{WorkspaceID: account.WorkspaceID, Limit: 50})
	require.NoError(t, err)
	require.Equal(t, 1, page.Total, "previously stored own replies must be hidden from Engagement")
	require.Len(t, page.Items, 1)
	require.Equal(t, "reply-by-someone-else", page.Items[0].RemoteID)
}

func TestEngagementReactionUpdatesAvailableInverseAction(t *testing.T) {
	db := communicationsTestDB(t)
	ctx := context.Background()
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	item := &models.EngagementItem{
		ID: "item-1", WorkspaceID: "workspace-1", RenditionID: "rendition-1",
		SocialAccountID: "account-1", Platform: "x", RemoteID: "comment-1",
		CanLike: true, LastSeenAt: now, CreatedAt: now, UpdatedAt: now,
	}
	_, err := db.NewInsert().Model(item).Exec(ctx)
	require.NoError(t, err)
	commenter := &fakeCommenter{}
	service := NewService(db, staticTokenSource{}, nil)
	service.now = func() time.Time { return now.Add(time.Minute) }

	require.NoError(t, service.executeEngagementAction(
		ctx,
		commenter,
		"token",
		models.SocialAccount{ID: "account-1", WorkspaceID: "workspace-1", Platform: "x", AccountID: "remote-account"},
		item,
		engagementActionJob{ItemID: item.ID, Action: "like", UserID: "user-1"},
	))
	require.Equal(t, []string{"comment-1"}, commenter.likedIDs)

	var stored models.EngagementItem
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", item.ID).Scan(ctx))
	require.True(t, stored.Liked)
	require.False(t, stored.CanLike)
	require.True(t, stored.CanUnlike)
	require.NoError(t, service.QueueEngagementAction(ctx, stored.ID, "unlike", "", "user-1"))
}

func TestListEngagementCursorReachesEveryRecordWithoutGapsOrDuplicates(t *testing.T) {
	db := communicationsTestDB(t)
	ctx := t.Context()
	createdAt := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	items := make([]models.EngagementItem, 0, 235)
	for index := range 235 {
		items = append(items, models.EngagementItem{
			ID: fmt.Sprintf("engagement-%03d", index), WorkspaceID: "workspace-1",
			RenditionID: "rendition-1", SocialAccountID: "account-1", Platform: "x",
			RemoteID: fmt.Sprintf("remote-%03d", index), Body: "Reply", LastSeenAt: createdAt,
			RemoteCreatedAt: createdAt, CreatedAt: createdAt, UpdatedAt: createdAt,
		})
	}
	_, err := db.NewInsert().Model(&items).Exec(ctx)
	require.NoError(t, err)
	service := NewService(db, staticTokenSource{}, nil)

	seen := make([]string, 0, len(items))
	var cursor *EngagementCursor
	for {
		page, err := service.ListEngagement(ctx, EngagementQuery{
			WorkspaceID: "workspace-1", Limit: 37, Cursor: cursor,
		})
		require.NoError(t, err)
		for _, item := range page.Items {
			seen = append(seen, item.ID)
		}
		if cursor == nil {
			_, err = db.NewInsert().Model(&models.EngagementItem{
				ID: "engagement-new", WorkspaceID: "workspace-1", RenditionID: "rendition-1",
				SocialAccountID: "account-1", Platform: "x", RemoteID: "remote-new", Body: "New reply",
				LastSeenAt: createdAt.Add(time.Hour), RemoteCreatedAt: createdAt.Add(time.Hour),
				CreatedAt: createdAt.Add(time.Hour), UpdatedAt: createdAt.Add(time.Hour),
			}).Exec(ctx)
			require.NoError(t, err)
		}
		cursor = page.NextCursor
		if cursor == nil {
			break
		}
	}

	require.Len(t, seen, 235)
	require.Equal(t, len(seen), len(uniqueStrings(seen)))
	require.NotContains(t, seen, "engagement-new")
	for index, id := range seen {
		require.Equal(t, fmt.Sprintf("engagement-%03d", 234-index), id)
	}
}

func uniqueStrings(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}
