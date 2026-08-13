package medialifecycle

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/openpost/backend/internal/database/migrations"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

const (
	RetentionLibrary   = "library"
	RetentionTemporary = "temporary"

	TrashReasonManual    = "manual"
	TrashReasonPublished = "published"
	TrashReasonExpired   = "expired"

	TemporaryIdleDays = 14
	TemporaryIdleAge  = TemporaryIdleDays * 24 * time.Hour
	TrashRetentionAge = 7 * 24 * time.Hour

	lifecycleBatchSize           = 250
	jsonUpdateBatchSize          = 150
	editorRevisionPruneBatchSize = 250
	threadDraftPrefix            = "__openpost_thread__:"
)

var settingMediaKeys = map[string]struct{}{
	"caption_media_id":   {},
	"cover_media_id":     {},
	"thumbnail_media_id": {},
}

type Service struct {
	db      *bun.DB
	storage mediastore.BlobStorage
}

type protectionSnapshot struct {
	referenced map[string]struct{}
	organized  map[string]struct{}
	legacyJSON []jsonReferenceRow
}

type protectionRow struct {
	Kind    string `bun:"protection_kind"`
	MediaID string `bun:"media_id"`
}

type jsonReferenceRow struct {
	Kind    string `bun:"reference_kind"`
	OwnerID string `bun:"owner_id"`
	Status  string `bun:"owner_status"`
	Payload string `bun:"payload"`
}

type lifecycleBatchResult struct {
	lastID  string
	scanned int
	purged  []models.MediaAttachment
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
	mediaID = strings.TrimSpace(mediaID)
	workspaceID = strings.TrimSpace(workspaceID)
	if mediaID == "" || workspaceID == "" {
		return false, nil
	}
	now := time.Now().UTC()
	trashed := false
	err := s.runSerializable(ctx, func(txCtx context.Context, tx bun.Tx) error {
		media, err := loadMediaForUpdate(txCtx, tx, workspaceID, []string{mediaID})
		if err != nil {
			return err
		}
		if len(media) != 1 || !media[0].TrashedAt.IsZero() {
			return nil
		}
		snapshot, err := loadProtectionSnapshot(txCtx, tx, workspaceID, []string{mediaID})
		if err != nil {
			return err
		}
		if snapshot.isReferenced(mediaID) {
			return nil
		}
		trashed, err = markTrashed(txCtx, tx, []string{mediaID}, TrashReasonManual, now)
		return err
	})
	return trashed, err
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
	now := time.Now().UTC()
	return s.runSerializable(ctx, func(txCtx context.Context, tx bun.Tx) error {
		var publication models.Publication
		query := tx.NewSelect().Model(&publication).
			Column("id", "workspace_id", "status").
			Where("id = ?", publicationID)
		if tx.Dialect().Name() == dialect.PG {
			query = query.For("UPDATE")
		}
		if err := query.Scan(txCtx); err != nil {
			return err
		}
		if publication.Status != models.PublicationStatusPublished {
			return nil
		}
		var ids []string
		err := tx.NewSelect().
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
			Scan(txCtx, &ids)
		if err != nil {
			return err
		}
		return trashTemporaryMedia(txCtx, tx, publication.WorkspaceID, ids, TrashReasonPublished, now)
	})
}

func (s *Service) TrashTemporaryForPost(ctx context.Context, postID string) error {
	now := time.Now().UTC()
	return s.runSerializable(ctx, func(txCtx context.Context, tx bun.Tx) error {
		var post models.Post
		query := tx.NewSelect().Model(&post).Column("id", "workspace_id", "status").Where("id = ?", postID)
		if tx.Dialect().Name() == dialect.PG {
			query = query.For("UPDATE")
		}
		if err := query.Scan(txCtx); err != nil {
			return err
		}
		if post.Status != models.PostStatusPublished {
			return nil
		}
		var ids []string
		if err := tx.NewSelect().Model((*models.PostMedia)(nil)).Column("media_id").Where("post_id = ?", postID).Scan(txCtx, &ids); err != nil {
			return err
		}
		var variants []models.PostVariant
		if err := tx.NewSelect().Model(&variants).Column("id", "media_ids").Where("post_id = ? AND media_ids != ''", postID).Scan(txCtx); err != nil {
			return err
		}
		for _, variant := range variants {
			variantIDs, err := decodeStringArray(variant.MediaIDs)
			if err != nil {
				return fmt.Errorf("decode post variant %s media references: %w", variant.ID, err)
			}
			ids = append(ids, variantIDs...)
		}
		var threadDraft models.ThreadDraft
		err := tx.NewSelect().Model(&threadDraft).Where("post_id = ?", postID).Scan(txCtx)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if err == nil {
			threadIDs, decodeErr := threadDraftMediaIDs(threadDraft.DraftJSON)
			if decodeErr != nil {
				return fmt.Errorf("decode thread draft %s media references: %w", postID, decodeErr)
			}
			ids = append(ids, threadIDs...)
		}
		return trashTemporaryMedia(txCtx, tx, post.WorkspaceID, ids, TrashReasonPublished, now)
	})
}

