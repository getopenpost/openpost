package migrations

import (
	"context"
	"errors"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesPublicationSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, runTestMigrations(t, db))

	row := db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'publications'")
	var publicationSchema string
	require.NoError(t, row.Scan(&publicationSchema))
	require.Contains(t, publicationSchema, "workspace_id TEXT NOT NULL")
	require.Contains(t, publicationSchema, "created_by TEXT NOT NULL")
	require.Contains(t, publicationSchema, "source_content TEXT NOT NULL DEFAULT ''")
	require.Contains(t, publicationSchema, "release_plan_json TEXT NOT NULL DEFAULT '{}'")
	require.Contains(t, publicationSchema, "revision INTEGER NOT NULL DEFAULT 1")
	require.Contains(t, publicationSchema, "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE")
	require.Contains(t, publicationSchema, "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE")

	row = db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'publication_assets'")
	var assetSchema string
	require.NoError(t, row.Scan(&assetSchema))
	require.Contains(t, assetSchema, "PRIMARY KEY (publication_id, media_id)")
	require.Contains(t, assetSchema, "FOREIGN KEY (publication_id) REFERENCES publications(id) ON DELETE CASCADE")
	require.Contains(t, assetSchema, "FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE CASCADE")

	row = db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'posts'")
	var postSchema string
	require.NoError(t, row.Scan(&postSchema))
	require.Contains(t, postSchema, "publication_id")
	require.Contains(t, postSchema, `"revision" INTEGER NOT NULL DEFAULT 1`)
	require.Contains(t, postSchema, `"updated_at" TIMESTAMP NOT NULL DEFAULT current_timestamp`)

	row = db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'draft_revision_changes'")
	var revisionSchema string
	require.NoError(t, row.Scan(&revisionSchema))
	require.Contains(t, revisionSchema, "PRIMARY KEY (aggregate_type, aggregate_id, revision)")

	var indexCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("sqlite_master").
		Where("type = 'index' AND name IN ('publications_workspace_status_idx', 'publications_created_by_idx', 'publication_assets_media_idx', 'posts_publication_id_idx')").
		Scan(ctx, &indexCount))
	require.Equal(t, 4, indexCount)

	_, err := db.NewInsert().Model(&models.DraftRevisionChange{
		AggregateType:  "publication",
		AggregateID:    "publication-1",
		Revision:       1,
		ChangedDomains: `["content"]`,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.DraftRevisionChange{
		AggregateType:  "publication",
		AggregateID:    "publication-1",
		Revision:       1,
		ChangedDomains: `["media"]`,
	}).Exec(ctx)
	require.Error(t, err)
	require.NoError(t, runTestMigrations(t, db))
}

