package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/mediaanalysis"
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/uptrace/bun"
)

func (h *MediaHandler) listMedia(ctx context.Context, input *ListMediaInput) (*ListMediaOutput, error) {
	userID := middleware.GetUserID(ctx)

	if input.WorkspaceID == "" {
		return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
	}

	if err := h.ensureMediaWorkspaceAccess(ctx, userID, input.WorkspaceID); err != nil {
		return nil, err
	}

	limit := input.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	query, err := h.buildListMediaQuery(input)
	if err != nil {
		return nil, err
	}

	total64, err := query.Count(ctx)
	total := int(total64)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to count media")
	}

	query = h.applyListMediaSort(query, input.Sort)

	var media []models.MediaAttachment
	err = query.Limit(int64(limit)).Offset(int64(input.Offset)).Scan(ctx, &media)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to fetch media")
	}

	mediaIDs := make([]string, len(media))
	for i := range media {
		mediaIDs[i] = media[i].ID
	}
	usageByMedia, err := h.mediaUsageSummaries(ctx, input.WorkspaceID, mediaIDs)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to check media usage")
	}
	tagsByMedia, err := h.mediaTagsByMedia(ctx, mediaIDs)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load media organization")
	}

	result := h.presentMediaList(media, usageByMedia, tagsByMedia)

	return &ListMediaOutput{Body: struct {
		Media []MediaListItem `json:"media" doc:"Media attachments"`
		Total int             `json:"total" doc:"Total count matching filter"`
	}{Media: result, Total: total}}, nil
}

func (h *MediaHandler) buildListMediaQuery(input *ListMediaInput) (*bun.SelectQuery, error) {
	query := h.db.NewSelect().Model(&models.MediaAttachment{}).
		Where("workspace_id = ?", input.WorkspaceID)
	query = applyListMediaLifecycleFilter(query, input)
	query = applyListMediaTextFilter(query, input)
	var err error
	query, err = applyListMediaDimensionFilter(query, input)
	if err != nil {
		return nil, err
	}
	query = applyListMediaFeatureFilter(query, input)
	return query, nil
}

func applyListMediaLifecycleFilter(query *bun.SelectQuery, input *ListMediaInput) *bun.SelectQuery {
	switch strings.TrimSpace(input.Lifecycle) {
	case "temporary":
		query = query.Where("retention_class = ? AND trashed_at IS NULL", medialifecycle.RetentionTemporary)
	case "trash":
		query = query.Where("trashed_at IS NOT NULL")
	case "all":
		// Used only by internal organization surfaces that explicitly ask for all states.
	default:
		query = query.Where("(retention_class = ? OR retention_class = '' OR retention_class IS NULL) AND trashed_at IS NULL", medialifecycle.RetentionLibrary)
	}
	assetKind := strings.TrimSpace(input.AssetKind)
	if assetKind == "" {
		assetKind = "library"
	}
	if assetKind != "all" {
		if assetKind == "library" {
			query = query.Where("(asset_kind = ? OR asset_kind = '' OR asset_kind IS NULL)", assetKind)
		} else {
			query = query.Where("asset_kind = ?", assetKind)
		}
	}
	return query
}

func applyListMediaTextFilter(query *bun.SelectQuery, input *ListMediaInput) *bun.SelectQuery {
	if search := strings.TrimSpace(input.Search); search != "" {
		pattern := "%" + strings.ToLower(search) + "%"
		query = query.WhereGroup(" AND ", func(group *bun.SelectQuery) *bun.SelectQuery {
			return group.
				Where("LOWER(original_filename) LIKE ?", pattern).
				WhereOr("LOWER(alt_text) LIKE ?", pattern).
				WhereOr(`id IN (
						SELECT assignment.media_id
						FROM media_tag_assignments assignment
						JOIN media_tags tag ON tag.id = assignment.tag_id
						WHERE LOWER(tag.name) LIKE ?
					)`, pattern)
		})
	}
	if mediaType := strings.TrimSpace(input.Type); mediaType != "" && mediaType != "all" {
		query = query.Where("dominant_type = ?", mediaType)
	}
	if source := strings.TrimSpace(input.Source); source != "" && source != "all" {
		query = query.Where("source = ?", source)
	}
	return query
}

