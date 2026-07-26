package migrations

import (
	"context"
	"database/sql"

	"github.com/openpost/backend/internal/models"
	postservice "github.com/openpost/backend/internal/services/posts"
	"github.com/uptrace/bun"
)

func backfillPublicationTextEditors(ctx context.Context, db *bun.DB) error {
	var publications []models.Publication
	if err := db.NewSelect().
		Model(&publications).
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
		if err := db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			_, err := postservice.EnsurePublicationEditorTx(txCtx, tx, publication)
			return err
		}); err != nil {
			return err
		}
	}
	return nil
}