func TestDraftRevisionMigrationUpgradesPopulatedSQLitePosts(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	runMigrationsThrough(t, db, 37)

	_, err := db.ExecContext(ctx, "PRAGMA foreign_keys=OFF")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, "DROP TABLE posts")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `CREATE TABLE posts (
		"id" VARCHAR NOT NULL,
		"workspace_id" VARCHAR NOT NULL,
		"created_by" VARCHAR NOT NULL,
		"publication_id" VARCHAR,
		"content" VARCHAR NOT NULL,
		"parent_post_id" VARCHAR,
		"thread_sequence" INTEGER DEFAULT 0,
		"status" VARCHAR NOT NULL,
		"scheduled_at" TIMESTAMP,
		"published_at" TIMESTAMP,
		"random_delay_minutes" INTEGER DEFAULT 0,
		"actual_run_at" TIMESTAMP,
		"created_at" TIMESTAMP NOT NULL DEFAULT current_timestamp,
		PRIMARY KEY ("id")
	)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, "CREATE INDEX posts_status_upgrade_test_idx ON posts (status)")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `CREATE TRIGGER posts_status_upgrade_test_trigger
		AFTER UPDATE OF status ON posts BEGIN SELECT NEW.status; END`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO posts
		(id, workspace_id, created_by, content, status, created_at)
		VALUES ('legacy-post', 'legacy-workspace', 'legacy-user', 'saved draft', 'draft', '2026-07-13 09:24:27')`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO thread_drafts (post_id, draft_json)
		VALUES ('legacy-post', '{"segments":["saved draft"]}')`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, "PRAGMA foreign_keys=ON")
	require.NoError(t, err)

	require.NoError(t, runTestMigrations(t, db))

	var revision int
	var updatedAt string
	require.NoError(t, db.QueryRowContext(ctx,
		"SELECT revision, updated_at FROM posts WHERE id = 'legacy-post'",
	).Scan(&revision, &updatedAt))
	require.Equal(t, 1, revision)
	require.Equal(t, "2026-07-13T09:24:27Z", updatedAt)

	row := db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'posts'")
	var postSchema string
	require.NoError(t, row.Scan(&postSchema))
	require.Contains(t, postSchema, `"updated_at" TIMESTAMP NOT NULL DEFAULT current_timestamp`)
	for _, objectName := range []string{"posts_status_upgrade_test_idx", "posts_status_upgrade_test_trigger"} {
		var count int
		require.NoError(t, db.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM sqlite_master WHERE name = ?", objectName,
		).Scan(&count))
		require.Equal(t, 1, count, objectName)
	}

	_, err = db.ExecContext(ctx, `INSERT INTO posts
		(id, workspace_id, created_by, content, status, created_at)
		VALUES ('new-post', 'new-workspace', 'new-user', 'new draft', 'draft', current_timestamp)`)
	require.NoError(t, err)
	var defaultedUpdatedAt string
	require.NoError(t, db.QueryRowContext(ctx,
		"SELECT updated_at FROM posts WHERE id = 'new-post'",
	).Scan(&defaultedUpdatedAt))
	require.NotEmpty(t, defaultedUpdatedAt)
	require.NoError(t, runTestMigrations(t, db))

	_, err = db.ExecContext(ctx, "DELETE FROM posts WHERE id = 'legacy-post'")
	require.NoError(t, err)
	var threadDraftCount int
	require.NoError(t, db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM thread_drafts WHERE post_id = 'legacy-post'",
	).Scan(&threadDraftCount))
	require.Zero(t, threadDraftCount)
}

func TestRunMigrationsPublicationsAreInsertable(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-publication", Name: "Publication"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.MediaAttachment{
		ID:               "media-publication",
		WorkspaceID:      "ws-publication",
		FilePath:         "media-publication.png",
		StorageType:      "local",
		MimeType:         "image/png",
		ProcessingStatus: "ready",
		OriginalFilename: "media-publication.png",
		FileHash:         "media-publication-hash",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID:              "pub-1",
		WorkspaceID:     "ws-publication",
		CreatedByID:     "user-1",
		Title:           "Launch OpenPost MCP",
		SourceContent:   "OpenPost now supports agentic scheduling.",
		Goal:            "announce",
		Audience:        "builders",
		Status:          models.PublicationStatusDraft,
		ReleasePlanJSON: "{}",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PublicationAsset{
		PublicationID: "pub-1",
		MediaID:       "media-publication",
		DisplayOrder:  1,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Post{
		ID:            "post-publication",
		WorkspaceID:   "ws-publication",
		CreatedByID:   "user-1",
		PublicationID: "pub-1",
		Content:       "OpenPost now supports agentic scheduling.",
		Status:        models.PostStatusDraft,
	}).Exec(ctx)
	require.NoError(t, err)

	var post models.Post
	require.NoError(t, db.NewSelect().Model(&post).Where("id = ?", "post-publication").Scan(ctx))
	require.Equal(t, "pub-1", post.PublicationID)
}

func TestRunMigrationsPublicationAssetsCascadeWithPublication(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-cascade", Name: "Cascade"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.MediaAttachment{
		ID:               "media-cascade",
		WorkspaceID:      "ws-cascade",
		FilePath:         "media-cascade.png",
		StorageType:      "local",
		MimeType:         "image/png",
		ProcessingStatus: "ready",
		OriginalFilename: "media-cascade.png",
		FileHash:         "media-cascade-hash",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID:              "pub-cascade",
		WorkspaceID:     "ws-cascade",
		CreatedByID:     "user-1",
		Title:           "Cascade",
		SourceContent:   "Delete me.",
		Status:          models.PublicationStatusDraft,
		ReleasePlanJSON: "{}",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PublicationAsset{
		PublicationID: "pub-cascade",
		MediaID:       "media-cascade",
	}).Exec(ctx)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, "DELETE FROM publications WHERE id = ?", "pub-cascade")
	require.NoError(t, err)

	var count int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("publication_assets").Scan(ctx, &count))
	require.Equal(t, 0, count)
}

func TestDuplicateColumnMigrationErrorMatchesSQLiteAndPostgres(t *testing.T) {
	t.Parallel()

	require.True(t, isDuplicateColumnMigrationError(
		"ALTER TABLE posts ADD COLUMN publication_id TEXT",
		errors.New("duplicate column name: publication_id"),
	))
	require.True(t, isDuplicateColumnMigrationError(
		"ALTER TABLE posts ADD COLUMN publication_id TEXT",
		errors.New(`pq: column "publication_id" of relation "posts" already exists`),
	))
	require.False(t, isDuplicateColumnMigrationError(
		"CREATE TABLE publications (id TEXT PRIMARY KEY)",
		errors.New("table publications already exists"),
	))
}
