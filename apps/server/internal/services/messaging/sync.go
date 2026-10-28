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
	"github.com/openpost/backend/internal/services/inboxchanges"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/organizationguard"
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

func (s *Service) syncMessages(ctx context.Context, accountID string) (resultErr error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id = ? AND is_active = ?", accountID, true).Scan(ctx); err != nil {
		return err
	}
	owner, acquired, err := s.acquireCollection(ctx, account.ID)
	if err != nil {
		return err
	}
	if !acquired {
		return nil
	}
	defer func() {
		delay := s.collectionCadence(context.WithoutCancel(ctx), account, 15*time.Minute)
		if resultErr != nil {
			delay = providerRetryDelay(resultErr, time.Minute)
		}
		finalCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		defer cancel()
		s.finishCollection(finalCtx, account.ID, owner, delay, resultErr != nil)
	}()
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
	token, err := s.messagingToken(ctx, account)
	if err != nil {
		return errors.Join(err, s.states.record(ctx, syncStateUpdate{
			account: account, status: syncStateFailed,
			failure: syncStateFailure{code: "authentication", message: "Reconnect this account to resume messages."},
			cursor:  progress.cursor, backfillComplete: progress.backfillComplete,
			cadence: providerRetryDelay(err, time.Hour), emptyStreak: progress.emptyStreak, attemptedAt: s.now(),
		}))
	}
	if incremental, ok := provider.(platform.IncrementalMessagingAdapter); ok {
		if err := s.syncIncremental(ctx, account, provider, incremental, token); err != nil {
			_ = s.states.record(ctx, syncStateUpdate{account: account, status: syncStateFailed, failure: syncStateFailure{code: "provider_error", message: "Could not refresh messages. OpenPost will try again."}, cursor: progress.cursor, backfillComplete: progress.backfillComplete, cadence: providerRetryDelay(err, time.Minute), attemptedAt: s.now()})
			return err
		}
		return s.states.record(ctx, syncStateUpdate{account: account, status: syncStateOK, cursor: progress.cursor, backfillComplete: true, cadence: s.collectionCadence(ctx, account, 15*time.Minute), attemptedAt: s.now()})
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
		backfillComplete: collected.backfillComplete, cadence: s.collectionCadence(ctx, account, messageCadence(progress.emptyStreak)),
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
		return collectedMessages{}, errors.Join(err, s.states.record(ctx, syncStateUpdate{
			account: account, status: syncStateFailed,
			failure: syncStateFailure{code: "provider_error", message: "OpenPost could not collect messages from this provider."},
			cursor:  progress.cursor, backfillComplete: progress.backfillComplete,
			cadence: providerRetryDelay(err, time.Hour), emptyStreak: progress.emptyStreak, attemptedAt: s.now(),
		}))
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
		return collectedMessages{}, errors.Join(err, s.states.record(ctx, syncStateUpdate{
			account: account, status: syncStateFailed,
			failure: syncStateFailure{code: "backfill_failed", message: "Current messages were collected, but OpenPost could not collect older message history."},
			cursor:  progress.cursor, cadence: providerRetryDelay(err, time.Hour), emptyStreak: progress.emptyStreak, attemptedAt: s.now(),
		}))
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
	var received []receivedMessage
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(txCtx, tx, account.WorkspaceID); err != nil {
			return err
		}
		var err error
		received, err = s.persistConversationsWithDB(txCtx, tx, account, fetched)
		return err
	})
	return received, err
}

func (s *Service) persistConversationsWithDB(ctx context.Context, tx bun.IDB, account models.SocialAccount, fetched []platform.ProviderConversation) ([]receivedMessage, error) {
	now := s.now()
	received := []receivedMessage{}
	changes := []inboxchanges.Change{}
	for _, remote := range fetched {
		if remote.ID == "" {
			continue
		}
		remote, eligible, err := prepareProviderConversation(ctx, tx, account, remote)
		if err != nil {
			return nil, err
		}
		if !eligible {
			continue
		}
		newReceived, newChanges, err := s.persistConversationWithDB(ctx, tx, account, remote, now)
		if err != nil {
			return nil, err
		}
		received = append(received, newReceived...)
		changes = append(changes, newChanges...)
	}
	return received, inboxchanges.Append(ctx, tx, account.WorkspaceID, changes...)
}

