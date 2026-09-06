package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

// backfillPublicationTextEditors was the migration-41 prepare step that kept a
// Post editor row in sync with each canonical text/thread Publication. The Post
// compatibility projection is retired, so new installations and upgrades no
// longer need an editor row. The function remains as a no-op because migration
// history still records version 41 and the prepare step must not fail.
func backfillPublicationTextEditors(_ context.Context, _ *bun.DB) error {
	return nil
}
