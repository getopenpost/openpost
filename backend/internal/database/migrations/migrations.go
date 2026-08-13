package migrations

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/usernames"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

//go:embed *.sql
var migrationFiles embed.FS

type SchemaMigration struct {
	bun.BaseModel `bun:"table:schema_migrations"`
	Version       int64 `bun:",pk"`
	AppliedAt     int64 `bun:",notnull"`
}

// RunMigrations executes all pending migrations in order.
// Migration files must be named like: 001_description.sql, 002_description.sql, etc.
func RunMigrations(db *bun.DB) error {
	return runMigrations(db, migrationFiles)
}

func runMigrations(db *bun.DB, source fs.FS) error {
	ctx := context.Background()

	// Ensure migrations table exists
	if _, err := db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(ctx); err != nil {
		return fmt.Errorf("failed to create schema_migrations table: %w", err)
	}

	// Get already applied versions
	var applied []SchemaMigration
	if err := db.NewSelect().Model(&applied).Order("version ASC").Scan(ctx); err != nil {
		return fmt.Errorf("failed to list applied migrations: %w", err)
	}
	appliedSet := make(map[int64]bool)
	for _, m := range applied {
		appliedSet[m.Version] = true
	}

	// Read embedded migration files
	entries, err := fs.ReadDir(source, ".")
	if err != nil {
		return fmt.Errorf("failed to read migration files: %w", err)
	}

	var migrations []migration
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		version, err := parseVersion(entry.Name())
		if err != nil {
			return fmt.Errorf("invalid migration filename %q: %w", entry.Name(), err)
		}
		content, err := fs.ReadFile(source, entry.Name())
		if err != nil {
			return fmt.Errorf("failed to read migration %q: %w", entry.Name(), err)
		}
		migrations = append(migrations, migration{
			version: version,
			name:    entry.Name(),
			sql:     normalizeMigrationSQL(db.Dialect().Name(), string(content)),
		})
	}

	sort.Slice(migrations, func(i, j int) bool {
		return migrations[i].version < migrations[j].version
	})
	if err := repairMigrationHistoryCollisions(ctx, db, appliedSet, migrations); err != nil {
		return fmt.Errorf("migration history compatibility repair failed: %w", err)
	}

	// Run pending migrations inside transactions
	for _, m := range migrations {
		if appliedSet[m.version] {
			continue
		}

		if err := prepareMigration(ctx, db, m); err != nil {
			return err
		}
		if err := runMigration(ctx, db, m); err != nil {
			return fmt.Errorf("migration %s failed: %w", m.name, err)
		}
		appliedSet[m.version] = true
	}

	return finalizeMigrations(ctx, db, appliedSet)
}

func repairMigrationHistoryCollisions(
	ctx context.Context,
	db *bun.DB,
	appliedSet map[int64]bool,
	migrations []migration,
) error {
	if !appliedSet[74] || !hasMigration(migrations, 74, "074_rendition_media_deliveries.sql") {
		return nil
	}

	recipesExist, err := migrationTableExists(ctx, db, "media_generation_recipes")
	if err != nil || !recipesExist {
		return err
	}
	legacyProviderStatesExist, err := migrationTableExists(ctx, db, "provider_media_states")
	if err != nil || !legacyProviderStatesExist {
		return err
	}
	for _, table := range []string{
		"post_media_deliveries",
		"rendition_media_deliveries",
		"rendition_media_delivery_relations",
	} {
		exists, tableErr := migrationTableExists(ctx, db, table)
		if tableErr != nil {
			return tableErr
		}
		if exists {
			return nil
		}
	}

	// A short-lived development build assigned 074 to media generation recipes.
	// Current releases use 074 for rendition media deliveries and 086 for the
	// recipe table. Remove only the colliding history row so the normal,
	// transactional migration loop replays the real 074 while preserving the
	// already-created recipe table and its data.
	result, err := db.NewDelete().
		Model((*SchemaMigration)(nil)).
		Where("version = ?", 74).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("reset colliding migration 074: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check colliding migration 074 reset: %w", err)
	}
	if rowsAffected != 1 {
		return fmt.Errorf("reset colliding migration 074: expected one history row, removed %d", rowsAffected)
	}
	delete(appliedSet, 74)
	return nil
}

func hasMigration(migrations []migration, version int64, name string) bool {
	for _, item := range migrations {
		if item.version == version && item.name == name {
			return true
		}
	}
	return false
}

func finalizeMigrations(ctx context.Context, db *bun.DB, appliedSet map[int64]bool) error {
	if err := repairAppliedSchema(ctx, db, appliedSet); err != nil {
		return err
	}
	if appliedSet[71] {
		if err := backfillJobDedupeIdentities(ctx, db); err != nil {
			return fmt.Errorf("job dedupe identity migration failed: %w", err)
		}
	}
	if appliedSet[73] {
		if err := ensureOAuthGrantSchema(ctx, db); err != nil {
			return fmt.Errorf("oauth grant migration failed: %w", err)
		}
	}
	if appliedSet[75] {
		if err := ensurePublicationAuthorizationSchema(ctx, db); err != nil {
			return fmt.Errorf("publication authorization migration failed: %w", err)
		}
	}
	if appliedSet[76] {
		if err := ensureProviderWriteAttemptSchema(ctx, db); err != nil {
			return fmt.Errorf("provider write attempt migration failed: %w", err)
		}
	}
	if appliedSet[77] {
		if err := ensureProviderReadinessSchema(ctx, db); err != nil {
			return fmt.Errorf("provider readiness certification migration failed: %w", err)
		}
	}
	return finalizeRecentMigrations(ctx, db, appliedSet)
}

func finalizeRecentMigrations(
	ctx context.Context,
	db *bun.DB,
	appliedSet map[int64]bool,
) error {
	if appliedSet[80] {
		if err := ensureWorkspaceAccessLifecycleSchema(ctx, db); err != nil {
			return fmt.Errorf("workspace access lifecycle migration failed: %w", err)
		}
	}
	if appliedSet[81] {
		if err := ensureAccountIdentityPublicProfileSchema(ctx, db); err != nil {
			return fmt.Errorf("account identity and public profile migration failed: %w", err)
		}
	}
	if !appliedSet[82] {
		return nil
	}
	if err := ensureDesignRevisionMediaReferenceSchema(ctx, db); err != nil {
		return fmt.Errorf("design revision media reference schema migration failed: %w", err)
	}
	if err := backfillDesignRevisionMediaReferences(ctx, db); err != nil {
		return fmt.Errorf("design revision media reference migration failed: %w", err)
	}
	if err := backfillVideoRevisionMediaReferences(ctx, db); err != nil {
		return fmt.Errorf("video revision media reference migration failed: %w", err)
	}
	if appliedSet[83] {
		if err := resumeLegacyPublicationAuthoringBackfill(ctx, db); err != nil {
			return fmt.Errorf("legacy publication authoring migration failed: %w", err)
		}
	}
	return nil
}

func backfillJobDedupeIdentities(ctx context.Context, db *bun.DB) error {
	exists, err := migrationTableExists(ctx, db, "jobs")
	if err != nil || !exists {
		return err
	}
	if err := validateJobDedupeColumns(ctx, db); err != nil {
		return err
	}
	if err := db.RunInTx(ctx, &sql.TxOptions{}, backfillJobDedupeRows); err != nil {
		return err
	}
	return jobregistry.EnsureActiveDedupeIndex(ctx, db)
}

func validateJobDedupeColumns(ctx context.Context, db *bun.DB) error {
	for _, column := range []string{"scope_id", "dedupe_key"} {
		present, columnErr := migrationColumnExists(ctx, db, "jobs", column)
		if columnErr != nil {
			return columnErr
		}
		if !present {
			return fmt.Errorf("jobs.%s is missing after migration 071", column)
		}
	}
	return nil
}

func backfillJobDedupeRows(ctx context.Context, tx bun.Tx) error {
	var rows []models.Job
	if err := tx.NewSelect().Model(&rows).
		Where("type = ?", jobregistry.TypeMediaCleanup).
		WhereGroup(" AND ", func(query *bun.SelectQuery) *bun.SelectQuery {
			return query.
				WhereOr("scope_id = '' OR dedupe_key = ''").
				WhereOr("status IN (?, ?)", jobregistry.StatusPending, jobregistry.StatusProcessing)
		}).
		OrderExpr("CASE WHEN status = ? THEN 0 WHEN status = ? THEN 1 ELSE 2 END", jobregistry.StatusProcessing, jobregistry.StatusPending).
		Order("run_at ASC", "id ASC").
		Scan(ctx); err != nil {
		return err
	}
	active := make(map[jobregistry.Identity]string)
	for index := range rows {
		identity, err := jobregistry.IdentityForPayload(rows[index].Type, rows[index].Payload)
		if err != nil {
			continue
		}
		isActive := rows[index].Status == jobregistry.StatusPending || rows[index].Status == jobregistry.StatusProcessing
		if keptID, duplicate := active[identity]; isActive && duplicate {
			if err := supersedeDuplicateCleanupJob(ctx, tx, rows[index].ID, keptID, identity); err != nil {
				return err
			}
			continue
		}
		if isActive {
			active[identity] = rows[index].ID
		}
		if err := setJobDedupeIdentity(ctx, tx, rows[index].ID, identity); err != nil {
			return err
		}
	}
	return nil
}

