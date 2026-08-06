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

type ImageEditorTemplateResponse struct {
	ID             string                     `json:"id"`
	WorkspaceID    string                     `json:"workspace_id,omitempty"`
	Name           string                     `json:"name"`
	Category       string                     `json:"category"`
	PresetKey      string                     `json:"preset_key"`
	BuiltIn        bool                       `json:"built_in"`
	PreviewMediaID string                     `json:"preview_media_id,omitempty"`
	Document       ImageEditorDocumentPayload `json:"document"`
	CreatedAt      string                     `json:"created_at,omitempty"`
	UpdatedAt      string                     `json:"updated_at,omitempty"`
}

type ListImageEditorTemplatesInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
}

type ListImageEditorTemplatesOutput struct {
	Body struct {
		Templates []ImageEditorTemplateResponse `json:"templates"`
		CanEdit   bool                          `json:"can_edit"`
	}
}

type ListPublicImageEditorTemplatesOutput struct {
	Body struct {
		Templates []ImageEditorTemplateResponse `json:"templates"`
	}
}

type CreateImageEditorTemplateInput struct {
	Body struct {
		WorkspaceID    string                     `json:"workspace_id"`
		Name           string                     `json:"name" minLength:"1" maxLength:"120"`
		Category       string                     `json:"category" maxLength:"80"`
		PreviewMediaID string                     `json:"preview_media_id,omitempty"`
		Document       ImageEditorDocumentPayload `json:"document"`
	}
}

type CreateImageEditorTemplateOutput struct {
	Body ImageEditorTemplateResponse
}

type UpdateImageEditorTemplateInput struct {
	PathID string `path:"id"`
	Body   struct {
		Name           string                     `json:"name" minLength:"1" maxLength:"120"`
		Category       string                     `json:"category" maxLength:"80"`
		PreviewMediaID string                     `json:"preview_media_id,omitempty"`
		Document       ImageEditorDocumentPayload `json:"document"`
	}
}

type UpdateImageEditorTemplateOutput struct {
	Body ImageEditorTemplateResponse
}

type DeleteImageEditorTemplateInput struct {
	PathID string `path:"id"`
}

type DeleteImageEditorTemplateOutput struct {
	Body struct {
		Deleted bool `json:"deleted"`
	}
}

type InstantiateImageEditorTemplateInput struct {
	PathID string `path:"id"`
	Body   struct {
		WorkspaceID string `json:"workspace_id"`
		Title       string `json:"title" maxLength:"160"`
	}
}

type InstantiateImageEditorTemplateOutput struct {
	Body ImageEditorDocumentResponse
}

type ImageEditorBrandColor struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Value string `json:"value"`
}

