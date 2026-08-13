package migrations

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

type legacySocialAccount073 struct {
	bun.BaseModel `bun:"table:social_accounts"`

	ID                  string    `bun:",pk"`
	WorkspaceID         string    `bun:",notnull"`
	Slug                string    `bun:",notnull"`
	Platform            string    `bun:",notnull"`
	AccountID           string    `bun:",notnull"`
	AccountUsername     string    `bun:"account_username,notnull,default:''"`
	AccountAvatarURL    string    `bun:"account_avatar_url,notnull,default:''"`
	InstanceURL         string    `bun:"instance_url,notnull,default:''"`
	AccessTokenEnc      []byte    `bun:"access_token_encrypted,notnull"`
	RefreshTokenEnc     []byte    `bun:"refresh_token_encrypted"`
	TokenExpiresAt      time.Time `bun:"token_expires_at,nullzero"`
	GrantedScopes       string    `bun:"granted_scopes,notnull,default:''"`
	CapabilityState     string    `bun:"capability_state_json,notnull,default:'{}'"`
	CapabilityCheckedAt time.Time `bun:"capability_checked_at,nullzero"`
	IsActive            bool      `bun:"is_active,notnull,default:true"`
	ErrorMessage        string    `bun:"error_message,notnull,default:''"`
	CreatedAt           time.Time `bun:"created_at,nullzero,notnull,default:current_timestamp"`
}

func TestOAuthGrantMigrationsPreserveLegacyCredentialsSQLite(t *testing.T) {
	sqlDB, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	exerciseOAuthGrantMigrations(t, db)
}

func TestOAuthGrantMigrationsPreserveLegacyCredentialsPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))
	schema := fmt.Sprintf("oauth_grant_migration_%d", time.Now().UnixNano())
	_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})
	_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)
	exerciseOAuthGrantMigrations(t, db)
}

