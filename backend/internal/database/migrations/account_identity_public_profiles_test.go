package migrations

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestAccountIdentityPublicProfileMigrationPreservesPrivacyContracts(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	var visibility string
	require.NoError(t, db.NewSelect().
		Table("users").
		Column("public_profile_visibility_json").
		Where("id = ?", "user-1").
		Scan(ctx, &visibility))
	// Fresh/private accounts use a valid JSON null sentinel and disclose no
	// optional fields until the user makes an explicit selection.
	require.JSONEq(t, `null`, visibility)

	_, err := db.ExecContext(ctx, `
		INSERT INTO identity_providers (
			id, issuer, name, client_id, require_verified_email, jit_enabled, is_active
		) VALUES ('provider-1', 'https://id.example.test', 'Example ID', 'client-1', true, true, true)
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO user_identities (id, provider_id, subject, user_id, linked_email)
		VALUES ('identity-1', 'provider-1', 'subject-1', 'user-1', 'person@example.test')
	`)
	require.NoError(t, err)
	var linkedName string
	require.NoError(t, db.NewSelect().
		Table("user_identities").
		Column("linked_name").
		Where("id = ?", "identity-1").
		Scan(ctx, &linkedName))
	require.Empty(t, linkedName)
}

func TestAccountIdentityMigrationBackfillsLegacyPublicProfileVisibility(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	_, err := db.ExecContext(ctx, `DROP TABLE users`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `CREATE TABLE users (
		id TEXT PRIMARY KEY,
		email TEXT NOT NULL UNIQUE,
		public_profile_enabled BOOLEAN NOT NULL DEFAULT false
	)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO users (id, email, public_profile_enabled)
		VALUES ('legacy-user', 'legacy@example.test', true),
		       ('private-user', 'private@example.test', false)`)
	require.NoError(t, err)

	require.NoError(t, prepareAccountIdentityPublicProfileSchema(ctx, db))
	var visibility string
	require.NoError(t, db.NewSelect().Table("users").Column("public_profile_visibility_json").
		Where("id = ?", "legacy-user").Scan(ctx, &visibility))
	require.JSONEq(t, `["display_name","avatar","joined_at","activity","platforms","workspaces","plan"]`, visibility)
	require.NoError(t, db.NewSelect().Table("users").Column("public_profile_visibility_json").
		Where("id = ?", "private-user").Scan(ctx, &visibility))
	require.JSONEq(t, `["username"]`, visibility)
}

func TestAccountIdentityPreparationRetriesInterruptedVisibilityBackfill(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	_, err := db.ExecContext(ctx, `DROP TABLE users`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `CREATE TABLE users (
		id TEXT PRIMARY KEY,
		email TEXT NOT NULL UNIQUE,
		public_profile_enabled BOOLEAN NOT NULL DEFAULT false
	)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO users (id, email, public_profile_enabled)
		VALUES ('legacy-public', 'public@example.test', true),
		       ('legacy-private', 'private@example.test', false)`)
	require.NoError(t, err)

	// Simulate a process stopping after the non-transactional ALTER completed
	// but before preparation could preserve the legacy public profile behavior.
	_, err = db.ExecContext(ctx, `ALTER TABLE users
		ADD COLUMN public_profile_visibility_json TEXT NOT NULL DEFAULT '["username"]'`)
	require.NoError(t, err)
	require.NoError(t, prepareMigration(ctx, db, migration{
		version: 81,
		name:    "081_account_identity_and_public_profiles.sql",
		sql:     "SELECT 1",
	}))

	var visibility string
	require.NoError(t, db.NewSelect().Table("users").Column("public_profile_visibility_json").
		Where("id = ?", "legacy-public").Scan(ctx, &visibility))
	require.JSONEq(t, `["display_name","avatar","joined_at","activity","platforms","workspaces","plan"]`, visibility)
	require.NoError(t, db.NewSelect().Table("users").Column("public_profile_visibility_json").
		Where("id = ?", "legacy-private").Scan(ctx, &visibility))
	require.JSONEq(t, `["username"]`, visibility)

	// Once 081 is recorded, the repair/finalization path must preserve a user's
	// later explicit choice to publish only the always-visible username.
	_, err = db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&SchemaMigration{Version: 81, AppliedAt: time.Now().Unix()}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().Table("users").
		Set("public_profile_visibility_json = ?", `["username"]`).
		Where("id = ?", "legacy-public").Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, ensureAccountIdentityPublicProfileSchema(ctx, db))
	require.NoError(t, db.NewSelect().Table("users").Column("public_profile_visibility_json").
		Where("id = ?", "legacy-public").Scan(ctx, &visibility))
	require.JSONEq(t, `["username"]`, visibility)
}

func TestAccountIdentityMigrationIsReachedByPrepareDispatch(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	_, err := db.ExecContext(ctx, `DROP TABLE users`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `CREATE TABLE users (
		id TEXT PRIMARY KEY,
		email TEXT NOT NULL UNIQUE,
		public_profile_enabled BOOLEAN NOT NULL DEFAULT false
	)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO users (id, email, public_profile_enabled)
		VALUES ('prepare-user', 'prepare@example.test', true)`)
	require.NoError(t, err)

	require.NoError(t, prepareMigration(ctx, db, migration{
		version: 81,
		name:    "081_account_identity_and_public_profiles.sql",
		sql:     "SELECT 1",
	}))

	columnExists, err := migrationColumnExists(ctx, db, "users", "public_profile_visibility_json")
	require.NoError(t, err)
	require.True(t, columnExists)
	tableExists, err := migrationTableExists(ctx, db, "email_change_challenges")
	require.NoError(t, err)
	require.True(t, tableExists)
}

func TestEmailChangeChallengesAllowOnlyOneActiveRequestAndCascade(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))

	now := time.Now().UTC()
	challenge := &models.EmailChangeChallenge{
		ID: "change-1", UserID: "user-1", OldEmail: "user-1@example.com",
		NewEmail: "new@example.com", CodeHash: strings.Repeat("a", 64),
		ExpiresAt: now.Add(time.Hour), CreatedAt: now,
	}
	_, err := db.NewInsert().Model(challenge).Exec(ctx)
	require.NoError(t, err)

	second := *challenge
	second.ID = "change-2"
	second.NewEmail = "newer@example.com"
	second.CodeHash = strings.Repeat("b", 64)
	_, err = db.NewInsert().Model(&second).Exec(ctx)
	require.Error(t, err)

	_, err = db.NewUpdate().Model((*models.EmailChangeChallenge)(nil)).
		Set("canceled_at = ?", now).
		Where("id = ?", challenge.ID).
		Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&second).Exec(ctx)
	require.NoError(t, err)

	_, err = db.NewDelete().Model((*models.User)(nil)).Where("id = ?", "user-1").Exec(ctx)
	require.NoError(t, err)
	count, err := db.NewSelect().Model((*models.EmailChangeChallenge)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
}
