package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

type mediaUsageSummary struct {
	Total    int
	Blocking int
}

func (h *MediaHandler) mediaUsageSummary(ctx context.Context, workspaceID, mediaID string) (mediaUsageSummary, error) {
	summaries, err := h.mediaUsageSummaries(ctx, workspaceID, []string{mediaID})
	return summaries[mediaID], err
}

type mediaPublicationUsageRow struct {
	MediaID string `bun:"media_id"`
	Status  string `bun:"status"`
	Count   int    `bun:"usage_count"`
}

type mediaOrganizationRow struct {
	MediaID string `bun:"media_id"`
	ID      string `bun:"id"`
}

func (h *MediaHandler) mediaTagsByMedia(ctx context.Context, mediaIDs []string) (map[string][]string, error) {
	tags := make(map[string][]string, len(mediaIDs))
	for _, mediaID := range mediaIDs {
		tags[mediaID] = []string{}
	}
	if len(mediaIDs) == 0 {
		return tags, nil
	}
	var rows []mediaOrganizationRow
	if err := h.db.NewSelect().
		TableExpr("media_tag_assignments AS a").
		ColumnExpr("a.media_id").
		ColumnExpr("a.tag_id AS id").
		Where("a.media_id IN (?)", bun.List(mediaIDs)).
		Scan(ctx, &rows); err != nil && !isMissingOptionalMediaTable(err) {
		return nil, err
	}
	for _, row := range rows {
		tags[row.MediaID] = append(tags[row.MediaID], row.ID)
	}
	return tags, nil
}

//nolint:gocyclo // Usage aggregation intentionally checks every independent reference surface.
func (h *MediaHandler) mediaUsageSummaries(ctx context.Context, workspaceID string, mediaIDs []string) (map[string]mediaUsageSummary, error) {
	summaries := make(map[string]mediaUsageSummary, len(mediaIDs))
	for _, mediaID := range mediaIDs {
		summaries[mediaID] = mediaUsageSummary{}
	}
	if len(mediaIDs) == 0 {
		return summaries, nil
	}
	// Count distinct posts in SQL without transferring every reference. Group by
	// stored status so the existing Unicode-aware status normalization still applies.
	var publicationRows []mediaPublicationUsageRow
	err := h.db.NewRaw(`
		SELECT reference.media_id, publication.status, COUNT(*) AS usage_count
		FROM (
			SELECT asset.media_id, asset.publication_id
			FROM publication_assets asset
			WHERE asset.media_id IN (?)
			UNION
			SELECT segment_media.media_id, segment.publication_id
			FROM publication_segment_media segment_media
			JOIN publication_segments segment ON segment.id = segment_media.segment_id
			WHERE segment_media.media_id IN (?)
			UNION
			SELECT rendition_media.media_id, rendition.publication_id
			FROM rendition_media
			JOIN renditions rendition ON rendition.id = rendition_media.rendition_id
			WHERE rendition_media.media_id IN (?)
			UNION
			SELECT segment_media.media_id, rendition.publication_id
			FROM rendition_segment_media segment_media
			JOIN rendition_segments segment ON segment.id = segment_media.rendition_segment_id
			JOIN renditions rendition ON rendition.id = segment.rendition_id
			WHERE segment_media.media_id IN (?)
		) AS reference
		JOIN publications publication ON publication.id = reference.publication_id
		WHERE publication.workspace_id = ?
		GROUP BY reference.media_id, publication.status`,
		bun.List(mediaIDs), bun.List(mediaIDs), bun.List(mediaIDs), bun.List(mediaIDs), workspaceID,
	).Scan(ctx, &publicationRows)
	if err != nil {
		return nil, err
	}
	for _, row := range publicationRows {
		summary := summaries[row.MediaID]
		summary.Total += row.Count
		if mediaUsageStatusBlocks(row.Status) {
			summary.Blocking += row.Count
		}
		summaries[row.MediaID] = summary
	}

	blockingQueries := []string{
		`SELECT media_id, COUNT(*) AS usage_count FROM screenshot_template_media_references WHERE media_id IN (?) GROUP BY media_id`,
		`SELECT media_id, COUNT(*) AS usage_count FROM screenshot_template_recipe_media_references WHERE media_id IN (?) GROUP BY media_id`,
		`SELECT r.media_id, COUNT(*) AS usage_count
			FROM design_media_references r
			JOIN design_documents d ON d.id = r.design_document_id
			WHERE r.media_id IN (?) AND d.deleted_at IS NULL
			GROUP BY r.media_id`,
		`SELECT r.media_id, COUNT(*) AS usage_count
			FROM design_revision_media_references r
			JOIN design_revisions v ON v.id = r.revision_id
			JOIN design_documents d ON d.id = v.design_document_id
			WHERE r.media_id IN (?) AND d.deleted_at IS NULL
			GROUP BY r.media_id`,
		`SELECT r.media_id, COUNT(*) AS usage_count
			FROM design_template_media_references r
			WHERE r.media_id IN (?) GROUP BY r.media_id`,
		`SELECT media_id, COUNT(*) AS usage_count FROM brand_fonts
			WHERE media_id IN (?) GROUP BY media_id`,
	}
	for _, query := range blockingQueries {
		var rows []struct {
			MediaID string `bun:"media_id"`
			Count   int    `bun:"usage_count"`
		}
		if err := h.db.NewRaw(query, bun.List(mediaIDs)).Scan(ctx, &rows); err != nil && !isMissingOptionalMediaTable(err) {
			return nil, err
		}
		for _, row := range rows {
			summary := summaries[row.MediaID]
			summary.Total += row.Count
			summary.Blocking += row.Count
			summaries[row.MediaID] = summary
		}
	}
	directReferenceQueries := []string{
		`SELECT cover_preview_media_id AS media_id, COUNT(*) AS usage_count
			FROM design_documents WHERE cover_preview_media_id IN (?) AND deleted_at IS NULL
			GROUP BY cover_preview_media_id`,
		`SELECT p.preview_media_id AS media_id, COUNT(*) AS usage_count
			FROM design_pages p JOIN design_documents d ON d.id = p.design_document_id
			WHERE p.preview_media_id IN (?) AND d.deleted_at IS NULL GROUP BY p.preview_media_id`,
		`SELECT p.latest_export_media_id AS media_id, COUNT(*) AS usage_count
			FROM design_pages p JOIN design_documents d ON d.id = p.design_document_id
			WHERE p.latest_export_media_id IN (?) AND d.deleted_at IS NULL GROUP BY p.latest_export_media_id`,
		`SELECT preview_media_id AS media_id, COUNT(*) AS usage_count
			FROM design_templates WHERE preview_media_id IN (?) GROUP BY preview_media_id`,
	}
	for _, query := range directReferenceQueries {
		var rows []struct {
			MediaID string `bun:"media_id"`
			Count   int    `bun:"usage_count"`
		}
		if err := h.db.NewRaw(query, bun.List(mediaIDs)).Scan(ctx, &rows); err != nil && !isMissingOptionalMediaTable(err) {
			return nil, err
		}
		for _, row := range rows {
			summary := summaries[row.MediaID]
			summary.Total += row.Count
			summary.Blocking += row.Count
			summaries[row.MediaID] = summary
		}
	}

	return summaries, nil
}

