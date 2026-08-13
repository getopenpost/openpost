package handlers

import (
	"context"
	"encoding/json"
	"sort"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/uptrace/bun"
)

type publicationSegmentMediaRow struct {
	PublicationID string `bun:"publication_id"`
	SegmentID     string `bun:"segment_id"`
	DisplayOrder  int    `bun:"display_order"`
	SettingsJSON  string `bun:"settings_json"`
	models.MediaAttachment
}

type renditionMediaListRow struct {
	PublicationID        string `bun:"publication_id"`
	RenditionID          string `bun:"rendition_id"`
	Role                 string `bun:"role"`
	DisplayOrder         int    `bun:"display_order"`
	AltText              string `bun:"alt_text"`
	ThumbnailTimestampMS int    `bun:"thumbnail_timestamp_ms"`
	models.MediaAttachment
}

type renditionSegmentMediaListRow struct {
	RenditionSegmentID   string `bun:"rendition_segment_id"`
	Role                 string `bun:"role"`
	DisplayOrder         int    `bun:"display_order"`
	AltText              string `bun:"alt_text"`
	ThumbnailTimestampMS int    `bun:"thumbnail_timestamp_ms"`
	SettingsJSON         string `bun:"settings_json"`
	models.MediaAttachment
}

// loadPublicationResponses loads complete publication shapes with a fixed
// number of queries. The detail loader performs its access check first, then
// reuses this batch path with one publication to avoid per-rendition queries.
func (h *PublicationHandler) loadPublicationResponses(
	ctx context.Context,
	publications []models.Publication,
) ([]PublicationResponse, error) {
	if len(publications) == 0 {
		return []PublicationResponse{}, nil
	}

	publicationIDs := make([]string, 0, len(publications))
	for _, publication := range publications {
		publicationIDs = append(publicationIDs, publication.ID)
	}

	segmentsByPublication, mediaBySegment, err := h.loadPublicationListSegments(ctx, publicationIDs)
	if err != nil {
		return nil, err
	}
	renditionsByPublication, mediaByRendition, publicationMedia, err :=
		h.loadPublicationListRenditions(ctx, publicationIDs)
	if err != nil {
		return nil, err
	}
	deliveryByRendition, err := providerwrite.LoadCurrentDeliveries(ctx, h.db, publicationIDs)
	if err != nil {
		return nil, err
	}
	linkedPostByPublication, err := h.loadPublicationListLinkedPosts(ctx, publicationIDs)
	if err != nil {
		return nil, err
	}
	segmentsByRendition, mediaByRenditionSegment, err :=
		h.loadPublicationListRenditionSegments(ctx, publicationIDs)
	if err != nil {
		return nil, err
	}

	body := make([]PublicationResponse, 0, len(publications))
	for index := range publications {
		publication := &publications[index]
		response := publicationResponse(publication, publicationMedia[publication.ID])
		response.TextPostID = linkedPostByPublication[publication.ID]
		response.Segments = publicationSegmentResponses(
			*publication,
			segmentsByPublication[publication.ID],
			mediaBySegment,
			response.Media,
		)
		if len(response.Media) == 0 && len(response.Segments) > 0 {
			response.Media = response.Segments[0].Media
		}
		response.Renditions = make([]RenditionResponse, 0, len(renditionsByPublication[publication.ID]))
		for _, rendition := range renditionsByPublication[publication.ID] {
			output := renditionResponse(rendition, mediaByRendition[rendition.ID])
			if delivery, ok := deliveryByRendition[rendition.ID]; ok {
				output.Delivery = providerDeliveryResponse(delivery)
			}
			output.Segments = renditionSegmentResponses(
				rendition,
				segmentsByRendition[rendition.ID],
				mediaByRenditionSegment,
			)
			response.Renditions = append(response.Renditions, output)
		}
		body = append(body, response)
	}
	return body, nil
}

