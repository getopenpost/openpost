package migrations

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesVideoEditorSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	require.NoError(t, runTestMigrations(t, db))

	for _, table := range []string{
		"video_projects",
		"video_project_assets",
		"video_project_revisions",
		"video_return_tokens",
		"media_provenance",
		"stock_search_cache",
	} {
		var count int
		require.NoError(t, db.NewSelect().
			ColumnExpr("COUNT(*)").
			TableExpr("sqlite_master").
			Where("type = 'table' AND name = ?", table).
			Scan(ctx, &count))
		require.Equal(t, 1, count, table)
	}
}

func TestVideoEditorProjectAssetsCascadeAndRestrictMedia(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "Workspace"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.MediaAttachment{
		ID: "media-1", WorkspaceID: "workspace-1", FilePath: "media-1.mp4",
		MimeType: "video/mp4", FileHash: "hash-1", Size: 10,
	}).Exec(ctx)
	require.NoError(t, err)

	now := time.Now().UTC()
	_, err = db.ExecContext(ctx, `
		INSERT INTO video_projects (
			id, workspace_id, created_by_id, title, document_json, created_at, updated_at
		) VALUES ('project-1', 'workspace-1', 'user-1', 'Project', '{}', ?, ?)
	`, now, now)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO video_project_assets (video_project_id, source_id, media_id)
		VALUES ('project-1', 'source-1', 'media-1')
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO media_provenance (
			media_id, provider, external_id, source_url, creator_name, creator_url,
			license_name, license_url, attribution_text
		) VALUES (
			'media-1', 'pexels', 'asset-1', 'https://example.com/source', 'Creator',
			'https://example.com/creator', 'Pexels', 'https://example.com/license', 'Creator / Pexels'
		)
	`)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, "DELETE FROM media_attachments WHERE id = 'media-1'")
	require.Error(t, err)

	_, err = db.ExecContext(ctx, "DELETE FROM video_projects WHERE id = 'project-1'")
	require.NoError(t, err)
	var assetCount int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").
		TableExpr("video_project_assets").Scan(ctx, &assetCount))
	require.Zero(t, assetCount)

	_, err = db.ExecContext(ctx, "DELETE FROM media_attachments WHERE id = 'media-1'")
	require.NoError(t, err)
	var provenanceCount int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").
		TableExpr("media_provenance").Scan(ctx, &provenanceCount))
	require.Zero(t, provenanceCount)
}
