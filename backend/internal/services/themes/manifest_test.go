package themes

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBuiltInsAreCompleteImmutableCanonicalManifests(t *testing.T) {
	builtIns := BuiltIns()
	require.Len(t, builtIns, 8)

	for _, id := range builtInOrder {
		family, ok := builtIns[id]
		require.True(t, ok, id)
		require.Equal(t, id, family.ID)
		require.Equal(t, "builtin-v1", family.Revision)
		require.NotEmpty(t, family.SupportedSchemes)
		normalized, err := NormalizeManifest(family)
		require.NoError(t, err, id)
		require.Equal(t, family, normalized)
	}
	require.Equal(t, []ColorScheme{SchemeLight}, builtIns["corkboard"].SupportedSchemes)
	require.Equal(t, []ColorScheme{SchemeDark}, builtIns["midnight"].SupportedSchemes)
	require.Equal(t, []ColorScheme{SchemeLight, SchemeDark}, builtIns["workshop"].SupportedSchemes)

	first := BuiltIns()
	first["workshop"].Schemes.Light.Colors.Canvas = "#000000"
	require.NotEqual(t, "#000000", BuiltIns()["workshop"].Schemes.Light.Colors.Canvas, "callers cannot mutate later fallback resolutions")
}

func TestBuiltInInteractiveStatesArePerceptuallyDistinct(t *testing.T) {
	var families []ThemeManifest
	require.NoError(t, json.Unmarshal(builtInFixture, &families))
	for _, family := range families {
		for _, scheme := range []struct {
			name     string
			manifest *ThemeSchemeManifest
		}{{"light", family.Schemes.Light}, {"dark", family.Schemes.Dark}} {
			if scheme.manifest == nil {
				continue
			}
			colors := scheme.manifest.Colors
			states := []struct {
				name                string
				base, hover, active string
			}{
				{"focal", colors.ActionFocal, colors.ActionFocalHover, colors.ActionFocalActive},
				{"primary", colors.ActionPrimary, colors.ActionPrimaryHover, colors.ActionPrimaryActive},
				{"ordinary", colors.ActionOrdinary, colors.ActionOrdinaryHover, colors.ActionOrdinaryActive},
				{"quiet", colors.ActionQuiet, colors.ActionQuietHover, colors.ActionQuietActive},
				{"destructive", colors.ActionDestructive, colors.ActionDestructiveHover, colors.ActionDestructiveActive},
			}
			for _, state := range states {
				for _, pair := range []struct {
					name          string
					first, second string
				}{{"base-hover", state.base, state.hover}, {"base-active", state.base, state.active}, {"hover-active", state.hover, state.active}} {
					distance, ok := perceptualColorDistance(pair.first, pair.second, colors.Canvas)
					if !ok || distance < minimumStateDistance {
						t.Errorf("%s %s %s %s distance %.4f, want at least %.3f", family.ID, scheme.name, state.name, pair.name, distance, minimumStateDistance)
					}
				}
			}
		}
	}
}

func TestDecodeManifestRejectsUnknownFieldsAndSchemaMigration(t *testing.T) {
	raw, err := json.Marshal(BuiltIns()["workshop"])
	require.NoError(t, err)
	unknown := []byte(strings.Replace(string(raw), `"name":"Workshop"`, `"name":"Workshop","unexpected":true`, 1))
	_, err = DecodeManifest(unknown)
	require.ErrorIs(t, err, ErrInvalidManifest)

	for _, schemaVersion := range []int{0, 2, 99} {
		manifest := BuiltIns()["workshop"]
		manifest.SchemaVersion = schemaVersion
		_, err = NormalizeManifest(manifest)
		require.ErrorIs(t, err, ErrInvalidManifest)
		require.ErrorContains(t, err, "schemaVersion")
	}
}