func trashTemporaryMedia(
	ctx context.Context,
	tx bun.Tx,
	workspaceID string,
	ids []string,
	reason string,
	now time.Time,
) error {
	ids = uniqueIDs(ids)
	if len(ids) == 0 {
		return nil
	}
	media, err := loadMediaForUpdate(ctx, tx, workspaceID, ids)
	if err != nil {
		return err
	}
	if len(media) == 0 {
		return nil
	}
	loadedIDs := make([]string, 0, len(media))
	for _, item := range media {
		loadedIDs = append(loadedIDs, item.ID)
	}
	snapshot, err := loadProtectionSnapshot(ctx, tx, workspaceID, loadedIDs)
	if err != nil {
		return err
	}
	eligible := make([]string, 0, len(media))
	for _, item := range media {
		if item.RetentionClass != RetentionTemporary || item.IsFavorite || !item.TrashedAt.IsZero() {
			continue
		}
		if snapshot.isOrganized(item.ID) || snapshot.isReferenced(item.ID) {
			continue
		}
		eligible = append(eligible, item.ID)
	}
	_, err = markTrashed(ctx, tx, eligible, reason, now)
	return err
}

func markTrashed(ctx context.Context, db bun.IDB, ids []string, reason string, now time.Time) (bool, error) {
	ids = uniqueIDs(ids)
	if len(ids) == 0 {
		return false, nil
	}
	result, err := db.NewUpdate().Model((*models.MediaAttachment)(nil)).
		Set("trashed_at = ?", now).
		Set("purge_after = ?", now.Add(TrashRetentionAge)).
		Set("trash_reason = ?", reason).
		Where("id IN (?) AND trashed_at IS NULL", bun.List(ids)).
		Exec(ctx)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows > 0, err
}

func (s *Service) Sweep(ctx context.Context, workspaceID string, now time.Time) error {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return errors.New("workspace_id is required for media cleanup")
	}
	pending, err := migrations.WorkspaceEditorRevisionMediaBackfillPending(ctx, s.db, workspaceID)
	if err != nil {
		return fmt.Errorf("check editor revision media indexing: %w", err)
	}
	if pending {
		if err := migrations.AdvanceWorkspaceEditorRevisionMediaBackfill(ctx, s.db, workspaceID); err != nil {
			return fmt.Errorf("advance editor revision media indexing: %w", err)
		}
	}
	now = now.UTC()
	cursor := ""
	for {
		var batch lifecycleBatchResult
		err := s.runSerializable(ctx, func(txCtx context.Context, tx bun.Tx) error {
			var err error
			batch, err = sweepLifecycleBatch(txCtx, tx, workspaceID, now, cursor)
			return err
		})
		if err != nil {
			return err
		}
		// Storage calls can block on a remote service. Database ownership has
		// already committed, so no SQLite/Postgres lock is held here.
		s.deletePurgedObjects(batch.purged)
		if batch.scanned < lifecycleBatchSize {
			return nil
		}
		cursor = batch.lastID
	}
}

func (s *Service) runSerializable(ctx context.Context, fn func(context.Context, bun.Tx) error) error {
	return s.db.RunInTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable}, fn)
}

func sweepLifecycleBatch(
	ctx context.Context,
	tx bun.Tx,
	workspaceID string,
	now time.Time,
	cursor string,
) (lifecycleBatchResult, error) {
	if err := pruneExpiredEditorRevisions(ctx, tx, workspaceID, now); err != nil {
		return lifecycleBatchResult{}, fmt.Errorf("prune expired editor revisions: %w", err)
	}
	pending, err := migrations.WorkspaceEditorRevisionMediaBackfillPending(
		ctx,
		tx,
		workspaceID,
	)
	if err != nil {
		return lifecycleBatchResult{}, fmt.Errorf("check editor revision media indexing: %w", err)
	}
	if pending {
		return lifecycleBatchResult{}, errors.New("editor revision media indexing is still in progress")
	}
	var media []models.MediaAttachment
	query := tx.NewSelect().Model(&media).
		Where("workspace_id = ?", workspaceID).
		WhereGroup(" AND ", func(group *bun.SelectQuery) *bun.SelectQuery {
			return group.
				Where("retention_class = ? AND trashed_at IS NULL AND is_favorite = ? AND COALESCE(last_used_at, created_at) <= ?", RetentionTemporary, false, now.Add(-TemporaryIdleAge)).
				WhereOr("trashed_at IS NOT NULL AND purge_after IS NOT NULL AND purge_after <= ?", now)
		}).
		Order("id ASC").
		Limit(lifecycleBatchSize)
	if cursor != "" {
		query = query.Where("id > ?", cursor)
	}
	if tx.Dialect().Name() == dialect.PG {
		query = query.For("UPDATE")
	}
	if err := query.Scan(ctx); err != nil {
		return lifecycleBatchResult{}, err
	}
	if len(media) == 0 {
		return lifecycleBatchResult{}, nil
	}

	result := lifecycleBatchResult{lastID: media[len(media)-1].ID, scanned: len(media)}
	ids := make([]string, 0, len(media))
	for _, item := range media {
		ids = append(ids, item.ID)
	}
	snapshot, err := loadProtectionSnapshot(ctx, tx, workspaceID, ids)
	if err != nil {
		return lifecycleBatchResult{}, err
	}

	toTrash, toPurge := partitionLifecycleBatch(media, snapshot, now)
	if _, err := markTrashed(ctx, tx, toTrash, TrashReasonExpired, now); err != nil {
		return lifecycleBatchResult{}, err
	}
	if len(toPurge) == 0 {
		return result, nil
	}
	if err := purgeMediaBatch(ctx, tx, snapshot, toPurge); err != nil {
		return lifecycleBatchResult{}, err
	}
	result.purged = toPurge
	return result, nil
}

