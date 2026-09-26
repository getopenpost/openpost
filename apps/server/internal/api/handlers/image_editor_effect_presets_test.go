package handlers

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestImageEditorEffectPresetsPersistIndependentlyAndRespectWorkspaceAccess(t *testing.T) {
	t.Parallel()
	h, ctx := newImageEditorHandlerTest(t)
	for _, model := range []any{(*models.BrandKit)(nil), (*models.BrandFont)(nil), (*models.ImageEditorEffectPreset)(nil)} {
		_, err := h.db.NewCreateTable().Model(model).Exec(ctx)
		require.NoError(t, err)
	}
	const firstID = "05f7cda9-ae89-408e-98ab-b1a6e787cb60"
	const secondID = "8b963975-4ca2-4cf6-a231-745b581c7575"
	save := &SaveImageEditorEffectPresetInput{ID: firstID}
	save.Body.WorkspaceID = "workspace-1"
	save.Body.Name = "Soft shadow"
	save.Body.Effects = ImageEditorLayerEffects{BlendMode: "multiply", DropShadow: &ImageEditorShadowEffect{Color: "#000000", Opacity: 0.5, Blur: 10, Distance: 4}}
	created, err := h.saveEffectPreset(ctx, save)
	require.NoError(t, err)
	require.False(t, created.Body.Exists, "presets must work before a brand kit has been configured")
	require.Len(t, created.Body.EffectPresets, 1)
	require.Equal(t, save.Body.Effects, created.Body.EffectPresets[0].Effects)

	save.ID = secondID
	save.Body.Name = "Second"
	_, err = h.saveEffectPreset(ctx, save)
	require.NoError(t, err)
	save.ID = firstID
	save.Body.Name = "Updated shadow"
	save.Body.Effects.DropShadow.Blur = 20
	_, err = h.saveEffectPreset(ctx, save)
	require.NoError(t, err)
	loaded, err := h.getBrandKit(ctx, &GetImageEditorBrandKitInput{WorkspaceID: "workspace-1"})
	require.NoError(t, err)
	require.Len(t, loaded.Body.EffectPresets, 2)
	require.Equal(t, secondID, loaded.Body.EffectPresets[0].ID)
	require.Equal(t, 10.0, loaded.Body.EffectPresets[0].Effects.DropShadow.Blur)
	require.Equal(t, "Updated shadow", loaded.Body.EffectPresets[1].Name)
	require.Equal(t, 20.0, loaded.Body.EffectPresets[1].Effects.DropShadow.Blur)

	brand := &UpdateImageEditorBrandKitInput{}
	brand.Body.WorkspaceID = "workspace-1"
	brand.Body.Name = "Updated workspace brand"
	updatedBrand, err := h.updateBrandKit(ctx, brand)
	require.NoError(t, err)
	require.Len(t, updatedBrand.Body.EffectPresets, 2, "brand edits must preserve independently saved presets")

	viewer := context.WithValue(ctx, middleware.UserIDKey, "viewer-1")
	_, err = h.saveEffectPreset(viewer, save)
	require.Error(t, err)
	_, err = h.deleteEffectPreset(viewer, &DeleteImageEditorEffectPresetInput{ID: firstID, WorkspaceID: "workspace-1"})
	require.Error(t, err)
	_, err = h.deleteEffectPreset(ctx, &DeleteImageEditorEffectPresetInput{ID: firstID, WorkspaceID: "workspace-2"})
	require.Error(t, err)
	visible, err := h.getBrandKit(viewer, &GetImageEditorBrandKitInput{WorkspaceID: "workspace-1"})
	require.NoError(t, err)
	require.Len(t, visible.Body.EffectPresets, 2)
	require.False(t, visible.Body.CanEdit)

	save.Body.Effects.DropShadow.Blur = -1
	_, err = h.saveEffectPreset(ctx, save)
	require.Error(t, err)
	removed, err := h.deleteEffectPreset(ctx, &DeleteImageEditorEffectPresetInput{ID: firstID, WorkspaceID: "workspace-1"})
	require.NoError(t, err)
	require.Len(t, removed.Body.EffectPresets, 1)
	require.Equal(t, secondID, removed.Body.EffectPresets[0].ID)
}