func supersedeDuplicateCleanupJob(
	ctx context.Context,
	tx bun.Tx,
	jobID string,
	keptID string,
	identity jobregistry.Identity,
) error {
	_, err := tx.NewUpdate().Model((*models.Job)(nil)).
		Set("status = ?", jobregistry.StatusCompleted).
		Set("scope_id = ?", identity.ScopeID).
		Set("dedupe_key = ?", identity.DedupeKey).
		Set("last_error = ?", "Superseded by active recurring job "+keptID+" during exact dedupe migration.").
		Set("locked_at = NULL").
		Set("locked_by = ''").
		Where("id = ?", jobID).
		Exec(ctx)
	return err
}

func setJobDedupeIdentity(ctx context.Context, tx bun.Tx, jobID string, identity jobregistry.Identity) error {
	_, err := tx.NewUpdate().Model((*models.Job)(nil)).
		Set("scope_id = ?", identity.ScopeID).
		Set("dedupe_key = ?", identity.DedupeKey).
		Where("id = ?", jobID).
		Exec(ctx)
	return err
}

func repairAppliedSchema(ctx context.Context, db *bun.DB, appliedSet map[int64]bool) error {
	// Early development builds of migration 036 only recognized an unquoted
	// `file_hash TEXT UNIQUE` declaration. Bun's SQLite bootstrap schema uses a
	// table-level constraint, so repair already-recorded 036 databases as well.
	if !appliedSet[36] || db.Dialect().Name() != dialect.SQLite {
		return nil
	}
	if err := rebuildSQLiteMediaAttachmentsWithoutGlobalHashUnique(ctx, db); err != nil {
		return fmt.Errorf("media hash schema repair failed: %w", err)
	}
	return nil
}

func prepareMigration(ctx context.Context, db *bun.DB, migration migration) error {
	var (
		err         error
		description string
	)
	switch migration.version {
	case 38:
		description = "post update timestamp"
		err = ensurePostUpdatedAtColumn(ctx, db)
	case 36:
		description = "media hash"
		err = removeGlobalMediaHashConstraint(ctx, db)
	case 39:
		description = "post destination"
		err = addPublishingFailureColumnsToPostDestinations(ctx, db)
	case 41:
		description = "publication editor backfill"
		if err = ensurePublicationRepostOverride(ctx, db); err == nil {
			err = backfillPublicationTextEditors(ctx, db)
		}
	case 51:
		description = "optional password"
		err = makeUserPasswordOptional(ctx, db)
	case 53:
		description = "media project linkage"
		err = addVideoProjectIDToMediaAttachments(ctx, db)
	case 55:
		description = "prompt example"
		err = ensurePromptExampleColumn(ctx, db)
	case 57:
		description = "public profile"
		err = ensurePublicProfileUserFields(ctx, db)
	case 58:
		description = "email verification"
		err = ensureEmailVerificationUserField(ctx, db)
	case 61:
		description = "repost override"
		err = ensurePublicationRepostOverride(ctx, db)
	case 62, 63, 64, 66, 71, 73, 74, 75, 76, 77, 78, 80, 81, 82, 83:
		return prepareRecentMigration(ctx, db, migration)
	}
	if err != nil {
		return fmt.Errorf("migration %s %s preparation failed: %w", migration.name, description, err)
	}
	return nil
}

func ensurePostUpdatedAtColumn(ctx context.Context, db *bun.DB) error {
	exists, err := migrationTableExists(ctx, db, "posts")
	if err != nil || !exists {
		return err
	}
	present, err := migrationColumnExists(ctx, db, "posts", "updated_at")
	if err != nil || present {
		return err
	}
	if db.Dialect().Name() != dialect.SQLite {
		return nil
	}
	return rebuildSQLitePostsWithUpdatedAt(ctx, db)
}

type sqliteSchemaObject struct {
	Type string `bun:"type"`
	Name string `bun:"name"`
	SQL  string `bun:"sql"`
}

type sqlitePostsRebuildPlan struct {
	createSQL     string
	columnList    string
	schemaObjects []sqliteSchemaObject
}

func loadSQLitePostsRebuildPlan(ctx context.Context, db *bun.DB) (sqlitePostsRebuildPlan, error) {
	var createSQL string
	err := db.NewSelect().
		TableExpr("sqlite_master").
		Column("sql").
		Where("type = 'table' AND name = 'posts'").
		Scan(ctx, &createSQL)
	if errors.Is(err, sql.ErrNoRows) {
		return sqlitePostsRebuildPlan{}, nil
	}
	if err != nil {
		return sqlitePostsRebuildPlan{}, err
	}

	var schemaObjects []sqliteSchemaObject
	if err := db.NewSelect().
		TableExpr("sqlite_master").
		Column("type", "name", "sql").
		Where("type IN ('index', 'trigger') AND tbl_name = 'posts' AND sql IS NOT NULL").
		Order("type ASC", "name ASC").
		Scan(ctx, &schemaObjects); err != nil {
		return sqlitePostsRebuildPlan{}, err
	}

	type sqliteColumn struct {
		Name string `bun:"name"`
	}
	var columns []sqliteColumn
	if err := db.NewSelect().
		TableExpr("pragma_table_info('posts')").
		Column("name").
		Order("cid ASC").
		Scan(ctx, &columns); err != nil {
		return sqlitePostsRebuildPlan{}, err
	}
	if len(columns) == 0 {
		return sqlitePostsRebuildPlan{}, errors.New("posts table has no columns")
	}

	rebuildSQL, err := sqlitePostsCreateSQL(createSQL)
	if err != nil {
		return sqlitePostsRebuildPlan{}, err
	}
	quotedColumns := make([]string, 0, len(columns))
	for _, column := range columns {
		quotedColumns = append(quotedColumns, `"`+strings.ReplaceAll(column.Name, `"`, `""`)+`"`)
	}
	return sqlitePostsRebuildPlan{
		createSQL:     rebuildSQL,
		columnList:    strings.Join(quotedColumns, ", "),
		schemaObjects: schemaObjects,
	}, nil
}

func sqlitePostsCreateSQL(createSQL string) (string, error) {
	closingParen := strings.LastIndex(createSQL, ")")
	if closingParen < 0 {
		return "", errors.New("posts table schema has no closing parenthesis")
	}
	rebuildSQL := strings.Replace(createSQL, `"posts"`, `"posts_rebuild_038"`, 1)
	if rebuildSQL == createSQL {
		rebuildSQL = strings.Replace(createSQL, "posts", "posts_rebuild_038", 1)
	}
	closingParen = strings.LastIndex(rebuildSQL, ")")
	insertAt := closingParen
	tableConstraintExpr := regexp.MustCompile(`(?i),\s*(?:CONSTRAINT\b|PRIMARY\s+KEY\b|UNIQUE\s*\(|CHECK\s*\(|FOREIGN\s+KEY\b)`)
	if constraint := tableConstraintExpr.FindStringIndex(rebuildSQL); constraint != nil {
		insertAt = constraint[0]
	}
	rebuildSQL = rebuildSQL[:insertAt] +
		`, "updated_at" TIMESTAMP NOT NULL DEFAULT current_timestamp` +
		rebuildSQL[insertAt:]
	return rebuildSQL, nil
}

func rebuildSQLitePostsWithUpdatedAt(ctx context.Context, db *bun.DB) error {
	plan, err := loadSQLitePostsRebuildPlan(ctx, db)
	if err != nil || plan.createSQL == "" {
		return err
	}

	var foreignKeysEnabled int
	if err := db.QueryRowContext(ctx, "PRAGMA foreign_keys").Scan(&foreignKeysEnabled); err != nil {
		return err
	}
	if foreignKeysEnabled != 0 {
		if _, err := db.ExecContext(ctx, "PRAGMA foreign_keys=OFF"); err != nil {
			return err
		}
		defer func() {
			_, _ = db.ExecContext(context.Background(), "PRAGMA foreign_keys=ON")
		}()
	}

	return db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(txCtx, plan.createSQL); err != nil {
			return fmt.Errorf("create rebuilt posts table: %w", err)
		}
		copySQL := fmt.Sprintf(
			`INSERT INTO posts_rebuild_038 (%s, "updated_at") SELECT %s, COALESCE("created_at", current_timestamp) FROM posts`,
			plan.columnList,
			plan.columnList,
		)
		if _, err := tx.ExecContext(txCtx, copySQL); err != nil {
			return fmt.Errorf("copy posts into rebuilt table: %w", err)
		}
		if _, err := tx.ExecContext(txCtx, "DROP TABLE posts"); err != nil {
			return fmt.Errorf("drop legacy posts table: %w", err)
		}
		if _, err := tx.ExecContext(txCtx, "ALTER TABLE posts_rebuild_038 RENAME TO posts"); err != nil {
			return fmt.Errorf("rename rebuilt posts table: %w", err)
		}
		for _, object := range plan.schemaObjects {
			if _, err := tx.ExecContext(txCtx, object.SQL); err != nil {
				return fmt.Errorf("recreate posts %s %s: %w", object.Type, object.Name, err)
			}
		}
		return nil
	})
}

func prepareRecentMigration(ctx context.Context, db *bun.DB, migration migration) error {
	description, err := prepareEarlierRecentMigration(ctx, db, migration.version)
	if description == "" && err == nil {
		description, err = prepareLaterRecentMigration(ctx, db, migration.version)
	}
	if err != nil {
		return fmt.Errorf("migration %s %s preparation failed: %w", migration.name, description, err)
	}
	return nil
}

