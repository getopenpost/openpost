package themes

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

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