func applyListMediaDimensionFilter(query *bun.SelectQuery, input *ListMediaInput) (*bun.SelectQuery, error) {
	switch input.Aspect {
	case "square":
		query = query.Where("width > 0 AND height > 0 AND ABS(width - height) <= (CASE WHEN width > height THEN width ELSE height END) * 0.02")
	case "portrait":
		query = query.Where("height > width")
	case "landscape":
		query = query.Where("width > height")
	}
	if input.MinWidth > 0 {
		query = query.Where("width >= ?", input.MinWidth)
	}
	if input.MinHeight > 0 {
		query = query.Where("height >= ?", input.MinHeight)
	}
	if input.MaxWidth > 0 {
		query = query.Where("width <= ?", input.MaxWidth)
	}
	if input.MaxHeight > 0 {
		query = query.Where("height <= ?", input.MaxHeight)
	}
	if value := strings.TrimSpace(input.DateFrom); value != "" {
		date, parseErr := time.Parse("2006-01-02", value)
		if parseErr != nil {
			return nil, huma.Error400BadRequest("date_from must use YYYY-MM-DD")
		}
		query = query.Where("created_at >= ?", date.UTC())
	}
	if value := strings.TrimSpace(input.DateTo); value != "" {
		date, parseErr := time.Parse("2006-01-02", value)
		if parseErr != nil {
			return nil, huma.Error400BadRequest("date_to must use YYYY-MM-DD")
		}
		query = query.Where("created_at < ?", date.UTC().AddDate(0, 0, 1))
	}
	return query, nil
}

func applyListMediaFeatureFilter(query *bun.SelectQuery, input *ListMediaInput) *bun.SelectQuery {
	tagIDs := uniqueMediaFilterValues(input.TagID, input.TagIDs)
	for _, tagID := range tagIDs {
		query = query.Where("id IN (SELECT media_id FROM media_tag_assignments WHERE tag_id = ?)", tagID)
	}
	if input.Untagged {
		query = query.Where("id NOT IN (SELECT media_id FROM media_tag_assignments)")
	}
	switch input.Filter {
	case "favorites":
		query = query.Where("is_favorite = ?", true)
	case "used":
		query = query.WhereGroup(" AND ", func(group *bun.SelectQuery) *bun.SelectQuery {
			group = group.Where(`id IN (SELECT media_id FROM publication_assets)
					OR id IN (SELECT media_id FROM publication_segment_media)
					OR id IN (SELECT media_id FROM rendition_media)
					OR id IN (SELECT media_id FROM rendition_segment_media)
					OR id IN (SELECT r.media_id FROM design_media_references r JOIN design_documents d ON d.id = r.design_document_id WHERE d.deleted_at IS NULL)
					OR id IN (SELECT r.media_id FROM design_revision_media_references r JOIN design_revisions v ON v.id = r.revision_id JOIN design_documents d ON d.id = v.design_document_id WHERE d.deleted_at IS NULL)
					OR id IN (SELECT media_id FROM design_template_media_references)
                OR id IN (SELECT media_id FROM screenshot_template_media_references)
                OR id IN (SELECT media_id FROM screenshot_template_recipe_media_references)
					OR id IN (SELECT media_id FROM brand_fonts)
					OR id IN (SELECT cover_preview_media_id FROM design_documents WHERE cover_preview_media_id IS NOT NULL AND deleted_at IS NULL)
					OR id IN (SELECT p.preview_media_id FROM design_pages p JOIN design_documents d ON d.id = p.design_document_id WHERE p.preview_media_id IS NOT NULL AND d.deleted_at IS NULL)
					OR id IN (SELECT p.latest_export_media_id FROM design_pages p JOIN design_documents d ON d.id = p.design_document_id WHERE p.latest_export_media_id IS NOT NULL AND d.deleted_at IS NULL)
					OR id IN (SELECT preview_media_id FROM design_templates WHERE preview_media_id IS NOT NULL)`)
			return group
		})
	case "unused":
		query = query.Where(`id NOT IN (SELECT media_id FROM publication_assets)
				AND id NOT IN (SELECT media_id FROM publication_segment_media)
				AND id NOT IN (SELECT media_id FROM rendition_media)
				AND id NOT IN (SELECT media_id FROM rendition_segment_media)
				AND id NOT IN (SELECT r.media_id FROM design_media_references r JOIN design_documents d ON d.id = r.design_document_id WHERE d.deleted_at IS NULL)
				AND id NOT IN (SELECT r.media_id FROM design_revision_media_references r JOIN design_revisions v ON v.id = r.revision_id JOIN design_documents d ON d.id = v.design_document_id WHERE d.deleted_at IS NULL)
				AND id NOT IN (SELECT media_id FROM design_template_media_references)
                AND id NOT IN (SELECT media_id FROM screenshot_template_media_references)
                AND id NOT IN (SELECT media_id FROM screenshot_template_recipe_media_references)
				AND id NOT IN (SELECT media_id FROM brand_fonts)
				AND id NOT IN (SELECT cover_preview_media_id FROM design_documents WHERE cover_preview_media_id IS NOT NULL AND deleted_at IS NULL)
				AND id NOT IN (SELECT p.preview_media_id FROM design_pages p JOIN design_documents d ON d.id = p.design_document_id WHERE p.preview_media_id IS NOT NULL AND d.deleted_at IS NULL)
				AND id NOT IN (SELECT p.latest_export_media_id FROM design_pages p JOIN design_documents d ON d.id = p.design_document_id WHERE p.latest_export_media_id IS NOT NULL AND d.deleted_at IS NULL)
				AND id NOT IN (SELECT preview_media_id FROM design_templates WHERE preview_media_id IS NOT NULL)`)
	}
	return query
}