func (h *PublicationHandler) loadPublicationListSegments(
	ctx context.Context,
	publicationIDs []string,
) (map[string][]models.PublicationSegment, map[string][]MediaSummary, error) {
	segmentsByPublication := make(map[string][]models.PublicationSegment, len(publicationIDs))
	mediaBySegment := map[string][]MediaSummary{}

	var segments []models.PublicationSegment
	if err := h.db.NewSelect().
		Model(&segments).
		Where("publication_id IN (?)", bun.List(publicationIDs)).
		Order("publication_id ASC", "position ASC").
		Scan(ctx); err != nil {
		if isMissingPublicationSegmentTable(err) {
			return segmentsByPublication, mediaBySegment, nil
		}
		return nil, nil, huma.Error500InternalServerError("failed to load publication segments")
	}
	for _, segment := range segments {
		segmentsByPublication[segment.PublicationID] = append(
			segmentsByPublication[segment.PublicationID],
			segment,
		)
	}
	if len(segments) == 0 {
		return segmentsByPublication, mediaBySegment, nil
	}

	var mediaRows []publicationSegmentMediaRow
	if err := h.db.NewSelect().
		TableExpr("publication_segment_media AS psm").
		ColumnExpr("ps.publication_id, psm.segment_id, psm.display_order, psm.settings_json").
		ColumnExpr("m.*").
		Join("JOIN publication_segments AS ps ON ps.id = psm.segment_id").
		Join("JOIN media_attachments AS m ON m.id = psm.media_id").
		Where("ps.publication_id IN (?)", bun.List(publicationIDs)).
		Order("ps.publication_id ASC", "ps.position ASC", "psm.display_order ASC").
		Scan(ctx, &mediaRows); err != nil {
		if isMissingPublicationSegmentTable(err) {
			return segmentsByPublication, mediaBySegment, nil
		}
		return nil, nil, huma.Error500InternalServerError("failed to load publication segment media")
	}
	for _, row := range mediaRows {
		item := mediaSummary(row.MediaAttachment, "attachment", row.DisplayOrder, "", 0)
		_ = json.Unmarshal([]byte(row.SettingsJSON), &item.Settings)
		mediaBySegment[row.SegmentID] = append(mediaBySegment[row.SegmentID], item)
	}
	return segmentsByPublication, mediaBySegment, nil
}

func (h *PublicationHandler) loadPublicationListRenditions(
	ctx context.Context,
	publicationIDs []string,
) (
	map[string][]models.Rendition,
	map[string][]MediaSummary,
	map[string][]MediaSummary,
	error,
) {
	renditionsByPublication := make(map[string][]models.Rendition, len(publicationIDs))
	mediaByRendition := map[string][]MediaSummary{}
	publicationMedia := map[string][]MediaSummary{}

	var renditions []models.Rendition
	if err := h.db.NewSelect().
		Model(&renditions).
		Where("publication_id IN (?)", bun.List(publicationIDs)).
		Order("publication_id ASC", "created_at ASC").
		Scan(ctx); err != nil {
		return nil, nil, nil, huma.Error500InternalServerError("failed to load renditions")
	}
	for _, rendition := range renditions {
		renditionsByPublication[rendition.PublicationID] = append(
			renditionsByPublication[rendition.PublicationID],
			rendition,
		)
	}
	if len(renditions) == 0 {
		return renditionsByPublication, mediaByRendition, publicationMedia, nil
	}

	var mediaRows []renditionMediaListRow
	if err := h.db.NewSelect().
		TableExpr("rendition_media AS rm").
		ColumnExpr("r.publication_id, rm.rendition_id, rm.role, rm.display_order, rm.alt_text, rm.thumbnail_timestamp_ms").
		ColumnExpr("m.*").
		Join("JOIN renditions AS r ON r.id = rm.rendition_id").
		Join("JOIN media_attachments AS m ON m.id = rm.media_id").
		Where("r.publication_id IN (?)", bun.List(publicationIDs)).
		Order("r.publication_id ASC", "rm.rendition_id ASC", "rm.display_order ASC").
		Scan(ctx, &mediaRows); err != nil {
		if isMissingPublicationSegmentTable(err) {
			return renditionsByPublication, mediaByRendition, publicationMedia, nil
		}
		return nil, nil, nil, huma.Error500InternalServerError("failed to load rendition media")
	}
	seenPublicationMedia := make(map[string]map[string]struct{}, len(publicationIDs))
	for _, row := range mediaRows {
		item := mediaSummary(
			row.MediaAttachment,
			row.Role,
			row.DisplayOrder,
			row.AltText,
			row.ThumbnailTimestampMS,
		)
		mediaByRendition[row.RenditionID] = append(mediaByRendition[row.RenditionID], item)
		seen := seenPublicationMedia[row.PublicationID]
		if seen == nil {
			seen = map[string]struct{}{}
			seenPublicationMedia[row.PublicationID] = seen
		}
		if _, exists := seen[item.ID]; exists {
			continue
		}
		seen[item.ID] = struct{}{}
		publicationMedia[row.PublicationID] = append(publicationMedia[row.PublicationID], item)
	}
	for publicationID := range publicationMedia {
		sort.Slice(publicationMedia[publicationID], func(i, j int) bool {
			return publicationMedia[publicationID][i].DisplayOrder <
				publicationMedia[publicationID][j].DisplayOrder
		})
	}
	return renditionsByPublication, mediaByRendition, publicationMedia, nil
}

