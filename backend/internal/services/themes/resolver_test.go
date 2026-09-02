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
