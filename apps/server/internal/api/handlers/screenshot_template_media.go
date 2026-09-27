package handlers

import (
	"context"
	"slices"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

func screenshotTemplateMediaIDs(doc ScreenshotTemplateDocument) []string {
	var ids []string
	if doc.Conversation == nil {
		return ids
	}
	for _, person := range doc.Conversation.People {
		if person.AvatarMediaID != "" {
			ids = append(ids, person.AvatarMediaID)
		}
	}
	for _, message := range doc.Conversation.Messages {
		if message.ImageMediaID != "" {
			ids = append(ids, message.ImageMediaID)
		}
	}
	slices.Sort(ids)
	return slices.Compact(ids)
}

// Lock sources in the same order as the media lifecycle so saving cannot race trash or purge.
func validateScreenshotTemplateMedia(ctx context.Context, tx bun.Tx, workspaceID string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	var media []models.MediaAttachment
	query := tx.NewSelect().Model(&media).Where("workspace_id = ? AND id IN (?)", workspaceID, bun.List(ids)).Order("id ASC")
	if tx.Dialect().Name() == dialect.PG {
		query = query.For("UPDATE")
	}
	if err := query.Scan(ctx); err != nil {
		return huma.Error500InternalServerError("failed to validate template images")
	}
	if len(media) != len(ids) {
		return huma.Error400BadRequest("template images must belong to this workspace")
	}
	for _, item := range media {
		if item.AssetKind != "library" {
			return huma.Error400BadRequest("template images must be in the Media library")
		}
		if !item.TrashedAt.IsZero() || item.ProcessingStatus != mediaReadyStatus {
			return huma.Error400BadRequest("template images must be ready and outside Trash")
		}
		switch item.MimeType {
		case "image/png", "image/jpeg", "image/webp":
		default:
			return huma.Error400BadRequest("template images must be PNG, JPEG or WebP")
		}
	}
	return nil
}

func replaceScreenshotTemplateMedia(ctx context.Context, tx bun.Tx, designID string, ids []string) error {
	if _, err := tx.NewDelete().Model((*models.ScreenshotTemplateMediaReference)(nil)).Where("design_id = ?", designID).Exec(ctx); err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	refs := make([]models.ScreenshotTemplateMediaReference, 0, len(ids))
	for _, id := range ids {
		refs = append(refs, models.ScreenshotTemplateMediaReference{DesignID: designID, MediaID: id})
	}
	_, err := tx.NewInsert().Model(&refs).Exec(ctx)
	return err
}
