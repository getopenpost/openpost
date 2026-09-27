package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/workflows"
)

type WorkflowHandler struct {
	service *workflows.Service
	auth    middleware.Authenticator
}

func NewWorkflowHandler(service *workflows.Service, auth middleware.Authenticator) *WorkflowHandler {
	return &WorkflowHandler{service: service, auth: auth}
}

type WorkflowListInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
	WorkflowID  string `query:"workflow_id"`
}
type WorkflowPathInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
	ID          string `path:"id"`
}
type WorkflowSaveInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
	Body        workflows.SaveRequest
}
type WorkflowUpdateInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
	ID          string `path:"id"`
	Body        workflows.SaveRequest
}
type WorkflowRevisionInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
	ID          string `path:"id"`
	Body        struct {
		ExpectedRevision    int `json:"expected_revision" minimum:"1"`
		PublicationRevision int `json:"publication_revision,omitempty" minimum:"0"`
	}
}
type WorkflowStartInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
	ID          string `path:"id"`
	Body        struct {
		ExpectedRevision int            `json:"expected_revision" minimum:"1"`
		Mode             string         `json:"mode" enum:"preview,live"`
		Source           map[string]any `json:"source"`
	}
}
type WorkflowSampleInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
	Body        workflows.Source
}
type WorkflowConnectionInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
	Body        struct {
		Name  string `json:"name" minLength:"1" maxLength:"100"`
		Token string `json:"token" minLength:"10" maxLength:"1000"`
	}
}
type WorkflowOutput struct{ Body workflows.Workflow }
type WorkflowListOutput struct{ Body []workflows.Workflow }
type WorkflowRunOutput struct{ Body workflows.Run }
type WorkflowRunsOutput struct{ Body []workflows.Run }
type WorkflowSampleOutput struct{ Body []workflows.SourceItem }
type WorkflowConnectionsOutput struct{ Body []workflows.Connection }
type WorkflowConnectionOutput struct{ Body workflows.Connection }
type WorkflowDeleteOutput struct {
	Body struct {
		Deleted bool `json:"deleted"`
	}
}

