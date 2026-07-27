package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

type StudioTemplateResponse struct {
	ID             string                `json:"id"`
	WorkspaceID    string                `json:"workspace_id,omitempty"`
	Name           string                `json:"name"`
	Category       string                `json:"category"`
	PresetKey      string                `json:"preset_key"`
	BuiltIn        bool                  `json:"built_in"`
	PreviewMediaID string                `json:"preview_media_id,omitempty"`
	Document       StudioDocumentPayload `json:"document"`
	CreatedAt      string                `json:"created_at,omitempty"`
	UpdatedAt      string                `json:"updated_at,omitempty"`
}

type ListStudioTemplatesInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
}

type ListStudioTemplatesOutput struct {
	Body struct {
		Templates []StudioTemplateResponse `json:"templates"`
		CanEdit   bool                     `json:"can_edit"`
	}
}

type CreateStudioTemplateInput struct {
	Body struct {
		WorkspaceID    string                `json:"workspace_id"`
		Name           string                `json:"name" minLength:"1" maxLength:"120"`
		Category       string                `json:"category" maxLength:"80"`
		PreviewMediaID string                `json:"preview_media_id,omitempty"`
		Document       StudioDocumentPayload `json:"document"`
	}
}

type CreateStudioTemplateOutput struct {
	Body StudioTemplateResponse
}

type UpdateStudioTemplateInput struct {
	PathID string `path:"id"`
	Body   struct {
		Name           string                `json:"name" minLength:"1" maxLength:"120"`
		Category       string                `json:"category" maxLength:"80"`
		PreviewMediaID string                `json:"preview_media_id,omitempty"`
		Document       StudioDocumentPayload `json:"document"`
	}
}

type UpdateStudioTemplateOutput struct {
	Body StudioTemplateResponse
}

type DeleteStudioTemplateInput struct {
	PathID string `path:"id"`
}

type DeleteStudioTemplateOutput struct {
	Body struct {
		Deleted bool `json:"deleted"`
	}
}

type InstantiateStudioTemplateInput struct {
	PathID string `path:"id"`
	Body   struct {
		WorkspaceID string `json:"workspace_id"`
		Title       string `json:"title" maxLength:"160"`
	}
}

type InstantiateStudioTemplateOutput struct {
	Body StudioDocumentResponse
}

type StudioBrandColor struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Value string `json:"value"`
}

type StudioBrandTextStyle struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	FontFamily    string  `json:"font_family"`
	FontAssetID   string  `json:"font_asset_id,omitempty"`
	FontWeight    int     `json:"font_weight"`
	FontStyle     string  `json:"font_style"`
	FontSize      float64 `json:"font_size"`
	Color         string  `json:"color"`
	LineHeight    float64 `json:"line_height"`
	LetterSpacing float64 `json:"letter_spacing"`
}

type StudioBrandAsset struct {
	ID      string `json:"id,omitempty"`
	MediaID string `json:"media_id"`
	Role    string `json:"role" enum:"primary_logo,secondary_logo,mark,watermark"`
	Name    string `json:"name"`
}

type StudioBrandFont struct {
	ID                    string `json:"id,omitempty"`
	MediaID               string `json:"media_id"`
	Family                string `json:"family"`
	CSSFamily             string `json:"css_family,omitempty"`
	Weight                int    `json:"weight" minimum:"100" maximum:"900"`
	Style                 string `json:"style" enum:"normal,italic"`
	LicenseAcknowledged   bool   `json:"license_acknowledged,omitempty"`
	LicenseAcknowledgedBy string `json:"license_acknowledged_by,omitempty"`
	LicenseAcknowledgedAt string `json:"license_acknowledged_at,omitempty"`
}

type StudioBrandKitResponse struct {
	ID          string                 `json:"id,omitempty"`
	WorkspaceID string                 `json:"workspace_id"`
	Name        string                 `json:"name"`
	Revision    int                    `json:"revision"`
	Exists      bool                   `json:"exists"`
	CanEdit     bool                   `json:"can_edit"`
	Colors      []StudioBrandColor     `json:"colors"`
	TextStyles  []StudioBrandTextStyle `json:"text_styles"`
	Backgrounds []string               `json:"backgrounds"`
	Assets      []StudioBrandAsset     `json:"assets"`
	Fonts       []StudioBrandFont      `json:"fonts"`
	UpdatedAt   string                 `json:"updated_at,omitempty"`
}

type GetStudioBrandKitInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
}

type GetStudioBrandKitOutput struct {
	Body StudioBrandKitResponse
}

type UpdateStudioBrandKitInput struct {
	Body struct {
		WorkspaceID string                 `json:"workspace_id"`
		Name        string                 `json:"name" maxLength:"120"`
		Colors      []StudioBrandColor     `json:"colors"`
		TextStyles  []StudioBrandTextStyle `json:"text_styles"`
		Backgrounds []string               `json:"backgrounds"`
		Assets      []StudioBrandAsset     `json:"assets"`
		Fonts       []StudioBrandFont      `json:"fonts"`
	}
}

type UpdateStudioBrandKitOutput struct {
	Body StudioBrandKitResponse
}

type MediaCollectionResponse struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspace_id"`
	Name        string `json:"name"`
	Color       string `json:"color"`
	ItemCount   int    `json:"item_count"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

type ListMediaCollectionsInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
}

type ListMediaCollectionsOutput struct {
	Body struct {
		Collections []MediaCollectionResponse `json:"collections"`
		CanEdit     bool                      `json:"can_edit"`
	}
}

type CreateMediaCollectionInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id"`
		Name        string `json:"name" minLength:"1" maxLength:"100"`
		Color       string `json:"color" maxLength:"32"`
	}
}

type CreateMediaCollectionOutput struct {
	Body MediaCollectionResponse
}

type UpdateMediaCollectionInput struct {
	PathID string `path:"id"`
	Body   struct {
		Name  string `json:"name" minLength:"1" maxLength:"100"`
		Color string `json:"color" maxLength:"32"`
	}
}

type UpdateMediaCollectionOutput struct {
	Body MediaCollectionResponse
}

type DeleteMediaCollectionInput struct {
	PathID string `path:"id"`
}

type DeleteMediaCollectionOutput struct {
	Body struct {
		Deleted bool `json:"deleted"`
	}
}

type ReplaceMediaCollectionItemsInput struct {
	PathID string `path:"id"`
	Body   struct {
		MediaIDs []string `json:"media_ids" maxItems:"500"`
		Mode     string   `json:"mode,omitempty" enum:"replace,add,remove" default:"replace"`
	}
}