func prepareEarlierRecentMigration(ctx context.Context, db *bun.DB, version int64) (string, error) {
	switch version {
	case 62:
		return "media collections to tags", ensureMediaTagMigration(ctx, db)
	case 63:
		return "editor names", ensureEditorNameMigration(ctx, db)
	case 64:
		return "Social Sets and rendition inheritance", ensureSocialSetsAndRenditionInheritance(ctx, db)
	case 66:
		return "composer experience", ensureComposerExperienceUserField(ctx, db)
	case 71:
		return "job dedupe identity", ensureJobsTable(ctx, db)
	case 73:
		return "normalized OAuth grants", prepareOAuthGrantMigration(ctx, db)
	case 74:
		return "rendition media deliveries", ensureProviderMediaDeliveryPrerequisites(ctx, db)
	case 75:
		return "publication authorizations", preparePublicationAuthorizationMigration(ctx, db)
	case 76:
		return "durable provider write attempts", ensureProviderWriteAttemptPrerequisites(ctx, db)
	case 77:
		return "provider readiness certification", prepareProviderReadinessMigration(ctx, db)
	default:
		return "", nil
	}
}

func prepareLaterRecentMigration(ctx context.Context, db *bun.DB, version int64) (string, error) {
	switch version {
	case 78:
		return "media reference indexes", ensureMediaReferenceIndexPrerequisites(ctx, db)
	case 80:
		return "workspace access lifecycle", ensureWorkspaceAccessLifecycleSchema(ctx, db)
	case 81, 82:
		return prepareAccountAndEditorRevisionMigration(ctx, db, version)
	case 83:
		return "legacy publication authoring backfill", nil
	default:
		return "", nil
	}
}

func prepareAccountAndEditorRevisionMigration(
	ctx context.Context,
	db *bun.DB,
	version int64,
) (string, error) {
	switch version {
	case 81:
		return "account identity and public profiles", prepareAccountIdentityPublicProfileSchema(ctx, db)
	case 82:
		return "design revision media references", ensureDesignRevisionMediaReferenceSchema(ctx, db)
	default:
		return "", nil
	}
}

func ensureAccountIdentityPublicProfileSchema(ctx context.Context, db *bun.DB) error {
	return ensureAccountIdentityPublicProfileSchemaWithLegacyBackfill(ctx, db, false)
}

func prepareAccountIdentityPublicProfileSchema(ctx context.Context, db *bun.DB) error {
	return ensureAccountIdentityPublicProfileSchemaWithLegacyBackfill(ctx, db, true)
}

func ensureAccountIdentityPublicProfileSchemaWithLegacyBackfill(
	ctx context.Context,
	db *bun.DB,
	backfillLegacyVisibility bool,
) error {
	usersExist, err := migrationTableExists(ctx, db, "users")
	if err != nil || !usersExist {
		return err
	}
	if err := ensurePublicProfileVisibilityColumn(ctx, db); err != nil {
		return err
	}
	if backfillLegacyVisibility {
		if err := backfillLegacyPublicProfileVisibility(ctx, db); err != nil {
			return err
		}
	}
	if err := ensureUserIdentityLinkedNameColumn(ctx, db); err != nil {
		return err
	}
	return ensureEmailChangeChallengeSchema(ctx, db)
}

func ensurePublicProfileVisibilityColumn(ctx context.Context, db *bun.DB) error {
	present, err := migrationColumnExists(ctx, db, "users", "public_profile_visibility_json")
	if err != nil || present {
		return err
	}
	_, err = db.ExecContext(ctx, `ALTER TABLE users ADD COLUMN public_profile_visibility_json TEXT NOT NULL DEFAULT '["username"]'`)
	return err
}

func backfillLegacyPublicProfileVisibility(ctx context.Context, db *bun.DB) error {
	present, err := migrationColumnExists(ctx, db, "users", "public_profile_enabled")
	if err != nil || !present {
		return err
	}
	// Preserve the original all-fields behavior only while 081 is still
	// pending and only for the exact default written by this preparation.
	// Retrying after a crash between ALTER and UPDATE is therefore safe,
	// while the post-migration repair path never overwrites an intentional
	// username-only choice. Some historical fixtures predate
	// public_profile_enabled entirely.
	_, err = db.ExecContext(ctx, `UPDATE users
		SET public_profile_visibility_json = '["display_name","avatar","joined_at","activity","platforms","workspaces","plan"]'
		WHERE public_profile_enabled = true
		  AND public_profile_visibility_json = '["username"]'`)
	return err
}

func ensureUserIdentityLinkedNameColumn(ctx context.Context, db *bun.DB) error {
	exists, err := migrationTableExists(ctx, db, "user_identities")
	if err != nil || !exists {
		return err
	}
	present, err := migrationColumnExists(ctx, db, "user_identities", "linked_name")
	if err != nil || present {
		return err
	}
	_, err = db.ExecContext(ctx, `ALTER TABLE user_identities ADD COLUMN linked_name TEXT NOT NULL DEFAULT ''`)
	return err
}

func ensureEmailChangeChallengeSchema(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS email_change_challenges (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		old_email TEXT NOT NULL,
		new_email TEXT NOT NULL,
		code_hash TEXT NOT NULL,
		attempts INTEGER NOT NULL DEFAULT 0,
		expires_at TIMESTAMP NOT NULL,
		sent_at TIMESTAMP,
		consumed_at TIMESTAMP,
		canceled_at TIMESTAMP,
		created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	)`); err != nil {
		return err
	}
	for _, statement := range []string{
		`CREATE INDEX IF NOT EXISTS email_change_challenges_user_created_idx ON email_change_challenges (user_id, created_at)`,
		`CREATE INDEX IF NOT EXISTS email_change_challenges_expiry_idx ON email_change_challenges (expires_at, consumed_at, canceled_at)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS email_change_challenges_active_user_idx ON email_change_challenges (user_id) WHERE consumed_at IS NULL AND canceled_at IS NULL`,
	} {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}

func ensureWorkspaceAccessLifecycleSchema(ctx context.Context, db *bun.DB) error {
	membersExist, err := ensureWorkspaceMemberLifecycleSchema(ctx, db)
	if err != nil {
		return err
	}
	invitationsExist, err := ensureWorkspaceInvitationLifecycleSchema(ctx, db)
	if err != nil {
		return err
	}
	accessPrerequisitesExist, err := workspaceAccessAuditPrerequisitesExist(ctx, db)
	if err != nil {
		return err
	}
	if !membersExist || !invitationsExist || !accessPrerequisitesExist {
		return nil
	}
	return ensureWorkspaceAccessAuditSchema(ctx, db)
}

func ensureWorkspaceMemberLifecycleSchema(ctx context.Context, db *bun.DB) (bool, error) {
	exists, err := migrationTableExists(ctx, db, "workspace_members")
	if err != nil || !exists {
		return exists, err
	}
	for _, column := range []struct {
		name       string
		definition string
	}{
		{name: "status", definition: "TEXT NOT NULL DEFAULT 'active'"},
		{name: "created_at", definition: "TIMESTAMP"},
		{name: "updated_at", definition: "TIMESTAMP"},
		{name: "deactivated_at", definition: "TIMESTAMP"},
	} {
		present, columnErr := migrationColumnExists(ctx, db, "workspace_members", column.name)
		if columnErr != nil {
			return false, columnErr
		}
		if !present {
			if _, columnErr = db.ExecContext(ctx, "ALTER TABLE workspace_members ADD COLUMN "+column.name+" "+column.definition); columnErr != nil {
				return false, columnErr
			}
		}
	}
	for _, statement := range []string{
		`UPDATE workspace_members SET created_at = current_timestamp WHERE created_at IS NULL`,
		`UPDATE workspace_members SET updated_at = COALESCE(created_at, current_timestamp) WHERE updated_at IS NULL`,
		`CREATE INDEX IF NOT EXISTS workspace_members_workspace_status_idx ON workspace_members (workspace_id, status, role)`,
		`CREATE INDEX IF NOT EXISTS workspace_members_user_status_idx ON workspace_members (user_id, status, workspace_id)`,
	} {
		if _, err = db.ExecContext(ctx, statement); err != nil {
			return false, err
		}
	}
	return true, nil
}

func ensureWorkspaceInvitationLifecycleSchema(ctx context.Context, db *bun.DB) (bool, error) {
	exists, err := migrationTableExists(ctx, db, "workspace_invitations")
	if err != nil || !exists {
		return exists, err
	}
	present, err := migrationColumnExists(ctx, db, "workspace_invitations", "last_sent_at")
	if err != nil {
		return false, err
	}
	if !present {
		if _, err = db.ExecContext(ctx, `ALTER TABLE workspace_invitations ADD COLUMN last_sent_at TIMESTAMP`); err != nil {
			return false, err
		}
	}
	if _, err = db.ExecContext(ctx, `UPDATE workspace_invitations SET last_sent_at = created_at WHERE last_sent_at IS NULL`); err != nil {
		return false, err
	}
	return true, nil
}

func workspaceAccessAuditPrerequisitesExist(ctx context.Context, db *bun.DB) (bool, error) {
	allExist := true
	for _, table := range []string{"workspaces", "users"} {
		exists, err := migrationTableExists(ctx, db, table)
		if err != nil {
			return false, err
		}
		allExist = allExist && exists
	}
	return allExist, nil
}

func ensureWorkspaceAccessAuditSchema(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS workspace_access_audit_events (
		id TEXT PRIMARY KEY,
		workspace_id TEXT NOT NULL,
		actor_user_id TEXT,
		subject_user_id TEXT,
		invitation_id TEXT,
		subject_email TEXT NOT NULL DEFAULT '',
		action TEXT NOT NULL,
		previous_role TEXT NOT NULL DEFAULT '',
		role TEXT NOT NULL DEFAULT '',
		previous_status TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT '',
		created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
		FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
		FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
		FOREIGN KEY (subject_user_id) REFERENCES users(id) ON DELETE SET NULL,
		FOREIGN KEY (invitation_id) REFERENCES workspace_invitations(id) ON DELETE SET NULL
	)`); err != nil {
		return err
	}
	for _, statement := range []string{
		`CREATE INDEX IF NOT EXISTS workspace_access_audit_workspace_created_idx ON workspace_access_audit_events (workspace_id, created_at DESC, id DESC)`,
		`CREATE INDEX IF NOT EXISTS workspace_access_audit_subject_idx ON workspace_access_audit_events (workspace_id, subject_user_id, created_at DESC)`,
	} {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}

