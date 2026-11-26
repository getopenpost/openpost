package memes

import (
	"bytes"
	"context"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io/fs"
	"testing"

	"github.com/disintegration/imaging"
	"github.com/stretchr/testify/require"
)

func TestBuiltinProviderOwnsTheCompletePinnedCatalog(t *testing.T) {
	t.Parallel()

	provider, err := NewBuiltinProvider()
	require.NoError(t, err)
	require.Equal(t, BuiltinProviderKey, provider.Key())
	require.True(t, provider.Available())

	catalog, err := provider.Templates(context.Background())
	require.NoError(t, err)
	require.NotEmpty(t, catalog.Templates)
	require.False(t, catalog.Stale)
	require.Regexp(t, `^sha256:[0-9a-f]{64}$`, catalog.Revision)

	byID := make(map[string]Template, len(catalog.Templates))
	for _, template := range catalog.Templates {
		require.NotEmpty(t, template.Semantic.Visual, template.ID)
		require.NotEmpty(t, template.Semantic.Meaning, template.ID)
		require.NotEmpty(t, template.Semantic.Mechanism, template.ID)
		require.Len(t, template.Semantic.CaptionRoles, template.Lines, template.ID)
		require.GreaterOrEqual(t, len(template.Semantic.Tags), 2, template.ID)
		byID[template.ID] = template
	}
	require.Equal(t, 2, byID["drake"].Lines)
	require.Equal(t, 3, byID["3hd"].Overlays)
	require.True(t, byID["bongo"].Animated)
	require.NotEmpty(t, byID["gru"].Semantic.Meaning)
	require.Len(t, byID["gru"].Semantic.CaptionRoles, byID["gru"].Lines)

	search, err := provider.Search(context.Background(), "gru", 10)
	require.NoError(t, err)
	require.Equal(t, catalog.Revision, search.Revision)
}

func TestBuiltinProviderRendersLocallyWithoutWatermark(t *testing.T) {
	t.Parallel()

	provider, err := NewBuiltinProvider()
	require.NoError(t, err)

	blank, err := provider.Render(context.Background(), RenderRequest{
		TemplateID: "drake",
		Text:       []string{"", ""},
		Extension:  "png",
	})
	require.NoError(t, err)
	rendered, err := provider.Render(context.Background(), RenderRequest{
		TemplateID: "drake",
		Text:       []string{"Remote renderer", "OpenPost renderer"},
		Extension:  "png",
	})
	require.NoError(t, err)
	require.Equal(t, "image/png", rendered.MIMEType)
	require.Equal(t, "png", rendered.Extension)
	require.Equal(t, "drake", rendered.TemplateID)
	require.NotEqual(t, blank.Data, rendered.Data)

	blankConfig, _, err := image.DecodeConfig(bytes.NewReader(blank.Data))
	require.NoError(t, err)
	renderedConfig, _, err := image.DecodeConfig(bytes.NewReader(rendered.Data))
	require.NoError(t, err)
	require.Equal(t, blankConfig, renderedConfig)

	template := provider.byID["drake"]
	sourceData, err := fs.ReadFile(provider.files, "catalog/templates/drake/"+template.DefaultAsset)
	require.NoError(t, err)
	source, err := imaging.Decode(bytes.NewReader(sourceData), imaging.AutoOrientation(true))
	require.NoError(t, err)
	expectedBlank := imaging.Resize(source, 0, builtinRenderHeight, imaging.Lanczos)
	actualBlank, err := imaging.Decode(bytes.NewReader(blank.Data))
	require.NoError(t, err)
	require.Equal(t, expectedBlank.Bounds(), actualBlank.Bounds())
	require.Equal(t, expectedBlank.Pix, imaging.Clone(actualBlank).Pix, "blank output must not add a watermark")
}

func TestBuiltinRenderPreservesUnicodeCaptionPixels(t *testing.T) {
	t.Parallel()
	provider, err := NewBuiltinProvider()
	require.NoError(t, err)
	blank, err := provider.Render(t.Context(), RenderRequest{TemplateID: "chair", Text: []string{"", "", "", "", "", ""}, Extension: "png"})
	require.NoError(t, err)
	for _, pair := range [][2]string{{"東京", "大阪"}, {"مرحبا", "جميلة"}, {"👩🏽‍💻", "👩🏽‍🔧"}} {
		t.Run(pair[0], func(t *testing.T) {
			t.Parallel()
			rendered, err := provider.Render(t.Context(), RenderRequest{TemplateID: "chair", Text: []string{pair[0], "", "", "", "", ""}, Extension: "png"})
			require.NoError(t, err)
			original, _, err := image.Decode(bytes.NewReader(blank.Data))
			require.NoError(t, err)
			actual, _, err := image.Decode(bytes.NewReader(rendered.Data))
			require.NoError(t, err)
			changed := 0
			for y := 120; y < 198; y++ {
				for x := 0; x < 356; x++ {
					if original.At(x, y) != actual.At(x, y) {
						changed++
					}
				}
			}
			require.Greater(t, changed, 100, "caption must produce visible ink in its slot")
			other, err := provider.Render(t.Context(), RenderRequest{TemplateID: "chair", Text: []string{pair[1], "", "", "", "", ""}, Extension: "png"})
			require.NoError(t, err)
			require.NotEqual(t, rendered.Data, other.Data, "distinct captions must not collapse to identical missing-glyph boxes")
		})
	}
}
