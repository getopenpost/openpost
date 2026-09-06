package accountfeatures

import (
	"testing"

	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestServiceOwnsProviderRegistryAndAcceptsDynamicProviders(t *testing.T) {
	defaultAdapter := platform.NewBlueskyAdapter("")
	input := map[string]platform.Adapter{"bluesky": defaultAdapter}
	service := NewService(nil, input, nil)

	delete(input, "bluesky")
	dynamicAdapter := platform.NewBlueskyAdapter("https://pds.example")
	service.SetProvider("bluesky:https://pds.example", dynamicAdapter)

	storedDefault, ok := service.resolveAdapter("bluesky")
	require.True(t, ok)
	require.Same(t, defaultAdapter, storedDefault)
	storedDynamic, ok := service.resolveAdapter("bluesky:https://pds.example")
	require.True(t, ok)
	require.Same(t, dynamicAdapter, storedDynamic)
}