func prepareProviderReadinessMigration(ctx context.Context, db *bun.DB) error {
	exists, err := migrationTableExists(ctx, db, "publication_authorizations")
	if err != nil {
		return err
	}
	if exists {
		columns := []struct {
			name      string
			statement string
		}{
			{name: "provider_policy_mode", statement: `ALTER TABLE publication_authorizations ADD COLUMN provider_policy_mode TEXT NOT NULL DEFAULT 'provider.unspecified' CHECK (provider_policy_mode <> '')`},
			{name: "execution_intent", statement: `ALTER TABLE publication_authorizations ADD COLUMN execution_intent TEXT NOT NULL DEFAULT 'production' CHECK (execution_intent IN ('production', 'certification_test'))`},
		}
		for _, column := range columns {
			present, columnErr := migrationColumnExists(ctx, db, "publication_authorizations", column.name)
			if columnErr != nil {
				return columnErr
			}
			if present {
				continue
			}
			if _, execErr := db.ExecContext(ctx, column.statement); execErr != nil {
				return execErr
			}
		}
	}

	for _, table := range []string{"x_oauth_request_tokens", "oauth_account_selections"} {
		tableExists, tableErr := migrationTableExists(ctx, db, table)
		if tableErr != nil {
			return tableErr
		}
		if !tableExists {
			continue
		}
		present, columnErr := migrationColumnExists(ctx, db, table, "execution_intent")
		if columnErr != nil {
			return columnErr
		}
		if present {
			continue
		}
		if _, execErr := db.ExecContext(ctx, "ALTER TABLE "+table+" ADD COLUMN execution_intent TEXT NOT NULL DEFAULT ''"); execErr != nil {
			return execErr
		}
	}
	return nil
}

func ensureJobsTable(ctx context.Context, db *bun.DB) error {
	_, err := db.NewCreateTable().Model((*models.Job)(nil)).IfNotExists().Exec(ctx)
	return err
}

func ensureMediaReferenceIndexPrerequisites(ctx context.Context, db *bun.DB) error {
	_, err := db.NewCreateTable().Model((*models.PostMedia)(nil)).IfNotExists().Exec(ctx)
	return err
}

func ensureProviderWriteAttemptPrerequisites(ctx context.Context, db *bun.DB) error {
	for _, model := range []interface{}{
		(*models.Workspace)(nil),
		(*models.Publication)(nil),
		(*models.SocialAccount)(nil),
		(*models.Rendition)(nil),
		(*models.PublicationAuthorization)(nil),
	} {
		if _, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func ensureProviderWriteAttemptSchema(ctx context.Context, db *bun.DB) error {
	exists, err := migrationTableExists(ctx, db, "provider_write_attempts")
	if err != nil {
		return err
	}
	if !exists {
		return errors.New("provider_write_attempts is missing after migration 076")
	}
	return nil
}

// Isolated historical migration fixtures do not always bootstrap publishing
// tables before running the full embedded migration set. Production does, but
// creating absent prerequisites here keeps migration 074 deterministic in
// both paths without weakening its composite foreign keys.
func ensureProviderMediaDeliveryPrerequisites(ctx context.Context, db *bun.DB) error {
	for _, model := range []interface{}{
		(*models.Workspace)(nil),
		(*models.Post)(nil),
		(*models.Publication)(nil),
		(*models.SocialAccount)(nil),
		(*models.MediaAttachment)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionMedia)(nil),
	} {
		if _, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx); err != nil {
			return err
		}
	}
	exists, err := migrationTableExists(ctx, db, "provider_media_states")
	if err != nil {
		return err
	}
	if !exists {
		_, err = db.ExecContext(ctx, `CREATE TABLE provider_media_states (
			post_id TEXT NOT NULL,
			social_account_id TEXT NOT NULL,
			media_id TEXT NOT NULL,
			platform TEXT NOT NULL,
			platform_media_id TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'ready',
			error_message TEXT,
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			updated_at TIMESTAMP,
			rendition_id TEXT NOT NULL DEFAULT '',
			PRIMARY KEY (post_id, social_account_id, media_id)
		)`)
		return err
	}
	for _, column := range []struct {
		name       string
		definition string
	}{
		{name: "rendition_id", definition: "TEXT NOT NULL DEFAULT ''"},
		{name: "updated_at", definition: "TIMESTAMP"},
	} {
		present, columnErr := migrationColumnExists(ctx, db, "provider_media_states", column.name)
		if columnErr != nil {
			return columnErr
		}
		if present {
			continue
		}
		if _, columnErr = db.ExecContext(ctx, "ALTER TABLE provider_media_states ADD COLUMN "+column.name+" "+column.definition); columnErr != nil {
			return columnErr
		}
	}
	return nil
}

func preparePublicationAuthorizationMigration(ctx context.Context, db *bun.DB) error {
	exists, err := migrationTableExists(ctx, db, "api_tokens")
	if err != nil || !exists {
		return err
	}
	present, err := migrationColumnExists(ctx, db, "api_tokens", "client_id")
	if err != nil || present {
		return err
	}
	_, err = db.ExecContext(ctx, "ALTER TABLE api_tokens ADD COLUMN client_id TEXT NOT NULL DEFAULT ''")
	return err
}

