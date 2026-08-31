package migrations

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsOAuthAccountSelectionsUsable(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-selection", Name: "Selection"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.OAuthAccountSelection{
		ID:             "selection-1",
		UserID:         "user-1",
		WorkspaceID:    "ws-selection",
		Platform:       "facebook",
		AccessTokenEnc: []byte("encrypted-token"),
		OptionsJSON:    `[{"id":"page-1","display_name":"Main Page"}]`,
		ExpiresAt:      time.Now().UTC().Add(time.Minute),
	}).Exec(ctx)
	require.NoError(t, err)

	var stored models.OAuthAccountSelection
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", "selection-1").Scan(ctx))
	require.Equal(t, "facebook", stored.Platform)
	require.Contains(t, stored.OptionsJSON, "Main Page")
}