func (h *MediaHandler) applyListMediaSort(query *bun.SelectQuery, sort string) *bun.SelectQuery {
	switch sort {
	case "oldest":
		query = query.Order("created_at ASC")
	case mediaSortSize:
		query = query.Order("size DESC")
	case "name":
		query = query.OrderExpr("LOWER(original_filename) ASC")
	case "recently_used":
		query = query.OrderExpr(`COALESCE(
				(SELECT MAX(publication.updated_at)
				 FROM publication_assets asset
				 JOIN publications publication ON publication.id = asset.publication_id
				 WHERE asset.media_id = media_attachment.id),
				(SELECT MAX(publication.updated_at)
				 FROM publication_segment_media segment_media
				 JOIN publication_segments segment ON segment.id = segment_media.segment_id
				 JOIN publications publication ON publication.id = segment.publication_id
				 WHERE segment_media.media_id = media_attachment.id),
				(SELECT MAX(publication.updated_at)
				 FROM rendition_media rendition_media_item
				 JOIN renditions rendition ON rendition.id = rendition_media_item.rendition_id
				 JOIN publications publication ON publication.id = rendition.publication_id
				 WHERE rendition_media_item.media_id = media_attachment.id),
				(SELECT MAX(publication.updated_at)
				 FROM rendition_segment_media segment_media
				 JOIN rendition_segments segment ON segment.id = segment_media.rendition_segment_id
				 JOIN renditions rendition ON rendition.id = segment.rendition_id
				 JOIN publications publication ON publication.id = rendition.publication_id
				 WHERE segment_media.media_id = media_attachment.id),
				(SELECT MAX(document.updated_at)
				 FROM design_media_references design_reference
				 JOIN design_documents document ON document.id = design_reference.design_document_id
				 WHERE design_reference.media_id = media_attachment.id),
				(SELECT MAX(revision.created_at)
				 FROM design_revision_media_references revision_reference
				 JOIN design_revisions revision ON revision.id = revision_reference.revision_id
				 JOIN design_documents document ON document.id = revision.design_document_id
				 WHERE revision_reference.media_id = media_attachment.id AND document.deleted_at IS NULL),
				media_attachment.created_at
			) DESC`)
	default:
		query = query.Order("created_at DESC")
	}
	return query
}

