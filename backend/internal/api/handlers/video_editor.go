package handlers

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/openpost/backend/internal/videoproject"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

const (
	videoProjectRevisionTTL     = 30 * 24 * time.Hour
	videoProjectSnapshotVersion = 1
	videoProjectAssetSource     = "source"
	videoProjectAssetCover      = "cover"
	videoProjectAssetWriteChunk = 200
)

var errVideoProjectRevisionConflict = errors.New("video project revision conflict")

type VideoEditorHandler struct {
	db             *bun.DB
	auth           middleware.Authenticator
	modelBaseURL   string
	stockProviders []string
	entitlement    entitlements.Service
}

func (h *VideoEditorHandler) SetEntitlement(service entitlements.Service) {
	if service != nil {
		h.entitlement = service
	}
}

func (h *VideoEditorHandler) SetStockProviders(providers []string) {
	h.stockProviders = append([]string(nil), providers...)
}

func NewVideoEditorHandler(
	db *bun.DB,
	authenticator middleware.Authenticator,
	modelBaseURL string,
) *VideoEditorHandler {
	return &VideoEditorHandler{
		db:           db,
		auth:         authenticator,
		modelBaseURL: strings.TrimRight(strings.TrimSpace(modelBaseURL), "/"),
		entitlement:  entitlements.NewSelfHostedService(),
	}
}

type VideoEditorModelManifestItem struct {
	ID                 string   `json:"id"`
	Kind               string   `json:"kind" enum:"transcription,vad,reframing"`
	Version            string   `json:"version"`
	SizeBytes          int64    `json:"size_bytes"`
	RuntimeBytesWASM   int64    `json:"runtime_bytes_wasm"`
	RuntimeBytesWebGPU int64    `json:"runtime_bytes_webgpu"`
	URL                string   `json:"url"`
	SHA256             string   `json:"sha256"`
	RequiredBackends   []string `json:"required_backends"`
	Fingerprint        string   `json:"fingerprint"`
	Resumable          bool     `json:"resumable"`
	LicenseName        string   `json:"license_name"`
	LicenseURL         string   `json:"license_url"`
	LicenseReference   string   `json:"license_reference"`
}

type VideoEditorConfigOutput struct {
	Body struct {
		Enabled        bool                           `json:"enabled"`
		SchemaVersion  int                            `json:"schema_version"`
		Limits         VideoEditorLimits              `json:"limits"`
		ModelManifest  []VideoEditorModelManifestItem `json:"model_manifest"`
		StockProviders []string                       `json:"stock_providers"`
	}
}

type VideoEditorLimits struct {
	MaxDurationSeconds int `json:"max_duration_seconds"`
	MaxSources         int `json:"max_sources"`
	MaxDocumentBytes   int `json:"max_document_bytes"`
	MaxExportWidth     int `json:"max_export_width"`
	MaxExportHeight    int `json:"max_export_height"`
	MaxExportFPS       int `json:"max_export_fps"`
}

type VideoProjectResponse struct {
	ID                  string                `json:"id"`
	WorkspaceID         string                `json:"workspace_id"`
	CreatedByID         string                `json:"created_by_id"`
	Revision            int                   `json:"revision"`
	CanEdit             bool                  `json:"can_edit"`
	DurationMS          int64                 `json:"duration_ms"`
	CoverPreviewMediaID string                `json:"cover_preview_media_id,omitempty"`
	CreatedAt           string                `json:"created_at"`
	UpdatedAt           string                `json:"updated_at"`
	Document            videoproject.Document `json:"document"`
}

type videoProjectRevisionSnapshot struct {
	SnapshotVersion     int                   `json:"snapshot_version"`
	Document            videoproject.Document `json:"document"`
	CoverPreviewMediaID string                `json:"cover_preview_media_id,omitempty"`
}

type VideoProjectSummary struct {
	ID                  string `json:"id"`
	Title               string `json:"title"`
	Revision            int    `json:"revision"`
	DurationMS          int64  `json:"duration_ms"`
	SourceCount         int    `json:"source_count"`
	CoverPreviewMediaID string `json:"cover_preview_media_id,omitempty"`
	CreatedAt           string `json:"created_at"`
	UpdatedAt           string `json:"updated_at"`
}

type ListVideoProjectsInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
	Search      string `query:"search"`
	Limit       int    `query:"limit" minimum:"1" maximum:"100"`
	Offset      int    `query:"offset" minimum:"0"`
}

type ListVideoProjectsOutput struct {
	Body struct {
		Projects []VideoProjectSummary `json:"projects"`
		Total    int                   `json:"total"`
		CanEdit  bool                  `json:"can_edit"`
	}
}

type CreateVideoProjectInput struct {
	Body struct {
		WorkspaceID         string                `json:"workspace_id"`
		ClientRequestID     string                `json:"client_request_id" maxLength:"200"`
		CoverPreviewMediaID string                `json:"cover_preview_media_id,omitempty"`
		Document            videoproject.Document `json:"document"`
	}
}

type CreateVideoProjectOutput struct {
	Body VideoProjectResponse
}

type GetVideoProjectInput struct {
	PathID string `path:"id"`
}

type GetVideoProjectOutput struct {
	Body VideoProjectResponse
}

type UpdateVideoProjectInput struct {
	PathID string `path:"id"`
	Body   struct {
		ExpectedRevision    int                   `json:"expected_revision" minimum:"1"`
		CoverPreviewMediaID string                `json:"cover_preview_media_id,omitempty"`
		Document            videoproject.Document `json:"document"`
	}
}

type UpdateVideoProjectOutput struct {
	Body VideoProjectResponse
}

type DeleteVideoProjectInput struct {
	PathID string `path:"id"`
}

type DeleteVideoProjectOutput struct {
	Body struct {
		Deleted bool `json:"deleted"`
	}
}

type ListVideoProjectRevisionsInput struct {
	PathID string `path:"id"`
	Cursor string `query:"cursor" maxLength:"1024"`
	Limit  int    `query:"limit" minimum:"1" maximum:"100"`
}

type VideoProjectRevisionSummary struct {
	ID        string              `json:"id"`
	Revision  int                 `json:"revision"`
	Kind      string              `json:"kind"`
	Name      string              `json:"name,omitempty"`
	CreatedAt string              `json:"created_at"`
	ExpiresAt string              `json:"expires_at,omitempty"`
	Actor     EditorRevisionActor `json:"actor"`
}

type ListVideoProjectRevisionsOutput struct {
	Body struct {
		Revisions  []VideoProjectRevisionSummary `json:"revisions"`
		NextCursor string                        `json:"next_cursor,omitempty"`
	}
}

type GetVideoProjectRevisionInput struct {
	PathID     string `path:"id"`
	RevisionID string `path:"revision_id"`
}

type VideoProjectRevisionResponse struct {
	Summary             VideoProjectRevisionSummary `json:"summary"`
	CoverPreviewMediaID string                      `json:"cover_preview_media_id,omitempty"`
	Document            videoproject.Document       `json:"document"`
}

type GetVideoProjectRevisionOutput struct {
	Body VideoProjectRevisionResponse
}

type CreateVideoProjectCheckpointInput struct {
	PathID string `path:"id"`
	Body   struct {
		Name             string `json:"name" minLength:"1" maxLength:"100"`
		ExpectedRevision int    `json:"expected_revision" minimum:"1"`
	}
}

type CreateVideoProjectCheckpointOutput struct {
	Body VideoProjectRevisionSummary
}

type RestoreVideoProjectRevisionInput struct {
	PathID     string `path:"id"`
	RevisionID string `path:"revision_id"`
	Body       struct {
		ExpectedRevision int `json:"expected_revision" minimum:"1"`
	}
}

type RestoreVideoProjectRevisionOutput struct {
	Body VideoProjectResponse
}

type VideoEditorSyncSource struct {
	SourceID     string `json:"source_id" minLength:"1" maxLength:"200"`
	SHA256       string `json:"sha256" minLength:"64" maxLength:"64"`
	SizeBytes    int64  `json:"size_bytes" minimum:"0"`
	MIMEType     string `json:"mime_type" minLength:"1" maxLength:"200"`
	OriginalName string `json:"original_name" minLength:"1" maxLength:"500"`
}

type PlanVideoEditorSyncInput struct {
	WorkspaceID string `header:"X-OpenPost-Workspace-ID" required:"true" doc:"Active workspace ID"`
	Body        struct {
		ProjectID string                  `json:"project_id,omitempty" maxLength:"200"`
		Sources   []VideoEditorSyncSource `json:"sources" maxItems:"250"`
	}
}

