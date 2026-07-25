package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsBackfillsSocialAccountSlugs(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Workspace"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID:             "account-123456789",
		WorkspaceID:    "ws-1",
		Platform:       "x",
		AccountID:      "123",
		AccessTokenEnc: []byte("token"),
		IsActive:       true,
	}).Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, RunMigrations(db))

	var account models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&account).Where("id = ?", "account-123456789").Scan(ctx))
	require.Equal(t, "x-account", account.Slug)
}

func TestRunMigrationsSocialAccountSlugUniquePerActiveWorkspace(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, RunMigrations(db))

	accounts := []models.SocialAccount{
		{ID: "acc-1", WorkspaceID: "ws-1", Slug: "main-x", Platform: "x", AccountID: "1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "acc-2", WorkspaceID: "ws-2", Slug: "main-x", Platform: "x", AccountID: "2", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "acc-3", WorkspaceID: "ws-1", Slug: "inactive-x", Platform: "x", AccountID: "3", AccessTokenEnc: []byte("token"), IsActive: true},
	}
	_, err := db.NewInsert().Model(&accounts).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().
		Model((*models.SocialAccount)(nil)).
		Set("slug = ?", "main-x").
		Set("is_active = ?", false).
		Where("id = ?", "acc-3").
		Exec(ctx)
	require.NoError(t, err)

	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID:             "acc-4",
		WorkspaceID:    "ws-1",
		Slug:           "main-x",
		Platform:       "x",
		AccountID:      "4",
		AccessTokenEnc: []byte("token"),
		IsActive:       true,
	}).Exec(ctx)
	require.Error(t, err)
}
