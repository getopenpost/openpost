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
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type staticTokenSource struct{}

func (staticTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	return "access-token", nil
}

type fakeMessenger struct {
	platform.Adapter
	fetches  int
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
	return platform.SendMessageResult{RemoteMessageID: "sent-1", CreatedAt: time.Now().UTC()}, nil
}

func communicationsTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	for _, model := range []any{(*models.SocialAccount)(nil), (*models.Job)(nil)} {
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
