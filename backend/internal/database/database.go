package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/openpost/backend/internal/database/migrations"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/pgdriver"
	"github.com/uptrace/bun/driver/sqliteshim"
)

func InitDB(dsn string) (*bun.DB, error) {
	return initSQLiteDB(dsn)
}

func InitDBWithDriver(driver, dsn string) (*bun.DB, error) {
	return InitDBWithDriverAndRole(driver, dsn, "all")
}

func InitDBWithDriverAndRole(driver, dsn, role string) (*bun.DB, error) {
	switch strings.ToLower(strings.TrimSpace(driver)) {
	case "", "sqlite":
		return initSQLiteDB(dsn)
	case "postgres":
		pool := poolConfigForRole(role)
		log.Printf(
			"PostgreSQL connection pool configured: role=%s max_open=%d max_idle=%d max_lifetime=%s max_idle_time=%s",
			strings.ToLower(strings.TrimSpace(role)),
			pool.MaxOpenConnections,
			pool.MaxIdleConnections,
			pool.ConnectionMaxLifetime,
			pool.ConnectionMaxIdleTime,
		)
		return initPostgresDB(dsn, pool)
	default:
		return nil, fmt.Errorf("unsupported database driver %q", driver)
	}
}

type poolConfig struct {
	MaxOpenConnections    int
	MaxIdleConnections    int
	ConnectionMaxLifetime time.Duration
	ConnectionMaxIdleTime time.Duration
}

func poolConfigForRole(role string) poolConfig {
	config := poolConfig{
		MaxOpenConnections:    20,
		MaxIdleConnections:    5,
		ConnectionMaxLifetime: 30 * time.Minute,
		ConnectionMaxIdleTime: 5 * time.Minute,
	}
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "web":
		config.MaxOpenConnections = 16
		config.MaxIdleConnections = 4
	case "worker":
		config.MaxOpenConnections = 8
		config.MaxIdleConnections = 2
	case "migrate":
		config.MaxOpenConnections = 2
		config.MaxIdleConnections = 1
	}
	return config
}

func initSQLiteDB(dsn string) (*bun.DB, error) {
	// The driver does not create parent directories, and the failure surfaces
	// as a misleading "unable to open database file: out of memory (14)" on
	// the first statement. A container image can pre-create the directory,
	// but a volume mounted over it masks that, so create it at open time.
	if dir := sqliteFileDir(dsn); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create sqlite database directory: %w", err)
		}
	}

	// DSN e.g. "file:openpost.db?cache=shared&mode=rwc"
	sqldb, err := sql.Open(sqliteshim.ShimName, dsn)
	if err != nil {
		return nil, err
	}

	// SQLite highly recommends max open conns to 1 when writing is involved
	// though WAL mode helps with concurrent readers
	sqldb.SetMaxOpenConns(1)

	db := bun.NewDB(sqldb, sqlitedialect.New())

	// Performance PRAGMAs
	if _, err := db.Exec("PRAGMA journal_mode=WAL;"); err != nil {
		return nil, err
	}
	if _, err := db.Exec("PRAGMA busy_timeout=5000;"); err != nil {
		return nil, err
	}
	if _, err := db.Exec("PRAGMA synchronous=NORMAL;"); err != nil {
		return nil, err
	}
	if _, err := db.Exec("PRAGMA foreign_keys=ON;"); err != nil {
		return nil, err
	}

	return db, nil
}

// sqliteFileDir returns the parent directory of the DSN's database file, or ""
// when the DSN does not reference a file outside the working directory
// (memory databases, bare filenames).
func sqliteFileDir(dsn string) string {
	path := dsn
	if strings.HasPrefix(dsn, "file:") {
		parsed, err := url.Parse(dsn)
		if err != nil {
			return ""
		}
		if parsed.Query().Get("mode") == "memory" {
			return ""
		}
		if parsed.Host != "" && !strings.EqualFold(parsed.Host, "localhost") {
			return ""
		}
		path = parsed.Path
		if parsed.Opaque != "" {
			path, err = url.PathUnescape(parsed.Opaque)
			if err != nil {
				return ""
			}
		}
	}
	if path == "" || path == ":memory:" {
		return ""
	}
	if dir := filepath.Dir(path); dir != "." && dir != string(filepath.Separator) {
		return dir
	}
	return ""
}

