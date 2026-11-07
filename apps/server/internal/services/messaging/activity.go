package messaging

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/inboxchanges"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

type Activity struct {
	WorkspaceID    string
	ClientID       string
	View           string
	ConversationID string
}

func (s *Service) Heartbeat(ctx context.Context, actor Actor, input Activity) error {
	if err := s.authorize(ctx, input.WorkspaceID, actor, workspaceaccess.LevelRead); err != nil {
		return err
	}
	input.ClientID = strings.TrimSpace(input.ClientID)
	if input.ClientID == "" || len(input.ClientID) > 128 {
		return errors.New("client ID is required and must be at most 128 characters")
	}
	if input.View != "chats" && input.View != "comments" && input.View != "conversation" && input.View != "away" {
		return errors.New("invalid inbox view")
	}
	if input.View == "away" {
		_, err := s.db.NewRaw(`DELETE FROM inbox_activity WHERE workspace_id=? AND user_id=? AND client_id=?`, input.WorkspaceID, actor.UserID, input.ClientID).Exec(ctx)
		return err
	}
	accountID := ""
	if input.View == "conversation" {
		var conversation models.Conversation
		if err := s.db.NewSelect().Model(&conversation).Where("id=? AND workspace_id=?", input.ConversationID, input.WorkspaceID).Scan(ctx); errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		accountID = conversation.SocialAccountID
	} else {
		input.ConversationID = ""
	}
	return s.db.RunInTx(ctx, nil, func(txCtx context.Context, tx bun.Tx) error {
		return s.recordActivity(txCtx, tx, actor, input, accountID)
	})
}

func (s *Service) recordActivity(ctx context.Context, tx bun.Tx, actor Actor, input Activity, accountID string) error {
	var previous struct {
		View            string
		SocialAccountID string
		ExpiresAt       time.Time
	}
	priorErr := tx.NewRaw(`SELECT view,social_account_id,expires_at FROM inbox_activity WHERE workspace_id=? AND user_id=? AND client_id=?`, input.WorkspaceID, actor.UserID, input.ClientID).Scan(ctx, &previous)
	if priorErr != nil && !errors.Is(priorErr, sql.ErrNoRows) {
		return priorErr
	}
	_, err := tx.NewRaw(`INSERT INTO inbox_activity(workspace_id,user_id,client_id,view,conversation_id,social_account_id,expires_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id,user_id,client_id) DO UPDATE SET view=EXCLUDED.view, conversation_id=EXCLUDED.conversation_id,social_account_id=EXCLUDED.social_account_id,expires_at=EXCLUDED.expires_at`, input.WorkspaceID, actor.UserID, input.ClientID, input.View, input.ConversationID, accountID, s.now().Add(time.Minute)).Exec(ctx)
	if err != nil {
		return err
	}
	activated := errors.Is(priorErr, sql.ErrNoRows) || !previous.ExpiresAt.After(s.now()) || previous.View != input.View || previous.SocialAccountID != accountID
	if activated && input.View != "comments" {
		// Foreground entry wakes a cold account immediately, but never
		// bypasses a recorded provider/authentication backoff.
		query := tx.NewRaw(`UPDATE message_event_checkpoints SET next_poll_at=? WHERE social_account_id IN (SELECT id FROM social_accounts WHERE workspace_id=? AND (?='' OR id=?)) AND NOT EXISTS (SELECT 1 FROM messaging_sync_states AS state WHERE state.social_account_id=message_event_checkpoints.social_account_id AND state.status NOT IN ('ok','pending') AND state.next_sync_at>?)`, s.now(), input.WorkspaceID, accountID, accountID, s.now())
		if _, err = query.Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

type InboxChangePage struct {
	inboxchanges.Page
	Messages      []models.DirectMessage `json:"messages"`
	Conversations []models.Conversation  `json:"conversations"`
}

func (s *Service) Changes(ctx context.Context, actor Actor, workspaceID, cursor string, wait time.Duration) (InboxChangePage, error) {
	page, err := inboxchanges.Wait(ctx, s.db, workspaceID, cursor, wait, func(checkCtx context.Context) error {
		if err := s.credentialAlive(checkCtx, actor); err != nil {
			return err
		}
		return s.authorize(checkCtx, workspaceID, actor, workspaceaccess.LevelRead)
	})
	result := InboxChangePage{Page: page, Messages: []models.DirectMessage{}, Conversations: []models.Conversation{}}
	if err != nil {
		return result, err
	}
	messageIDs, conversationIDs := []string{}, []string{}
	for _, c := range page.Changes {
		if c.MessageID != "" {
			messageIDs = append(messageIDs, c.MessageID)
		}
		if c.ConversationID != "" {
			conversationIDs = append(conversationIDs, c.ConversationID)
		}
	}
	if len(messageIDs) > 0 {
		if err = s.db.NewSelect().Model(&result.Messages).Where("workspace_id=? AND id IN (?)", workspaceID, bun.List(messageIDs)).Scan(ctx); err != nil {
			return result, err
		}
	}
	if len(conversationIDs) > 0 {
		if err = s.db.NewSelect().Model(&result.Conversations).Where("workspace_id=? AND id IN (?)", workspaceID, bun.List(conversationIDs)).Scan(ctx); err != nil {
			return result, err
		}
	}
	if err = s.credentialAlive(ctx, actor); err != nil {
		return result, err
	}
	return result, s.authorize(ctx, workspaceID, actor, workspaceaccess.LevelRead)
}

func (s *Service) credentialAlive(ctx context.Context, actor Actor) error {
	var valid bool
	var err error
	switch {
	case actor.SessionID != "":
		valid, err = s.db.NewSelect().Model((*models.UserSession)(nil)).Where("id=? AND user_id=? AND revoked_at IS NULL AND expires_at>?", actor.SessionID, actor.UserID, s.now()).Exists(ctx)
	case actor.TokenID != "":
		valid, err = s.db.NewSelect().Model((*models.APIToken)(nil)).Where("id=? AND user_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)", actor.TokenID, actor.UserID, s.now()).Exists(ctx)
	default:
		// Trusted internal service actors, HTTP always has a credential.
		return nil
	}
	if err != nil {
		return err
	}
	if !valid {
		return ErrAccessDenied
	}
	return nil
}

type InboxSummary struct {
	UnreadConversations int `json:"unread_conversations"`
	UnreadComments      int `json:"unread_comments"`
}

func (s *Service) Summary(ctx context.Context, actor Actor, workspaceID string) (InboxSummary, error) {
	result := InboxSummary{}
	if err := s.authorize(ctx, workspaceID, actor, workspaceaccess.LevelRead); err != nil {
		return result, err
	}
	conversations, err := s.db.NewSelect().Model((*models.Conversation)(nil)).Where("workspace_id=? AND archived_at IS NULL AND unread_count>0", workspaceID).Count(ctx)
	if err != nil {
		return result, err
	}
	comments, err := s.db.NewSelect().Model((*models.EngagementItem)(nil)).Where("workspace_id=? AND archived_at IS NULL AND read_at IS NULL AND deleted_at IS NULL AND is_ours=?", workspaceID, false).Count(ctx)
	result.UnreadConversations, result.UnreadComments = int(conversations), int(comments)
	return result, err
}