func ensurePublicationAuthorizationSchema(ctx context.Context, db *bun.DB) error {
	exists, err := migrationTableExists(ctx, db, "publication_authorizations")
	if err != nil {
		return err
	}
	if !exists {
		return errors.New("publication_authorizations is missing after migration 075")
	}

	var statements []string
	switch db.Dialect().Name() {
	case dialect.SQLite:
		statements = []string{
			`CREATE TRIGGER IF NOT EXISTS publication_authorizations_immutable
			BEFORE UPDATE ON publication_authorizations
			BEGIN
				SELECT RAISE(ABORT, 'publication authorization receipts are immutable');
			END`,
		}
	case dialect.PG:
		statements = []string{
			`CREATE OR REPLACE FUNCTION openpost_prevent_publication_authorization_update()
			RETURNS trigger AS $$
			BEGIN
				RAISE EXCEPTION 'publication authorization receipts are immutable';
			END;
			$$ LANGUAGE plpgsql`,
			`DROP TRIGGER IF EXISTS publication_authorizations_immutable ON publication_authorizations`,
			`CREATE TRIGGER publication_authorizations_immutable
			BEFORE UPDATE ON publication_authorizations
			FOR EACH ROW EXECUTE FUNCTION openpost_prevent_publication_authorization_update()`,
		}
	default:
		return fmt.Errorf("unsupported database dialect %s", db.Dialect().Name())
	}
	for _, statement := range statements {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}

var providerReadinessLedgerTables = []string{
	"provider_approval_reviews",
	"provider_certification_runs",
	"provider_certification_checks",
	"provider_runtime_control_events",
}

func ensureProviderReadinessSchema(ctx context.Context, db *bun.DB) error {
	if err := prepareProviderReadinessMigration(ctx, db); err != nil {
		return err
	}
	if err := ensureProviderReadinessLedgerTables(ctx, db); err != nil {
		return err
	}
	if err := ensureProviderReadinessIntegrationColumns(ctx, db); err != nil {
		return err
	}
	switch db.Dialect().Name() {
	case dialect.SQLite:
		return ensureSQLiteProviderReadinessImmutability(ctx, db)
	case dialect.PG:
		return ensurePostgresProviderReadinessImmutability(ctx, db)
	default:
		return fmt.Errorf("unsupported database dialect %s", db.Dialect().Name())
	}
}

func ensureProviderReadinessLedgerTables(ctx context.Context, db *bun.DB) error {
	for _, table := range providerReadinessLedgerTables {
		exists, err := migrationTableExists(ctx, db, table)
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("%s is missing after migration 077", table)
		}
	}
	if _, err := db.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS provider_certification_runs_live_account_idx
		ON provider_certification_runs (
			provider, app_fingerprint, deployment_environment,
			provider_environment, instance_fingerprint, account_kind,
			output_profile, operation, policy_mode, evidence_kind,
			account_reference_hash, tested_at, created_at
		)`); err != nil {
		return err
	}
	return nil
}

func ensureProviderReadinessIntegrationColumns(ctx context.Context, db *bun.DB) error {
	publicationAuthorizationsExist, err := migrationTableExists(ctx, db, "publication_authorizations")
	if err != nil {
		return err
	}
	if publicationAuthorizationsExist {
		for _, column := range []string{"provider_policy_mode", "execution_intent"} {
			present, columnErr := migrationColumnExists(ctx, db, "publication_authorizations", column)
			if columnErr != nil {
				return columnErr
			}
			if !present {
				return fmt.Errorf("publication_authorizations.%s is missing after migration 077", column)
			}
		}
	}
	for _, table := range []string{"x_oauth_request_tokens", "oauth_account_selections"} {
		tableExists, tableErr := migrationTableExists(ctx, db, table)
		if tableErr != nil {
			return tableErr
		}
		if !tableExists {
			continue
		}
		present, columnErr := migrationColumnExists(ctx, db, table, "execution_intent")
		if columnErr != nil {
			return columnErr
		}
		if !present {
			return fmt.Errorf("%s.execution_intent is missing after migration 077", table)
		}
	}
	return nil
}

func ensureSQLiteProviderReadinessImmutability(ctx context.Context, db *bun.DB) error {
	for _, table := range providerReadinessLedgerTables {
		for _, operation := range []string{"UPDATE", "DELETE"} {
			name := table + "_append_only_" + strings.ToLower(operation)
			statement := fmt.Sprintf(`CREATE TRIGGER IF NOT EXISTS %s
				BEFORE %s ON %s
				BEGIN
					SELECT RAISE(ABORT, 'provider readiness ledger is append-only');
				END`, name, operation, table)
			if _, err := db.ExecContext(ctx, statement); err != nil {
				return err
			}
		}
	}
	return nil
}

func ensurePostgresProviderReadinessImmutability(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, `CREATE OR REPLACE FUNCTION openpost_prevent_provider_readiness_mutation()
		RETURNS trigger AS $$
		BEGIN
			RAISE EXCEPTION 'provider readiness ledger is append-only';
		END;
		$$ LANGUAGE plpgsql`); err != nil {
		return err
	}
	for _, table := range providerReadinessLedgerTables {
		for _, operation := range []string{"UPDATE", "DELETE"} {
			name := table + "_append_only_" + strings.ToLower(operation)
			if _, err := db.ExecContext(ctx, fmt.Sprintf("DROP TRIGGER IF EXISTS %s ON %s", name, table)); err != nil {
				return err
			}
			statement := fmt.Sprintf(`CREATE TRIGGER %s
				BEFORE %s ON %s
				FOR EACH ROW EXECUTE FUNCTION openpost_prevent_provider_readiness_mutation()`, name, operation, table)
			if _, err := db.ExecContext(ctx, statement); err != nil {
				return err
			}
		}
	}
	return nil
}

func prepareOAuthGrantMigration(ctx context.Context, db *bun.DB) error {
	exists, err := migrationTableExists(ctx, db, "social_accounts")
	if err != nil || !exists {
		return err
	}
	present, err := migrationColumnExists(ctx, db, "social_accounts", "oauth_grant_id")
	if err != nil {
		return err
	}
	if !present {
		if _, err := db.ExecContext(ctx, "ALTER TABLE social_accounts ADD COLUMN oauth_grant_id TEXT NOT NULL DEFAULT ''"); err != nil {
			return err
		}
	}
	return nil
}

func ensureOAuthGrantSchema(ctx context.Context, db *bun.DB) error {
	grantsExist, err := migrationTableExists(ctx, db, "oauth_grants")
	if err != nil {
		return err
	}
	if !grantsExist {
		return fmt.Errorf("oauth_grants is missing after migration 073")
	}
	accountsExist, err := migrationTableExists(ctx, db, "social_accounts")
	if err != nil || !accountsExist {
		return err
	}
	present, err := migrationColumnExists(ctx, db, "social_accounts", "oauth_grant_id")
	if err != nil {
		return err
	}
	if !present {
		return fmt.Errorf("social_accounts.oauth_grant_id is missing after migration 073")
	}
	if err := backfillLegacyOAuthGrants(ctx, db); err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, "CREATE INDEX IF NOT EXISTS social_accounts_oauth_grant_idx ON social_accounts (oauth_grant_id)")
	return err
}

func backfillLegacyOAuthGrants(ctx context.Context, db *bun.DB) error {
	var accounts []models.SocialAccount
	if err := db.NewSelect().Model(&accounts).
		Where("oauth_grant_id = '' OR oauth_grant_id IS NULL").
		Order("created_at ASC", "id ASC").
		Scan(ctx); err != nil {
		return err
	}
	if len(accounts) == 0 {
		return nil
	}

	return db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		for index := range accounts {
			account := &accounts[index]
			grantID := "legacy:" + account.ID
			evidenceJSON, err := json.Marshal(map[string]string{
				"source":            "migration_073",
				"legacy_account_id": account.ID,
			})
			if err != nil {
				return fmt.Errorf("encode oauth grant evidence for account %s: %w", account.ID, err)
			}
			createdAt := account.CreatedAt
			if createdAt.IsZero() {
				createdAt = time.Now().UTC()
			}
			grant := &models.OAuthGrant{
				ID:                    grantID,
				WorkspaceID:           account.WorkspaceID,
				Provider:              account.Platform,
				ProviderProjectID:     "legacy",
				ProviderSubject:       account.AccountID,
				InstanceURL:           account.InstanceURL,
				AccessTokenEnc:        account.AccessTokenEnc,
				RefreshTokenEnc:       account.RefreshTokenEnc,
				AccessTokenExpiresAt:  account.TokenExpiresAt,
				GrantedScopes:         account.GrantedScopes,
				TokenVersion:          1,
				ExecutionMode:         legacyGrantExecutionMode(account.Platform),
				AuthorizationEvidence: string(evidenceJSON),
				ConsentedAt:           createdAt,
				ValidationStatus:      "legacy_unverified",
				CreatedAt:             createdAt,
				UpdatedAt:             time.Now().UTC(),
			}
			if _, err := tx.NewInsert().Model(grant).Ignore().Exec(txCtx); err != nil {
				return fmt.Errorf("backfill oauth grant for account %s: %w", account.ID, err)
			}
			if _, err := tx.NewUpdate().Model((*models.SocialAccount)(nil)).
				Set("oauth_grant_id = ?", grantID).
				Set("access_token_encrypted = ?", []byte{}).
				Set("refresh_token_encrypted = ?", []byte{}).
				Set("token_expires_at = NULL").
				Where("id = ? AND (oauth_grant_id = '' OR oauth_grant_id IS NULL)", account.ID).
				Exec(txCtx); err != nil {
				return fmt.Errorf("link oauth grant for account %s: %w", account.ID, err)
			}
		}
		return nil
	})
}

func legacyGrantExecutionMode(provider string) string {
	switch provider {
	case "bluesky":
		return "app_password"
	case "discord":
		return "webhook"
	case "x":
		return "oauth1"
	default:
		return "oauth2"
	}
}

func ensureSocialSetsAndRenditionInheritance(ctx context.Context, db *bun.DB) error {
	if err := ensureSocialSetTables(ctx, db); err != nil {
		return err
	}
	if err := ensureRenditionInheritanceColumns(ctx, db); err != nil {
		return err
	}
	if err := backfillCreationPresets(ctx, db); err != nil {
		return err
	}
	if err := backfillRenditionInheritance(ctx, db); err != nil {
		return err
	}
	return backfillDefaultSocialSets(ctx, db)
}

func ensureSocialSetTables(ctx context.Context, db *bun.DB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS social_sets (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			name TEXT NOT NULL,
			is_default BOOLEAN NOT NULL DEFAULT false,
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS social_sets_workspace_name_idx ON social_sets (workspace_id, name)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS social_sets_workspace_default_idx ON social_sets (workspace_id) WHERE is_default = true`,
		`CREATE TABLE IF NOT EXISTS social_set_accounts (
			social_set_id TEXT NOT NULL,
			social_account_id TEXT NOT NULL,
			display_order INTEGER NOT NULL DEFAULT 0,
			default_output_profile TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			PRIMARY KEY (social_set_id, social_account_id),
			FOREIGN KEY (social_set_id) REFERENCES social_sets(id) ON DELETE CASCADE,
			FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS social_set_accounts_account_idx ON social_set_accounts (social_account_id)`,
	}
	for _, statement := range statements {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}

func ensureRenditionInheritanceColumns(ctx context.Context, db *bun.DB) error {
	for table, columns := range map[string][]struct {
		name       string
		definition string
	}{
		"publications": {
			{name: "creation_preset", definition: "TEXT NOT NULL DEFAULT 'post'"},
			{name: "social_set_id", definition: "TEXT NOT NULL DEFAULT ''"},
		},
		"renditions": {
			{name: "format_locked", definition: "BOOLEAN NOT NULL DEFAULT false"},
			{name: "schedule_override", definition: "TIMESTAMP"},
		},
		"rendition_segments": {
			{name: "body_override", definition: "TEXT"},
			{name: "title_override", definition: "TEXT"},
			{name: "description_override", definition: "TEXT"},
			{name: "url_override", definition: "TEXT"},
			{name: "media_inherited", definition: "BOOLEAN NOT NULL DEFAULT true"},
		},
	} {
		exists, err := migrationTableExists(ctx, db, table)
		if err != nil {
			return err
		}
		if !exists {
			continue
		}
		for _, column := range columns {
			present, err := migrationColumnExists(ctx, db, table, column.name)
			if err != nil {
				return err
			}
			if present {
				continue
			}
			if _, err := db.ExecContext(ctx, fmt.Sprintf(
				"ALTER TABLE %s ADD COLUMN %s %s",
				table, column.name, column.definition,
			)); err != nil {
				return err
			}
		}
	}
	return nil
}