type ReplaceMediaCollectionItemsOutput struct {
	Body struct {
		Count int `json:"count"`
	}
}

type MediaTagResponse struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspace_id"`
	Name        string `json:"name"`
	ItemCount   int    `json:"item_count"`
	CreatedAt   string `json:"created_at"`
}

type ListMediaTagsInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
}

type ListMediaTagsOutput struct {
	Body struct {
		Tags    []MediaTagResponse `json:"tags"`
		CanEdit bool               `json:"can_edit"`
	}
}

type CreateMediaTagInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id"`
		Name        string `json:"name" minLength:"1" maxLength:"64"`
	}
}

type CreateMediaTagOutput struct {
	Body MediaTagResponse
}

type UpdateMediaTagInput struct {
	PathID string `path:"id"`
	Body   struct {
		Name string `json:"name" minLength:"1" maxLength:"64"`
	}
}

type UpdateMediaTagOutput struct {
	Body MediaTagResponse
}

type DeleteMediaTagInput struct {
	PathID string `path:"id"`
}

type DeleteMediaTagOutput struct {
	Body struct {
		Deleted bool `json:"deleted"`
	}
}

type ReplaceMediaTagItemsInput struct {
	PathID string `path:"id"`
	Body   struct {
		MediaIDs []string `json:"media_ids" maxItems:"500"`
		Mode     string   `json:"mode,omitempty" enum:"replace,add,remove" default:"replace"`
	}
}

type ReplaceMediaTagItemsOutput struct {
	Body struct {
		Count int `json:"count"`
	}
}