func pruneExpiredEditorRevisions(
	ctx context.Context,
	tx bun.Tx,
	workspaceID string,
	now time.Time,
) error {
	var designRevisionIDs []string
	if err := tx.NewSelect().
		TableExpr("design_revisions AS revision").
		ColumnExpr("revision.id").
		Join("JOIN design_documents AS document ON document.id = revision.design_document_id").
		Where("document.workspace_id = ?", workspaceID).
		Where("revision.kind = ? AND revision.expires_at IS NOT NULL AND revision.expires_at <= ?", "autosave", now).
		OrderExpr("revision.expires_at ASC, revision.id ASC").
		Limit(editorRevisionPruneBatchSize).
		Scan(ctx, &designRevisionIDs); err != nil {
		return err
	}
	if len(designRevisionIDs) > 0 {
		if _, err := tx.NewDelete().Model((*models.DesignRevision)(nil)).
			Where("id IN (?)", bun.List(designRevisionIDs)).Exec(ctx); err != nil {
			return err
		}
	}

	var videoRevisionIDs []string
	if err := tx.NewSelect().
		TableExpr("video_project_revisions AS revision").
		ColumnExpr("revision.id").
		Join("JOIN video_projects AS project ON project.id = revision.video_project_id").
		Where("project.workspace_id = ?", workspaceID).
		Where("revision.kind = ? AND revision.expires_at IS NOT NULL AND revision.expires_at <= ?", "autosave", now).
		OrderExpr("revision.expires_at ASC, revision.id ASC").
		Limit(editorRevisionPruneBatchSize).
		Scan(ctx, &videoRevisionIDs); err != nil {
		return err
	}
	if len(videoRevisionIDs) == 0 {
		return nil
	}
	usages := make([]string, 0, len(videoRevisionIDs))
	for _, revisionID := range videoRevisionIDs {
		usages = append(usages, "revision:"+revisionID)
	}
	if _, err := tx.NewDelete().Model((*models.VideoProjectAsset)(nil)).
		Where("revision_id IN (?) OR usage IN (?)", bun.List(videoRevisionIDs), bun.List(usages)).
		Exec(ctx); err != nil {
		return err
	}
	_, err := tx.NewDelete().Model((*models.VideoProjectRevision)(nil)).
		Where("id IN (?)", bun.List(videoRevisionIDs)).Exec(ctx)
	return err
}

func partitionLifecycleBatch(
	media []models.MediaAttachment,
	snapshot *protectionSnapshot,
	now time.Time,
) ([]string, []models.MediaAttachment) {
	toTrash := make([]string, 0, len(media))
	toPurge := make([]models.MediaAttachment, 0, len(media))
	for _, item := range media {
		if shouldPurgeLifecycleMedia(item, snapshot, now) {
			toPurge = append(toPurge, item)
			continue
		}
		if shouldTrashLifecycleMedia(item, snapshot) {
			toTrash = append(toTrash, item.ID)
		}
	}
	return toTrash, toPurge
}

func shouldPurgeLifecycleMedia(item models.MediaAttachment, snapshot *protectionSnapshot, now time.Time) bool {
	return !item.TrashedAt.IsZero() &&
		!item.PurgeAfter.IsZero() &&
		!item.PurgeAfter.After(now) &&
		!snapshot.isReferenced(item.ID)
}

func shouldTrashLifecycleMedia(item models.MediaAttachment, snapshot *protectionSnapshot) bool {
	return item.TrashedAt.IsZero() &&
		item.RetentionClass == RetentionTemporary &&
		!snapshot.isOrganized(item.ID) &&
		!snapshot.isReferenced(item.ID)
}

func loadMediaForUpdate(ctx context.Context, tx bun.Tx, workspaceID string, ids []string) ([]models.MediaAttachment, error) {
	ids = uniqueIDs(ids)
	if len(ids) == 0 {
		return nil, nil
	}
	var media []models.MediaAttachment
	query := tx.NewSelect().Model(&media).
		Where("workspace_id = ? AND id IN (?)", workspaceID, bun.List(ids)).
		Order("id ASC")
	if tx.Dialect().Name() == dialect.PG {
		query = query.For("UPDATE")
	}
	if err := query.Scan(ctx); err != nil {
		return nil, err
	}
	return media, nil
}

func loadProtectionSnapshot(ctx context.Context, tx bun.Tx, workspaceID string, candidateIDs []string) (*protectionSnapshot, error) {
	candidateIDs = uniqueIDs(candidateIDs)
	snapshot := &protectionSnapshot{
		referenced: make(map[string]struct{}, len(candidateIDs)),
		organized:  make(map[string]struct{}, len(candidateIDs)),
	}
	if len(candidateIDs) == 0 {
		return snapshot, nil
	}
	if err := snapshot.loadNormalized(ctx, tx, workspaceID, candidateIDs); err != nil {
		return nil, err
	}
	if err := snapshot.loadJSON(ctx, tx, workspaceID, candidateIDs); err != nil {
		return nil, err
	}
	return snapshot, nil
}

