package handlers

import (
	"context"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/uptrace/bun"
)

type NotificationHandler struct {
	db      *bun.DB
	auth    middleware.Authenticator
	service *notifications.Service
}

func NewNotificationHandler(db *bun.DB, auth middleware.Authenticator, service *notifications.Service) *NotificationHandler {
	return &NotificationHandler{db: db, auth: auth, service: service}
}

type ListNotificationsInput struct {
	WorkspaceID string `query:"workspace_id" doc:"Current workspace ID"`
	Cursor      string `query:"cursor" doc:"Opaque pagination cursor"`
	Limit       int    `query:"limit" default:"30" minimum:"1" maximum:"100"`
}

type ListNotificationsOutput struct {
	Body notifications.NotificationPage
}

type ChangeNotificationsInput struct {
	Body struct {
		IDs []string `json:"ids,omitempty" doc:"Notification IDs"`
		All bool     `json:"all,omitempty" doc:"Apply to every notification for this user"`
	}
}

type NotificationPreferencesOutput struct {
	Body notifications.Preferences
}

type UpdateNotificationPreferencesInput struct {
	Body notifications.Preferences
}

func (h *NotificationHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-notifications",
		Method:      http.MethodGet,
		Path:        "/notifications",
		Summary:     "List the current user's stored notifications",
		Tags:        []string{tagNotifications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 500},
	}, func(ctx context.Context, input *ListNotificationsInput) (*ListNotificationsOutput, error) {
		if err := h.requireWorkspaceAccess(ctx, input.WorkspaceID); err != nil {
			return nil, err
		}
		page, err := h.service.List(ctx, middleware.GetUserID(ctx), input.WorkspaceID, input.Cursor, input.Limit)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load notifications")
		}
		return &ListNotificationsOutput{Body: page}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "mark-notifications-read",
		Method:      http.MethodPost,
		Path:        "/notifications/read",
		Summary:     "Mark one or all notifications read",
		Tags:        []string{tagNotifications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *ChangeNotificationsInput) (*struct{}, error) {
		if !input.Body.All && len(input.Body.IDs) == 0 {
			return nil, huma.Error400BadRequest("ids or all is required")
		}
		if err := h.service.MarkRead(ctx, middleware.GetUserID(ctx), input.Body.IDs, input.Body.All); err != nil {
			return nil, huma.Error500InternalServerError("failed to update notifications")
		}
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "delete-notifications",
		Method:      http.MethodPost,
		Path:        "/notifications/delete",
		Summary:     "Delete one or all notifications",
		Tags:        []string{tagNotifications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *ChangeNotificationsInput) (*struct{}, error) {
		if !input.Body.All && len(input.Body.IDs) == 0 {
			return nil, huma.Error400BadRequest("ids or all is required")
		}
		if err := h.service.Delete(ctx, middleware.GetUserID(ctx), input.Body.IDs, input.Body.All); err != nil {
			return nil, huma.Error500InternalServerError("failed to delete notifications")
		}
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-notification-preferences",
		Method:      http.MethodGet,
		Path:        "/notifications/preferences",
		Summary:     "Get notification delivery preferences",
		Tags:        []string{tagNotifications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, _ *struct{}) (*NotificationPreferencesOutput, error) {
		preferences, err := h.service.GetPreferences(ctx, middleware.GetUserID(ctx))
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load notification preferences")
		}
		return &NotificationPreferencesOutput{Body: preferences}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "update-notification-preferences",
		Method:      http.MethodPut,
		Path:        "/notifications/preferences",
		Summary:     "Update notification delivery preferences",
		Tags:        []string{tagNotifications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *UpdateNotificationPreferencesInput) (*NotificationPreferencesOutput, error) {
		preferences, err := h.service.UpdatePreferences(ctx, middleware.GetUserID(ctx), input.Body)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to save notification preferences")
		}
		return &NotificationPreferencesOutput{Body: preferences}, nil
	})
}

func (h *NotificationHandler) requireWorkspaceAccess(ctx context.Context, workspaceID string) error {
	if strings.TrimSpace(workspaceID) == "" {
		return nil
	}
	ok, err := middleware.CheckWorkspaceAccess(ctx, h.db, workspaceID, middleware.GetUserID(ctx))
	if err != nil {
		return huma.Error500InternalServerError("failed to verify workspace access")
	}
	if !ok {
		return huma.Error403Forbidden("workspace access denied")
	}
	return nil
}