func (h *StudioHandler) registerTemplates(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-studio-templates",
		Method:      http.MethodGet,
		Path:        "/studio/templates",
		Summary:     "List built-in and workspace Studio templates",
		Tags:        []string{tagStudio},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, h.listTemplates)

	huma.Register(api, huma.Operation{
		OperationID:   "create-studio-template",
		Method:        http.MethodPost,
		Path:          "/studio/templates",
		Summary:       "Save a Studio design as a workspace template",
		Tags:          []string{tagStudio},
		DefaultStatus: http.StatusCreated,
		Middlewares:   huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:        []int{400, 403},
	}, h.createTemplate)

	huma.Register(api, huma.Operation{
		OperationID: "update-studio-template",
		Method:      http.MethodPatch,
		Path:        "/studio/templates/{id}",
		Summary:     "Replace a workspace Studio template snapshot",
		Tags:        []string{tagStudio},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, h.updateTemplate)

	huma.Register(api, huma.Operation{
		OperationID: "delete-studio-template",
		Method:      http.MethodDelete,
		Path:        "/studio/templates/{id}",
		Summary:     "Delete a workspace Studio template",
		Tags:        []string{tagStudio},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, h.deleteTemplate)

	huma.Register(api, huma.Operation{
		OperationID: "instantiate-studio-template",
		Method:      http.MethodPost,
		Path:        "/studio/templates/{id}/instantiate",
		Summary:     "Create a Studio design from a template",
		Tags:        []string{tagStudio},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, h.instantiateTemplate)
}

func (h *StudioHandler) registerBrandKit(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-studio-brand-kit",
		Method:      http.MethodGet,
		Path:        "/studio/brand-kit",
		Summary:     "Get the workspace Studio brand kit",
		Tags:        []string{tagStudio},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, h.getBrandKit)

	huma.Register(api, huma.Operation{
		OperationID: "update-studio-brand-kit",
		Method:      http.MethodPut,
		Path:        "/studio/brand-kit",
		Summary:     "Create or update the workspace Studio brand kit",
		Tags:        []string{tagStudio},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, h.updateBrandKit)
}

func (h *StudioHandler) registerMediaOrganization(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-media-collections",
		Method:      http.MethodGet,
		Path:        "/media/collections",
		Summary:     "List media collections",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.listCollections)
	huma.Register(api, huma.Operation{
		OperationID: "create-media-collection",
		Method:      http.MethodPost,
		Path:        "/media/collections",
		Summary:     "Create a media collection",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.createCollection)
	huma.Register(api, huma.Operation{
		OperationID: "delete-media-collection",
		Method:      http.MethodDelete,
		Path:        "/media/collections/{id}",
		Summary:     "Delete a media collection without deleting media",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.deleteCollection)
	huma.Register(api, huma.Operation{
		OperationID: "update-media-collection",
		Method:      http.MethodPatch,
		Path:        "/media/collections/{id}",
		Summary:     "Rename or recolor a media collection",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.updateCollection)
	huma.Register(api, huma.Operation{
		OperationID: "replace-media-collection-items",
		Method:      http.MethodPut,
		Path:        "/media/collections/{id}/items",
		Summary:     "Replace a media collection's items",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.replaceCollectionItems)
	huma.Register(api, huma.Operation{
		OperationID: "list-media-tags",
		Method:      http.MethodGet,
		Path:        "/media/tags",
		Summary:     "List media tags",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.listTags)
	huma.Register(api, huma.Operation{
		OperationID: "create-media-tag",
		Method:      http.MethodPost,
		Path:        "/media/tags",
		Summary:     "Create a media tag",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.createTag)
	huma.Register(api, huma.Operation{
		OperationID: "delete-media-tag",
		Method:      http.MethodDelete,
		Path:        "/media/tags/{id}",
		Summary:     "Delete a media tag without deleting media",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.deleteTag)
	huma.Register(api, huma.Operation{
		OperationID: "update-media-tag",
		Method:      http.MethodPatch,
		Path:        "/media/tags/{id}",
		Summary:     "Rename a media tag",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.updateTag)
	huma.Register(api, huma.Operation{
		OperationID: "replace-media-tag-items",
		Method:      http.MethodPut,
		Path:        "/media/tags/{id}/items",
		Summary:     "Replace a media tag's assignments",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.replaceTagItems)
}

func (h *StudioHandler) listTemplates(ctx context.Context, input *ListStudioTemplatesInput) (*ListStudioTemplatesOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	canEdit, err := h.requireAccess(ctx, input.WorkspaceID, false)
	if err != nil {
		return nil, err
	}
	out := &ListStudioTemplatesOutput{}
	out.Body.CanEdit = canEdit
	out.Body.Templates = builtinStudioTemplates()
	var templates []models.DesignTemplate
	if err := h.db.NewSelect().Model(&templates).
		Where("workspace_id = ?", input.WorkspaceID).
		OrderExpr("updated_at DESC").
		Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to list Studio templates")
	}
	for _, template := range templates {
		var payload StudioDocumentPayload
		if err := json.Unmarshal([]byte(template.SnapshotJSON), &payload); err != nil {
			continue
		}
		out.Body.Templates = append(out.Body.Templates, templateResponse(template, payload))
	}
	return out, nil
}

func (h *StudioHandler) createTemplate(ctx context.Context, input *CreateStudioTemplateInput) (*CreateStudioTemplateOutput, error) {
	if err := validateStudioPayload(input.Body.Document); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	if _, err := h.requireAccess(ctx, input.Body.WorkspaceID, true); err != nil {
		return nil, err
	}
	if err := h.validateMediaReferences(ctx, input.Body.WorkspaceID, input.Body.Document.Pages); err != nil {
		return nil, err
	}
	if err := h.validateOptionalWorkspaceMedia(ctx, input.Body.WorkspaceID, input.Body.PreviewMediaID); err != nil {
		return nil, err
	}
	snapshot, err := json.Marshal(input.Body.Document)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid Studio template")
	}
	now := time.Now().UTC()
	template := &models.DesignTemplate{
		ID:             uuid.NewString(),
		WorkspaceID:    input.Body.WorkspaceID,
		CreatedByID:    middleware.GetUserID(ctx),
		Name:           strings.TrimSpace(input.Body.Name),
		Category:       strings.TrimSpace(input.Body.Category),
		PresetKey:      input.Body.Document.PresetKey,
		SchemaVersion:  studioSchemaVersion,
		SnapshotJSON:   string(snapshot),
		PreviewMediaID: strings.TrimSpace(input.Body.PreviewMediaID),
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if template.Name == "" {
		return nil, huma.Error400BadRequest("template name is required")
	}
	ids := studioMediaIDs(input.Body.Document.Pages)
	if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(template).Exec(txCtx); err != nil {
			return err
		}
		if len(ids) == 0 {
			return nil
		}
		refs := make([]models.DesignTemplateMediaReference, 0, len(ids))
		for _, mediaID := range ids {
			refs = append(refs, models.DesignTemplateMediaReference{
				DesignTemplateID: template.ID,
				MediaID:          mediaID,
				CreatedAt:        now,
			})
		}
		_, err := tx.NewInsert().Model(&refs).Exec(txCtx)
		return err
	}); err != nil {
		return nil, huma.Error500InternalServerError("failed to create Studio template")
	}
	return &CreateStudioTemplateOutput{Body: templateResponse(*template, input.Body.Document)}, nil
}

func (h *StudioHandler) updateTemplate(ctx context.Context, input *UpdateStudioTemplateInput) (*UpdateStudioTemplateOutput, error) {
	if strings.HasPrefix(input.PathID, "builtin-") {
		return nil, huma.Error403Forbidden("built-in templates cannot be replaced")
	}
	var template models.DesignTemplate
	err := h.db.NewSelect().Model(&template).Where("id = ?", input.PathID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("Studio template not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load Studio template")
	}
	if _, err := h.requireAccess(ctx, template.WorkspaceID, true); err != nil {
		return nil, err
	}
	if err := validateStudioPayload(input.Body.Document); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	if err := h.validateMediaReferences(ctx, template.WorkspaceID, input.Body.Document.Pages); err != nil {
		return nil, err
	}
	if err := h.validateOptionalWorkspaceMedia(ctx, template.WorkspaceID, input.Body.PreviewMediaID); err != nil {
		return nil, err
	}
	snapshot, err := json.Marshal(input.Body.Document)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid Studio template")
	}
	name := strings.TrimSpace(input.Body.Name)
	if name == "" {
		return nil, huma.Error400BadRequest("template name is required")
	}
	now := time.Now().UTC()
	ids := studioMediaIDs(input.Body.Document.Pages)
	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewUpdate().Model(&template).
			Set("name = ?", name).
			Set("category = ?", strings.TrimSpace(input.Body.Category)).
			Set("preset_key = ?", input.Body.Document.PresetKey).
			Set("schema_version = ?", studioSchemaVersion).
			Set("snapshot_json = ?", string(snapshot)).
			Set("preview_media_id = ?", strings.TrimSpace(input.Body.PreviewMediaID)).
			Set("updated_at = ?", now).
			WherePK().
			Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewDelete().Model((*models.DesignTemplateMediaReference)(nil)).
			Where("design_template_id = ?", template.ID).
			Exec(txCtx); err != nil {
			return err
		}
		if len(ids) == 0 {
			return nil
		}
		refs := make([]models.DesignTemplateMediaReference, 0, len(ids))
		for _, mediaID := range ids {
			refs = append(refs, models.DesignTemplateMediaReference{
				DesignTemplateID: template.ID,
				MediaID:          mediaID,
				CreatedAt:        now,
			})
		}
		_, err := tx.NewInsert().Model(&refs).Exec(txCtx)
		return err
	})
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to replace Studio template")
	}
	template.Name = name
	template.Category = strings.TrimSpace(input.Body.Category)
	template.PresetKey = input.Body.Document.PresetKey
	template.SchemaVersion = studioSchemaVersion
	template.SnapshotJSON = string(snapshot)
	template.PreviewMediaID = strings.TrimSpace(input.Body.PreviewMediaID)
	template.UpdatedAt = now
	return &UpdateStudioTemplateOutput{Body: templateResponse(template, input.Body.Document)}, nil
}

func (h *StudioHandler) validateOptionalWorkspaceMedia(ctx context.Context, workspaceID, mediaID string) error {
	mediaID = strings.TrimSpace(mediaID)
	if mediaID == "" {
		return nil
	}
	count, err := h.db.NewSelect().Model((*models.MediaAttachment)(nil)).
		Where("id = ? AND workspace_id = ?", mediaID, workspaceID).
		Count(ctx)
	if err != nil {
		return huma.Error500InternalServerError("failed to validate Studio template preview")
	}
	if count != 1 {
		return huma.Error400BadRequest("Studio template preview must belong to the workspace")
	}
	return nil
}

func (h *StudioHandler) deleteTemplate(ctx context.Context, input *DeleteStudioTemplateInput) (*DeleteStudioTemplateOutput, error) {
	if strings.HasPrefix(input.PathID, "builtin-") {
		return nil, huma.Error403Forbidden("built-in templates cannot be deleted")
	}
	var template models.DesignTemplate
	err := h.db.NewSelect().Model(&template).Where("id = ?", input.PathID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("Studio template not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load Studio template")
	}
	if _, err := h.requireAccess(ctx, template.WorkspaceID, true); err != nil {
		return nil, err
	}
	if _, err := h.db.NewDelete().Model(&template).WherePK().Exec(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to delete Studio template")
	}
	return &DeleteStudioTemplateOutput{Body: struct {
		Deleted bool `json:"deleted"`
	}{Deleted: true}}, nil
}

func (h *StudioHandler) instantiateTemplate(ctx context.Context, input *InstantiateStudioTemplateInput) (*InstantiateStudioTemplateOutput, error) {
	if _, err := h.requireAccess(ctx, input.Body.WorkspaceID, true); err != nil {
		return nil, err
	}
	var payload StudioDocumentPayload
	var found bool
	for _, template := range builtinStudioTemplates() {
		if template.ID == input.PathID {
			payload = template.Document
			found = true
			break
		}
	}
	if !found {
		var template models.DesignTemplate
		err := h.db.NewSelect().Model(&template).
			Where("id = ? AND workspace_id = ?", input.PathID, input.Body.WorkspaceID).
			Scan(ctx)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("Studio template not found")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load Studio template")
		}
		if err := json.Unmarshal([]byte(template.SnapshotJSON), &payload); err != nil {
			return nil, huma.Error400BadRequest("Studio template is corrupt")
		}
	}
	payload = cloneStudioPayload(payload)
	if title := strings.TrimSpace(input.Body.Title); title != "" {
		payload.Title = title
	}
	response, err := h.createDocumentFromPayload(ctx, input.Body.WorkspaceID, payload)
	if err != nil {
		return nil, err
	}
	return &InstantiateStudioTemplateOutput{Body: *response}, nil
}

func (h *StudioHandler) createDocumentFromPayload(ctx context.Context, workspaceID string, payload StudioDocumentPayload) (*StudioDocumentResponse, error) {
	if err := validateStudioPayload(payload); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	if err := h.validateMediaReferences(ctx, workspaceID, payload.Pages); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	document := &models.DesignDocument{
		ID:               uuid.NewString(),
		WorkspaceID:      workspaceID,
		CreatedByID:      middleware.GetUserID(ctx),
		Title:            payload.Title,
		SchemaVersion:    payload.SchemaVersion,
		Revision:         1,
		PresetKey:        payload.PresetKey,
		WidthPX:          payload.WidthPX,
		HeightPX:         payload.HeightPX,
		BrandKitID:       payload.BrandKitID,
		BrandKitRevision: payload.BrandKitRevision,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(document).Exec(txCtx); err != nil {
			return err
		}
		if err := insertStudioPages(txCtx, tx, document.ID, payload.Pages, now); err != nil {
			return err
		}
		return replaceStudioMediaReferences(txCtx, tx, document, payload.Pages)
	}); err != nil {
		return nil, huma.Error500InternalServerError("failed to create Studio design")
	}
	return h.documentResponse(ctx, document.ID)
}

func (h *StudioHandler) getBrandKit(ctx context.Context, input *GetStudioBrandKitInput) (*GetStudioBrandKitOutput, error) {
	canEdit, err := h.requireAccess(ctx, input.WorkspaceID, false)
	if err != nil {
		return nil, err
	}
	response, err := h.loadBrandKit(ctx, input.WorkspaceID, canEdit)
	if err != nil {
		return nil, err
	}
	return &GetStudioBrandKitOutput{Body: response}, nil
}

//nolint:gocyclo // Brand-kit validation and reference replacement are committed as one operation.
func (h *StudioHandler) updateBrandKit(ctx context.Context, input *UpdateStudioBrandKitInput) (*UpdateStudioBrandKitOutput, error) {
	if _, err := h.requireAccess(ctx, input.Body.WorkspaceID, true); err != nil {
		return nil, err
	}
	if err := validateStudioBrandKit(input.Body.Colors, input.Body.TextStyles, input.Body.Backgrounds); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	mediaIDs := make([]string, 0, len(input.Body.Assets)+len(input.Body.Fonts))
	for _, asset := range input.Body.Assets {
		mediaIDs = append(mediaIDs, asset.MediaID)
	}
	for _, font := range input.Body.Fonts {
		if !font.LicenseAcknowledged {
			return nil, huma.Error400BadRequest("confirm that you may use each uploaded font")
		}
		if strings.TrimSpace(font.Family) == "" {
			return nil, huma.Error400BadRequest("brand fonts require a family name")
		}
		mediaIDs = append(mediaIDs, font.MediaID)
	}
	mediaByID, err := h.workspaceMediaByID(ctx, input.Body.WorkspaceID, mediaIDs)
	if err != nil {
		return nil, err
	}
	for _, font := range input.Body.Fonts {
		media := mediaByID[font.MediaID]
		if !isStudioBrandFontMedia(media) {
			return nil, huma.Error400BadRequest("brand fonts must be WOFF2, TTF, or OTF files")
		}
	}
	colorsJSON, _ := json.Marshal(input.Body.Colors)
	textStylesJSON, _ := json.Marshal(input.Body.TextStyles)
	backgroundsJSON, _ := json.Marshal(input.Body.Backgrounds)
	now := time.Now().UTC()
	name := strings.TrimSpace(input.Body.Name)
	if name == "" {
		name = "Workspace brand"
	}
	var kit models.BrandKit
	err = h.db.NewSelect().Model(&kit).Where("workspace_id = ?", input.Body.WorkspaceID).Scan(ctx)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		kit = models.BrandKit{
			ID:              uuid.NewString(),
			WorkspaceID:     input.Body.WorkspaceID,
			Name:            name,
			Revision:        1,
			ColorsJSON:      string(colorsJSON),
			TextStylesJSON:  string(textStylesJSON),
			BackgroundsJSON: string(backgroundsJSON),
			CreatedAt:       now,
			UpdatedAt:       now,
		}
	case err != nil:
		return nil, huma.Error500InternalServerError("failed to load Studio brand kit")
	default:
		kit.Name = name
		kit.Revision++
		kit.ColorsJSON = string(colorsJSON)
		kit.TextStylesJSON = string(textStylesJSON)
		kit.BackgroundsJSON = string(backgroundsJSON)
		kit.UpdatedAt = now
	}
	incomingFontIDs := make(map[string]struct{}, len(input.Body.Fonts))
	for _, font := range input.Body.Fonts {
		incomingFontIDs[font.MediaID] = struct{}{}
	}
	for _, style := range input.Body.TextStyles {
		if style.FontAssetID == "" {
			continue
		}
		if _, ok := incomingFontIDs[style.FontAssetID]; !ok {
			return nil, huma.Error400BadRequest("brand text styles must reference a font kept in the brand kit")
		}
	}
	if !kit.CreatedAt.Equal(now) {
		var existingFonts []models.BrandFont
		if err := h.db.NewSelect().Model(&existingFonts).Where("brand_kit_id = ?", kit.ID).Scan(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to validate existing brand fonts")
		}
		removed := make([]string, 0)
		for _, font := range existingFonts {
			if _, kept := incomingFontIDs[font.MediaID]; !kept {
				removed = append(removed, font.MediaID)
			}
		}
		if len(removed) > 0 {
			designUses, err := h.db.NewSelect().Model((*models.DesignMediaReference)(nil)).
				Where("usage = ? AND media_id IN (?)", "font", bun.List(removed)).
				Count(ctx)
			if err != nil {
				return nil, huma.Error500InternalServerError("failed to check brand font usage")
			}
			templateUses, err := h.db.NewSelect().Model((*models.DesignTemplateMediaReference)(nil)).
				Where("media_id IN (?)", bun.List(removed)).
				Count(ctx)
			if err != nil {
				return nil, huma.Error500InternalServerError("failed to check template font usage")
			}
			if designUses+templateUses > 0 {
				return nil, huma.NewError(http.StatusConflict, "a brand font is still used by a design or template")
			}
		}
	}
	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if kit.CreatedAt.Equal(now) {
			if _, err := tx.NewInsert().Model(&kit).Exec(txCtx); err != nil {
				return err
			}
		} else {
			if _, err := tx.NewUpdate().Model(&kit).
				Column("name", "revision", "colors_json", "text_styles_json", "backgrounds_json", "updated_at").
				WherePK().
				Exec(txCtx); err != nil {
				return err
			}
		}
		if _, err := tx.NewDelete().Model((*models.BrandAsset)(nil)).Where("brand_kit_id = ?", kit.ID).Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewDelete().Model((*models.BrandFont)(nil)).Where("brand_kit_id = ?", kit.ID).Exec(txCtx); err != nil {
			return err
		}
		for _, item := range input.Body.Assets {
			asset := &models.BrandAsset{
				ID:         uuid.NewString(),
				BrandKitID: kit.ID,
				MediaID:    item.MediaID,
				Role:       item.Role,
				Name:       strings.TrimSpace(item.Name),
				CreatedAt:  now,
			}
			if _, err := tx.NewInsert().Model(asset).Exec(txCtx); err != nil {
				return err
			}
		}
		for _, item := range input.Body.Fonts {
			font := &models.BrandFont{
				ID:                    uuid.NewString(),
				BrandKitID:            kit.ID,
				MediaID:               item.MediaID,
				Family:                strings.TrimSpace(item.Family),
				Weight:                item.Weight,
				Style:                 item.Style,
				LicenseAcknowledgedBy: middleware.GetUserID(ctx),
				LicenseAcknowledgedAt: now,
				CreatedAt:             now,
			}
			if _, err := tx.NewInsert().Model(font).Exec(txCtx); err != nil {
				return err
			}
			if _, err := tx.NewUpdate().Model((*models.MediaAttachment)(nil)).
				Set("asset_kind = ?", "brand_font").
				Where("id = ? AND workspace_id = ?", item.MediaID, input.Body.WorkspaceID).
				Exec(txCtx); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to update Studio brand kit")
	}
	response, err := h.loadBrandKit(ctx, input.Body.WorkspaceID, true)
	if err != nil {
		return nil, err
	}
	return &UpdateStudioBrandKitOutput{Body: response}, nil
}

