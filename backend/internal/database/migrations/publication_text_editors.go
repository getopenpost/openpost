package migrations

import (
	"context"
	"database/sql"

	"github.com/openpost/backend/internal/models"
	postservice "github.com/openpost/backend/internal/services/posts"
	"github.com/uptrace/bun"
)

func backfillPublicationTextEditors(ctx context.Context, db *bun.DB) error {
	requiredTables := []string{
		"posts",
		"post_destinations",
		"post_media",
		"post_variants",
		"thread_drafts",
		"publication_segments",
		"publication_segment_media",
		"renditions",
		"rendition_segments",
		"rendition_segment_media",
	}
	for _, table := range requiredTables {
		exists, err := migrationTableExists(ctx, db, table)
		if err != nil {
			return err
		}
		if !exists {
			return nil
		}
	}

	var publications []models.Publication
	if err := db.NewSelect().
		Model(&publications).
		Column(
			"id", "workspace_id", "created_by", "title", "intent", "content_profile",
			"source_text", "source_content", "source_url", "goal", "audience", "status",
			"revision", "scheduled_at", "actual_run_at", "metadata_json", "release_plan_json",
			"repost_override_json", "created_at", "updated_at",
		).
		Where("intent IN (?)", bun.List([]string{
			models.PublishingIntentPost,
			models.PublishingIntentThread,
		})).
		Order("created_at ASC", "id ASC").
		Scan(ctx); err != nil {
		return err
	}
	for index := range publications {
		publication := &publications[index]
		count, err := db.NewSelect().
			Model((*models.Post)(nil)).
			Where("publication_id = ?", publication.ID).
			Count(ctx)
		if err != nil {
			return err
		}
		if count > 0 {
			continue
		}
		if err := db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			_, err := postservice.EnsurePublicationEditorTx(txCtx, tx, publication)
			return err
		}); err != nil {
			return err
		}
	}
	return nil
}