func (snapshot *protectionSnapshot) loadNormalized(
	ctx context.Context,
	tx bun.Tx,
	workspaceID string,
	candidateIDs []string,
) error {
	values := strings.TrimSuffix(strings.Repeat("(?),", len(candidateIDs)), ",")
	query := fmt.Sprintf(`
		WITH candidate_media(media_id) AS (VALUES %s),
		batch_scope(workspace_id) AS (VALUES (?))
		SELECT protection_kind, media_id FROM (
			SELECT 'organized' AS protection_kind, assignment.media_id
			FROM media_tag_assignments assignment
			JOIN media_tags tag ON tag.id = assignment.tag_id
			JOIN candidate_media candidate ON candidate.media_id = assignment.media_id
			WHERE tag.workspace_id = (SELECT workspace_id FROM batch_scope)
			UNION
			SELECT 'organized', item.media_id
			FROM media_collection_items item
			JOIN media_collections collection ON collection.id = item.collection_id
			JOIN candidate_media candidate ON candidate.media_id = item.media_id
			WHERE collection.workspace_id = (SELECT workspace_id FROM batch_scope)
			UNION
			SELECT 'reference', font.media_id
			FROM brand_fonts font
			JOIN brand_kits kit ON kit.id = font.brand_kit_id
			JOIN candidate_media candidate ON candidate.media_id = font.media_id
			WHERE kit.workspace_id = (SELECT workspace_id FROM batch_scope)
			UNION
			SELECT 'reference', reference.media_id
			FROM design_media_references reference
			JOIN design_documents document ON document.id = reference.design_document_id
			JOIN candidate_media candidate ON candidate.media_id = reference.media_id
			WHERE document.workspace_id = (SELECT workspace_id FROM batch_scope) AND document.deleted_at IS NULL
			UNION
			SELECT 'reference', reference.media_id
			FROM design_revision_media_references reference
			JOIN design_revisions revision ON revision.id = reference.revision_id
			JOIN design_documents document ON document.id = revision.design_document_id
			JOIN candidate_media candidate ON candidate.media_id = reference.media_id
			WHERE document.workspace_id = (SELECT workspace_id FROM batch_scope) AND document.deleted_at IS NULL
			UNION
			SELECT 'reference', reference.media_id
			FROM design_template_media_references reference
			JOIN design_templates template ON template.id = reference.design_template_id
			JOIN candidate_media candidate ON candidate.media_id = reference.media_id
			WHERE template.workspace_id = (SELECT workspace_id FROM batch_scope)
			UNION
			SELECT 'reference', asset.media_id
			FROM video_project_assets asset
			JOIN video_projects project ON project.id = asset.video_project_id
			JOIN candidate_media candidate ON candidate.media_id = asset.media_id
			WHERE project.workspace_id = (SELECT workspace_id FROM batch_scope) AND project.deleted_at IS NULL
			UNION
			SELECT 'reference', document.cover_preview_media_id
			FROM design_documents document
			JOIN candidate_media candidate ON candidate.media_id = document.cover_preview_media_id
			WHERE document.workspace_id = (SELECT workspace_id FROM batch_scope) AND document.deleted_at IS NULL
			UNION
			SELECT 'reference', page.preview_media_id
			FROM design_pages page
			JOIN design_documents document ON document.id = page.design_document_id
			JOIN candidate_media candidate ON candidate.media_id = page.preview_media_id
			WHERE document.workspace_id = (SELECT workspace_id FROM batch_scope) AND document.deleted_at IS NULL
			UNION
			SELECT 'reference', page.latest_export_media_id
			FROM design_pages page
			JOIN design_documents document ON document.id = page.design_document_id
			JOIN candidate_media candidate ON candidate.media_id = page.latest_export_media_id
			WHERE document.workspace_id = (SELECT workspace_id FROM batch_scope) AND document.deleted_at IS NULL
			UNION
			SELECT 'reference', template.preview_media_id
			FROM design_templates template
			JOIN candidate_media candidate ON candidate.media_id = template.preview_media_id
			WHERE template.workspace_id = (SELECT workspace_id FROM batch_scope)
			UNION
			SELECT 'reference', project.cover_preview_media_id
			FROM video_projects project
			JOIN candidate_media candidate ON candidate.media_id = project.cover_preview_media_id
			WHERE project.workspace_id = (SELECT workspace_id FROM batch_scope) AND project.deleted_at IS NULL
			UNION
			SELECT 'reference', child.parent_media_id
			FROM media_attachments child
			JOIN candidate_media candidate ON candidate.media_id = child.parent_media_id
			WHERE child.workspace_id = (SELECT workspace_id FROM batch_scope) AND child.parent_media_id <> ''
			UNION
			SELECT 'reference', post_media.media_id
			FROM post_media
			JOIN posts post ON post.id = post_media.post_id
			JOIN candidate_media candidate ON candidate.media_id = post_media.media_id
			WHERE post.workspace_id = (SELECT workspace_id FROM batch_scope) AND post.status NOT IN ('published', 'failed')
			UNION
			SELECT 'reference', asset.media_id
			FROM publication_assets asset
			JOIN publications publication ON publication.id = asset.publication_id
			JOIN candidate_media candidate ON candidate.media_id = asset.media_id
			WHERE publication.workspace_id = (SELECT workspace_id FROM batch_scope) AND publication.status NOT IN ('published', 'failed')
			UNION
			SELECT 'reference', segment_media.media_id
			FROM publication_segment_media segment_media
			JOIN publication_segments segment ON segment.id = segment_media.segment_id
			JOIN publications publication ON publication.id = segment.publication_id
			JOIN candidate_media candidate ON candidate.media_id = segment_media.media_id
			WHERE publication.workspace_id = (SELECT workspace_id FROM batch_scope) AND publication.status NOT IN ('published', 'failed')
			UNION
			SELECT 'reference', rendition_media.media_id
			FROM rendition_media
			JOIN renditions rendition ON rendition.id = rendition_media.rendition_id
			JOIN publications publication ON publication.id = rendition.publication_id
			JOIN candidate_media candidate ON candidate.media_id = rendition_media.media_id
			WHERE publication.workspace_id = (SELECT workspace_id FROM batch_scope) AND publication.status NOT IN ('published', 'failed')
			UNION
			SELECT 'reference', segment_media.media_id
			FROM rendition_segment_media segment_media
			JOIN rendition_segments segment ON segment.id = segment_media.rendition_segment_id
			JOIN renditions rendition ON rendition.id = segment.rendition_id
			JOIN publications publication ON publication.id = rendition.publication_id
			JOIN candidate_media candidate ON candidate.media_id = segment_media.media_id
			WHERE publication.workspace_id = (SELECT workspace_id FROM batch_scope) AND publication.status NOT IN ('published', 'failed')
			UNION
			SELECT 'reference', relation.related_media_id
			FROM rendition_media_delivery_relations relation
			JOIN rendition_media_deliveries delivery
			  ON delivery.rendition_id = relation.rendition_id
			 AND delivery.media_id = relation.delivery_media_id
			 AND delivery.workspace_id = relation.workspace_id
			JOIN publications publication ON publication.id = delivery.publication_id
			JOIN candidate_media candidate ON candidate.media_id = relation.related_media_id
			WHERE publication.workspace_id = (SELECT workspace_id FROM batch_scope) AND publication.status NOT IN ('published', 'failed')
		) AS protected_media`, values)
	args := make([]any, 0, len(candidateIDs)+1)
	for _, id := range candidateIDs {
		args = append(args, id)
	}
	args = append(args, workspaceID)
	var rows []protectionRow
	if err := tx.NewRaw(query, args...).Scan(ctx, &rows); err != nil {
		return fmt.Errorf("load normalized media protection set: %w", err)
	}
	for _, row := range rows {
		switch row.Kind {
		case "organized":
			snapshot.organized[row.MediaID] = struct{}{}
		case "reference":
			snapshot.referenced[row.MediaID] = struct{}{}
		default:
			return fmt.Errorf("load normalized media protection set: unknown kind %q", row.Kind)
		}
	}
	return nil
}