//nolint:gocyclo // Sync planning keeps validation, workspace scoping, reuse, and quota branches explicit.
func (h *VideoEditorHandler) planSync(
	ctx context.Context,
	input *PlanVideoEditorSyncInput,
) (*PlanVideoEditorSyncOutput, error) {
	workspaceID := strings.TrimSpace(input.WorkspaceID)
	if workspaceID == "" {
		return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	if _, err := h.requireAccess(ctx, workspaceID, true); err != nil {
		return nil, err
	}
	if projectID := strings.TrimSpace(input.Body.ProjectID); projectID != "" {
		exists, err := h.db.NewSelect().
			Model((*models.VideoProject)(nil)).
			Where("id = ? AND workspace_id = ? AND deleted_at IS NULL", projectID, workspaceID).
			Exists(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to validate the OpenPost Video Editor project")
		}
		if !exists {
			return nil, huma.Error400BadRequest("the OpenPost Video Editor project does not belong to this workspace")
		}
	}

	out := &PlanVideoEditorSyncOutput{}
	out.Body.Reused = []VideoEditorSyncReuse{}
	out.Body.MissingSourceIDs = []string{}
	out.Body.Allowed = true
	seenSourceIDs := map[string]struct{}{}
	missingHashes := map[string]struct{}{}
	for _, source := range input.Body.Sources {
		sourceID := strings.TrimSpace(source.SourceID)
		hash := strings.ToLower(strings.TrimSpace(source.SHA256))
		if sourceID == "" || len(hash) != sha256.Size*2 {
			return nil, huma.Error400BadRequest("every sync source requires a source ID and SHA-256 hash")
		}
		if _, err := hex.DecodeString(hash); err != nil {
			return nil, huma.Error400BadRequest("sync source SHA-256 values must be hexadecimal")
		}
		if source.SizeBytes < 0 || strings.TrimSpace(source.MIMEType) == "" ||
			strings.TrimSpace(source.OriginalName) == "" {
			return nil, huma.Error400BadRequest("sync source metadata is invalid")
		}
		if _, duplicate := seenSourceIDs[sourceID]; duplicate {
			return nil, huma.Error400BadRequest("sync source IDs must be unique")
		}
		seenSourceIDs[sourceID] = struct{}{}

		var media models.MediaAttachment
		err := h.db.NewSelect().
			Model(&media).
			Column("id", "size", "mime_type", "file_hash", "processing_status").
			Where("workspace_id = ? AND LOWER(file_hash) = ?", workspaceID, hash).
			Where("processing_status = ?", mediaReadyStatus).
			OrderExpr("created_at ASC").
			Limit(1).
			Scan(ctx)
		switch {
		case err == nil:
			if media.Size != source.SizeBytes || !strings.EqualFold(media.MimeType, source.MIMEType) {
				out.Body.MissingSourceIDs = append(out.Body.MissingSourceIDs, sourceID)
				if _, counted := missingHashes[hash]; !counted {
					out.Body.AdditionalBytes += source.SizeBytes
					missingHashes[hash] = struct{}{}
				}
				continue
			}
			out.Body.Reused = append(out.Body.Reused, VideoEditorSyncReuse{
				SourceID: sourceID,
				MediaID:  media.ID,
			})
		case errors.Is(err, sql.ErrNoRows):
			out.Body.MissingSourceIDs = append(out.Body.MissingSourceIDs, sourceID)
			if _, counted := missingHashes[hash]; !counted {
				out.Body.AdditionalBytes += source.SizeBytes
				missingHashes[hash] = struct{}{}
			}
		default:
			return nil, huma.Error500InternalServerError("failed to plan OpenPost Video Editor source reuse")
		}
	}

	err := h.db.NewSelect().
		Model((*models.MediaAttachment)(nil)).
		ColumnExpr("COALESCE(SUM(size), 0)").
		Where("workspace_id = ?", workspaceID).
		Where("(asset_kind NOT IN (?, ?) OR asset_kind = '' OR asset_kind IS NULL)", "design_preview", "template_preview").
		Scan(ctx, &out.Body.Storage.UsedBytes)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load workspace media storage")
	}
	if out.Body.AdditionalBytes > 0 {
		decision, err := h.entitlement.Check(ctx, entitlements.Request{
			WorkspaceID: workspaceID,
			UserID:      middleware.GetUserID(ctx),
			Limit:       entitlements.LimitMediaBytesStored,
			Current:     out.Body.Storage.UsedBytes,
			Amount:      out.Body.AdditionalBytes,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to check workspace media storage")
		}
		out.Body.Allowed = decision.Allowed
		if !decision.Unlimited {
			limit := decision.Limit
			remaining := max(int64(0), limit-out.Body.Storage.UsedBytes)
			out.Body.Storage.LimitBytes = &limit
			out.Body.Storage.RemainingBytes = &remaining
		}
		if !decision.Allowed {
			reason := strings.TrimSpace(decision.Reason)
			if reason == "" {
				reason = "Workspace media storage is full."
			}
			out.Body.Reason = &reason
		}
	}
	return out, nil
}

type VideoEditorSyncReuse struct {
	SourceID string `json:"source_id"`
	MediaID  string `json:"media_id"`
}

type VideoEditorSyncStorage struct {
	UsedBytes      int64  `json:"used_bytes"`
	LimitBytes     *int64 `json:"limit_bytes"`
	RemainingBytes *int64 `json:"remaining_bytes"`
}

type PlanVideoEditorSyncOutput struct {
	Body struct {
		Reused           []VideoEditorSyncReuse `json:"reused"`
		MissingSourceIDs []string               `json:"missing_source_ids"`
		AdditionalBytes  int64                  `json:"additional_bytes"`
		Storage          VideoEditorSyncStorage `json:"storage"`
		Allowed          bool                   `json:"allowed"`
		Reason           *string                `json:"reason"`
	}
}

type CreateVideoReturnTokenInput struct {
	Body struct {
		WorkspaceID string         `json:"workspace_id"`
		ReturnURL   string         `json:"return_url"`
		Purpose     string         `json:"purpose" maxLength:"64"`
		Constraints map[string]any `json:"constraints"`
	}
}

type CreateVideoReturnTokenOutput struct {
	Body struct {
		Token     string `json:"token"`
		ExpiresAt string `json:"expires_at"`
	}
}

type VideoReturnExport struct {
	VariantID    string   `json:"variant_id" enum:"portrait,feed-portrait,square,landscape"`
	MediaID      string   `json:"media_id"`
	Width        int      `json:"width"`
	Height       int      `json:"height"`
	DurationMS   int64    `json:"duration_ms"`
	RenditionIDs []string `json:"rendition_ids"`
}

type VideoReturnResult struct {
	ProjectID string              `json:"project_id"`
	Exports   []VideoReturnExport `json:"exports"`
}

type CompleteVideoReturnTokenInput struct {
	Token string `path:"token"`
	Body  VideoReturnResult
}

type CompleteVideoReturnTokenOutput struct {
	Body struct {
		ReturnURL string `json:"return_url"`
	}
}

type ConsumeVideoReturnTokenInput struct {
	Token string `path:"token"`
}

type ConsumeVideoReturnTokenOutput struct {
	Body struct {
		WorkspaceID string            `json:"workspace_id"`
		ReturnURL   string            `json:"return_url"`
		Purpose     string            `json:"purpose"`
		Constraints map[string]any    `json:"constraints"`
		Result      VideoReturnResult `json:"result"`
	}
}

func (h *VideoEditorHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-video-editor-config",
		Method:      http.MethodGet,
		Path:        "/video-editor/config",
		Summary:     "Get OpenPost Video Editor browser limits and optional local model manifest",
		Tags:        []string{tagVideoEditor},
	}, h.getConfig)

	auth := huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}
	huma.Register(api, huma.Operation{
		OperationID: "list-video-editor-projects", Method: http.MethodGet,
		Path: "/video-editor/projects", Summary: "List cloud-saved OpenPost Video Editor projects",
		Tags: []string{tagVideoEditor}, Middlewares: auth, Errors: []int{400, 403},
	}, h.listProjects)
	huma.Register(api, huma.Operation{
		OperationID: "plan-video-editor-sync", Method: http.MethodPost,
		Path: "/video-editor/sync-plan", Summary: "Estimate and deduplicate an explicit OpenPost Video Editor cloud sync",
		Tags: []string{tagVideoEditor}, Middlewares: auth, Errors: []int{400, 403},
	}, h.planSync)
	huma.Register(api, huma.Operation{
		OperationID: "create-video-editor-project", Method: http.MethodPost,
		Path: "/video-editor/projects", Summary: "Save a local OpenPost Video Editor project to OpenPost",
		Tags: []string{tagVideoEditor}, Middlewares: auth, Errors: []int{400, 403},
		DefaultStatus: http.StatusCreated,
	}, h.createProject)
	huma.Register(api, huma.Operation{
		OperationID: "get-video-editor-project", Method: http.MethodGet,
		Path: "/video-editor/projects/{id}", Summary: "Get a cloud-saved OpenPost Video Editor project",
		Tags: []string{tagVideoEditor}, Middlewares: auth, Errors: []int{403, 404},
	}, h.getProject)
	huma.Register(api, huma.Operation{
		OperationID: "update-video-editor-project", Method: http.MethodPatch,
		Path: "/video-editor/projects/{id}", Summary: "Save an OpenPost Video Editor project with optimistic concurrency",
		Tags: []string{tagVideoEditor}, Middlewares: auth, Errors: []int{400, 403, 404, 409},
	}, h.updateProject)
	huma.Register(api, huma.Operation{
		OperationID: "delete-video-editor-project", Method: http.MethodDelete,
		Path: "/video-editor/projects/{id}", Summary: "Move an OpenPost Video Editor project to trash",
		Tags: []string{tagVideoEditor}, Middlewares: auth, Errors: []int{403, 404},
	}, h.deleteProject)
	huma.Register(api, huma.Operation{
		OperationID: "list-video-editor-project-revisions", Method: http.MethodGet,
		Path: "/video-editor/projects/{id}/revisions", Summary: "List OpenPost Video Editor recovery revisions and checkpoints",
		Tags: []string{tagVideoEditor}, Middlewares: auth, Errors: []int{400, 403, 404},
	}, h.listRevisions)
	huma.Register(api, huma.Operation{
		OperationID: "get-video-editor-project-revision", Method: http.MethodGet,
		Path: "/video-editor/projects/{id}/revisions/{revision_id}", Summary: "Inspect an OpenPost Video Editor project revision",
		Tags: []string{tagVideoEditor}, Middlewares: auth, Errors: []int{400, 403, 404},
	}, h.getRevision)
	huma.Register(api, huma.Operation{
		OperationID: "create-video-editor-project-checkpoint", Method: http.MethodPost,
		Path: "/video-editor/projects/{id}/checkpoints", Summary: "Create a named OpenPost Video Editor checkpoint",
		Tags: []string{tagVideoEditor}, Middlewares: auth, Errors: []int{400, 403, 404, 409},
	}, h.createCheckpoint)
	huma.Register(api, huma.Operation{
		OperationID: "restore-video-editor-project-revision", Method: http.MethodPost,
		Path:    "/video-editor/projects/{id}/revisions/{revision_id}/restore",
		Summary: "Restore an OpenPost Video Editor revision as a new head",
		Tags:    []string{tagVideoEditor}, Middlewares: auth, Errors: []int{400, 403, 404, 409},
	}, h.restoreRevision)
	huma.Register(api, huma.Operation{
		OperationID: "create-video-editor-return-token", Method: http.MethodPost,
		Path: "/video-editor/return-tokens", Summary: "Create a one-time OpenPost Video Editor composer return token",
		Tags: []string{tagVideoEditor}, Middlewares: auth, Errors: []int{400, 403},
		DefaultStatus: http.StatusCreated,
	}, h.createReturnToken)
	huma.Register(api, huma.Operation{
		OperationID: "complete-video-editor-return-token", Method: http.MethodPost,
		Path:    "/video-editor/return-tokens/{token}/complete",
		Summary: "Store OpenPost Video Editor variant-to-rendition export assignments",
		Tags:    []string{tagVideoEditor}, Middlewares: auth, Errors: []int{400, 403, 404, 409},
	}, h.completeReturnToken)
	huma.Register(api, huma.Operation{
		OperationID: "consume-video-editor-return-token", Method: http.MethodPost,
		Path:    "/video-editor/return-tokens/{token}/consume",
		Summary: "Consume completed OpenPost Video Editor export assignments once",
		Tags:    []string{tagVideoEditor}, Middlewares: auth, Errors: []int{400, 403, 404, 409},
	}, h.consumeReturnToken)
}

