package migrations

import (
	"context"
	"testing"
	"testing/fstest"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

const migration074ReplayFixture = `
CREATE TABLE post_media_deliveries (id TEXT PRIMARY KEY);
INSERT INTO post_media_deliveries (id) SELECT id FROM provider_media_states;
CREATE TABLE rendition_media_deliveries (id TEXT PRIMARY KEY);
CREATE TABLE rendition_media_delivery_relations (id TEXT PRIMARY KEY);
DROP TABLE provider_media_states;
`

func TestRunMigrationsRepairsMediaRecipeMigration074Collision(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMisrecordedMediaRecipeMigration074(ctx, t, db)

	source := fstest.MapFS{
		"074_rendition_media_deliveries.sql": &fstest.MapFile{Data: []byte(migration074ReplayFixture)},
	}
	require.NoError(t, runMigrations(db, source))

	for _, table := range []string{
		"post_media_deliveries",
		"rendition_media_deliveries",
		"rendition_media_delivery_relations",
	} {
		exists, err := migrationTableExists(ctx, db, table)
		require.NoError(t, err)
		require.True(t, exists, "expected replayed migration 074 to create %s", table)
	}
	legacyProviderStateExists, err := migrationTableExists(ctx, db, "provider_media_states")
	require.NoError(t, err)
	require.False(t, legacyProviderStateExists)
	var migratedProviderStateID string
	require.NoError(t, db.NewSelect().TableExpr("post_media_deliveries").Column("id").Scan(ctx, &migratedProviderStateID))
	require.Equal(t, "provider-state-1", migratedProviderStateID)

	var recipe models.MediaGenerationRecipe
	require.NoError(t, db.NewSelect().Model(&recipe).Where("media_id = ?", "media-1").Scan(ctx))
	require.Equal(t, `{"captions":["old 074 data"]}`, recipe.RecipeJSON)

	var applied SchemaMigration
	require.NoError(t, db.NewSelect().Model(&applied).Where("version = ?", 74).Scan(ctx))
	require.NotEqual(t, int64(1), applied.AppliedAt)

	// The repaired schema is no longer a collision signature, so another startup
	// must neither replay the migration nor replace its history row.
	repairedAt := applied.AppliedAt
	require.NoError(t, runMigrations(db, source))
	require.NoError(t, db.NewSelect().Model(&applied).Where("version = ?", 74).Scan(ctx))
	require.Equal(t, repairedAt, applied.AppliedAt)
	require.NoError(t, db.NewSelect().Model(&recipe).Where("media_id = ?", "media-1").Scan(ctx))
	require.Equal(t, `{"captions":["old 074 data"]}`, recipe.RecipeJSON)
}

func TestRunMigrationsLeavesValidMigration074HistoryUntouched(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name           string
		createRecipe   bool
		createProvider bool
		outputTables   []string
	}{
		{
			name:           "unrelated migration 074",
			createProvider: true,
		},
		{
			name:         "recipe table without legacy provider state",
			createRecipe: true,
		},
		{
			name:           "partial schema missing post deliveries",
			createRecipe:   true,
			createProvider: true,
			outputTables: []string{
				"rendition_media_deliveries",
				"rendition_media_delivery_relations",
			},
		},
		{
			name:           "partial schema missing rendition deliveries",
			createRecipe:   true,
			createProvider: true,
			outputTables: []string{
				"post_media_deliveries",
				"rendition_media_delivery_relations",
			},
		},
		{
			name:           "partial schema missing delivery relations",
			createRecipe:   true,
			createProvider: true,
			outputTables: []string{
				"post_media_deliveries",
				"rendition_media_deliveries",
			},
		},
		{
			name:         "real migration 074 already present",
			createRecipe: true,
			outputTables: []string{
				"post_media_deliveries",
				"rendition_media_deliveries",
				"rendition_media_delivery_relations",
			},
		},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			db := newMigrationsTestDB(t)
			ctx := context.Background()
			_, err := db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(ctx)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&SchemaMigration{Version: 74, AppliedAt: 123}).Exec(ctx)
			require.NoError(t, err)
			if test.createRecipe {
				_, err = db.ExecContext(ctx, "CREATE TABLE media_generation_recipes (media_id TEXT PRIMARY KEY)")
				require.NoError(t, err)
			}
			if test.createProvider {
				_, err = db.ExecContext(ctx, "CREATE TABLE provider_media_states (id TEXT PRIMARY KEY)")
				require.NoError(t, err)
			}
			for _, table := range test.outputTables {
				_, err = db.ExecContext(ctx, "CREATE TABLE "+table+" (id TEXT PRIMARY KEY)")
				require.NoError(t, err)
			}

			source := fstest.MapFS{
				"074_rendition_media_deliveries.sql": &fstest.MapFile{
					Data: []byte("CREATE TABLE migration_074_replay_probe (id TEXT PRIMARY KEY);"),
				},
			}
			require.NoError(t, runMigrations(db, source))

			var applied SchemaMigration
			require.NoError(t, db.NewSelect().Model(&applied).Where("version = ?", 74).Scan(ctx))
			require.Equal(t, int64(123), applied.AppliedAt)
			replayed, err := migrationTableExists(ctx, db, "migration_074_replay_probe")
			require.NoError(t, err)
			require.False(t, replayed)
		})
	}
}