func (snapshot *protectionSnapshot) loadJSON(
	ctx context.Context,
	tx bun.Tx,
	workspaceID string,
	candidateIDs []string,
) error {
	var rows []jsonReferenceRow
	err := tx.NewRaw(`
		SELECT 'post_variant' AS reference_kind, variant.id AS owner_id, post.status AS owner_status, variant.media_ids AS payload
		FROM post_variants variant
		JOIN posts post ON post.id = variant.post_id
		WHERE post.workspace_id = ? AND variant.media_ids <> ''
		UNION ALL
		SELECT 'thread_draft', draft.post_id, post.status, draft.draft_json
		FROM thread_drafts draft
		JOIN posts post ON post.id = draft.post_id
		WHERE post.workspace_id = ?
		UNION ALL
		SELECT 'legacy_thread_draft', post.id, post.status, post.content
		FROM posts post
		WHERE post.workspace_id = ? AND post.content LIKE '__openpost_thread__:%'
		UNION ALL
		SELECT 'rendition_settings', rendition.id, publication.status, rendition.settings_json
		FROM renditions rendition
		JOIN publications publication ON publication.id = rendition.publication_id
		WHERE publication.workspace_id = ?
		UNION ALL
		SELECT 'publication_segment_settings', segment.id, publication.status, segment.settings_json
		FROM publication_segments segment
		JOIN publications publication ON publication.id = segment.publication_id
		WHERE publication.workspace_id = ?
		UNION ALL
		SELECT 'rendition_segment_settings', segment.id, publication.status, segment.settings_json
		FROM rendition_segments segment
		JOIN renditions rendition ON rendition.id = segment.rendition_id
		JOIN publications publication ON publication.id = rendition.publication_id
		WHERE publication.workspace_id = ?
		UNION ALL
		SELECT 'publication_segment_media_settings', segment_media.segment_id || ':' || segment_media.media_id,
		       publication.status, segment_media.settings_json
		FROM publication_segment_media segment_media
		JOIN publication_segments segment ON segment.id = segment_media.segment_id
		JOIN publications publication ON publication.id = segment.publication_id
		WHERE publication.workspace_id = ?
		UNION ALL
		SELECT 'rendition_segment_media_settings', segment_media.rendition_segment_id || ':' || segment_media.media_id,
		       publication.status, segment_media.settings_json
		FROM rendition_segment_media segment_media
		JOIN rendition_segments segment ON segment.id = segment_media.rendition_segment_id
		JOIN renditions rendition ON rendition.id = segment.rendition_id
		JOIN publications publication ON publication.id = rendition.publication_id
		WHERE publication.workspace_id = ?
	`, workspaceID, workspaceID, workspaceID, workspaceID, workspaceID, workspaceID, workspaceID, workspaceID).Scan(ctx, &rows)
	if err != nil {
		return fmt.Errorf("load JSON media reference set: %w", err)
	}
	candidates := make(map[string]struct{}, len(candidateIDs))
	for _, id := range candidateIDs {
		candidates[id] = struct{}{}
	}
	for _, row := range rows {
		ids, decodeErr := mediaIDsFromJSONReference(row)
		if decodeErr != nil {
			return fmt.Errorf("decode %s %s media references: %w", row.Kind, row.OwnerID, decodeErr)
		}
		if lifecycleStatusProtected(row.Status) {
			for _, id := range ids {
				if _, ok := candidates[id]; ok {
					snapshot.referenced[id] = struct{}{}
				}
			}
			continue
		}
		snapshot.legacyJSON = append(snapshot.legacyJSON, row)
	}
	return nil
}

