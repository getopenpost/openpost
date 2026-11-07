package messaging

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/inboxchanges"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

type ConversationCursor struct {
	OccurredAt time.Time
	ID         string
}

type ConversationQuery struct {
	WorkspaceID string
	Platform    string
	AccountID   string
	Search      string
	UnreadOnly  bool
	Archived    bool
	Limit       int
	Offset      int
	Cursor      *ConversationCursor
}

type ConversationPage struct {
	Items      []models.Conversation
	Total      int
	NextCursor *ConversationCursor
}

func (s *Service) ListConversations(ctx context.Context, actor Actor, input ConversationQuery) (ConversationPage, error) {
	if err := s.authorize(ctx, input.WorkspaceID, actor, workspaceaccess.LevelRead); err != nil {
		return ConversationPage{}, err
	}
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	base := func(query *bun.SelectQuery) *bun.SelectQuery {
		query = query.Where("workspace_id = ?", input.WorkspaceID)
		if input.Platform != "" {
			query = query.Where("platform = ?", input.Platform)
		}
		if input.AccountID != "" {
			query = query.Where("social_account_id = ?", input.AccountID)
		}
		if search := strings.TrimSpace(input.Search); search != "" {
			pattern := "%" + strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(strings.ToLower(search)) + "%"
			query = query.Where(`(LOWER(counterpart_name) LIKE ? ESCAPE '\' OR LOWER(counterpart_handle) LIKE ? ESCAPE '\' OR LOWER(last_message_preview) LIKE ? ESCAPE '\' OR EXISTS (SELECT 1 FROM direct_messages AS searched WHERE searched.conversation_id=conversation.id AND searched.deleted_at IS NULL AND LOWER(searched.body) LIKE ? ESCAPE '\'))`, pattern, pattern, pattern, pattern)
		}
		if input.UnreadOnly {
			query = query.Where("unread_count > 0")
		}
		if input.Archived {
			return query.Where("archived_at IS NOT NULL")
		}
		return query.Where("archived_at IS NULL")
	}
	total, err := base(s.db.NewSelect().Model((*models.Conversation)(nil))).Count(ctx)
	if err != nil {
		return ConversationPage{}, err
	}
	items := []models.Conversation{}
	query := base(s.db.NewSelect().Model(&items))
	if input.Cursor != nil {
		query = query.Where(
			"(COALESCE(last_message_at, created_at) < ? OR (COALESCE(last_message_at, created_at) = ? AND id < ?))",
			input.Cursor.OccurredAt, input.Cursor.OccurredAt, input.Cursor.ID,
		)
	}
	query = query.OrderExpr("COALESCE(last_message_at, created_at) DESC").Order("id DESC").Limit(int64(limit + 1))
	if input.Cursor == nil {
		query = query.Offset(int64(input.Offset))
	}
	if err := query.Scan(ctx, &items); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return ConversationPage{}, err
	}
	page := ConversationPage{Items: items, Total: int(total)}
	if len(items) > limit {
		page.Items = items[:limit]
		last := page.Items[len(page.Items)-1]
		page.NextCursor = &ConversationCursor{OccurredAt: firstNonZero(last.LastMessageAt, last.CreatedAt), ID: last.ID}
	}
	return page, nil
}

type MessageCursor struct {
	OccurredAt time.Time
	CreatedAt  time.Time
	ID         string
}

type MessageQuery struct {
	WorkspaceID    string
	ConversationID string
	Limit          int
	Offset         int
	Cursor         *MessageCursor
}

type MessagePage struct {
	Conversation     models.Conversation
	HistoryAvailable bool
	Items            []models.DirectMessage
	NextCursor       *MessageCursor
}

