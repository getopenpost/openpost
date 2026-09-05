package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/videoprojects"
	"github.com/uptrace/bun"
)

const videoProjectsPath = "/video-projects"

type VideoProjectHandler struct {
	service *videoprojects.Service
	auth    middleware.Authenticator
}

func NewVideoProjectHandler(db *bun.DB, authenticator middleware.Authenticator) *VideoProjectHandler {
	return &VideoProjectHandler{service: videoprojects.NewService(db), auth: authenticator}
}

type VideoProjectResponse struct {
	ID                 string         `json:"id"`
	WorkspaceID        string         `json:"workspace_id"`
	Name               string         `json:"name"`
	HeadRevision       int64          `json:"head_revision"`
	Document           map[string]any `json:"document"`
	SyncStatus         string         `json:"sync_status" enum:"pending,uploading,saving,synced,needs_attention"`
	AttentionReason    string         `json:"attention_reason,omitempty"`
	PreviewObjectKey   string         `json:"preview_object_key,omitempty"`
	CreatedByUserID    string         `json:"created_by_user_id"`
	UpdatedByUserID    string         `json:"updated_by_user_id"`
	TrashedAt          string         `json:"trashed_at,omitempty"`
	RetentionExpiresAt string         `json:"retention_expires_at,omitempty"`
	CreatedAt          string         `json:"created_at"`
	UpdatedAt          string         `json:"updated_at"`
}

type CreateVideoProjectInput struct {
	Body struct {
		ID          string         `json:"id,omitempty" maxLength:"160" doc:"Optional client-generated idempotent project ID"`
		WorkspaceID string         `json:"workspace_id" minLength:"1" doc:"Owning Workspace ID"`
		Name        string         `json:"name" minLength:"1" maxLength:"160" doc:"Project name"`
		DeviceID    string         `json:"device_id,omitempty" maxLength:"160" doc:"Stable client device identifier"`
		Document    map[string]any `json:"document" doc:"Portable authored project document without device view state"`
	}
}

type ListVideoProjectsInput struct {
	WorkspaceID  string `query:"workspace_id" required:"true" doc:"Workspace ID"`
	IncludeTrash bool   `query:"include_trash" doc:"Include projects in Trash"`
}

type GetVideoProjectInput struct {
	PathID      string `path:"id" doc:"Video project ID"`
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID"`
}

type VideoProjectMutationOperationInput struct {
	Kind   string `json:"kind" enum:"set,delete" doc:"Mutation operation"`
	Target string `json:"target" minLength:"1" doc:"Stable entity or property conflict target"`
	Path   string `json:"path" minLength:"1" doc:"JSON Pointer within the authored document"`
	Value  any    `json:"value,omitempty" doc:"Replacement JSON value for a set operation"`
}

type ApplyVideoProjectMutationInput struct {
	PathID string `path:"id" doc:"Video project ID"`
	Body   struct {
		WorkspaceID  string                               `json:"workspace_id" minLength:"1"`
		MutationID   string                               `json:"mutation_id" minLength:"1" maxLength:"160" doc:"Client-generated idempotency key"`
		BaseRevision int64                                `json:"base_revision" minimum:"1"`
		DeviceID     string                               `json:"device_id,omitempty" maxLength:"160"`
		Operations   []VideoProjectMutationOperationInput `json:"operations" minItems:"1" maxItems:"1000"`
	}
}

type VideoProjectMutationResponse struct {
	Outcome        string                `json:"outcome" enum:"applied,conflict"`
	Revision       int64                 `json:"revision"`
	ConflictID     string                `json:"conflict_id,omitempty"`
	ConflictName   string                `json:"conflict_name,omitempty"`
	OverlapTargets []string              `json:"overlap_targets,omitempty"`
	Project        *VideoProjectResponse `json:"project"`
}

