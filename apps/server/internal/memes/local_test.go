package memes

import (
	"bytes"
	"context"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io/fs"
	"testing"
	"testing/fstest"

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
	require.Len(t, catalog.Templates, 209)
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

func TestBuiltinSemanticsRequireSpecificValidatedRecords(t *testing.T) {
	t.Parallel()

	valid := []byte(`[{"id":"sample","visual":"A person points left while the caption sits beside the gesture.","meaning":"The line labels the plainly indicated choice.","mechanism":"direct_reaction","caption_roles":["choice indicated by the pointing person"],"tags":["choice","reaction"]}]`)
	records, data, err := loadBuiltinSemantics(fstest.MapFS{
		builtinSemanticManifest: &fstest.MapFile{Data: valid},
	})
	require.NoError(t, err)
	require.Equal(t, valid, data)
	require.Contains(t, records, "sample")

	cases := map[string]string{
		"generic role":      `[{"id":"sample","visual":"A person points left.","meaning":"The line labels a choice.","mechanism":"direct_reaction","caption_roles":["top text"],"tags":["choice","reaction"]}]`,
		"bad mechanism":     `[{"id":"sample","visual":"A person points left.","meaning":"The line labels a choice.","mechanism":"Direct Reaction","caption_roles":["choice indicated by the person"],"tags":["choice","reaction"]}]`,
		"duplicate tags":    `[{"id":"sample","visual":"A person points left.","meaning":"The line labels a choice.","mechanism":"direct_reaction","caption_roles":["choice indicated by the person"],"tags":["choice","choice"]}]`,
		"control character": `[{"id":"sample","visual":"A person points left.\u0001","meaning":"The line labels a choice.","mechanism":"direct_reaction","caption_roles":["choice indicated by the person"],"tags":["choice","reaction"]}]`,
	}
	for name, source := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, _, err := loadBuiltinSemantics(fstest.MapFS{
				builtinSemanticManifest: &fstest.MapFile{Data: []byte(source)},
			})
			require.Error(t, err)
		})
	}

	_, _, err = loadBuiltinSemantics(fstest.MapFS{})
	require.ErrorContains(t, err, "load built-in meme semantics")
}

func TestBuiltinCatalogRevisionIncludesSemantics(t *testing.T) {
	t.Parallel()

	manifest := []byte(`{"templates":["sample"]}`)
	semantics := []byte(`[{"id":"sample"}]`)
	require.Equal(t, builtinCatalogRevision(manifest, semantics), builtinCatalogRevision(manifest, semantics))
	require.NotEqual(t, builtinCatalogRevision(manifest, semantics), builtinCatalogRevision(manifest, []byte(`[{"id":"sample","meaning":"changed"}]`)))
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

func TestBuiltinProviderReturnsSmallCacheableTemplateImages(t *testing.T) {
	t.Parallel()

	provider, err := NewBuiltinProvider()
	require.NoError(t, err)

	thumbnail, err := provider.TemplateImage(context.Background(), "drake")
	require.NoError(t, err)
	require.Equal(t, "drake", thumbnail.TemplateID)
	require.Less(t, len(thumbnail.Data), 100_000)

	config, _, err := image.DecodeConfig(bytes.NewReader(thumbnail.Data))
	require.NoError(t, err)
	require.LessOrEqual(t, config.Width, 480)
	require.LessOrEqual(t, config.Height, 480)
}

func TestBuiltinProviderRendersEveryCatalogTemplate(t *testing.T) {
	provider, err := NewBuiltinProvider()
	require.NoError(t, err)
	catalog, err := provider.Templates(t.Context())
	require.NoError(t, err)

	for _, template := range catalog.Templates {
		t.Run(template.ID, func(t *testing.T) {
			t.Parallel()

			captions := make([]string, template.Lines)
			for index := range captions {
				captions[index] = fmt.Sprintf("Field %d", index+1)
			}
			rendered, err := provider.Render(t.Context(), RenderRequest{
				TemplateID: template.ID,
				Text:       captions,
				Extension:  "png",
			})
			require.NoError(t, err)
			require.Equal(t, template.ID, rendered.TemplateID)
			require.Equal(t, "image/png", rendered.MIMEType)
			require.Equal(t, "png", rendered.Extension)
			config, format, err := image.DecodeConfig(bytes.NewReader(rendered.Data))
			require.NoError(t, err)
			require.Equal(t, "png", format)
			require.Positive(t, config.Width)
			require.Positive(t, config.Height)
		})
	}
}
