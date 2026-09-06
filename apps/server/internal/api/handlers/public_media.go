package handlers

import (
	"context"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/publicurl"
	"github.com/uptrace/bun"
)

func refreshPublicMediaState(
	ctx context.Context,
	db bun.IDB,
	verifier *publicurl.MediaVerifier,
	media *models.MediaAttachment,
) error {
	if verifier == nil || media == nil || !verifier.NeedsRefresh(*media) {
		return nil
	}
	result := verifier.Verify(ctx, *media)
	applyPublicMediaResult(media, result)
	if db == nil || media.ID == "" {
		return nil
	}
	_, err := db.NewUpdate().
		Model(media).
		Column("public_url_ready", "public_url_checked_at", "public_url_status", "public_url_error").
		Where("id = ?", media.ID).
		Exec(ctx)
	return err
}

func applyPublicMediaResult(media *models.MediaAttachment, result publicurl.Result) {
	media.PublicURLReady = result.Ready
	media.PublicURLCheckedAt = result.CheckedAt
	media.PublicURLStatus = result.StatusCode
	media.PublicURLError = result.Error
}
