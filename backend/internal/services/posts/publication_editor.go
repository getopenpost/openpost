package posts

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

type publicationEditorThreadDraft struct {
	Posts    []publicationEditorThreadPost                          `json:"p"`
	Variants map[string]map[string]publicationEditorThreadVariation `json:"v"`
}

type publicationEditorThreadPost struct {
	Key      string   `json:"k"`
	Content  string   `json:"c"`
	MediaIDs []string `json:"m"`
}

type publicationEditorThreadVariation struct {
	Content  string   `json:"content"`
	MediaIDs []string `json:"mediaIds"`
}

// EnsurePublicationEditorTx creates the internal editor row used by the
// text-and-thread composer and synchronizes it from the canonical publication.
// Other publication intents use their focused composer and need no Post row.
func EnsurePublicationEditorTx(
	ctx context.Context,
	tx bun.Tx,
	publication *models.Publication,
) (*models.Post, error) {
	if !usesTextThreadEditor(publication.Intent) {
		return nil, nil
	}

	var editor models.Post
	err := tx.NewSelect().
		Model(&editor).
		Where("publication_id = ?", publication.ID).
		Where("COALESCE(parent_post_id, '') = ''").
		Order("thread_sequence ASC", "created_at ASC", "id ASC").
		Limit(1).
		Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if errors.Is(err, sql.ErrNoRows) {
		editor = models.Post{
			ID:            uuid.NewString(),
			WorkspaceID:   publication.WorkspaceID,
			CreatedByID:   publication.CreatedByID,
			PublicationID: publication.ID,
			Content:       publication.SourceText,
			Status:        editorPostStatus(publication.Status),
			Revision:      max(1, publication.Revision),
			ScheduledAt:   publication.ScheduledAt,
			ActualRunAt:   publication.ActualRunAt,
			CreatedAt:     publication.CreatedAt,
			UpdatedAt:     publication.UpdatedAt,
		}
		if editor.CreatedAt.IsZero() {
			editor.CreatedAt = time.Now().UTC()
		}
		if editor.UpdatedAt.IsZero() {
			editor.UpdatedAt = editor.CreatedAt
		}
		if _, err := tx.NewInsert().Model(&editor).Exec(ctx); err != nil {
			return nil, err
		}
	}

	if err := SyncPublicationEditorTx(ctx, tx, publication, &editor); err != nil {
		return nil, err
	}
	return &editor, nil
}

// SyncPublicationEditorTx refreshes the compatibility editor state for one
// canonical text/thread publication. Publication revisions remain owned by the
// caller so its optimistic-concurrency transaction stays atomic.
func SyncPublicationEditorTx(
	ctx context.Context,
	tx bun.Tx,
	publication *models.Publication,
	editor *models.Post,
) error {
	if editor == nil || !usesTextThreadEditor(publication.Intent) {
		return nil
	}

	segments, mediaBySegment, err := publicationEditorSegments(ctx, tx, publication.ID)
	if err != nil {
		return err
	}
	content := publication.SourceText
	if len(segments) > 0 {
		content = segments[0].Body
	}
	now := publication.UpdatedAt
	if now.IsZero() {
		now = time.Now().UTC()
	}
	editor.Content = content
	editor.Status = editorPostStatus(publication.Status)
	editor.ScheduledAt = publication.ScheduledAt
	editor.ActualRunAt = publication.ActualRunAt
	editor.UpdatedAt = now
	if _, err := tx.NewUpdate().
		Model(editor).
		Column("content", "status", "scheduled_at", "actual_run_at", "updated_at").
		Where("id = ?", editor.ID).
		Exec(ctx); err != nil {
		return err
	}

	renditions, renditionSegments, renditionMedia, err := publicationEditorRenditions(
		ctx,
		tx,
		publication.ID,
	)
	if err != nil {
		return err
	}
	if err := replacePublicationEditorDestinations(ctx, tx, editor.ID, renditions); err != nil {
		return err
	}
	if err := replacePublicationEditorMedia(ctx, tx, editor.ID, segments, mediaBySegment); err != nil {
		return err
	}
	if err := replacePublicationEditorVariants(
		ctx,
		tx,
		editor.ID,
		segments,
		mediaBySegment,
		renditions,
		renditionSegments,
		renditionMedia,
		now,
	); err != nil {
		return err
	}
	return replacePublicationEditorThreadDraft(
		ctx,
		tx,
		editor.ID,
		publication.Intent,
		segments,
		mediaBySegment,
		renditions,
		renditionSegments,
		renditionMedia,
	)
}

func usesTextThreadEditor(intent string) bool {
	return intent == models.PublishingIntentPost || intent == models.PublishingIntentThread
}

func editorPostStatus(status string) string {
	switch status {
	case models.PublicationStatusScheduled:
		return models.PostStatusScheduled
	case models.PublicationStatusPublishing:
		return models.PostStatusPublishing
	case models.PublicationStatusPublished:
		return models.PostStatusPublished
	case models.PublicationStatusFailed:
		return models.PostStatusFailed
	default:
		return models.PostStatusDraft
	}
}

