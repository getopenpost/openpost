package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/communications"
	"github.com/uptrace/bun"
)

type CommunicationsHandler struct {
	db      *bun.DB
	auth    middleware.Authenticator
	service *communications.Service
}

func NewCommunicationsHandler(db *bun.DB, auth middleware.Authenticator, service *communications.Service) *CommunicationsHandler {
	return &CommunicationsHandler{db: db, auth: auth, service: service}
}

type ListEngagementInput struct {
	WorkspaceID   string `query:"workspace_id" required:"true"`
	Platform      string `query:"platform"`
	AccountID     string `query:"account_id"`
	PublicationID string `query:"publication_id"`
	UnreadOnly    bool   `query:"unread_only"`
	Archived      bool   `query:"archived"`
	Limit         int    `query:"limit" default:"50" minimum:"1" maximum:"100"`
	Offset        int    `query:"offset" default:"0" minimum:"0"`
	Cursor        string `query:"cursor" doc:"Opaque cursor for stable older-page pagination"`
}

type EngagementPage struct {
	Items      []models.EngagementItem `json:"items"`
	Total      int                     `json:"total"`
	SyncStates []EngagementSyncState   `json:"sync_states"`
	NextCursor string                  `json:"next_cursor,omitempty"`
}

type ListEngagementOutput struct{ Body EngagementPage }

type SetEngagementStateInput struct {
	Body struct {
		WorkspaceID string   `json:"workspace_id" required:"true"`
		IDs         []string `json:"ids" required:"true"`
		Read        *bool    `json:"read,omitempty"`
		Archived    *bool    `json:"archived,omitempty"`
	}
}

type EngagementActionInput struct {
	ItemID string `path:"item_id"`
	Body   struct {
		WorkspaceID string `json:"workspace_id" required:"true"`
		Action      string `json:"action" enum:"reply,hide,delete,like,unlike" required:"true"`
		Message     string `json:"message,omitempty"`
	}
}

type ListConversationsInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
	Platform    string `query:"platform"`
	AccountID   string `query:"account_id"`
	Archived    bool   `query:"archived"`
	Limit       int    `query:"limit" default:"50" minimum:"1" maximum:"100"`
	Offset      int    `query:"offset" default:"0" minimum:"0"`
	Cursor      string `query:"cursor" doc:"Opaque cursor for stable older-page pagination"`
}

type ConversationPage struct {
	Items      []models.Conversation `json:"items"`
	Total      int                   `json:"total"`
	SyncStates []MessageSyncState    `json:"sync_states"`
	NextCursor string                `json:"next_cursor,omitempty"`
}

type ListConversationsOutput struct{ Body ConversationPage }

// MessageSyncState exposes only the account health fields needed by the inbox.
// Provider cursors and internal subject bookkeeping stay server-side.
type MessageSyncState struct {
	ID              string    `json:"id"`
	SocialAccountID string    `json:"social_account_id"`
	Platform        string    `json:"platform"`
	Status          string    `json:"status"`
	ErrorCode       string    `json:"error_code"`
	ErrorMessage    string    `json:"error_message"`
	LastSuccessAt   time.Time `json:"last_success_at,omitempty"`
	NextSyncAt      time.Time `json:"next_sync_at,omitempty"`
}

// EngagementSyncState exposes durable, safe collection health without provider
// cursors or raw response data.
type EngagementSyncState struct {
	ID              string    `json:"id"`
	RenditionID     string    `json:"rendition_id"`
	SocialAccountID string    `json:"social_account_id"`
	Platform        string    `json:"platform"`
	Status          string    `json:"status"`
	ErrorCode       string    `json:"error_code"`
	ErrorMessage    string    `json:"error_message"`
	LastSuccessAt   time.Time `json:"last_success_at,omitempty"`
	NextSyncAt      time.Time `json:"next_sync_at,omitempty"`
}

type ListMessagesInput struct {
	ConversationID string `path:"conversation_id"`
	WorkspaceID    string `query:"workspace_id" required:"true"`
	Limit          int    `query:"limit" default:"100" minimum:"1" maximum:"200"`
	Offset         int    `query:"offset" default:"0" minimum:"0"`
}