func seedMisrecordedMediaRecipeMigration074(ctx context.Context, t *testing.T, db *bun.DB) {
	t.Helper()

	_, err := db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	recipeSQL, err := migrationFiles.ReadFile("086_media_generation_recipes.sql")
	require.NoError(t, err)
	require.NoError(t, runMigration(ctx, db, migration{
		version: 74,
		name:    "074_media_generation_recipes.sql",
		sql:     normalizeMigrationSQL(db.Dialect().Name(), string(recipeSQL)),
	}))
	_, err = db.NewUpdate().
		Model((*SchemaMigration)(nil)).
		Set("applied_at = ?", 1).
		Where("version = ?", 74).
		Exec(ctx)
	require.NoError(t, err)

	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "Workspace"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{ID: "user-1", Email: "creator@example.com"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.MediaAttachment{
		ID: "media-1", WorkspaceID: "workspace-1", FilePath: "memes/media-1.png",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.MediaGenerationRecipe{
		MediaID:     "media-1",
		WorkspaceID: "workspace-1",
		CreatedByID: "user-1",
		Kind:        "meme",
		RendererKey: "memegen",
		TemplateID:  "drake",
		RecipeJSON:  `{"captions":["old 074 data"]}`,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		CREATE TABLE provider_media_states (id TEXT PRIMARY KEY);
		INSERT INTO provider_media_states (id) VALUES ('provider-state-1');
	`)
	require.NoError(t, err)
}

func TestRunMigrationsHealsSkippedMigrationCollisions(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	_, err := db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]SchemaMigration{
		{Version: 94, AppliedAt: 94},
		{Version: 108, AppliedAt: 108},
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		CREATE TABLE workspace_invitations (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL
		);
		INSERT INTO workspace_invitations (id, email)
		VALUES ('invite-1', 'person@example.com');
	`)
	require.NoError(t, err)

	idempotencySQL, err := migrationFiles.ReadFile("110_idempotency_records.sql")
	require.NoError(t, err)
	invitationSQL, err := migrationFiles.ReadFile("111_workspace_invitation_delivery.sql")
	require.NoError(t, err)
	require.NoError(t, runMigrations(db, fstest.MapFS{
		"110_idempotency_records.sql":           &fstest.MapFile{Data: idempotencySQL},
		"111_workspace_invitation_delivery.sql": &fstest.MapFile{Data: invitationSQL},
	}))

	idempotencyExists, err := migrationTableExists(ctx, db, "idempotency_records")
	require.NoError(t, err)
	require.True(t, idempotencyExists)
	for _, column := range []string{"email_delivery_status", "email_delivery_job_id"} {
		present, columnErr := migrationColumnExists(ctx, db, "workspace_invitations", column)
		require.NoError(t, columnErr)
		require.True(t, present, "expected healed workspace invitation column %s", column)
	}
	for _, version := range []int64{110, 111} {
		count, countErr := db.NewSelect().Model((*SchemaMigration)(nil)).Where("version = ?", version).Count(ctx)
		require.NoError(t, countErr)
		require.Equal(t, 1, count)
	}
}