func mediaIDsFromJSONReference(row jsonReferenceRow) ([]string, error) {
	switch row.Kind {
	case "post_variant":
		return decodeStringArray(row.Payload)
	case "thread_draft", "legacy_thread_draft":
		return threadDraftMediaIDs(row.Payload)
	default:
		return settingMediaIDs(row.Payload)
	}
}

func decodeStringArray(raw string) ([]string, error) {
	var ids []string
	if err := json.Unmarshal([]byte(raw), &ids); err != nil {
		return nil, err
	}
	return uniqueIDs(ids), nil
}

func threadDraftMediaIDs(raw string) ([]string, error) {
	decoded, err := decodeThreadDraft(raw)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0)
	if err := walkThreadDraftMedia(decoded, func(id string) { ids = append(ids, id) }, nil); err != nil {
		return nil, err
	}
	return uniqueIDs(ids), nil
}

func decodeThreadDraft(raw string) (map[string]any, error) {
	if !strings.HasPrefix(raw, threadDraftPrefix) {
		return nil, errors.New("thread draft prefix is missing")
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(strings.TrimPrefix(raw, threadDraftPrefix)), &decoded); err != nil {
		return nil, err
	}
	if decoded == nil {
		return nil, errors.New("thread draft must be a JSON object")
	}
	return decoded, nil
}

func walkThreadDraftMedia(node any, visit func(string), remove map[string]struct{}) error {
	switch value := node.(type) {
	case map[string]any:
		return walkThreadDraftMap(value, visit, remove)
	case []any:
		return walkThreadDraftArray(value, visit, remove)
	}
	return nil
}

func walkThreadDraftMap(value map[string]any, visit func(string), remove map[string]struct{}) error {
	for key, child := range value {
		if key == "m" || key == "mediaIds" {
			filtered, err := walkThreadMediaArray(key, child, visit, remove)
			if err != nil {
				return err
			}
			if remove != nil && child != nil {
				value[key] = filtered
			}
			continue
		}
		if err := walkThreadDraftMedia(child, visit, remove); err != nil {
			return err
		}
	}
	return nil
}

func walkThreadDraftArray(value []any, visit func(string), remove map[string]struct{}) error {
	for _, child := range value {
		if err := walkThreadDraftMedia(child, visit, remove); err != nil {
			return err
		}
	}
	return nil
}

func walkThreadMediaArray(key string, child any, visit func(string), remove map[string]struct{}) ([]any, error) {
	if child == nil {
		return nil, nil
	}
	items, ok := child.([]any)
	if !ok {
		return nil, fmt.Errorf("%s must be an array", key)
	}
	filtered := make([]any, 0, len(items))
	for _, item := range items {
		id, ok := item.(string)
		if !ok {
			return nil, fmt.Errorf("%s must contain only strings", key)
		}
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		visit(id)
		if _, drop := remove[id]; !drop {
			filtered = append(filtered, id)
		}
	}
	return filtered, nil
}

func settingMediaIDs(raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		raw = "{}"
	}
	var decoded any
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return nil, err
	}
	ids := make([]string, 0)
	if err := walkSettingMedia(decoded, func(id string) { ids = append(ids, id) }); err != nil {
		return nil, err
	}
	return uniqueIDs(ids), nil
}