type ListMessagesOutput struct{ Body []models.DirectMessage }

type SendMessageInput struct {
	ConversationID string `path:"conversation_id"`
	Body           struct {
		WorkspaceID string `json:"workspace_id" required:"true"`
		Message     string `json:"message" required:"true" minLength:"1" maxLength:"10000"`
	}
}

type SendMessageOutput struct{ Body models.DirectMessage }

type SetConversationStateInput struct {
	ConversationID string `path:"conversation_id"`
	Body           struct {
		WorkspaceID string `json:"workspace_id" required:"true"`
		Read        *bool  `json:"read,omitempty"`
		Archived    *bool  `json:"archived,omitempty"`
	}
}

type RefreshCommunicationsInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" required:"true"`
	}
}

type RefreshCommunicationsOutput struct {
	Body struct {
		Queued int `json:"queued"`
	}
}

type engagementCursorPayload struct {
	OccurredAt time.Time `json:"occurred_at"`
	CreatedAt  time.Time `json:"created_at"`
	ID         string    `json:"id"`
}

func encodeEngagementCursor(cursor *communications.EngagementCursor) string {
	if cursor == nil {
		return ""
	}
	payload, err := json.Marshal(engagementCursorPayload{
		OccurredAt: cursor.OccurredAt.UTC(), CreatedAt: cursor.CreatedAt.UTC(), ID: cursor.ID,
	})
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(payload)
}

func parseEngagementCursor(value string) (*communications.EngagementCursor, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, err
	}
	var cursor engagementCursorPayload
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return nil, err
	}
	if cursor.OccurredAt.IsZero() || cursor.CreatedAt.IsZero() || strings.TrimSpace(cursor.ID) == "" {
		return nil, errors.New("engagement cursor is incomplete")
	}
	return &communications.EngagementCursor{
		OccurredAt: cursor.OccurredAt.UTC(), CreatedAt: cursor.CreatedAt.UTC(), ID: cursor.ID,
	}, nil
}

type conversationCursorPayload struct {
	OccurredAt time.Time `json:"occurred_at"`
	ID         string    `json:"id"`
}

func encodeConversationCursor(cursor *communications.ConversationCursor) string {
	if cursor == nil {
		return ""
	}
	payload, err := json.Marshal(conversationCursorPayload{
		OccurredAt: cursor.OccurredAt.UTC(), ID: cursor.ID,
	})
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(payload)
}

func parseConversationCursor(value string) (*communications.ConversationCursor, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, err
	}
	var cursor conversationCursorPayload
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return nil, err
	}
	if cursor.OccurredAt.IsZero() || strings.TrimSpace(cursor.ID) == "" {
		return nil, errors.New("conversation cursor is incomplete")
	}
	return &communications.ConversationCursor{
		OccurredAt: cursor.OccurredAt.UTC(), ID: cursor.ID,
	}, nil
}

