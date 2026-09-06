package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/engagement"
	"github.com/openpost/backend/internal/services/messaging"
)

type EngagementMessagingFeatureGate interface {
	IsEffectiveEnabled(ctx context.Context, accountID, feature string) (bool, error)
}

type EngagementMessagingHandler struct {
	auth        middleware.Authenticator
	messaging   *messaging.Service
	engagement  *engagement.Service
	featureGate EngagementMessagingFeatureGate
}

func NewEngagementMessagingHandler(auth middleware.Authenticator, messagingService *messaging.Service, engagementService *engagement.Service) *EngagementMessagingHandler {
	return &EngagementMessagingHandler{auth: auth, messaging: messagingService, engagement: engagementService}
}

func (h *EngagementMessagingHandler) SetFeatureGate(g EngagementMessagingFeatureGate) {
	h.featureGate = g
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
	Cursor         string `query:"cursor" doc:"Opaque cursor for stable older-page pagination"`
}

type MessagePage struct {
	Items      []models.DirectMessage `json:"items"`
	NextCursor string                 `json:"next_cursor,omitempty"`
}

type ListMessagesOutput struct{ Body MessagePage }

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

type RefreshCapabilitiesInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" required:"true"`
	}
}

type RefreshCapabilityOutcome struct {
	Status    string `json:"status" enum:"queued,failed,unavailable"`
	Queued    int    `json:"queued"`
	ErrorCode string `json:"error_code,omitempty"`
}

type RefreshCapabilitiesResult struct {
	Engagement RefreshCapabilityOutcome `json:"engagement"`
	Messaging  RefreshCapabilityOutcome `json:"messaging"`
}

type RefreshCapabilitiesOutput struct {
	Body RefreshCapabilitiesResult
}

type RefreshCapabilityOutput struct {
	Body RefreshCapabilityOutcome
}

type refreshCapability func(context.Context) (int, error)

func coordinateCapabilityRefresh(ctx context.Context, engagementRefresh, messagingRefresh refreshCapability) RefreshCapabilitiesResult {
	var result RefreshCapabilitiesResult
	var wait sync.WaitGroup
	wait.Add(2)
	go func() {
		defer wait.Done()
		result.Engagement = runCapabilityRefresh(ctx, engagementRefresh)
	}()
	go func() {
		defer wait.Done()
		result.Messaging = runCapabilityRefresh(ctx, messagingRefresh)
	}()
	wait.Wait()
	return result
}

func runCapabilityRefresh(ctx context.Context, refresh refreshCapability) RefreshCapabilityOutcome {
	if refresh == nil {
		return RefreshCapabilityOutcome{Status: "unavailable", ErrorCode: "service_unavailable"}
	}
	queued, err := refresh(ctx)
	if err != nil {
		code := "refresh_failed"
		if errors.Is(err, engagement.ErrAccessDenied) || errors.Is(err, messaging.ErrAccessDenied) {
			code = "access_denied"
		}
		return RefreshCapabilityOutcome{Status: "failed", ErrorCode: code}
	}
	return RefreshCapabilityOutcome{Status: "queued", Queued: queued}
}

type engagementCursorPayload struct {
	OccurredAt time.Time `json:"occurred_at"`
	CreatedAt  time.Time `json:"created_at"`
	ID         string    `json:"id"`
}

