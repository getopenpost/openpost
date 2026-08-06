package medialifecycle

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/uptrace/bun"
)

const (
	RetentionLibrary   = "library"
	RetentionTemporary = "temporary"

	TrashReasonManual    = "manual"
	TrashReasonPublished = "published"
	TrashReasonExpired   = "expired"

	TemporaryIdleAge  = 14 * 24 * time.Hour
	TrashRetentionAge = 7 * 24 * time.Hour
)

type Service struct {
	db      *bun.DB
	storage mediastore.BlobStorage
}

func NewService(db *bun.DB, storage mediastore.BlobStorage) *Service {
	return &Service{db: db, storage: storage}
}

func NormalizeRetention(value string, assetKind string, hasTag bool) (string, error) {
	if assetKind != "" && assetKind != "library" {
		return RetentionLibrary, nil
	}
	if hasTag {
		return RetentionLibrary, nil
	}
	switch strings.TrimSpace(value) {
	case "", RetentionLibrary:
		return RetentionLibrary, nil
	case RetentionTemporary:
		return RetentionTemporary, nil
	default:
		return "", errors.New("retention_class must be library or temporary")
	}
}

func (s *Service) Promote(ctx context.Context, mediaID string) error {
	_, err := s.db.NewUpdate().Model((*models.MediaAttachment)(nil)).
		Set("retention_class = ?", RetentionLibrary).
		Where("id = ?", mediaID).
		Exec(ctx)
	return err
}

func (s *Service) Touch(ctx context.Context, mediaIDs []string, at time.Time) error {
	return TouchWithDB(ctx, s.db, mediaIDs, at)
}

// TouchWithDB records use inside the caller's transaction. Callers should pass
// both the old and new reference sets so detaching media also starts a fresh
// inactivity window instead of making it immediately eligible for cleanup.
func TouchWithDB(ctx context.Context, db bun.IDB, mediaIDs []string, at time.Time) error {
	mediaIDs = uniqueIDs(mediaIDs)
	if len(mediaIDs) == 0 {
		return nil
	}
	_, err := db.NewUpdate().Model((*models.MediaAttachment)(nil)).
		Set("last_used_at = ?", at.UTC()).
		Where("id IN (?)", bun.List(mediaIDs)).
		Exec(ctx)
	return err
}

func uniqueIDs(ids []string) []string {
	seen := make(map[string]struct{}, len(ids))
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result
}

func (s *Service) TrashManual(ctx context.Context, mediaID, workspaceID string) (bool, error) {
	eligible, err := s.canTrash(ctx, mediaID, workspaceID, false, false)
	if err != nil || !eligible {
		return eligible, err
	}
	return s.markTrashed(ctx, mediaID, TrashReasonManual, time.Now().UTC())
}

