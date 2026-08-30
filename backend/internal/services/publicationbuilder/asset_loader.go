package publicationbuilder

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"path/filepath"
	"strings"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/uptrace/bun"
)

const (
	maxBuilderAssetBytes      = int64(20 << 20)
	maxBuilderAssetTotalBytes = int64(30 << 20)
	maxBuilderDocumentBytes   = int64(8 << 20)
	maxBuilderImageBytes      = int64(10 << 20)
	maxBuilderAudioBytes      = int64(15 << 20)
)

// MediaAssetLoader turns checked Workspace media into bounded multimodal
// source inputs. Media remains evidence unless BuildAsset.MayPublish is true;
// this loader never assigns it to a destination output.
type MediaAssetLoader struct {
	db      *bun.DB
	storage mediastore.BlobStorage
}

func NewMediaAssetLoader(db *bun.DB, storage mediastore.BlobStorage) *MediaAssetLoader {
	return &MediaAssetLoader{db: db, storage: storage}
}

//nolint:gocyclo // Media safety, ownership, type, and size checks intentionally share this trust boundary.
func (loader *MediaAssetLoader) Load(
	ctx context.Context,
	workspaceID string,
	assets []BuildAsset,
) (LoadedAssets, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if loader == nil || loader.db == nil || loader.storage == nil || workspaceID == "" {
		return LoadedAssets{}, errors.New("builder media sources are unavailable")
	}
	if len(assets) == 0 {
		return LoadedAssets{}, nil
	}

	ids := make([]string, 0, len(assets))
	seen := make(map[string]struct{}, len(assets))
	for index, asset := range assets {
		id := strings.TrimSpace(asset.MediaID)
		if id == "" {
			return LoadedAssets{}, assetSourceFailure(index, errors.New("builder media source id is required"))
		}
		if _, duplicate := seen[id]; duplicate {
			return LoadedAssets{}, assetSourceFailure(index, errors.New("builder media source is repeated"))
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}

	var rows []models.MediaAttachment
	err := loader.db.NewSelect().Model(&rows).
		Where("workspace_id = ?", workspaceID).
		Where("processing_status = ?", "ready").
		Where("trashed_at IS NULL").
		Where("id IN (?)", bun.List(ids)).
		Scan(ctx)
	if err != nil {
		return LoadedAssets{}, assetSourceFailure(0, errors.New("builder media sources could not be loaded"))
	}
	byID := make(map[string]models.MediaAttachment, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}

	var output LoadedAssets
	var totalBytes int64
	for index, asset := range assets {
		if err := ctx.Err(); err != nil {
			return LoadedAssets{}, assetSourceFailure(index, err)
		}
		media, ok := byID[strings.TrimSpace(asset.MediaID)]
		if !ok {
			return LoadedAssets{}, assetSourceFailure(index, errors.New("builder media source is missing or outside the Workspace"))
		}
		mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(media.MimeType))
		if err != nil || !strings.Contains(mediaType, "/") {
			return LoadedAssets{}, assetSourceFailure(index, errors.New("builder media source has an invalid MIME type"))
		}
		mediaType = strings.ToLower(mediaType)
		limit := builderAssetByteLimit(mediaType)
		if media.Size < 0 || media.Size > limit || media.Size > maxBuilderAssetBytes {
			return LoadedAssets{}, assetSourceFailure(index, errors.New("builder media source exceeds its size limit"))
		}
		if totalBytes+media.Size > maxBuilderAssetTotalBytes {
			return LoadedAssets{}, assetSourceFailure(index, errors.New("builder media sources exceed the total size limit"))
		}

		reader, err := loader.storage.Open(ctx, media.FilePath)
		if err != nil {
			return LoadedAssets{}, assetSourceFailure(index, errors.New("builder media source bytes are unavailable"))
		}
		data, readErr := readBuilderAsset(reader, limit)
		closeErr := reader.Close()
		if readErr != nil {
			return LoadedAssets{}, assetSourceFailure(index, readErr)
		}
		if closeErr != nil {
			return LoadedAssets{}, assetSourceFailure(index, errors.New("builder media source could not be closed"))
		}
		totalBytes += int64(len(data))
		if totalBytes > maxBuilderAssetTotalBytes {
			return LoadedAssets{}, assetSourceFailure(index, errors.New("builder media sources exceed the total size limit"))
		}

		filename := safeBuilderFilename(media.OriginalFilename, mediaType, index)
		kind := builderAssetKind(mediaType)
		output.Sources = append(output.Sources, SourceMaterial{
			ID: "media:" + media.ID, Kind: kind, Label: filename, MIMEType: mediaType,
			Text: builderAssetDescription(media, asset, kind), Publishable: asset.MayPublish,
		})
		switch kind {
		case "image":
			image := ai.Image{Data: data, MIMEType: mediaType, Detail: ai.ImageDetailHigh}
			output.Parts = append(output.Parts, ai.MultimodalPart{SourceID: "media:" + media.ID, Image: &image})
		case "audio":
			audio := ai.Audio{Data: data, MIMEType: mediaType}
			output.Parts = append(output.Parts, ai.MultimodalPart{SourceID: "media:" + media.ID, Audio: &audio})
		case "video":
			video := ai.Video{Data: data, MIMEType: mediaType}
			output.Parts = append(output.Parts, ai.MultimodalPart{SourceID: "media:" + media.ID, Video: &video})
		default:
			file := ai.File{Data: data, MIMEType: mediaType, Filename: filename}
			output.Parts = append(output.Parts, ai.MultimodalPart{SourceID: "media:" + media.ID, File: &file})
		}
	}
	return output, nil
}

