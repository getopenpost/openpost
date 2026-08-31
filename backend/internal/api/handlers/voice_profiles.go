package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/voiceprofiles"
	"github.com/uptrace/bun"
)

const (
	voiceProfilesPath = "/voice-profiles"
	voiceProfilesTag  = "Voice Profiles"
)

type VoiceProfileHandler struct {
	db       *bun.DB
	auth     middleware.Authenticator
	profiles *voiceprofiles.Service
}

func NewVoiceProfileHandler(db *bun.DB, authenticator middleware.Authenticator) *VoiceProfileHandler {
	return &VoiceProfileHandler{db: db, auth: authenticator, profiles: voiceprofiles.New(db)}
}

type ListVoiceProfilesInput struct {
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID"`
}

type VoiceProfilePathInput struct {
	PathID      string `path:"id" doc:"Voice Profile ID"`
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID"`
}

type CreateVoiceProfileInput struct {
	Body struct {
		WorkspaceID string                   `json:"workspace_id" doc:"Workspace ID"`
		Name        string                   `json:"name" minLength:"1" maxLength:"80" doc:"Reusable Voice Profile name"`
		IsDefault   bool                     `json:"is_default,omitempty" doc:"Make this the Workspace default"`
		Definition  voiceprofiles.Definition `json:"definition" doc:"Identity facts and representative writing"`
	}
}

type UpdateVoiceProfileInput struct {
	PathID string `path:"id" doc:"Voice Profile ID"`
	Body   struct {
		WorkspaceID      string                   `json:"workspace_id" doc:"Workspace ID"`
		ExpectedRevision int                      `json:"expected_revision" minimum:"1" doc:"Revision loaded by the editor"`
		Name             string                   `json:"name" minLength:"1" maxLength:"80" doc:"Reusable Voice Profile name"`
		Definition       voiceprofiles.Definition `json:"definition" doc:"Replacement identity facts and representative writing"`
	}
}

type SetDefaultVoiceProfileInput struct {
	PathID string `path:"id" doc:"Voice Profile ID"`
	Body   struct {
		WorkspaceID      string `json:"workspace_id" doc:"Workspace ID"`
		ExpectedRevision int    `json:"expected_revision" minimum:"1" doc:"Revision loaded by the editor"`
	}
}

type DeleteVoiceProfileInput struct {
	PathID           string `path:"id" doc:"Voice Profile ID"`
	WorkspaceID      string `query:"workspace_id" required:"true" doc:"Workspace ID"`
	ExpectedRevision int    `query:"expected_revision" minimum:"1" doc:"Revision loaded by the editor"`
	Confirm          bool   `query:"confirm" doc:"Explicit deletion confirmation"`
}

type AssignVoiceProfileInput struct {
	PathAccountID string `path:"account_id" doc:"Connected social account ID"`
	Body          struct {
		WorkspaceID    string `json:"workspace_id" doc:"Workspace ID"`
		VoiceProfileID string `json:"voice_profile_id,omitempty" doc:"Voice Profile override; empty restores Workspace inheritance"`
	}
}

type ResolveEffectiveVoiceProfilesInput struct {
	Body struct {
		WorkspaceID               string   `json:"workspace_id" doc:"Workspace ID"`
		AccountIDs                []string `json:"account_ids" minItems:"1" maxItems:"100" uniqueItems:"true" doc:"Connected account IDs in requested order"`
		PublicationVoiceProfileID string   `json:"publication_voice_profile_id,omitempty" doc:"Temporary Publication-level override"`
	}
}

type VoiceProfileOutput struct {
	Body voiceprofiles.Profile
}

type VoiceProfileListOutput struct {
	Body []voiceprofiles.Profile
}

type EffectiveVoiceProfileOutput struct {
	Body voiceprofiles.EffectiveProfile
}

type EffectiveVoiceProfileListOutput struct {
	Body []voiceprofiles.EffectiveProfile
}

type DeleteVoiceProfileOutput struct {
	Body struct {
		Deleted bool `json:"deleted"`
	}
}