func (s *Service) Restore(ctx context.Context, mediaID, workspaceID string) (bool, error) {
	result, err := s.db.NewUpdate().Model((*models.MediaAttachment)(nil)).
		Set("trashed_at = NULL").
		Set("purge_after = NULL").
		Set("trash_reason = ''").
		Set("last_used_at = ?", time.Now().UTC()).
		Where("id = ? AND workspace_id = ? AND trashed_at IS NOT NULL", mediaID, workspaceID).
		Exec(ctx)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func (s *Service) TrashTemporaryForPublication(ctx context.Context, publicationID string) error {
	var publication models.Publication
	if err := s.db.NewSelect().Model(&publication).Column("id", "workspace_id", "status").Where("id = ?", publicationID).Scan(ctx); err != nil {
		return err
	}
	if publication.Status != models.PublicationStatusPublished {
		return nil
	}
	var ids []string
	err := s.db.NewSelect().
		TableExpr(`(
			SELECT psm.media_id AS media_id
			FROM publication_segment_media psm
			JOIN publication_segments ps ON ps.id = psm.segment_id
			WHERE ps.publication_id = ?
			UNION
			SELECT rm.media_id AS media_id
			FROM rendition_media rm
			JOIN renditions r ON r.id = rm.rendition_id
			WHERE r.publication_id = ?
			UNION
			SELECT rsm.media_id AS media_id
			FROM rendition_segment_media rsm
			JOIN rendition_segments rs ON rs.id = rsm.rendition_segment_id
			JOIN renditions r ON r.id = rs.rendition_id
			WHERE r.publication_id = ?
		) AS lifecycle_media`, publicationID, publicationID, publicationID).
		Column("media_id").
		Scan(ctx, &ids)
	if err != nil {
		return err
	}
	return s.trashEligibleTemporary(ctx, publication.WorkspaceID, ids, TrashReasonPublished)
}

func (s *Service) TrashTemporaryForPost(ctx context.Context, postID string) error {
	var post models.Post
	if err := s.db.NewSelect().Model(&post).Column("id", "workspace_id", "status").Where("id = ?", postID).Scan(ctx); err != nil {
		return err
	}
	if post.Status != models.PostStatusPublished {
		return nil
	}
	var ids []string
	if err := s.db.NewSelect().Model((*models.PostMedia)(nil)).Column("media_id").Where("post_id = ?", postID).Scan(ctx, &ids); err != nil {
		return err
	}
	var variants []models.PostVariant
	if err := s.db.NewSelect().Model(&variants).Where("post_id = ? AND media_ids != ''", postID).Scan(ctx); err != nil {
		return err
	}
	for _, variant := range variants {
		var variantIDs []string
		if json.Unmarshal([]byte(variant.MediaIDs), &variantIDs) == nil {
			ids = append(ids, variantIDs...)
		}
	}
	return s.trashEligibleTemporary(ctx, post.WorkspaceID, ids, TrashReasonPublished)
}

func (s *Service) Sweep(ctx context.Context, workspaceID string, now time.Time) error {
	var ids []string
	if err := s.db.NewSelect().Model((*models.MediaAttachment)(nil)).Column("id").
		Where("workspace_id = ?", workspaceID).
		Where("retention_class = ?", RetentionTemporary).
		Where("trashed_at IS NULL").
		Where("is_favorite = ?", false).
		Where("COALESCE(last_used_at, created_at) <= ?", now.UTC().Add(-TemporaryIdleAge)).
		Scan(ctx, &ids); err != nil {
		return err
	}
	if err := s.trashEligibleTemporary(ctx, workspaceID, ids, TrashReasonExpired); err != nil {
		return err
	}
	return s.purgeDue(ctx, workspaceID, now.UTC())
}

func (s *Service) trashEligibleTemporary(ctx context.Context, workspaceID string, ids []string, reason string) error {
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		eligible, err := s.canTrash(ctx, id, workspaceID, true, false)
		if err != nil {
			return err
		}
		if eligible {
			if _, err := s.markTrashed(ctx, id, reason, time.Now().UTC()); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) markTrashed(ctx context.Context, mediaID, reason string, now time.Time) (bool, error) {
	result, err := s.db.NewUpdate().Model((*models.MediaAttachment)(nil)).
		Set("trashed_at = ?", now).
		Set("purge_after = ?", now.Add(TrashRetentionAge)).
		Set("trash_reason = ?", reason).
		Where("id = ? AND trashed_at IS NULL", mediaID).
		Exec(ctx)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

// canTrash is deliberately conservative. Published post references are historical
// metadata and may survive trashing; every editable or retryable reference blocks it.
func (s *Service) canTrash(ctx context.Context, mediaID, workspaceID string, temporaryOnly bool, allowTrashed bool) (bool, error) {
	var media models.MediaAttachment
	if err := s.db.NewSelect().Model(&media).Column("id", "workspace_id", "retention_class", "is_favorite", "trashed_at").
		Where("id = ? AND workspace_id = ?", mediaID, workspaceID).Scan(ctx); err != nil {
		return false, err
	}
	if !allowTrashed && !media.TrashedAt.IsZero() {
		return false, nil
	}
	if temporaryOnly && media.RetentionClass != RetentionTemporary {
		return false, nil
	}
	if media.RetentionClass == RetentionTemporary && media.IsFavorite {
		return false, nil
	}
	organized, err := s.isOrganizedMedia(ctx, mediaID, temporaryOnly)
	if err != nil || organized {
		return false, err
	}
	protected, err := s.hasProtectedReference(ctx, mediaID)
	if err != nil || protected {
		return false, err
	}
	active, err := s.hasActivePublicationReference(ctx, mediaID)
	if err != nil || active {
		return false, err
	}
	activeVariant, err := s.hasActiveVariantReference(ctx, workspaceID, mediaID)
	return !activeVariant, err
}

func (s *Service) isOrganizedMedia(ctx context.Context, mediaID string, temporaryOnly bool) (bool, error) {
	if !temporaryOnly {
		return false, nil
	}
	var count int
	if err := s.db.NewRaw("SELECT COUNT(*) FROM media_tag_assignments WHERE media_id = ?", mediaID).Scan(ctx, &count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *Service) hasProtectedReference(ctx context.Context, mediaID string) (bool, error) {
	protectedQueries := []string{
		"SELECT COUNT(*) FROM brand_assets WHERE media_id = ?",
		"SELECT COUNT(*) FROM brand_fonts WHERE media_id = ?",
		"SELECT COUNT(*) FROM design_media_references r JOIN design_documents d ON d.id = r.design_document_id WHERE r.media_id = ? AND d.deleted_at IS NULL",
		"SELECT COUNT(*) FROM design_template_media_references WHERE media_id = ?",
		"SELECT COUNT(*) FROM video_project_assets a JOIN video_projects p ON p.id = a.video_project_id WHERE a.media_id = ? AND p.deleted_at IS NULL",
		"SELECT COUNT(*) FROM design_documents WHERE cover_preview_media_id = ? AND deleted_at IS NULL",
		"SELECT COUNT(*) FROM design_pages p JOIN design_documents d ON d.id = p.design_document_id WHERE (p.preview_media_id = ? OR p.latest_export_media_id = ?) AND d.deleted_at IS NULL",
		"SELECT COUNT(*) FROM design_templates WHERE preview_media_id = ?",
		"SELECT COUNT(*) FROM video_projects WHERE cover_preview_media_id = ? AND deleted_at IS NULL",
	}
	for _, query := range protectedQueries {
		args := []any{mediaID}
		if strings.Count(query, "?") == 2 {
			args = append(args, mediaID)
		}
		var count int
		if err := s.db.NewRaw(query, args...).Scan(ctx, &count); err != nil {
			return false, err
		}
		if count > 0 {
			return true, nil
		}
	}
	return false, nil
}

func (s *Service) hasActivePublicationReference(ctx context.Context, mediaID string) (bool, error) {
	activeQueries := []string{
		"SELECT COUNT(*) FROM post_media pm JOIN posts p ON p.id = pm.post_id WHERE pm.media_id = ? AND p.status <> ?",
		"SELECT COUNT(*) FROM rendition_media rm JOIN renditions r ON r.id = rm.rendition_id WHERE rm.media_id = ? AND r.status <> ?",
		"SELECT COUNT(*) FROM publication_segment_media psm JOIN publication_segments ps ON ps.id = psm.segment_id JOIN publications p ON p.id = ps.publication_id WHERE psm.media_id = ? AND p.status <> ?",
		"SELECT COUNT(*) FROM rendition_segment_media rsm JOIN rendition_segments rs ON rs.id = rsm.rendition_segment_id JOIN renditions r ON r.id = rs.rendition_id WHERE rsm.media_id = ? AND r.status <> ?",
	}
	statuses := []string{models.PostStatusPublished, models.RenditionStatusPublished, models.PublicationStatusPublished, models.RenditionStatusPublished}
	for index, query := range activeQueries {
		var count int
		if err := s.db.NewRaw(query, mediaID, statuses[index]).Scan(ctx, &count); err != nil {
			return false, err
		}
		if count > 0 {
			return true, nil
		}
	}
	return false, nil
}

func (s *Service) hasActiveVariantReference(ctx context.Context, workspaceID, mediaID string) (bool, error) {
	var variants []struct {
		MediaIDs string `bun:"media_ids"`
		Status   string `bun:"status"`
	}
	if err := s.db.NewSelect().TableExpr("post_variants AS pv").ColumnExpr("pv.media_ids, p.status").
		Join("JOIN posts AS p ON p.id = pv.post_id").Where("p.workspace_id = ? AND pv.media_ids != ''", workspaceID).Scan(ctx, &variants); err != nil {
		return false, err
	}
	for _, variant := range variants {
		if variant.Status == models.PostStatusPublished {
			continue
		}
		var ids []string
		if json.Unmarshal([]byte(variant.MediaIDs), &ids) != nil {
			continue
		}
		for _, id := range ids {
			if id == mediaID {
				return true, nil
			}
		}
	}
	return false, nil
}

func (s *Service) purgeDue(ctx context.Context, workspaceID string, now time.Time) error {
	var media []models.MediaAttachment
	if err := s.db.NewSelect().Model(&media).
		Where("workspace_id = ? AND purge_after IS NOT NULL AND purge_after <= ?", workspaceID, now).
		Scan(ctx); err != nil {
		return err
	}
	for index := range media {
		eligible, err := s.canPurge(ctx, &media[index])
		if err != nil {
			return err
		}
		if !eligible {
			continue
		}
		if err := s.purge(ctx, &media[index]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) canPurge(ctx context.Context, media *models.MediaAttachment) (bool, error) {
	if media.TrashedAt.IsZero() {
		return false, nil
	}
	// A reference may have been added by an old client while the item was in
	// Trash. Defer purging whenever editable work now depends on it.
	eligible, err := s.canTrash(ctx, media.ID, media.WorkspaceID, false, true)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return eligible, err
}

func (s *Service) purge(ctx context.Context, media *models.MediaAttachment) error {
	if err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		for _, model := range []any{
			(*models.PostMedia)(nil),
			(*models.RenditionMedia)(nil),
			(*models.PublicationSegmentMedia)(nil),
			(*models.RenditionSegmentMedia)(nil),
		} {
			if _, err := tx.NewDelete().Model(model).Where("media_id = ?", media.ID).Exec(txCtx); err != nil {
				return err
			}
		}
		if err := removeVariantReferences(txCtx, tx, media.WorkspaceID, media.ID); err != nil {
			return err
		}
		_, err := tx.NewDelete().Model((*models.MediaAttachment)(nil)).Where("id = ? AND workspace_id = ?", media.ID, media.WorkspaceID).Exec(txCtx)
		return err
	}); err != nil {
		return err
	}
	if s.storage == nil {
		return nil
	}
	keys := make([]string, 0, 4)
	keys = append(keys, filepath.Base(media.FilePath), media.ThumbnailObjectKey)
	var thumbs struct {
		SM string `json:"sm"`
		MD string `json:"md"`
	}
	_ = json.Unmarshal([]byte(media.ThumbnailsJSON), &thumbs)
	keys = append(keys, thumbs.SM, thumbs.MD)
	for _, key := range keys {
		if strings.TrimSpace(key) == "" {
			continue
		}
		if err := s.storage.Delete(key); err != nil {
			log.Printf("failed to purge media object %s for %s: %v", key, media.ID, err)
		}
	}
	return nil
}

func removeVariantReferences(ctx context.Context, db bun.IDB, workspaceID, mediaID string) error {
	var variants []models.PostVariant
	var postIDs []string
	if err := db.NewSelect().Model((*models.Post)(nil)).Column("id").Where("workspace_id = ?", workspaceID).Scan(ctx, &postIDs); err != nil {
		return err
	}
	if len(postIDs) == 0 {
		return nil
	}
	if err := db.NewSelect().Model(&variants).
		Where("post_id IN (?) AND media_ids != ''", bun.List(postIDs)).
		Scan(ctx); err != nil {
		return err
	}
	for _, variant := range variants {
		var ids []string
		if json.Unmarshal([]byte(variant.MediaIDs), &ids) != nil {
			continue
		}
		filtered := make([]string, 0, len(ids))
		changed := false
		for _, id := range ids {
			if id == mediaID {
				changed = true
				continue
			}
			filtered = append(filtered, id)
		}
		if !changed {
			continue
		}
		encoded, err := json.Marshal(filtered)
		if err != nil {
			return err
		}
		if _, err := db.NewUpdate().Model(&variant).Set("media_ids = ?", string(encoded)).Where("id = ?", variant.ID).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}
