package platform

import (
	"context"
	"io"
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

func TestPublishingAdapterDoesNotRequireAccountContentDiscovery(t *testing.T) {
	t.Parallel()

	var adapter Adapter = nondiscoveryAdapter{}
	_, discoveryRequired := adapter.(AccountContentDiscoverer)
	require.False(t, discoveryRequired)
	_, batchRequired := adapter.(AccountContentBatchMeasurer)
	require.False(t, batchRequired)
}

type nondiscoveryAdapter struct{}

func (nondiscoveryAdapter) Publish(context.Context, string, string, *PublishRequest) (PublishResult, error) {
	return PublishResult{}, nil
}
func (nondiscoveryAdapter) UploadMedia(context.Context, string, string, string, io.Reader) (string, error) {
	return "", nil
}
func (nondiscoveryAdapter) GenerateAuthURL(string) (string, map[string]string) {
	return "", nil
}
func (nondiscoveryAdapter) ExchangeCode(context.Context, string, map[string]string) (*TokenResult, error) {
	return &TokenResult{}, nil
}
func (nondiscoveryAdapter) RefreshCapability() RefreshCapability { return RefreshCapability{} }
func (nondiscoveryAdapter) RefreshToken(context.Context, RefreshTokenInput) (*TokenResult, error) {
	return &TokenResult{}, nil
}
func (nondiscoveryAdapter) GetProfile(context.Context, string) (*UserProfile, error) {
	return &UserProfile{}, nil
}