func (h *MediaHandler) presentMediaList(media []models.MediaAttachment, usageByMedia map[string]mediaUsageSummary, tagsByMedia map[string][]string) []MediaListItem {
	result := make([]MediaListItem, len(media))
	for i, m := range media {
		usage := usageByMedia[m.ID]

		var thumbs Thumbnails
		if m.ThumbnailsJSON != "" {
			if err := json.Unmarshal([]byte(m.ThumbnailsJSON), &thumbs); err != nil {
				thumbs = Thumbnails{}
			}
		}

		result[i] = MediaListItem{
			ID:                 m.ID,
			WorkspaceID:        m.WorkspaceID,
			MimeType:           m.MimeType,
			Size:               m.Size,
			OriginalFilename:   m.OriginalFilename,
			Width:              m.Width,
			Height:             m.Height,
			AltText:            m.AltText,
			IsFavorite:         m.IsFavorite,
			CreatedAt:          m.CreatedAt.Format(time.RFC3339),
			URL:                "/media/" + m.ID,
			ThumbnailURL:       "",
			UsageCount:         usage.Total,
			CanDelete:          usage.Blocking == 0,
			ProcessingStatus:   m.ProcessingStatus,
			DurationMS:         m.DurationMS,
			FrameRate:          m.FrameRate,
			ContainerFormat:    m.ContainerFormat,
			VideoCodec:         m.VideoCodec,
			VideoProfile:       m.VideoProfile,
			AudioCodec:         m.AudioCodec,
			PixelFormat:        m.PixelFormat,
			ColorSpace:         m.ColorSpace,
			BitRate:            m.BitRate,
			Rotation:           m.Rotation,
			AudioChannels:      m.AudioChannels,
			ProcessingProgress: m.ProcessingProgress,
			AnalysisStatus:     m.AnalysisStatus,
			AnalysisError:      m.AnalysisError,
			PosterThumbnailURL: mediaPosterURL(m),
			PublicURLCheckedAt: formatMediaTime(m.PublicURLCheckedAt),
			PublicURLStatus:    m.PublicURLStatus,
			PublicURLError:     m.PublicURLError,
			Source:             m.Source,
			AssetKind:          m.AssetKind,
			ParentMediaID:      m.ParentMediaID,
			DesignDocumentID:   m.DesignDocumentID,
			DesignPageID:       m.DesignPageID,
			Tags:               tagsByMedia[m.ID],
			RetentionClass:     m.RetentionClass,
			LastUsedAt:         formatMediaTime(m.LastUsedAt),
			TrashedAt:          formatMediaTime(m.TrashedAt),
			PurgeAfter:         formatMediaTime(m.PurgeAfter),
			TrashReason:        m.TrashReason,
		}
		if result[i].Source == "" {
			result[i].Source = "upload"
		}
		if result[i].AssetKind == "" {
			result[i].AssetKind = "library"
		}
		if result[i].RetentionClass == "" {
			result[i].RetentionClass = medialifecycle.RetentionLibrary
		}
		switch {
		case thumbs.SM != "":
			result[i].ThumbnailURL = "/media/" + m.ID + "/thumb/sm"
		case strings.HasPrefix(m.MimeType, "video/"):
			result[i].ThumbnailURL = result[i].PosterThumbnailURL
		case strings.HasPrefix(m.MimeType, "image/"):
			result[i].ThumbnailURL = result[i].URL
		}
	}
	return result
}