func (h *StudioHandler) loadBrandKit(ctx context.Context, workspaceID string, canEdit bool) (StudioBrandKitResponse, error) {
	response := StudioBrandKitResponse{
		WorkspaceID: workspaceID,
		Name:        "Workspace brand",
		CanEdit:     canEdit,
		Colors:      []StudioBrandColor{},
		TextStyles:  []StudioBrandTextStyle{},
		Backgrounds: []string{},
		Assets:      []StudioBrandAsset{},
		Fonts:       []StudioBrandFont{},
	}
	var kit models.BrandKit
	err := h.db.NewSelect().Model(&kit).Where("workspace_id = ?", workspaceID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return response, nil
	}
	if err != nil {
		return response, huma.Error500InternalServerError("failed to load Studio brand kit")
	}
	response.ID = kit.ID
	response.Name = kit.Name
	response.Revision = kit.Revision
	response.Exists = true
	response.UpdatedAt = kit.UpdatedAt.UTC().Format(time.RFC3339)
	_ = json.Unmarshal([]byte(kit.ColorsJSON), &response.Colors)
	_ = json.Unmarshal([]byte(kit.TextStylesJSON), &response.TextStyles)
	_ = json.Unmarshal([]byte(kit.BackgroundsJSON), &response.Backgrounds)
	var assets []models.BrandAsset
	if err := h.db.NewSelect().Model(&assets).Where("brand_kit_id = ?", kit.ID).OrderExpr("created_at ASC").Scan(ctx); err != nil {
		return response, huma.Error500InternalServerError("failed to load Studio brand assets")
	}
	for _, asset := range assets {
		response.Assets = append(response.Assets, StudioBrandAsset{
			ID: asset.ID, MediaID: asset.MediaID, Role: asset.Role, Name: asset.Name,
		})
	}
	var fonts []models.BrandFont
	if err := h.db.NewSelect().Model(&fonts).Where("brand_kit_id = ?", kit.ID).OrderExpr("family ASC, weight ASC").Scan(ctx); err != nil {
		return response, huma.Error500InternalServerError("failed to load Studio brand fonts")
	}
	for _, font := range fonts {
		response.Fonts = append(response.Fonts, StudioBrandFont{
			ID:                    font.ID,
			MediaID:               font.MediaID,
			Family:                font.Family,
			CSSFamily:             studioBrandFontCSSFamily(font.MediaID),
			Weight:                font.Weight,
			Style:                 font.Style,
			LicenseAcknowledged:   true,
			LicenseAcknowledgedBy: font.LicenseAcknowledgedBy,
			LicenseAcknowledgedAt: font.LicenseAcknowledgedAt.UTC().Format(time.RFC3339),
		})
	}
	return response, nil
}