func walkSettingMedia(node any, visit func(string)) error {
	switch value := node.(type) {
	case map[string]any:
		for key, child := range value {
			if _, ok := settingMediaKeys[key]; ok {
				if child == nil {
					continue
				}
				id, ok := child.(string)
				if !ok {
					return fmt.Errorf("%s must be a string", key)
				}
				id = strings.TrimSpace(id)
				if id != "" && !strings.HasPrefix(id, "http://") && !strings.HasPrefix(id, "https://") {
					visit(id)
				}
				continue
			}
			if err := walkSettingMedia(child, visit); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range value {
			if err := walkSettingMedia(child, visit); err != nil {
				return err
			}
		}
	}
	return nil
}

func lifecycleStatusProtected(status string) bool {
	status = strings.ToLower(strings.TrimSpace(status))
	return status != models.PostStatusPublished && status != models.PostStatusFailed
}

func (snapshot *protectionSnapshot) isReferenced(mediaID string) bool {
	_, ok := snapshot.referenced[mediaID]
	return ok
}

func (snapshot *protectionSnapshot) isOrganized(mediaID string) bool {
	_, ok := snapshot.organized[mediaID]
	return ok
}

func purgeMediaBatch(
	ctx context.Context,
	tx bun.Tx,
	snapshot *protectionSnapshot,
	media []models.MediaAttachment,
) error {
	ids := make([]string, 0, len(media))
	remove := make(map[string]struct{}, len(media))
	for _, item := range media {
		ids = append(ids, item.ID)
		remove[item.ID] = struct{}{}
	}
	if err := releaseDeletedEditorMediaOwnership(ctx, tx, ids); err != nil {
		return err
	}
	if err := rewriteHistoricalJSONReferences(ctx, tx, snapshot.legacyJSON, remove); err != nil {
		return err
	}
	for _, model := range []any{
		(*models.PostMedia)(nil),
		(*models.RenditionMedia)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.RenditionSegmentMedia)(nil),
		(*models.PublicationAsset)(nil),
	} {
		if _, err := tx.NewDelete().Model(model).Where("media_id IN (?)", bun.List(ids)).Exec(ctx); err != nil {
			return err
		}
	}
	result, err := tx.NewDelete().Model((*models.MediaAttachment)(nil)).
		Where("id IN (?)", bun.List(ids)).
		Exec(ctx)
	if err != nil {
		return err
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if deleted != int64(len(ids)) {
		return fmt.Errorf("purge media batch deleted %d of %d locked rows", deleted, len(ids))
	}
	return nil
}

func releaseDeletedEditorMediaOwnership(
	ctx context.Context,
	tx bun.Tx,
	mediaIDs []string,
) error {
	if len(mediaIDs) == 0 {
		return nil
	}
	if _, err := tx.NewDelete().Model((*models.DesignRevisionMediaReference)(nil)).
		Where("media_id IN (?)", bun.List(mediaIDs)).
		Where(`revision_id IN (
			SELECT revision.id
			FROM design_revisions revision
			JOIN design_documents document ON document.id = revision.design_document_id
			WHERE document.deleted_at IS NOT NULL
		)`).Exec(ctx); err != nil {
		return err
	}
	if _, err := tx.NewDelete().Model((*models.DesignMediaReference)(nil)).
		Where("media_id IN (?)", bun.List(mediaIDs)).
		Where(`design_document_id IN (
			SELECT id FROM design_documents WHERE deleted_at IS NOT NULL
		)`).Exec(ctx); err != nil {
		return err
	}
	if _, err := tx.NewDelete().Model((*models.VideoProjectAsset)(nil)).
		Where("media_id IN (?)", bun.List(mediaIDs)).
		Where(`video_project_id IN (
			SELECT id FROM video_projects WHERE deleted_at IS NOT NULL
		)`).Exec(ctx); err != nil {
		return err
	}
	return nil
}

func rewriteHistoricalJSONReferences(
	ctx context.Context,
	tx bun.Tx,
	rows []jsonReferenceRow,
	remove map[string]struct{},
) error {
	variantUpdates := make(map[string]string)
	threadUpdates := make(map[string]string)
	postUpdates := make(map[string]string)
	settingUpdates := map[string]map[string]string{
		"rendition_settings":                 {},
		"publication_segment_settings":       {},
		"rendition_segment_settings":         {},
		"publication_segment_media_settings": {},
		"rendition_segment_media_settings":   {},
	}
	for _, row := range rows {
		switch row.Kind {
		case "post_variant":
			updated, changed, err := rewriteStringArray(row.Payload, remove)
			if err != nil {
				return fmt.Errorf("rewrite post variant %s media references: %w", row.OwnerID, err)
			}
			if changed {
				variantUpdates[row.OwnerID] = updated
			}
		case "thread_draft", "legacy_thread_draft":
			updated, changed, err := rewriteThreadDraft(row.Payload, remove)
			if err != nil {
				return fmt.Errorf("rewrite %s %s media references: %w", row.Kind, row.OwnerID, err)
			}
			if !changed {
				continue
			}
			if row.Kind == "thread_draft" {
				threadUpdates[row.OwnerID] = updated
			} else {
				postUpdates[row.OwnerID] = updated
			}
		default:
			updates, ok := settingUpdates[row.Kind]
			if !ok {
				return fmt.Errorf("rewrite historical media references: unknown kind %q", row.Kind)
			}
			updated, changed, err := rewriteSettingMedia(row.Payload, remove)
			if err != nil {
				return fmt.Errorf("rewrite %s %s media references: %w", row.Kind, row.OwnerID, err)
			}
			if changed {
				updates[row.OwnerID] = updated
			}
		}
	}
	for _, update := range []struct {
		table, idColumn, valueColumn string
		values                       map[string]string
	}{
		{table: "post_variants", idColumn: "id", valueColumn: "media_ids", values: variantUpdates},
		{table: "thread_drafts", idColumn: "post_id", valueColumn: "draft_json", values: threadUpdates},
		{table: "posts", idColumn: "id", valueColumn: "content", values: postUpdates},
		{table: "renditions", idColumn: "id", valueColumn: "settings_json", values: settingUpdates["rendition_settings"]},
		{table: "publication_segments", idColumn: "id", valueColumn: "settings_json", values: settingUpdates["publication_segment_settings"]},
		{table: "rendition_segments", idColumn: "id", valueColumn: "settings_json", values: settingUpdates["rendition_segment_settings"]},
		{table: "publication_segment_media", idColumn: "segment_id || ':' || media_id", valueColumn: "settings_json", values: settingUpdates["publication_segment_media_settings"]},
		{table: "rendition_segment_media", idColumn: "rendition_segment_id || ':' || media_id", valueColumn: "settings_json", values: settingUpdates["rendition_segment_media_settings"]},
	} {
		if err := applyJSONUpdates(ctx, tx, update.table, update.idColumn, update.valueColumn, update.values); err != nil {
			return err
		}
	}
	return nil
}

func rewriteStringArray(raw string, remove map[string]struct{}) (string, bool, error) {
	ids, err := decodeStringArray(raw)
	if err != nil {
		return "", false, err
	}
	filtered := make([]string, 0, len(ids))
	changed := false
	for _, id := range ids {
		if _, drop := remove[id]; drop {
			changed = true
			continue
		}
		filtered = append(filtered, id)
	}
	if !changed {
		return raw, false, nil
	}
	encoded, err := json.Marshal(filtered)
	return string(encoded), true, err
}

func rewriteThreadDraft(raw string, remove map[string]struct{}) (string, bool, error) {
	decoded, err := decodeThreadDraft(raw)
	if err != nil {
		return "", false, err
	}
	changed := false
	visit := func(id string) {
		if _, drop := remove[id]; drop {
			changed = true
		}
	}
	if err := walkThreadDraftMedia(decoded, visit, remove); err != nil {
		return "", false, err
	}
	if !changed {
		return raw, false, nil
	}
	encoded, err := json.Marshal(decoded)
	if err != nil {
		return "", false, err
	}
	return threadDraftPrefix + string(encoded), true, nil
}

func rewriteSettingMedia(raw string, remove map[string]struct{}) (string, bool, error) {
	if strings.TrimSpace(raw) == "" {
		raw = "{}"
	}
	var decoded any
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return "", false, err
	}
	changed, err := removeSettingMedia(decoded, remove)
	if err != nil || !changed {
		return raw, changed, err
	}
	encoded, err := json.Marshal(decoded)
	return string(encoded), true, err
}