func (h *WorkflowHandler) operation(id, method, path, summary string) huma.Operation {
	return huma.Operation{OperationID: id, Method: method, Path: path, Summary: summary, Tags: []string{"Workflows"}, MaxBodyBytes: 300 * 1024, Errors: []int{400, 403, 404, 409, 503}}
}
func (h *WorkflowHandler) RegisterRoutes(api huma.API) {
	operation := func(id, method, path, summary string) huma.Operation {
		op := h.operation(id, method, path, summary)
		op.Middlewares = huma.Middlewares{middleware.RequestMetadataMiddleware(), middleware.AuthMiddleware(api, h.auth)}
		return op
	}
	huma.Register(api, operation("list-workflows", http.MethodGet, "/workflows", "List workspace workflows"), func(ctx context.Context, in *WorkflowListInput) (*WorkflowListOutput, error) {
		items, err := h.service.List(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), in.WorkspaceID)
		return &WorkflowListOutput{Body: items}, workflowHTTPError(err)
	})
	huma.Register(api, operation("create-workflow", http.MethodPost, "/workflows", "Create a workflow draft"), func(ctx context.Context, in *WorkflowSaveInput) (*WorkflowOutput, error) {
		item, err := h.service.Save(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), in.WorkspaceID, "", in.Body)
		return &WorkflowOutput{Body: item}, workflowHTTPError(err)
	})
	huma.Register(api, operation("get-workflow", http.MethodGet, "/workflows/{id}", "Get a workflow draft"), func(ctx context.Context, in *WorkflowPathInput) (*WorkflowOutput, error) {
		item, err := h.service.Get(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), in.WorkspaceID, in.ID)
		return &WorkflowOutput{Body: item}, workflowHTTPError(err)
	})
	huma.Register(api, operation("save-workflow", http.MethodPut, "/workflows/{id}", "Save a workflow draft with revision checking"), func(ctx context.Context, in *WorkflowUpdateInput) (*WorkflowOutput, error) {
		item, err := h.service.Save(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), in.WorkspaceID, in.ID, in.Body)
		return &WorkflowOutput{Body: item}, workflowHTTPError(err)
	})
	huma.Register(api, operation("publish-workflow", http.MethodPost, "/workflows/{id}/publish", "Publish this workflow revision and enable its source"), func(ctx context.Context, in *WorkflowRevisionInput) (*WorkflowOutput, error) {
		item, err := h.service.Publish(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), in.WorkspaceID, in.ID, in.Body.ExpectedRevision)
		return &WorkflowOutput{Body: item}, workflowHTTPError(err)
	})
	huma.Register(api, operation("pause-workflow", http.MethodPost, "/workflows/{id}/pause", "Stop new automatic runs; existing runs continue"), func(ctx context.Context, in *WorkflowRevisionInput) (*WorkflowOutput, error) {
		item, err := h.service.Pause(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), in.WorkspaceID, in.ID, in.Body.ExpectedRevision)
		return &WorkflowOutput{Body: item}, workflowHTTPError(err)
	})
	huma.Register(api, operation("delete-workflow", http.MethodDelete, "/workflows/{id}", "Delete a paused workflow with no active runs"), func(ctx context.Context, in *WorkflowPathInput) (*WorkflowDeleteOutput, error) {
		err := h.service.Delete(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), in.WorkspaceID, in.ID)
		out := &WorkflowDeleteOutput{}
		out.Body.Deleted = err == nil
		return out, workflowHTTPError(err)
	})
	huma.Register(api, operation("start-workflow-run", http.MethodPost, "/workflows/{id}/runs", "Preview a workflow without effects or explicitly start a live run"), func(ctx context.Context, in *WorkflowStartInput) (*WorkflowRunOutput, error) {
		item, err := h.service.Start(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), in.WorkspaceID, in.ID, in.Body.Mode, in.Body.Source, in.Body.ExpectedRevision)
		return &WorkflowRunOutput{Body: item}, workflowHTTPError(err)
	})
	huma.Register(api, operation("list-workflow-runs", http.MethodGet, "/workflow-runs", "List the latest 50 workspace workflow runs"), func(ctx context.Context, in *WorkflowListInput) (*WorkflowRunsOutput, error) {
		items, err := h.service.Runs(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), in.WorkspaceID, in.WorkflowID)
		return &WorkflowRunsOutput{Body: items}, workflowHTTPError(err)
	})
	huma.Register(api, operation("get-workflow-run", http.MethodGet, "/workflow-runs/{id}", "Inspect a workflow run and its step results"), func(ctx context.Context, in *WorkflowPathInput) (*WorkflowRunOutput, error) {
		item, err := h.service.GetRun(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), in.WorkspaceID, in.ID)
		return &WorkflowRunOutput{Body: item}, workflowHTTPError(err)
	})
	huma.Register(api, operation("cancel-workflow-run", http.MethodPost, "/workflow-runs/{id}/cancel", "Cancel remaining steps; an action already dispatched may finish"), func(ctx context.Context, in *WorkflowRevisionInput) (*WorkflowRunOutput, error) {
		item, err := h.service.Cancel(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), in.WorkspaceID, in.ID, in.Body.ExpectedRevision)
		return &WorkflowRunOutput{Body: item}, workflowHTTPError(err)
	})
	huma.Register(api, operation("approve-workflow-run", http.MethodPost, "/workflow-runs/{id}/approve", "Approve the exact reviewed post revision and continue"), func(ctx context.Context, in *WorkflowRevisionInput) (*WorkflowRunOutput, error) {
		item, err := h.service.Approve(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), in.WorkspaceID, in.ID, in.Body.ExpectedRevision, in.Body.PublicationRevision)
		return &WorkflowRunOutput{Body: item}, workflowHTTPError(err)
	})
	huma.Register(api, operation("sample-workflow-source", http.MethodPost, "/workflow-sources/sample", "Read source examples without advancing a production cursor"), func(ctx context.Context, in *WorkflowSampleInput) (*WorkflowSampleOutput, error) {
		items, err := h.service.Sample(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), in.WorkspaceID, in.Body)
		return &WorkflowSampleOutput{Body: items}, workflowHTTPError(err)
	})
	huma.Register(api, operation("list-workflow-connections", http.MethodGet, "/workflow-connections", "List workflow connections without secrets"), func(ctx context.Context, in *WorkflowListInput) (*WorkflowConnectionsOutput, error) {
		items, err := h.service.Connections(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), in.WorkspaceID)
		return &WorkflowConnectionsOutput{Body: items}, workflowHTTPError(err)
	})
	huma.Register(api, operation("create-workflow-connection", http.MethodPost, "/workflow-connections", "Store an encrypted GitHub access token"), func(ctx context.Context, in *WorkflowConnectionInput) (*WorkflowConnectionOutput, error) {
		item, err := h.service.SaveConnection(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), in.WorkspaceID, in.Body.Name, in.Body.Token)
		return &WorkflowConnectionOutput{Body: item}, workflowHTTPError(err)
	})
	huma.Register(api, operation("delete-workflow-connection", http.MethodDelete, "/workflow-connections/{id}", "Delete an unused workflow connection"), func(ctx context.Context, in *WorkflowPathInput) (*WorkflowDeleteOutput, error) {
		err := h.service.DeleteConnection(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), in.WorkspaceID, in.ID)
		out := &WorkflowDeleteOutput{}
		out.Body.Deleted = err == nil
		return out, workflowHTTPError(err)
	})
}
func workflowHTTPError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, workflows.ErrNotFound):
		return huma.Error404NotFound(err.Error())
	case errors.Is(err, workflows.ErrAccess):
		return huma.Error403Forbidden(err.Error())
	case errors.Is(err, workflows.ErrConflict), errors.Is(err, workflows.ErrState):
		return huma.Error409Conflict(err.Error())
	case errors.Is(err, workflows.ErrInvalid):
		return huma.Error400BadRequest(err.Error())
	}
	var status interface {
		error
		GetStatus() int
	}
	if errors.As(err, &status) {
		return err
	}
	return huma.Error503ServiceUnavailable("The workflow operation could not be completed. Try again.")
}