func backfillCreationPresets(ctx context.Context, db *bun.DB) error {
	publicationsExist, err := migrationTableExists(ctx, db, "publications")
	if err != nil {
		return err
	}
	if publicationsExist {
		intentExists, columnErr := migrationColumnExists(ctx, db, "publications", "intent")
		if columnErr != nil {
			return columnErr
		}
		if intentExists {
			if _, err := db.ExecContext(ctx, `UPDATE publications SET creation_preset = CASE intent
				WHEN 'thread' THEN 'thread' WHEN 'story' THEN 'story'
				WHEN 'short_video' THEN 'short_video' WHEN 'video' THEN 'video'
				ELSE 'post' END`); err != nil {
				return err
			}
		}
	}
	return nil
}

func backfillRenditionInheritance(ctx context.Context, db *bun.DB) error {
	for _, table := range []string{"rendition_segments", "publication_segments"} {
		exists, err := migrationTableExists(ctx, db, table)
		if err != nil || !exists {
			return err
		}
	}
	for _, field := range []string{"body", "title", "description", "url"} {
		if _, err := db.ExecContext(ctx, fmt.Sprintf(`UPDATE rendition_segments
			SET %s_override = %s
			WHERE %s != COALESCE((SELECT publication_segments.%s FROM publication_segments
				WHERE publication_segments.id = rendition_segments.publication_segment_id), '')`,
			field, field, field, field)); err != nil {
			return err
		}
	}
	for _, table := range []string{"rendition_segment_media", "publication_segment_media"} {
		exists, err := migrationTableExists(ctx, db, table)
		if err != nil || !exists {
			return err
		}
	}
	_, err := db.ExecContext(ctx, `UPDATE rendition_segments SET media_inherited = false
		WHERE EXISTS (SELECT 1 FROM rendition_segment_media rsm
			WHERE rsm.rendition_segment_id = rendition_segments.id
			AND NOT EXISTS (SELECT 1 FROM publication_segment_media psm
				WHERE psm.segment_id = rendition_segments.publication_segment_id
				AND psm.media_id = rsm.media_id AND psm.display_order = rsm.display_order))
		OR EXISTS (SELECT 1 FROM publication_segment_media psm
			WHERE psm.segment_id = rendition_segments.publication_segment_id
			AND NOT EXISTS (SELECT 1 FROM rendition_segment_media rsm
				WHERE rsm.rendition_segment_id = rendition_segments.id
				AND rsm.media_id = psm.media_id AND rsm.display_order = psm.display_order))`)
	return err
}

func backfillDefaultSocialSets(ctx context.Context, db *bun.DB) error {
	for _, table := range []string{"workspaces", "social_accounts"} {
		exists, err := migrationTableExists(ctx, db, table)
		if err != nil || !exists {
			return err
		}
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO social_sets (id, workspace_id, name, is_default, created_at, updated_at)
		SELECT 'default:' || workspaces.id, workspaces.id, 'All channels', true, current_timestamp, current_timestamp
		FROM workspaces WHERE EXISTS (SELECT 1 FROM social_accounts
			WHERE social_accounts.workspace_id = workspaces.id AND social_accounts.is_active = true)
		AND NOT EXISTS (SELECT 1 FROM social_sets WHERE social_sets.workspace_id = workspaces.id)`); err != nil {
		return err
	}
	_, err := db.ExecContext(ctx, `INSERT INTO social_set_accounts
		(social_set_id, social_account_id, display_order, default_output_profile, created_at)
		SELECT 'default:' || social_accounts.workspace_id, social_accounts.id, 0, '', current_timestamp
		FROM social_accounts WHERE social_accounts.is_active = true
		AND EXISTS (SELECT 1 FROM social_sets WHERE social_sets.id = 'default:' || social_accounts.workspace_id)
		ON CONFLICT DO NOTHING`)
	return err
}

func ensureMediaTagMigration(ctx context.Context, db *bun.DB) error {
	for _, table := range []string{"media_collections", "media_collection_items", "media_tags", "media_tag_assignments"} {
		exists, err := migrationTableExists(ctx, db, table)
		if err != nil || !exists {
			return err
		}
	}
	statements := []string{
		`INSERT INTO media_tags (id, workspace_id, name, normalized_name, created_at)
		 SELECT c.id, c.workspace_id, c.name, LOWER(TRIM(c.name)), c.created_at
		 FROM media_collections c
		 WHERE NOT EXISTS (
			 SELECT 1 FROM media_tags t
			 WHERE t.workspace_id = c.workspace_id AND t.normalized_name = LOWER(TRIM(c.name))
		 )
		 ON CONFLICT DO NOTHING`,
		`INSERT INTO media_tag_assignments (tag_id, media_id, created_at)
		 SELECT t.id, i.media_id, i.created_at
		 FROM media_collection_items i
		 JOIN media_collections c ON c.id = i.collection_id
		 JOIN media_tags t ON t.workspace_id = c.workspace_id AND t.normalized_name = LOWER(TRIM(c.name))
		 ON CONFLICT DO NOTHING`,
	}
	for _, statement := range statements {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}

func ensureEditorNameMigration(ctx context.Context, db *bun.DB) error {
	for _, migrate := range []func(context.Context, *bun.DB) error{
		migrateRenamedInstanceSettings,
		migrateEditorMediaSources,
		migrateVideoEditingMode,
		migrateFounderBillingPlan,
	} {
		if err := migrate(ctx, db); err != nil {
			return err
		}
	}
	return nil
}

func migrateRenamedInstanceSettings(ctx context.Context, db *bun.DB) error {
	instanceSettingsExist, err := migrationTableExists(ctx, db, "instance_settings")
	if err != nil || !instanceSettingsExist {
		return err
	}
	for _, names := range [][2]string{
		{"OPENPOST_STUDIO_ENABLED", "OPENPOST_IMAGE_EDITOR_ENABLED"},
		{"OPENPOST_STUDIO_MODEL_BASE_URL", "OPENPOST_IMAGE_EDITOR_MODEL_BASE_URL"},
		{"OPENPOST_VIDEO_STUDIO_ENABLED", "OPENPOST_VIDEO_EDITOR_ENABLED"},
		{"OPENPOST_WHOP_CREATOR_MONTHLY_PLAN_ID", "OPENPOST_WHOP_FOUNDER_MONTHLY_PLAN_ID"},
		{"OPENPOST_WHOP_CREATOR_ANNUAL_PLAN_ID", "OPENPOST_WHOP_FOUNDER_ANNUAL_PLAN_ID"},
	} {
		if _, err := db.ExecContext(ctx, `DELETE FROM instance_settings
				WHERE key = ? AND EXISTS (SELECT 1 FROM instance_settings WHERE key = ?)`, names[0], names[1]); err != nil {
			return err
		}
		if _, err := db.ExecContext(ctx, "UPDATE instance_settings SET key = ? WHERE key = ?", names[1], names[0]); err != nil {
			return err
		}
	}
	return nil
}

func migrateEditorMediaSources(ctx context.Context, db *bun.DB) error {
	mediaExist, err := migrationTableExists(ctx, db, "media_attachments")
	if err != nil || !mediaExist {
		return err
	}
	for _, names := range [][2]string{
		{"studio_export", "image_editor_export"},
		{"studio_edit", "image_editor_edit"},
		{"video_studio_source", "video_editor_source"},
		{"video_studio_export", "video_editor_export"},
	} {
		if _, err := db.ExecContext(ctx, "UPDATE media_attachments SET source = ? WHERE source = ?", names[1], names[0]); err != nil {
			return err
		}
	}
	return nil
}

func migrateVideoEditingMode(ctx context.Context, db *bun.DB) error {
	videoProjectsExist, err := migrationTableExists(ctx, db, "video_projects")
	if err != nil || !videoProjectsExist {
		return err
	}
	_, err = db.ExecContext(ctx, `UPDATE video_projects
			SET document_json = REPLACE(document_json, '"editing_mode":"studio"', '"editing_mode":"editor"')
			WHERE document_json LIKE '%"editing_mode":"studio"%'`)
	return err
}

func migrateFounderBillingPlan(ctx context.Context, db *bun.DB) error {
	for _, table := range []string{"billing_subscriptions", "billing_checkout_attempts"} {
		exists, tableErr := migrationTableExists(ctx, db, table)
		if tableErr != nil {
			return tableErr
		}
		if !exists {
			continue
		}
		if _, tableErr = db.ExecContext(ctx, "UPDATE "+table+" SET plan_id = 'founder' WHERE plan_id = 'creator'"); tableErr != nil {
			return tableErr
		}
	}

	subscriptionsExist, err := migrationTableExists(ctx, db, "billing_subscriptions")
	if err != nil || !subscriptionsExist {
		return err
	}
	_, err = db.ExecContext(ctx, `UPDATE billing_subscriptions
		SET entitlement_snapshot = REPLACE(entitlement_snapshot, '"plan_id":"creator"', '"plan_id":"founder"')
		WHERE entitlement_snapshot LIKE '%"plan_id":"creator"%'`)
	return err
}

func ensurePublicationRepostOverride(ctx context.Context, db *bun.DB) error {
	exists, err := migrationTableExists(ctx, db, "publications")
	if err != nil || !exists {
		return err
	}
	present, err := migrationColumnExists(ctx, db, "publications", "repost_override_json")
	if err != nil || present {
		return err
	}
	_, err = db.ExecContext(ctx, `ALTER TABLE publications ADD COLUMN repost_override_json TEXT NOT NULL DEFAULT '{"mode":"inherit"}'`)
	return err
}

func ensureEmailVerificationUserField(ctx context.Context, db *bun.DB) error {
	exists, err := migrationTableExists(ctx, db, "users")
	if err != nil || !exists {
		return err
	}
	present, err := migrationColumnExists(ctx, db, "users", "email_verified_at")
	if err != nil || present {
		return err
	}
	if _, err = db.ExecContext(ctx, "ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMP"); err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `UPDATE users
		SET email_verified_at = COALESCE(created_at, current_timestamp)
		WHERE email_verified_at IS NULL`)
	return err
}

func ensureComposerExperienceUserField(ctx context.Context, db *bun.DB) error {
	exists, err := migrationTableExists(ctx, db, "users")
	if err != nil || !exists {
		return err
	}
	present, err := migrationColumnExists(ctx, db, "users", "composer_experience")
	if err != nil || present {
		return err
	}
	_, err = db.ExecContext(ctx, "ALTER TABLE users ADD COLUMN composer_experience TEXT NOT NULL DEFAULT 'specialized'")
	return err
}

func ensurePublicProfileUserFields(ctx context.Context, db *bun.DB) error {
	exists, err := migrationTableExists(ctx, db, "users")
	if err != nil || !exists {
		return err
	}
	if err := ensurePublicProfileColumns(ctx, db); err != nil {
		return err
	}
	if err := backfillPublicProfileUsernames(ctx, db); err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
		ON users (LOWER(username)) WHERE username <> ''`)
	return err
}

