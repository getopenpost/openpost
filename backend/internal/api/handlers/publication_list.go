package handlers

import (
	"context"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const publicationCalendarOccurrenceSQL = `CASE
	WHEN publication.status = 'published' THEN COALESCE(publication.actual_run_at, publication.scheduled_at, publication.updated_at, publication.created_at)
	ELSE publication.scheduled_at
END`

type publicationListRange struct {
	createdFrom    time.Time
	createdBefore  time.Time
	calendarFrom   time.Time
	calendarBefore time.Time
}

func (h *PublicationHandler) listPublicationsPage(ctx context.Context, input *ListPublicationsInput) (*PublicationListOutput, error) {
	limit, pageCursor, ranges, err := validatePublicationListInput(input)
	if err != nil {
		return nil, err
	}

	total, err := publicationListQuery(h.db, (*models.Publication)(nil), input, ranges).Count(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to count publications")
	}

	var publications []models.Publication
	query := publicationListQuery(h.db, &publications, input, ranges)
	calendarRange := !ranges.calendarFrom.IsZero()
	if calendarRange {
		query = query.OrderExpr(publicationCalendarOccurrenceSQL + " ASC").Order("publication.id ASC")
	} else {
		query = query.Order("publication.created_at DESC", "publication.id DESC")
		if pageCursor != nil {
			query = query.Where(
				"(publication.created_at < ? OR (publication.created_at = ? AND publication.id < ?))",
				pageCursor.Timestamp,
				pageCursor.Timestamp,
				pageCursor.ID,
			)
		}
	}
	if input.Cursor == "" {
		query = query.Offset(input.Offset)
	}
	scanLimit := limit
	if input.Cursor != "" {
		scanLimit++
	}
	if err := query.Limit(scanLimit).Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to list publications")
	}
	cursorHasMore := input.Cursor != "" && len(publications) > limit
	if cursorHasMore {
		publications = publications[:limit]
	}
	body, err := h.loadPublicationResponses(ctx, publications)
	if err != nil {
		return nil, err
	}

	nextOffset := input.Offset + len(body)
	hasMore := nextOffset < total
	if input.Cursor != "" {
		hasMore = cursorHasMore
	}
	nextCursor := ""
	if !calendarRange && hasMore && len(publications) > 0 {
		last := publications[len(publications)-1]
		nextCursor = encodeTimestampIDCursor(last.CreatedAt, last.ID)
	}
	return &PublicationListOutput{
		TotalCount: total,
		Limit:      limit,
		Offset:     input.Offset,
		NextOffset: nextOffset,
		NextCursor: nextCursor,
		HasMore:    hasMore,
		Body:       body,
	}, nil
}

func validatePublicationListInput(input *ListPublicationsInput) (int, *timestampIDCursor, publicationListRange, error) {
	if input.Offset < 0 {
		return 0, nil, publicationListRange{}, huma.Error400BadRequest("offset must be greater than or equal to 0")
	}
	if input.Status != "" && input.ActivityBucket != "" {
		return 0, nil, publicationListRange{}, huma.Error400BadRequest("status and activity_bucket cannot be used together")
	}
	cursorValue := strings.TrimSpace(input.Cursor)
	if cursorValue != "" && input.Offset != 0 {
		return 0, nil, publicationListRange{}, huma.Error400BadRequest("cursor and offset cannot be used together")
	}
	limit := input.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	ranges, err := parsePublicationListRanges(input)
	if err != nil {
		return 0, nil, publicationListRange{}, err
	}
	if err := validatePublicationListRanges(ranges, cursorValue); err != nil {
		return 0, nil, publicationListRange{}, err
	}
	cursor, err := parsePublicationListCursor(cursorValue)
	if err != nil {
		return 0, nil, publicationListRange{}, err
	}
	return limit, cursor, ranges, nil
}

func parsePublicationListRanges(input *ListPublicationsInput) (publicationListRange, error) {
	ranges := publicationListRange{}
	fields := []struct {
		value  string
		name   string
		target *time.Time
	}{
		{value: input.CreatedFrom, name: "created_from", target: &ranges.createdFrom},
		{value: input.CreatedBefore, name: "created_before", target: &ranges.createdBefore},
		{value: input.CalendarFrom, name: "calendar_from", target: &ranges.calendarFrom},
		{value: input.CalendarBefore, name: "calendar_before", target: &ranges.calendarBefore},
	}
	for _, field := range fields {
		parsed, err := parseOptionalRFC3339(field.value)
		if err != nil {
			return publicationListRange{}, huma.Error400BadRequest(field.name + " must use RFC3339")
		}
		*field.target = parsed
	}
	return ranges, nil
}

