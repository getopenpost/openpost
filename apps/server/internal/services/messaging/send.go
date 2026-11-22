package messaging

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/openpost/backend/internal/textutil"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/inboxchanges"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

func (s *Service) QueueMessage(ctx context.Context, actor Actor, conversationID, body string, operationIDs ...string) (*models.DirectMessage, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, fmt.Errorf("message is required")
	}
	var conversation models.Conversation
	if err := s.db.NewSelect().Model(&conversation).Where("id = ?", strings.TrimSpace(conversationID)).Scan(ctx); errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	if err := s.authorize(ctx, conversation.WorkspaceID, actor, workspaceaccess.LevelEdit); err != nil {
		return nil, err
	}
	var message *models.DirectMessage
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var err error
		message, err = s.queueMessageReceipt(txCtx, tx, actor, conversation, body, operationIDs)
		return err
	})
	if err != nil {
		return nil, err
	}
	return message, nil
}

func (s *Service) queueMessageReceipt(ctx context.Context, tx bun.Tx, actor Actor, conversation models.Conversation, body string, operationIDs []string) (*models.DirectMessage, error) {
	var message *models.DirectMessage
	if err := organizationguard.LockWorkspace(ctx, tx, conversation.WorkspaceID); err != nil {
		return nil, err
	}
	decision, err := workspaceaccess.NewAuthorizer(tx).Authorize(ctx, conversation.WorkspaceID, actor, workspaceaccess.LevelEdit)
	if err != nil {
		return nil, err
	}
	if !decision.Allowed {
		return nil, ErrAccessDenied
	}
	operationID := ""
	if len(operationIDs) > 0 {
		operationID = strings.TrimSpace(operationIDs[0])
	}
	if len(operationID) > 128 {
		return nil, fmt.Errorf("client operation ID is too long")
	}
	digest := sha256.Sum256([]byte(body))
	bodyHash := hex.EncodeToString(digest[:])
	if operationID != "" {
		var stored struct {
			BodyHash  string
			MessageID string
		}
		err = tx.NewRaw(`SELECT body_hash, message_id FROM message_operations WHERE workspace_id=? AND user_id=? AND conversation_id=? AND operation_id=?`, conversation.WorkspaceID, actor.UserID, conversation.ID, operationID).Scan(ctx, &stored)
		if err == nil {
			if stored.BodyHash != bodyHash {
				return nil, ErrOperationConflict
			}
			message = &models.DirectMessage{}
			return message, tx.NewSelect().Model(message).Where("id=? AND workspace_id=?", stored.MessageID, conversation.WorkspaceID).Scan(ctx)
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}
	message, err = s.queueMessageWithDB(ctx, tx, conversation.ID, body)
	if err != nil {
		return nil, err
	}
	if operationID != "" {
		if _, err = tx.NewRaw(`INSERT INTO message_operations(workspace_id,user_id,conversation_id,operation_id,body_hash,message_id) VALUES(?,?,?,?,?,?)`, conversation.WorkspaceID, actor.UserID, conversation.ID, operationID, bodyHash, message.ID).Exec(ctx); err != nil {
			return nil, err
		}
		message.ClientOperationID = operationID
		_, err = tx.NewUpdate().Model(message).Set("client_operation_id=?", operationID).WherePK().Exec(ctx)
	}
	return message, err
}

func (s *Service) queueMessageWithDB(ctx context.Context, db bun.IDB, conversationID, body string) (*models.DirectMessage, error) {
	var conversation models.Conversation
	if err := db.NewSelect().Model(&conversation).Where("id = ?", conversationID).Scan(ctx); errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	var account models.SocialAccount
	if err := db.NewSelect().Model(&account).
		Where("id = ? AND workspace_id = ? AND is_active = ?", conversation.SocialAccountID, conversation.WorkspaceID, true).
		Scan(ctx); errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	if !s.isMessagingEnabledWithDB(ctx, db, account.ID) {
		return nil, fmt.Errorf("messaging is disabled for this account")
	}
	provider := s.provider(account)
	if provider == nil || !provider.MessagingSupport().CanSend {
		return nil, fmt.Errorf("sending messages is unsupported for this provider")
	}
	if !conversation.MessagingWindowExpiresAt.IsZero() && !conversation.MessagingWindowExpiresAt.After(s.now()) {
		return nil, fmt.Errorf("the provider reply window has closed")
	}
	now := s.now()
	message := &models.DirectMessage{
		ID: uuid.NewString(), WorkspaceID: conversation.WorkspaceID, ConversationID: conversation.ID,
		Direction: "outbound", Body: body, AttachmentsJSON: "[]", SendStatus: "queued",
		CreatedAt: now, UpdatedAt: now,
		// Snapshot the fenced reply anchor before new activity or retries.
		ReplyToRemoteID: messageReplyTarget(account.Platform, conversation.LastRemoteMessageID),
	}
	payload, _ := json.Marshal(subjectJob{ID: message.ID})
	job, err := jobregistry.NewJob(JobTypeMessageSend, string(payload), now)
	if err != nil {
		return nil, err
	}
	job.ScopeID = conversation.WorkspaceID
	if _, err := db.NewInsert().Model(message).Exec(ctx); err != nil {
		return nil, err
	}
	if _, err := db.NewInsert().Model(job).Exec(ctx); err != nil {
		return nil, err
	}
	_, err = db.NewUpdate().Model((*models.Conversation)(nil)).
		Set("last_message_at = ?", now).Set("last_message_preview = ?", body).Set("updated_at = ?", now).
		Where("id = ? AND workspace_id = ?", conversation.ID, conversation.WorkspaceID).Exec(ctx)
	if err != nil {
		return nil, err
	}
	if err = inboxchanges.Append(ctx, db, conversation.WorkspaceID, inboxchanges.Change{Kind: "message", ConversationID: conversation.ID, MessageID: message.ID}); err != nil {
		return nil, err
	}
	return message, nil
}

func messageReplyTarget(provider, lastRemoteMessageID string) string {
	if provider == "mastodon" {
		return lastRemoteMessageID
	}
	return ""
}

func (s *Service) sendMessage(ctx context.Context, messageID string) error {
	var message models.DirectMessage
	if err := s.db.NewSelect().Model(&message).Where("id = ?", messageID).Scan(ctx); err != nil {
		return err
	}
	if message.SendStatus == "sent" {
		return nil
	}
	var conversation models.Conversation
	if err := s.db.NewSelect().Model(&conversation).
		Where("id = ? AND workspace_id = ?", message.ConversationID, message.WorkspaceID).Scan(ctx); err != nil {
		return err
	}
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).
		Where("id = ? AND workspace_id = ? AND is_active = ?", conversation.SocialAccountID, conversation.WorkspaceID, true).Scan(ctx); err != nil {
		s.recordSendFailure(ctx, message, conversation, account, err)
		return err
	}
	if !s.isMessagingEnabled(ctx, account.ID) {
		s.recordSendFailure(ctx, message, conversation, account, fmt.Errorf("messaging is disabled for this account"))
		return fmt.Errorf("messaging is disabled for this account")
	}
	provider := s.provider(account)
	if provider == nil || !provider.MessagingSupport().CanSend {
		sendErr := fmt.Errorf("sending messages is unsupported for this provider")
		s.recordSendFailure(ctx, message, conversation, account, sendErr)
		return sendErr
	}
	token, err := s.messagingToken(ctx, account)
	if err != nil {
		s.recordSendFailure(ctx, message, conversation, account, err)
		return err
	}
	if !conversation.MessagingWindowExpiresAt.IsZero() && !conversation.MessagingWindowExpiresAt.After(s.now()) {
		sendErr := errors.New("the provider reply window has closed")
		s.recordSendFailure(ctx, message, conversation, account, sendErr)
		return sendErr
	}
	writeResult, err := s.sendMessageThroughFence(ctx, message, conversation, account, provider, token)
	if err != nil {
		s.recordSendFailure(ctx, message, conversation, account, err)
		return err
	}
	return s.acceptSentMessage(ctx, message, conversation, writeResult.ExternalID)
}