func (s *Service) persistConversationWithDB(ctx context.Context, tx bun.IDB, account models.SocialAccount, remote platform.ProviderConversation, now time.Time) ([]receivedMessage, []inboxchanges.Change, error) {
	received := []receivedMessage{}
	changes := []inboxchanges.Change{}
	state, err := upsertConversation(ctx, tx, account, remote, now)
	conversationID, unreadCount, changed := state.id, state.unread, state.changed
	if err != nil {
		return nil, nil, err
	}
	newInbound := 0
	for _, rm := range remote.Messages {
		inserted, err := insertProviderMessage(ctx, tx, account, conversationID, rm, now)
		if err != nil {
			return nil, nil, err
		}
		if inserted {
			changed = true
			var localID string
			if err = tx.NewSelect().Model((*models.DirectMessage)(nil)).Column("id").Where("conversation_id=? AND remote_message_id=?", conversationID, rm.ID).Scan(ctx, &localID); err != nil {
				return nil, nil, err
			}
			changes = append(changes, inboxchanges.Change{Kind: "message", ConversationID: conversationID, MessageID: localID})
			if rm.Direction == "inbound" {
				newInbound++
				received = append(received, receivedMessage{conversationID: conversationID, messageID: rm.ID, senderName: firstNonEmpty(remote.CounterpartName, remote.CounterpartHandle, "a social account"), provider: account.Platform})
			}
		}
	}
	if newInbound > 0 && (!state.created || !remote.UnreadCountKnown) {
		if _, err = tx.NewUpdate().Model((*models.Conversation)(nil)).Set("unread_count=?", unreadCount+newInbound).Set("read_at=NULL").Set("archived_at=NULL").Where("id=?", conversationID).Exec(ctx); err != nil {
			return nil, nil, err
		}
	}
	if changed {
		changes = append(changes, inboxchanges.Change{Kind: "conversation", ConversationID: conversationID})
	}
	return received, changes, nil
}

type conversationUpsert struct {
	id      string
	unread  int
	changed bool
	created bool
}