func TestDecodeStoredManifestRejectsClientSuppliedNativeDerivative(t *testing.T) {
	manifest := BuiltIns()["workshop"]
	manifest.Fonts = []ThemeFontFace{{
		ID: "font-1", Family: "Custom Sans", SourceURL: "asset:font-1",
		Format: "woff2", Weight: 400, Style: "normal", Display: "swap",
	}}
	raw, err := json.Marshal(manifest)
	require.NoError(t, err)
	withDerivative := strings.Replace(
		string(raw),
		`"display":"swap"`,
		`"display":"swap","nativeDerivative":{"sourceUrl":"/private","format":"ttf","identity":"forged"}`,
		1,
	)
	_, err = DecodeManifest([]byte(withDerivative))
	require.ErrorIs(t, err, ErrInvalidManifest)
	require.ErrorContains(t, err, "unknown field")
}

func TestNormalizeSchemeManifestRejectsAdversarialTokens(t *testing.T) {
	tests := []struct {
		name string
		path string
		edit func(*ThemeSchemeManifest)
	}{
		{"missing color", "colors.ink", func(m *ThemeSchemeManifest) { m.Colors.Ink = "" }},
		{"unsafe color", "colors.canvas", func(m *ThemeSchemeManifest) { m.Colors.Canvas = `url(https://example.com/x)` }},
		{"unparsed hsl", "colors.chart1", func(m *ThemeSchemeManifest) { m.Colors.Chart1 = `hsl(20 80% 50%)` }},
		{"unparsed color mix", "colors.chart1", func(m *ThemeSchemeManifest) { m.Colors.Chart1 = `color-mix(in oklch, nope 50%, black)` }},
		{"low contrast", "colors.canvasInk", func(m *ThemeSchemeManifest) { m.Colors.Ink = m.Colors.Canvas }},
		{"low ordinary action contrast", "colors.actionOrdinaryInk", func(m *ThemeSchemeManifest) { m.Colors.ActionOrdinaryInk = m.Colors.ActionOrdinary }},
		{"low link contrast", "colors.link", func(m *ThemeSchemeManifest) { m.Colors.Link = m.Colors.Canvas }},
		{"low chrome contrast", "colors.chromeInk", func(m *ThemeSchemeManifest) { m.Colors.ChromeInk = m.Colors.Chrome }},
		{"invisible focus", "colors.focus", func(m *ThemeSchemeManifest) { m.Colors.Focus = m.Colors.Canvas }},
		{"indistinct state", "colors.actionFocal", func(m *ThemeSchemeManifest) { m.Colors.ActionFocalActive = m.Colors.ActionFocalHover }},
		{"perceptually indistinct state", "colors.actionFocal", func(m *ThemeSchemeManifest) { m.Colors.ActionFocalHover = "oklch(0.5501 0.155 45)" }},
		{"destructive matches safe action", "colors.actionDestructive", func(m *ThemeSchemeManifest) {
			m.Colors.ActionDestructive = m.Colors.ActionOrdinary
			m.Colors.ActionDestructiveInk = m.Colors.ActionOrdinaryInk
		}},
		{"protected editor drift", "protectedEditor", func(m *ThemeSchemeManifest) { m.ProtectedEditor.EditorCanvas = "#fff" }},
		{"unsafe fallback", "typography.body.fallbacks", func(m *ThemeSchemeManifest) { m.Typography.Body.Fallbacks = []string{"remote-font"} }},
		{"fractional weight", "typography.body.weight", func(m *ThemeSchemeManifest) { m.Typography.Body.Weight = 455 }},
		{"negative type size", "typography.body.size", func(m *ThemeSchemeManifest) { m.Typography.Body.Size = "-1rem" }},
		{"unparsed clamp", "typography.display.size", func(m *ThemeSchemeManifest) { m.Typography.Display.Size = "clamp(foo)" }},
		{"short touch target", "spacing.touchTarget", func(m *ThemeSchemeManifest) { m.Spacing.TouchTarget = "43px" }},
		{"negative spacing", "spacing.base", func(m *ThemeSchemeManifest) { m.Spacing.Base = "-1px" }},
		{"missing border style", "shape.borderStyle", func(m *ThemeSchemeManifest) { m.Shape.BorderStyle = "" }},
		{"negative radius", "shape.radius", func(m *ThemeSchemeManifest) { m.Shape.Radius = "-1px" }},
		{"unbounded shell width", "shell.contentMaxWidth", func(m *ThemeSchemeManifest) { m.Shell.ContentMaxWidth = "5000px" }},
		{"negative shell height", "shell.headerHeight", func(m *ThemeSchemeManifest) { m.Shell.HeaderHeight = "-1rem" }},
		{"unsafe shadow grammar", "elevation.card", func(m *ThemeSchemeManifest) { m.Elevation.Card = "0 1px 2px 0 var(--evil)" }},
		{"unsafe press opacity", "motion.press.opacity", func(m *ThemeSchemeManifest) { m.Motion.Press.Opacity = 0 }},
		{"long page transition", "motion.pageTransition.duration", func(m *ThemeSchemeManifest) { m.Motion.PageTransition.Duration = "3s" }},
		{"invalid easing", "motion.hover.easing", func(m *ThemeSchemeManifest) { m.Motion.Hover.Easing = "cubic-bezier(0, 1, 2)" }},
		{"invalid reduced motion", "motion.reducedMotion", func(m *ThemeSchemeManifest) { m.Motion.ReducedMotion = "slide" }},
		{"missing navigation recipe", "components.navigation", func(m *ThemeSchemeManifest) { m.Components.Navigation = "" }},
		{"unknown loading recipe", "components.loadingState", func(m *ThemeSchemeManifest) { m.Components.LoadingState = "orbit" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			manifest := Workshop(SchemeLight)
			test.edit(&manifest)
			_, err := NormalizeSchemeManifest(SchemeLight, manifest)
			require.ErrorIs(t, err, ErrInvalidManifest)
			require.ErrorContains(t, err, test.path)
		})
	}
}