func (h *VideoEditorHandler) getConfig(
	_ context.Context,
	_ *struct{},
) (*VideoEditorConfigOutput, error) {
	out := &VideoEditorConfigOutput{}
	out.Body.Enabled = true
	out.Body.SchemaVersion = videoproject.SchemaVersion
	out.Body.Limits = VideoEditorLimits{
		MaxDurationSeconds: 2 * 60 * 60,
		MaxSources:         videoproject.MaxSources,
		MaxDocumentBytes:   videoproject.MaxDocumentBytes,
		MaxExportWidth:     1920,
		MaxExportHeight:    1920,
		MaxExportFPS:       60,
	}
	out.Body.ModelManifest = []VideoEditorModelManifestItem{
		{
			ID: "whisper-tiny-multilingual", Kind: "transcription",
			Version: "ff4177021cc41f7db950912b73ea4fdf7d01d8e7", SizeBytes: 100123789,
			URL:              h.modelBaseURL + "/whisper-tiny-multilingual-ff4177021cc41f7db950912b73ea4fdf7d01d8e7",
			SHA256:           "e244e7c9105e997e3205c99cb552e5a7344c275ca725c0b5b18670f44782555a",
			RuntimeBytesWASM: 11133407, RuntimeBytesWebGPU: 21596019,
			RequiredBackends: []string{"webgpu", "wasm"},
			Fingerprint:      "whisper-tiny-multilingual:ff4177021cc41f7db950912b73ea4fdf7d01d8e7:q4",
			Resumable:        true, LicenseReference: "video-editor-models/THIRD_PARTY_LICENSES.md",
			LicenseName: "Apache-2.0", LicenseURL: "https://www.apache.org/licenses/LICENSE-2.0",
		},
		{
			ID: "silero-vad", Kind: "vad", Version: "6.2", SizeBytes: 2327524,
			URL:              h.modelBaseURL + "/silero-vad-v6.2.onnx",
			SHA256:           "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3",
			RuntimeBytesWASM: 12666427, RuntimeBytesWebGPU: 0,
			RequiredBackends: []string{"wasm"}, Fingerprint: "silero-vad:6.2:onnx",
			Resumable: true, LicenseReference: "video-editor-models/THIRD_PARTY_LICENSES.md",
			LicenseName: "MIT", LicenseURL: "https://github.com/snakers4/silero-vad/blob/v6.2/LICENSE",
		},
	}
	out.Body.StockProviders = append([]string(nil), h.stockProviders...)
	return out, nil
}