func editorDestinationStatus(status string) string {
	switch status {
	case models.RenditionStatusPublished:
		return "success"
	case models.RenditionStatusFailed:
		return "failed"
	default:
		return "pending"
	}
}

func publicationEditorSegments(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
) ([]models.PublicationSegment, map[string][]string, error) {
	var segments []models.PublicationSegment
	if err := tx.NewSelect().
		Model(&segments).
		Where("publication_id = ?", publicationID).
		Order("position ASC", "id ASC").
		Scan(ctx); err != nil {
		return nil, nil, err
	}
	segmentIDs := make([]string, 0, len(segments))
	for _, segment := range segments {
		segmentIDs = append(segmentIDs, segment.ID)
	}
	mediaBySegment := make(map[string][]string, len(segments))
	if len(segmentIDs) == 0 {
		return segments, mediaBySegment, nil
	}
	var media []models.PublicationSegmentMedia
	if err := tx.NewSelect().
		Model(&media).
		Where("segment_id IN (?)", bun.List(segmentIDs)).
		Order("display_order ASC", "media_id ASC").
		Scan(ctx); err != nil {
		return nil, nil, err
	}
	for _, item := range media {
		mediaBySegment[item.SegmentID] = append(mediaBySegment[item.SegmentID], item.MediaID)
	}
	return segments, mediaBySegment, nil
}

func publicationEditorRenditions(
	ctx context.Context,
	tx bun.Tx,
	publicationID string,
) (
	[]models.Rendition,
	map[string][]models.RenditionSegment,
	map[string][]string,
	error,
) {
	var renditions []models.Rendition
	if err := tx.NewSelect().
		Model(&renditions).
		Column(
			"id", "publication_id", "social_account_id", "platform", "profile", "output_profile",
			"body", "title", "description", "settings_json", "status", "external_id", "external_url",
			"error_message", "error_kind", "error_code", "error_http_status", "error_retryable",
			"error_retry_at", "error_action", "created_at", "updated_at",
		).
		Where("publication_id = ?", publicationID).
		Order("created_at ASC", "id ASC").
		Scan(ctx); err != nil {
		return nil, nil, nil, err
	}
	renditionIDs := make([]string, 0, len(renditions))
	for _, rendition := range renditions {
		renditionIDs = append(renditionIDs, rendition.ID)
	}
	segmentsByRendition := make(map[string][]models.RenditionSegment, len(renditions))
	mediaByRenditionSegment := make(map[string][]string)
	if len(renditionIDs) == 0 {
		return renditions, segmentsByRendition, mediaByRenditionSegment, nil
	}
	var segments []models.RenditionSegment
	if err := tx.NewSelect().
		Model(&segments).
		Column(
			"id", "rendition_id", "publication_segment_id", "position", "body", "title",
			"description", "url", "settings_json", "status", "external_id", "external_url",
			"error_message", "error_kind", "error_code", "error_http_status", "error_retryable",
			"error_retry_at", "error_action", "created_at", "updated_at",
		).
		Where("rendition_id IN (?)", bun.List(renditionIDs)).
		Order("position ASC", "id ASC").
		Scan(ctx); err != nil {
		return nil, nil, nil, err
	}
	segmentIDs := make([]string, 0, len(segments))
	for _, segment := range segments {
		segmentsByRendition[segment.RenditionID] = append(
			segmentsByRendition[segment.RenditionID],
			segment,
		)
		segmentIDs = append(segmentIDs, segment.ID)
	}
	if len(segmentIDs) == 0 {
		return renditions, segmentsByRendition, mediaByRenditionSegment, nil
	}
	var media []models.RenditionSegmentMedia
	if err := tx.NewSelect().
		Model(&media).
		Where("rendition_segment_id IN (?)", bun.List(segmentIDs)).
		Order("display_order ASC", "media_id ASC").
		Scan(ctx); err != nil {
		return nil, nil, nil, err
	}
	for _, item := range media {
		mediaByRenditionSegment[item.RenditionSegmentID] = append(
			mediaByRenditionSegment[item.RenditionSegmentID],
			item.MediaID,
		)
	}
	return renditions, segmentsByRendition, mediaByRenditionSegment, nil
}