func (h *MediaHandler) getMediaStorage(ctx context.Context, input *GetMediaStorageInput) (*GetMediaStorageOutput, error) {
	if input.WorkspaceID == "" {
		return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	if err := h.ensureMediaWorkspaceAccess(ctx, middleware.GetUserID(ctx), input.WorkspaceID); err != nil {
		return nil, err
	}
	var storageUsage struct {
		UsedBytes     int64 `bun:"used_bytes"`
		AssetCount    int   `bun:"asset_count"`
		InternalBytes int64 `bun:"internal_bytes"`
	}
	err := h.db.NewSelect().Model((*models.MediaAttachment)(nil)).
		ColumnExpr(`COALESCE(SUM(CASE WHEN asset_kind NOT IN ('design_preview', 'template_preview') THEN size ELSE 0 END), 0) AS used_bytes`).
		ColumnExpr(`COALESCE(SUM(CASE WHEN asset_kind NOT IN ('design_preview', 'template_preview') THEN 1 ELSE 0 END), 0) AS asset_count`).
		ColumnExpr(`COALESCE(SUM(CASE WHEN asset_kind IN ('design_preview', 'template_preview') THEN size ELSE 0 END), 0) AS internal_bytes`).
		Where("workspace_id = ?", input.WorkspaceID).
		Scan(ctx, &storageUsage)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load media storage usage")
	}
	out := &GetMediaStorageOutput{}
	out.Body.UsedBytes = storageUsage.UsedBytes
	out.Body.AssetCount = storageUsage.AssetCount
	out.Body.InternalBytes = storageUsage.InternalBytes
	out.Body.DirectUploadSupported = h.supportsUploadSessions()
	// Publish the enforced ceilings through the same rules the upload
	// admission applies, so clients validate against the server instead of
	// restating its constants. Representative inputs select each branch of
	// mediaUploadSizeLimit by construction.
	out.Body.UploadLimits = MediaUploadLimits{
		DefaultBytes:   mediaUploadSizeLimit("", "upload.bin", "application/octet-stream"),
		VideoBytes:     mediaUploadSizeLimit("", "upload.mp4", "video/mp4"),
		BrandFontBytes: mediaUploadSizeLimit("brand_font", "font.woff2", "font/woff2"),
	}
	return out, nil
}

func (h *MediaHandler) getMediaUsage(ctx context.Context, input *GetMediaUsageInput) (*GetMediaUsageOutput, error) {
	userID := middleware.GetUserID(ctx)

	var media models.MediaAttachment
	err := h.db.NewSelect().Model(&media).Where("id = ?", input.PathID).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound(errMediaNotFound)
		}
		return nil, huma.Error500InternalServerError("failed to fetch media")
	}

	if err := h.ensureMediaWorkspaceAccess(ctx, userID, media.WorkspaceID); err != nil {
		return nil, err
	}

	publications, err := h.publicationsUsingMedia(ctx, media.WorkspaceID, input.PathID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to fetch usage")
	}

	usage := make([]MediaUsageItem, 0, len(publications))
	for _, publication := range publications {
		content := publication.SourceText
		if strings.TrimSpace(content) == "" {
			content = publication.Title
		}
		if len(content) > 100 {
			content = content[:100] + "..."
		}
		scheduled := ""
		if !publication.ScheduledAt.IsZero() {
			scheduled = publication.ScheduledAt.Format(time.RFC3339)
		}
		usage = append(usage, MediaUsageItem{
			Kind:          "publication",
			ID:            publication.ID,
			Label:         content,
			PublicationID: publication.ID,
			Content:       content,
			Status:        publication.Status,
			Scheduled:     scheduled,
		})
	}
	otherUsage, err := h.nonPublicationMediaUsage(ctx, media.WorkspaceID, input.PathID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to fetch OpenPost Image Editor media usage")
	}
	usage = append(usage, otherUsage...)

	return &GetMediaUsageOutput{Body: struct {
		Usage []MediaUsageItem `json:"usage" doc:"Publications and reusable assets using this media"`
		Count int              `json:"count" doc:"Number of objects using this media"`
	}{Usage: usage, Count: len(usage)}}, nil
}