func initPostgresDB(dsn string, pool poolConfig) (*bun.DB, error) {
	if strings.TrimSpace(dsn) == "" {
		return nil, fmt.Errorf("postgres database dsn is required")
	}
	parsedDSN, err := url.Parse(dsn)
	if err != nil {
		return nil, errors.New("parse postgres database dsn: invalid URL")
	}
	query := parsedDSN.Query()
	query.Set("timezone", "UTC")
	parsedDSN.RawQuery = query.Encode()

	sqldb := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(parsedDSN.String())))
	sqldb.SetMaxOpenConns(pool.MaxOpenConnections)
	sqldb.SetMaxIdleConns(pool.MaxIdleConnections)
	sqldb.SetConnMaxLifetime(pool.ConnectionMaxLifetime)
	sqldb.SetConnMaxIdleTime(pool.ConnectionMaxIdleTime)
	db := bun.NewDB(sqldb, pgdialect.New())
	db.AddQueryHook(newPoolObserverHook(log.Printf))
	return db, nil
}

func CreateSchema(db *bun.DB) error {
	ctx := context.Background()
	m := []interface{}{
		(*models.Organization)(nil),
		(*models.OrganizationMember)(nil),
		(*models.OrganizationInvitation)(nil),
		(*models.Workspace)(nil),
		(*models.User)(nil),
		(*models.EmailVerificationChallenge)(nil),
		(*models.PasswordResetToken)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.WorkspaceInvitation)(nil),
		(*models.UsageCounter)(nil),
		(*models.BillingSubscription)(nil),
		(*models.BillingWebhookEvent)(nil),
		(*models.MCPToolCall)(nil),
		(*models.MastodonInstance)(nil),
		(*models.ProviderApp)(nil),
		(*models.ProviderInstallation)(nil),
		(*models.InstanceSetting)(nil),
		(*models.AIPromptOverride)(nil),
		(*models.SocialAccount)(nil),
		(*models.ProviderAccountBinding)(nil),
		(*models.ConnectorConnectionSession)(nil),
		(*models.WorkspaceFirstConnection)(nil),
		(*models.WorkspaceFirstComposition)(nil),
		(*models.WorkspaceActivation)(nil),
		(*models.ProductAnalyticsEvent)(nil),
		(*models.SocialSet)(nil),
		(*models.SocialSetAccount)(nil),
		(*models.UserPasskey)(nil),
		(*models.UserSession)(nil),
		(*models.UserImpersonationGrant)(nil),
		(*models.AuthChallenge)(nil),
		(*models.APIToken)(nil),
		(*models.MCPOAuthCode)(nil),
		(*models.CLIAuthSession)(nil),
		(*models.XOAuthRequestToken)(nil),
		(*models.OAuthAccountSelection)(nil),
		(*models.OAuthAccountSelectionReservation)(nil),
		(*models.Publication)(nil),
		(*models.PublicationSegment)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
		(*models.RenditionMedia)(nil),
		(*models.PublicationLifecycleEvent)(nil),
		(*models.PublicationAsset)(nil),
		(*models.PublicationAlias)(nil),
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.MediaAttachment)(nil),
		(*models.DesignDocument)(nil),
		(*models.DesignPage)(nil),
		(*models.DesignRevision)(nil),
		(*models.DesignMediaReference)(nil),
		(*models.DesignReturnToken)(nil),
		(*models.DesignTemplate)(nil),
		(*models.DesignTemplateMediaReference)(nil),
		(*models.BrandKit)(nil),
		(*models.BrandFont)(nil),
		(*models.MediaCollection)(nil),
		(*models.MediaCollectionItem)(nil),
		(*models.MediaTag)(nil),
		(*models.MediaTagAssignment)(nil),
		(*models.PostMedia)(nil),
		(*models.Job)(nil),
		(*models.PostVariant)(nil),
		(*models.PostingSchedule)(nil),
		(*models.Prompt)(nil),
		(*models.ThreadDraft)(nil),
		(*models.AccountFeature)(nil),
	}
	for _, model := range m {
		if _, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx); err != nil {
			return fmt.Errorf("failed to create table: %w", err)
		}
	}

	// Run pending migrations
	if err := migrations.RunMigrations(db); err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}
	if _, err := db.NewCreateIndex().
		Index("jobs_status_run_at_idx").
		Table("jobs").
		Column("status", "run_at").
		IfNotExists().
		Exec(ctx); err != nil {
		return fmt.Errorf("failed to create jobs polling index: %w", err)
	}
	if err := jobregistry.EnsureActiveDedupeIndex(ctx, db); err != nil {
		return fmt.Errorf("failed to create jobs active dedupe index: %w", err)
	}
	if _, err := db.NewCreateIndex().
		Index("analytics_sweep_pending_unique_idx").
		Table("jobs").
		Column("type").
		Unique().
		Where("status = 'pending' AND type = 'analytics_sweep'").
		IfNotExists().
		Exec(ctx); err != nil {
		return fmt.Errorf("failed to create analytics sweep uniqueness index: %w", err)
	}
	if _, err := db.NewCreateIndex().
		Index("analytics_subject_active_unique_idx").
		Table("jobs").
		Column("type", "payload").
		Unique().
		Where("status IN ('pending', 'processing') AND type IN ('analytics_account_sync', 'analytics_rendition_sync')").
		IfNotExists().
		Exec(ctx); err != nil {
		return fmt.Errorf("failed to create analytics subject uniqueness index: %w", err)
	}
	if _, err := db.NewCreateIndex().
		Index("engagement_sweep_pending_unique_idx").
		Table("jobs").
		Column("type").
		Unique().
		Where("status = 'pending' AND type = 'engagement_sweep'").
		IfNotExists().
		Exec(ctx); err != nil {
		return fmt.Errorf("failed to create engagement sweep uniqueness index: %w", err)
	}
	if _, err := db.NewCreateIndex().
		Index("messaging_sweep_pending_unique_idx").
		Table("jobs").
		Column("type").
		Unique().
		Where("status = 'pending' AND type = 'messaging_sweep'").
		IfNotExists().
		Exec(ctx); err != nil {
		return fmt.Errorf("failed to create messaging sweep uniqueness index: %w", err)
	}
	if _, err := db.NewCreateIndex().
		Index("engagement_subject_active_unique_idx").
		Table("jobs").
		Column("type", "payload").
		Unique().
		Where("status IN ('pending', 'processing') AND type IN ('engagement_sync', 'engagement_action')").
		IfNotExists().
		Exec(ctx); err != nil {
		return fmt.Errorf("failed to create engagement subject uniqueness index: %w", err)
	}
	if _, err := db.NewCreateIndex().
		Index("messaging_subject_active_unique_idx").
		Table("jobs").Column("type", "payload").Unique().
		Where("status IN ('pending', 'processing') AND type IN ('messages_sync', 'message_send')").
		IfNotExists().Exec(ctx); err != nil {
		return fmt.Errorf("failed to create messaging subject uniqueness index: %w", err)
	}
	if _, err := db.NewCreateIndex().
		Index("repost_sweep_pending_unique_idx").
		Table("jobs").
		Column("type").
		Unique().
		Where("status = 'pending' AND type = 'repost_sweep'").
		IfNotExists().
		Exec(ctx); err != nil {
		return fmt.Errorf("failed to create repost sweep uniqueness index: %w", err)
	}

	return nil
}