func (h *StudioHandler) listCollections(ctx context.Context, input *ListMediaCollectionsInput) (*ListMediaCollectionsOutput, error) {
	canEdit, err := h.requireAccess(ctx, input.WorkspaceID, false)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		models.MediaCollection
		ItemCount int `bun:"item_count"`
	}
	if err := h.db.NewSelect().
		TableExpr("media_collections AS c").
		ColumnExpr("c.*").
		ColumnExpr("(SELECT COUNT(*) FROM media_collection_items i WHERE i.collection_id = c.id) AS item_count").
		Where("c.workspace_id = ?", input.WorkspaceID).
		OrderExpr("LOWER(c.name) ASC").
		Scan(ctx, &rows); err != nil {
		return nil, huma.Error500InternalServerError("failed to list media collections")
	}
	out := &ListMediaCollectionsOutput{}
	out.Body.CanEdit = canEdit
	out.Body.Collections = make([]MediaCollectionResponse, 0, len(rows))
	for _, row := range rows {
		out.Body.Collections = append(out.Body.Collections, collectionResponse(row.MediaCollection, row.ItemCount))
	}
	return out, nil
}

func (h *StudioHandler) createCollection(ctx context.Context, input *CreateMediaCollectionInput) (*CreateMediaCollectionOutput, error) {
	if _, err := h.requireAccess(ctx, input.Body.WorkspaceID, true); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	collection := &models.MediaCollection{
		ID:          uuid.NewString(),
		WorkspaceID: input.Body.WorkspaceID,
		Name:        strings.TrimSpace(input.Body.Name),
		Color:       strings.TrimSpace(input.Body.Color),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if collection.Name == "" {
		return nil, huma.Error400BadRequest("collection name is required")
	}
	if _, err := h.db.NewInsert().Model(collection).Exec(ctx); err != nil {
		return nil, huma.NewError(http.StatusConflict, "a collection with this name already exists")
	}
	return &CreateMediaCollectionOutput{Body: collectionResponse(*collection, 0)}, nil
}

func (h *StudioHandler) deleteCollection(ctx context.Context, input *DeleteMediaCollectionInput) (*DeleteMediaCollectionOutput, error) {
	collection, err := h.loadCollection(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, collection.WorkspaceID, true); err != nil {
		return nil, err
	}
	if _, err := h.db.NewDelete().Model(collection).WherePK().Exec(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to delete media collection")
	}
	return &DeleteMediaCollectionOutput{Body: struct {
		Deleted bool `json:"deleted"`
	}{Deleted: true}}, nil
}

func (h *StudioHandler) updateCollection(ctx context.Context, input *UpdateMediaCollectionInput) (*UpdateMediaCollectionOutput, error) {
	collection, err := h.loadCollection(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, collection.WorkspaceID, true); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(input.Body.Name)
	if name == "" {
		return nil, huma.Error400BadRequest("collection name is required")
	}
	collection.Name = name
	collection.Color = strings.TrimSpace(input.Body.Color)
	collection.UpdatedAt = time.Now().UTC()
	if _, err := h.db.NewUpdate().Model(collection).Column("name", "color", "updated_at").WherePK().Exec(ctx); err != nil {
		return nil, huma.Error400BadRequest("a collection with that name already exists")
	}
	count, err := h.db.NewSelect().Model((*models.MediaCollectionItem)(nil)).Where("collection_id = ?", collection.ID).Count(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to count collection items")
	}
	return &UpdateMediaCollectionOutput{Body: collectionResponse(*collection, count)}, nil
}

func (h *StudioHandler) replaceCollectionItems(ctx context.Context, input *ReplaceMediaCollectionItemsInput) (*ReplaceMediaCollectionItemsOutput, error) {
	collection, err := h.loadCollection(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, collection.WorkspaceID, true); err != nil {
		return nil, err
	}
	ids := uniqueStudioStrings(input.Body.MediaIDs)
	if _, err := h.workspaceMediaByID(ctx, collection.WorkspaceID, ids); err != nil {
		return nil, err
	}
	mode := strings.TrimSpace(input.Body.Mode)
	if mode == "" {
		mode = "replace"
	}
	if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if mode == "replace" {
			if _, err := tx.NewDelete().Model((*models.MediaCollectionItem)(nil)).Where("collection_id = ?", collection.ID).Exec(txCtx); err != nil {
				return err
			}
		}
		if mode == "remove" {
			if len(ids) == 0 {
				return nil
			}
			_, err := tx.NewDelete().
				Model((*models.MediaCollectionItem)(nil)).
				Where("collection_id = ? AND media_id IN (?)", collection.ID, bun.List(ids)).
				Exec(txCtx)
			return err
		}
		if len(ids) == 0 {
			return nil
		}
		items := make([]models.MediaCollectionItem, 0, len(ids))
		for _, mediaID := range ids {
			items = append(items, models.MediaCollectionItem{CollectionID: collection.ID, MediaID: mediaID, CreatedAt: time.Now().UTC()})
		}
		query := tx.NewInsert().Model(&items)
		if mode == "add" {
			query = query.On("CONFLICT (collection_id, media_id) DO NOTHING")
		}
		_, err := query.Exec(txCtx)
		return err
	}); err != nil {
		return nil, huma.Error500InternalServerError("failed to update media collection")
	}
	count, err := h.db.NewSelect().
		Model((*models.MediaCollectionItem)(nil)).
		Where("collection_id = ?", collection.ID).
		Count(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to count media collection items")
	}
	return &ReplaceMediaCollectionItemsOutput{Body: struct {
		Count int `json:"count"`
	}{Count: count}}, nil
}