func (h *VideoEditorHandler) requireAccess(
	ctx context.Context,
	workspaceID string,
	edit bool,
) (bool, error) {
	role, ok, err := middleware.WorkspaceRole(ctx, h.db, workspaceID, middleware.GetUserID(ctx))
	if err != nil {
		return false, huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !ok {
		return false, huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	canEdit := role == models.WorkspaceRoleAdmin || role == models.WorkspaceRoleEditor
	if edit && !canEdit {
		return false, huma.Error403Forbidden("workspace is read-only for this user")
	}
	return canEdit, nil
}

func (h *VideoEditorHandler) listProjects(
	ctx context.Context,
	input *ListVideoProjectsInput,
) (*ListVideoProjectsOutput, error) {
	workspaceID := strings.TrimSpace(input.WorkspaceID)
	if workspaceID == "" {
		return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	canEdit, err := h.requireAccess(ctx, workspaceID, false)
	if err != nil {
		return nil, err
	}
	query := h.db.NewSelect().Model((*models.VideoProject)(nil)).
		Where("workspace_id = ? AND deleted_at IS NULL", workspaceID)
	if search := strings.TrimSpace(input.Search); search != "" {
		query = query.Where("LOWER(title) LIKE ?", "%"+strings.ToLower(search)+"%")
	}
	total, err := query.Clone().Count(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to count OpenPost Video Editor projects")
	}
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var projects []models.VideoProject
	if err := query.OrderExpr("updated_at DESC").Limit(limit).Offset(input.Offset).Scan(ctx, &projects); err != nil {
		return nil, huma.Error500InternalServerError("failed to list OpenPost Video Editor projects")
	}
	out := &ListVideoProjectsOutput{}
	out.Body.Total = total
	out.Body.CanEdit = canEdit
	out.Body.Projects = make([]VideoProjectSummary, 0, len(projects))
	for _, project := range projects {
		var document videoproject.Document
		_ = json.Unmarshal([]byte(project.DocumentJSON), &document)
		out.Body.Projects = append(out.Body.Projects, VideoProjectSummary{
			ID: project.ID, Title: project.Title, Revision: project.Revision,
			DurationMS: project.DurationMS, SourceCount: len(document.Sources),
			CoverPreviewMediaID: project.CoverPreviewMediaID,
			CreatedAt:           project.CreatedAt.UTC().Format(time.RFC3339),
			UpdatedAt:           project.UpdatedAt.UTC().Format(time.RFC3339),
		})
	}
	return out, nil
}

func (h *VideoEditorHandler) createProject(
	ctx context.Context,
	input *CreateVideoProjectInput,
) (*CreateVideoProjectOutput, error) {
	workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
	if workspaceID == "" {
		return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	if _, err := h.requireAccess(ctx, workspaceID, true); err != nil {
		return nil, err
	}
	input.Body.Document.Normalize()
	if err := videoproject.Validate(input.Body.Document, true); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	if err := h.validateMediaReferences(
		ctx,
		workspaceID,
		input.Body.Document,
		input.Body.CoverPreviewMediaID,
	); err != nil {
		return nil, err
	}
	userID := middleware.GetUserID(ctx)
	projectID := uuid.NewString()
	if clientRequestID := strings.TrimSpace(input.Body.ClientRequestID); clientRequestID != "" {
		projectID = uuid.NewSHA1(
			uuid.NameSpaceURL,
			[]byte(fmt.Sprintf("openpost:video-project:%s:%s:%s", userID, workspaceID, clientRequestID)),
		).String()
		if existing, err := h.projectResponse(ctx, projectID); err == nil {
			return &CreateVideoProjectOutput{Body: *existing}, nil
		}
	}
	encoded, err := json.Marshal(input.Body.Document)
	if err != nil {
		return nil, huma.Error400BadRequest("OpenPost Video Editor project cannot be serialized")
	}
	now := time.Now().UTC()
	project := &models.VideoProject{
		ID: projectID, WorkspaceID: workspaceID, CreatedByID: userID,
		Title: input.Body.Document.Title, SchemaVersion: videoproject.SchemaVersion,
		Revision: 1, DocumentJSON: string(encoded),
		DurationMS:          videoproject.DurationUS(input.Body.Document) / 1_000,
		CoverPreviewMediaID: strings.TrimSpace(input.Body.CoverPreviewMediaID),
		CreatedAt:           now, UpdatedAt: now,
	}
	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(project).Exec(txCtx); err != nil {
			return err
		}
		if err := replaceVideoProjectAssets(
			txCtx,
			tx,
			project.ID,
			input.Body.Document,
			project.CoverPreviewMediaID,
		); err != nil {
			return err
		}
		return storeVideoProjectRevision(
			txCtx,
			tx,
			project,
			input.Body.Document,
			project.CoverPreviewMediaID,
			"autosave",
			"",
			userID,
			now,
		)
	})
	if err != nil {
		if existing, responseErr := h.projectResponse(ctx, projectID); responseErr == nil {
			return &CreateVideoProjectOutput{Body: *existing}, nil
		}
		log.Printf("failed to create OpenPost Video Editor project %s: %v", projectID, err)
		return nil, huma.Error500InternalServerError("failed to create OpenPost Video Editor project")
	}
	response, err := h.projectResponse(ctx, projectID)
	if err != nil {
		return nil, err
	}
	return &CreateVideoProjectOutput{Body: *response}, nil
}

func (h *VideoEditorHandler) getProject(
	ctx context.Context,
	input *GetVideoProjectInput,
) (*GetVideoProjectOutput, error) {
	response, err := h.projectResponse(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	return &GetVideoProjectOutput{Body: *response}, nil
}

func (h *VideoEditorHandler) updateProject(
	ctx context.Context,
	input *UpdateVideoProjectInput,
) (*UpdateVideoProjectOutput, error) {
	input.Body.Document.Normalize()
	if err := videoproject.Validate(input.Body.Document, true); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	project, err := h.loadProject(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, project.WorkspaceID, true); err != nil {
		return nil, err
	}
	if project.Revision != input.Body.ExpectedRevision {
		return nil, videoProjectConflict(project.Revision)
	}
	if err := h.validateMediaReferences(
		ctx,
		project.WorkspaceID,
		input.Body.Document,
		input.Body.CoverPreviewMediaID,
	); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(input.Body.Document)
	if err != nil {
		return nil, huma.Error400BadRequest("OpenPost Video Editor project cannot be serialized")
	}
	now := time.Now().UTC()
	project.Title = input.Body.Document.Title
	project.SchemaVersion = input.Body.Document.SchemaVersion
	project.Revision++
	project.DocumentJSON = string(encoded)
	project.DurationMS = videoproject.DurationUS(input.Body.Document) / 1_000
	project.CoverPreviewMediaID = strings.TrimSpace(input.Body.CoverPreviewMediaID)
	project.UpdatedAt = now
	err = h.persistProjectUpdate(
		ctx,
		project,
		input.Body.ExpectedRevision,
		input.Body.Document,
		middleware.GetUserID(ctx),
		now,
	)
	if errors.Is(err, errVideoProjectRevisionConflict) {
		latest, loadErr := h.loadProject(ctx, project.ID)
		if loadErr == nil {
			return nil, videoProjectConflict(latest.Revision)
		}
		return nil, videoProjectConflict(project.Revision)
	}
	if err != nil {
		log.Printf("failed to save OpenPost Video Editor project %s: %v", project.ID, err)
		return nil, huma.Error500InternalServerError("failed to save OpenPost Video Editor project")
	}
	response, err := h.projectResponse(ctx, project.ID)
	if err != nil {
		return nil, err
	}
	return &UpdateVideoProjectOutput{Body: *response}, nil
}

func (h *VideoEditorHandler) persistProjectUpdate(
	ctx context.Context,
	project *models.VideoProject,
	expectedRevision int,
	document videoproject.Document,
	actorID string,
	now time.Time,
) error {
	return h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		result, err := tx.NewUpdate().Model(project).
			Column("title", "schema_version", "revision", "document_json", "duration_ms", "cover_preview_media_id", "updated_at").
			WherePK().
			Where("revision = ?", expectedRevision).
			Exec(txCtx)
		if err != nil {
			return err
		}
		affected, _ := result.RowsAffected()
		if affected != 1 {
			return errVideoProjectRevisionConflict
		}
		if err := replaceVideoProjectAssets(
			txCtx,
			tx,
			project.ID,
			document,
			project.CoverPreviewMediaID,
		); err != nil {
			return err
		}
		if err := storeVideoProjectRevision(
			txCtx,
			tx,
			project,
			document,
			project.CoverPreviewMediaID,
			"autosave",
			"",
			actorID,
			now,
		); err != nil {
			return err
		}
		return pruneVideoProjectRevisions(txCtx, tx, project.ID, now)
	})
}

func videoProjectConflict(latestRevision int) error {
	return huma.NewError(
		http.StatusConflict,
		fmt.Sprintf("OpenPost Video Editor project changed elsewhere; latest revision is %d", latestRevision),
	)
}

func (h *VideoEditorHandler) deleteProject(
	ctx context.Context,
	input *DeleteVideoProjectInput,
) (*DeleteVideoProjectOutput, error) {
	project, err := h.loadProject(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, project.WorkspaceID, true); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	result, err := h.db.NewUpdate().Model((*models.VideoProject)(nil)).
		Set("deleted_at = ?", now).Set("updated_at = ?", now).
		Where("id = ? AND deleted_at IS NULL", project.ID).Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to delete OpenPost Video Editor project")
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return nil, huma.Error404NotFound("OpenPost Video Editor project not found")
	}
	out := &DeleteVideoProjectOutput{}
	out.Body.Deleted = true
	return out, nil
}

func (h *VideoEditorHandler) listRevisions(
	ctx context.Context,
	input *ListVideoProjectRevisionsInput,
) (*ListVideoProjectRevisionsOutput, error) {
	project, err := h.loadProject(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, project.WorkspaceID, false); err != nil {
		return nil, err
	}
	var revisions []models.VideoProjectRevision
	cursor, err := decodeEditorRevisionCursor(input.Cursor)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid OpenPost Video Editor revision cursor")
	}
	limit := editorRevisionLimit(input.Limit)
	query := h.db.NewSelect().Model(&revisions).
		Where("video_project_id = ?", project.ID).
		OrderExpr("created_at DESC, id DESC").
		Limit(limit + 1)
	if !cursor.CreatedAt.IsZero() {
		query = query.Where(
			"(created_at < ?) OR (created_at = ? AND id < ?)",
			cursor.CreatedAt,
			cursor.CreatedAt,
			cursor.ID,
		)
	}
	if err := query.Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to list OpenPost Video Editor revisions")
	}
	nextCursor := ""
	if len(revisions) > limit {
		next := revisions[limit-1]
		nextCursor = encodeEditorRevisionCursor(next.CreatedAt, next.ID)
		revisions = revisions[:limit]
	}
	actorIDs := make([]string, 0, len(revisions))
	for _, revision := range revisions {
		actorIDs = append(actorIDs, revision.CreatedByID)
	}
	currentUserID := middleware.GetUserID(ctx)
	actors, err := loadEditorRevisionActors(ctx, h.db, actorIDs, currentUserID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load OpenPost Video Editor revision actors")
	}
	out := &ListVideoProjectRevisionsOutput{}
	out.Body.NextCursor = nextCursor
	out.Body.Revisions = make([]VideoProjectRevisionSummary, 0, len(revisions))
	for _, revision := range revisions {
		out.Body.Revisions = append(out.Body.Revisions, videoRevisionSummary(
			revision,
			editorRevisionActor(actors, revision.CreatedByID, currentUserID),
		))
	}
	return out, nil
}