func (h *PublicationHandler) loadPublicationListLinkedPosts(
	ctx context.Context,
	publicationIDs []string,
) (map[string]string, error) {
	linkedPostByPublication := map[string]string{}
	var posts []models.Post
	if err := h.db.NewSelect().
		Model(&posts).
		Column("id", "publication_id", "thread_sequence", "created_at").
		Where("publication_id IN (?)", bun.List(publicationIDs)).
		Order("publication_id ASC", "thread_sequence ASC", "created_at ASC").
		Scan(ctx); err != nil {
		if isMissingLegacyPostsTable(err) {
			return linkedPostByPublication, nil
		}
		return nil, huma.Error500InternalServerError("failed to load linked text posts")
	}
	for _, post := range posts {
		if _, exists := linkedPostByPublication[post.PublicationID]; !exists {
			linkedPostByPublication[post.PublicationID] = post.ID
		}
	}
	return linkedPostByPublication, nil
}

func (h *PublicationHandler) loadPublicationListRenditionSegments(
	ctx context.Context,
	publicationIDs []string,
) (
	map[string][]models.RenditionSegment,
	map[string][]MediaSummary,
	error,
) {
	segmentsByRendition := map[string][]models.RenditionSegment{}
	mediaBySegment := map[string][]MediaSummary{}

	var segments []models.RenditionSegment
	if err := h.db.NewSelect().
		Model(&segments).
		Join("JOIN renditions AS r ON r.id = rendition_segment.rendition_id").
		Where("r.publication_id IN (?)", bun.List(publicationIDs)).
		Order("rendition_segment.rendition_id ASC", "rendition_segment.position ASC").
		Scan(ctx); err != nil {
		if isMissingPublicationSegmentTable(err) {
			return segmentsByRendition, mediaBySegment, nil
		}
		return nil, nil, huma.Error500InternalServerError("failed to load rendition segments")
	}
	for _, segment := range segments {
		segmentsByRendition[segment.RenditionID] = append(
			segmentsByRendition[segment.RenditionID],
			segment,
		)
	}
	if len(segments) == 0 {
		return segmentsByRendition, mediaBySegment, nil
	}

	var mediaRows []renditionSegmentMediaListRow
	if err := h.db.NewSelect().
		TableExpr("rendition_segment_media AS rsm").
		ColumnExpr("rsm.rendition_segment_id, rsm.role, rsm.display_order, rsm.alt_text, rsm.thumbnail_timestamp_ms, rsm.settings_json").
		ColumnExpr("m.*").
		Join("JOIN rendition_segments AS rs ON rs.id = rsm.rendition_segment_id").
		Join("JOIN renditions AS r ON r.id = rs.rendition_id").
		Join("JOIN media_attachments AS m ON m.id = rsm.media_id").
		Where("r.publication_id IN (?)", bun.List(publicationIDs)).
		Order("rsm.rendition_segment_id ASC", "rsm.display_order ASC").
		Scan(ctx, &mediaRows); err != nil {
		return nil, nil, huma.Error500InternalServerError("failed to load rendition segment media")
	}
	for _, row := range mediaRows {
		item := mediaSummary(
			row.MediaAttachment,
			row.Role,
			row.DisplayOrder,
			row.AltText,
			row.ThumbnailTimestampMS,
		)
		_ = json.Unmarshal([]byte(row.SettingsJSON), &item.Settings)
		mediaBySegment[row.RenditionSegmentID] = append(
			mediaBySegment[row.RenditionSegmentID],
			item,
		)
	}
	return segmentsByRendition, mediaBySegment, nil
}

