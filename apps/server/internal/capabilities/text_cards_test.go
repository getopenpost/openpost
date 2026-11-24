package capabilities

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTextCardsDeduplicateSharedSourceAttachments(t *testing.T) {
	t.Parallel()
	photos := []MediaItem{{ID: "one", MimeType: "image/jpeg", Width: 1080, Height: 1350}, {ID: "two", MimeType: "image/jpeg", Width: 1080, Height: 1350}, {ID: "three", MimeType: "image/jpeg", Width: 1080, Height: 1350}}
	resolved := Resolve(ProviderPixelfed, ResolveInput{Settings: map[string]any{"text_card": "always"}, Segments: []ResolveSegment{{ID: "a", Body: "First", Media: photos}, {ID: "b", Body: "Second", Media: photos}}})
	require.True(t, resolved.Compatible, "%+v", resolved.Issues)
}
