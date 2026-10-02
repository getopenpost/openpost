package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/editoragent"
	"github.com/uptrace/bun"
)

const editorAgentSessionsPath = "/editor-agent/sessions"

type EditorAgentHandler struct {
	db    *bun.DB
	auth  middleware.Authenticator
	relay *editoragent.Relay
}

func NewEditorAgentHandler(db *bun.DB, auth middleware.Authenticator) *EditorAgentHandler {
	return &EditorAgentHandler{db: db, auth: auth, relay: editoragent.NewRelay(db)}
}

type editorAgentRegisterInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" minLength:"1"`
		ProjectID   string `json:"project_id" minLength:"1"`
		EditorKind  string `json:"editor_kind" enum:"video,image"`
	}
}

type editorAgentRegisterOutput struct {
	Body struct {
		Session editoragent.Session `json:"session"`
		Epoch   string              `json:"epoch"`
	}
}

type editorAgentSessionInput struct {
	SessionID string `path:"session_id"`
	Epoch     string `query:"epoch" required:"true"`
}

type editorAgentRequestInput struct {
	SessionID string `path:"session_id"`
	RequestID string `path:"request_id"`
	Epoch     string `query:"epoch" required:"true"`
}

type editorAgentRespondInput struct {
	SessionID string `path:"session_id"`
	RequestID string `path:"request_id"`
	Body      struct {
		Epoch  string          `json:"epoch"`
		Result json.RawMessage `json:"result"`
		Error  json.RawMessage `json:"error"`
	}
}

type editorAgentRequestOutput struct {
	Body *editoragent.Request
}

type editorAgentNextOutput struct {
	Body struct {
		Request *editoragent.Request `json:"request"`
	}
}

type editorAgentEmptyOutput struct {
	Body struct {
		OK bool `json:"ok"`
	}
}

func (h *EditorAgentHandler) RegisterRoutes(api huma.API) {
	auth := huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}
	huma.Register(api, huma.Operation{
		OperationID: "register-editor-agent-session", Method: http.MethodPost, Path: editorAgentSessionsPath,
		Summary: "Connect an open browser editor to agent tools", Tags: []string{"Editor Agent"},
		Middlewares: auth, MaxBodyBytes: 4096, Errors: []int{400, 401, 403},
	}, h.register)
	huma.Register(api, huma.Operation{
		OperationID: "poll-editor-agent-session", Method: http.MethodGet, Path: editorAgentSessionsPath + "/{session_id}/next",
		Summary: "Poll the next operation for the open editor", Tags: []string{"Editor Agent"},
		Middlewares: auth, Errors: []int{401, 403, 404},
	}, h.next)
	huma.Register(api, huma.Operation{
		OperationID: "get-editor-agent-browser-request", Method: http.MethodGet, Path: editorAgentSessionsPath + "/{session_id}/requests/{request_id}",
		Summary: "Check cancellation before applying an editor operation", Tags: []string{"Editor Agent"},
		Middlewares: auth, Errors: []int{401, 403, 404},
	}, h.request)
	huma.Register(api, huma.Operation{
		OperationID: "respond-editor-agent-request", Method: http.MethodPost, Path: editorAgentSessionsPath + "/{session_id}/requests/{request_id}/response",
		Summary: "Return the result of a live editor operation", Tags: []string{"Editor Agent"},
		Middlewares: auth, MaxBodyBytes: 2 * 1024 * 1024, Errors: []int{400, 401, 403, 404},
	}, h.respond)
	huma.Register(api, huma.Operation{
		OperationID: "close-editor-agent-session", Method: http.MethodDelete, Path: editorAgentSessionsPath + "/{session_id}",
		Summary: "Disconnect an editor from agent tools", Tags: []string{"Editor Agent"},
		Middlewares: auth, Errors: []int{401, 403, 404},
	}, h.close)
}

func (h *EditorAgentHandler) browserUser(ctx context.Context) (string, error) {
	userID := middleware.GetUserID(ctx)
	if userID == "" || middleware.GetSessionID(ctx) == "" || middleware.GetTokenID(ctx) != "" {
		return "", huma.Error401Unauthorized("An active browser session is required")
	}
	return userID, nil
}

func (h *EditorAgentHandler) register(ctx context.Context, input *editorAgentRegisterInput) (*editorAgentRegisterOutput, error) {
	userID, err := h.browserUser(ctx)
	if err != nil {
		return nil, err
	}
	allowed, err := workspaceEditAllowed(ctx, h.db, input.Body.WorkspaceID, userID)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, huma.Error403Forbidden("Workspace edit access is required")
	}
	session, err := h.relay.Register(ctx, input.Body.WorkspaceID, userID, input.Body.ProjectID, input.Body.EditorKind)
	if err != nil {
		return nil, huma.Error400BadRequest("Invalid editor session")
	}
	output := new(editorAgentRegisterOutput)
	output.Body.Session = *session
	output.Body.Epoch = session.Epoch
	return output, nil
}

func editorAgentBrowserError(err error) error {
	if errors.Is(err, editoragent.ErrSessionUnavailable) || errors.Is(err, editoragent.ErrRequestUnavailable) {
		return huma.Error404NotFound("Editor session or request is unavailable")
	}
	if errors.Is(err, editoragent.ErrResultTooLarge) {
		return huma.Error400BadRequest("Invalid or oversized editor result")
	}
	return err
}

func (h *EditorAgentHandler) next(ctx context.Context, input *editorAgentSessionInput) (*editorAgentNextOutput, error) {
	userID, err := h.browserUser(ctx)
	if err != nil {
		return nil, err
	}
	request, err := h.relay.LeaseNext(ctx, input.SessionID, userID, input.Epoch)
	if err != nil {
		return nil, editorAgentBrowserError(err)
	}
	output := new(editorAgentNextOutput)
	output.Body.Request = request
	return output, nil
}

func (h *EditorAgentHandler) request(ctx context.Context, input *editorAgentRequestInput) (*editorAgentRequestOutput, error) {
	userID, err := h.browserUser(ctx)
	if err != nil {
		return nil, err
	}
	request, err := h.relay.BrowserRequest(ctx, input.SessionID, userID, input.Epoch, input.RequestID)
	if err != nil {
		return nil, editorAgentBrowserError(err)
	}
	return &editorAgentRequestOutput{Body: request}, nil
}

func (h *EditorAgentHandler) respond(ctx context.Context, input *editorAgentRespondInput) (*editorAgentEmptyOutput, error) {
	userID, err := h.browserUser(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.relay.Respond(ctx, input.SessionID, userID, input.Body.Epoch, input.RequestID, input.Body.Result, input.Body.Error); err != nil {
		return nil, editorAgentBrowserError(err)
	}
	output := new(editorAgentEmptyOutput)
	output.Body.OK = true
	return output, nil
}

func (h *EditorAgentHandler) close(ctx context.Context, input *editorAgentSessionInput) (*editorAgentEmptyOutput, error) {
	userID, err := h.browserUser(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.relay.Close(ctx, input.SessionID, userID, input.Epoch); err != nil {
		return nil, editorAgentBrowserError(err)
	}
	output := new(editorAgentEmptyOutput)
	output.Body.OK = true
	return output, nil
}
