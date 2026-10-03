package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/aiusage"
	"github.com/openpost/backend/internal/services/editorpreferences"
	"github.com/uptrace/bun"
)

type EditorPreferencesHandler struct {
	db      *bun.DB
	auth    middleware.Authenticator
	service *editorpreferences.Service
}

func NewEditorPreferencesHandler(db *bun.DB, auth middleware.Authenticator) *EditorPreferencesHandler {
	return &EditorPreferencesHandler{db: db, auth: auth, service: editorpreferences.NewService(db)}
}

type editorPreferencesContextInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
	ProjectID   string `query:"project_id"`
	EditorKind  string `query:"editor_kind" enum:"video,image" default:"video"`
	Context     string `query:"context" maxLength:"100"`
}
type editorPreferencesContextOutput struct{ Body editorpreferences.Context }
type editorPreferenceSaveInput struct {
	Body struct {
		WorkspaceID      string                       `json:"workspace_id" minLength:"1"`
		ExpectedRevision int                          `json:"expected_revision" minimum:"0"`
		Preference       editorpreferences.Preference `json:"preference"`
	}
}
type editorPreferenceOutput struct{ Body editorpreferences.Preference }
type editorPreferenceRemoveInput struct {
	ID               string `path:"id"`
	WorkspaceID      string `query:"workspace_id" required:"true"`
	ProjectID        string `query:"project_id"`
	ExpectedRevision int    `query:"expected_revision" required:"true" minimum:"1"`
}
type editorStyleSaveInput struct {
	Body struct {
		WorkspaceID     string                  `json:"workspace_id" minLength:"1"`
		ExpectedVersion int                     `json:"expected_version" minimum:"0"`
		Style           editorpreferences.Style `json:"style"`
	}
}
type editorStyleInput struct {
	ID          string `path:"id"`
	WorkspaceID string `query:"workspace_id" required:"true"`
	Version     int    `query:"version" minimum:"0"`
}
type editorStyleArchiveInput struct {
	ID   string `path:"id"`
	Body struct {
		WorkspaceID     string `json:"workspace_id" minLength:"1"`
		ExpectedVersion int    `json:"expected_version" minimum:"1"`
		Archived        bool   `json:"archived"`
	}
}
type editorStyleOutput struct{ Body editorpreferences.Style }
type editorLearningInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" minLength:"1"`
		Enabled     bool   `json:"enabled"`
		Reset       bool   `json:"reset"`
		ProjectID   string `json:"project_id,omitempty"`
	}
}
type editorChoiceInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" minLength:"1"`
		ProjectID   string `json:"project_id" minLength:"1"`
		Context     string `json:"context" maxLength:"100"`
		EntryID     string `json:"entry_id" minLength:"1" maxLength:"200"`
		EntryName   string `json:"entry_name" maxLength:"200"`
		EditorKind  string `json:"editor_kind" enum:"video,image"`
	}
}
type editorFavoriteInput struct {
	Body struct {
		WorkspaceID string                     `json:"workspace_id" minLength:"1"`
		Favorite    editorpreferences.Favorite `json:"favorite"`
	}
}
type editorUsageInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
}
type editorUsageOutput struct {
	Body struct {
		Calls []aiusage.EditorCall `json:"calls"`
	}
}

