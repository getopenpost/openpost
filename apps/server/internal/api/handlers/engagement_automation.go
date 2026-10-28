package handlers

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/engagement"
)

type EngagementAutomationInput struct {
	ID          string `path:"id"`
	WorkspaceID string `query:"workspace_id" required:"true"`
}
type EngagementAutomationOutput struct{ Body []engagement.AutomationReply }

func (h *EngagementMessagingHandler) registerAutomation(api huma.API) {
	operation := func(id, method, path, summary string) huma.Operation {
		return huma.Operation{OperationID: id, Method: method, Path: path, Summary: summary, Tags: []string{tagEngagement}, MaxBodyBytes: 1024, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}, Errors: []int{403, 404, 500, 503}}
	}
	huma.Register(api, operation("list-engagement-automation", http.MethodGet, "/engagement/{id}/automation", "Inspect automatic replies for a comment"), func(ctx context.Context, in *EngagementAutomationInput) (*EngagementAutomationOutput, error) {
		if h.engagement == nil {
			return nil, huma.Error503ServiceUnavailable("Inbox is unavailable")
		}
		rows, err := h.engagement.AutomationReplies(ctx, engagementActor(ctx), in.WorkspaceID, in.ID)
		if err != nil {
			return nil, engagementHTTPError(err, "could not load automatic replies")
		}
		return &EngagementAutomationOutput{Body: rows}, nil
	})
	huma.Register(api, operation("stop-engagement-automation", http.MethodPost, "/engagement/{id}/automation/stop", "Take over a comment and stop pending automatic replies"), func(ctx context.Context, in *EngagementAutomationInput) (*EngagementAutomationOutput, error) {
		if h.engagement == nil {
			return nil, huma.Error503ServiceUnavailable("Inbox is unavailable")
		}
		if err := h.engagement.StopAutomation(ctx, engagementActor(ctx), in.WorkspaceID, in.ID); err != nil {
			return nil, engagementHTTPError(err, "could not stop automatic replies")
		}
		rows, err := h.engagement.AutomationReplies(ctx, engagementActor(ctx), in.WorkspaceID, in.ID)
		if err != nil {
			return nil, engagementHTTPError(err, "could not load automatic replies")
		}
		return &EngagementAutomationOutput{Body: rows}, nil
	})
}
