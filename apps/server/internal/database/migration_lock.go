package database

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/openpost/backend/internal/database/migrations"
	"github.com/uptrace/bun"
)

const postgresMigrationLockID int64 = 0x4f70656e506f7374

var inMemoryMigrationLock sync.Mutex

// CreateSchemaLocked serializes the full schema setup across application
// processes. PostgreSQL uses a session advisory lock, while file-backed SQLite
// uses an adjacent OS lock file shared by every process on that volume.
func CreateSchemaLocked(ctx context.Context, db *bun.DB, driver, dsn string) (err error) {
	unlock, err := acquireMigrationLock(ctx, db, driver, dsn)
	if err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	defer func() {
		if unlockErr := unlock(); unlockErr != nil && err == nil {
			err = fmt.Errorf("release migration lock: %w", unlockErr)
		}
	}()

	return CreateSchema(db)
}

// RequireCurrentSchema prevents long-lived web and worker roles from racing a
// release migration or silently serving against an older schema.
func RequireCurrentSchema(ctx context.Context, db *bun.DB) error {
	if err := migrations.RequireCurrent(ctx, db); err != nil {
		return fmt.Errorf("database schema is not current; run openpost migrate first: %w", err)
	}
	return nil
}

func acquireMigrationLock(
	ctx context.Context,
	db *bun.DB,
	driver string,
	dsn string,
) (func() error, error) {
	switch strings.ToLower(strings.TrimSpace(driver)) {
	case "postgres":
		return acquirePostgresMigrationLock(ctx, db)
	case "", "sqlite":
		return acquireSQLiteMigrationLock(ctx, dsn)
	default:
		return nil, fmt.Errorf("unsupported database driver %q", driver)
	}
}

func acquirePostgresMigrationLock(ctx context.Context, db *bun.DB) (func() error, error) {
	conn, err := db.DB.Conn(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := conn.ExecContext(ctx, "SELECT pg_advisory_lock($1)", postgresMigrationLockID); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return func() error {
		defer conn.Close()
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, err := conn.ExecContext(releaseCtx, "SELECT pg_advisory_unlock($1)", postgresMigrationLockID)
		return err
	}, nil
}

func acquireSQLiteMigrationLock(ctx context.Context, dsn string) (func() error, error) {
	databaseFile := sqliteDatabaseFile(dsn)
	if databaseFile == "" {
		inMemoryMigrationLock.Lock()
		return func() error {
			inMemoryMigrationLock.Unlock()
			return nil
		}, nil
	}

	return acquireMigrationFileLock(ctx, databaseFile+".migrate.lock")
}

func sqliteDatabaseFile(dsn string) string {
	if dsn == "" || dsn == ":memory:" {
		return ""
	}
	if !strings.HasPrefix(dsn, "file:") {
		return strings.SplitN(dsn, "?", 2)[0]
	}
	parsed, err := url.Parse(dsn)
	if err != nil || parsed.Query().Get("mode") == "memory" {
		return ""
	}
	if parsed.Host != "" && !strings.EqualFold(parsed.Host, "localhost") {
		return ""
	}
	if parsed.Opaque != "" {
		path, err := url.PathUnescape(parsed.Opaque)
		if err != nil || path == ":memory:" {
			return ""
		}
		return path
	}
	return parsed.Path
}