func (h *EditorPreferencesHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "archive-editor-style", Method: http.MethodPost, Path: "/editor-agent/styles/{id}/archive", Tags: []string{"Editor Agent"}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}, MaxBodyBytes: 4096, Errors: []int{401, 403, 404, 409}}, h.archiveStyle)
	auth := huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}
	huma.Register(api, huma.Operation{OperationID: "get-editor-preferences", Method: http.MethodGet, Path: "/editor-agent/preferences", Tags: []string{"Editor Agent"}, Middlewares: auth, Errors: []int{401, 403}}, h.context)
	huma.Register(api, huma.Operation{OperationID: "save-editor-preference", Method: http.MethodPost, Path: "/editor-agent/preferences", Tags: []string{"Editor Agent"}, Middlewares: auth, MaxBodyBytes: 8192, Errors: []int{400, 401, 403, 409}}, h.savePreference)
	huma.Register(api, huma.Operation{OperationID: "delete-editor-preference", Method: http.MethodDelete, Path: "/editor-agent/preferences/{id}", Tags: []string{"Editor Agent"}, Middlewares: auth, Errors: []int{401, 403, 409}}, h.removePreference)
	huma.Register(api, huma.Operation{OperationID: "save-editor-style", Method: http.MethodPost, Path: "/editor-agent/styles", Tags: []string{"Editor Agent"}, Middlewares: auth, MaxBodyBytes: 32 * 1024, Errors: []int{400, 401, 403, 409}}, h.saveStyle)
	huma.Register(api, huma.Operation{OperationID: "get-editor-style", Method: http.MethodGet, Path: "/editor-agent/styles/{id}", Tags: []string{"Editor Agent"}, Middlewares: auth, Errors: []int{401, 403, 404}}, h.style)
	huma.Register(api, huma.Operation{OperationID: "set-editor-learning", Method: http.MethodPost, Path: "/editor-agent/learning", Tags: []string{"Editor Agent"}, Middlewares: auth, MaxBodyBytes: 4096, Errors: []int{401, 403}}, h.learning)
	huma.Register(api, huma.Operation{OperationID: "record-editor-library-choice", Method: http.MethodPost, Path: "/editor-agent/choices", Tags: []string{"Editor Agent"}, Middlewares: auth, MaxBodyBytes: 4096, Errors: []int{400, 401, 403}}, h.choice)
	huma.Register(api, huma.Operation{OperationID: "set-editor-library-favorite", Method: http.MethodPost, Path: "/editor-agent/favorites", Tags: []string{"Editor Agent"}, Middlewares: auth, MaxBodyBytes: 4096, Errors: []int{400, 401, 403}}, h.favorite)
	huma.Register(api, huma.Operation{OperationID: "list-editor-ai-usage", Method: http.MethodGet, Path: "/editor-agent/usage", Tags: []string{"Editor Agent"}, Middlewares: auth, Errors: []int{401, 403}}, h.usage)
}
func (h *EditorPreferencesHandler) access(ctx context.Context, workspaceID string, edit bool) (string, error) {
	userID := middleware.GetUserID(ctx)
	allowed, err := workspaceReadAllowed(ctx, h.db, workspaceID, userID)
	if edit {
		allowed, err = workspaceEditAllowed(ctx, h.db, workspaceID, userID)
	}
	if err != nil {
		return "", err
	}
	if !allowed {
		return "", huma.Error403Forbidden("Workspace access denied")
	}
	return userID, nil
}
func editorPreferenceError(err error) error {
	if errors.Is(err, editorpreferences.ErrConflict) {
		return huma.Error409Conflict(err.Error())
	}
	if errors.Is(err, editorpreferences.ErrUnavailable) {
		return huma.Error404NotFound(err.Error())
	}
	return huma.Error400BadRequest(err.Error())
}
func (h *EditorPreferencesHandler) context(ctx context.Context, input *editorPreferencesContextInput) (*editorPreferencesContextOutput, error) {
	userID, err := h.access(ctx, input.WorkspaceID, false)
	if err != nil {
		return nil, err
	}
	result, err := h.service.Context(ctx, input.WorkspaceID, userID, input.ProjectID, input.EditorKind, input.Context)
	if err != nil {
		return nil, err
	}
	return &editorPreferencesContextOutput{Body: result}, nil
}
func (h *EditorPreferencesHandler) savePreference(ctx context.Context, input *editorPreferenceSaveInput) (*editorPreferenceOutput, error) {
	userID, err := h.access(ctx, input.Body.WorkspaceID, true)
	if err != nil {
		return nil, err
	}
	p, err := h.service.SavePreference(ctx, input.Body.WorkspaceID, userID, input.Body.Preference, input.Body.ExpectedRevision)
	if err != nil {
		return nil, editorPreferenceError(err)
	}
	return &editorPreferenceOutput{Body: p}, nil
}
func (h *EditorPreferencesHandler) removePreference(ctx context.Context, input *editorPreferenceRemoveInput) (*editorAgentEmptyOutput, error) {
	userID, err := h.access(ctx, input.WorkspaceID, true)
	if err != nil {
		return nil, err
	}
	if err = h.service.RemovePreference(ctx, input.WorkspaceID, userID, input.ProjectID, input.ID, input.ExpectedRevision); err != nil {
		return nil, editorPreferenceError(err)
	}
	return editorPreferenceOK(), nil
}
func editorPreferenceOK() *editorAgentEmptyOutput {
	output := new(editorAgentEmptyOutput)
	output.Body.OK = true
	return output
}
func (h *EditorPreferencesHandler) saveStyle(ctx context.Context, input *editorStyleSaveInput) (*editorStyleOutput, error) {
	userID, err := h.access(ctx, input.Body.WorkspaceID, true)
	if err != nil {
		return nil, err
	}
	style, err := h.service.SaveStyle(ctx, input.Body.WorkspaceID, userID, input.Body.Style, input.Body.ExpectedVersion)
	if err != nil {
		return nil, editorPreferenceError(err)
	}
	return &editorStyleOutput{Body: style}, nil
}
func (h *EditorPreferencesHandler) style(ctx context.Context, input *editorStyleInput) (*editorStyleOutput, error) {
	userID, err := h.access(ctx, input.WorkspaceID, false)
	if err != nil {
		return nil, err
	}
	style, err := h.service.Style(ctx, input.WorkspaceID, userID, input.ID, input.Version)
	if err != nil {
		return nil, editorPreferenceError(err)
	}
	return &editorStyleOutput{Body: style}, nil
}
func (h *EditorPreferencesHandler) learning(ctx context.Context, input *editorLearningInput) (*editorAgentEmptyOutput, error) {
	userID, err := h.access(ctx, input.Body.WorkspaceID, true)
	if err != nil {
		return nil, err
	}
	if err = h.service.SetLearning(ctx, input.Body.WorkspaceID, userID, editorpreferences.LearningChange{Enabled: input.Body.Enabled, Reset: input.Body.Reset, ProjectID: input.Body.ProjectID}); err != nil {
		return nil, err
	}
	return editorPreferenceOK(), nil
}
func (h *EditorPreferencesHandler) choice(ctx context.Context, input *editorChoiceInput) (*editorAgentEmptyOutput, error) {
	if middleware.GetSessionID(ctx) == "" || middleware.GetTokenID(ctx) != "" {
		return nil, huma.Error401Unauthorized("Manual choices require a browser session")
	}
	userID, err := h.access(ctx, input.Body.WorkspaceID, true)
	if err != nil {
		return nil, err
	}
	b := input.Body
	if err = h.service.RecordChoice(ctx, b.WorkspaceID, userID, b.ProjectID, b.Context, b.EntryID, b.EntryName, b.EditorKind); err != nil {
		return nil, editorPreferenceError(err)
	}
	return editorPreferenceOK(), nil
}
func (h *EditorPreferencesHandler) favorite(ctx context.Context, input *editorFavoriteInput) (*editorAgentEmptyOutput, error) {
	userID, err := h.access(ctx, input.Body.WorkspaceID, true)
	if err != nil {
		return nil, err
	}
	if err = h.service.Favorite(ctx, input.Body.WorkspaceID, userID, input.Body.Favorite); err != nil {
		return nil, editorPreferenceError(err)
	}
	return editorPreferenceOK(), nil
}
func (h *EditorPreferencesHandler) usage(ctx context.Context, input *editorUsageInput) (*editorUsageOutput, error) {
	userID, err := h.access(ctx, input.WorkspaceID, false)
	if err != nil {
		return nil, err
	}
	calls, err := aiusage.NewService(h.db).List(ctx, input.WorkspaceID, userID)
	if err != nil {
		return nil, err
	}
	output := new(editorUsageOutput)
	output.Body.Calls = calls
	return output, nil
}

func (h *EditorPreferencesHandler) archiveStyle(ctx context.Context, input *editorStyleArchiveInput) (*editorAgentEmptyOutput, error) {
	user, err := h.access(ctx, input.Body.WorkspaceID, true)
	if err != nil {
		return nil, err
	}
	if err = h.service.ArchiveStyle(ctx, input.Body.WorkspaceID, user, input.ID, input.Body.ExpectedVersion, input.Body.Archived); err != nil {
		return nil, editorPreferenceError(err)
	}
	return editorPreferenceOK(), nil
}
