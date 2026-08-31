package migrations

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func newPostVariantsTestDB(t *testing.T) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", "file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=private")
	require.NoError(t, err)

	sqldb.SetMaxOpenConns(1)

	db := bun.NewDB(sqldb, sqlitedialect.New())

	_, err = db.Exec("PRAGMA foreign_keys=ON")
	require.NoError(t, err)

	modelList := []interface{}{
		(*models.Workspace)(nil),
		(*models.User)(nil),
		(*models.SocialAccount)(nil),
		(*models.Post)(nil),
	}
	for _, m := range modelList {
		_, err := db.NewCreateTable().Model(m).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	_, err = db.Exec(`
		CREATE TABLE post_variants (
			id TEXT PRIMARY KEY,
			post_id TEXT NOT NULL,
			social_account_id TEXT NOT NULL,
			content TEXT NOT NULL,
			is_unsynced BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
		)
	`)
	require.NoError(t, err)

	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

func TestRunMigrationsMediaIDsColumnDefaultsEmpty(t *testing.T) {
	t.Parallel()

	db := newPostVariantsTestDB(t)
	ctx := context.Background()

	ws := &models.Workspace{ID: "ws-1", Name: "Test"}
	_, err := db.NewInsert().Model(ws).Exec(ctx)
	require.NoError(t, err)

	user := &models.User{ID: "u-1", Email: "test@test.com", PasswordHash: "hash"}
	_, err = db.NewInsert().Model(user).Exec(ctx)
	require.NoError(t, err)

	post := &models.Post{ID: "p-1", WorkspaceID: "ws-1", CreatedByID: "u-1", Content: "hello", Status: models.PostStatusDraft}
	_, err = db.NewInsert().Model(post).Exec(ctx)
	require.NoError(t, err)

	runMigrationsThrough(t, db, 27)

	variant := &models.PostVariant{
		ID:              "v-1",
		PostID:          "p-1",
		SocialAccountID: "sa-1",
		Content:         "variant text",
		MediaIDs:        "",
	}
	_, err = db.NewInsert().Model(variant).Exec(ctx)
	require.NoError(t, err)

	var fetched models.PostVariant
	require.NoError(t, db.NewSelect().Model(&fetched).Where("id = ?", "v-1").Scan(ctx))
	require.Equal(t, "", fetched.MediaIDs)
}

func TestRunMigrationsMediaIDsColumnWithJSONContent(t *testing.T) {
	t.Parallel()

	db := newPostVariantsTestDB(t)
	ctx := context.Background()

	ws := &models.Workspace{ID: "ws-2", Name: "Test"}
	_, err := db.NewInsert().Model(ws).Exec(ctx)
	require.NoError(t, err)

	user := &models.User{ID: "u-2", Email: "test2@test.com", PasswordHash: "hash"}
	_, err = db.NewInsert().Model(user).Exec(ctx)
	require.NoError(t, err)

	post := &models.Post{ID: "p-2", WorkspaceID: "ws-2", CreatedByID: "u-2", Content: "hello", Status: models.PostStatusDraft}
	_, err = db.NewInsert().Model(post).Exec(ctx)
	require.NoError(t, err)

	runMigrationsThrough(t, db, 27)

	variant := &models.PostVariant{
		ID:              "v-2",
		PostID:          "p-2",
		SocialAccountID: "sa-2",
		Content:         "variant text",
		MediaIDs:        `["media-1","media-2"]`,
	}
	_, err = db.NewInsert().Model(variant).Exec(ctx)
	require.NoError(t, err)

	var fetched models.PostVariant
	require.NoError(t, db.NewSelect().Model(&fetched).Where("id = ?", "v-2").Scan(ctx))
	require.Equal(t, `["media-1","media-2"]`, fetched.MediaIDs)
}

func TestRunMigrationsMediaIDsIdempotent(t *testing.T) {
	t.Parallel()

	db := newPostVariantsTestDB(t)
	ctx := context.Background()

	runMigrationsThrough(t, db, 27)
	runMigrationsThrough(t, db, 27)

	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-idempotent", Name: "Test"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{ID: "user-idempotent", Email: "idempotent@test.com", PasswordHash: "hash"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Post{ID: "post-idempotent", WorkspaceID: "ws-idempotent", CreatedByID: "user-idempotent", Content: "hello", Status: models.PostStatusDraft}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PostVariant{ID: "variant-idempotent", PostID: "post-idempotent", SocialAccountID: "account-idempotent", Content: "variant", MediaIDs: `["media-1"]`}).Exec(ctx)
	require.NoError(t, err)
}