func (h *MediaHandler) deleteMedia(ctx context.Context, input *DeleteMediaInput) (*DeleteMediaOutput, error) {
	userID := middleware.GetUserID(ctx)

	var media models.MediaAttachment
	err := h.db.NewSelect().Model(&media).Where("id = ?", input.PathID).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound(errMediaNotFound)
		}
		return nil, huma.Error500InternalServerError("failed to fetch media")
	}

	if err := h.ensureMediaWorkspaceEditAccess(ctx, userID, media.WorkspaceID); err != nil {
		return nil, err
	}

	usage, err := h.mediaUsageSummary(ctx, media.WorkspaceID, input.PathID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to check usage")
	}
	if usage.Blocking > 0 {
		return nil, huma.Error400BadRequest("cannot delete media while it is used by a draft, design, template, or brand kit")
	}

	trashed, err := medialifecycle.NewService(h.db, h.storage).TrashManual(ctx, media.ID, media.WorkspaceID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to move media to Trash")
	}
	if !trashed {
		return nil, huma.Error400BadRequest("cannot delete media while it is used by active work")
	}

	return &DeleteMediaOutput{Body: struct {
		Message string `json:"message" doc:"Success message"`
	}{Message: "media moved to Trash"}}, nil
}

func (h *MediaHandler) restoreMedia(ctx context.Context, input *RestoreMediaInput) (*RestoreMediaOutput, error) {
	var media models.MediaAttachment
	if err := h.db.NewSelect().Model(&media).Where("id = ?", input.PathID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound(errMediaNotFound)
		}
		return nil, huma.Error500InternalServerError("failed to fetch media")
	}
	if err := h.ensureMediaWorkspaceEditAccess(ctx, middleware.GetUserID(ctx), media.WorkspaceID); err != nil {
		return nil, err
	}
	restored, err := medialifecycle.NewService(h.db, h.storage).Restore(ctx, media.ID, media.WorkspaceID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to restore media")
	}
	if !restored {
		return nil, huma.Error400BadRequest("media is not in Trash")
	}
	return &RestoreMediaOutput{Body: struct {
		Message string `json:"message" doc:"Success message"`
	}{Message: "media restored"}}, nil
}

func (h *MediaHandler) batchDeleteMedia(ctx context.Context, input *BatchDeleteMediaInput) (*BatchDeleteMediaOutput, error) {
	userID := middleware.GetUserID(ctx)

	if len(input.Body.MediaIDs) == 0 {
		return nil, huma.Error400BadRequest("media_ids is required")
	}

	if len(input.Body.MediaIDs) > 100 {
		return nil, huma.Error400BadRequest("max 100 media IDs at once")
	}

	deleted := 0
	failedIDs := []string{}

	for _, mediaID := range input.Body.MediaIDs {
		var media models.MediaAttachment
		err := h.db.NewSelect().Model(&media).Where("id = ?", mediaID).Scan(ctx)
		if err != nil {
			failedIDs = append(failedIDs, mediaID)
			continue
		}

		if err := h.ensureMediaWorkspaceEditAccess(ctx, userID, media.WorkspaceID); err != nil {
			failedIDs = append(failedIDs, mediaID)
			continue
		}
		if mediaBatchDeletionAlreadyComplete(media) {
			// Replays after a lost response are successful when the requested state already holds.
			deleted++
			continue
		}

		usage, err := h.mediaUsageSummary(ctx, media.WorkspaceID, mediaID)
		if err != nil || usage.Blocking > 0 {
			failedIDs = append(failedIDs, mediaID)
			continue
		}

		trashed, err := medialifecycle.NewService(h.db, h.storage).TrashManual(ctx, media.ID, media.WorkspaceID)
		if err != nil || !trashed {
			failedIDs = append(failedIDs, mediaID)
			continue
		}

		deleted++
	}

	return &BatchDeleteMediaOutput{Body: struct {
		Deleted   int      `json:"deleted" doc:"Number of media deleted"`
		FailedIDs []string `json:"failed_ids" doc:"IDs that could not be deleted (in use)"`
	}{Deleted: deleted, FailedIDs: failedIDs}}, nil
}