type ImageEditorBrandTextStyle struct {
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

type ImageEditorBrandAsset struct {
	ID      string `json:"id,omitempty"`
	MediaID string `json:"media_id"`
	Role    string `json:"role" enum:"primary_logo,secondary_logo,mark,watermark"`
	Name    string `json:"name"`
}

type ImageEditorBrandFont struct {
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

type ImageEditorBrandKitResponse struct {
	ID          string                      `json:"id,omitempty"`
	WorkspaceID string                      `json:"workspace_id"`
	Name        string                      `json:"name"`
	Revision    int                         `json:"revision"`
	Exists      bool                        `json:"exists"`
	CanEdit     bool                        `json:"can_edit"`
	Colors      []ImageEditorBrandColor     `json:"colors"`
	TextStyles  []ImageEditorBrandTextStyle `json:"text_styles"`
	Backgrounds []string                    `json:"backgrounds"`
	Assets      []ImageEditorBrandAsset     `json:"assets"`
	Fonts       []ImageEditorBrandFont      `json:"fonts"`
	UpdatedAt   string                      `json:"updated_at,omitempty"`
}

type GetImageEditorBrandKitInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
}

type GetImageEditorBrandKitOutput struct {
	Body ImageEditorBrandKitResponse
}

type UpdateImageEditorBrandKitInput struct {
	Body struct {
		WorkspaceID string                      `json:"workspace_id"`
		Name        string                      `json:"name" maxLength:"120"`
		Colors      []ImageEditorBrandColor     `json:"colors"`
		TextStyles  []ImageEditorBrandTextStyle `json:"text_styles"`
		Backgrounds []string                    `json:"backgrounds"`
		Assets      []ImageEditorBrandAsset     `json:"assets"`
		Fonts       []ImageEditorBrandFont      `json:"fonts"`
	}
}

type UpdateImageEditorBrandKitOutput struct {
	Body ImageEditorBrandKitResponse
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

func (h *ImageEditorHandler) registerTemplates(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-public-image-editor-templates",
		Method:      http.MethodGet,
		Path:        "/image-editor/public-templates",
		Summary:     "List built-in OpenPost Image Editor templates available without a workspace",
		Tags:        []string{tagImageEditor},
	}, h.listPublicTemplates)

	huma.Register(api, huma.Operation{
		OperationID: "list-image-editor-templates",
		Method:      http.MethodGet,
		Path:        "/image-editor/templates",
		Summary:     "List built-in and workspace OpenPost Image Editor templates",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, h.listTemplates)

	huma.Register(api, huma.Operation{
		OperationID:   "create-image-editor-template",
		Method:        http.MethodPost,
		Path:          "/image-editor/templates",
		Summary:       "Save an OpenPost Image Editor design as a workspace template",
		Tags:          []string{tagImageEditor},
		DefaultStatus: http.StatusCreated,
		Middlewares:   huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:        []int{400, 403},
	}, h.createTemplate)

	huma.Register(api, huma.Operation{
		OperationID: "update-image-editor-template",
		Method:      http.MethodPatch,
		Path:        "/image-editor/templates/{id}",
		Summary:     "Replace a workspace OpenPost Image Editor template snapshot",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, h.updateTemplate)

	huma.Register(api, huma.Operation{
		OperationID: "delete-image-editor-template",
		Method:      http.MethodDelete,
		Path:        "/image-editor/templates/{id}",
		Summary:     "Delete a workspace OpenPost Image Editor template",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, h.deleteTemplate)

	huma.Register(api, huma.Operation{
		OperationID: "instantiate-image-editor-template",
		Method:      http.MethodPost,
		Path:        "/image-editor/templates/{id}/instantiate",
		Summary:     "Create an OpenPost Image Editor design from a template",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, h.instantiateTemplate)
}

func (h *ImageEditorHandler) registerBrandKit(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-image-editor-brand-kit",
		Method:      http.MethodGet,
		Path:        "/image-editor/brand-kit",
		Summary:     "Get the workspace OpenPost Image Editor brand kit",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, h.getBrandKit)

	huma.Register(api, huma.Operation{
		OperationID: "update-image-editor-brand-kit",
		Method:      http.MethodPut,
		Path:        "/image-editor/brand-kit",
		Summary:     "Create or update the workspace OpenPost Image Editor brand kit",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, h.updateBrandKit)
}

func (h *ImageEditorHandler) registerMediaOrganization(api huma.API) {
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
func (h *ImageEditorHandler) listPublicTemplates(_ context.Context, _ *struct{}) (*ListPublicImageEditorTemplatesOutput, error) {
	out := &ListPublicImageEditorTemplatesOutput{}
	out.Body.Templates = builtinImageEditorTemplates()
	return out, nil
}

func (h *ImageEditorHandler) listTemplates(ctx context.Context, input *ListImageEditorTemplatesInput) (*ListImageEditorTemplatesOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	canEdit, err := h.requireAccess(ctx, input.WorkspaceID, false)
	if err != nil {
		return nil, err
	}
	out := &ListImageEditorTemplatesOutput{}
	out.Body.CanEdit = canEdit
	out.Body.Templates = builtinImageEditorTemplates()
	var templates []models.DesignTemplate
	if err := h.db.NewSelect().Model(&templates).
		Where("workspace_id = ?", input.WorkspaceID).
		OrderExpr("updated_at DESC").
		Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to list OpenPost Image Editor templates")
	}
	for _, template := range templates {
		var payload ImageEditorDocumentPayload
		if err := json.Unmarshal([]byte(template.SnapshotJSON), &payload); err != nil {
			continue
		}
		out.Body.Templates = append(out.Body.Templates, templateResponse(template, payload))
	}
	return out, nil
}

func (h *ImageEditorHandler) createTemplate(ctx context.Context, input *CreateImageEditorTemplateInput) (*CreateImageEditorTemplateOutput, error) {
	if err := validateImageEditorPayload(input.Body.Document); err != nil {
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
		return nil, huma.Error400BadRequest("invalid OpenPost Image Editor template")
	}
	now := time.Now().UTC()
	template := &models.DesignTemplate{
		ID:             uuid.NewString(),
		WorkspaceID:    input.Body.WorkspaceID,
		CreatedByID:    middleware.GetUserID(ctx),
		Name:           strings.TrimSpace(input.Body.Name),
		Category:       strings.TrimSpace(input.Body.Category),
		PresetKey:      input.Body.Document.PresetKey,
		SchemaVersion:  imageEditorSchemaVersion,
		SnapshotJSON:   string(snapshot),
		PreviewMediaID: strings.TrimSpace(input.Body.PreviewMediaID),
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if template.Name == "" {
		return nil, huma.Error400BadRequest("template name is required")
	}
	ids := imageEditorMediaIDs(input.Body.Document.Pages)
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
		return nil, huma.Error500InternalServerError("failed to create OpenPost Image Editor template")
	}
	return &CreateImageEditorTemplateOutput{Body: templateResponse(*template, input.Body.Document)}, nil
}

func (h *ImageEditorHandler) updateTemplate(ctx context.Context, input *UpdateImageEditorTemplateInput) (*UpdateImageEditorTemplateOutput, error) {
	if strings.HasPrefix(input.PathID, "builtin-") {
		return nil, huma.Error403Forbidden("built-in templates cannot be replaced")
	}
	var template models.DesignTemplate
	err := h.db.NewSelect().Model(&template).Where("id = ?", input.PathID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("OpenPost Image Editor template not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load OpenPost Image Editor template")
	}
	if _, err := h.requireAccess(ctx, template.WorkspaceID, true); err != nil {
		return nil, err
	}
	if err := validateImageEditorPayload(input.Body.Document); err != nil {
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
		return nil, huma.Error400BadRequest("invalid OpenPost Image Editor template")
	}
	name := strings.TrimSpace(input.Body.Name)
	if name == "" {
		return nil, huma.Error400BadRequest("template name is required")
	}
	now := time.Now().UTC()
	ids := imageEditorMediaIDs(input.Body.Document.Pages)
	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewUpdate().Model(&template).
			Set("name = ?", name).
			Set("category = ?", strings.TrimSpace(input.Body.Category)).
			Set("preset_key = ?", input.Body.Document.PresetKey).
			Set("schema_version = ?", imageEditorSchemaVersion).
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
		return nil, huma.Error500InternalServerError("failed to replace OpenPost Image Editor template")
	}
	template.Name = name
	template.Category = strings.TrimSpace(input.Body.Category)
	template.PresetKey = input.Body.Document.PresetKey
	template.SchemaVersion = imageEditorSchemaVersion
	template.SnapshotJSON = string(snapshot)
	template.PreviewMediaID = strings.TrimSpace(input.Body.PreviewMediaID)
	template.UpdatedAt = now
	return &UpdateImageEditorTemplateOutput{Body: templateResponse(template, input.Body.Document)}, nil
}

func (h *ImageEditorHandler) validateOptionalWorkspaceMedia(ctx context.Context, workspaceID, mediaID string) error {
	mediaID = strings.TrimSpace(mediaID)
	if mediaID == "" {
		return nil
	}
	count, err := h.db.NewSelect().Model((*models.MediaAttachment)(nil)).
		Where("id = ? AND workspace_id = ?", mediaID, workspaceID).
		Count(ctx)
	if err != nil {
		return huma.Error500InternalServerError("failed to validate OpenPost Image Editor template preview")
	}
	if count != 1 {
		return huma.Error400BadRequest("OpenPost Image Editor template preview must belong to the workspace")
	}
	return nil
}

func (h *ImageEditorHandler) deleteTemplate(ctx context.Context, input *DeleteImageEditorTemplateInput) (*DeleteImageEditorTemplateOutput, error) {
	if strings.HasPrefix(input.PathID, "builtin-") {
		return nil, huma.Error403Forbidden("built-in templates cannot be deleted")
	}
	var template models.DesignTemplate
	err := h.db.NewSelect().Model(&template).Where("id = ?", input.PathID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("OpenPost Image Editor template not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load OpenPost Image Editor template")
	}
	if _, err := h.requireAccess(ctx, template.WorkspaceID, true); err != nil {
		return nil, err
	}
	if _, err := h.db.NewDelete().Model(&template).WherePK().Exec(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to delete OpenPost Image Editor template")
	}
	return &DeleteImageEditorTemplateOutput{Body: struct {
		Deleted bool `json:"deleted"`
	}{Deleted: true}}, nil
}

func (h *ImageEditorHandler) instantiateTemplate(ctx context.Context, input *InstantiateImageEditorTemplateInput) (*InstantiateImageEditorTemplateOutput, error) {
	if _, err := h.requireAccess(ctx, input.Body.WorkspaceID, true); err != nil {
		return nil, err
	}
	var payload ImageEditorDocumentPayload
	var found bool
	for _, template := range builtinImageEditorTemplates() {
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
			return nil, huma.Error404NotFound("OpenPost Image Editor template not found")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load OpenPost Image Editor template")
		}
		if err := json.Unmarshal([]byte(template.SnapshotJSON), &payload); err != nil {
			return nil, huma.Error400BadRequest("OpenPost Image Editor template is corrupt")
		}
	}
	payload = cloneImageEditorPayload(payload)
	if title := strings.TrimSpace(input.Body.Title); title != "" {
		payload.Title = title
	}
	response, err := h.createDocumentFromPayload(ctx, input.Body.WorkspaceID, payload)
	if err != nil {
		return nil, err
	}
	return &InstantiateImageEditorTemplateOutput{Body: *response}, nil
}

func (h *ImageEditorHandler) createDocumentFromPayload(ctx context.Context, workspaceID string, payload ImageEditorDocumentPayload) (*ImageEditorDocumentResponse, error) {
	if err := validateImageEditorPayload(payload); err != nil {
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
		if err := insertImageEditorPages(txCtx, tx, document.ID, payload.Pages, now); err != nil {
			return err
		}
		return replaceImageEditorMediaReferences(txCtx, tx, document, payload.Pages)
	}); err != nil {
		return nil, huma.Error500InternalServerError("failed to create OpenPost Image Editor design")
	}
	return h.documentResponse(ctx, document.ID)
}

func (h *ImageEditorHandler) getBrandKit(ctx context.Context, input *GetImageEditorBrandKitInput) (*GetImageEditorBrandKitOutput, error) {
	canEdit, err := h.requireAccess(ctx, input.WorkspaceID, false)
	if err != nil {
		return nil, err
	}
	response, err := h.loadBrandKit(ctx, input.WorkspaceID, canEdit)
	if err != nil {
		return nil, err
	}
	return &GetImageEditorBrandKitOutput{Body: response}, nil
}

//nolint:gocyclo // Brand-kit validation and reference replacement are committed as one operation.
func (h *ImageEditorHandler) updateBrandKit(ctx context.Context, input *UpdateImageEditorBrandKitInput) (*UpdateImageEditorBrandKitOutput, error) {
	if _, err := h.requireAccess(ctx, input.Body.WorkspaceID, true); err != nil {
		return nil, err
	}
	if err := validateImageEditorBrandKit(input.Body.Colors, input.Body.TextStyles, input.Body.Backgrounds); err != nil {
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
		if !isImageEditorBrandFontMedia(media) {
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
		return nil, huma.Error500InternalServerError("failed to load OpenPost Image Editor brand kit")
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
			if _, err := tx.NewUpdate().Model((*models.MediaAttachment)(nil)).
				Set("retention_class = ?", "library").
				Set("asset_kind = ?", "library").
				Where("id = ? AND workspace_id = ?", item.MediaID, input.Body.WorkspaceID).
				Exec(txCtx); err != nil {
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
		return nil, huma.Error500InternalServerError("failed to update OpenPost Image Editor brand kit")
	}
	response, err := h.loadBrandKit(ctx, input.Body.WorkspaceID, true)
	if err != nil {
		return nil, err
	}
	return &UpdateImageEditorBrandKitOutput{Body: response}, nil
}

func (h *ImageEditorHandler) loadBrandKit(ctx context.Context, workspaceID string, canEdit bool) (ImageEditorBrandKitResponse, error) {
	response := ImageEditorBrandKitResponse{
		WorkspaceID: workspaceID,
		Name:        "Workspace brand",
		CanEdit:     canEdit,
		Colors:      []ImageEditorBrandColor{},
		TextStyles:  []ImageEditorBrandTextStyle{},
		Backgrounds: []string{},
		Assets:      []ImageEditorBrandAsset{},
		Fonts:       []ImageEditorBrandFont{},
	}
	var kit models.BrandKit
	err := h.db.NewSelect().Model(&kit).Where("workspace_id = ?", workspaceID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return response, nil
	}
	if err != nil {
		return response, huma.Error500InternalServerError("failed to load OpenPost Image Editor brand kit")
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
		return response, huma.Error500InternalServerError("failed to load OpenPost Image Editor brand assets")
	}
	for _, asset := range assets {
		response.Assets = append(response.Assets, ImageEditorBrandAsset{
			ID: asset.ID, MediaID: asset.MediaID, Role: asset.Role, Name: asset.Name,
		})
	}
	var fonts []models.BrandFont
	if err := h.db.NewSelect().Model(&fonts).Where("brand_kit_id = ?", kit.ID).OrderExpr("family ASC, weight ASC").Scan(ctx); err != nil {
		return response, huma.Error500InternalServerError("failed to load OpenPost Image Editor brand fonts")
	}
	for _, font := range fonts {
		response.Fonts = append(response.Fonts, ImageEditorBrandFont{
			ID:                    font.ID,
			MediaID:               font.MediaID,
			Family:                font.Family,
			CSSFamily:             imageEditorBrandFontCSSFamily(font.MediaID),
			Weight:                font.Weight,
			Style:                 font.Style,
			LicenseAcknowledged:   true,
			LicenseAcknowledgedBy: font.LicenseAcknowledgedBy,
			LicenseAcknowledgedAt: font.LicenseAcknowledgedAt.UTC().Format(time.RFC3339),
		})
	}
	return response, nil
}

func (h *ImageEditorHandler) listTags(ctx context.Context, input *ListMediaTagsInput) (*ListMediaTagsOutput, error) {
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

func (h *ImageEditorHandler) createTag(ctx context.Context, input *CreateMediaTagInput) (*CreateMediaTagOutput, error) {
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

func (h *ImageEditorHandler) deleteTag(ctx context.Context, input *DeleteMediaTagInput) (*DeleteMediaTagOutput, error) {
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

func (h *ImageEditorHandler) updateTag(ctx context.Context, input *UpdateMediaTagInput) (*UpdateMediaTagOutput, error) {
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

func (h *ImageEditorHandler) replaceTagItems(ctx context.Context, input *ReplaceMediaTagItemsInput) (*ReplaceMediaTagItemsOutput, error) {
	tag, err := h.loadTag(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, tag.WorkspaceID, true); err != nil {
		return nil, err
	}
	ids := uniqueImageEditorStrings(input.Body.MediaIDs)
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
	if err := h.promoteTaggedMedia(ctx, tag.WorkspaceID, mode, ids); err != nil {
		return nil, err
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

func (h *ImageEditorHandler) promoteTaggedMedia(ctx context.Context, workspaceID, mode string, mediaIDs []string) error {
	if mode == "remove" || len(mediaIDs) == 0 {
		return nil
	}
	if _, err := h.db.NewUpdate().Model((*models.MediaAttachment)(nil)).
		Set("retention_class = ?", "library").
		Where("workspace_id = ? AND id IN (?)", workspaceID, bun.List(mediaIDs)).
		Exec(ctx); err != nil {
		return huma.Error500InternalServerError("failed to keep tagged media in the library")
	}
	return nil
}

func (h *ImageEditorHandler) loadTag(ctx context.Context, id string) (*models.MediaTag, error) {
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

func (h *ImageEditorHandler) workspaceMediaByID(ctx context.Context, workspaceID string, ids []string) (map[string]models.MediaAttachment, error) {
	ids = uniqueImageEditorStrings(ids)
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

func validateImageEditorBrandKit(colors []ImageEditorBrandColor, textStyles []ImageEditorBrandTextStyle, backgrounds []string) error {
	if len(colors) > 32 || len(textStyles) > 24 || len(backgrounds) > 16 {
		return fmt.Errorf("brand kit exceeds the supported item limits")
	}
	for _, color := range colors {
		if strings.TrimSpace(color.Name) == "" || !imageEditorHexColor.MatchString(color.Value) {
			return fmt.Errorf("brand colors require a name and hexadecimal value")
		}
	}
	for _, style := range textStyles {
		if strings.TrimSpace(style.Name) == "" || strings.TrimSpace(style.FontFamily) == "" || style.FontSize <= 0 {
			return fmt.Errorf("brand text styles require a name, font family, and positive size")
		}
	}
	for _, background := range backgrounds {
		if !imageEditorHexColor.MatchString(background) {
			return fmt.Errorf("brand backgrounds must be hexadecimal colors")
		}
	}
	return nil
}

var imageEditorHexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$`)

func imageEditorBrandFontCSSFamily(id string) string {
	return "OpenPostBrand_" + strings.ReplaceAll(id, "-", "")
}

func isImageEditorBrandFontMedia(media models.MediaAttachment) bool {
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

func tagResponse(tag models.MediaTag, itemCount int) MediaTagResponse {
	return MediaTagResponse{
		ID:          tag.ID,
		WorkspaceID: tag.WorkspaceID,
		Name:        tag.Name,
		ItemCount:   itemCount,
		CreatedAt:   tag.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func templateResponse(template models.DesignTemplate, payload ImageEditorDocumentPayload) ImageEditorTemplateResponse {
	return ImageEditorTemplateResponse{
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

func uniqueImageEditorStrings(values []string) []string {
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

func builtinImageEditorTemplates() []ImageEditorTemplateResponse {
	specs := []struct {
		id, name, category, preset, headline, subline, background, accent, layout string
		pageCount                                                                 int
	}{
		{"builtin-quick-announcement", "Quick announcement", "Announcement", "instagram-square", "A clear update", "Say what changed and why it matters.", "#161616", "#f97316", "signal", 1},
		{"builtin-bold-announcement", "Bold announcement", "Announcement", "instagram-square", "BIG NEWS", "One short line with the useful detail.", "#f97316", "#171717", "bold", 1},
		{"builtin-photo-caption", "Photo caption", "Photo", "instagram-portrait", "A moment worth sharing", "Add a short caption or location.", "#f5f5f4", "#292524", "photo", 1},
		{"builtin-quote-card", "Quote card", "Quote", "instagram-square", "Put the useful line first.", "Name or source", "#ece7df", "#c45120", "quote", 1},
		{"builtin-quiet-quote", "Quiet quote", "Quote", "instagram-portrait", "A thoughtful line can carry the whole post.", "Name or source", "#f7f3ed", "#9a3412", "quiet-quote", 1},
		{"builtin-how-to-carousel", "How-to carousel", "Carousel", "instagram-portrait", "How to get it done", "A focused five-page walkthrough.", "#fff8f1", "#ea580c", "steps", 5},
		{"builtin-carousel-opener", "Carousel opener", "Carousel", "instagram-portrait", "The idea in one sentence", "Swipe for the useful details.", "#1c1917", "#f97316", "split", 5},
		{"builtin-carousel-step", "Numbered steps", "Education", "instagram-portrait", "A practical process", "Four clear steps from start to finish.", "#f5f5f4", "#c2410c", "numbered", 4},
		{"builtin-story-prompt", "Story prompt", "Story", "story-reel-slide", "What are you working on?", "Invite a short answer from your audience.", "#431407", "#fb923c", "prompt", 1},
		{"builtin-story-photo", "Story photo", "Photo", "story-reel-slide", "Behind the scenes", "Add context in one line.", "#292524", "#f97316", "story-photo", 1},
		{"builtin-linkedin-insight", "LinkedIn insight", "Professional", "linkedin-square", "One practical insight", "Explain the idea in one short paragraph.", "#f6f5f2", "#c2410c", "editorial", 1},
		{"builtin-linkedin-launch", "LinkedIn launch", "Professional", "linkedin-landscape", "We just launched", "What changed, who it helps, and where to learn more.", "#172554", "#fb923c", "launch", 1},
		{"builtin-x-update", "X product update", "Announcement", "x-landscape", "Product update", "One clear change. One clear outcome.", "#fafaf9", "#f97316", "update", 1},
		{"builtin-youtube-focus", "YouTube headline", "Thumbnail", "youtube-thumbnail", "THE MAIN IDEA", "Use one strong subject and a short promise.", "#18181b", "#f97316", "thumbnail", 1},
		{"builtin-youtube-list", "YouTube list", "Thumbnail", "youtube-thumbnail", "3 THINGS TO FIX", "Make the list concrete and easy to scan.", "#0f172a", "#fb923c", "thumbnail-list", 1},
	}
	result := make([]ImageEditorTemplateResponse, 0, len(specs))
	for _, spec := range specs {
		width, height, _, _ := resolveImageEditorDimensions(spec.preset, 0, 0)
		pages := make([]ImageEditorPagePayload, 0, spec.pageCount)
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
			pages = append(pages, builtinImageEditorTemplatePage(pageSeed, spec.layout, headline, subline, spec.background, spec.accent, width, height, pageIndex, spec.pageCount))
		}
		payload := ImageEditorDocumentPayload{
			SchemaVersion:  imageEditorSchemaVersion,
			Title:          spec.name,
			PresetKey:      spec.preset,
			WidthPX:        width,
			HeightPX:       height,
			ExportDefaults: ImageEditorExportDefaults{Format: defaultImageEditorFormat(spec.preset), Quality: 0.92},
			Pages:          pages,
		}
		result = append(result, ImageEditorTemplateResponse{
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

func builtinImageEditorTemplatePage(seed, layout, headline, subline, background, accent string, width, height, pageIndex, pageCount int) ImageEditorPagePayload {
	w := float64(width)
	h := float64(height)
	foreground := imageEditorTemplateForeground(background)
	muted := imageEditorTemplateMutedForeground(background)
	layers := []ImageEditorLayer{}

	switch layout {
	case "bold":
		layers = append(layers,
			builtinImageEditorShape(seed+"/block", "Headline block", "rounded_rectangle", w*0.06, h*0.07, w*0.88, h*0.58, accent, w*0.035),
			builtinImageEditorTextStyled(seed+"/headline", headline, w*0.1, h*0.15, w*0.8, h*0.38, w*0.13, foreground, 900, "center"),
			builtinImageEditorTextStyled(seed+"/subline", subline, w*0.12, h*0.73, w*0.76, h*0.12, w*0.03, foreground, 600, "center"),
		)
	case "photo":
		layers = append(layers,
			builtinImageEditorShape(seed+"/photo", "Replace with your photo", "rectangle", 0, 0, w, h*0.72, "#d6d3d1", 0),
			builtinImageEditorTextStyled(seed+"/photo-label", "REPLACE WITH YOUR PHOTO", w*0.12, h*0.32, w*0.76, h*0.08, w*0.026, "#57534e", 700, "center"),
			builtinImageEditorTextStyled(seed+"/headline", headline, w*0.08, h*0.77, w*0.84, h*0.1, w*0.052, foreground, 750, "left"),
			builtinImageEditorTextStyled(seed+"/subline", subline, w*0.08, h*0.89, w*0.78, h*0.06, w*0.024, muted, 500, "left"),
		)
	case "quote":
		layers = append(layers,
			builtinImageEditorTextStyled(seed+"/mark", "“", w*0.08, h*0.08, w*0.24, h*0.2, w*0.2, accent, 800, "left"),
			builtinImageEditorTextStyled(seed+"/headline", headline, w*0.12, h*0.28, w*0.76, h*0.34, w*0.068, foreground, 650, "center"),
			builtinImageEditorShape(seed+"/rule", "Quote rule", "rounded_rectangle", w*0.4, h*0.7, w*0.2, mathMax(8, h*0.008), accent, 999),
			builtinImageEditorTextStyled(seed+"/subline", subline, w*0.2, h*0.76, w*0.6, h*0.08, w*0.025, muted, 600, "center"),
		)
	case "quiet-quote":
		layers = append(layers,
			builtinImageEditorShape(seed+"/rule", "Quote rule", "rounded_rectangle", w*0.1, h*0.2, mathMax(10, w*0.012), h*0.54, accent, 999),
			builtinImageEditorTextStyled(seed+"/headline", headline, w*0.17, h*0.22, w*0.7, h*0.36, w*0.06, foreground, 550, "left"),
			builtinImageEditorTextStyled(seed+"/subline", subline, w*0.17, h*0.68, w*0.55, h*0.08, w*0.025, muted, 650, "left"),
		)
	case "steps", "numbered":
		number := pageIndex + 1
		layers = append(layers,
			builtinImageEditorShape(seed+"/number", fmt.Sprintf("Step %d", number), "ellipse", w*0.08, h*0.1, w*0.2, w*0.2, accent, 999),
			builtinImageEditorTextStyled(seed+"/number-text", fmt.Sprintf("%02d", number), w*0.08, h*0.14, w*0.2, w*0.1, w*0.065, imageEditorTemplateForeground(accent), 800, "center"),
			builtinImageEditorTextStyled(seed+"/headline", headline, w*0.09, h*0.38, w*0.82, h*0.25, w*0.075, foreground, 750, "left"),
			builtinImageEditorTextStyled(seed+"/subline", subline, w*0.09, h*0.68, w*0.76, h*0.13, w*0.029, muted, 450, "left"),
			builtinImageEditorTextStyled(seed+"/page", fmt.Sprintf("%d / %d", number, pageCount), w*0.7, h*0.9, w*0.2, h*0.04, w*0.018, muted, 600, "right"),
		)
	case "split":
		layers = append(layers,
			builtinImageEditorShape(seed+"/split", "Color field", "rectangle", w*0.58, 0, w*0.42, h, accent, 0),
			builtinImageEditorTextStyled(seed+"/headline", headline, w*0.08, h*0.22, w*0.68, h*0.32, w*0.077, foreground, 780, "left"),
			builtinImageEditorTextStyled(seed+"/subline", subline, w*0.08, h*0.63, w*0.45, h*0.1, w*0.027, muted, 500, "left"),
			builtinImageEditorTextStyled(seed+"/page", fmt.Sprintf("%02d", pageIndex+1), w*0.68, h*0.76, w*0.22, h*0.1, w*0.08, imageEditorTemplateForeground(accent), 800, "center"),
		)
	case "prompt":
		layers = append(layers,
			builtinImageEditorTextStyled(seed+"/label", "YOUR TURN", w*0.1, h*0.12, w*0.8, h*0.05, w*0.022, accent, 800, "center"),
			builtinImageEditorTextStyled(seed+"/headline", headline, w*0.1, h*0.3, w*0.8, h*0.3, w*0.074, foreground, 700, "center"),
			builtinImageEditorShape(seed+"/answer", "Answer field", "rounded_rectangle", w*0.12, h*0.72, w*0.76, h*0.12, "#fff7ed", w*0.06),
			builtinImageEditorTextStyled(seed+"/subline", subline, w*0.18, h*0.755, w*0.64, h*0.05, w*0.021, "#7c2d12", 550, "center"),
		)
	case "story-photo":
		layers = append(layers,
			builtinImageEditorShape(seed+"/photo", "Replace with your photo", "rectangle", 0, 0, w, h, "#57534e", 0),
			builtinImageEditorTextStyled(seed+"/photo-label", "REPLACE WITH YOUR PHOTO", w*0.12, h*0.36, w*0.76, h*0.08, w*0.025, "#d6d3d1", 700, "center"),
			builtinImageEditorShape(seed+"/caption", "Caption field", "rounded_rectangle", w*0.07, h*0.7, w*0.86, h*0.2, "#1c1917", w*0.035),
			builtinImageEditorTextStyled(seed+"/headline", headline, w*0.12, h*0.74, w*0.76, h*0.08, w*0.05, "#fafaf9", 750, "left"),
			builtinImageEditorTextStyled(seed+"/subline", subline, w*0.12, h*0.84, w*0.7, h*0.04, w*0.021, "#d6d3d1", 500, "left"),
		)
	case "editorial":
		layers = append(layers,
			builtinImageEditorTextStyled(seed+"/label", "INSIGHT", w*0.09, h*0.12, w*0.4, h*0.05, w*0.022, accent, 800, "left"),
			builtinImageEditorTextStyled(seed+"/headline", headline, w*0.09, h*0.26, w*0.75, h*0.22, w*0.07, foreground, 700, "left"),
			builtinImageEditorShape(seed+"/rule", "Editorial rule", "rectangle", w*0.09, h*0.56, w*0.82, mathMax(4, h*0.004), "#d6d3d1", 0),
			builtinImageEditorTextStyled(seed+"/subline", subline, w*0.09, h*0.64, w*0.76, h*0.16, w*0.029, muted, 450, "left"),
		)
	case "launch":
		layers = append(layers,
			builtinImageEditorShape(seed+"/badge", "Launch badge", "rounded_rectangle", w*0.07, h*0.12, w*0.2, h*0.1, accent, h*0.05),
			builtinImageEditorTextStyled(seed+"/badge-text", "NEW", w*0.07, h*0.145, w*0.2, h*0.05, w*0.024, imageEditorTemplateForeground(accent), 850, "center"),
			builtinImageEditorTextStyled(seed+"/headline", headline, w*0.07, h*0.34, w*0.55, h*0.28, w*0.085, foreground, 800, "left"),
			builtinImageEditorTextStyled(seed+"/subline", subline, w*0.66, h*0.34, w*0.27, h*0.24, w*0.027, muted, 500, "left"),
		)
	case "update":
		layers = append(layers,
			builtinImageEditorShape(seed+"/mark", "Update mark", "ellipse", w*0.07, h*0.12, w*0.07, w*0.07, accent, 999),
			builtinImageEditorTextStyled(seed+"/label", "OPENPOST / UPDATE", w*0.17, h*0.13, w*0.5, h*0.05, w*0.02, muted, 700, "left"),
			builtinImageEditorTextStyled(seed+"/headline", headline, w*0.07, h*0.35, w*0.55, h*0.22, w*0.08, foreground, 800, "left"),
			builtinImageEditorTextStyled(seed+"/subline", subline, w*0.66, h*0.36, w*0.27, h*0.18, w*0.03, muted, 500, "left"),
		)
	case "thumbnail":
		layers = append(layers,
			builtinImageEditorShape(seed+"/subject", "Replace with your subject", "ellipse", w*0.04, h*0.1, w*0.4, h*0.8, "#44403c", w*0.2),
			builtinImageEditorTextStyled(seed+"/subject-label", "YOUR SUBJECT", w*0.08, h*0.47, w*0.32, h*0.06, w*0.025, "#d6d3d1", 700, "center"),
			builtinImageEditorTextStyled(seed+"/headline", headline, w*0.48, h*0.2, w*0.47, h*0.42, w*0.095, foreground, 900, "left"),
			builtinImageEditorShape(seed+"/rule", "Headline underline", "rounded_rectangle", w*0.5, h*0.7, w*0.32, h*0.035, accent, 999),
		)
	case "thumbnail-list":
		layers = append(layers,
			builtinImageEditorTextStyled(seed+"/headline", headline, w*0.06, h*0.12, w*0.58, h*0.24, w*0.078, foreground, 900, "left"),
			builtinImageEditorTextStyled(seed+"/list", "01  START HERE\n02  FIX THIS\n03  SHIP IT", w*0.08, h*0.46, w*0.52, h*0.34, w*0.04, "#e7e5e4", 700, "left"),
			builtinImageEditorShape(seed+"/subject", "Replace with your subject", "rounded_rectangle", w*0.67, h*0.1, w*0.28, h*0.8, accent, w*0.04),
		)
	default:
		layers = append(layers,
			builtinImageEditorAccent(seed, width, height, accent),
			builtinImageEditorText(seed+"/headline", headline, w*0.09, h*0.36, w*0.82, h*0.28, w*0.075, foreground),
			builtinImageEditorText(seed+"/subline", subline, w*0.09, h*0.68, w*0.72, h*0.12, w*0.026, muted),
		)
	}

	return ImageEditorPagePayload{
		ID:              uuid.NewSHA1(uuid.NameSpaceURL, []byte(seed)).String(),
		Name:            fmt.Sprintf("Page %d", pageIndex+1),
		BackgroundColor: background,
		Layers:          layers,
	}
}

func builtinImageEditorShape(seed, name, kind string, x, y, width, height float64, color string, radius float64) ImageEditorLayer {
	return ImageEditorLayer{
		ID:      uuid.NewSHA1(uuid.NameSpaceURL, []byte(seed)).String(),
		Type:    "shape",
		Name:    name,
		Visible: true,
		Opacity: 1,
		Transform: ImageEditorTransform{
			X: x, Y: y, Width: width, Height: height,
		},
		Shape: &ImageEditorShapeValue{Kind: kind, Fill: color, Stroke: color, Radius: radius},
	}
}

func builtinImageEditorTextStyled(seed, text string, x, y, width, height, fontSize float64, color string, fontWeight int, align string) ImageEditorLayer {
	layer := builtinImageEditorText(seed, text, x, y, width, height, fontSize, color)
	layer.Text.FontWeight = fontWeight
	layer.Text.Align = align
	return layer
}

func builtinImageEditorAccent(seed string, width, height int, color string) ImageEditorLayer {
	return ImageEditorLayer{
		ID:      uuid.NewSHA1(uuid.NameSpaceURL, []byte(seed+"/accent")).String(),
		Type:    "shape",
		Name:    "Accent",
		Visible: true,
		Opacity: 1,
		Transform: ImageEditorTransform{
			X: float64(width) * 0.09, Y: float64(height) * 0.18,
			Width: float64(width) * 0.18, Height: mathMax(12, float64(height)*0.012),
		},
		Shape: &ImageEditorShapeValue{Kind: "rounded_rectangle", Fill: color, Stroke: color, Radius: 999},
	}
}

func builtinImageEditorText(seed, text string, x, y, width, height, fontSize float64, color string) ImageEditorLayer {
	return ImageEditorLayer{
		ID:        uuid.NewSHA1(uuid.NameSpaceURL, []byte(seed)).String(),
		Type:      "text",
		Name:      text,
		Visible:   true,
		Opacity:   1,
		Transform: ImageEditorTransform{X: x, Y: y, Width: width, Height: height},
		Text: &ImageEditorTextValue{
			Text: text, FontFamily: "Geist Variable", FontWeight: 700, FontStyle: "normal",
			FontSize: fontSize, Color: color, Align: "left", LineHeight: 1.05,
			Shadow: ImageEditorTextShadow{Color: "#00000000"},
		},
	}
}

func imageEditorTemplateForeground(background string) string {
	if strings.HasPrefix(strings.ToLower(background), "#1") || strings.HasPrefix(strings.ToLower(background), "#2") {
		return "#fafaf9"
	}
	return "#1c1917"
}

func imageEditorTemplateMutedForeground(background string) string {
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