type VideoProjectConflictResponse struct {
	ID             string         `json:"id"`
	Name           string         `json:"name"`
	BaseRevision   int64          `json:"base_revision"`
	HeadRevision   int64          `json:"head_revision"`
	MutationID     string         `json:"mutation_id"`
	Document       map[string]any `json:"document"`
	OverlapTargets []string       `json:"overlap_targets"`
	AuthorUserID   string         `json:"author_user_id"`
	DeviceID       string         `json:"device_id,omitempty"`
	CreatedAt      string         `json:"created_at"`
}

type VideoProjectRevisionResponse struct {
	Revision             int64                            `json:"revision"`
	ParentRevision       int64                            `json:"parent_revision"`
	Kind                 string                           `json:"kind"`
	Document             map[string]any                   `json:"document"`
	TouchedTargets       []string                         `json:"touched_targets"`
	AuthorUserID         string                           `json:"author_user_id"`
	DeviceID             string                           `json:"device_id,omitempty"`
	MutationID           string                           `json:"mutation_id,omitempty"`
	RestoredFromRevision int64                            `json:"restored_from_revision,omitempty"`
	CreatedAt            string                           `json:"created_at"`
	ExpiresAt            string                           `json:"expires_at,omitempty"`
	CheckpointNames      []string                         `json:"checkpoint_names"`
	Checkpoints          []VideoProjectCheckpointResponse `json:"checkpoints"`
}

type VideoProjectCheckpointResponse struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Revision        int64  `json:"revision"`
	CreatedByUserID string `json:"created_by_user_id"`
	CreatedAt       string `json:"created_at"`
}

type ProjectAssetResponse struct {
	ID               string         `json:"id"`
	ProjectID        string         `json:"project_id"`
	WorkspaceID      string         `json:"workspace_id"`
	MediaID          string         `json:"media_id,omitempty"`
	StableMediaID    string         `json:"stable_media_id"`
	OriginalFilename string         `json:"original_filename"`
	MimeType         string         `json:"mime_type"`
	Size             int64          `json:"size"`
	SHA256           string         `json:"sha256,omitempty"`
	Status           string         `json:"status" enum:"pending,uploading,ready,needs_storage,failed"`
	AttentionReason  string         `json:"attention_reason,omitempty"`
	Preparation      map[string]any `json:"preparation"`
	Required         bool           `json:"required"`
	UploadedByUserID string         `json:"uploaded_by_user_id"`
	DeviceID         string         `json:"device_id,omitempty"`
	CreatedAt        string         `json:"created_at"`
	UpdatedAt        string         `json:"updated_at"`
}

type ReserveProjectAssetInput struct {
	PathID string `path:"id" doc:"Video project ID"`
	Body   struct {
		WorkspaceID      string         `json:"workspace_id" minLength:"1"`
		StableMediaID    string         `json:"stable_media_id" minLength:"1" maxLength:"160"`
		OriginalFilename string         `json:"original_filename" minLength:"1" maxLength:"500"`
		MimeType         string         `json:"mime_type" minLength:"1" maxLength:"160"`
		Size             int64          `json:"size" minimum:"1"`
		SHA256           string         `json:"sha256,omitempty" pattern:"^[a-fA-F0-9]{64}$"`
		Preparation      map[string]any `json:"preparation" doc:"Non-destructive trim, crop, rotation, gain, mute, and cover-frame recipe"`
		DeviceID         string         `json:"device_id,omitempty" maxLength:"160"`
	}
}

type ListProjectAssetsInput struct {
	PathID      string `path:"id" doc:"Video project ID"`
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID"`
}

type BeginProjectAssetUploadInput struct {
	PathID    string `path:"id" doc:"Video project ID"`
	PathAsset string `path:"asset_id" doc:"Project Asset ID"`
	Body      struct {
		WorkspaceID string `json:"workspace_id" minLength:"1"`
	}
}

