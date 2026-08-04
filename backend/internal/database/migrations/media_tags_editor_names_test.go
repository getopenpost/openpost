package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestEnsureMediaTagMigrationConvertsCollectionsWithoutDuplicates(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()

	_, err := db.ExecContext(ctx, `
		CREATE TABLE media_collections (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			name TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
		);
		CREATE TABLE media_collection_items (
			collection_id TEXT NOT NULL,
			media_id TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			PRIMARY KEY (collection_id, media_id)
		);
		CREATE TABLE media_tags (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			name TEXT NOT NULL,
			normalized_name TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			UNIQUE (workspace_id, normalized_name)
		);
		CREATE TABLE media_tag_assignments (
			tag_id TEXT NOT NULL,
			media_id TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			PRIMARY KEY (tag_id, media_id)
		)
	`)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `
		INSERT INTO media_collections (id, workspace_id, name) VALUES
			('legacy-inbox', 'workspace', ' Inbox '),
			('legacy-campaign', 'workspace', 'Campaign');
		INSERT INTO media_collection_items (collection_id, media_id) VALUES
			('legacy-inbox', 'media-1'),
			('legacy-campaign', 'media-2');
		INSERT INTO media_tags (id, workspace_id, name, normalized_name)
		VALUES ('existing-inbox', 'workspace', 'Inbox', 'inbox')
	`)
	require.NoError(t, err)

	require.NoError(t, ensureMediaTagMigration(ctx, db))
	require.NoError(t, ensureMediaTagMigration(ctx, db))

	var tagCount int
	require.NoError(t, db.QueryRowContext(ctx, "SELECT COUNT(*) FROM media_tags").Scan(&tagCount))
	require.Equal(t, 2, tagCount)

	var campaignTagID string
	require.NoError(t, db.QueryRowContext(ctx, `
		SELECT id FROM media_tags WHERE workspace_id = 'workspace' AND normalized_name = 'campaign'
	`).Scan(&campaignTagID))
	require.Equal(t, "legacy-campaign", campaignTagID)

	type assignment struct {
		TagID   string `bun:"tag_id"`
		MediaID string `bun:"media_id"`
	}
	var assignments []assignment
	require.NoError(t, db.NewRaw(`
		SELECT tag_id, media_id FROM media_tag_assignments ORDER BY media_id
	`).Scan(ctx, &assignments))
	require.Equal(t, []assignment{
		{TagID: "existing-inbox", MediaID: "media-1"},
		{TagID: "legacy-campaign", MediaID: "media-2"},
	}, assignments)
}

func TestEditorNameMigrationRenamesCanonicalStoredValues(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()

	_, err := db.ExecContext(ctx, `
		CREATE TABLE instance_settings (key TEXT PRIMARY KEY, value_encrypted BLOB NOT NULL);
		CREATE TABLE video_projects (id TEXT PRIMARY KEY, document_json TEXT NOT NULL);
		CREATE TABLE billing_subscriptions (plan_id TEXT NOT NULL, entitlement_snapshot TEXT NOT NULL);
		CREATE TABLE billing_checkout_attempts (plan_id TEXT NOT NULL);
		CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)
	`)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `
		INSERT INTO instance_settings (key, value_encrypted) VALUES
			('OPENPOST_STUDIO_ENABLED', x'01'),
			('OPENPOST_STUDIO_MODEL_BASE_URL', x'02'),
			('OPENPOST_VIDEO_STUDIO_ENABLED', x'03'),
			('OPENPOST_WHOP_CREATOR_MONTHLY_PLAN_ID', x'04'),
			('OPENPOST_WHOP_CREATOR_ANNUAL_PLAN_ID', x'05');
		INSERT INTO media_attachments (id, workspace_id, file_path, mime_type, size, original_filename, source)
		VALUES
			('image-export', 'workspace', 'image-export', 'image/png', 1, 'image.png', 'studio_export'),
			('video-source', 'workspace', 'video-source', 'video/mp4', 1, 'video.mp4', 'video_studio_source');
		INSERT INTO video_projects (id, document_json)
		VALUES ('project', '{"editing_mode":"studio","title":"Studio is user content"}');
		INSERT INTO billing_subscriptions (plan_id, entitlement_snapshot)
		VALUES ('creator', '{"plan_id":"creator","limits":{}}');
		INSERT INTO billing_checkout_attempts (plan_id) VALUES ('creator')
	`)
	require.NoError(t, err)

	sqlBytes, err := migrationFiles.ReadFile("063_editor_names.sql")
	require.NoError(t, err)
	require.NoError(t, ensureEditorNameMigration(ctx, db))
	require.NoError(t, runMigration(ctx, db, migration{
		version: 63,
		name:    "063_editor_names.sql",
		sql:     string(sqlBytes),
	}))

	var settingKeys []string
	require.NoError(t, db.NewRaw("SELECT key FROM instance_settings ORDER BY key").Scan(ctx, &settingKeys))
	require.Equal(t, []string{
		"OPENPOST_IMAGE_EDITOR_ENABLED",
		"OPENPOST_IMAGE_EDITOR_MODEL_BASE_URL",
		"OPENPOST_VIDEO_EDITOR_ENABLED",
		"OPENPOST_WHOP_FOUNDER_ANNUAL_PLAN_ID",
		"OPENPOST_WHOP_FOUNDER_MONTHLY_PLAN_ID",
	}, settingKeys)

	var sources []string
	require.NoError(t, db.NewRaw("SELECT source FROM media_attachments ORDER BY id").Scan(ctx, &sources))
	require.Equal(t, []string{"image_editor_export", "video_editor_source"}, sources)

	var documentJSON string
	require.NoError(t, db.QueryRowContext(ctx, "SELECT document_json FROM video_projects WHERE id = 'project'").Scan(&documentJSON))
	require.Equal(t, `{"editing_mode":"editor","title":"Studio is user content"}`, documentJSON)

	var subscriptionPlanID, entitlementSnapshot, attemptPlanID string
	require.NoError(t, db.QueryRowContext(ctx, "SELECT plan_id, entitlement_snapshot FROM billing_subscriptions").Scan(&subscriptionPlanID, &entitlementSnapshot))
	require.Equal(t, "founder", subscriptionPlanID)
	require.Equal(t, `{"plan_id":"founder","limits":{}}`, entitlementSnapshot)
	require.NoError(t, db.QueryRowContext(ctx, "SELECT plan_id FROM billing_checkout_attempts").Scan(&attemptPlanID))
	require.Equal(t, "founder", attemptPlanID)
}