func encodeEngagementCursor(cursor *engagement.Cursor) string {
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

func parseEngagementCursor(value string) (*engagement.Cursor, error) {
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
	return &engagement.Cursor{
		OccurredAt: cursor.OccurredAt.UTC(), CreatedAt: cursor.CreatedAt.UTC(), ID: cursor.ID,
	}, nil
}

type conversationCursorPayload struct {
	OccurredAt time.Time `json:"occurred_at"`
	ID         string    `json:"id"`
}

func encodeConversationCursor(cursor *messaging.ConversationCursor) string {
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

func parseConversationCursor(value string) (*messaging.ConversationCursor, error) {
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
	return &messaging.ConversationCursor{
		OccurredAt: cursor.OccurredAt.UTC(), ID: cursor.ID,
	}, nil
}

type messageCursorPayload struct {
	OccurredAt time.Time `json:"occurred_at"`
	CreatedAt  time.Time `json:"created_at"`
	ID         string    `json:"id"`
}

func encodeMessageCursor(cursor *messaging.MessageCursor) string {
	if cursor == nil {
		return ""
	}
	payload, err := json.Marshal(messageCursorPayload{
		OccurredAt: cursor.OccurredAt.UTC(), CreatedAt: cursor.CreatedAt.UTC(), ID: cursor.ID,
	})
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(payload)
}

func parseMessageCursor(value string) (*messaging.MessageCursor, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, err
	}
	var cursor messageCursorPayload
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return nil, err
	}
	if cursor.OccurredAt.IsZero() || cursor.CreatedAt.IsZero() || strings.TrimSpace(cursor.ID) == "" {
		return nil, errors.New("message cursor is incomplete")
	}
	return &messaging.MessageCursor{
		OccurredAt: cursor.OccurredAt.UTC(), CreatedAt: cursor.CreatedAt.UTC(), ID: cursor.ID,
	}, nil
}