func mediaUsageStatusBlocks(status string) bool {
	status = strings.ToLower(strings.TrimSpace(status))
	return status != models.PublicationStatusPublished && status != models.PublicationStatusFailed
}

func isMissingOptionalMediaTable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table:") ||
		strings.Contains(message, "does not exist")
}

func (h *MediaHandler) publicationsUsingMedia(ctx context.Context, workspaceID, mediaID string) ([]models.Publication, error) {
	var publications []models.Publication
	err := h.db.NewSelect().
		Model(&publications).
		ModelTableExpr("publications AS publication").
		Join(`JOIN (
			SELECT asset.publication_id
			FROM publication_assets asset
			WHERE asset.media_id = ?
			UNION
			SELECT segment.publication_id
			FROM publication_segment_media segment_media
			JOIN publication_segments segment ON segment.id = segment_media.segment_id
			WHERE segment_media.media_id = ?
			UNION
			SELECT rendition.publication_id
			FROM rendition_media rendition_media_item
			JOIN renditions rendition ON rendition.id = rendition_media_item.rendition_id
			WHERE rendition_media_item.media_id = ?
			UNION
			SELECT rendition.publication_id
			FROM rendition_segment_media segment_media
			JOIN rendition_segments segment ON segment.id = segment_media.rendition_segment_id
			JOIN renditions rendition ON rendition.id = segment.rendition_id
			WHERE segment_media.media_id = ?
		) AS reference ON reference.publication_id = publication.id`, mediaID, mediaID, mediaID, mediaID).
		Where("publication.workspace_id = ?", workspaceID).
		Order("publication.updated_at DESC", "publication.id ASC").
		Scan(ctx)
	return publications, err
}