func (h *StudioHandler) listTags(ctx context.Context, input *ListMediaTagsInput) (*ListMediaTagsOutput, error) {
	canEdit, err := h.requireAccess(ctx, input.WorkspaceID, false)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		models.MediaTag
		ItemCount int `bun:"item_count"`
	}
	if err := h.db.NewSelect().
		TableExpr("media_tags AS t").
		ColumnExpr("t.*").
		ColumnExpr("(SELECT COUNT(*) FROM media_tag_assignments a WHERE a.tag_id = t.id) AS item_count").
		Where("t.workspace_id = ?", input.WorkspaceID).
		OrderExpr("LOWER(t.name) ASC").
		Scan(ctx, &rows); err != nil {
		return nil, huma.Error500InternalServerError("failed to list media tags")
	}
	out := &ListMediaTagsOutput{}
	out.Body.CanEdit = canEdit
	out.Body.Tags = make([]MediaTagResponse, 0, len(rows))
	for _, row := range rows {
		out.Body.Tags = append(out.Body.Tags, tagResponse(row.MediaTag, row.ItemCount))
	}
	return out, nil
}

func (h *StudioHandler) createTag(ctx context.Context, input *CreateMediaTagInput) (*CreateMediaTagOutput, error) {
	if _, err := h.requireAccess(ctx, input.Body.WorkspaceID, true); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(input.Body.Name)
	if name == "" {
		return nil, huma.Error400BadRequest("tag name is required")
	}
	tag := &models.MediaTag{
		ID:             uuid.NewString(),
		WorkspaceID:    input.Body.WorkspaceID,
		Name:           name,
		NormalizedName: strings.ToLower(name),
		CreatedAt:      time.Now().UTC(),
	}
	if _, err := h.db.NewInsert().Model(tag).Exec(ctx); err != nil {
		return nil, huma.NewError(http.StatusConflict, "a tag with this name already exists")
	}
	return &CreateMediaTagOutput{Body: tagResponse(*tag, 0)}, nil
}

