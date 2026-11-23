package publisher

import (
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"path/filepath"
	"strings"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/providerlimits"
	"golang.org/x/image/webp"
)

// preflightBlueskyGalleryMedia checks every gallery attachment before the first
// provider blob upload. Older ready assets may have been stored without image
// dimensions; recover their dimensions from trusted workspace storage in memory
// rather than allowing a late createRecord failure after blobs have been sent.
func (s *Service) preflightBlueskyGalleryMedia(ctx context.Context, media []models.MediaAttachment) error {
	var open func(context.Context, string) (io.ReadCloser, error)
	if s.storage != nil {
		open = s.storage.Open
	}
	return checkBlueskyGalleryMedia(ctx, media, open)
}

func checkBlueskyGalleryMedia(
	ctx context.Context,
	media []models.MediaAttachment,
	open func(context.Context, string) (io.ReadCloser, error),
) error {
	if len(media) <= providerlimits.BlueskyLegacyImageMaxCount {
		return nil
	}
	if len(media) > providerlimits.BlueskyImageMaxCount {
		return fmt.Errorf("bluesky supports up to %d images per post", providerlimits.BlueskyImageMaxCount)
	}
	for i := range media {
		mimeType := strings.ToLower(strings.TrimSpace(strings.Split(media[i].MimeType, ";")[0]))
		switch mimeType {
		case "image/jpeg", "image/png", "image/webp":
		default:
			return fmt.Errorf("bluesky gallery image %d must be JPEG, PNG, or WebP", i+1)
		}
		if media[i].Width > 0 && media[i].Height > 0 {
			if int64(media[i].Width) > 64_000_000/int64(media[i].Height) {
				return fmt.Errorf("bluesky gallery image %d dimensions exceed the supported pixel limit", i+1)
			}
			continue
		}
		if open == nil || strings.TrimSpace(media[i].FilePath) == "" {
			return fmt.Errorf("bluesky gallery image %d has no recoverable dimensions", i+1)
		}
		reader, err := open(ctx, filepath.Base(media[i].FilePath))
		if err != nil {
			return fmt.Errorf("bluesky gallery image %d cannot be inspected", i+1)
		}
		var config image.Config
		var decodeErr error
		switch mimeType {
		case "image/jpeg":
			config, decodeErr = jpeg.DecodeConfig(reader)
		case "image/png":
			config, decodeErr = png.DecodeConfig(reader)
		case "image/webp":
			config, decodeErr = webp.DecodeConfig(reader)
		}
		_ = reader.Close()
		if decodeErr != nil || config.Width <= 0 || config.Height <= 0 ||
			int64(config.Width) > 64_000_000/int64(config.Height) {
			return fmt.Errorf("bluesky gallery image %d has no valid dimensions", i+1)
		}
		media[i].Width, media[i].Height = config.Width, config.Height
	}
	return nil
}
