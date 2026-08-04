package migrations

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

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
	entries, err := migrationFiles.ReadDir(".")
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
		content, err := migrationFiles.ReadFile(entry.Name())
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

func finalizeMigrations(ctx context.Context, db *bun.DB, appliedSet map[int64]bool) error {
	if err := repairAppliedSchema(ctx, db, appliedSet); err != nil {
		return err
	}
	if err := MigrateLegacyPublicationAuthoring(ctx, db); err != nil {
		return fmt.Errorf("legacy publication authoring migration failed: %w", err)
	}
	return nil
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
	case 36:
		description = "media hash"
		err = removeGlobalMediaHashConstraint(ctx, db)
	case 39:
		description = "post destination"
		err = addPublishingFailureColumnsToPostDestinations(ctx, db)
	case 41:
		description = "publication editor backfill"
		err = backfillPublicationTextEditors(ctx, db)
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
	}
	if err != nil {
		return fmt.Errorf("migration %s %s preparation failed: %w", migration.name, description, err)
	}
	return nil
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
	postgresAddColumnExpr        = regexp.MustCompile(`(?i)\bADD\s+COLUMN\s+`)
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
	var out strings.Builder
	lines := strings.Split(raw, "\n")
	for i, line := range lines {
		upper := strings.ToUpper(line)
		if strings.Contains(upper, "ALTER TABLE") &&
			strings.Contains(upper, " ADD COLUMN") &&
			!strings.Contains(upper, " ADD COLUMN IF NOT EXISTS") {
			line = postgresAddColumnExpr.ReplaceAllString(line, "ADD COLUMN IF NOT EXISTS ")
		}
		if i > 0 {
			out.WriteByte('\n')
		}
		out.WriteString(line)
	}
	return out.String()
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