func (h *MediaHandler) updateMediaFavorite(ctx context.Context, input *UpdateMediaFavoriteInput) (*UpdateMediaFavoriteOutput, error) {
	userID := middleware.GetUserID(ctx)

	var media models.MediaAttachment
	err := h.db.NewSelect().Model(&media).Where("id = ?", input.PathID).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound(errMediaNotFound)
		}
		return nil, huma.Error500InternalServerError("failed to fetch media")
	}

	if err := h.ensureMediaWorkspaceEditAccess(ctx, userID, media.WorkspaceID); err != nil {
		return nil, err
	}

	media.IsFavorite = !media.IsFavorite
	query := h.db.NewUpdate().Model(&media).Column("is_favorite").Where("id = ?", input.PathID)
	if media.IsFavorite {
		media.RetentionClass = medialifecycle.RetentionLibrary
		query = query.Column("retention_class")
	}
	_, err = query.Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to update favorite status")
	}

	return &UpdateMediaFavoriteOutput{Body: struct {
		IsFavorite bool `json:"is_favorite" doc:"Updated favorite status"`
	}{IsFavorite: media.IsFavorite}}, nil
}

func (h *MediaHandler) updateMedia(ctx context.Context, input *UpdateMediaInput) (*UpdateMediaOutput, error) {
	userID := middleware.GetUserID(ctx)

	var media models.MediaAttachment
	err := h.db.NewSelect().Model(&media).Where("id = ?", input.PathID).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound(errMediaNotFound)
		}
		return nil, huma.Error500InternalServerError("failed to fetch media")
	}

	if err := h.ensureMediaWorkspaceEditAccess(ctx, userID, media.WorkspaceID); err != nil {
		return nil, err
	}

	columns := make([]string, 0, 2)
	if input.Body.AltText != nil {
		media.AltText = strings.TrimSpace(*input.Body.AltText)
		columns = append(columns, "alt_text")
	}
	if input.Body.OriginalFilename != nil {
		filename, filenameErr := normalizeMediaFilename(media.OriginalFilename, *input.Body.OriginalFilename)
		if filenameErr != nil {
			return nil, huma.Error400BadRequest(filenameErr.Error())
		}
		media.OriginalFilename = filename
		columns = append(columns, "original_filename")
	}
	if len(columns) == 0 {
		return nil, huma.Error400BadRequest("alt_text or original_filename is required")
	}
	_, err = h.db.NewUpdate().Model(&media).Column(columns...).Where("id = ?", input.PathID).Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to update media")
	}

	return &UpdateMediaOutput{Body: struct {
		Message string `json:"message" doc:"Success message"`
	}{Message: "media updated successfully"}}, nil
}

func (h *MediaHandler) retryMediaAnalysis(ctx context.Context, input *RetryMediaAnalysisInput) (*RetryMediaAnalysisOutput, error) {
	var media models.MediaAttachment
	if err := h.db.NewSelect().Model(&media).Where("id = ?", input.PathID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound(errMediaNotFound)
		}
		return nil, huma.Error500InternalServerError("failed to fetch media")
	}
	if err := h.ensureMediaWorkspaceEditAccess(ctx, middleware.GetUserID(ctx), media.WorkspaceID); err != nil {
		return nil, err
	}
	if !strings.HasPrefix(media.MimeType, "video/") {
		return nil, huma.Error400BadRequest("only video media can be analyzed")
	}
	if h.video == nil {
		return nil, huma.Error500InternalServerError("video processing is not configured")
	}
	if _, err := h.db.NewUpdate().
		Model((*models.MediaAttachment)(nil)).
		Set("processing_status = ?", mediaProcessingStatus).
		Set("processing_progress = 0").
		Set("analysis_status = ?", mediaanalysis.AnalysisStatusPending).
		Set("analysis_error = ''").
		Where("id = ?", media.ID).
		Exec(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to reset video analysis")
	}
	if err := h.video.EnqueueAnalysis(ctx, media.ID); err != nil {
		return nil, huma.Error500InternalServerError("failed to queue video analysis")
	}
	return &RetryMediaAnalysisOutput{Body: struct {
		MediaID          string `json:"media_id" doc:"Media ID"`
		ProcessingStatus string `json:"processing_status" doc:"Current processing status"`
		AnalysisStatus   string `json:"analysis_status" doc:"Current analysis status"`
	}{
		MediaID:          media.ID,
		ProcessingStatus: mediaProcessingStatus,
		AnalysisStatus:   mediaanalysis.AnalysisStatusPending,
	}}, nil
}

