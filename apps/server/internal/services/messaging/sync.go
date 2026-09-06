package messaging

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/uptrace/bun"
)

type receivedMessage struct {
	conversationID string
	messageID      string
	senderName     string
	provider       string
}

type messageSyncProgress struct {
	cursor           string
	backfillComplete bool
	emptyStreak      int
}

type collectedMessages struct {
	received         []receivedMessage
	fetchedCount     int
	nextCursor       string
	backfillComplete bool
}

func (s *Service) syncMessages(ctx context.Context, accountID string) error {
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id = ? AND is_active = ?", accountID, true).Scan(ctx); err != nil {
		return err
	}
	if !s.isMessagingEnabled(ctx, account.ID) {
		return s.states.record(ctx, syncStateUpdate{
			account: account, status: syncStateDisabled,
			failure:     syncStateFailure{code: "feature_disabled", message: "Messaging is disabled for this account."},
			attemptedAt: s.now(),
		})
	}
	provider, err := s.syncProvider(ctx, account)
	if err != nil || provider == nil {
		return err
	}
	state, err := s.states.load(ctx, account.ID)
	if err != nil {
		return err
	}
	progress := syncProgress(state)
	if s.tokens == nil {
		return errors.New("messaging token source is unavailable")
	}
	token, err := s.tokens.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		return s.states.record(ctx, syncStateUpdate{
			account: account, status: syncStateFailed,
			failure: syncStateFailure{code: "authentication", message: "Reconnect this account to resume messages."},
			cursor:  progress.cursor, backfillComplete: progress.backfillComplete,
			cadence: time.Hour, emptyStreak: progress.emptyStreak, attemptedAt: s.now(),
		})
	}
	collected, err := s.collectMessages(ctx, account, provider, token, progress)
	if err != nil {
		return err
	}
	s.notifyReceivedMessages(ctx, account, collected.received)
	if collected.fetchedCount == 0 {
		progress.emptyStreak++
	} else {
		progress.emptyStreak = 0
	}
	return s.states.record(ctx, syncStateUpdate{
		account: account, status: syncStateOK, cursor: collected.nextCursor,
		backfillComplete: collected.backfillComplete, cadence: messageCadence(progress.emptyStreak),
		emptyStreak: progress.emptyStreak, attemptedAt: s.now(),
	})
}

func (s *Service) syncProvider(ctx context.Context, account models.SocialAccount) (Provider, error) {
	provider := s.provider(account)
	if provider == nil || !provider.MessagingSupport().Enabled {
		return nil, s.states.record(ctx, syncStateUpdate{
			account: account, status: syncStateUnsupported,
			failure:     syncStateFailure{code: "unsupported", message: "Messages are not supported for this provider."},
			attemptedAt: s.now(),
		})
	}
	if provider.MessagingSupport().RequiresOptIn && !accountMessagesEnabled(account) {
		return nil, s.states.record(ctx, syncStateUpdate{
			account: account, status: syncStateDisabled,
			failure:     syncStateFailure{code: "opt_in_required", message: "Enable inbox sync for this account to collect messages."},
			attemptedAt: s.now(),
		})
	}
	return provider, nil
}

func syncProgress(state *models.MessagingSyncState) messageSyncProgress {
	if state == nil {
		return messageSyncProgress{}
	}
	return messageSyncProgress{cursor: state.Cursor, backfillComplete: state.BackfillComplete, emptyStreak: state.EmptyStreak}
}

func (s *Service) collectMessages(ctx context.Context, account models.SocialAccount, provider Provider, token string, progress messageSyncProgress) (collectedMessages, error) {
	result, err := provider.FetchMessages(ctx, token, platform.FetchMessagesRequest{AccountID: account.AccountID, Limit: 100})
	if err != nil {
		return collectedMessages{}, s.states.record(ctx, syncStateUpdate{
			account: account, status: syncStateFailed,
			failure: syncStateFailure{code: "provider_error", message: "OpenPost could not collect messages from this provider."},
			cursor:  progress.cursor, backfillComplete: progress.backfillComplete,
			cadence: time.Hour, emptyStreak: progress.emptyStreak, attemptedAt: s.now(),
		})
	}
	received, err := s.persistConversations(ctx, account, result.Conversations)
	if err != nil {
		return collectedMessages{}, err
	}
	collected := collectedMessages{
		received: received, fetchedCount: len(result.Conversations),
		nextCursor: progress.cursor, backfillComplete: progress.backfillComplete,
	}
	if progress.backfillComplete {
		return collected, nil
	}
	if progress.cursor == "" {
		collected.nextCursor = result.NextCursor
		collected.backfillComplete = result.NextCursor == ""
		return collected, nil
	}
	older, err := provider.FetchMessages(ctx, token, platform.FetchMessagesRequest{AccountID: account.AccountID, Cursor: progress.cursor, Limit: 100})
	if err != nil {
		return collectedMessages{}, s.states.record(ctx, syncStateUpdate{
			account: account, status: syncStateFailed,
			failure: syncStateFailure{code: "backfill_failed", message: "Current messages were collected, but OpenPost could not collect older message history."},
			cursor:  progress.cursor, cadence: time.Hour, emptyStreak: progress.emptyStreak, attemptedAt: s.now(),
		})
	}
	olderReceived, err := s.persistConversations(ctx, account, older.Conversations)
	if err != nil {
		return collectedMessages{}, err
	}
	collected.received = append(collected.received, olderReceived...)
	collected.fetchedCount += len(older.Conversations)
	collected.nextCursor = older.NextCursor
	collected.backfillComplete = older.NextCursor == ""
	return collected, nil
}

