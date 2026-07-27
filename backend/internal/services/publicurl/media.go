package publicurl

import (
	"context"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/mediasigner"
	"github.com/openpost/backend/internal/services/mediastore"
)

const (
	mediaURLLifetime       = 15 * time.Minute
	failedMediaCheckMaxAge = 15 * time.Minute
	readyMediaCheckMaxAge  = 24 * time.Hour
	legacyMediaURLError    = "public media URL must use HTTPS"
)

// MediaVerifier resolves the same public media URL used for provider
// publishing and verifies that providers can fetch it.
type MediaVerifier struct {
	baseURL  string
	storage  mediastore.BlobStorage
	signer   *mediasigner.Signer
	verifier Verifier
	now      func() time.Time
}

func NewMediaVerifier(baseURL string, storage mediastore.BlobStorage, signer *mediasigner.Signer) *MediaVerifier {
	return &MediaVerifier{
		baseURL:  strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		storage:  storage,
		signer:   signer,
		verifier: HTTPVerifier{},
		now:      time.Now,
	}
}

func (v *MediaVerifier) SetVerifier(verifier Verifier) {
	if v != nil && verifier != nil {
		v.verifier = verifier
	}
}

func (v *MediaVerifier) URL(media models.MediaAttachment) string {
	if v == nil {
		return ""
	}
	now := time.Now
	if v.now != nil {
		now = v.now
	}
	return ResolveMediaURL(v.baseURL, v.storage, v.signer, media, now().UTC().Add(mediaURLLifetime))
}

func (v *MediaVerifier) Verify(ctx context.Context, media models.MediaAttachment) Result {
	if v == nil {
		return Result{CheckedAt: time.Now().UTC(), Error: MediaURLConfigurationError}
	}
	verifier := v.verifier
	if verifier == nil {
		verifier = HTTPVerifier{}
	}
	return verifier.Verify(ctx, v.URL(media))
}

// NeedsRefresh keeps transient failures recoverable and repairs media checked
// by older releases that validated a relative browser URL.
func (v *MediaVerifier) NeedsRefresh(media models.MediaAttachment) bool {
	if v == nil {
		return false
	}
	now := time.Now
	if v.now != nil {
		now = v.now
	}
	if media.PublicURLCheckedAt.IsZero() {
		return true
	}
	candidate, err := url.Parse(v.URL(media))
	candidateIsHTTPS := err == nil && candidate.Scheme == "https" && candidate.Host != ""
	if !media.PublicURLReady &&
		(media.PublicURLError == MediaURLConfigurationError || media.PublicURLError == legacyMediaURLError) &&
		candidateIsHTTPS {
		return true
	}
	maxAge := failedMediaCheckMaxAge
	if media.PublicURLReady {
		maxAge = readyMediaCheckMaxAge
	}
	return now().UTC().Sub(media.PublicURLCheckedAt) >= maxAge
}

func ResolveMediaURL(
	baseURL string,
	storage mediastore.BlobStorage,
	signer *mediasigner.Signer,
	media models.MediaAttachment,
	expiresAt time.Time,
) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if isAbsoluteMediaURL(baseURL) {
		return signedProxyMediaURL(baseURL, signer, media, expiresAt)
	}
	if storage != nil {
		storageKey := strings.TrimSpace(media.FilePath)
		if storage.Driver() == "" || storage.Driver() == "local" {
			storageKey = filepath.Base(storageKey)
		}
		storageURL := strings.TrimSpace(storage.GetURL(storageKey))
		if isAbsoluteMediaURL(storageURL) {
			return storageURL
		}
	}
	if baseURL == "" {
		baseURL = "/media"
	}
	return signedProxyMediaURL(baseURL, signer, media, expiresAt)
}

func isAbsoluteMediaURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	return err == nil && parsed.Scheme != "" && parsed.Host != ""
}

func signedProxyMediaURL(
	baseURL string,
	signer *mediasigner.Signer,
	media models.MediaAttachment,
	expiresAt time.Time,
) string {
	resolved := strings.TrimRight(baseURL, "/") + "/" + media.ID + mediaExtension(media.MimeType)
	if signer == nil {
		return resolved
	}
	return resolved + "?exp=" + formatUnix(expiresAt.Unix()) + "&sig=" + signer.Sign(media.ID, expiresAt)
}

func mediaExtension(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "video/mp4":
		return ".mp4"
	case "video/quicktime":
		return ".mov"
	case "video/webm":
		return ".webm"
	default:
		return ""
	}
}

func formatUnix(value int64) string {
	return strconv.FormatInt(value, 10)
}