func validatePublicationListRanges(ranges publicationListRange, cursorValue string) error {
	if ranges.calendarFrom.IsZero() != ranges.calendarBefore.IsZero() {
		return huma.Error400BadRequest("calendar_from and calendar_before must be used together")
	}
	if !ranges.calendarFrom.IsZero() && !ranges.calendarFrom.Before(ranges.calendarBefore) {
		return huma.Error400BadRequest("calendar_from must be before calendar_before")
	}
	if !ranges.createdFrom.IsZero() && !ranges.createdBefore.IsZero() && !ranges.createdFrom.Before(ranges.createdBefore) {
		return huma.Error400BadRequest("created_from must be before created_before")
	}
	if !ranges.calendarFrom.IsZero() && (!ranges.createdFrom.IsZero() || !ranges.createdBefore.IsZero()) {
		return huma.Error400BadRequest("calendar and creation ranges cannot be combined")
	}
	if !ranges.calendarFrom.IsZero() && cursorValue != "" {
		return huma.Error400BadRequest("calendar ranges use offset pagination")
	}
	return nil
}

func parsePublicationListCursor(value string) (*timestampIDCursor, error) {
	if value == "" {
		return nil, nil
	}
	parsed, err := parseTimestampIDCursor(value)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid publication cursor")
	}
	return &parsed, nil
}

func publicationListQuery(
	db bun.IDB,
	model interface{},
	input *ListPublicationsInput,
	ranges publicationListRange,
) *bun.SelectQuery {
	query := db.NewSelect().
		Model(model).
		ModelTableExpr("publications AS publication").
		Where("publication.workspace_id = ?", input.WorkspaceID)
	if input.ActivityBucket != "" {
		query = publicationActivityBucketQuery(query, input.ActivityBucket)
	} else if input.Status != "" {
		query = query.Where("publication.status = ?", input.Status)
	}
	if input.ContentProfile != "" {
		query = query.Where("publication.content_profile = ?", input.ContentProfile)
	}
	if platform := strings.TrimSpace(input.Platform); platform != "" {
		query = query.Where("EXISTS (SELECT 1 FROM renditions AS rendition WHERE rendition.publication_id = publication.id AND rendition.platform = ?)", platform)
	}
	if search := strings.TrimSpace(input.Search); search != "" {
		pattern := "%" + escapeLikePattern(strings.ToLower(search)) + "%"
		query = query.Where(
			"(LOWER(publication.title) LIKE ? ESCAPE '\\' OR LOWER(publication.source_text) LIKE ? ESCAPE '\\')",
			pattern,
			pattern,
		)
	}
	if !ranges.createdFrom.IsZero() {
		query = query.Where("publication.created_at >= ?", ranges.createdFrom)
	}
	if !ranges.createdBefore.IsZero() {
		query = query.Where("publication.created_at < ?", ranges.createdBefore)
	}
	if !ranges.calendarFrom.IsZero() {
		query = query.
			Where("publication.status IN (?)", bun.List([]string{
				models.PublicationStatusScheduled,
				models.PublicationStatusPublishing,
				models.PublicationStatusPublished,
			})).
			Where(publicationCalendarOccurrenceSQL+" >= ?", ranges.calendarFrom).
			Where(publicationCalendarOccurrenceSQL+" < ?", ranges.calendarBefore)
	}
	return query
}

func escapeLikePattern(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "%", "\\%")
	return strings.ReplaceAll(value, "_", "\\_")
}

func publicationActivityBucketQuery(query *bun.SelectQuery, bucket string) *bun.SelectQuery {
	switch bucket {
	case "scheduled":
		return query.Where(
			"(publication.status IN (?) OR (publication.status = ? AND publication.scheduled_at IS NOT NULL))",
			bun.List([]string{models.PublicationStatusScheduled, models.PublicationStatusPublishing}),
			models.PublicationStatusReady,
		)
	case "published":
		return query.Where("publication.status = ?", models.PublicationStatusPublished)
	case "failed":
		return query.
			Where("publication.status = ?", models.PublicationStatusFailed).
			Where("publication.failure_dismissed_at IS NULL")
	case "draft":
		return query.
			Where("publication.status NOT IN (?)", bun.List([]string{
				models.PublicationStatusScheduled,
				models.PublicationStatusPublishing,
				models.PublicationStatusPublished,
				models.PublicationStatusFailed,
			})).
			Where("(publication.status <> ? OR publication.scheduled_at IS NULL)", models.PublicationStatusReady)
	default:
		return query.Where("1 = 0")
	}
}