func (s *Service) acceptSentMessage(ctx context.Context, message models.DirectMessage, conversation models.Conversation, remoteID string) error {
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		// Lock before reading either copy. Keep the admitted ID even when an
		// asynchronous echo was stored first; never match messages by text.
		if err := organizationguard.LockWorkspace(txCtx, tx, message.WorkspaceID); err != nil {
			return err
		}
		if err := tx.NewSelect().Model(&message).WherePK().Scan(txCtx); err != nil {
			return err
		}
		var echo models.DirectMessage
		err := tx.NewSelect().Model(&echo).Where("conversation_id=? AND remote_message_id=? AND id<>?", message.ConversationID, remoteID, message.ID).Scan(txCtx)
		changes := []inboxchanges.Change{}
		if err == nil {
			if err = mergeMessageEcho(txCtx, tx, &message, echo); err != nil {
				return err
			}
			changes = append(changes, inboxchanges.Change{Kind: "message", ConversationID: conversation.ID, MessageID: echo.ID, Deleted: true})
		} else if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		message.RemoteMessageID = remoteID
		message.SendStatus = "sent"
		message.ErrorMessage = ""
		message.UpdatedAt = s.now()
		if err := s.applySentMessageDeletion(txCtx, tx, conversation, &message); err != nil {
			return err
		}
		if message.RemoteCreatedAt.IsZero() {
			message.RemoteCreatedAt = s.now()
		}
		if _, err = tx.NewUpdate().Model(&message).
			Column("remote_message_id", "send_status", "error_message", "remote_created_at", "provider_read_at", "author_remote_id", "attachments_json", "body", "deleted_at", "updated_at").
			WherePK().Exec(txCtx); err != nil {
			return err
		}
		query := tx.NewUpdate().Model(&conversation).Set("updated_at=?", s.now()).WherePK()
		if message.DeletedAt.IsZero() {
			query = query.Set("last_remote_message_id=?", remoteID)
		} else {
			// Clear a deleted send's pending preview without erasing a newer
			// incoming message or replacing that message's provider identity.
			query = query.Set("last_message_preview=CASE WHEN last_remote_message_id=? OR last_message_at<=? THEN '' ELSE last_message_preview END", remoteID, message.CreatedAt)
		}
		if _, err = query.Exec(txCtx); err != nil {
			return err
		}
		changes = append(changes, inboxchanges.Change{Kind: "message", ConversationID: conversation.ID, MessageID: message.ID, Deleted: !message.DeletedAt.IsZero()})
		return inboxchanges.Append(txCtx, tx, message.WorkspaceID, changes...)
	})
}

