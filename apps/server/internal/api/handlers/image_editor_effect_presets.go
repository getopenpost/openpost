package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
)

type ImageEditorEffectPresetResponse struct {
	ID      string                  `json:"id"`
	Name    string                  `json:"name"`
	Effects ImageEditorLayerEffects `json:"effects"`
}

type SaveImageEditorEffectPresetInput struct {
	ID   string `path:"id" format:"uuid"`
	Body struct {
		WorkspaceID string                  `json:"workspace_id" minLength:"1"`
		Name        string                  `json:"name" minLength:"1" maxLength:"120"`
		Effects     ImageEditorLayerEffects `json:"effects"`
	}
}

type DeleteImageEditorEffectPresetInput struct {
	ID          string `path:"id" format:"uuid"`
	WorkspaceID string `query:"workspace_id" required:"true"`
}

type ImageEditorEffectPresetOutput struct {
	Body ImageEditorBrandKitResponse
}

func (h *ImageEditorHandler) registerEffectPresets(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "save-image-editor-effect-preset", Method: http.MethodPut,
		Path: "/image-editor/effect-presets/{id}", Summary: "Save a workspace layer effect preset",
		Tags: []string{tagImageEditor}, MaxBodyBytes: 16 * 1024,
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}, Errors: []int{400, 403},
	}, h.saveEffectPreset)
	huma.Register(api, huma.Operation{
		OperationID: "delete-image-editor-effect-preset", Method: http.MethodDelete,
		Path: "/image-editor/effect-presets/{id}", Summary: "Delete a workspace layer effect preset",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}, Errors: []int{400, 403},
	}, h.deleteEffectPreset)
}

func (h *ImageEditorHandler) saveEffectPreset(ctx context.Context, input *SaveImageEditorEffectPresetInput) (*ImageEditorEffectPresetOutput, error) {
	if _, err := h.requireAccess(ctx, input.Body.WorkspaceID, true); err != nil {
		return nil, err
	}
	if _, err := uuid.Parse(input.ID); err != nil {
		return nil, huma.Error400BadRequest("invalid effect preset ID")
	}
	name := strings.TrimSpace(input.Body.Name)
	if name == "" || utf8.RuneCountInString(name) > 120 {
		return nil, huma.Error400BadRequest("effect preset names must contain 1 to 120 characters")
	}
	if err := validateImageEditorLayerEffects(ImageEditorLayer{Effects: &input.Body.Effects}); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	encoded, err := json.Marshal(input.Body.Effects)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid effect preset")
	}
	now := time.Now().UTC()
	preset := models.ImageEditorEffectPreset{WorkspaceID: input.Body.WorkspaceID, ID: input.ID, Name: name, EffectsJSON: string(encoded), CreatedAt: now, UpdatedAt: now}
	// Each preset is its own mutation boundary; saving one never rewrites other brand assets.
	_, err = h.db.NewInsert().Model(&preset).On("CONFLICT (workspace_id, id) DO UPDATE").Set("name = EXCLUDED.name").Set("effects_json = EXCLUDED.effects_json").Set("updated_at = EXCLUDED.updated_at").Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to save effect preset")
	}
	kit, err := h.loadBrandKit(ctx, input.Body.WorkspaceID, true)
	if err != nil {
		return nil, err
	}
	return &ImageEditorEffectPresetOutput{Body: kit}, nil
}

func (h *ImageEditorHandler) deleteEffectPreset(ctx context.Context, input *DeleteImageEditorEffectPresetInput) (*ImageEditorEffectPresetOutput, error) {
	if _, err := h.requireAccess(ctx, input.WorkspaceID, true); err != nil {
		return nil, err
	}
	if _, err := uuid.Parse(input.ID); err != nil {
		return nil, huma.Error400BadRequest("invalid effect preset ID")
	}
	_, err := h.db.NewDelete().Model((*models.ImageEditorEffectPreset)(nil)).Where("workspace_id = ? AND id = ?", input.WorkspaceID, input.ID).Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to delete effect preset")
	}
	kit, err := h.loadBrandKit(ctx, input.WorkspaceID, true)
	if err != nil {
		return nil, err
	}
	return &ImageEditorEffectPresetOutput{Body: kit}, nil
}

func (h *ImageEditorHandler) loadEffectPresets(ctx context.Context, workspaceID string) ([]ImageEditorEffectPresetResponse, error) {
	var rows []models.ImageEditorEffectPreset
	if err := h.db.NewSelect().Model(&rows).Where("workspace_id = ?", workspaceID).OrderExpr("LOWER(name) ASC, id ASC").Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to load effect presets")
	}
	result := make([]ImageEditorEffectPresetResponse, 0, len(rows))
	for _, row := range rows {
		preset := ImageEditorEffectPresetResponse{ID: row.ID, Name: row.Name}
		if err := json.Unmarshal([]byte(row.EffectsJSON), &preset.Effects); err != nil {
			return nil, huma.Error500InternalServerError("failed to load effect preset")
		}
		result = append(result, preset)
	}
	return result, nil
}