func upsertConversation(ctx context.Context, db bun.IDB, account models.SocialAccount, remote platform.ProviderConversation, now time.Time) (conversationUpsert, error) {
	var existing models.Conversation
	err := db.NewSelect().Model(&existing).
		Where("social_account_id = ? AND remote_conversation_id = ?", account.ID, remote.ID).Scan(ctx)
	conversationID := existing.ID
	if errors.Is(err, sql.ErrNoRows) {
		conversationID = uuid.NewString()
	} else if err != nil {
		return conversationUpsert{}, err
	}
	// Older history and sparse events must not erase a newer chat summary.
	remote.CounterpartRemoteID = firstNonEmpty(remote.CounterpartRemoteID, existing.CounterpartRemoteID)
	remote.CounterpartName = firstNonEmpty(remote.CounterpartName, existing.CounterpartName)
	remote.CounterpartHandle = firstNonEmpty(remote.CounterpartHandle, existing.CounterpartHandle)
	remote.CounterpartAvatarURL = firstNonEmpty(remote.CounterpartAvatarURL, existing.CounterpartAvatarURL)
	if remote.LastMessageAt.Before(existing.LastMessageAt) || remote.LastMessageAt.IsZero() {
		remote.LastMessageAt = existing.LastMessageAt
		remote.LastMessagePreview = existing.LastMessagePreview
		remote.LastRemoteMessageID = existing.LastRemoteMessageID
	}
	if remote.ReplyWindowExpiresAt.Before(existing.MessagingWindowExpiresAt) || remote.ReplyWindowExpiresAt.IsZero() {
		remote.ReplyWindowExpiresAt = existing.MessagingWindowExpiresAt
	}
	changed := conversationSummaryChanged(existing, remote)
	if !changed {
		return conversationUpsert{id: conversationID, unread: existing.UnreadCount}, nil
	}
	if existing.ID == "" && remote.UnreadCountKnown {
		existing.UnreadCount = max(0, remote.UnreadCount)
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
	return conversationUpsert{id: conversationID, unread: existing.UnreadCount, changed: changed, created: existing.ID == ""}, err
}

func conversationSummaryChanged(existing models.Conversation, remote platform.ProviderConversation) bool {
	return existing.ID == "" ||
		existing.CounterpartRemoteID != remote.CounterpartRemoteID ||
		existing.CounterpartName != remote.CounterpartName ||
		existing.CounterpartHandle != remote.CounterpartHandle ||
		existing.CounterpartAvatarURL != remote.CounterpartAvatarURL ||
		!existing.LastMessageAt.Equal(remote.LastMessageAt) ||
		existing.LastMessagePreview != remote.LastMessagePreview ||
		existing.LastRemoteMessageID != remote.LastRemoteMessageID ||
		!existing.MessagingWindowExpiresAt.Equal(remote.ReplyWindowExpiresAt)
}

func insertProviderMessage(ctx context.Context, db bun.IDB, account models.SocialAccount, conversationID string, remote platform.ProviderMessage, now time.Time) (bool, error) {
	if remote.ID == "" {
		return false, nil
	}
	var remoteConversationID string
	if err := db.NewSelect().Model((*models.Conversation)(nil)).Column("remote_conversation_id").Where("id=? AND social_account_id=?", conversationID, account.ID).Scan(ctx, &remoteConversationID); err != nil {
		return false, err
	}
	suppressed, err := providerMessageSuppressed(ctx, db, account.ID, remoteConversationID, remote.ID, remote.RemoteCreatedAt)
	if err != nil || suppressed {
		return false, err
	}
	stored, exists, err := findStoredMessage(ctx, db, conversationID, remote.ID)
	if err != nil {
		return false, err
	}
	attachments, _ := json.Marshal(remote.Attachments)
	if exists {
		// An adapter that could not read a provider field stored the message
		// without content. Fill it once the provider describes it.
		return false, repairProviderMessage(ctx, db, stored, remote, string(attachments), now)
	}
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
	if err != nil {
		return false, err
	}
	// Only seed a snapshot on first insertion. History fetched before a live
	// reaction removal must not resurrect it after that removal commits.
	if rows == 1 && remote.ReactionsKnown {
		for _, reaction := range remote.Reactions {
			if reaction.Deleted {
				continue
			}
			if _, err = db.NewRaw(`INSERT INTO message_reactions(message_id,actor_remote_id,value) VALUES(?,?,?) ON CONFLICT DO NOTHING`, message.ID, reaction.ActorRemoteID, reaction.Value).Exec(ctx); err != nil {
				return false, err
			}
		}
	}
	return rows == 1, nil
}

// findStoredMessage returns the locally stored copy of a provider message.
func findStoredMessage(ctx context.Context, db bun.IDB, conversationID, remoteID string) (models.DirectMessage, bool, error) {
	var stored models.DirectMessage
	err := db.NewSelect().Model(&stored).
		Column("id", "body", "attachments_json", "deleted_at", "remote_created_at").
		Where("conversation_id = ? AND remote_message_id = ?", conversationID, remoteID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return models.DirectMessage{}, false, nil
	}
	if err != nil {
		return models.DirectMessage{}, false, err
	}
	return stored, true, nil
}

// repairProviderMessage fills a stored message that the provider now describes
// with content or a time it did not return when the message was first
// collected. Only blank or untimed, not deleted rows change, so tombstones and
// authored sends are never rewritten and a repair does not notify.
func repairProviderMessage(ctx context.Context, db bun.IDB, stored models.DirectMessage, remote platform.ProviderMessage, attachments string, now time.Time) error {
	if !stored.DeletedAt.IsZero() {
		return nil
	}
	restoreContent := storedMessageBlank(stored) && providerMessageHasContent(remote)
	restoreTime := stored.RemoteCreatedAt.IsZero() && !remote.RemoteCreatedAt.IsZero()
	if !restoreContent && !restoreTime {
		return nil
	}
	update := db.NewUpdate().Model((*models.DirectMessage)(nil)).
		Set("updated_at = ?", now).
		Where("id = ? AND deleted_at IS NULL", stored.ID)
	if restoreContent {
		update = update.Set("body = ?", remote.Body).
			Set("attachments_json = ?", attachments).
			Where("body = '' AND attachments_json IN ('', '[]', 'null')")
	}
	if restoreTime {
		update = update.Set("remote_created_at = ?", remote.RemoteCreatedAt)
	}
	_, err := update.Exec(ctx)
	return err
}

func storedMessageBlank(message models.DirectMessage) bool {
	if strings.TrimSpace(message.Body) != "" {
		return false
	}
	switch strings.TrimSpace(message.AttachmentsJSON) {
	case "", "[]", "null":
		return true
	}
	return false
}

func providerMessageHasContent(message platform.ProviderMessage) bool {
	return strings.TrimSpace(message.Body) != "" || len(message.Attachments) > 0
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
