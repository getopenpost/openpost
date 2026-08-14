package handlers

import (
	"context"
	"errors"
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
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace whose inbox should be listed"`
	Cursor      string `query:"cursor" doc:"Opaque pagination cursor"`
	Limit       int    `query:"limit" default:"30" minimum:"1" maximum:"100"`
}

type ListNotificationsOutput struct {
	Body notifications.NotificationPage
}

type ChangeNotificationsInput struct {
	Body struct {
		WorkspaceID string   `json:"workspace_id" required:"true" doc:"Workspace whose inbox should be changed"`
		IDs         []string `json:"ids,omitempty" doc:"Notification IDs within the workspace inbox"`
		All         bool     `json:"all,omitempty" doc:"Apply to every workspace and account-wide notification visible in this inbox"`
	}
}

type NotificationPreferencesOutput struct {
	Body notifications.PreferenceSettings
}

type UpdateNotificationPreferencesInput struct {
	Body notifications.PreferenceUpdate
}

type CreateNotificationMuteInput struct {
	Body notifications.MuteCreate
}

type EndNotificationMuteInput struct {
	ID string `path:"id" doc:"Mute ID"`
}

func (h *NotificationHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-notifications",
		Method:      http.MethodGet,
		Path:        "/notifications",
		Summary:     "List the current user's stored notifications",
		Tags:        []string{tagNotifications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 500},
	}, func(ctx context.Context, input *ListNotificationsInput) (*ListNotificationsOutput, error) {
		workspaceID := strings.TrimSpace(input.WorkspaceID)
		if err := h.requireWorkspaceAccess(ctx, workspaceID); err != nil {
			return nil, err
		}
		page, err := h.service.List(ctx, middleware.GetUserID(ctx), workspaceID, input.Cursor, input.Limit)
		if errors.Is(err, notifications.ErrInvalidCursor) {
			return nil, huma.Error400BadRequest("invalid notification cursor")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load notifications")
		}
		return &ListNotificationsOutput{Body: page}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "mark-notifications-read",
		Method:      http.MethodPost,
		Path:        "/notifications/read",
		Summary:     "Mark notifications in a workspace inbox read",
		Tags:        []string{tagNotifications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 500},
	}, func(ctx context.Context, input *ChangeNotificationsInput) (*struct{}, error) {
		workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
		if err := h.requireWorkspaceAccess(ctx, workspaceID); err != nil {
			return nil, err
		}
		if !input.Body.All && len(input.Body.IDs) == 0 {
			return nil, huma.Error400BadRequest("ids or all is required")
		}
		if err := h.service.MarkRead(ctx, middleware.GetUserID(ctx), workspaceID, input.Body.IDs, input.Body.All); err != nil {
			return nil, huma.Error500InternalServerError("failed to update notifications")
		}
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "delete-notifications",
		Method:      http.MethodPost,
		Path:        "/notifications/delete",
		Summary:     "Delete notifications from a workspace inbox",
		Tags:        []string{tagNotifications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 500},
	}, func(ctx context.Context, input *ChangeNotificationsInput) (*struct{}, error) {
		workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
		if err := h.requireWorkspaceAccess(ctx, workspaceID); err != nil {
			return nil, err
		}
		if !input.Body.All && len(input.Body.IDs) == 0 {
			return nil, huma.Error400BadRequest("ids or all is required")
		}
		if err := h.service.Delete(ctx, middleware.GetUserID(ctx), workspaceID, input.Body.IDs, input.Body.All); err != nil {
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
		Errors:      []int{403, 500},
	}, h.getNotificationPreferences)

	huma.Register(api, huma.Operation{
		OperationID: "update-notification-preferences",
		Method:      http.MethodPut,
		Path:        "/notifications/preferences",
		Summary:     "Update notification delivery preferences",
		Tags:        []string{tagNotifications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 500},
	}, h.updateNotificationPreferences)

	h.registerMuteRoutes(api)
}