func (s *Service) ListMessages(ctx context.Context, actor Actor, input MessageQuery) (MessagePage, error) {
	if err := s.authorize(ctx, input.WorkspaceID, actor, workspaceaccess.LevelRead); err != nil {
		return MessagePage{}, err
	}
	var conversation models.Conversation
	if err := s.db.NewSelect().Model(&conversation).
		Where("id = ? AND workspace_id = ?", input.ConversationID, input.WorkspaceID).Scan(ctx); errors.Is(err, sql.ErrNoRows) {
		return MessagePage{}, ErrNotFound
	} else if err != nil {
		return MessagePage{}, err
	}
	limit := input.Limit
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	available, err := s.historyAvailable(ctx, conversation)
	if err != nil {
		return MessagePage{}, err
	}
	page := MessagePage{Items: make([]models.DirectMessage, 0, limit), HistoryAvailable: available, Conversation: conversation}
	query := s.db.NewSelect().Model(&page.Items).
		Join("JOIN conversations AS conversation ON conversation.id = direct_message.conversation_id").
		Where("direct_message.conversation_id = ? AND conversation.workspace_id = ?", conversation.ID, input.WorkspaceID)
	if input.Cursor != nil {
		query = query.Where(`(
			COALESCE(direct_message.remote_created_at, direct_message.created_at) < ? OR
			(COALESCE(direct_message.remote_created_at, direct_message.created_at) = ? AND direct_message.created_at < ?) OR
			(COALESCE(direct_message.remote_created_at, direct_message.created_at) = ? AND direct_message.created_at = ? AND direct_message.id < ?)
		)`, input.Cursor.OccurredAt, input.Cursor.OccurredAt, input.Cursor.CreatedAt,
			input.Cursor.OccurredAt, input.Cursor.CreatedAt, input.Cursor.ID)
	}
	query = query.OrderExpr("COALESCE(direct_message.remote_created_at, direct_message.created_at) DESC").
		OrderExpr("direct_message.created_at DESC").OrderExpr("direct_message.id DESC").Limit(int64(limit + 1))
	if input.Cursor == nil {
		query = query.Offset(int64(max(0, input.Offset)))
	}
	if err := query.Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return MessagePage{}, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		oldest := page.Items[len(page.Items)-1]
		page.NextCursor = &MessageCursor{
			OccurredAt: firstNonZero(oldest.RemoteCreatedAt, oldest.CreatedAt), CreatedAt: oldest.CreatedAt, ID: oldest.ID,
		}
	}
	for left, right := 0, len(page.Items)-1; left < right; left, right = left+1, right-1 {
		page.Items[left], page.Items[right] = page.Items[right], page.Items[left]
	}
	return page, nil
}

func (s *Service) ListSyncStates(ctx context.Context, actor Actor, workspaceID string) ([]models.MessagingSyncState, error) {
	if err := s.authorize(ctx, workspaceID, actor, workspaceaccess.LevelRead); err != nil {
		return nil, err
	}
	return s.states.list(ctx, workspaceID)
}

func (s *Service) SetConversationState(ctx context.Context, actor Actor, workspaceID, conversationID string, read, archived *bool) error {
	if err := s.authorize(ctx, workspaceID, actor, workspaceaccess.LevelEdit); err != nil {
		return err
	}
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(txCtx, tx, workspaceID); err != nil {
			return err
		}
		decision, err := workspaceaccess.NewAuthorizer(tx).Authorize(txCtx, workspaceID, actor, workspaceaccess.LevelEdit)
		if err != nil {
			return err
		}
		if !decision.Allowed {
			return ErrAccessDenied
		}
		query := tx.NewUpdate().Model((*models.Conversation)(nil)).Where("id=? AND workspace_id=?", conversationID, workspaceID)
		now := s.now()
		if read != nil {
			if *read {
				query = query.Set("read_at=?", now).Set("unread_count=0")
			} else {
				query = query.Set("read_at=NULL").Set("unread_count=CASE WHEN unread_count=0 THEN 1 ELSE unread_count END")
			}
		}
		if archived != nil {
			if *archived {
				query = query.Set("archived_at=?", now)
			} else {
				query = query.Set("archived_at=NULL")
			}
		}
		result, err := query.Set("updated_at=?", now).Exec(txCtx)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 0 {
			return ErrNotFound
		}
		return inboxchanges.Append(txCtx, tx, workspaceID, inboxchanges.Change{Kind: "conversation", ConversationID: conversationID})
	})
}

func firstNonZero(values ...time.Time) time.Time {
	for _, value := range values {
		if !value.IsZero() {
			return value
		}
	}
	return time.Time{}
}
