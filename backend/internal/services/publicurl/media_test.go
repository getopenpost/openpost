package publicurl

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/mediasigner"
	"github.com/stretchr/testify/require"
)

type mediaURLStorage struct {
	publicBaseURL string
}

func (s mediaURLStorage) Driver() string { return "s3" }
func (s mediaURLStorage) Save(context.Context, string, io.Reader) (string, error) {
	return "", nil
}
func (s mediaURLStorage) Delete(context.Context, string) error { return nil }
func (s mediaURLStorage) GetURL(id string) string {
	return strings.TrimRight(s.publicBaseURL, "/") + "/" + id
}
func (s mediaURLStorage) Open(context.Context, string) (io.ReadCloser, error) { return nil, nil }

func TestResolveMediaURLUsesConfiguredProxyWithSignature(t *testing.T) {
	expiresAt := time.Unix(1_800_000_000, 0).UTC()
	media := models.MediaAttachment{ID: "media-1", FilePath: "stored/image.png", MimeType: "image/png"}

	got := ResolveMediaURL(
		"https://app.openpost.test/media",
		mediaURLStorage{publicBaseURL: "https://cdn.openpost.test"},
		mediasigner.New("secret"),
		media,
		expiresAt,
	)

	require.Contains(t, got, "https://app.openpost.test/media/media-1.png?exp=1800000000&sig=")
}

func TestResolveMediaURLUsesStoragePublicURLWithoutProxySignature(t *testing.T) {
	media := models.MediaAttachment{ID: "media-1", FilePath: "stored/image.png", MimeType: "image/png"}

	got := ResolveMediaURL(
		"/media",
		mediaURLStorage{publicBaseURL: "https://cdn.openpost.test"},
		mediasigner.New("secret"),
		media,
		time.Now().UTC().Add(time.Hour),
	)

	require.Equal(t, "https://cdn.openpost.test/stored/image.png", got)
}

func TestMediaVerifierRefreshesLegacyRelativeURLFailureAfterConfigurationFix(t *testing.T) {
	now := time.Date(2026, time.July, 27, 12, 0, 0, 0, time.UTC)
	verifier := NewMediaVerifier("https://app.openpost.test/media", nil, mediasigner.New("secret"))
	verifier.now = func() time.Time { return now }
	media := models.MediaAttachment{
		ID:                 "media-1",
		MimeType:           "image/jpeg",
		PublicURLCheckedAt: now.Add(-time.Minute),
		PublicURLError:     legacyMediaURLError,
	}

	require.True(t, verifier.NeedsRefresh(media))
}
