package database

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

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
	switch strings.ToLower(strings.TrimSpace(driver)) {
	case "", "sqlite":
		return initSQLiteDB(dsn)
	case "postgres":
		return initPostgresDB(dsn)
	default:
		return nil, fmt.Errorf("unsupported database driver %q", driver)
	}
}

func initSQLiteDB(dsn string) (*bun.DB, error) {
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

func initPostgresDB(dsn string) (*bun.DB, error) {
	if strings.TrimSpace(dsn) == "" {
		return nil, fmt.Errorf("postgres database dsn is required")
	}

	sqldb := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	return bun.NewDB(sqldb, pgdialect.New()), nil
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
		(*models.InstanceSetting)(nil),
		(*models.SocialAccount)(nil),
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
		(*models.Publication)(nil),
		(*models.PublicationSegment)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
		(*models.RenditionMedia)(nil),
		(*models.PublicationLifecycleEvent)(nil),
		(*models.PublicationAsset)(nil),
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
		Index("communications_sweep_pending_unique_idx").
		Table("jobs").
		Column("type").
		Unique().
		Where("status = 'pending' AND type = 'communications_sweep'").
		IfNotExists().
		Exec(ctx); err != nil {
		return fmt.Errorf("failed to create communications sweep uniqueness index: %w", err)
	}
	if _, err := db.NewCreateIndex().
		Index("communications_subject_active_unique_idx").
		Table("jobs").
		Column("type", "payload").
		Unique().
		Where("status IN ('pending', 'processing') AND type IN ('engagement_sync', 'messages_sync', 'engagement_action', 'message_send')").
		IfNotExists().
		Exec(ctx); err != nil {
		return fmt.Errorf("failed to create communications subject uniqueness index: %w", err)
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
