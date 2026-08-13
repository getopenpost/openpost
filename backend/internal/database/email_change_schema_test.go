package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/publicprofiles"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestCreateSchemaBuildsEmailChangeForeignKeyOnFreshSQLite(t *testing.T) {
	db, err := InitDBWithDriver("sqlite", "file:"+t.Name()+"?mode=memory&cache=private")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, CreateSchema(db))
	assertFreshPublicProfileVisibilityDefault(t, db)

	rows, err := db.QueryContext(t.Context(), `PRAGMA foreign_key_list(email_change_challenges)`)
	require.NoError(t, err)
	defer rows.Close()
	foundCascade := false
	for rows.Next() {
		var id, sequence int
		var table, from, to, onUpdate, onDelete, match string
		require.NoError(t, rows.Scan(&id, &sequence, &table, &from, &to, &onUpdate, &onDelete, &match))
		if table == "users" && from == "user_id" && to == "id" && strings.EqualFold(onDelete, "CASCADE") {
			foundCascade = true
		}
	}
	require.NoError(t, rows.Err())
	require.True(t, foundCascade, "email-change challenges must reference users(id) ON DELETE CASCADE")
	assertEmailChangeCascade(t, db)
}

func TestCreateSchemaBuildsEmailChangeForeignKeyOnFreshPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}

	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))

	schema := fmt.Sprintf("email_change_schema_%d", time.Now().UnixNano())
	_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})
	_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)
	require.NoError(t, CreateSchema(db))
	assertFreshPublicProfileVisibilityDefault(t, db)

	var definition string
	require.NoError(t, db.QueryRowContext(t.Context(), `
		SELECT pg_get_constraintdef(constraint_row.oid)
		FROM pg_constraint AS constraint_row
		JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
		JOIN pg_namespace AS namespace_row ON namespace_row.oid = table_row.relnamespace
		WHERE namespace_row.nspname = ?
		  AND table_row.relname = 'email_change_challenges'
		  AND constraint_row.contype = 'f'
	`, schema).Scan(&definition))
	require.Contains(t, definition, "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE")
	assertEmailChangeCascade(t, db)
}

func assertFreshPublicProfileVisibilityDefault(t *testing.T, db *bun.DB) {
	t.Helper()
	user := &models.User{ID: "visibility-default-user", Email: "visibility-default@example.test"}
	_, err := db.NewInsert().Model(user).Exec(t.Context())
	require.NoError(t, err)
	var raw string
	require.NoError(t, db.NewSelect().Model((*models.User)(nil)).
		Column("public_profile_visibility_json").
		Where("id = ?", user.ID).
		Scan(t.Context(), &raw))
	require.True(t, json.Valid([]byte(raw)), "fresh public-profile visibility default must be valid JSON: %q", raw)
	require.Empty(t, publicprofiles.Parse(raw).Fields(), "fresh/private accounts must expose no optional fields")
}

func assertEmailChangeCascade(t *testing.T, db *bun.DB) {
	t.Helper()
	now := time.Now().UTC()
	user := &models.User{ID: "cascade-user", Email: "cascade@example.test", CreatedAt: now}
	_, err := db.NewInsert().Model(user).Exec(t.Context())
	require.NoError(t, err)
	challenge := &models.EmailChangeChallenge{
		ID: "cascade-challenge", UserID: user.ID,
		OldEmail: user.Email, NewEmail: "cascade-new@example.test",
		CodeHash: strings.Repeat("a", 64), ExpiresAt: now.Add(15 * time.Minute), CreatedAt: now,
	}
	_, err = db.NewInsert().Model(challenge).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewDelete().Model(user).WherePK().Exec(t.Context())
	require.NoError(t, err)
	count, err := db.NewSelect().Model((*models.EmailChangeChallenge)(nil)).
		Where("id = ?", challenge.ID).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}