func ensurePublicProfileColumns(ctx context.Context, db *bun.DB) error {
	usernamePresent, err := migrationColumnExists(ctx, db, "users", "username")
	if err != nil {
		return err
	}
	if !usernamePresent {
		if _, err := db.ExecContext(ctx, "ALTER TABLE users ADD COLUMN username TEXT NOT NULL DEFAULT ''"); err != nil {
			return err
		}
	}
	publicProfilePresent, err := migrationColumnExists(ctx, db, "users", "public_profile_enabled")
	if err != nil {
		return err
	}
	if !publicProfilePresent {
		columnType := "BOOLEAN"
		if db.Dialect().Name() == dialect.SQLite {
			columnType = "INTEGER"
		}
		if _, err := db.ExecContext(ctx, "ALTER TABLE users ADD COLUMN public_profile_enabled "+columnType+" NOT NULL DEFAULT FALSE"); err != nil {
			return err
		}
	}
	return nil
}

func backfillPublicProfileUsernames(ctx context.Context, db *bun.DB) error {
	type migrationUser struct {
		ID       string `bun:"id"`
		Email    string `bun:"email"`
		Username string `bun:"username"`
	}
	var users []migrationUser
	if err := db.NewSelect().Table("users").Column("id", "email", "username").Order("created_at ASC", "id ASC").Scan(ctx, &users); err != nil {
		return err
	}
	used := make(map[string]struct{}, len(users))
	for _, user := range users {
		if normalized := usernames.Normalize(user.Username); normalized != "" {
			used[normalized] = struct{}{}
		}
	}
	for _, user := range users {
		if usernames.Normalize(user.Username) != "" {
			continue
		}
		base := usernames.Suggest("", user.Email)
		candidate := base
		for attempt := 0; ; attempt++ {
			candidate = usernames.Candidate(base, user.ID, attempt)
			if _, taken := used[candidate]; !taken {
				break
			}
		}
		if _, err := db.NewUpdate().Table("users").Set("username = ?", candidate).Where("id = ?", user.ID).Exec(ctx); err != nil {
			return err
		}
		used[candidate] = struct{}{}
	}
	return nil
}

func addVideoProjectIDToMediaAttachments(ctx context.Context, db *bun.DB) error {
	exists, err := migrationTableExists(ctx, db, "media_attachments")
	if err != nil || !exists {
		return err
	}
	present, err := migrationColumnExists(ctx, db, "media_attachments", "video_project_id")
	if err != nil || present {
		return err
	}
	_, err = db.ExecContext(ctx, "ALTER TABLE media_attachments ADD COLUMN video_project_id TEXT NOT NULL DEFAULT ''")
	return err
}

// ensurePromptExampleColumn guarantees the prompts table has the example column
// before the raw SQL migration runs. Legacy databases created prompts through
// the base-table bootstrap without the column, and migration regression tests
// use minimal schemas that may not include the prompts table at all.
func ensurePromptExampleColumn(ctx context.Context, db *bun.DB) error {
	exists, err := migrationTableExists(ctx, db, "prompts")
	if err != nil {
		return err
	}
	if !exists {
		if _, err := db.NewCreateTable().
			Model((*models.Prompt)(nil)).
			IfNotExists().
			Exec(ctx); err != nil {
			return err
		}
	}
	present, err := migrationColumnExists(ctx, db, "prompts", "example")
	if err != nil {
		return err
	}
	if present {
		return nil
	}
	_, err = db.ExecContext(ctx, "ALTER TABLE prompts ADD COLUMN example TEXT NOT NULL DEFAULT ''")
	return err
}

func makeUserPasswordOptional(ctx context.Context, db *bun.DB) error {
	exists, err := migrationTableExists(ctx, db, "users")
	if err != nil || !exists {
		return err
	}

	switch db.Dialect().Name() {
	case dialect.PG:
		_, err := db.ExecContext(ctx, "ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL")
		return err
	case dialect.SQLite:
		type sqliteColumn struct {
			Name    string `bun:"name"`
			NotNull int    `bun:"notnull"`
		}
		var columns []sqliteColumn
		if err := db.NewSelect().
			TableExpr("pragma_table_info(?)", "users").
			Column("name", "notnull").
			Scan(ctx, &columns); err != nil {
			return err
		}
		for _, column := range columns {
			if column.Name == "password_hash" && column.NotNull == 0 {
				return nil
			}
		}
		return rebuildSQLiteUsersWithOptionalPassword(ctx, db)
	default:
		return nil
	}
}

func rebuildSQLiteUsersWithOptionalPassword(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, "PRAGMA foreign_keys=OFF"); err != nil {
		return err
	}
	defer func() {
		_, _ = db.ExecContext(context.Background(), "PRAGMA foreign_keys=ON")
	}()

	return db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(txCtx, `
			CREATE TABLE users_rebuild_051 (
				id TEXT PRIMARY KEY,
				email TEXT NOT NULL UNIQUE,
				display_name TEXT NOT NULL DEFAULT '',
				avatar_url TEXT NOT NULL DEFAULT '',
				avatar_object_key TEXT NOT NULL DEFAULT '',
				password_hash TEXT,
				is_admin BOOLEAN NOT NULL DEFAULT false,
				totp_secret_encrypted BLOB,
				totp_enabled_at DATETIME,
				passkey_enabled_at DATETIME,
				terms_version TEXT NOT NULL DEFAULT '',
				privacy_version TEXT NOT NULL DEFAULT '',
				legal_accepted_at DATETIME,
				created_at DATETIME NOT NULL DEFAULT current_timestamp
			)
		`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(txCtx, `
			INSERT INTO users_rebuild_051 (
				id, email, display_name, avatar_url, avatar_object_key,
				password_hash, is_admin, totp_secret_encrypted, totp_enabled_at,
				passkey_enabled_at, terms_version, privacy_version,
				legal_accepted_at, created_at
			)
			SELECT
				id, email, display_name, avatar_url, avatar_object_key,
				password_hash, is_admin, totp_secret_encrypted, totp_enabled_at,
				passkey_enabled_at, terms_version, privacy_version,
				legal_accepted_at, created_at
			FROM users
		`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(txCtx, "DROP TABLE users"); err != nil {
			return err
		}
		_, err := tx.ExecContext(txCtx, "ALTER TABLE users_rebuild_051 RENAME TO users")
		return err
	})
}

func addPublishingFailureColumnsToPostDestinations(ctx context.Context, db *bun.DB) error {
	exists, err := migrationTableExists(ctx, db, "post_destinations")
	if err != nil || !exists {
		return err
	}

	columns := []struct {
		name       string
		definition string
	}{
		{name: "error_kind", definition: "TEXT NOT NULL DEFAULT ''"},
		{name: "error_code", definition: "TEXT NOT NULL DEFAULT ''"},
		{name: "error_http_status", definition: "INTEGER NOT NULL DEFAULT 0"},
		{name: "error_retryable", definition: "BOOLEAN NOT NULL DEFAULT false"},
		{name: "error_retry_at", definition: "TIMESTAMP"},
		{name: "error_action", definition: "TEXT NOT NULL DEFAULT ''"},
	}
	for _, column := range columns {
		present, err := migrationColumnExists(ctx, db, "post_destinations", column.name)
		if err != nil {
			return err
		}
		if present {
			continue
		}
		if _, err := db.ExecContext(
			ctx,
			fmt.Sprintf("ALTER TABLE post_destinations ADD COLUMN %s %s", column.name, column.definition),
		); err != nil {
			return err
		}
	}
	return nil
}

