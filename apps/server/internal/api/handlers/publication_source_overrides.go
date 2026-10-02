package handlers

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/models"
	publicationservice "github.com/openpost/backend/internal/services/publications"
	"github.com/uptrace/bun"
)

func readRenditionSourceOverrides(value string) []publicationservice.RenditionSourceOverride {
	var sources []publicationservice.RenditionSourceOverride
	_ = json.Unmarshal([]byte(value), &sources)
	return sources
}

func refreshJoinedSourceMedia(ctx context.Context, db bun.IDB, segment *models.RenditionSegment, canonical []models.PublicationSegment) error {
	inputs := make([]PublicationSegmentInput, len(canonical))
	for i, source := range canonical {
		var rows []models.PublicationSegmentMedia
		if err := db.NewSelect().Model(&rows).Where("segment_id = ?", source.ID).Order("display_order ASC").Scan(ctx); err != nil {
			return err
		}
		inputs[i].ID = source.ID
		for _, row := range rows {
			var settings map[string]interface{}
			_ = json.Unmarshal([]byte(row.SettingsJSON), &settings)
			inputs[i].Media = append(inputs[i].Media, PublicationMediaInput{
				MediaID: row.MediaID, Role: row.Role, AltText: row.AltText,
				ThumbnailTimestampMS: row.ThumbnailTimestampMS, Settings: settings,
			})
		}
	}
	projected := projectJoinedSourceOverrides(RenditionSegmentInput{SourceOverrides: readRenditionSourceOverrides(segment.SourceOverridesJSON)}, canonical, inputs)
	if _, err := db.NewDelete().Model((*models.RenditionSegmentMedia)(nil)).Where("rendition_segment_id = ?", segment.ID).Exec(ctx); err != nil {
		return err
	}
	for order, media := range projected.Media {
		row := models.RenditionSegmentMedia{
			RenditionSegmentID: segment.ID, MediaID: media.MediaID,
			Role: publicationFirstNonEmpty(media.Role, "attachment"), DisplayOrder: order,
			AltText: media.AltText, ThumbnailTimestampMS: media.ThumbnailTimestampMS,
			SettingsJSON: mustJSON(media.Settings),
		}
		if _, err := db.NewInsert().Model(&row).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

// The legacy aggregate remains a projection of all destination output segments.
func refreshRenditionMediaProjection(ctx context.Context, db bun.IDB, renditionID string) error {
	var rows []models.RenditionSegmentMedia
	if err := db.NewSelect().Model(&rows).
		Join("JOIN rendition_segments AS segment ON segment.id = rendition_segment_media.rendition_segment_id").
		Where("segment.rendition_id = ?", renditionID).
		OrderExpr("segment.position ASC, rendition_segment_media.display_order ASC").Scan(ctx); err != nil {
		return err
	}
	if _, err := db.NewDelete().Model((*models.RenditionMedia)(nil)).Where("rendition_id = ?", renditionID).Exec(ctx); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, media := range rows {
		if seen[media.MediaID] {
			continue
		}
		row := models.RenditionMedia{
			RenditionID: renditionID, MediaID: media.MediaID, Role: media.Role,
			DisplayOrder: len(seen), AltText: media.AltText, ThumbnailTimestampMS: media.ThumbnailTimestampMS,
		}
		seen[media.MediaID] = true
		if _, err := db.NewInsert().Model(&row).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func normalizeJoinedSourceOverrides(input RenditionSegmentInput, canonical []models.PublicationSegment, canonicalInputs []PublicationSegmentInput) (RenditionSegmentInput, error) {
	if len(canonical) < 2 {
		return input, huma.Error400BadRequest("source overrides require a joined publication")
	}
	overrides := make(map[string]publicationservice.RenditionSourceOverride, len(input.SourceOverrides))
	for i, source := range input.SourceOverrides {
		matched := canonicalPublicationSegment(-1, source.PublicationSegmentID, canonical, canonicalInputs)
		if matched.ID == "" {
			return input, huma.Error400BadRequest("source override does not match a canonical publication segment")
		}
		if _, exists := overrides[matched.ID]; exists {
			return input, huma.Error400BadRequest("each joined source may appear only once")
		}
		source.PublicationSegmentID = matched.ID
		if source.MediaInherited {
			source.Media = nil
		}
		input.SourceOverrides[i] = source
		overrides[matched.ID] = source
	}
	return projectJoinedSourceOverrides(input, canonical, canonicalInputs), nil
}

func projectJoinedSourceOverrides(input RenditionSegmentInput, canonical []models.PublicationSegment, canonicalInputs []PublicationSegmentInput) RenditionSegmentInput {
	overrides := make(map[string]publicationservice.RenditionSourceOverride, len(input.SourceOverrides))
	for _, source := range input.SourceOverrides {
		overrides[source.PublicationSegmentID] = source
	}
	var bodies []string
	var media []PublicationMediaInput
	inherited := true
	for i, source := range canonical {
		body := source.Body
		override, found := overrides[source.ID]
		if found && override.BodyOverride != nil {
			body = *override.BodyOverride
		}
		if body = strings.TrimSpace(body); body != "" {
			bodies = append(bodies, body)
		}
		if found && !override.MediaInherited {
			inherited = false
			media = append(media, override.Media...)
		} else if i < len(canonicalInputs) {
			media = append(media, canonicalInputs[i].Media...)
		}
	}
	body := strings.Join(bodies, "\n\n")
	input.Body = body
	input.BodyOverride = &body
	input.Media = media
	input.MediaInherited = &inherited
	return input
}