type CreateVideoProjectCheckpointInput struct {
	PathID string `path:"id" doc:"Video project ID"`
	Body   struct {
		WorkspaceID string `json:"workspace_id" minLength:"1"`
		Name        string `json:"name" minLength:"1" maxLength:"160"`
	}
}

type RestoreVideoProjectRevisionInput struct {
	PathID string `path:"id" doc:"Video project ID"`
	Body   struct {
		WorkspaceID string `json:"workspace_id" minLength:"1"`
		Revision    int64  `json:"revision" minimum:"1"`
		DeviceID    string `json:"device_id,omitempty" maxLength:"160"`
	}
}

type DeleteVideoProjectCheckpointInput struct {
	PathID         string `path:"id" doc:"Video project ID"`
	PathCheckpoint string `path:"checkpoint_id" doc:"Checkpoint ID"`
	WorkspaceID    string `query:"workspace_id" required:"true" doc:"Workspace ID"`
}

type DeleteVideoProjectCheckpointOutput struct {
	Body struct {
		Deleted bool `json:"deleted"`
	}
}

type ResolveVideoProjectConflictInput struct {
	PathID       string `path:"id" doc:"Video project ID"`
	PathConflict string `path:"conflict_id" doc:"Conflict branch ID"`
	Body         struct {
		WorkspaceID string `json:"workspace_id" minLength:"1"`
		Resolution  string `json:"resolution" enum:"keep_current,use_conflict"`
		DeviceID    string `json:"device_id,omitempty" maxLength:"160"`
	}
}

type ChangeVideoProjectTrashInput struct {
	PathID string `path:"id" doc:"Video project ID"`
	Body   struct {
		WorkspaceID string `json:"workspace_id" minLength:"1"`
	}
}

type VideoProjectOutput struct {
	Body VideoProjectResponse
}

type VideoProjectListOutput struct {
	Body []VideoProjectResponse
}

type VideoProjectMutationOutput struct {
	Body VideoProjectMutationResponse
}

type VideoProjectConflictListOutput struct {
	Body []VideoProjectConflictResponse
}

type VideoProjectRevisionListOutput struct {
	Body []VideoProjectRevisionResponse
}

type VideoProjectCheckpointOutput struct {
	Body VideoProjectCheckpointResponse
}

type ProjectAssetOutput struct {
	Body ProjectAssetResponse
}

type ProjectAssetListOutput struct {
	Body []ProjectAssetResponse
}