// RegisterRoutes registers contracts even when no database is configured. The
// OpenAPI generator relies on this; runtime calls return 503 in that case.
func (h *VoiceProfileHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-voice-profiles", Method: http.MethodGet, Path: voiceProfilesPath,
		Summary: "List Voice Profiles", Tags: []string{voiceProfilesTag}, Errors: []int{400, 403, 503},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.list)
	huma.Register(api, huma.Operation{
		OperationID: "create-voice-profile", Method: http.MethodPost, Path: voiceProfilesPath,
		Summary: "Create a Voice Profile", Tags: []string{voiceProfilesTag}, Errors: []int{400, 403, 409, 503},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.create)
	huma.Register(api, huma.Operation{
		OperationID: "resolve-effective-voice-profiles", Method: http.MethodPost, Path: voiceProfilesPath + "/effective",
		Summary: "Resolve effective Voice Profiles", Description: "Resolves Publication override, account override, then Workspace default in that order.",
		Tags: []string{voiceProfilesTag}, Errors: []int{400, 403, 404, 409, 503},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.resolve)
	huma.Register(api, huma.Operation{
		OperationID: "get-voice-profile", Method: http.MethodGet, Path: voiceProfilesPath + "/{id}",
		Summary: "Get a Voice Profile", Tags: []string{voiceProfilesTag}, Errors: []int{400, 403, 404, 503},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.get)
	huma.Register(api, huma.Operation{
		OperationID: "update-voice-profile", Method: http.MethodPut, Path: voiceProfilesPath + "/{id}",
		Summary: "Replace a Voice Profile", Tags: []string{voiceProfilesTag}, Errors: []int{400, 403, 404, 409, 503},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.update)
	huma.Register(api, huma.Operation{
		OperationID: "set-default-voice-profile", Method: http.MethodPost, Path: voiceProfilesPath + "/{id}/default",
		Summary: "Set the Workspace default Voice Profile", Tags: []string{voiceProfilesTag}, Errors: []int{400, 403, 404, 409, 503},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.setDefault)
	huma.Register(api, huma.Operation{
		OperationID: "delete-voice-profile", Method: http.MethodDelete, Path: voiceProfilesPath + "/{id}",
		Summary: "Delete a Voice Profile", Description: "The Workspace default cannot be deleted. Assigned accounts return to Workspace inheritance.",
		Tags: []string{voiceProfilesTag}, Errors: []int{400, 403, 404, 409, 503},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.delete)
	huma.Register(api, huma.Operation{
		OperationID: "assign-account-voice-profile", Method: http.MethodPut, Path: "/voice-profile-assignments/{account_id}",
		Summary: "Set an account Voice Profile override", Description: "An empty profile ID restores Workspace inheritance.",
		Tags: []string{voiceProfilesTag}, Errors: []int{400, 403, 404, 503},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.assignAccount)
}

func (h *VoiceProfileHandler) list(ctx context.Context, input *ListVoiceProfilesInput) (*VoiceProfileListOutput, error) {
	if err := h.requireWorkspaceAccess(ctx, input.WorkspaceID, false); err != nil {
		return nil, err
	}
	profiles, err := h.profiles.List(ctx, input.WorkspaceID)
	if err != nil {
		return nil, voiceProfileError(err)
	}
	return &VoiceProfileListOutput{Body: profiles}, nil
}

func (h *VoiceProfileHandler) create(ctx context.Context, input *CreateVoiceProfileInput) (*VoiceProfileOutput, error) {
	if err := h.requireWorkspaceAccess(ctx, input.Body.WorkspaceID, true); err != nil {
		return nil, err
	}
	profile, err := h.profiles.Create(ctx, voiceprofiles.CreateInput{
		WorkspaceID: input.Body.WorkspaceID, CreatedByID: middleware.GetUserID(ctx),
		Name: input.Body.Name, IsDefault: input.Body.IsDefault, Definition: input.Body.Definition,
	})
	if err != nil {
		return nil, voiceProfileError(err)
	}
	return &VoiceProfileOutput{Body: profile}, nil
}

func (h *VoiceProfileHandler) get(ctx context.Context, input *VoiceProfilePathInput) (*VoiceProfileOutput, error) {
	if err := h.requireWorkspaceAccess(ctx, input.WorkspaceID, false); err != nil {
		return nil, err
	}
	profile, err := h.profiles.Get(ctx, input.WorkspaceID, input.PathID)
	if err != nil {
		return nil, voiceProfileError(err)
	}
	return &VoiceProfileOutput{Body: profile}, nil
}

func (h *VoiceProfileHandler) update(ctx context.Context, input *UpdateVoiceProfileInput) (*VoiceProfileOutput, error) {
	if err := h.requireWorkspaceAccess(ctx, input.Body.WorkspaceID, true); err != nil {
		return nil, err
	}
	profile, err := h.profiles.Update(ctx, input.PathID, voiceprofiles.UpdateInput{
		WorkspaceID: input.Body.WorkspaceID, ExpectedRevision: input.Body.ExpectedRevision,
		Name: input.Body.Name, Definition: input.Body.Definition,
	})
	if err != nil {
		return nil, voiceProfileError(err)
	}
	return &VoiceProfileOutput{Body: profile}, nil
}

func (h *VoiceProfileHandler) setDefault(ctx context.Context, input *SetDefaultVoiceProfileInput) (*VoiceProfileOutput, error) {
	if err := h.requireWorkspaceAccess(ctx, input.Body.WorkspaceID, true); err != nil {
		return nil, err
	}
	profile, err := h.profiles.SetDefault(ctx, input.PathID, voiceprofiles.SetDefaultInput{
		WorkspaceID: input.Body.WorkspaceID, ExpectedRevision: input.Body.ExpectedRevision,
	})
	if err != nil {
		return nil, voiceProfileError(err)
	}
	return &VoiceProfileOutput{Body: profile}, nil
}

func (h *VoiceProfileHandler) delete(ctx context.Context, input *DeleteVoiceProfileInput) (*DeleteVoiceProfileOutput, error) {
	if !input.Confirm {
		return nil, huma.Error400BadRequest("confirm=true is required to delete a Voice Profile")
	}
	if err := h.requireWorkspaceAccess(ctx, input.WorkspaceID, true); err != nil {
		return nil, err
	}
	if err := h.profiles.Delete(ctx, input.PathID, voiceprofiles.DeleteInput{
		WorkspaceID: input.WorkspaceID, ExpectedRevision: input.ExpectedRevision,
	}); err != nil {
		return nil, voiceProfileError(err)
	}
	output := &DeleteVoiceProfileOutput{}
	output.Body.Deleted = true
	return output, nil
}

func (h *VoiceProfileHandler) assignAccount(ctx context.Context, input *AssignVoiceProfileInput) (*EffectiveVoiceProfileOutput, error) {
	if err := h.requireWorkspaceAccess(ctx, input.Body.WorkspaceID, true); err != nil {
		return nil, err
	}
	resolved, err := h.profiles.AssignAccount(ctx, voiceprofiles.AssignmentInput{
		WorkspaceID: input.Body.WorkspaceID, AccountID: input.PathAccountID,
		VoiceProfileID: input.Body.VoiceProfileID,
	})
	if err != nil {
		return nil, voiceProfileError(err)
	}
	return &EffectiveVoiceProfileOutput{Body: resolved}, nil
}

func (h *VoiceProfileHandler) resolve(ctx context.Context, input *ResolveEffectiveVoiceProfilesInput) (*EffectiveVoiceProfileListOutput, error) {
	if err := h.requireWorkspaceAccess(ctx, input.Body.WorkspaceID, false); err != nil {
		return nil, err
	}
	resolved, err := h.profiles.Resolve(ctx, voiceprofiles.ResolveInput{
		WorkspaceID: input.Body.WorkspaceID, AccountIDs: input.Body.AccountIDs,
		PublicationVoiceProfileID: input.Body.PublicationVoiceProfileID,
	})
	if err != nil {
		return nil, voiceProfileError(err)
	}
	return &EffectiveVoiceProfileListOutput{Body: resolved}, nil
}

func (h *VoiceProfileHandler) requireWorkspaceAccess(ctx context.Context, workspaceID string, edit bool) error {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	if h == nil || h.db == nil || h.profiles == nil {
		return huma.Error503ServiceUnavailable("Voice Profiles are unavailable")
	}
	var (
		allowed bool
		err     error
	)
	if edit {
		allowed, err = workspaceEditAllowed(ctx, h.db, workspaceID, middleware.GetUserID(ctx))
	} else {
		allowed, err = workspaceReadAllowed(ctx, h.db, workspaceID, middleware.GetUserID(ctx))
	}
	if err != nil {
		return huma.Error503ServiceUnavailable("Voice Profiles are temporarily unavailable")
	}
	if !allowed {
		if edit {
			return huma.Error403Forbidden("workspace editor role required")
		}
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	return nil
}

func voiceProfileError(err error) error {
	switch {
	case errors.Is(err, voiceprofiles.ErrInvalidInput):
		return huma.Error400BadRequest(err.Error())
	case errors.Is(err, voiceprofiles.ErrNotFound):
		return huma.Error404NotFound("Voice Profile or connected account not found")
	case errors.Is(err, voiceprofiles.ErrRevisionConflict):
		return huma.Error409Conflict("Voice Profile changed; reload it and try again")
	case errors.Is(err, voiceprofiles.ErrConflict):
		return huma.Error409Conflict("A Voice Profile with that name or default state already exists")
	case errors.Is(err, voiceprofiles.ErrDefaultRequired):
		return huma.Error409Conflict("Every Workspace must keep one default Voice Profile")
	default:
		return huma.Error503ServiceUnavailable("Voice Profiles are temporarily unavailable")
	}
}