func removeSettingMedia(node any, remove map[string]struct{}) (bool, error) {
	switch value := node.(type) {
	case map[string]any:
		return removeSettingMediaFromMap(value, remove)
	case []any:
		changed := false
		for _, child := range value {
			childChanged, err := removeSettingMedia(child, remove)
			if err != nil {
				return false, err
			}
			changed = changed || childChanged
		}
		return changed, nil
	default:
		return false, nil
	}
}

func removeSettingMediaFromMap(value map[string]any, remove map[string]struct{}) (bool, error) {
	changed := false
	for key, child := range value {
		if _, isMediaKey := settingMediaKeys[key]; isMediaKey {
			removeKey, err := shouldRemoveSettingMedia(key, child, remove)
			if err != nil {
				return false, err
			}
			if removeKey {
				delete(value, key)
				changed = true
			}
			continue
		}
		childChanged, err := removeSettingMedia(child, remove)
		if err != nil {
			return false, err
		}
		changed = changed || childChanged
	}
	return changed, nil
}

func shouldRemoveSettingMedia(key string, value any, remove map[string]struct{}) (bool, error) {
	if value == nil {
		return false, nil
	}
	id, ok := value.(string)
	if !ok {
		return false, fmt.Errorf("%s must be a string", key)
	}
	_, shouldRemove := remove[strings.TrimSpace(id)]
	return shouldRemove, nil
}

func applyJSONUpdates(
	ctx context.Context,
	tx bun.Tx,
	table, idColumn, valueColumn string,
	values map[string]string,
) error {
	if len(values) == 0 {
		return nil
	}
	ids := make([]string, 0, len(values))
	for id := range values {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for start := 0; start < len(ids); start += jsonUpdateBatchSize {
		end := min(start+jsonUpdateBatchSize, len(ids))
		batch := ids[start:end]
		var statement strings.Builder
		fmt.Fprintf(&statement, "UPDATE %s SET %s = CASE %s", table, valueColumn, idColumn)
		args := make([]any, 0, len(batch)*3)
		for _, id := range batch {
			statement.WriteString(" WHEN ? THEN ?")
			args = append(args, id, values[id])
		}
		fmt.Fprintf(&statement, " ELSE %s END WHERE %s IN (", valueColumn, idColumn)
		for index, id := range batch {
			if index > 0 {
				statement.WriteByte(',')
			}
			statement.WriteByte('?')
			args = append(args, id)
		}
		statement.WriteByte(')')
		if _, err := tx.ExecContext(ctx, statement.String(), args...); err != nil {
			return fmt.Errorf("rewrite %s.%s media references: %w", table, valueColumn, err)
		}
	}
	return nil
}

func (s *Service) deletePurgedObjects(media []models.MediaAttachment) {
	if s.storage == nil || len(media) == 0 {
		return
	}
	seen := make(map[string]struct{}, len(media)*4)
	for _, item := range media {
		keys := make([]string, 0, 4)
		if filePath := strings.TrimSpace(item.FilePath); filePath != "" {
			if base := filepath.Base(filePath); base != "." {
				keys = append(keys, base)
			}
		}
		keys = append(keys, item.ThumbnailObjectKey)
		var thumbs struct {
			SM string `json:"sm"`
			MD string `json:"md"`
		}
		_ = json.Unmarshal([]byte(item.ThumbnailsJSON), &thumbs)
		keys = append(keys, thumbs.SM, thumbs.MD)
		for _, key := range keys {
			key = strings.TrimSpace(key)
			if key == "" {
				continue
			}
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			if err := s.storage.Delete(key); err != nil {
				log.Printf("failed to purge media object %s for %s: %v", key, item.ID, err)
			}
		}
	}
}