func (h *MediaHandler) resolveMediaUploadTag(ctx context.Context, workspaceID, requestedTagID, assetKind string) (string, error) {
	if defaultMediaAssetKind(assetKind) != "library" {
		return "", nil
	}
	tagID := strings.TrimSpace(requestedTagID)
	if tagID == "" {
		return "", nil
	}
	var tag models.MediaTag
	if err := h.db.NewSelect().Model(&tag).Column("id", "workspace_id").Where("id = ?", tagID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", huma.Error400BadRequest("media tag not found")
		}
		return "", huma.Error500InternalServerError("failed to load media tag")
	}
	if tag.WorkspaceID != workspaceID {
		return "", huma.Error400BadRequest("media tag must belong to this workspace")
	}
	return tag.ID, nil
}

func (h *MediaHandler) addMediaTag(ctx context.Context, tagID, mediaID string) error {
	return h.addMediaTagWithDB(ctx, h.db, tagID, mediaID)
}

func (h *MediaHandler) addMediaTagWithDB(ctx context.Context, db bun.IDB, tagID, mediaID string) error {
	if tagID == "" || mediaID == "" {
		return nil
	}
	assignment := &models.MediaTagAssignment{
		TagID:     tagID,
		MediaID:   mediaID,
		CreatedAt: time.Now().UTC(),
	}
	if _, err := db.NewInsert().Model(assignment).On("CONFLICT (tag_id, media_id) DO NOTHING").Exec(ctx); err != nil {
		return huma.Error500InternalServerError("failed to tag media")
	}
	if _, err := db.NewUpdate().Model((*models.MediaAttachment)(nil)).
		Set("retention_class = ?", medialifecycle.RetentionLibrary).
		Where("id = ?", mediaID).Exec(ctx); err != nil {
		return huma.Error500InternalServerError("failed to keep tagged media in the library")
	}
	return nil
}

func (h *MediaHandler) transferMediaTagAssignments(ctx context.Context, sourceMediaID, destinationMediaID string) error {
	if sourceMediaID == "" || destinationMediaID == "" || sourceMediaID == destinationMediaID {
		return nil
	}
	var assignments []models.MediaTagAssignment
	if err := h.db.NewSelect().Model(&assignments).Where("media_id = ?", sourceMediaID).Scan(ctx); err != nil {
		if isMissingOptionalMediaTable(err) {
			return nil
		}
		return huma.Error500InternalServerError("failed to load media tags")
	}
	for _, assignment := range assignments {
		if err := h.addMediaTag(ctx, assignment.TagID, destinationMediaID); err != nil {
			return err
		}
	}
	return nil
}

func uniqueMediaFilterValues(values ...string) []string {
	seen := make(map[string]struct{})
	result := make([]string, 0)
	for _, value := range values {
		for _, candidate := range strings.Split(value, ",") {
			candidate = strings.TrimSpace(candidate)
			if candidate == "" {
				continue
			}
			if _, exists := seen[candidate]; exists {
				continue
			}
			seen[candidate] = struct{}{}
			result = append(result, candidate)
		}
	}
	return result
}