func publicationSegmentResponses(
	publication models.Publication,
	segments []models.PublicationSegment,
	mediaBySegment map[string][]MediaSummary,
	legacyMedia []MediaSummary,
) []PublicationSegmentResponse {
	if len(segments) == 0 {
		return []PublicationSegmentResponse{{
			ID:       "legacy:" + publication.ID,
			Position: 0,
			Body:     publication.SourceText,
			Title:    publication.Title,
			URL:      publication.SourceURL,
			Settings: map[string]interface{}{},
			Media:    legacyMedia,
		}}
	}
	out := make([]PublicationSegmentResponse, 0, len(segments))
	for _, segment := range segments {
		settings := map[string]interface{}{}
		_ = json.Unmarshal([]byte(segment.SettingsJSON), &settings)
		out = append(out, PublicationSegmentResponse{
			ID:          segment.ID,
			Position:    segment.Position,
			Body:        segment.Body,
			Title:       segment.Title,
			Description: segment.Description,
			URL:         segment.URL,
			Settings:    settings,
			Media:       mediaBySegment[segment.ID],
		})
	}
	return out
}

func renditionSegmentResponses(
	rendition models.Rendition,
	segments []models.RenditionSegment,
	mediaBySegment map[string][]MediaSummary,
) []RenditionSegmentResponse {
	if len(segments) == 0 {
		return []RenditionSegmentResponse{{
			ID:                   "legacy:" + rendition.ID,
			PublicationSegmentID: "legacy:" + rendition.PublicationID,
			Position:             0,
			Body:                 rendition.Body,
			Title:                rendition.Title,
			Description:          rendition.Description,
			MediaInherited:       true,
			Settings:             map[string]interface{}{},
			Status:               rendition.Status,
			ExternalID:           rendition.ExternalID,
			ExternalURL:          rendition.ExternalURL,
			ErrorMessage:         rendition.ErrorMessage,
			ErrorKind:            rendition.ErrorKind,
			ErrorCode:            rendition.ErrorCode,
			ErrorHTTPStatus:      rendition.ErrorHTTPStatus,
			ErrorRetryable:       rendition.ErrorRetryable,
			ErrorRetryAt:         formatOptionalTime(rendition.ErrorRetryAt),
			ErrorAction:          rendition.ErrorAction,
		}}
	}
	out := make([]RenditionSegmentResponse, 0, len(segments))
	for _, segment := range segments {
		settings := map[string]interface{}{}
		_ = json.Unmarshal([]byte(segment.SettingsJSON), &settings)
		out = append(out, RenditionSegmentResponse{
			ID:                   segment.ID,
			PublicationSegmentID: segment.PublicationSegmentID,
			Position:             segment.Position,
			Body:                 segment.Body,
			Title:                segment.Title,
			Description:          segment.Description,
			URL:                  segment.URL,
			BodyOverride:         segment.BodyOverride,
			TitleOverride:        segment.TitleOverride,
			DescriptionOverride:  segment.DescriptionOverride,
			URLOverride:          segment.URLOverride,
			MediaInherited:       segment.MediaInherited,
			Settings:             settings,
			Status:               segment.Status,
			ExternalID:           segment.ExternalID,
			ExternalURL:          segment.ExternalURL,
			ErrorMessage:         segment.ErrorMessage,
			ErrorKind:            segment.ErrorKind,
			ErrorCode:            segment.ErrorCode,
			ErrorHTTPStatus:      segment.ErrorHTTPStatus,
			ErrorRetryable:       segment.ErrorRetryable,
			ErrorRetryAt:         formatOptionalTime(segment.ErrorRetryAt),
			ErrorAction:          segment.ErrorAction,
			Media:                mediaBySegment[segment.ID],
		})
	}
	return out
}
