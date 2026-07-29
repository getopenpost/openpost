package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesProviderMediaStatesSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, RunMigrations(db))

	row := db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'provider_media_states'")
	var schema string
	require.NoError(t, row.Scan(&schema))
	require.Contains(t, schema, "PRIMARY KEY (post_id, social_account_id, media_id)")
	require.Contains(t, schema, "platform_media_id TEXT NOT NULL")
	require.Contains(t, schema, "status TEXT NOT NULL DEFAULT 'ready'")
	require.Contains(t, schema, "FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE")
	require.Contains(t, schema, "FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE")
	require.Contains(t, schema, "FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE CASCADE")

	var indexCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("sqlite_master").
		Where("type = 'index' AND name IN ('provider_media_states_account_status_idx', 'provider_media_states_media_idx')").
		Scan(ctx, &indexCount))
	require.Equal(t, 2, indexCount)
}

func TestRunMigrationsProviderMediaStatesCascadeWithPost(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, RunMigrations(db))

	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-provider-media", Name: "Provider Media"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID:             "account-provider-media",
		WorkspaceID:    "ws-provider-media",
		Platform:       "x",
		AccountID:      "x-1",
		Slug:           "x-provider-media",
		AccessTokenEnc: []byte("token"),
		IsActive:       true,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.MediaAttachment{
		ID:               "media-provider-state",
		WorkspaceID:      "ws-provider-media",
		FilePath:         "media-provider-state.png",
		MimeType:         "image/png",
		ProcessingStatus: "ready",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Post{
		ID:          "post-provider-state",
		WorkspaceID: "ws-provider-media",
		CreatedByID: "user-1",
		Content:     "Provider media state",
		Status:      models.PostStatusScheduled,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ProviderMediaState{
		PostID:          "post-provider-state",
		SocialAccountID: "account-provider-media",
		MediaID:         "media-provider-state",
		Platform:        "x",
		PlatformMediaID: "platform-media-1",
		Status:          "ready",
	}).Exec(ctx)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, "DELETE FROM posts WHERE id = ?", "post-provider-state")
	require.NoError(t, err)

	var count int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("provider_media_states").Scan(ctx, &count))
	require.Equal(t, 0, count)
}