func (h *StudioHandler) deleteTag(ctx context.Context, input *DeleteMediaTagInput) (*DeleteMediaTagOutput, error) {
	tag, err := h.loadTag(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, tag.WorkspaceID, true); err != nil {
		return nil, err
	}
	if _, err := h.db.NewDelete().Model(tag).WherePK().Exec(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to delete media tag")
	}
	return &DeleteMediaTagOutput{Body: struct {
		Deleted bool `json:"deleted"`
	}{Deleted: true}}, nil
}

func (h *StudioHandler) updateTag(ctx context.Context, input *UpdateMediaTagInput) (*UpdateMediaTagOutput, error) {
	tag, err := h.loadTag(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, tag.WorkspaceID, true); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(input.Body.Name)
	if name == "" {
		return nil, huma.Error400BadRequest("tag name is required")
	}
	tag.Name = name
	tag.NormalizedName = strings.ToLower(name)
	if _, err := h.db.NewUpdate().Model(tag).Column("name", "normalized_name").WherePK().Exec(ctx); err != nil {
		return nil, huma.Error400BadRequest("a tag with that name already exists")
	}
	count, err := h.db.NewSelect().Model((*models.MediaTagAssignment)(nil)).Where("tag_id = ?", tag.ID).Count(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to count tag items")
	}
	return &UpdateMediaTagOutput{Body: tagResponse(*tag, count)}, nil
}

func (h *StudioHandler) replaceTagItems(ctx context.Context, input *ReplaceMediaTagItemsInput) (*ReplaceMediaTagItemsOutput, error) {
	tag, err := h.loadTag(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, tag.WorkspaceID, true); err != nil {
		return nil, err
	}
	ids := uniqueStudioStrings(input.Body.MediaIDs)
	if _, err := h.workspaceMediaByID(ctx, tag.WorkspaceID, ids); err != nil {
		return nil, err
	}
	mode := strings.TrimSpace(input.Body.Mode)
	if mode == "" {
		mode = "replace"
	}
	if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if mode == "replace" {
			if _, err := tx.NewDelete().Model((*models.MediaTagAssignment)(nil)).Where("tag_id = ?", tag.ID).Exec(txCtx); err != nil {
				return err
			}
		}
		if mode == "remove" {
			if len(ids) == 0 {
				return nil
			}
			_, err := tx.NewDelete().
				Model((*models.MediaTagAssignment)(nil)).
				Where("tag_id = ? AND media_id IN (?)", tag.ID, bun.List(ids)).
				Exec(txCtx)
			return err
		}
		if len(ids) == 0 {
			return nil
		}
		items := make([]models.MediaTagAssignment, 0, len(ids))
		for _, mediaID := range ids {
			items = append(items, models.MediaTagAssignment{TagID: tag.ID, MediaID: mediaID, CreatedAt: time.Now().UTC()})
		}
		query := tx.NewInsert().Model(&items)
		if mode == "add" {
			query = query.On("CONFLICT (tag_id, media_id) DO NOTHING")
		}
		_, err := query.Exec(txCtx)
		return err
	}); err != nil {
		return nil, huma.Error500InternalServerError("failed to update media tag")
	}
	count, err := h.db.NewSelect().
		Model((*models.MediaTagAssignment)(nil)).
		Where("tag_id = ?", tag.ID).
		Count(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to count media tag items")
	}
	return &ReplaceMediaTagItemsOutput{Body: struct {
		Count int `json:"count"`
	}{Count: count}}, nil
}

func (h *StudioHandler) loadCollection(ctx context.Context, id string) (*models.MediaCollection, error) {
	var collection models.MediaCollection
	err := h.db.NewSelect().Model(&collection).Where("id = ?", id).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("media collection not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load media collection")
	}
	return &collection, nil
}

func (h *StudioHandler) loadTag(ctx context.Context, id string) (*models.MediaTag, error) {
	var tag models.MediaTag
	err := h.db.NewSelect().Model(&tag).Where("id = ?", id).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("media tag not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load media tag")
	}
	return &tag, nil
}

func (h *StudioHandler) workspaceMediaByID(ctx context.Context, workspaceID string, ids []string) (map[string]models.MediaAttachment, error) {
	ids = uniqueStudioStrings(ids)
	result := make(map[string]models.MediaAttachment, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var media []models.MediaAttachment
	if err := h.db.NewSelect().Model(&media).
		Where("workspace_id = ? AND id IN (?)", workspaceID, bun.List(ids)).
		Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to validate media")
	}
	if len(media) != len(ids) {
		return nil, huma.Error400BadRequest("every media item must belong to the workspace")
	}
	for _, item := range media {
		result[item.ID] = item
	}
	return result, nil
}

func validateStudioBrandKit(colors []StudioBrandColor, textStyles []StudioBrandTextStyle, backgrounds []string) error {
	if len(colors) > 32 || len(textStyles) > 24 || len(backgrounds) > 16 {
		return fmt.Errorf("brand kit exceeds the supported item limits")
	}
	for _, color := range colors {
		if strings.TrimSpace(color.Name) == "" || !studioHexColor.MatchString(color.Value) {
			return fmt.Errorf("brand colors require a name and hexadecimal value")
		}
	}
	for _, style := range textStyles {
		if strings.TrimSpace(style.Name) == "" || strings.TrimSpace(style.FontFamily) == "" || style.FontSize <= 0 {
			return fmt.Errorf("brand text styles require a name, font family, and positive size")
		}
	}
	for _, background := range backgrounds {
		if !studioHexColor.MatchString(background) {
			return fmt.Errorf("brand backgrounds must be hexadecimal colors")
		}
	}
	return nil
}

var studioHexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$`)

func studioBrandFontCSSFamily(id string) string {
	return "OpenPostBrand_" + strings.ReplaceAll(id, "-", "")
}

func isStudioBrandFontMedia(media models.MediaAttachment) bool {
	switch strings.ToLower(filepath.Ext(media.OriginalFilename)) {
	case ".woff2", ".ttf", ".otf":
		return true
	}
	switch strings.ToLower(media.MimeType) {
	case "font/woff2", "font/ttf", "font/otf", "font/sfnt",
		"application/x-font-ttf", "application/x-font-opentype", "application/font-sfnt":
		return true
	default:
		return false
	}
}

func collectionResponse(collection models.MediaCollection, itemCount int) MediaCollectionResponse {
	return MediaCollectionResponse{
		ID:          collection.ID,
		WorkspaceID: collection.WorkspaceID,
		Name:        collection.Name,
		Color:       collection.Color,
		ItemCount:   itemCount,
		CreatedAt:   collection.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:   collection.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func tagResponse(tag models.MediaTag, itemCount int) MediaTagResponse {
	return MediaTagResponse{
		ID:          tag.ID,
		WorkspaceID: tag.WorkspaceID,
		Name:        tag.Name,
		ItemCount:   itemCount,
		CreatedAt:   tag.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func templateResponse(template models.DesignTemplate, payload StudioDocumentPayload) StudioTemplateResponse {
	return StudioTemplateResponse{
		ID:             template.ID,
		WorkspaceID:    template.WorkspaceID,
		Name:           template.Name,
		Category:       template.Category,
		PresetKey:      template.PresetKey,
		PreviewMediaID: template.PreviewMediaID,
		Document:       payload,
		CreatedAt:      template.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:      template.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func uniqueStudioStrings(values []string) []string {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			set[trimmed] = struct{}{}
		}
	}
	result := make([]string, 0, len(set))
	for value := range set {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func builtinStudioTemplates() []StudioTemplateResponse {
	specs := []struct {
		id, name, category, preset, headline, subline, background, accent string
		pageCount                                                         int
	}{
		{"builtin-quick-announcement", "Quick announcement", "Announcement", "instagram-square", "A clear update", "Say what changed and why it matters.", "#161616", "#f97316", 1},
		{"builtin-quote-card", "Quote card", "Quote", "instagram-square", "Put the useful line first.", "Name or source", "#ece7df", "#c45120", 1},
		{"builtin-how-to-carousel", "How-to carousel", "Carousel", "instagram-portrait", "How to get it done", "A focused five-page walkthrough.", "#fff8f1", "#ea580c", 5},
		{"builtin-linkedin-insight", "LinkedIn insight", "Professional", "linkedin-square", "One practical insight", "Explain the idea in one short paragraph.", "#f6f5f2", "#c2410c", 1},
		{"builtin-youtube-focus", "YouTube headline", "Thumbnail", "youtube-thumbnail", "THE MAIN IDEA", "Use one strong subject and a short promise.", "#18181b", "#f97316", 1},
	}
	result := make([]StudioTemplateResponse, 0, len(specs))
	for _, spec := range specs {
		width, height, _, _ := resolveStudioDimensions(spec.preset, 0, 0)
		pages := make([]StudioPagePayload, 0, spec.pageCount)
		for pageIndex := 0; pageIndex < spec.pageCount; pageIndex++ {
			pageSeed := fmt.Sprintf("%s/page/%d", spec.id, pageIndex+1)
			headline := spec.headline
			subline := spec.subline
			if pageIndex > 0 {
				carouselHeadlines := []string{"Why this matters", "Start here", "Do this next", "Keep this in mind"}
				carouselSublines := []string{
					"Give the context in one useful sentence.",
					"Show the first concrete action.",
					"Add the next action without repeating yourself.",
					"End with the key takeaway or next step.",
				}
				headline = carouselHeadlines[pageIndex-1]
				subline = carouselSublines[pageIndex-1]
			}
			pages = append(pages, StudioPagePayload{
				ID:              uuid.NewSHA1(uuid.NameSpaceURL, []byte(pageSeed)).String(),
				Name:            fmt.Sprintf("Page %d", pageIndex+1),
				BackgroundColor: spec.background,
				Layers: []StudioLayer{
					builtinStudioAccent(pageSeed, width, height, spec.accent),
					builtinStudioText(pageSeed+"/headline", headline, float64(width)*0.09, float64(height)*0.36, float64(width)*0.82, float64(height)*0.28, float64(width)*0.075, studioTemplateForeground(spec.background)),
					builtinStudioText(pageSeed+"/subline", subline, float64(width)*0.09, float64(height)*0.68, float64(width)*0.72, float64(height)*0.12, float64(width)*0.026, studioTemplateMutedForeground(spec.background)),
				},
			})
		}
		payload := StudioDocumentPayload{
			SchemaVersion:  studioSchemaVersion,
			Title:          spec.name,
			PresetKey:      spec.preset,
			WidthPX:        width,
			HeightPX:       height,
			ExportDefaults: StudioExportDefaults{Format: defaultStudioFormat(spec.preset), Quality: 0.92},
			Pages:          pages,
		}
		result = append(result, StudioTemplateResponse{
			ID:        spec.id,
			Name:      spec.name,
			Category:  spec.category,
			PresetKey: spec.preset,
			BuiltIn:   true,
			Document:  payload,
		})
	}
	return result
}

func builtinStudioAccent(seed string, width, height int, color string) StudioLayer {
	return StudioLayer{
		ID:      uuid.NewSHA1(uuid.NameSpaceURL, []byte(seed+"/accent")).String(),
		Type:    "shape",
		Name:    "Accent",
		Visible: true,
		Opacity: 1,
		Transform: StudioTransform{
			X: float64(width) * 0.09, Y: float64(height) * 0.18,
			Width: float64(width) * 0.18, Height: mathMax(12, float64(height)*0.012),
		},
		Shape: &StudioShapeValue{Kind: "rounded_rectangle", Fill: color, Stroke: color, Radius: 999},
	}
}

func builtinStudioText(seed, text string, x, y, width, height, fontSize float64, color string) StudioLayer {
	return StudioLayer{
		ID:        uuid.NewSHA1(uuid.NameSpaceURL, []byte(seed)).String(),
		Type:      "text",
		Name:      text,
		Visible:   true,
		Opacity:   1,
		Transform: StudioTransform{X: x, Y: y, Width: width, Height: height},
		Text: &StudioTextValue{
			Text: text, FontFamily: "Geist Variable", FontWeight: 700, FontStyle: "normal",
			FontSize: fontSize, Color: color, Align: "left", LineHeight: 1.05,
			Shadow: StudioTextShadow{Color: "#00000000"},
		},
	}
}

func studioTemplateForeground(background string) string {
	if strings.HasPrefix(strings.ToLower(background), "#1") || strings.HasPrefix(strings.ToLower(background), "#2") {
		return "#fafaf9"
	}
	return "#1c1917"
}

func studioTemplateMutedForeground(background string) string {
	if strings.HasPrefix(strings.ToLower(background), "#1") || strings.HasPrefix(strings.ToLower(background), "#2") {
		return "#d6d3d1"
	}
	return "#57534e"
}

func mathMax(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