func (h *VideoProjectHandler) RegisterRoutes(api huma.API) {
	auth := huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}
	huma.Register(api, huma.Operation{
		OperationID: "create-video-project", Method: http.MethodPost, Path: videoProjectsPath,
		Summary: "Create a Cloud Video Project", Tags: []string{"Video Projects"},
		Middlewares: auth, Errors: []int{400, 403},
	}, h.create)
	huma.Register(api, huma.Operation{
		OperationID: "list-video-projects", Method: http.MethodGet, Path: videoProjectsPath,
		Summary: "List Cloud Video Projects", Tags: []string{"Video Projects"},
		Middlewares: auth, Errors: []int{403},
	}, h.list)
	huma.Register(api, huma.Operation{
		OperationID: "get-video-project", Method: http.MethodGet, Path: videoProjectsPath + "/{id}",
		Summary: "Get a Cloud Video Project", Tags: []string{"Video Projects"},
		Middlewares: auth, Errors: []int{403, 404},
	}, h.get)
	huma.Register(api, huma.Operation{
		OperationID: "apply-video-project-mutation", Method: http.MethodPost, Path: videoProjectsPath + "/{id}/mutations",
		Summary: "Apply a versioned Video Project mutation batch", Description: "Disjoint stale changes rebase. Overlapping targets create a named conflict branch.",
		Tags: []string{"Video Projects"}, Middlewares: auth, Errors: []int{400, 403, 404, 409},
	}, h.applyMutation)
	huma.Register(api, huma.Operation{
		OperationID: "list-video-project-conflicts", Method: http.MethodGet, Path: videoProjectsPath + "/{id}/conflicts",
		Summary: "List unresolved Video Project conflict branches", Tags: []string{"Video Projects"},
		Middlewares: auth, Errors: []int{403, 404},
	}, h.listConflicts)
	huma.Register(api, huma.Operation{
		OperationID: "resolve-video-project-conflict", Method: http.MethodPost, Path: videoProjectsPath + "/{id}/conflicts/{conflict_id}/resolve",
		Summary: "Resolve a Video Project conflict branch", Description: "Keep the current head or promote the preserved conflict branch as a new head revision.",
		Tags: []string{"Video Projects"}, Middlewares: auth, Errors: []int{400, 403, 404, 409},
	}, h.resolveConflict)
	huma.Register(api, huma.Operation{
		OperationID: "list-video-project-revisions", Method: http.MethodGet, Path: videoProjectsPath + "/{id}/revisions",
		Summary: "List Video Project revision history", Tags: []string{"Video Projects"},
		Middlewares: auth, Errors: []int{403, 404},
	}, h.listRevisions)
	huma.Register(api, huma.Operation{
		OperationID: "create-video-project-checkpoint", Method: http.MethodPost, Path: videoProjectsPath + "/{id}/checkpoints",
		Summary: "Create a named Video Project checkpoint", Tags: []string{"Video Projects"},
		Middlewares: auth, Errors: []int{400, 403, 404},
	}, h.createCheckpoint)
	huma.Register(api, huma.Operation{
		OperationID: "delete-video-project-checkpoint", Method: http.MethodDelete, Path: videoProjectsPath + "/{id}/checkpoints/{checkpoint_id}",
		Summary: "Delete a named Video Project checkpoint", Tags: []string{"Video Projects"},
		Middlewares: auth, Errors: []int{400, 403, 404},
	}, h.deleteCheckpoint)
	huma.Register(api, huma.Operation{
		OperationID: "restore-video-project-revision", Method: http.MethodPost, Path: videoProjectsPath + "/{id}/restore-revision",
		Summary: "Restore a Video Project revision as a new head", Tags: []string{"Video Projects"},
		Middlewares: auth, Errors: []int{400, 403, 404, 409},
	}, h.restoreRevision)
	huma.Register(api, huma.Operation{
		OperationID: "trash-video-project", Method: http.MethodPost, Path: videoProjectsPath + "/{id}/trash",
		Summary: "Move a Video Project to Trash", Tags: []string{"Video Projects"},
		Middlewares: auth, Errors: []int{400, 403, 404},
	}, h.trash)
	huma.Register(api, huma.Operation{
		OperationID: "restore-video-project", Method: http.MethodPost, Path: videoProjectsPath + "/{id}/restore",
		Summary: "Restore a Video Project from Trash", Tags: []string{"Video Projects"},
		Middlewares: auth, Errors: []int{400, 403, 404},
	}, h.restoreTrash)
	huma.Register(api, huma.Operation{
		OperationID: "reserve-video-project-asset", Method: http.MethodPost, Path: videoProjectsPath + "/{id}/assets",
		Summary: "Reserve a Project Asset", Description: "Project Assets are private editing dependencies and do not appear in the Workspace Media Library.",
		Tags: []string{"Video Projects"}, Middlewares: auth, Errors: []int{400, 403, 404},
	}, h.reserveAsset)
	huma.Register(api, huma.Operation{
		OperationID: "list-video-project-assets", Method: http.MethodGet, Path: videoProjectsPath + "/{id}/assets",
		Summary: "List Project Assets", Tags: []string{"Video Projects"},
		Middlewares: auth, Errors: []int{403, 404},
	}, h.listAssets)
	huma.Register(api, huma.Operation{
		OperationID: "begin-video-project-asset-upload", Method: http.MethodPost, Path: videoProjectsPath + "/{id}/assets/{asset_id}/begin-upload",
		Summary: "Mark a Project Asset upload as started", Tags: []string{"Video Projects"},
		Middlewares: auth, Errors: []int{400, 403, 404},
	}, h.beginAssetUpload)
}

