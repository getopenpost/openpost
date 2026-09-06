package themes

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestResolverReturnsWholeWorkshopFallback(t *testing.T) {
	customDark := Workshop(SchemeDark)
	customDark.Colors.Chart1 = "#111111"
	customFamily := family("custom-1", "Night custom", "", IconLucide, ThemeSchemes{Dark: &customDark})
	customFamily.Revision = "4"
	store := resolverStoreStub{
		selection: Selection{Reference: ThemeReference{Kind: ReferenceCustom, ID: "custom-1", Version: 4}},
		revision:  &PublishedRevision{ThemeID: "custom-1", Revision: 4, Manifest: customFamily},
	}
	resolver := newResolver(store)

	resolved, err := resolver.Resolve(context.Background(), ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeDark})
	require.NoError(t, err)
	require.Equal(t, ResolutionOrganization, resolved.Source)
	require.Equal(t, "Night custom", resolved.Name)
	require.Equal(t, "organization:custom-1:4:dark", resolved.CacheIdentity)

	resolved, err = resolver.Resolve(context.Background(), ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeLight})
	require.NoError(t, err)
	require.Equal(t, ResolutionFallback, resolved.Source)
	require.Equal(t, FallbackUnsupportedScheme, resolved.FallbackReason)
	require.Equal(t, Workshop(SchemeLight), resolved.Manifest)
	require.Equal(t, "workshop", resolved.ID)
	require.NotEqual(t, customDark.Colors.Chart1, resolved.Manifest.Colors.Chart1)
}

func TestResolverFallsBackForMissingInvalidAndUnpublishedReferences(t *testing.T) {
	tests := []struct {
		name   string
		store  resolverStoreStub
		reason FallbackReason
	}{
		{name: "missing", store: resolverStoreStub{selection: Selection{Reference: ThemeReference{Kind: ReferenceCustom, ID: "gone", Version: 2}}, loadErr: ErrNotFound}, reason: FallbackMissing},
		{name: "unpublished", store: resolverStoreStub{selection: Selection{Reference: ThemeReference{Kind: ReferenceCustom, ID: "draft", Version: 1}}}, reason: FallbackUnpublished},
		{name: "invalid built-in", store: resolverStoreStub{selection: Selection{Reference: ThemeReference{Kind: ReferenceBuiltIn, ID: "unknown", Version: 1}}}, reason: FallbackInvalidReference},
		{name: "inaccessible is non-enumerating", store: resolverStoreStub{selection: Selection{Reference: ThemeReference{Kind: ReferenceCustom, ID: "other-org", Version: 1}}, loadErr: ErrInaccessible}, reason: FallbackMissing},
		{name: "corrupt stored manifest", store: resolverStoreStub{selection: Selection{Reference: ThemeReference{Kind: ReferenceCustom, ID: "corrupt", Version: 1}}, loadErr: errStoredManifest}, reason: FallbackInvalidManifest},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			resolved, err := newResolver(test.store).Resolve(t.Context(), ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeDark})
			require.NoError(t, err)
			require.Equal(t, ResolutionFallback, resolved.Source)
			require.Equal(t, test.reason, resolved.FallbackReason)
			require.Equal(t, Workshop(SchemeDark), resolved.Manifest)
		})
	}
}

func TestResolverFallsBackAsAWholeForUnsafeOrUnavailableResources(t *testing.T) {
	family := BuiltIns()["workshop"]
	family.ID = "custom-1"
	family.Revision = "1"
	for _, test := range []struct {
		name   string
		err    error
		reason FallbackReason
	}{{"unsafe", errUnsafeResource, FallbackUnsafeResource}, {"unavailable", errResourceFailed, FallbackResourceFailed}} {
		t.Run(test.name, func(t *testing.T) {
			resolved, err := newResolver(resolverStoreStub{
				selection:   Selection{Reference: ThemeReference{Kind: ReferenceCustom, ID: family.ID, Version: 1}},
				revision:    &PublishedRevision{ThemeID: family.ID, Revision: 1, Manifest: family},
				resourceErr: test.err,
			}).Resolve(t.Context(), ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeLight})
			require.NoError(t, err)
			require.Equal(t, ResolutionFallback, resolved.Source)
			require.Equal(t, test.reason, resolved.FallbackReason)
			require.Equal(t, Workshop(SchemeLight), resolved.Manifest)
		})
	}
}

func TestResolverDoesNotTurnOperationalFailuresIntoFallbacks(t *testing.T) {
	resolver := newResolver(resolverStoreStub{
		selection: Selection{Reference: ThemeReference{Kind: ReferenceCustom, ID: "custom-1", Version: 1}},
		loadErr:   errors.New("database unavailable"),
	})
	_, err := resolver.Resolve(t.Context(), ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeLight})
	require.ErrorIs(t, err, ErrUnavailable)
}

func TestResolverReturnsOnlyFontsUsedByResolvedScheme(t *testing.T) {
	family := BuiltIns()["workshop"]
	family.ID = "custom-fonts"
	family.Revision = "1"
	family.Schemes.Light.Typography.Body.Family = "Custom Sans"
	family.Schemes.Light.Typography.Body.Weight = 400
	family.Schemes.Dark.Typography.Body.Family = "Custom Serif"
	family.Schemes.Dark.Typography.Body.Weight = 600
	family.Fonts = []ThemeFontFace{
		{ID: "sans-400", Family: "Custom Sans", SourceURL: "asset:sans-400", Format: "woff2", Weight: 400, Style: "normal", Display: "swap"},
		{ID: "sans-700-unused", Family: "Custom Sans", SourceURL: "asset:sans-700-unused", Format: "woff2", Weight: 700, Style: "normal", Display: "swap"},
		{ID: "serif-600", Family: "Custom Serif", SourceURL: "asset:serif-600", Format: "woff2", Weight: 600, Style: "normal", Display: "swap"},
	}
	store := resolverStoreStub{
		selection: Selection{Reference: ThemeReference{Kind: ReferenceCustom, ID: family.ID, Version: 1}},
		revision:  &PublishedRevision{ThemeID: family.ID, Revision: 1, Manifest: family},
	}

	light, err := newResolver(store).Resolve(t.Context(), ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeLight})
	require.NoError(t, err)
	require.Equal(t, []string{"sans-400"}, runtimeFontIDs(light.Fonts))

	dark, err := newResolver(store).Resolve(t.Context(), ResolveInput{WorkspaceID: "workspace-1", Scheme: SchemeDark})
	require.NoError(t, err)
	require.Equal(t, []string{"serif-600"}, runtimeFontIDs(dark.Fonts))
}

func runtimeFontIDs(fonts []ThemeRuntimeFontFace) []string {
	result := make([]string, 0, len(fonts))
	for _, font := range fonts {
		result = append(result, font.ID)
	}
	return result
}

type resolverStoreStub struct {
	selection   Selection
	revision    *PublishedRevision
	loadErr     error
	resourceErr error
}

func (s resolverStoreStub) Selection(context.Context, string) (Selection, error) {
	return s.selection, nil
}

func (s resolverStoreStub) published(context.Context, string, string, int) (*PublishedRevision, error) {
	return s.revision, s.loadErr
}

func (s resolverStoreStub) publishedResourcesAvailable(context.Context, string, string, int, ThemeManifest) error {
	return s.resourceErr
}