//nolint:gocyclo // Each branch registers an independent, typed capability endpoint.
func (h *EngagementMessagingHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-engagement",
		Method:      http.MethodGet, Path: "/engagement", Summary: "List stored replies and comments",
		Tags: []string{tagEngagement}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *ListEngagementInput) (*ListEngagementOutput, error) {
		if h.engagement == nil {
			return nil, huma.Error503ServiceUnavailable("engagement service is unavailable")
		}
		cursor, err := parseEngagementCursor(input.Cursor)
		if err != nil || (cursor != nil && input.Offset != 0) {
			return nil, huma.Error400BadRequest("invalid engagement cursor")
		}
		page, err := h.engagement.ListEngagement(ctx, engagementActor(ctx), engagement.Query{
			WorkspaceID: input.WorkspaceID, Platform: input.Platform, AccountID: input.AccountID,
			PublicationID: input.PublicationID, UnreadOnly: input.UnreadOnly, Archived: input.Archived,
			Limit: input.Limit, Offset: input.Offset, Cursor: cursor,
		})
		if err != nil {
			return nil, engagementHTTPError(err, "failed to load engagement")
		}
		states, err := h.engagement.ListEngagementSyncStates(ctx, engagementActor(ctx), input.WorkspaceID)
		if err != nil {
			return nil, engagementHTTPError(err, "failed to load engagement sync state")
		}
		safeStates := make([]EngagementSyncState, 0, len(states))
		for _, state := range states {
			safeStates = append(safeStates, EngagementSyncState{
				ID: state.ID, RenditionID: state.RenditionID, SocialAccountID: state.SocialAccountID,
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
		Tags: []string{tagEngagement}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *SetEngagementStateInput) (*struct{}, error) {
		if h.engagement == nil {
			return nil, huma.Error503ServiceUnavailable("engagement service is unavailable")
		}
		if input.Body.Read == nil && input.Body.Archived == nil {
			return nil, huma.Error400BadRequest("read or archived is required")
		}
		if err := h.engagement.SetEngagementState(ctx, engagementActor(ctx), input.Body.WorkspaceID, input.Body.IDs, input.Body.Read, input.Body.Archived); err != nil {
			return nil, engagementHTTPError(err, "failed to update engagement")
		}
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "queue-engagement-action",
		Method:      http.MethodPost, Path: "/engagement/{item_id}/actions", Summary: "Queue a reply or moderation action",
		Tags: []string{tagEngagement}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *EngagementActionInput) (*struct{}, error) {
		if h.engagement == nil {
			return nil, huma.Error503ServiceUnavailable("engagement service is unavailable")
		}
		if input.Body.Action == "reply" && strings.TrimSpace(input.Body.Message) == "" {
			return nil, huma.Error400BadRequest("message is required for a reply")
		}
		if err := h.engagement.QueueEngagementAction(ctx, engagementActor(ctx), input.ItemID, input.Body.Action, input.Body.Message); err != nil {
			if errors.Is(err, engagement.ErrAccessDenied) || errors.Is(err, engagement.ErrNotFound) {
				return nil, engagementHTTPError(err, "failed to queue engagement action")
			}
			return nil, huma.Error400BadRequest(err.Error())
		}
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "list-conversations",
		Method:      http.MethodGet, Path: "/messages", Summary: "List stored social conversations",
		Tags: []string{tagMessaging}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *ListConversationsInput) (*ListConversationsOutput, error) {
		if h.messaging == nil {
			return nil, huma.Error503ServiceUnavailable("messaging service is unavailable")
		}
		cursor, err := parseConversationCursor(input.Cursor)
		if err != nil || (cursor != nil && input.Offset != 0) {
			return nil, huma.Error400BadRequest("invalid conversation cursor")
		}
		page, err := h.messaging.ListConversations(ctx, messagingActor(ctx), messaging.ConversationQuery{
			WorkspaceID: input.WorkspaceID, Platform: input.Platform, AccountID: input.AccountID,
			Archived: input.Archived, Limit: input.Limit, Offset: input.Offset, Cursor: cursor,
		})
		if err != nil {
			return nil, messagingHTTPError(err, "failed to load messages")
		}
		states, err := h.messaging.ListSyncStates(ctx, messagingActor(ctx), input.WorkspaceID)
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
		Tags: []string{tagMessaging}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *ListMessagesInput) (*ListMessagesOutput, error) {
		if h.messaging == nil {
			return nil, huma.Error503ServiceUnavailable("messaging service is unavailable")
		}
		cursor, err := parseMessageCursor(input.Cursor)
		if err != nil || (cursor != nil && input.Offset != 0) {
			return nil, huma.Error400BadRequest("invalid message cursor")
		}
		page, err := h.messaging.ListMessages(ctx, messagingActor(ctx), messaging.MessageQuery{
			WorkspaceID: input.WorkspaceID, ConversationID: input.ConversationID,
			Limit: input.Limit, Offset: input.Offset, Cursor: cursor,
		})
		if err != nil {
			if errors.Is(err, messaging.ErrNotFound) {
				return nil, huma.Error404NotFound("conversation not found")
			}
			log.Printf("failed to load conversation %s in workspace %s: %v", input.ConversationID, input.WorkspaceID, err)
			return nil, huma.Error500InternalServerError("failed to load conversation")
		}
		return &ListMessagesOutput{Body: MessagePage{
			Items: page.Items, NextCursor: encodeMessageCursor(page.NextCursor),
		}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "send-conversation-message",
		Method:      http.MethodPost, Path: "/messages/{conversation_id}/send", Summary: "Queue a social direct message",
		Tags: []string{tagMessaging}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *SendMessageInput) (*SendMessageOutput, error) {
		if h.messaging == nil {
			return nil, huma.Error503ServiceUnavailable("messaging service is unavailable")
		}
		message, err := h.messaging.QueueMessage(ctx, messagingActor(ctx), input.ConversationID, input.Body.Message)
		if err != nil {
			if errors.Is(err, messaging.ErrAccessDenied) || errors.Is(err, messaging.ErrNotFound) {
				return nil, messagingHTTPError(err, "failed to queue message")
			}
			return nil, huma.Error400BadRequest(err.Error())
		}
		return &SendMessageOutput{Body: *message}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "set-conversation-state",
		Method:      http.MethodPost, Path: "/messages/{conversation_id}/state", Summary: "Mark a conversation read or archived",
		Tags: []string{tagMessaging}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *SetConversationStateInput) (*struct{}, error) {
		if h.messaging == nil {
			return nil, huma.Error503ServiceUnavailable("messaging service is unavailable")
		}
		if input.Body.Read == nil && input.Body.Archived == nil {
			return nil, huma.Error400BadRequest("read or archived is required")
		}
		if err := h.messaging.SetConversationState(ctx, messagingActor(ctx), input.Body.WorkspaceID, input.ConversationID, input.Body.Read, input.Body.Archived); err != nil {
			return nil, messagingHTTPError(err, "failed to update conversation")
		}
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "refresh-engagement-and-messaging",
		Method:      http.MethodPost, Path: "/engagement-and-messaging/refresh", Summary: "Queue engagement and message collection",
		Tags: []string{tagCapabilities}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *RefreshCapabilitiesInput) (*RefreshCapabilitiesOutput, error) {
		var engagementRefresh, messagingRefresh refreshCapability
		if h.engagement != nil {
			engagementRefresh = func(callCtx context.Context) (int, error) {
				return h.engagement.RefreshWorkspace(callCtx, engagementActor(ctx), input.Body.WorkspaceID, true)
			}
		}
		if h.messaging != nil {
			messagingRefresh = func(callCtx context.Context) (int, error) {
				return h.messaging.RefreshWorkspace(callCtx, messagingActor(ctx), input.Body.WorkspaceID, true)
			}
		}
		return &RefreshCapabilitiesOutput{Body: coordinateCapabilityRefresh(ctx, engagementRefresh, messagingRefresh)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "refresh-engagement",
		Method:      http.MethodPost, Path: "/engagement/refresh", Summary: "Queue engagement collection",
		Tags: []string{tagEngagement}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *RefreshCapabilitiesInput) (*RefreshCapabilityOutput, error) {
		if h.engagement == nil {
			return &RefreshCapabilityOutput{Body: runCapabilityRefresh(ctx, nil)}, nil
		}
		return &RefreshCapabilityOutput{Body: runCapabilityRefresh(ctx, func(callCtx context.Context) (int, error) {
			return h.engagement.RefreshWorkspace(callCtx, engagementActor(ctx), input.Body.WorkspaceID, true)
		})}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "refresh-messaging",
		Method:      http.MethodPost, Path: "/messages/refresh", Summary: "Queue message collection",
		Tags: []string{tagMessaging}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *RefreshCapabilitiesInput) (*RefreshCapabilityOutput, error) {
		if h.messaging == nil {
			return &RefreshCapabilityOutput{Body: runCapabilityRefresh(ctx, nil)}, nil
		}
		return &RefreshCapabilityOutput{Body: runCapabilityRefresh(ctx, func(callCtx context.Context) (int, error) {
			return h.messaging.RefreshWorkspace(callCtx, messagingActor(ctx), input.Body.WorkspaceID, true)
		})}, nil
	})
}

func engagementActor(ctx context.Context) engagement.Actor {
	return engagement.Actor{
		UserID: middleware.GetUserID(ctx), SessionID: middleware.GetSessionID(ctx), TokenID: middleware.GetTokenID(ctx),
		CredentialWorkspaceID: middleware.GetWorkspaceID(ctx),
	}
}

func messagingActor(ctx context.Context) messaging.Actor {
	return messaging.Actor{
		UserID: middleware.GetUserID(ctx), SessionID: middleware.GetSessionID(ctx), TokenID: middleware.GetTokenID(ctx),
		CredentialWorkspaceID: middleware.GetWorkspaceID(ctx),
	}
}

func messagingHTTPError(err error, fallback string) error {
	switch {
	case errors.Is(err, messaging.ErrAccessDenied):
		return huma.Error403Forbidden("workspace access denied")
	case errors.Is(err, messaging.ErrNotFound):
		return huma.Error404NotFound("conversation not found")
	default:
		return huma.Error500InternalServerError(fallback)
	}
}

func engagementHTTPError(err error, fallback string) error {
	switch {
	case errors.Is(err, engagement.ErrAccessDenied):
		return huma.Error403Forbidden("workspace access denied")
	case errors.Is(err, engagement.ErrNotFound):
		return huma.Error404NotFound("engagement item not found")
	default:
		return huma.Error500InternalServerError(fallback)
	}
}