func mergeMessageEcho(ctx context.Context, tx bun.Tx, message *models.DirectMessage, echo models.DirectMessage) error {
	if !echo.RemoteCreatedAt.IsZero() {
		message.RemoteCreatedAt = echo.RemoteCreatedAt
	}
	if echo.ProviderReadAt.After(message.ProviderReadAt) {
		message.ProviderReadAt = echo.ProviderReadAt
	}
	if message.DeletedAt.IsZero() && !echo.DeletedAt.IsZero() {
		message.DeletedAt = echo.DeletedAt
	}
	message.AuthorRemoteID = textutil.FirstNonEmpty(echo.AuthorRemoteID, message.AuthorRemoteID)
	if echo.AttachmentsJSON != "" && echo.AttachmentsJSON != "null" && echo.AttachmentsJSON != "[]" {
		message.AttachmentsJSON = echo.AttachmentsJSON
	}
	// Copy before deletion, since deleting the echo cascades to its reactions.
	// The composite key deduplicates reactions already held by the admitted ID.
	if _, err := tx.NewRaw(`INSERT INTO message_reactions(message_id,actor_remote_id,value) SELECT ?,actor_remote_id,value FROM message_reactions WHERE message_id=? ON CONFLICT DO NOTHING`, message.ID, echo.ID).Exec(ctx); err != nil {
		return err
	}
	_, err := tx.NewDelete().Model(&echo).WherePK().Exec(ctx)
	return err
}