//nolint:gocyclo // Each usage type has distinct labels and destination metadata.
func (h *MediaHandler) nonPublicationMediaUsage(ctx context.Context, workspaceID, mediaID string) ([]MediaUsageItem, error) {
	usage := []MediaUsageItem{}
	var screenshots []struct {
		ID    string
		Title string
		Kind  string
	}
	if err := h.db.NewRaw(`SELECT d.id, d.title, 'screenshot_template' AS kind
 FROM screenshot_template_media_references r JOIN screenshot_template_designs d ON d.id = r.design_id
 WHERE r.media_id = ? AND d.workspace_id = ?
 UNION ALL SELECT recipe.media_id AS id, recipe.template_name AS title, 'screenshot_template_export' AS kind
 FROM screenshot_template_recipe_media_references r JOIN media_generation_recipes recipe ON recipe.media_id = r.export_media_id
 WHERE r.media_id = ? AND recipe.workspace_id = ?`, mediaID, workspaceID, mediaID, workspaceID).Scan(ctx, &screenshots); err != nil && !isMissingOptionalMediaTable(err) {
		return nil, err
	}
	for _, item := range screenshots {
		usage = append(usage, MediaUsageItem{Kind: item.Kind, ID: item.ID, Label: item.Title, Status: "editable"})
	}

	var designs []struct {
		ID    string `bun:"id"`
		Title string `bun:"title"`
	}
	if err := h.db.NewSelect().
		TableExpr("design_media_references AS r").
		ColumnExpr("DISTINCT d.id").
		ColumnExpr("d.title").
		Join("JOIN design_documents AS d ON d.id = r.design_document_id").
		Where("r.media_id = ? AND d.workspace_id = ? AND d.deleted_at IS NULL", mediaID, workspaceID).
		Scan(ctx, &designs); err != nil {
		return nil, err
	}
	for _, design := range designs {
		usage = append(usage, MediaUsageItem{Kind: "design", ID: design.ID, Label: design.Title, Status: "editable"})
	}
	var versionDesigns []struct {
		ID    string `bun:"id"`
		Title string `bun:"title"`
	}
	if err := h.db.NewSelect().
		TableExpr("design_revision_media_references AS reference").
		ColumnExpr("DISTINCT document.id").
		ColumnExpr("document.title").
		Join("JOIN design_revisions AS revision ON revision.id = reference.revision_id").
		Join("JOIN design_documents AS document ON document.id = revision.design_document_id").
		Where("reference.media_id = ? AND document.workspace_id = ? AND document.deleted_at IS NULL", mediaID, workspaceID).
		Scan(ctx, &versionDesigns); err != nil {
		return nil, err
	}
	for _, design := range versionDesigns {
		usage = append(usage, MediaUsageItem{
			Kind: "design_version", ID: design.ID, Label: design.Title, Status: "recovery version",
		})
	}
	var previewDesigns []struct {
		ID    string `bun:"id"`
		Title string `bun:"title"`
	}
	if err := h.db.NewSelect().
		TableExpr("design_documents AS d").
		ColumnExpr("d.id, d.title").
		Where("d.cover_preview_media_id = ? AND d.workspace_id = ? AND d.deleted_at IS NULL", mediaID, workspaceID).
		Scan(ctx, &previewDesigns); err != nil {
		return nil, err
	}
	for _, design := range previewDesigns {
		usage = append(usage, MediaUsageItem{Kind: "design_preview", ID: design.ID, Label: design.Title})
	}
	var designPages []struct {
		ID       string `bun:"id"`
		Name     string `bun:"name"`
		DesignID string `bun:"design_id"`
		Title    string `bun:"title"`
	}
	if err := h.db.NewSelect().
		TableExpr("design_pages AS page").
		ColumnExpr("page.id, page.name, document.id AS design_id, document.title").
		Join("JOIN design_documents AS document ON document.id = page.design_document_id").
		Where("document.workspace_id = ? AND document.deleted_at IS NULL", workspaceID).
		Where("(page.preview_media_id = ? OR page.latest_export_media_id = ?)", mediaID, mediaID).
		Scan(ctx, &designPages); err != nil {
		return nil, err
	}
	for _, page := range designPages {
		usage = append(usage, MediaUsageItem{
			Kind:  "design_page_export",
			ID:    page.ID,
			Label: page.Title + " · " + page.Name,
		})
	}

	var templates []struct {
		ID   string `bun:"id"`
		Name string `bun:"name"`
	}
	if err := h.db.NewSelect().
		TableExpr("design_template_media_references AS r").
		ColumnExpr("DISTINCT t.id").
		ColumnExpr("t.name").
		Join("JOIN design_templates AS t ON t.id = r.design_template_id").
		Where("r.media_id = ? AND t.workspace_id = ?", mediaID, workspaceID).
		Scan(ctx, &templates); err != nil {
		return nil, err
	}
	for _, template := range templates {
		usage = append(usage, MediaUsageItem{Kind: "template", ID: template.ID, Label: template.Name})
	}
	var templatePreviews []struct {
		ID   string `bun:"id"`
		Name string `bun:"name"`
	}
	if err := h.db.NewSelect().
		TableExpr("design_templates AS template").
		ColumnExpr("template.id, template.name").
		Where("template.preview_media_id = ? AND template.workspace_id = ?", mediaID, workspaceID).
		Scan(ctx, &templatePreviews); err != nil {
		return nil, err
	}
	for _, template := range templatePreviews {
		usage = append(usage, MediaUsageItem{
			Kind:  "template_preview",
			ID:    template.ID,
			Label: template.Name,
		})
	}

	var brandFonts []struct {
		ID     string `bun:"id"`
		Family string `bun:"family"`
	}
	if err := h.db.NewSelect().
		TableExpr("brand_fonts AS f").
		ColumnExpr("f.id, f.family").
		Join("JOIN brand_kits AS k ON k.id = f.brand_kit_id").
		Where("f.media_id = ? AND k.workspace_id = ?", mediaID, workspaceID).
		Scan(ctx, &brandFonts); err != nil {
		return nil, err
	}
	for _, font := range brandFonts {
		usage = append(usage, MediaUsageItem{Kind: "brand_font", ID: font.ID, Label: font.Family})
	}
	return usage, nil
}