func (h *VideoEditorHandler) getRevision(
	ctx context.Context,
	input *GetVideoProjectRevisionInput,
) (*GetVideoProjectRevisionOutput, error) {
	project, err := h.loadProject(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, project.WorkspaceID, false); err != nil {
		return nil, err
	}
	revision, snapshot, err := h.loadVideoProjectRevisionSnapshot(ctx, h.db, project.ID, input.RevisionID)
	if err != nil {
		return nil, err
	}
	if err := videoproject.Validate(snapshot.Document, true); err != nil {
		return nil, huma.Error400BadRequest("OpenPost Video Editor revision is invalid")
	}
	currentUserID := middleware.GetUserID(ctx)
	actors, err := loadEditorRevisionActors(ctx, h.db, []string{revision.CreatedByID}, currentUserID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load OpenPost Video Editor revision actor")
	}
	return &GetVideoProjectRevisionOutput{Body: VideoProjectRevisionResponse{
		Summary: videoRevisionSummary(
			*revision,
			editorRevisionActor(actors, revision.CreatedByID, currentUserID),
		),
		CoverPreviewMediaID: snapshot.CoverPreviewMediaID,
		Document:            snapshot.Document,
	}}, nil
}

func (h *VideoEditorHandler) loadVideoProjectRevisionSnapshot(
	ctx context.Context,
	db bun.IDB,
	projectID string,
	revisionID string,
) (*models.VideoProjectRevision, videoProjectRevisionSnapshot, error) {
	var revision models.VideoProjectRevision
	err := db.NewSelect().Model(&revision).
		Where("id = ? AND video_project_id = ?", revisionID, projectID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, videoProjectRevisionSnapshot{}, huma.Error404NotFound("OpenPost Video Editor revision not found")
	}
	if err != nil {
		return nil, videoProjectRevisionSnapshot{}, huma.Error500InternalServerError("failed to load OpenPost Video Editor revision")
	}
	snapshot, err := decompressVideoProjectSnapshot(revision.Snapshot)
	if err != nil {
		return nil, videoProjectRevisionSnapshot{}, huma.Error400BadRequest("OpenPost Video Editor revision is corrupt")
	}
	return &revision, snapshot, nil
}

func (h *VideoEditorHandler) createCheckpoint(
	ctx context.Context,
	input *CreateVideoProjectCheckpointInput,
) (*CreateVideoProjectCheckpointOutput, error) {
	project, err := h.loadProject(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, project.WorkspaceID, true); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(input.Body.Name)
	if name == "" {
		return nil, huma.Error400BadRequest("checkpoint name is required")
	}
	now := time.Now().UTC()
	currentUserID := middleware.GetUserID(ctx)
	var revision *models.VideoProjectRevision
	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var current models.VideoProject
		query := tx.NewSelect().Model(&current).
			Where("id = ? AND deleted_at IS NULL", project.ID)
		if tx.Dialect().Name() == dialect.PG {
			query = query.For("UPDATE")
		}
		if err := query.Scan(txCtx); err != nil {
			return err
		}
		if current.Revision != input.Body.ExpectedRevision {
			return errVideoProjectRevisionConflict
		}
		document, err := decodeVideoProjectDocument(current.DocumentJSON)
		if err != nil {
			return err
		}
		revision, err = newVideoProjectRevision(
			&current,
			document,
			current.CoverPreviewMediaID,
			"checkpoint",
			name,
			currentUserID,
			now,
		)
		if err != nil {
			return err
		}
		if _, err := tx.NewInsert().Model(revision).Exec(txCtx); err != nil {
			return err
		}
		return storeVideoProjectRevisionAssets(
			txCtx,
			tx,
			current.ID,
			revision.ID,
			document,
			current.CoverPreviewMediaID,
			now,
		)
	})
	if errors.Is(err, errVideoProjectRevisionConflict) {
		latest, loadErr := h.loadProject(ctx, project.ID)
		if loadErr == nil {
			return nil, videoProjectConflict(latest.Revision)
		}
		return nil, videoProjectConflict(input.Body.ExpectedRevision)
	}
	if err != nil || revision == nil {
		return nil, huma.Error500InternalServerError("failed to create OpenPost Video Editor checkpoint")
	}
	actors, err := loadEditorRevisionActors(ctx, h.db, []string{currentUserID}, currentUserID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load OpenPost Video Editor revision actor")
	}
	return &CreateVideoProjectCheckpointOutput{Body: videoRevisionSummary(
		*revision,
		editorRevisionActor(actors, currentUserID, currentUserID),
	)}, nil
}

func (h *VideoEditorHandler) restoreRevision(
	ctx context.Context,
	input *RestoreVideoProjectRevisionInput,
) (*RestoreVideoProjectRevisionOutput, error) {
	project, err := h.loadProject(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, project.WorkspaceID, true); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	actorID := middleware.GetUserID(ctx)
	err = h.restoreVideoProjectRevisionInTx(
		ctx,
		project.ID,
		input.RevisionID,
		input.Body.ExpectedRevision,
		actorID,
		now,
	)
	if errors.Is(err, errVideoProjectRevisionConflict) {
		latest, loadErr := h.loadProject(ctx, project.ID)
		if loadErr == nil {
			return nil, videoProjectConflict(latest.Revision)
		}
		return nil, videoProjectConflict(input.Body.ExpectedRevision)
	}
	if err != nil {
		var statusError huma.StatusError
		if errors.As(err, &statusError) {
			return nil, err
		}
		log.Printf("failed to restore OpenPost Video Editor project %s: %v", project.ID, err)
		return nil, huma.Error500InternalServerError("failed to restore OpenPost Video Editor revision")
	}
	response, err := h.projectResponse(ctx, project.ID)
	if err != nil {
		return nil, err
	}
	return &RestoreVideoProjectRevisionOutput{Body: *response}, nil
}

func (h *VideoEditorHandler) restoreVideoProjectRevisionInTx(
	ctx context.Context,
	projectID string,
	revisionID string,
	expectedRevision int,
	actorID string,
	now time.Time,
) error {
	return h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		current, target, err := h.prepareVideoProjectRevisionRestore(
			txCtx,
			tx,
			projectID,
			revisionID,
			expectedRevision,
			now,
		)
		if err != nil {
			return err
		}
		if err := storeVideoProjectRestorePoint(
			txCtx,
			tx,
			&current,
			actorID,
			now,
		); err != nil {
			return err
		}
		return applyVideoProjectRevisionRestore(
			txCtx,
			tx,
			&current,
			target,
			expectedRevision,
			now,
		)
	})
}

func (h *VideoEditorHandler) prepareVideoProjectRevisionRestore(
	ctx context.Context,
	tx bun.Tx,
	projectID string,
	revisionID string,
	expectedRevision int,
	now time.Time,
) (models.VideoProject, videoProjectRevisionSnapshot, error) {
	var current models.VideoProject
	if err := tx.NewSelect().Model(&current).
		Where("id = ? AND deleted_at IS NULL", projectID).
		Scan(ctx); err != nil {
		return current, videoProjectRevisionSnapshot{}, err
	}
	if current.Revision != expectedRevision {
		return current, videoProjectRevisionSnapshot{}, errVideoProjectRevisionConflict
	}
	_, target, err := h.loadVideoProjectRevisionSnapshot(ctx, tx, current.ID, revisionID)
	if err != nil {
		return current, target, err
	}
	if err := videoproject.Validate(target.Document, true); err != nil {
		return current, target, huma.Error400BadRequest("OpenPost Video Editor revision is invalid")
	}
	if err := validateVideoProjectMediaReferences(
		ctx,
		tx,
		current.WorkspaceID,
		target.Document,
		target.CoverPreviewMediaID,
	); err != nil {
		return current, target, err
	}
	mediaSources := videoProjectCloudMediaSources(target.Document)
	targetMediaIDs := make([]string, 0, len(mediaSources)+1)
	for _, mediaID := range mediaSources {
		targetMediaIDs = append(targetMediaIDs, mediaID)
	}
	targetMediaIDs = append(targetMediaIDs, target.CoverPreviewMediaID)
	if err := reviveEditorMediaReferences(
		ctx,
		tx,
		current.WorkspaceID,
		targetMediaIDs,
		now,
	); err != nil {
		return current, target, err
	}
	return current, target, nil
}

func storeVideoProjectRestorePoint(
	ctx context.Context,
	tx bun.Tx,
	current *models.VideoProject,
	actorID string,
	now time.Time,
) error {
	document, err := decodeVideoProjectDocument(current.DocumentJSON)
	if err != nil {
		return errors.New("current OpenPost Video Editor project is corrupt")
	}
	restorePoint, err := newVideoProjectRevision(
		current,
		document,
		current.CoverPreviewMediaID,
		"restore_point",
		"",
		actorID,
		now,
	)
	if err != nil {
		return err
	}
	if _, err := tx.NewInsert().Model(restorePoint).Exec(ctx); err != nil {
		return err
	}
	return storeVideoProjectRevisionAssets(
		ctx,
		tx,
		current.ID,
		restorePoint.ID,
		document,
		current.CoverPreviewMediaID,
		now,
	)
}