func (h *VideoProjectHandler) create(ctx context.Context, input *CreateVideoProjectInput) (*VideoProjectOutput, error) {
	document, err := json.Marshal(input.Body.Document)
	if err != nil {
		return nil, huma.Error400BadRequest("Invalid project document")
	}
	project, err := h.service.Create(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), videoprojects.CreateInput{
		ID:          input.Body.ID,
		WorkspaceID: input.Body.WorkspaceID,
		Name:        input.Body.Name,
		Document:    document,
		DeviceID:    input.Body.DeviceID,
	})
	if err != nil {
		return nil, videoProjectError(err, "create")
	}
	response, err := videoProjectResponse(project)
	if err != nil {
		return nil, err
	}
	return &VideoProjectOutput{Body: response}, nil
}

func (h *VideoProjectHandler) list(ctx context.Context, input *ListVideoProjectsInput) (*VideoProjectListOutput, error) {
	projects, err := h.service.List(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), input.WorkspaceID, input.IncludeTrash)
	if err != nil {
		return nil, videoProjectError(err, "list")
	}
	responses := make([]VideoProjectResponse, 0, len(projects))
	for i := range projects {
		response, err := videoProjectResponse(&projects[i])
		if err != nil {
			return nil, err
		}
		responses = append(responses, response)
	}
	return &VideoProjectListOutput{Body: responses}, nil
}

func (h *VideoProjectHandler) get(ctx context.Context, input *GetVideoProjectInput) (*VideoProjectOutput, error) {
	project, err := h.service.Get(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), input.WorkspaceID, input.PathID)
	if err != nil {
		return nil, videoProjectError(err, "load")
	}
	response, err := videoProjectResponse(project)
	if err != nil {
		return nil, err
	}
	return &VideoProjectOutput{Body: response}, nil
}

func (h *VideoProjectHandler) applyMutation(ctx context.Context, input *ApplyVideoProjectMutationInput) (*VideoProjectMutationOutput, error) {
	operations := make([]videoprojects.MutationOperation, 0, len(input.Body.Operations))
	for _, operation := range input.Body.Operations {
		var value json.RawMessage
		if operation.Kind == videoprojects.MutationSet {
			raw, err := json.Marshal(operation.Value)
			if err != nil {
				return nil, huma.Error400BadRequest("Invalid mutation value")
			}
			value = raw
		}
		operations = append(operations, videoprojects.MutationOperation{Kind: operation.Kind, Target: operation.Target, Path: operation.Path, Value: value})
	}
	result, err := h.service.ApplyMutation(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), videoprojects.ApplyMutationInput{
		WorkspaceID:  input.Body.WorkspaceID,
		ProjectID:    input.PathID,
		MutationID:   input.Body.MutationID,
		BaseRevision: input.Body.BaseRevision,
		DeviceID:     input.Body.DeviceID,
		Operations:   operations,
	})
	if err != nil {
		return nil, videoProjectError(err, "save")
	}
	project, err := videoProjectResponse(result.Project)
	if err != nil {
		return nil, err
	}
	return &VideoProjectMutationOutput{Body: VideoProjectMutationResponse{
		Outcome: result.Outcome, Revision: result.Revision, ConflictID: result.ConflictID,
		ConflictName: result.ConflictName, OverlapTargets: result.OverlapTargets, Project: &project,
	}}, nil
}