func (h *MediaHandler) mediaMetadata(c echo.Context) error {
	userID := c.Get(string(middleware.UserIDKey)).(string)

	workspaceID := c.QueryParam("workspace_id")
	if workspaceID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: errWorkspaceIDRequired})
	}

	mediaIDsRaw := c.QueryParam("media_ids")
	if mediaIDsRaw == "" {
		return c.JSON(http.StatusOK, map[string]interface{}{"media": []MediaMetadataItem{}})
	}

	mediaIDs := strings.Split(mediaIDsRaw, ",")
	for i := range mediaIDs {
		mediaIDs[i] = strings.TrimSpace(mediaIDs[i])
		if mediaIDs[i] == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "media_ids must not contain empty values"})
		}
	}

	if ok, err := h.userCanAccessWorkspace(c.Request().Context(), workspaceID, userID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to validate workspace access"})
	} else if !ok {
		return c.JSON(http.StatusForbidden, map[string]string{fieldError: errWorkspaceAccessDenied})
	}

	var media []models.MediaAttachment
	if err := h.db.NewSelect().Model(&media).
		Where("workspace_id = ? AND id IN (?)", workspaceID, bun.List(mediaIDs)).
		Scan(c.Request().Context()); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to fetch media"})
	}

	result := make([]MediaMetadataItem, 0, len(media))
	for _, m := range media {
		item := MediaMetadataItem{
			Source:             m.Source,
			ParentMediaID:      m.ParentMediaID,
			OriginalFilename:   m.OriginalFilename,
			ID:                 m.ID,
			MimeType:           m.MimeType,
			AltText:            m.AltText,
			Size:               m.Size,
			Width:              m.Width,
			Height:             m.Height,
			URL:                "/media/" + m.ID,
			DurationMS:         m.DurationMS,
			FrameRate:          m.FrameRate,
			ContainerFormat:    m.ContainerFormat,
			VideoCodec:         m.VideoCodec,
			AudioCodec:         m.AudioCodec,
			ProcessingStatus:   m.ProcessingStatus,
			ProcessingProgress: m.ProcessingProgress,
			PosterThumbnailURL: mediaPosterURL(m),
			AnalysisStatus:     m.AnalysisStatus,
			AnalysisError:      m.AnalysisError,
			PublicURLCheckedAt: formatMediaTime(m.PublicURLCheckedAt),
			PublicURLStatus:    m.PublicURLStatus,
			PublicURLError:     m.PublicURLError,
			IsDeleted:          !m.TrashedAt.IsZero(),
		}
		if item.IsDeleted {
			item.URL = ""
			item.Thumbnail = ""
			item.PosterThumbnailURL = ""
		}
		if thumbsJSON := m.ThumbnailsJSON; thumbsJSON != "" {
			var thumbs Thumbnails
			if json.Unmarshal([]byte(thumbsJSON), &thumbs) == nil && thumbs.SM != "" {
				item.Thumbnail = "/media/" + m.ID + "/thumb/sm"
			}
		}
		if item.Thumbnail == "" && item.PosterThumbnailURL != "" {
			item.Thumbnail = item.PosterThumbnailURL
		}
		result = append(result, item)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"media": result})
}