func applyVideoProjectRevisionRestore(
	ctx context.Context,
	tx bun.Tx,
	current *models.VideoProject,
	target videoProjectRevisionSnapshot,
	expectedRevision int,
	now time.Time,
) error {
	encoded, err := json.Marshal(target.Document)
	if err != nil {
		return err
	}
	current.Title = target.Document.Title
	current.SchemaVersion = target.Document.SchemaVersion
	current.Revision++
	current.DocumentJSON = string(encoded)
	current.DurationMS = videoproject.DurationUS(target.Document) / 1_000
	current.CoverPreviewMediaID = strings.TrimSpace(target.CoverPreviewMediaID)
	current.UpdatedAt = now
	result, err := tx.NewUpdate().Model(current).
		Column("title", "schema_version", "revision", "document_json", "duration_ms", "cover_preview_media_id", "updated_at").
		WherePK().
		Where("revision = ?", expectedRevision).
		Exec(ctx)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return errVideoProjectRevisionConflict
	}
	if err := replaceVideoProjectAssets(
		ctx,
		tx,
		current.ID,
		target.Document,
		target.CoverPreviewMediaID,
	); err != nil {
		return err
	}
	return pruneVideoProjectRevisions(ctx, tx, current.ID, now)
}

func (h *VideoEditorHandler) createReturnToken(
	ctx context.Context,
	input *CreateVideoReturnTokenInput,
) (*CreateVideoReturnTokenOutput, error) {
	workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
	if workspaceID == "" {
		return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	if _, err := h.requireAccess(ctx, workspaceID, true); err != nil {
		return nil, err
	}
	returnURL, err := normalizeVideoReturnURL(input.Body.ReturnURL)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	constraints, err := json.Marshal(input.Body.Constraints)
	if err != nil || len(constraints) > 64<<10 {
		return nil, huma.Error400BadRequest("OpenPost Video Editor return constraints are invalid")
	}
	rawToken, tokenHash, err := newVideoReturnToken()
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to create OpenPost Video Editor return token")
	}
	now := time.Now().UTC()
	record := &models.VideoReturnToken{
		ID: uuid.NewString(), TokenHash: tokenHash, WorkspaceID: workspaceID,
		UserID: middleware.GetUserID(ctx), ReturnURL: returnURL,
		Purpose: strings.TrimSpace(input.Body.Purpose), ConstraintsJSON: string(constraints),
		ResultJSON: `{"project_id":"","exports":[]}`, CreatedAt: now, ExpiresAt: now.Add(2 * time.Hour),
	}
	if record.Purpose == "" {
		record.Purpose = "post_media"
	}
	if _, err := h.db.NewInsert().Model(record).Exec(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to store OpenPost Video Editor return token")
	}
	out := &CreateVideoReturnTokenOutput{}
	out.Body.Token = rawToken
	out.Body.ExpiresAt = record.ExpiresAt.Format(time.RFC3339)
	return out, nil
}

//nolint:gocyclo // Completion validates each exported variant against media and destination constraints.
func (h *VideoEditorHandler) completeReturnToken(
	ctx context.Context,
	input *CompleteVideoReturnTokenInput,
) (*CompleteVideoReturnTokenOutput, error) {
	record, err := h.loadReturnToken(ctx, input.Token)
	if err != nil {
		return nil, err
	}
	if !record.CompletedAt.IsZero() || !record.ConsumedAt.IsZero() {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Video Editor return token has already been used")
	}
	if strings.TrimSpace(input.Body.ProjectID) == "" || len(input.Body.Exports) == 0 || len(input.Body.Exports) > 4 {
		return nil, huma.Error400BadRequest("OpenPost Video Editor return result must include a project and 1–4 exports")
	}
	project, err := h.loadProject(ctx, input.Body.ProjectID)
	if err != nil || project.WorkspaceID != record.WorkspaceID {
		return nil, huma.Error400BadRequest("OpenPost Video Editor project must belong to the workspace")
	}
	var constraints struct {
		AllowedMIMEs     []string `json:"allowed_mimes"`
		MaxWidth         int      `json:"max_width"`
		MaxHeight        int      `json:"max_height"`
		MaxDurationMS    int64    `json:"max_duration_ms"`
		MaxFileSizeBytes int64    `json:"max_file_size_bytes"`
		MaxFPS           float64  `json:"max_fps"`
		RequiredVariants []string `json:"required_variants"`
		RenditionIDs     []string `json:"rendition_ids"`
	}
	if err := json.Unmarshal([]byte(record.ConstraintsJSON), &constraints); err != nil {
		return nil, huma.Error400BadRequest("OpenPost Video Editor return constraints are invalid")
	}
	allowedMIMEs := stringSet(constraints.AllowedMIMEs)
	allowedRenditions := stringSet(constraints.RenditionIDs)
	requiredVariants := stringSet(constraints.RequiredVariants)
	seenVariants := map[string]struct{}{}
	mediaIDs := make([]string, 0, len(input.Body.Exports))
	for _, export := range input.Body.Exports {
		if !validVideoVariant(export.VariantID) {
			return nil, huma.Error400BadRequest("OpenPost Video Editor export variant is invalid")
		}
		if _, exists := seenVariants[export.VariantID]; exists {
			return nil, huma.Error400BadRequest("OpenPost Video Editor export variants must be unique")
		}
		seenVariants[export.VariantID] = struct{}{}
		mediaIDs = append(mediaIDs, export.MediaID)
		for _, renditionID := range export.RenditionIDs {
			if len(allowedRenditions) > 0 {
				if _, allowed := allowedRenditions[renditionID]; !allowed {
					return nil, huma.Error400BadRequest("OpenPost Video Editor export references an unexpected rendition")
				}
			}
		}
	}
	for required := range requiredVariants {
		if _, ok := seenVariants[required]; !ok {
			return nil, huma.Error400BadRequest("OpenPost Video Editor exports do not cover every required format")
		}
	}
	var media []models.MediaAttachment
	if err := h.db.NewSelect().Model(&media).
		Where("workspace_id = ? AND processing_status = ? AND id IN (?)", record.WorkspaceID, mediaReadyStatus, bun.List(mediaIDs)).
		Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to validate OpenPost Video Editor exports")
	}
	if len(media) != len(mediaIDs) {
		return nil, huma.Error400BadRequest("every OpenPost Video Editor export must be ready and belong to the workspace")
	}
	mediaByID := make(map[string]models.MediaAttachment, len(media))
	for _, item := range media {
		mediaByID[item.ID] = item
	}
	for _, export := range input.Body.Exports {
		item, ok := mediaByID[export.MediaID]
		if !ok || !strings.HasPrefix(strings.ToLower(item.MimeType), "video/") {
			return nil, huma.Error400BadRequest("every OpenPost Video Editor export must be a video")
		}
		if item.VideoProjectID != input.Body.ProjectID {
			return nil, huma.Error400BadRequest("every OpenPost Video Editor export must come from the returning project")
		}
		if len(allowedMIMEs) > 0 {
			if _, allowed := allowedMIMEs[strings.ToLower(item.MimeType)]; !allowed {
				return nil, huma.Error400BadRequest("an OpenPost Video Editor export format is not supported")
			}
		}
		if constraints.MaxWidth > 0 && item.Width > constraints.MaxWidth ||
			constraints.MaxHeight > 0 && item.Height > constraints.MaxHeight {
			return nil, huma.Error400BadRequest("an OpenPost Video Editor export exceeds the destination dimensions")
		}
		if constraints.MaxDurationMS > 0 && item.DurationMS > constraints.MaxDurationMS {
			return nil, huma.Error400BadRequest("an OpenPost Video Editor export exceeds the destination duration")
		}
		if constraints.MaxFileSizeBytes > 0 && item.Size > constraints.MaxFileSizeBytes {
			return nil, huma.Error400BadRequest("an OpenPost Video Editor export exceeds the destination file size")
		}
		if constraints.MaxFPS > 0 && item.FrameRate > constraints.MaxFPS {
			return nil, huma.Error400BadRequest("an OpenPost Video Editor export exceeds the destination frame rate")
		}
		if export.Width != item.Width || export.Height != item.Height ||
			absInt64(export.DurationMS-item.DurationMS) > 100 {
			return nil, huma.Error400BadRequest("OpenPost Video Editor export metadata does not match the stored media")
		}
	}
	encoded, err := json.Marshal(input.Body)
	if err != nil {
		return nil, huma.Error400BadRequest("OpenPost Video Editor return result is invalid")
	}
	now := time.Now().UTC()
	result, err := h.db.NewUpdate().Model((*models.VideoReturnToken)(nil)).
		Set("result_json = ?", string(encoded)).Set("project_id = ?", input.Body.ProjectID).
		Set("completed_at = ?", now).
		Where("id = ? AND completed_at IS NULL AND consumed_at IS NULL", record.ID).Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to complete OpenPost Video Editor return token")
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Video Editor return token has already been used")
	}
	out := &CompleteVideoReturnTokenOutput{}
	out.Body.ReturnURL = record.ReturnURL
	return out, nil
}