func TestNormalizeManifestRejectsUnsafeDuplicateResources(t *testing.T) {
	manifest := BuiltIns()["workshop"]
	manifest.Fonts = []ThemeFontFace{{ID: "font-1", Family: "Custom Sans", SourceURL: "https://example.com/font.woff2", Format: "woff2", Weight: 400, Style: "normal", Display: "swap"}}
	_, err := NormalizeManifest(manifest)
	require.ErrorIs(t, err, ErrInvalidManifest)
	require.ErrorContains(t, err, "fonts[0]")

	manifest = BuiltIns()["workshop"]
	manifest.Assets = []ThemeAsset{
		{ID: "asset-1", Slot: "background-texture", SourceURL: "asset:asset-1", MimeType: "image/png"},
		{ID: "asset-2", Slot: "background-texture", SourceURL: "asset:asset-2", MimeType: "image/png"},
	}
	_, err = NormalizeManifest(manifest)
	require.ErrorIs(t, err, ErrInvalidManifest)
	require.ErrorContains(t, err, "duplicate single-value slot")

	manifest = BuiltIns()["workshop"]
	manifest.Assets = []ThemeAsset{{
		ID: "asset-1", Slot: "empty-state-illustration",
		SourceURL: "asset:asset-1", MimeType: "image/png",
	}}
	_, err = NormalizeManifest(manifest)
	require.ErrorIs(t, err, ErrInvalidManifest)
	require.ErrorContains(t, err, "assets[0].alt")
}

func TestFontAvailabilityRequiresNormalFaceForTypographyRoles(t *testing.T) {
	manifest := BuiltIns()["workshop"]
	manifest.Schemes.Light.Typography.Body.Family = "Custom Sans"
	manifest.Fonts = []ThemeFontFace{{
		ID: "custom-italic", Family: "Custom Sans", SourceURL: "asset:custom-italic",
		Format: "woff2", Weight: 400, Style: "italic", Display: "swap",
	}}
	err := validateManifestFontAvailability(manifest)
	require.ErrorIs(t, err, ErrInvalidManifest)
	require.ErrorContains(t, err, "matching normal Organization WOFF2 face")

	manifest.Fonts[0].Style = "normal"
	require.NoError(t, validateManifestFontAvailability(manifest))
}
