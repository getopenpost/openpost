package publisher

import (
	"bytes"
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

// preflightBlueskyGalleryMedia validates the provider media combination before
// any blob upload. Gallery images are inspected from their actual storage
// objects, never trusted solely from previously persisted image metadata.
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
	if len(media) > providerlimits.BlueskyImageMaxCount {
		return fmt.Errorf("bluesky supports up to %d images per post", providerlimits.BlueskyImageMaxCount)
	}
	if len(media) == 0 {
		return nil
	}

	// This also protects 1-4-image posts and single-video posts. The retired
	// provider-wide media validator is deliberately not reintroduced.
	for i := range media {
		mimeType := strings.ToLower(strings.TrimSpace(strings.SplitN(media[i].MimeType, ";", 2)[0]))
		switch mimeType {
		case "video/mp4", "image/gif":
			// The adapter transcodes a GIF to MP4 and publishes it as a video
			// embed with gif presentation, so both share the video limits.
			return checkBlueskyExclusiveMedia(mimeType, media[i].Size, len(media))
		case "image/jpeg", "image/png", "image/webp":
			media[i].MimeType = mimeType
		default:
			return fmt.Errorf("bluesky attachment %d must be JPEG, PNG, WebP, a single GIF, or a single MP4 video", i+1)
		}
	}
	if len(media) <= providerlimits.BlueskyLegacyImageMaxCount {
		return nil
	}
	for i := range media {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := verifyBlueskyGalleryObject(ctx, &media[i], open); err != nil {
			return fmt.Errorf("bluesky gallery image %d: %w", i+1, err)
		}
	}
	return nil
}

func checkBlueskyExclusiveMedia(mimeType string, size int64, count int) error {
	kind := "video"
	if mimeType == "image/gif" {
		kind = "gif"
		if count != 1 {
			return fmt.Errorf("bluesky supports only one gif per post and cannot mix it with other attachments")
		}
	}
	if count != 1 {
		return fmt.Errorf("bluesky does not support mixing video with other attachments")
	}
	if size > providerlimits.BlueskyVideoMaxBytes {
		return fmt.Errorf("bluesky %s exceeds the supported size limit", kind)
	}
	return nil
}

// verifyBlueskyGalleryObject reads at most one byte beyond the 2 MB provider
// limit. DecodeConfig establishes an upper bound on pixel allocation before
// the full, size-bounded image decode detects corrupt or truncated image data.
func verifyBlueskyGalleryObject(
	ctx context.Context,
	media *models.MediaAttachment,
	open func(context.Context, string) (io.ReadCloser, error),
) error {
	if open == nil || strings.TrimSpace(media.FilePath) == "" {
		return fmt.Errorf("stored object is unavailable")
	}
	reader, err := open(ctx, filepath.Base(media.FilePath))
	if err != nil {
		return fmt.Errorf("stored object cannot be opened")
	}
	defer reader.Close()

	const maxBytes = int64(providerlimits.BlueskyImageMaxBytes)
	content, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
	if err != nil {
		return fmt.Errorf("stored object cannot be read")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	size := int64(len(content))
	if size == 0 {
		return fmt.Errorf("stored object is empty")
	}
	if size > maxBytes {
		return fmt.Errorf("stored object exceeds %d bytes", maxBytes)
	}
	if media.Size > 0 && media.Size != size {
		return fmt.Errorf("stored object size does not match recorded metadata")
	}

	config, err := decodeStoredBlueskyGalleryImage(content, media.MimeType)
	if err != nil {
		return err
	}
	if (media.Width > 0 && media.Width != config.Width) || (media.Height > 0 && media.Height != config.Height) {
		return fmt.Errorf("stored image dimensions do not match recorded metadata")
	}
	media.Width = config.Width
	media.Height = config.Height
	media.Size = size
	return nil
}

// decodeStoredBlueskyGalleryImage validates payload integrity after checking
// both byte and pixel ceilings. A header-only check cannot reject truncation.
func decodeStoredBlueskyGalleryImage(content []byte, mimeType string) (image.Config, error) {
	var config image.Config
	var err error
	switch mimeType {
	case "image/jpeg":
		config, err = jpeg.DecodeConfig(bytes.NewReader(content))
	case "image/png":
		config, err = png.DecodeConfig(bytes.NewReader(content))
	case "image/webp":
		config, err = webp.DecodeConfig(bytes.NewReader(content))
	default:
		return config, fmt.Errorf("unsupported image MIME type")
	}
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return config, fmt.Errorf("invalid image header or MIME/content mismatch")
	}
	const maxPixels int64 = 64_000_000
	if int64(config.Width) > maxPixels/int64(config.Height) {
		return config, fmt.Errorf("dimensions exceed the supported pixel limit")
	}
	var decoded image.Image
	switch mimeType {
	case "image/jpeg":
		decoded, err = jpeg.Decode(bytes.NewReader(content))
	case "image/png":
		decoded, err = png.Decode(bytes.NewReader(content))
	case "image/webp":
		decoded, err = webp.Decode(bytes.NewReader(content))
	}
	if err != nil || decoded == nil || decoded.Bounds().Dx() != config.Width || decoded.Bounds().Dy() != config.Height {
		return config, fmt.Errorf("stored image is corrupt or truncated")
	}
	return config, nil
}