func absInt64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}

func (h *VideoEditorHandler) consumeReturnToken(
	ctx context.Context,
	input *ConsumeVideoReturnTokenInput,
) (*ConsumeVideoReturnTokenOutput, error) {
	record, err := h.loadReturnToken(ctx, input.Token)
	if err != nil {
		return nil, err
	}
	if record.CompletedAt.IsZero() {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Video Editor return token is not complete")
	}
	if !record.ConsumedAt.IsZero() {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Video Editor return token has already been consumed")
	}
	result, err := h.db.NewUpdate().Model((*models.VideoReturnToken)(nil)).
		Set("consumed_at = ?", time.Now().UTC()).
		Where("id = ? AND consumed_at IS NULL", record.ID).Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to consume OpenPost Video Editor return token")
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Video Editor return token has already been consumed")
	}
	out := &ConsumeVideoReturnTokenOutput{}
	out.Body.WorkspaceID = record.WorkspaceID
	out.Body.ReturnURL = record.ReturnURL
	out.Body.Purpose = record.Purpose
	if err := json.Unmarshal([]byte(record.ConstraintsJSON), &out.Body.Constraints); err != nil {
		out.Body.Constraints = map[string]any{}
	}
	if err := json.Unmarshal([]byte(record.ResultJSON), &out.Body.Result); err != nil {
		return nil, huma.Error500InternalServerError("OpenPost Video Editor return token result is corrupt")
	}
	return out, nil
}

func (h *VideoEditorHandler) loadReturnToken(
	ctx context.Context,
	rawToken string,
) (*models.VideoReturnToken, error) {
	if strings.TrimSpace(rawToken) == "" {
		return nil, huma.Error400BadRequest("OpenPost Video Editor return token is required")
	}
	hash := sha256.Sum256([]byte(rawToken))
	var record models.VideoReturnToken
	err := h.db.NewSelect().Model(&record).
		Where("token_hash = ? AND user_id = ?", hex.EncodeToString(hash[:]), middleware.GetUserID(ctx)).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("OpenPost Video Editor return token not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load OpenPost Video Editor return token")
	}
	if time.Now().UTC().After(record.ExpiresAt) {
		return nil, huma.Error404NotFound("OpenPost Video Editor return token has expired")
	}
	if _, err := h.requireAccess(ctx, record.WorkspaceID, true); err != nil {
		return nil, err
	}
	return &record, nil
}

func (h *VideoEditorHandler) loadProject(ctx context.Context, id string) (*models.VideoProject, error) {
	var project models.VideoProject
	err := h.db.NewSelect().Model(&project).
		Where("id = ? AND deleted_at IS NULL", id).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("OpenPost Video Editor project not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load OpenPost Video Editor project")
	}
	return &project, nil
}

func (h *VideoEditorHandler) projectResponse(
	ctx context.Context,
	id string,
) (*VideoProjectResponse, error) {
	project, err := h.loadProject(ctx, id)
	if err != nil {
		return nil, err
	}
	canEdit, err := h.requireAccess(ctx, project.WorkspaceID, false)
	if err != nil {
		return nil, err
	}
	document, err := decodeVideoProjectDocument(project.DocumentJSON)
	if err != nil {
		return nil, huma.Error500InternalServerError("OpenPost Video Editor project is corrupt")
	}
	return &VideoProjectResponse{
		ID: project.ID, WorkspaceID: project.WorkspaceID, CreatedByID: project.CreatedByID,
		Revision: project.Revision, CanEdit: canEdit, DurationMS: project.DurationMS,
		CoverPreviewMediaID: project.CoverPreviewMediaID,
		CreatedAt:           project.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:           project.UpdatedAt.UTC().Format(time.RFC3339),
		Document:            document,
	}, nil
}

func (h *VideoEditorHandler) validateMediaReferences(
	ctx context.Context,
	workspaceID string,
	document videoproject.Document,
	coverPreviewMediaID string,
) error {
	return validateVideoProjectMediaReferences(
		ctx,
		h.db,
		workspaceID,
		document,
		coverPreviewMediaID,
	)
}

func videoProjectCloudMediaSources(document videoproject.Document) map[string]string {
	references := make(map[string]string, len(document.Sources))
	for sourceID, source := range document.Sources {
		if source.Locator.Type != "openpost-media" {
			continue
		}
		if mediaID := strings.TrimSpace(source.Locator.MediaID); mediaID != "" {
			references[sourceID] = mediaID
		}
	}
	return references
}

func validateVideoProjectMediaReferences(
	ctx context.Context,
	db bun.IDB,
	workspaceID string,
	document videoproject.Document,
	coverPreviewMediaID string,
) error {
	references := videoProjectCloudMediaSources(document)
	ids := make([]string, 0, len(references)+1)
	for _, mediaID := range references {
		ids = append(ids, mediaID)
	}
	if cover := strings.TrimSpace(coverPreviewMediaID); cover != "" {
		ids = append(ids, cover)
	}
	if len(ids) == 0 {
		return nil
	}
	valid, err := allEditorMediaBelongToWorkspace(
		ctx,
		db,
		workspaceID,
		ids,
		mediaReadyStatus,
	)
	if err != nil {
		return huma.Error500InternalServerError("failed to validate OpenPost Video Editor media")
	}
	if !valid {
		return huma.Error400BadRequest("every OpenPost Video Editor source must be ready and belong to the workspace")
	}
	return nil
}

func replaceVideoProjectAssets(
	ctx context.Context,
	tx bun.Tx,
	projectID string,
	document videoproject.Document,
	coverPreviewMediaID string,
) error {
	var previousMediaIDs []string
	if err := tx.NewSelect().
		Model((*models.VideoProjectAsset)(nil)).
		Column("media_id").
		Where("video_project_id = ? AND usage IN (?)", projectID, bun.List([]string{
			videoProjectAssetSource,
			videoProjectAssetCover,
		})).
		Scan(ctx, &previousMediaIDs); err != nil {
		return err
	}
	if _, err := tx.NewDelete().Model((*models.VideoProjectAsset)(nil)).
		Where("video_project_id = ? AND usage IN (?)", projectID, bun.List([]string{
			videoProjectAssetSource,
			videoProjectAssetCover,
		})).Exec(ctx); err != nil {
		return err
	}
	references := videoProjectCloudMediaSources(document)
	assets := make([]models.VideoProjectAsset, 0, len(references)+1)
	now := time.Now().UTC()
	for sourceID, mediaID := range references {
		assets = append(assets, models.VideoProjectAsset{
			VideoProjectID: projectID,
			SourceID:       "current:source:" + sourceID,
			MediaID:        mediaID,
			Usage:          videoProjectAssetSource,
			CreatedAt:      now,
		})
	}
	if coverID := strings.TrimSpace(coverPreviewMediaID); coverID != "" {
		assets = append(assets, models.VideoProjectAsset{
			VideoProjectID: projectID,
			SourceID:       "current:cover",
			MediaID:        coverID,
			Usage:          videoProjectAssetCover,
			CreatedAt:      now,
		})
	}
	if len(assets) > 0 {
		for start := 0; start < len(assets); start += videoProjectAssetWriteChunk {
			end := min(start+videoProjectAssetWriteChunk, len(assets))
			chunk := assets[start:end]
			if _, err := tx.NewInsert().Model(&chunk).Exec(ctx); err != nil {
				return err
			}
		}
	}
	for sourceID, mediaID := range references {
		provenance := document.Sources[sourceID].Provenance
		if provenance == nil {
			continue
		}
		record := &models.MediaProvenance{
			MediaID: mediaID, Provider: strings.TrimSpace(provenance.Provider),
			ExternalID:      strings.TrimSpace(provenance.ExternalID),
			SourceURL:       strings.TrimSpace(provenance.SourceURL),
			CreatorName:     strings.TrimSpace(provenance.CreatorName),
			CreatorURL:      strings.TrimSpace(provenance.CreatorURL),
			LicenseName:     strings.TrimSpace(provenance.LicenseName),
			LicenseURL:      strings.TrimSpace(provenance.LicenseURL),
			AttributionText: strings.TrimSpace(provenance.AttributionText),
			ImportedAt:      now,
		}
		if _, err := tx.NewInsert().Model(record).On("CONFLICT (media_id) DO NOTHING").Exec(ctx); err != nil {
			return err
		}
	}
	mediaIDs := previousMediaIDs
	for _, mediaID := range references {
		mediaIDs = append(mediaIDs, mediaID)
	}
	if coverID := strings.TrimSpace(coverPreviewMediaID); coverID != "" {
		mediaIDs = append(mediaIDs, coverID)
	}
	return medialifecycle.TouchWithDB(ctx, tx, mediaIDs, now)
}