func migrationTableExists(ctx context.Context, db *bun.DB, table string) (bool, error) {
	switch db.Dialect().Name() {
	case dialect.PG:
		var exists bool
		err := db.NewSelect().
			TableExpr("information_schema.tables").
			ColumnExpr("EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?)", table).
			Scan(ctx, &exists)
		return exists, err
	case dialect.SQLite:
		count, err := db.NewSelect().
			TableExpr("sqlite_master").
			Where("type = 'table' AND name = ?", table).
			Count(ctx)
		return count > 0, err
	default:
		return false, nil
	}
}

func migrationColumnExists(ctx context.Context, db *bun.DB, table, column string) (bool, error) {
	switch db.Dialect().Name() {
	case dialect.PG:
		count, err := db.NewSelect().
			TableExpr("information_schema.columns").
			Where("table_schema = current_schema()").
			Where("table_name = ?", table).
			Where("column_name = ?", column).
			Count(ctx)
		return count > 0, err
	case dialect.SQLite:
		type sqliteColumn struct {
			Name string `bun:"name"`
		}
		var columns []sqliteColumn
		if err := db.NewSelect().
			TableExpr("pragma_table_info(?)", table).
			Column("name").
			Scan(ctx, &columns); err != nil {
			return false, err
		}
		for _, existing := range columns {
			if existing.Name == column {
				return true, nil
			}
		}
		return false, nil
	default:
		return false, nil
	}
}

func removeGlobalMediaHashConstraint(ctx context.Context, db *bun.DB) error {
	switch db.Dialect().Name() {
	case dialect.PG:
		_, err := db.ExecContext(ctx, "ALTER TABLE media_attachments DROP CONSTRAINT IF EXISTS media_attachments_file_hash_key")
		return err
	case dialect.SQLite:
		return rebuildSQLiteMediaAttachmentsWithoutGlobalHashUnique(ctx, db)
	default:
		return nil
	}
}

func rebuildSQLiteMediaAttachmentsWithoutGlobalHashUnique(ctx context.Context, db *bun.DB) error {
	var createSQL string
	err := db.NewSelect().
		TableExpr("sqlite_master").
		Column("sql").
		Where("type = 'table' AND name = 'media_attachments'").
		Scan(ctx, &createSQL)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	inlineUniqueExpr := regexp.MustCompile(`(?i)("?file_hash"?\s+(?:TEXT|VARCHAR(?:\(\d+\))?))\s+UNIQUE`)
	tableUniqueExpr := regexp.MustCompile(`(?i),\s*(?:CONSTRAINT\s+"?[^"]+"?\s+)?UNIQUE\s*\(\s*"?file_hash"?\s*\)`)
	if !inlineUniqueExpr.MatchString(createSQL) && !tableUniqueExpr.MatchString(createSQL) {
		return nil
	}

	type sqliteIndex struct {
		Name string `bun:"name"`
		SQL  string `bun:"sql"`
	}
	var indexes []sqliteIndex
	if err := db.NewSelect().
		TableExpr("sqlite_master").
		Column("name", "sql").
		Where("type = 'index' AND tbl_name = 'media_attachments' AND sql IS NOT NULL").
		Scan(ctx, &indexes); err != nil {
		return err
	}

	rebuildSQL := strings.Replace(createSQL, `"media_attachments"`, `"media_attachments_rebuild_036"`, 1)
	if rebuildSQL == createSQL {
		rebuildSQL = strings.Replace(createSQL, "media_attachments", "media_attachments_rebuild_036", 1)
	}
	rebuildSQL = inlineUniqueExpr.ReplaceAllString(rebuildSQL, "$1")
	rebuildSQL = tableUniqueExpr.ReplaceAllString(rebuildSQL, "")

	if _, err := db.ExecContext(ctx, "PRAGMA foreign_keys=OFF"); err != nil {
		return err
	}
	defer func() {
		_, _ = db.ExecContext(context.Background(), "PRAGMA foreign_keys=ON")
	}()

	return db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(txCtx, rebuildSQL); err != nil {
			return err
		}
		if _, err := tx.ExecContext(txCtx, "INSERT INTO media_attachments_rebuild_036 SELECT * FROM media_attachments"); err != nil {
			return err
		}
		if _, err := tx.ExecContext(txCtx, "DROP TABLE media_attachments"); err != nil {
			return err
		}
		if _, err := tx.ExecContext(txCtx, "ALTER TABLE media_attachments_rebuild_036 RENAME TO media_attachments"); err != nil {
			return err
		}
		for _, index := range indexes {
			if strings.TrimSpace(index.SQL) == "" {
				continue
			}
			if _, err := tx.ExecContext(txCtx, index.SQL); err != nil {
				return fmt.Errorf("recreate index %s: %w", index.Name, err)
			}
		}
		return nil
	})
}

var (
	postgresBlobTypeExpr         = regexp.MustCompile(`(?i)\bBLOB\b`)
	postgresDateTimeTypeExpr     = regexp.MustCompile(`(?i)\bDATETIME\b`)
	postgresBooleanDefaultFalse  = regexp.MustCompile(`(?i)\bBOOLEAN\b(\s+NOT\s+NULL)?\s+DEFAULT\s+0\b`)
	postgresBooleanDefaultTrue   = regexp.MustCompile(`(?i)\bBOOLEAN\b(\s+NOT\s+NULL)?\s+DEFAULT\s+1\b`)
	postgresBooleanIsActiveFalse = regexp.MustCompile(`\bis_active\s*=\s*0\b`)
	postgresBooleanIsActiveTrue  = regexp.MustCompile(`\bis_active\s*=\s*1\b`)
	postgresAddColumnExpr        = regexp.MustCompile(`(?is)(\bALTER\s+TABLE\b[^;]*?\bADD\s+COLUMN)(?:\s+IF\s+NOT\s+EXISTS)?\s+`)
)

func normalizeMigrationSQL(name dialect.Name, raw string) string {
	if name != dialect.PG {
		return raw
	}

	out := postgresBlobTypeExpr.ReplaceAllString(raw, "BYTEA")
	out = postgresDateTimeTypeExpr.ReplaceAllString(out, "TIMESTAMPTZ")
	out = postgresBooleanDefaultFalse.ReplaceAllString(out, "BOOLEAN${1} DEFAULT FALSE")
	out = postgresBooleanDefaultTrue.ReplaceAllString(out, "BOOLEAN${1} DEFAULT TRUE")
	out = postgresBooleanIsActiveFalse.ReplaceAllString(out, "is_active = FALSE")
	out = postgresBooleanIsActiveTrue.ReplaceAllString(out, "is_active = TRUE")
	out = postgresAddColumnIfNotExists(out)
	return out
}

func postgresAddColumnIfNotExists(raw string) string {
	return postgresAddColumnExpr.ReplaceAllString(raw, "${1} IF NOT EXISTS ")
}

type migration struct {
	version int64
	name    string
	sql     string
}

func runMigration(ctx context.Context, db *bun.DB, m migration) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		// Split by ";" and execute each statement
		statements := splitStatements(m.sql)
		for _, stmt := range statements {
			stmt = strings.TrimSpace(stmt)
			if stmt == "" {
				continue
			}
			if _, err := tx.ExecContext(txCtx, stmt); err != nil {
				// SQLite: ignore "duplicate column name" — migration may already be applied
				// via CreateSchema on a fresh database. Postgres reports the same
				// condition as "column ... already exists".
				if isDuplicateColumnMigrationError(stmt, err) {
					continue
				}
				return fmt.Errorf("statement failed: %s: %w", stmt, err)
			}
		}

		// Record migration
		record := &SchemaMigration{
			Version:   m.version,
			AppliedAt: time.Now().Unix(),
		}
		if _, err := tx.NewInsert().Model(record).Exec(txCtx); err != nil {
			return fmt.Errorf("failed to record migration: %w", err)
		}
		return nil
	})
}

func isDuplicateColumnMigrationError(stmt string, err error) bool {
	if err == nil {
		return false
	}
	normalizedStmt := strings.ToUpper(strings.TrimSpace(stmt))
	if !strings.HasPrefix(normalizedStmt, "ALTER TABLE") || !strings.Contains(normalizedStmt, "ADD COLUMN") {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "duplicate column name") || strings.Contains(message, "already exists")
}

func parseVersion(filename string) (int64, error) {
	base := path.Base(filename)
	parts := strings.SplitN(base, "_", 2)
	if len(parts) < 2 {
		return 0, fmt.Errorf("filename must start with a version number")
	}
	return strconv.ParseInt(parts[0], 10, 64)
}

func splitStatements(sql string) []string {
	var statements []string
	var current strings.Builder
	lines := strings.Split(sql, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "--") || strings.HasPrefix(trimmed, "#") {
			continue
		}
		current.WriteString(line)
		current.WriteString("\n")
		if strings.HasSuffix(trimmed, ";") {
			statements = append(statements, current.String())
			current.Reset()
		}
	}
	if current.Len() > 0 {
		statements = append(statements, current.String())
	}
	return statements
}