func replacePublicationEditorDestinations(
	ctx context.Context,
	tx bun.Tx,
	postID string,
	renditions []models.Rendition,
) error {
	if _, err := tx.NewDelete().
		Model((*models.PostDestination)(nil)).
		Where("post_id = ?", postID).
		Exec(ctx); err != nil {
		return err
	}
	for _, rendition := range renditions {
		destination := models.PostDestination{
			ID:              uuid.NewString(),
			PostID:          postID,
			SocialAccountID: rendition.SocialAccountID,
			ExternalID:      rendition.ExternalID,
			Status:          editorDestinationStatus(rendition.Status),
			ErrorMessage:    rendition.ErrorMessage,
			ErrorKind:       rendition.ErrorKind,
			ErrorCode:       rendition.ErrorCode,
			ErrorHTTPStatus: rendition.ErrorHTTPStatus,
			ErrorRetryable:  rendition.ErrorRetryable,
			ErrorRetryAt:    rendition.ErrorRetryAt,
			ErrorAction:     rendition.ErrorAction,
		}
		if _, err := tx.NewInsert().Model(&destination).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func replacePublicationEditorMedia(
	ctx context.Context,
	tx bun.Tx,
	postID string,
	segments []models.PublicationSegment,
	mediaBySegment map[string][]string,
) error {
	if _, err := tx.NewDelete().Model((*models.PostMedia)(nil)).Where("post_id = ?", postID).Exec(ctx); err != nil {
		return err
	}
	seen := make(map[string]bool)
	displayOrder := 0
	for _, segment := range segments {
		for _, mediaID := range mediaBySegment[segment.ID] {
			if seen[mediaID] {
				continue
			}
			seen[mediaID] = true
			item := models.PostMedia{PostID: postID, MediaID: mediaID, DisplayOrder: displayOrder}
			if _, err := tx.NewInsert().Model(&item).Exec(ctx); err != nil {
				return err
			}
			displayOrder++
		}
	}
	return nil
}

func replacePublicationEditorVariants(
	ctx context.Context,
	tx bun.Tx,
	postID string,
	segments []models.PublicationSegment,
	mediaBySegment map[string][]string,
	renditions []models.Rendition,
	segmentsByRendition map[string][]models.RenditionSegment,
	mediaByRenditionSegment map[string][]string,
	now time.Time,
) error {
	if _, err := tx.NewDelete().Model((*models.PostVariant)(nil)).Where("post_id = ?", postID).Exec(ctx); err != nil {
		return err
	}
	if len(segments) != 1 {
		return nil
	}
	canonicalContent := segments[0].Body
	canonicalMedia := mediaBySegment[segments[0].ID]
	for _, rendition := range renditions {
		renditionSegments := segmentsByRendition[rendition.ID]
		content := rendition.Body
		mediaIDs := []string(nil)
		if len(renditionSegments) > 0 {
			content = renditionSegments[0].Body
			mediaIDs = mediaByRenditionSegment[renditionSegments[0].ID]
		}
		if content == canonicalContent && slices.Equal(mediaIDs, canonicalMedia) {
			continue
		}
		encodedMedia, err := json.Marshal(mediaIDs)
		if err != nil {
			return err
		}
		variant := models.PostVariant{
			ID:              uuid.NewString(),
			PostID:          postID,
			SocialAccountID: rendition.SocialAccountID,
			Content:         content,
			MediaIDs:        string(encodedMedia),
			IsUnsynced:      true,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		if _, err := tx.NewInsert().Model(&variant).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func replacePublicationEditorThreadDraft(
	ctx context.Context,
	tx bun.Tx,
	postID string,
	intent string,
	segments []models.PublicationSegment,
	mediaBySegment map[string][]string,
	renditions []models.Rendition,
	segmentsByRendition map[string][]models.RenditionSegment,
	mediaByRenditionSegment map[string][]string,
) error {
	if intent != models.PublishingIntentThread && len(segments) < 2 {
		return UpsertThreadDraftTx(ctx, tx, postID, nil)
	}
	draft := publicationEditorThreadDraft{
		Posts:    make([]publicationEditorThreadPost, 0, len(segments)),
		Variants: make(map[string]map[string]publicationEditorThreadVariation),
	}
	for _, segment := range segments {
		draft.Posts = append(draft.Posts, publicationEditorThreadPost{
			Key:      segment.ID,
			Content:  segment.Body,
			MediaIDs: mediaBySegment[segment.ID],
		})
	}
	for _, rendition := range renditions {
		for _, segment := range segmentsByRendition[rendition.ID] {
			variant := publicationEditorThreadVariation{
				Content:  segment.Body,
				MediaIDs: mediaByRenditionSegment[segment.ID],
			}
			canonicalIndex := segment.Position
			if canonicalIndex < 0 || canonicalIndex >= len(segments) {
				continue
			}
			canonical := segments[canonicalIndex]
			if variant.Content == canonical.Body &&
				slices.Equal(variant.MediaIDs, mediaBySegment[canonical.ID]) {
				continue
			}
			if draft.Variants[rendition.SocialAccountID] == nil {
				draft.Variants[rendition.SocialAccountID] =
					make(map[string]publicationEditorThreadVariation)
			}
			draft.Variants[rendition.SocialAccountID][canonical.ID] = variant
		}
	}
	encoded, err := json.Marshal(draft)
	if err != nil {
		return err
	}
	value := ThreadDraftPrefix + string(encoded)
	return UpsertThreadDraftTx(ctx, tx, postID, &value)
}