func storeVideoProjectRevision(
	ctx context.Context,
	tx bun.Tx,
	project *models.VideoProject,
	document videoproject.Document,
	coverPreviewMediaID string,
	kind string,
	name string,
	actorID string,
	now time.Time,
) error {
	revision, err := newVideoProjectRevision(
		project,
		document,
		coverPreviewMediaID,
		kind,
		name,
		actorID,
		now,
	)
	if err != nil {
		return err
	}
	if _, err := tx.NewInsert().Model(revision).Exec(ctx); err != nil {
		return err
	}
	return storeVideoProjectRevisionAssets(
		ctx,
		tx,
		project.ID,
		revision.ID,
		document,
		coverPreviewMediaID,
		now,
	)
}

func newVideoProjectRevision(
	project *models.VideoProject,
	document videoproject.Document,
	coverPreviewMediaID string,
	kind string,
	name string,
	actorID string,
	now time.Time,
) (*models.VideoProjectRevision, error) {
	snapshot, err := compressVideoProjectSnapshot(videoProjectRevisionSnapshot{
		SnapshotVersion:     videoProjectSnapshotVersion,
		Document:            document,
		CoverPreviewMediaID: strings.TrimSpace(coverPreviewMediaID),
	})
	if err != nil {
		return nil, err
	}
	revision := &models.VideoProjectRevision{
		ID: uuid.NewString(), VideoProjectID: project.ID, Revision: project.Revision,
		Kind: kind, Name: strings.TrimSpace(name), Snapshot: snapshot,
		CreatedByID: actorID, CreatedAt: now,
	}
	if kind == "autosave" {
		revision.ExpiresAt = now.Add(videoProjectRevisionTTL)
	}
	return revision, nil
}

func storeVideoProjectRevisionAssets(
	ctx context.Context,
	tx bun.Tx,
	projectID string,
	revisionID string,
	document videoproject.Document,
	coverPreviewMediaID string,
	now time.Time,
) error {
	references := videoProjectCloudMediaSources(document)
	assets := make([]models.VideoProjectAsset, 0, len(references)+1)
	usage := "revision:" + revisionID
	for sourceID, mediaID := range references {
		assets = append(assets, models.VideoProjectAsset{
			VideoProjectID: projectID,
			SourceID:       usage + ":source:" + sourceID,
			RevisionID:     revisionID,
			MediaID:        mediaID,
			Usage:          usage,
			CreatedAt:      now,
		})
	}
	if coverID := strings.TrimSpace(coverPreviewMediaID); coverID != "" {
		assets = append(assets, models.VideoProjectAsset{
			VideoProjectID: projectID,
			SourceID:       usage + ":cover",
			RevisionID:     revisionID,
			MediaID:        coverID,
			Usage:          usage,
			CreatedAt:      now,
		})
	}
	if len(assets) > 0 {
		for start := 0; start < len(assets); start += videoProjectAssetWriteChunk {
			end := min(start+videoProjectAssetWriteChunk, len(assets))
			chunk := assets[start:end]
			if _, err := tx.NewInsert().Model(&chunk).Exec(ctx); err != nil {
				return err
			}
		}
	}
	mediaIDs := make([]string, 0, len(references)+1)
	for _, mediaID := range references {
		mediaIDs = append(mediaIDs, mediaID)
	}
	if coverID := strings.TrimSpace(coverPreviewMediaID); coverID != "" {
		mediaIDs = append(mediaIDs, coverID)
	}
	state := &models.VideoRevisionMediaIndexState{
		RevisionID:  revisionID,
		MediaCount:  len(stringSet(mediaIDs)),
		Status:      "complete",
		ProcessedAt: now,
	}
	_, err := tx.NewInsert().Model(state).Exec(ctx)
	return err
}

func pruneVideoProjectRevisions(
	ctx context.Context,
	tx bun.Tx,
	projectID string,
	now time.Time,
) error {
	var expiredIDs []string
	if err := tx.NewSelect().Model((*models.VideoProjectRevision)(nil)).
		Column("id").
		Where("video_project_id = ? AND kind = ? AND expires_at < ?", projectID, "autosave", now).
		OrderExpr("expires_at ASC, id ASC").
		Limit(1_000).
		Scan(ctx, &expiredIDs); err != nil {
		return err
	}
	var stale []models.VideoProjectRevision
	if err := tx.NewSelect().Model(&stale).
		Where("video_project_id = ? AND kind = ?", projectID, "autosave").
		OrderExpr("created_at DESC").Offset(20).Limit(1_000).Scan(ctx); err != nil {
		return err
	}
	ids := append([]string(nil), expiredIDs...)
	for _, revision := range stale {
		ids = append(ids, revision.ID)
	}
	ids = uniqueVideoProjectStringsInOrder(ids)
	if len(ids) == 0 {
		return nil
	}
	usages := make([]string, 0, len(ids))
	for _, id := range ids {
		usages = append(usages, "revision:"+id)
	}
	if _, err := tx.NewDelete().Model((*models.VideoProjectAsset)(nil)).
		Where("video_project_id = ? AND usage IN (?)", projectID, bun.List(usages)).
		Exec(ctx); err != nil {
		return err
	}
	_, err := tx.NewDelete().Model((*models.VideoProjectRevision)(nil)).
		Where("video_project_id = ? AND id IN (?)", projectID, bun.List(ids)).Exec(ctx)
	return err
}

func videoRevisionSummary(
	revision models.VideoProjectRevision,
	actor EditorRevisionActor,
) VideoProjectRevisionSummary {
	summary := VideoProjectRevisionSummary{
		ID: revision.ID, Revision: revision.Revision, Kind: revision.Kind, Name: revision.Name,
		CreatedAt: revision.CreatedAt.UTC().Format(time.RFC3339), Actor: actor,
	}
	if !revision.ExpiresAt.IsZero() {
		summary.ExpiresAt = revision.ExpiresAt.UTC().Format(time.RFC3339)
	}
	return summary
}

func compressVideoProjectSnapshot(snapshot videoProjectRevisionSnapshot) ([]byte, error) {
	data, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(data); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func decompressVideoProjectSnapshot(compressed []byte) (videoProjectRevisionSnapshot, error) {
	var snapshot videoProjectRevisionSnapshot
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return snapshot, err
	}
	defer reader.Close() //nolint:errcheck
	const envelopeAllowance = 64 << 10
	data, err := io.ReadAll(io.LimitReader(reader, videoproject.MaxDocumentBytes+envelopeAllowance+1))
	if err != nil || len(data) > videoproject.MaxDocumentBytes+envelopeAllowance {
		return snapshot, errors.New("snapshot is too large")
	}
	var probe struct {
		SnapshotVersion int `json:"snapshot_version"`
	}
	if err := json.Unmarshal(data, &probe); err != nil {
		return snapshot, err
	}
	if probe.SnapshotVersion == 0 {
		document, err := decodeVideoProjectDocument(string(data))
		snapshot.Document = document
		return snapshot, err
	}
	if probe.SnapshotVersion != videoProjectSnapshotVersion {
		return snapshot, fmt.Errorf("unsupported OpenPost Video Editor snapshot version %d", probe.SnapshotVersion)
	}
	var envelope struct {
		SnapshotVersion     int             `json:"snapshot_version"`
		Document            json.RawMessage `json:"document"`
		CoverPreviewMediaID string          `json:"cover_preview_media_id,omitempty"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return snapshot, err
	}
	document, err := decodeVideoProjectDocument(string(envelope.Document))
	if err != nil {
		return snapshot, err
	}
	snapshot.SnapshotVersion = envelope.SnapshotVersion
	snapshot.Document = document
	snapshot.CoverPreviewMediaID = envelope.CoverPreviewMediaID
	return snapshot, nil
}

func decodeVideoProjectDocument(encoded string) (videoproject.Document, error) {
	var document videoproject.Document
	decoder := json.NewDecoder(strings.NewReader(encoded))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&document); err != nil {
		return document, err
	}
	document.Normalize()
	return document, nil
}

func normalizeVideoReturnURL(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "/", nil
	}
	if !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") ||
		strings.ContainsAny(value, "\r\n") {
		return "", errors.New("return URL must be same-origin")
	}
	return value, nil
}

func newVideoReturnToken() (string, string, error) {
	var tokenBytes [32]byte
	if _, err := rand.Read(tokenBytes[:]); err != nil {
		return "", "", err
	}
	raw := hex.EncodeToString(tokenBytes[:])
	hash := sha256.Sum256([]byte(raw))
	return raw, hex.EncodeToString(hash[:]), nil
}

func stringSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		if normalized := strings.ToLower(strings.TrimSpace(value)); normalized != "" {
			result[normalized] = struct{}{}
		}
	}
	return result
}

func uniqueVideoProjectStringsInOrder(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	unique := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		unique = append(unique, value)
	}
	return unique
}

func validVideoVariant(value string) bool {
	switch value {
	case "portrait", "feed-portrait", "square", "landscape":
		return true
	default:
		return false
	}
}