func (s *Service) applySentMessageDeletion(ctx context.Context, tx bun.Tx, conversation models.Conversation, message *models.DirectMessage) error {
	createdAt := message.RemoteCreatedAt
	if createdAt.IsZero() {
		// Admission precedes sending. A later local HTTP completion time must
		// not move an old pending write past a conversation deletion cutoff.
		createdAt = message.CreatedAt
	}
	suppressed, err := providerMessageSuppressed(ctx, tx, conversation.SocialAccountID, conversation.RemoteConversationID, message.RemoteMessageID, createdAt)
	if err != nil {
		return err
	}
	if !suppressed && message.DeletedAt.IsZero() {
		return nil
	}
	if message.DeletedAt.IsZero() {
		message.DeletedAt = s.now()
	}
	message.Body = ""
	message.AttachmentsJSON = "[]"
	message.AuthorRemoteID = ""
	_, err = tx.NewDelete().Table("message_reactions").Where("message_id=?", message.ID).Exec(ctx)
	return err
}

func (s *Service) sendMessageThroughFence(
	ctx context.Context,
	message models.DirectMessage,
	conversation models.Conversation,
	account models.SocialAccount,
	provider Provider,
	token string,
) (platform.PublishResult, error) {
	request := platform.SendMessageRequest{
		AccountID: account.AccountID, RemoteConversationID: conversation.RemoteConversationID,
		CounterpartRemoteID: conversation.CounterpartRemoteID, CounterpartHandle: conversation.CounterpartHandle,
		ReplyToRemoteID: message.ReplyToRemoteID, Body: message.Body,
	}
	fingerprint, err := providerwrite.Fingerprint("messaging-send-v1", request)
	if err != nil {
		return platform.PublishResult{}, err
	}
	execution, _ := providerwrite.JobExecutionFromContext(ctx)
	owner := message.ID
	return providerwrite.New(s.db).Execute(ctx, providerwrite.Input{
		OperationID: "messaging:" + owner, JobID: execution.ID, WorkspaceID: message.WorkspaceID,
		SocialAccountID: account.ID, TargetKey: providerKey(account), Provider: account.Platform,
		Operation: "message_send", PayloadFingerprint: fingerprint,
	}, func(sendCtx context.Context, control *providerwrite.Control) (platform.PublishResult, error) {
		if err := control.Begin(platform.PublishResult{ProviderState: "send_message", RetrySafety: platform.PublishRetryNever}); err != nil {
			return platform.PublishResult{}, err
		}
		result, err := provider.SendMessage(sendCtx, token, request)
		if err != nil {
			return platform.PublishResult{}, err
		}
		return platform.AcceptedPublishResult(result.RemoteMessageID), nil
	}, nil)
}

func (s *Service) recordSendFailure(ctx context.Context, message models.DirectMessage, conversation models.Conversation, account models.SocialAccount, sendErr error) {
	errorMessage := "The provider rejected this message."
	if providerwrite.IsAmbiguous(sendErr) {
		errorMessage = "The provider may have accepted this message. OpenPost did not send it again."
	}
	status := "failed"
	if providerwrite.IsAmbiguous(sendErr) {
		status = "ambiguous"
	}
	if err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(txCtx, tx, message.WorkspaceID); err != nil {
			return err
		}
		if _, err := tx.NewUpdate().Model(&message).Set("send_status=?", status).Set("error_message=?", errorMessage).Set("updated_at=?", s.now()).WherePK().Exec(txCtx); err != nil {
			return err
		}
		return inboxchanges.Append(txCtx, tx, message.WorkspaceID, inboxchanges.Change{Kind: "message", ConversationID: conversation.ID, MessageID: message.ID})
	}); err != nil {
		log.Printf("persist message delivery failure: %v", err)
	}
	if s.notifications == nil {
		return
	}
	for _, userID := range s.workspaceMemberIDs(ctx, conversation.WorkspaceID) {
		outcome, err := notifications.NewMessageSendFailedOutcome(notifications.MessageSendFailedFacts{
			RecipientUserID: userID, WorkspaceID: conversation.WorkspaceID,
			ConversationID: conversation.ID, MessageID: message.ID, Provider: account.Platform,
		})
		if err == nil {
			_ = s.notifications.Record(ctx, outcome)
		}
	}
}