func (h *NotificationHandler) getNotificationPreferences(ctx context.Context, _ *struct{}) (*NotificationPreferencesOutput, error) {
	settings, err := h.service.GetPreferenceSettingsForActor(ctx, notificationMuteActor(ctx))
	if errors.Is(err, notifications.ErrMuteWorkspaceAccess) {
		return nil, huma.Error403Forbidden("workspace access required")
	} else if err != nil {
		return nil, huma.Error500InternalServerError("failed to load notification preferences")
	}
	return &NotificationPreferencesOutput{Body: settings}, nil
}

func (h *NotificationHandler) updateNotificationPreferences(ctx context.Context, input *UpdateNotificationPreferencesInput) (*NotificationPreferencesOutput, error) {
	settings, err := h.service.UpdatePreferenceSettings(ctx, notificationMuteActor(ctx), input.Body)
	if errors.Is(err, notifications.ErrInvalidPreferences) {
		return nil, huma.Error400BadRequest("invalid notification preferences")
	}
	if errors.Is(err, notifications.ErrMuteWorkspaceAccess) {
		return nil, huma.Error403Forbidden("workspace-bound credentials cannot change account notification preferences")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to save notification preferences")
	}
	return &NotificationPreferencesOutput{Body: settings}, nil
}

func (h *NotificationHandler) registerMuteRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "create-notification-mute",
		Method:      http.MethodPost,
		Path:        "/notifications/mutes",
		Summary:     "Pause optional notification email temporarily",
		Description: "Creates or replaces the current account-wide or Workspace-specific Mute. In-app notifications remain immediate and Transactional email always bypasses Mutes.",
		Tags:        []string{tagNotifications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 500},
	}, func(ctx context.Context, input *CreateNotificationMuteInput) (*NotificationPreferencesOutput, error) {
		actor := notificationMuteActor(ctx)
		if _, err := h.service.CreateMute(ctx, actor, input.Body); errors.Is(err, notifications.ErrInvalidMute) {
			return nil, huma.Error400BadRequest("invalid notification mute")
		} else if errors.Is(err, notifications.ErrMuteWorkspaceAccess) {
			return nil, huma.Error403Forbidden("workspace access required")
		} else if err != nil {
			return nil, huma.Error500InternalServerError("failed to create notification mute")
		}
		settings, err := h.service.GetPreferenceSettingsForActor(ctx, actor)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load notification preferences")
		}
		return &NotificationPreferencesOutput{Body: settings}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "end-notification-mute",
		Method:      http.MethodDelete,
		Path:        "/notifications/mutes/{id}",
		Summary:     "End a notification Mute now",
		Description: "Ends an existing Mute. Repeating the request for that Mute is safe and returns the current authoritative preferences.",
		Tags:        []string{tagNotifications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404, 500},
	}, func(ctx context.Context, input *EndNotificationMuteInput) (*NotificationPreferencesOutput, error) {
		actor := notificationMuteActor(ctx)
		if err := h.service.EndMute(ctx, actor, input.ID); errors.Is(err, notifications.ErrMuteNotFound) {
			return nil, huma.Error404NotFound("notification mute not found")
		} else if errors.Is(err, notifications.ErrMuteWorkspaceAccess) {
			return nil, huma.Error403Forbidden("workspace access required")
		} else if err != nil {
			return nil, huma.Error500InternalServerError("failed to end notification mute")
		}
		settings, err := h.service.GetPreferenceSettingsForActor(ctx, actor)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load notification preferences")
		}
		return &NotificationPreferencesOutput{Body: settings}, nil
	})
}

func notificationMuteActor(ctx context.Context) notifications.MuteActor {
	return notifications.MuteActor{
		UserID: middleware.GetUserID(ctx), WorkspaceBindingID: middleware.GetWorkspaceID(ctx),
	}
}

func (h *NotificationHandler) requireWorkspaceAccess(ctx context.Context, workspaceID string) error {
	if strings.TrimSpace(workspaceID) == "" {
		return huma.Error400BadRequest("workspace_id is required")
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
