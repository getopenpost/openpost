package messaging

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

func (s *Service) QueueMessage(ctx context.Context, actor Actor, conversationID, body string) (*models.DirectMessage, error) {
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
		if err := organizationguard.LockWorkspace(txCtx, tx, conversation.WorkspaceID); err != nil {
			return err
		}
		decision, err := workspaceaccess.NewAuthorizer(tx).Authorize(txCtx, conversation.WorkspaceID, actor, workspaceaccess.LevelEdit)
		if err != nil {
			return err
		}
		if !decision.Allowed {
			return ErrAccessDenied
		}
		message, err = s.queueMessageWithDB(txCtx, tx, conversation.ID, body)
		return err
	})
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
	if !s.isMessagingEnabled(ctx, account.ID) {
		return nil, fmt.Errorf("messaging is disabled for this account")
	}
	provider := s.provider(account)
	if provider == nil || !provider.MessagingSupport().CanSend {
		return nil, fmt.Errorf("sending messages is unsupported for this provider")
	}
	if provider.MessagingSupport().RequiresOptIn && !accountMessagesEnabled(account) {
		return nil, fmt.Errorf("enable inbox sync for this account before sending messages")
	}
	if !conversation.MessagingWindowExpiresAt.IsZero() && !conversation.MessagingWindowExpiresAt.After(s.now()) {
		return nil, fmt.Errorf("the provider reply window has closed")
	}
	now := s.now()
	message := &models.DirectMessage{
		ID: uuid.NewString(), WorkspaceID: conversation.WorkspaceID, ConversationID: conversation.ID,
		Direction: "outbound", Body: body, AttachmentsJSON: "[]", SendStatus: "queued",
		CreatedAt: now, UpdatedAt: now,
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
	return message, err
}

func (s *Service) sendMessage(ctx context.Context, messageID string) error {
	var message models.DirectMessage
	if err := s.db.NewSelect().Model(&message).Where("id = ?", messageID).Scan(ctx); err != nil {
		return err
	}
	var conversation models.Conversation
	if err := s.db.NewSelect().Model(&conversation).
		Where("id = ? AND workspace_id = ?", message.ConversationID, message.WorkspaceID).Scan(ctx); err != nil {
		return err
	}
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).
		Where("id = ? AND workspace_id = ? AND is_active = ?", conversation.SocialAccountID, conversation.WorkspaceID, true).Scan(ctx); err != nil {
		return err
	}
	if !s.isMessagingEnabled(ctx, account.ID) {
		s.recordSendFailure(ctx, message, conversation, account, fmt.Errorf("messaging is disabled for this account"))
		return fmt.Errorf("messaging is disabled for this account")
	}
	provider := s.provider(account)
	if provider == nil || !provider.MessagingSupport().CanSend {
		return fmt.Errorf("sending messages is unsupported for this provider")
	}
	if provider.MessagingSupport().RequiresOptIn && !accountMessagesEnabled(account) {
		return fmt.Errorf("enable inbox sync for this account before sending messages")
	}
	if s.tokens == nil {
		return errors.New("messaging token source is unavailable")
	}
	token, err := s.tokens.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		return err
	}
	writeResult, err := s.sendMessageThroughFence(ctx, message, conversation, account, provider, token)
	if err != nil {
		s.recordSendFailure(ctx, message, conversation, account, err)
		return err
	}
	createdAt := s.now()
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewUpdate().Model(&message).
			Set("remote_message_id = ?", writeResult.ExternalID).Set("send_status = 'sent'").
			Set("error_message = ''").Set("remote_created_at = ?", createdAt).Set("updated_at = ?", s.now()).
			WherePK().Exec(txCtx); err != nil {
			return err
		}
		_, err := tx.NewUpdate().Model(&conversation).
			Set("last_remote_message_id = ?", writeResult.ExternalID).Set("last_message_at = ?", createdAt).
			Set("last_message_preview = ?", message.Body).Set("updated_at = ?", s.now()).WherePK().Exec(txCtx)
		return err
	})
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
		ReplyToRemoteID: conversation.LastRemoteMessageID, Body: message.Body,
	}
	fingerprint, err := providerwrite.Fingerprint("messaging-send-v1", request)
	if err != nil {
		return platform.PublishResult{}, err
	}
	execution, _ := providerwrite.JobExecutionFromContext(ctx)
	owner := execution.ID
	if owner == "" {
		owner = message.ID
	}
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
	_, _ = s.db.NewUpdate().Model(&message).Set("send_status = 'failed'").
		Set("error_message = ?", errorMessage).Set("updated_at = ?", s.now()).WherePK().Exec(ctx)
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