func assetSourceFailure(index int, cause error) error {
	return &sourceResolutionError{kind: "asset", index: index + 1, cause: cause}
}

func builderAssetByteLimit(mediaType string) int64 {
	switch {
	case strings.HasPrefix(mediaType, "image/"):
		return maxBuilderImageBytes
	case strings.HasPrefix(mediaType, "audio/"):
		return maxBuilderAudioBytes
	case strings.HasPrefix(mediaType, "video/"):
		return maxBuilderAssetBytes
	default:
		return maxBuilderDocumentBytes
	}
}

func readBuilderAsset(reader io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, errors.New("builder media source could not be read")
	}
	if int64(len(data)) > limit {
		return nil, errors.New("builder media source exceeds its size limit")
	}
	if len(data) == 0 {
		return nil, errors.New("builder media source is empty")
	}
	return data, nil
}

func builderAssetKind(mediaType string) string {
	for _, prefix := range []string{"image/", "audio/", "video/"} {
		if strings.HasPrefix(mediaType, prefix) {
			return strings.TrimSuffix(prefix, "/")
		}
	}
	return "document"
}

func safeBuilderFilename(value, mediaType string, index int) string {
	value = filepath.Base(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "\x00", "")
	value = strings.ReplaceAll(value, "\r", "")
	value = strings.ReplaceAll(value, "\n", "")
	if value != "" && value != "." {
		return value
	}
	extensions, _ := mime.ExtensionsByType(mediaType)
	extension := ""
	if len(extensions) > 0 {
		extension = extensions[0]
	}
	return fmt.Sprintf("source-%d%s", index+1, extension)
}

func builderAssetDescription(media models.MediaAttachment, asset BuildAsset, kind string) string {
	parts := []string{"Selected " + kind + " source", "role: " + strings.TrimSpace(asset.Role)}
	if alt := strings.TrimSpace(media.AltText); alt != "" {
		parts = append(parts, "description: "+alt)
	}
	if media.Width > 0 && media.Height > 0 {
		parts = append(parts, fmt.Sprintf("dimensions: %dx%d", media.Width, media.Height))
	}
	if media.DurationMS > 0 {
		parts = append(parts, fmt.Sprintf("duration_ms: %d", media.DurationMS))
	}
	if asset.MayPublish {
		parts = append(parts, "approved for publication")
	} else {
		parts = append(parts, "context only")
	}
	return strings.Join(parts, "; ")
}