func (s *Service) persistConversations(ctx context.Context, account models.SocialAccount, fetched []platform.ProviderConversation) ([]receivedMessage, error) {
	now := s.now()
	received := make([]receivedMessage, 0)
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		for _, remote := range fetched {
			if remote.ID == "" {
				continue
			}
			conversationID, unreadCount, err := upsertConversation(txCtx, tx, account, remote, now)
			if err != nil {
				return err
			}
			newInbound := 0
			for _, remoteMessage := range remote.Messages {
				inserted, err := insertProviderMessage(txCtx, tx, account, conversationID, remoteMessage, now)
				if err != nil {
					return err
				}
				if inserted && remoteMessage.Direction == "inbound" {
					newInbound++
					received = append(received, receivedMessage{
						conversationID: conversationID, messageID: remoteMessage.ID,
						senderName: firstNonEmpty(remote.CounterpartName, remote.CounterpartHandle, "a social account"),
						provider:   account.Platform,
					})
				}
			}
			if newInbound > 0 {
				_, err = tx.NewUpdate().Model((*models.Conversation)(nil)).
					Set("unread_count = ?", unreadCount+newInbound).Set("read_at = NULL").
					Where("id = ?", conversationID).Exec(txCtx)
				if err != nil {
					return err
				}
			}
		}
		return nil
	})
	return received, err
}

func upsertConversation(ctx context.Context, db bun.IDB, account models.SocialAccount, remote platform.ProviderConversation, now time.Time) (string, int, error) {
	var existing models.Conversation
	err := db.NewSelect().Model(&existing).
		Where("social_account_id = ? AND remote_conversation_id = ?", account.ID, remote.ID).Scan(ctx)
	conversationID := existing.ID
	if errors.Is(err, sql.ErrNoRows) {
		conversationID = uuid.NewString()
	} else if err != nil {
		return "", 0, err
	}
	conversation := &models.Conversation{
		ID: conversationID, WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID,
		Platform: account.Platform, RemoteConversationID: remote.ID,
		CounterpartRemoteID: remote.CounterpartRemoteID, CounterpartName: remote.CounterpartName,
		CounterpartHandle: remote.CounterpartHandle, CounterpartAvatarURL: remote.CounterpartAvatarURL,
		LastMessageAt: remote.LastMessageAt, LastMessagePreview: remote.LastMessagePreview,
		LastRemoteMessageID: remote.LastRemoteMessageID, UnreadCount: existing.UnreadCount,
		MessagingWindowExpiresAt: remote.ReplyWindowExpiresAt, CreatedAt: now, UpdatedAt: now,
	}
	_, err = db.NewInsert().Model(conversation).On("CONFLICT (social_account_id, remote_conversation_id) DO UPDATE").
		Set("counterpart_remote_id = EXCLUDED.counterpart_remote_id").Set("counterpart_name = EXCLUDED.counterpart_name").
		Set("counterpart_handle = EXCLUDED.counterpart_handle").Set("counterpart_avatar_url = EXCLUDED.counterpart_avatar_url").
		Set("last_message_at = EXCLUDED.last_message_at").Set("last_message_preview = EXCLUDED.last_message_preview").
		Set("last_remote_message_id = EXCLUDED.last_remote_message_id").
		Set("messaging_window_expires_at = EXCLUDED.messaging_window_expires_at").Set("updated_at = EXCLUDED.updated_at").Exec(ctx)
	return conversationID, existing.UnreadCount, err
}

func insertProviderMessage(ctx context.Context, db bun.IDB, account models.SocialAccount, conversationID string, remote platform.ProviderMessage, now time.Time) (bool, error) {
	if remote.ID == "" {
		return false, nil
	}
	exists, err := db.NewSelect().Model((*models.DirectMessage)(nil)).
		Where("conversation_id = ? AND remote_message_id = ?", conversationID, remote.ID).Exists(ctx)
	if err != nil || exists {
		return false, err
	}
	attachments, _ := json.Marshal(remote.Attachments)
	status := "received"
	if remote.Direction == "outbound" {
		status = "sent"
	}
	message := &models.DirectMessage{
		ID: uuid.NewString(), WorkspaceID: account.WorkspaceID, ConversationID: conversationID,
		RemoteMessageID: remote.ID, Direction: remote.Direction, AuthorRemoteID: remote.AuthorRemoteID,
		Body: remote.Body, AttachmentsJSON: string(attachments), SendStatus: status,
		RemoteCreatedAt: remote.RemoteCreatedAt, CreatedAt: now, UpdatedAt: now,
	}
	result, err := db.NewInsert().Model(message).On("CONFLICT DO NOTHING").Exec(ctx)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func (s *Service) notifyReceivedMessages(ctx context.Context, account models.SocialAccount, received []receivedMessage) {
	if s.notifications == nil {
		return
	}
	for _, message := range received {
		for _, userID := range s.workspaceMemberIDs(ctx, account.WorkspaceID) {
			outcome, err := notifications.NewMessageReceivedOutcome(notifications.MessageReceivedFacts{
				RecipientUserID: userID, WorkspaceID: account.WorkspaceID,
				ConversationID: message.conversationID, MessageID: message.messageID,
				Provider: message.provider, SenderName: message.senderName,
			})
			if err == nil {
				_ = s.notifications.Record(ctx, outcome)
			}
		}
	}
}

func (s *Service) workspaceMemberIDs(ctx context.Context, workspaceID string) []string {
	var ids []string
	_ = s.db.NewSelect().Model((*models.WorkspaceMember)(nil)).Column("user_id").
		Where("workspace_id = ? AND status = ?", workspaceID, models.WorkspaceMemberStatusActive).Scan(ctx, &ids)
	return ids
}

func messageCadence(emptyStreak int) time.Duration {
	switch {
	case emptyStreak >= 12:
		return 6 * time.Hour
	case emptyStreak >= 4:
		return time.Hour
	default:
		return 15 * time.Minute
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
