package providerapps

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func createProviderAppsTestDB(t *testing.T) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	_, err = db.NewCreateTable().
		Model((*models.ProviderApp)(nil)).
		IfNotExists().
		Exec(context.Background())
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, db.Close())
	})
	return db
}

func TestUpsertProviderAppEncryptsSecretsAndPreservesSecretOnMetadataUpdate(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := createProviderAppsTestDB(t)
	encryptor := crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef")
	service := NewService(db, encryptor)
	secret := "x-secret"

	created, existed, err := service.UpsertProviderApp(ctx, UpsertInput{
		Provider:     " X ",
		ClientID:     " x-client ",
		ClientSecret: &secret,
		RedirectURI:  " https://app.test/api/v1/accounts/x/callback ",
		IsActive:     true,
	})
	require.NoError(t, err)
	require.False(t, existed)
	require.Equal(t, "x", created.Provider)
	require.Equal(t, "x-client", created.ClientID)
	require.NotEqual(t, []byte(secret), created.ClientSecretEnc)
	decrypted, err := encryptor.Decrypt(created.ClientSecretEnc)
	require.NoError(t, err)
	require.Equal(t, secret, decrypted)

	updated, existed, err := service.UpsertProviderApp(ctx, UpsertInput{
		Provider:    "x",
		ClientID:    "updated-client",
		RedirectURI: "https://app.test/api/v1/accounts/x/callback",
		IsActive:    false,
	})
	require.NoError(t, err)
	require.True(t, existed)
	require.Equal(t, created.ID, updated.ID)
	require.Equal(t, "updated-client", updated.ClientID)
	require.False(t, updated.IsActive)
	decrypted, err = encryptor.Decrypt(updated.ClientSecretEnc)
	require.NoError(t, err)
	require.Equal(t, secret, decrypted)

	var rows []models.ProviderApp
	require.NoError(t, db.NewSelect().Model(&rows).Scan(ctx))
	require.Len(t, rows, 1)
	require.False(t, rows[0].IsActive)
}