func (h *VideoProjectHandler) listConflicts(ctx context.Context, input *GetVideoProjectInput) (*VideoProjectConflictListOutput, error) {
	conflicts, err := h.service.ListConflicts(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), input.WorkspaceID, input.PathID)
	if err != nil {
		return nil, videoProjectError(err, "list conflicts")
	}
	responses := make([]VideoProjectConflictResponse, 0, len(conflicts))
	for _, conflict := range conflicts {
		document := map[string]any{}
		if err := json.Unmarshal(conflict.Document, &document); err != nil {
			return nil, huma.Error500InternalServerError("Stored project conflict is invalid")
		}
		responses = append(responses, VideoProjectConflictResponse{
			ID: conflict.ID, Name: conflict.Name, BaseRevision: conflict.BaseRevision,
			HeadRevision: conflict.HeadRevision, MutationID: conflict.MutationID, Document: document,
			OverlapTargets: conflict.OverlapTargets, AuthorUserID: conflict.AuthorUserID,
			DeviceID: conflict.DeviceID, CreatedAt: conflict.CreatedAt.UTC().Format(time.RFC3339Nano),
		})
	}
	return &VideoProjectConflictListOutput{Body: responses}, nil
}

func (h *VideoProjectHandler) resolveConflict(ctx context.Context, input *ResolveVideoProjectConflictInput) (*VideoProjectOutput, error) {
	project, err := h.service.ResolveConflict(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), videoprojects.ResolveConflictInput{
		WorkspaceID: input.Body.WorkspaceID, ProjectID: input.PathID, ConflictID: input.PathConflict,
		Resolution: input.Body.Resolution, DeviceID: input.Body.DeviceID,
	})
	if err != nil {
		return nil, videoProjectError(err, "resolve conflict for")
	}
	response, err := videoProjectResponse(project)
	if err != nil {
		return nil, err
	}
	return &VideoProjectOutput{Body: response}, nil
}

func (h *VideoProjectHandler) listRevisions(ctx context.Context, input *GetVideoProjectInput) (*VideoProjectRevisionListOutput, error) {
	revisions, err := h.service.ListRevisions(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), input.WorkspaceID, input.PathID)
	if err != nil {
		return nil, videoProjectError(err, "list revisions")
	}
	responses := make([]VideoProjectRevisionResponse, 0, len(revisions))
	for _, revision := range revisions {
		document := map[string]any{}
		if err := json.Unmarshal(revision.Document, &document); err != nil {
			return nil, huma.Error500InternalServerError("Stored project revision is invalid")
		}
		response := VideoProjectRevisionResponse{
			Revision: revision.Revision, ParentRevision: revision.ParentRevision, Kind: revision.Kind,
			Document: document, TouchedTargets: revision.TouchedTargets, AuthorUserID: revision.AuthorUserID,
			DeviceID: revision.DeviceID, MutationID: revision.MutationID, RestoredFromRevision: revision.RestoredFrom,
			CreatedAt:       revision.CreatedAt.UTC().Format(time.RFC3339Nano),
			CheckpointNames: revision.CheckpointNames,
			Checkpoints:     make([]VideoProjectCheckpointResponse, 0, len(revision.Checkpoints)),
		}
		for _, checkpoint := range revision.Checkpoints {
			response.Checkpoints = append(response.Checkpoints, VideoProjectCheckpointResponse{
				ID: checkpoint.ID, Name: checkpoint.Name, Revision: checkpoint.Revision,
				CreatedByUserID: checkpoint.CreatedByUserID,
				CreatedAt:       checkpoint.CreatedAt.UTC().Format(time.RFC3339Nano),
			})
		}
		if !revision.ExpiresAt.IsZero() {
			response.ExpiresAt = revision.ExpiresAt.UTC().Format(time.RFC3339Nano)
		}
		responses = append(responses, response)
	}
	return &VideoProjectRevisionListOutput{Body: responses}, nil
}