//nolint:gocyclo // Each branch registers an independent, typed communications endpoint.
func (h *CommunicationsHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-engagement",
		Method:      http.MethodGet, Path: "/engagement", Summary: "List stored replies and comments",
		Tags: []string{tagCommunications}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *ListEngagementInput) (*ListEngagementOutput, error) {
		if err := h.requireWorkspace(ctx, input.WorkspaceID, false); err != nil {
			return nil, err
		}
		cursor, err := parseEngagementCursor(input.Cursor)
		if err != nil || (cursor != nil && input.Offset != 0) {
			return nil, huma.Error400BadRequest("invalid engagement cursor")
		}
		page, err := h.service.ListEngagement(ctx, communications.EngagementQuery{
			WorkspaceID: input.WorkspaceID, Platform: input.Platform, AccountID: input.AccountID,
			PublicationID: input.PublicationID, UnreadOnly: input.UnreadOnly, Archived: input.Archived,
			Limit: input.Limit, Offset: input.Offset, Cursor: cursor,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load engagement")
		}
		states, err := h.service.ListEngagementSyncStates(ctx, input.WorkspaceID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load engagement sync state")
		}
		safeStates := make([]EngagementSyncState, 0, len(states))
		for _, state := range states {
			safeStates = append(safeStates, EngagementSyncState{
				ID: state.ID, RenditionID: state.SubjectID, SocialAccountID: state.SocialAccountID,
				Platform: state.Platform, Status: state.Status, ErrorCode: state.ErrorCode,
				ErrorMessage: state.ErrorMessage, LastSuccessAt: state.LastSuccessAt, NextSyncAt: state.NextSyncAt,
			})
		}
		return &ListEngagementOutput{Body: EngagementPage{
			Items: page.Items, Total: page.Total, SyncStates: safeStates,
			NextCursor: encodeEngagementCursor(page.NextCursor),
		}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "set-engagement-state",
		Method:      http.MethodPost, Path: "/engagement/state", Summary: "Mark engagement read or archived",
		Tags: []string{tagCommunications}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *SetEngagementStateInput) (*struct{}, error) {
		if err := h.requireWorkspace(ctx, input.Body.WorkspaceID, true); err != nil {
			return nil, err
		}
		if input.Body.Read == nil && input.Body.Archived == nil {
			return nil, huma.Error400BadRequest("read or archived is required")
		}
		if err := h.service.SetEngagementState(ctx, input.Body.WorkspaceID, input.Body.IDs, input.Body.Read, input.Body.Archived); err != nil {
			return nil, huma.Error500InternalServerError("failed to update engagement")
		}
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "queue-engagement-action",
		Method:      http.MethodPost, Path: "/engagement/{item_id}/actions", Summary: "Queue a reply or moderation action",
		Tags: []string{tagCommunications}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *EngagementActionInput) (*struct{}, error) {
		if err := h.requireWorkspace(ctx, input.Body.WorkspaceID, true); err != nil {
			return nil, err
		}
		exists, err := h.db.NewSelect().Model((*models.EngagementItem)(nil)).
			Where("id = ? AND workspace_id = ?", input.ItemID, input.Body.WorkspaceID).Exists(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to verify engagement")
		}
		if !exists {
			return nil, huma.Error404NotFound("engagement item not found")
		}
		if input.Body.Action == "reply" && strings.TrimSpace(input.Body.Message) == "" {
			return nil, huma.Error400BadRequest("message is required for a reply")
		}
		if err := h.service.QueueEngagementAction(ctx, input.ItemID, input.Body.Action, input.Body.Message, middleware.GetUserID(ctx)); err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "list-conversations",
		Method:      http.MethodGet, Path: "/messages", Summary: "List stored social conversations",
		Tags: []string{tagCommunications}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *ListConversationsInput) (*ListConversationsOutput, error) {
		if err := h.requireWorkspace(ctx, input.WorkspaceID, false); err != nil {
			return nil, err
		}
		cursor, err := parseConversationCursor(input.Cursor)
		if err != nil || (cursor != nil && input.Offset != 0) {
			return nil, huma.Error400BadRequest("invalid conversation cursor")
		}
		page, err := h.service.ListConversations(ctx, communications.ConversationQuery{
			WorkspaceID: input.WorkspaceID, Platform: input.Platform, AccountID: input.AccountID,
			Archived: input.Archived, Limit: input.Limit, Offset: input.Offset, Cursor: cursor,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load messages")
		}
		states, err := h.service.ListMessageSyncStates(ctx, input.WorkspaceID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load message sync state")
		}
		safeStates := make([]MessageSyncState, 0, len(states))
		for _, state := range states {
			safeStates = append(safeStates, MessageSyncState{
				ID: state.ID, SocialAccountID: state.SocialAccountID, Platform: state.Platform,
				Status: state.Status, ErrorCode: state.ErrorCode, ErrorMessage: state.ErrorMessage,
				LastSuccessAt: state.LastSuccessAt, NextSyncAt: state.NextSyncAt,
			})
		}
		return &ListConversationsOutput{Body: ConversationPage{
			Items: page.Items, Total: page.Total, SyncStates: safeStates,
			NextCursor: encodeConversationCursor(page.NextCursor),
		}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "list-conversation-messages",
		Method:      http.MethodGet, Path: "/messages/{conversation_id}", Summary: "List messages in a stored conversation",
		Tags: []string{tagCommunications}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *ListMessagesInput) (*ListMessagesOutput, error) {
		if err := h.requireWorkspace(ctx, input.WorkspaceID, false); err != nil {
			return nil, err
		}
		items, err := h.service.ListMessages(ctx, input.WorkspaceID, input.ConversationID, input.Limit, input.Offset)
		if err != nil {
			if errors.Is(err, communications.ErrConversationNotFound) {
				return nil, huma.Error404NotFound("conversation not found")
			}
			log.Printf("failed to load conversation %s in workspace %s: %v", input.ConversationID, input.WorkspaceID, err)
			return nil, huma.Error500InternalServerError("failed to load conversation")
		}
		return &ListMessagesOutput{Body: items}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "send-conversation-message",
		Method:      http.MethodPost, Path: "/messages/{conversation_id}/send", Summary: "Queue a social direct message",
		Tags: []string{tagCommunications}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *SendMessageInput) (*SendMessageOutput, error) {
		if err := h.requireWorkspace(ctx, input.Body.WorkspaceID, true); err != nil {
			return nil, err
		}
		exists, err := h.db.NewSelect().Model((*models.Conversation)(nil)).
			Where("id = ? AND workspace_id = ?", input.ConversationID, input.Body.WorkspaceID).Exists(ctx)
		if err != nil || !exists {
			return nil, huma.Error404NotFound("conversation not found")
		}
		message, err := h.service.QueueMessage(ctx, input.ConversationID, input.Body.Message)
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		return &SendMessageOutput{Body: *message}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "set-conversation-state",
		Method:      http.MethodPost, Path: "/messages/{conversation_id}/state", Summary: "Mark a conversation read or archived",
		Tags: []string{tagCommunications}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *SetConversationStateInput) (*struct{}, error) {
		if err := h.requireWorkspace(ctx, input.Body.WorkspaceID, true); err != nil {
			return nil, err
		}
		if input.Body.Read == nil && input.Body.Archived == nil {
			return nil, huma.Error400BadRequest("read or archived is required")
		}
		if err := h.service.SetConversationState(ctx, input.Body.WorkspaceID, input.ConversationID, input.Body.Read, input.Body.Archived); err != nil {
			return nil, huma.Error500InternalServerError("failed to update conversation")
		}
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "refresh-communications",
		Method:      http.MethodPost, Path: "/communications/refresh", Summary: "Queue engagement and message collection",
		Tags: []string{tagCommunications}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *RefreshCommunicationsInput) (*RefreshCommunicationsOutput, error) {
		if err := h.requireWorkspace(ctx, input.Body.WorkspaceID, true); err != nil {
			return nil, err
		}
		queued, err := h.service.RefreshWorkspace(ctx, input.Body.WorkspaceID, true)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to queue communications refresh")
		}
		return &RefreshCommunicationsOutput{Body: struct {
			Queued int `json:"queued"`
		}{Queued: queued}}, nil
	})
}

func (h *CommunicationsHandler) requireWorkspace(ctx context.Context, workspaceID string, edit bool) error {
	if h.service == nil {
		return huma.Error500InternalServerError("communications service is unavailable")
	}
	var ok bool
	var err error
	if edit {
		ok, err = middleware.CheckWorkspaceEditAccess(ctx, h.db, workspaceID, middleware.GetUserID(ctx))
	} else {
		ok, err = middleware.CheckWorkspaceAccess(ctx, h.db, workspaceID, middleware.GetUserID(ctx))
	}
	if err != nil {
		return huma.Error500InternalServerError("failed to verify workspace access")
	}
	if !ok {
		return huma.Error403Forbidden("workspace access denied")
	}
	return nil
}
