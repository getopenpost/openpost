package platform

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestNormalizeAccountContentItemBoundsTextAndRejectsUnsafeProviderURLs(t *testing.T) {
	t.Parallel()

	item, err := NormalizeAccountContentItem("youtube", AccountContentItem{
		ProviderContentID: " video-1 ", ContentProfile: "long_video",
		Title:       strings.Repeat("a", AccountContentMaxTitleCharacters+1),
		Text:        strings.Repeat("界", AccountContentMaxTextCharacters+1) + "\r\n",
		ExternalURL: "https://www.youtube.com/watch?v=video-1", PublishedAt: time.Now(),
		Origin: AccountContentOriginExternal,
	})
	require.NoError(t, err)
	require.Equal(t, "video-1", item.ProviderContentID)
	require.Len(t, []rune(item.Title), AccountContentMaxTitleCharacters)
	require.Len(t, []rune(item.Text), AccountContentMaxTextCharacters)
	require.Equal(t, AccountContentOriginConfidenceUnknown, item.OriginConfidence)

	for _, unsafe := range []string{
		"javascript:alert(1)",
		"https://user:secret@youtube.com/watch?v=video-1",
		"https://youtube.com.evil.example/watch?v=video-1",
	} {
		candidate := item
		candidate.ExternalURL = unsafe
		_, err := NormalizeAccountContentItem("youtube", candidate)
		require.Error(t, err, unsafe)
	}
}