func (h *VideoProjectHandler) createCheckpoint(ctx context.Context, input *CreateVideoProjectCheckpointInput) (*VideoProjectCheckpointOutput, error) {
	checkpoint, err := h.service.CreateCheckpoint(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), input.Body.WorkspaceID, input.PathID, input.Body.Name)
	if err != nil {
		return nil, videoProjectError(err, "create checkpoint for")
	}
	return &VideoProjectCheckpointOutput{Body: VideoProjectCheckpointResponse{
		ID: checkpoint.ID, Name: checkpoint.Name, Revision: checkpoint.Revision,
		CreatedByUserID: checkpoint.CreatedByUserID, CreatedAt: checkpoint.CreatedAt.UTC().Format(time.RFC3339Nano),
	}}, nil
}

func (h *VideoProjectHandler) deleteCheckpoint(ctx context.Context, input *DeleteVideoProjectCheckpointInput) (*DeleteVideoProjectCheckpointOutput, error) {
	if err := h.service.DeleteCheckpoint(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), input.WorkspaceID, input.PathID, input.PathCheckpoint); err != nil {
		return nil, videoProjectError(err, "delete checkpoint from")
	}
	output := &DeleteVideoProjectCheckpointOutput{}
	output.Body.Deleted = true
	return output, nil
}

func (h *VideoProjectHandler) restoreRevision(ctx context.Context, input *RestoreVideoProjectRevisionInput) (*VideoProjectOutput, error) {
	project, err := h.service.RestoreRevision(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), input.Body.WorkspaceID, input.PathID, input.Body.Revision, input.Body.DeviceID)
	if err != nil {
		return nil, videoProjectError(err, "restore revision for")
	}
	response, err := videoProjectResponse(project)
	if err != nil {
		return nil, err
	}
	return &VideoProjectOutput{Body: response}, nil
}

func (h *VideoProjectHandler) trash(ctx context.Context, input *ChangeVideoProjectTrashInput) (*VideoProjectOutput, error) {
	project, err := h.service.Trash(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), input.Body.WorkspaceID, input.PathID)
	if err != nil {
		return nil, videoProjectError(err, "trash")
	}
	response, err := videoProjectResponse(project)
	if err != nil {
		return nil, err
	}
	return &VideoProjectOutput{Body: response}, nil
}

func (h *VideoProjectHandler) restoreTrash(ctx context.Context, input *ChangeVideoProjectTrashInput) (*VideoProjectOutput, error) {
	project, err := h.service.RestoreTrash(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), input.Body.WorkspaceID, input.PathID)
	if err != nil {
		return nil, videoProjectError(err, "restore")
	}
	response, err := videoProjectResponse(project)
	if err != nil {
		return nil, err
	}
	return &VideoProjectOutput{Body: response}, nil
}

func (h *VideoProjectHandler) reserveAsset(ctx context.Context, input *ReserveProjectAssetInput) (*ProjectAssetOutput, error) {
	preparation, err := json.Marshal(input.Body.Preparation)
	if err != nil {
		return nil, huma.Error400BadRequest("Invalid preparation recipe")
	}
	asset, err := h.service.ReserveAsset(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), videoprojects.ReserveAssetInput{
		WorkspaceID: input.Body.WorkspaceID, ProjectID: input.PathID, StableMediaID: input.Body.StableMediaID,
		OriginalFilename: input.Body.OriginalFilename, MimeType: input.Body.MimeType, Size: input.Body.Size,
		SHA256: input.Body.SHA256, Preparation: preparation, DeviceID: input.Body.DeviceID,
	})
	if err != nil {
		return nil, videoProjectError(err, "reserve asset for")
	}
	response, err := projectAssetResponse(asset)
	if err != nil {
		return nil, err
	}
	return &ProjectAssetOutput{Body: response}, nil
}

func (h *VideoProjectHandler) listAssets(ctx context.Context, input *ListProjectAssetsInput) (*ProjectAssetListOutput, error) {
	assets, err := h.service.ListAssets(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), input.WorkspaceID, input.PathID)
	if err != nil {
		return nil, videoProjectError(err, "list assets for")
	}
	responses := make([]ProjectAssetResponse, 0, len(assets))
	for i := range assets {
		response, err := projectAssetResponse(&assets[i])
		if err != nil {
			return nil, err
		}
		responses = append(responses, response)
	}
	return &ProjectAssetListOutput{Body: responses}, nil
}

