package publisher

import (
	"context"
	"fmt"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

// A remote object can exist while later publishing steps still need a retry.
// Persist its identity without marking the rendition successfully published.
func saveRenditionExternalIdentity(ctx context.Context, db bun.IDB, renditionID, externalID, externalURL string) error {
	_, err := db.NewUpdate().Model((*models.Rendition)(nil)).
		Set("external_id = ?", externalID).
		Set("external_url = ?", externalURL).
		Where("id = ?", renditionID).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("saving rendition remote identity: %w", err)
	}
	return nil
}