func exerciseOAuthGrantMigrations(t *testing.T, db *bun.DB) {
	t.Helper()
	ctx := t.Context()
	_, err := db.ExecContext(ctx, "CREATE TABLE workspaces (id TEXT PRIMARY KEY)")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, "INSERT INTO workspaces (id) VALUES (?)", "workspace-1")
	require.NoError(t, err)
	_, err = db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewCreateTable().Model((*legacySocialAccount073)(nil)).Exec(ctx)
	require.NoError(t, err)
	expiresAt := time.Now().UTC().Add(45 * time.Minute).Truncate(time.Second)
	createdAt := time.Now().UTC().Add(-24 * time.Hour).Truncate(time.Second)
	legacy := &legacySocialAccount073{
		ID:                  `account-"1`,
		WorkspaceID:         "workspace-1",
		Slug:                "linkedin-openpost",
		Platform:            "linkedin",
		AccountID:           "urn:li:organization:42",
		AccountUsername:     "OpenPost",
		AccessTokenEnc:      []byte("opaque-access-ciphertext"),
		RefreshTokenEnc:     []byte("opaque-refresh-ciphertext"),
		TokenExpiresAt:      expiresAt,
		GrantedScopes:       "w_member_social w_organization_social",
		CapabilityState:     `{"linkedin_account_type":"organization"}`,
		CapabilityCheckedAt: createdAt,
		IsActive:            true,
		CreatedAt:           createdAt,
	}
	_, err = db.NewInsert().Model(legacy).Exec(ctx)
	require.NoError(t, err)
	inactive := *legacy
	inactive.ID = "inactive-account"
	inactive.Slug = "inactive-linkedin"
	inactive.AccountID = "urn:li:person:inactive"
	inactive.IsActive = false
	_, err = db.NewInsert().Model(&inactive).Exec(ctx)
	require.NoError(t, err)
	missingCredentials := *legacy
	missingCredentials.ID = "missing-credentials-account"
	missingCredentials.Slug = "missing-credentials-linkedin"
	missingCredentials.AccountID = "urn:li:person:missing-credentials"
	missingCredentials.AccessTokenEnc = []byte{}
	_, err = db.NewInsert().Model(&missingCredentials).Exec(ctx)
	require.NoError(t, err)
	revoked := *legacy
	revoked.ID = "revoked-account"
	revoked.Slug = "revoked-linkedin"
	revoked.AccountID = "urn:li:person:revoked"
	_, err = db.NewInsert().Model(&revoked).Exec(ctx)
	require.NoError(t, err)

	content, err := migrationFiles.ReadFile("073_oauth_grants.sql")
	require.NoError(t, err)
	item := migration{version: 73, name: "073_oauth_grants.sql", sql: normalizeMigrationSQL(db.Dialect().Name(), string(content))}
	require.NoError(t, prepareMigration(ctx, db, item))
	require.NoError(t, runMigration(ctx, db, item))
	require.NoError(t, ensureOAuthGrantSchema(ctx, db), "finalization must be idempotent")

	var account models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&account).Where("id = ?", legacy.ID).Scan(ctx))
	require.Equal(t, "legacy:"+legacy.ID, account.OAuthGrantID)
	require.Empty(t, account.AccessTokenEnc)
	require.Empty(t, account.RefreshTokenEnc)
	require.True(t, account.TokenExpiresAt.IsZero())

	var grant models.OAuthGrant
	require.NoError(t, db.NewSelect().Model(&grant).Where("id = ?", account.OAuthGrantID).Scan(ctx))
	require.Equal(t, legacy.WorkspaceID, grant.WorkspaceID)
	require.Equal(t, legacy.Platform, grant.Provider)
	require.Equal(t, legacy.AccountID, grant.ProviderSubject)
	require.Equal(t, []byte("opaque-access-ciphertext"), grant.AccessTokenEnc)
	require.Equal(t, []byte("opaque-refresh-ciphertext"), grant.RefreshTokenEnc)
	require.WithinDuration(t, expiresAt, grant.AccessTokenExpiresAt, time.Second)
	require.Equal(t, legacy.GrantedScopes, grant.GrantedScopes)
	var evidence map[string]string
	require.NoError(t, json.Unmarshal([]byte(grant.AuthorizationEvidence), &evidence))
	require.Equal(t, map[string]string{
		"source":            "migration_073",
		"legacy_account_id": legacy.ID,
	}, evidence)
	require.Equal(t, "legacy_unverified", grant.ValidationStatus)
	require.EqualValues(t, 1, grant.TokenVersion)
	_, err = db.NewUpdate().Model((*models.OAuthGrant)(nil)).
		Set("revoked_at = ?", createdAt.Add(time.Hour)).
		Where("id = ?", "legacy:"+revoked.ID).
		Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("is_active = ?", false).
		Where("id = ?", inactive.ID).
		Exec(ctx)
	require.NoError(t, err)

	content, err = migrationFiles.ReadFile("085_validate_migrated_active_oauth_grants.sql")
	require.NoError(t, err)
	item = migration{version: 85, name: "085_validate_migrated_active_oauth_grants.sql", sql: normalizeMigrationSQL(db.Dialect().Name(), string(content))}
	require.NoError(t, runMigration(ctx, db, item))

	require.NoError(t, db.NewSelect().Model(&grant).Where("id = ?", account.OAuthGrantID).Scan(ctx))
	require.Equal(t, "valid", grant.ValidationStatus)
	require.WithinDuration(t, createdAt, grant.ValidatedAt, time.Second)
	for _, accountID := range []string{inactive.ID, missingCredentials.ID, revoked.ID} {
		var protected models.OAuthGrant
		require.NoError(t, db.NewSelect().Model(&protected).Where("id = ?", "legacy:"+accountID).Scan(ctx))
		require.Equal(t, "legacy_unverified", protected.ValidationStatus, accountID)
		require.True(t, protected.ValidatedAt.IsZero(), accountID)
	}
}

func TestOAuthGrantMigrationAllowsPartialFixtureWithoutSocialAccounts(t *testing.T) {
	sqlDB, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	content, err := migrationFiles.ReadFile("073_oauth_grants.sql")
	require.NoError(t, err)
	item := migration{version: 73, name: "073_oauth_grants.sql", sql: string(content)}
	_, err = db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, prepareMigration(t.Context(), db, item))
	require.NoError(t, runMigration(t.Context(), db, item))
	exists, err := migrationTableExists(t.Context(), db, "oauth_grants")
	require.NoError(t, err)
	require.True(t, exists)
}