func (h *VideoProjectHandler) beginAssetUpload(ctx context.Context, input *BeginProjectAssetUploadInput) (*ProjectAssetOutput, error) {
	asset, err := h.service.BeginAssetUpload(ctx, workspaceActor(ctx, middleware.GetUserID(ctx)), input.Body.WorkspaceID, input.PathID, input.PathAsset)
	if err != nil {
		return nil, videoProjectError(err, "begin asset upload for")
	}
	response, err := projectAssetResponse(asset)
	if err != nil {
		return nil, err
	}
	return &ProjectAssetOutput{Body: response}, nil
}

func projectAssetResponse(asset *models.ProjectAsset) (ProjectAssetResponse, error) {
	preparation := map[string]any{}
	if asset == nil || json.Unmarshal([]byte(asset.PreparationJSON), &preparation) != nil {
		return ProjectAssetResponse{}, huma.Error500InternalServerError("Stored Project Asset preparation is invalid")
	}
	return ProjectAssetResponse{
		ID: asset.ID, ProjectID: asset.ProjectID, WorkspaceID: asset.WorkspaceID, MediaID: asset.MediaID,
		StableMediaID: asset.StableMediaID, OriginalFilename: asset.OriginalFilename, MimeType: asset.MimeType,
		Size: asset.Size, SHA256: asset.SHA256, Status: asset.Status, AttentionReason: asset.AttentionReason,
		Preparation: preparation, Required: asset.Required, UploadedByUserID: asset.UploadedByUserID, DeviceID: asset.DeviceID,
		CreatedAt: asset.CreatedAt.UTC().Format(time.RFC3339Nano), UpdatedAt: asset.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}, nil
}

func videoProjectResponse(project *models.VideoProject) (VideoProjectResponse, error) {
	document := map[string]any{}
	if project == nil || json.Unmarshal([]byte(project.DocumentJSON), &document) != nil {
		return VideoProjectResponse{}, huma.Error500InternalServerError("Stored project document is invalid")
	}
	response := VideoProjectResponse{
		ID: project.ID, WorkspaceID: project.WorkspaceID, Name: project.Name,
		HeadRevision: project.HeadRevision, Document: document, SyncStatus: project.SyncStatus,
		AttentionReason: project.AttentionReason, PreviewObjectKey: project.PreviewObjectKey,
		CreatedByUserID: project.CreatedByUserID, UpdatedByUserID: project.UpdatedByUserID,
		CreatedAt: project.CreatedAt.UTC().Format(time.RFC3339Nano), UpdatedAt: project.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
	if !project.TrashedAt.IsZero() {
		response.TrashedAt = project.TrashedAt.UTC().Format(time.RFC3339Nano)
	}
	if !project.RetentionExpiresAt.IsZero() {
		response.RetentionExpiresAt = project.RetentionExpiresAt.UTC().Format(time.RFC3339Nano)
	}
	return response, nil
}

func videoProjectError(err error, action string) error {
	switch {
	case errors.Is(err, videoprojects.ErrInvalid):
		return huma.Error400BadRequest("Invalid Video Project request")
	case errors.Is(err, videoprojects.ErrForbidden):
		return huma.Error403Forbidden("Workspace role does not allow this Video Project action")
	case errors.Is(err, videoprojects.ErrNotFound):
		return huma.Error404NotFound("Video Project not found")
	case errors.Is(err, videoprojects.ErrRevisionChanged):
		return huma.Error409Conflict("Video Project changed while saving; retry the mutation")
	default:
		return huma.Error500InternalServerError("Failed to " + strings.TrimSpace(action) + " Video Project")
	}
}
