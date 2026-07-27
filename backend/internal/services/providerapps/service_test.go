package providerapps

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"
	"time"

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

func TestListActiveAppConfigsDecryptsAndNormalizesRows(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := createProviderAppsTestDB(t)
	encryptor := crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef")
	service := NewService(db, encryptor)

	xSecret, err := encryptor.Encrypt("x-secret")
	require.NoError(t, err)
	mastodonSecret, err := encryptor.Encrypt("masto-secret")
	require.NoError(t, err)
	inactiveSecret, err := encryptor.Encrypt("youtube-secret")
	require.NoError(t, err)

	now := time.Now().UTC()
	rows := []models.ProviderApp{
		{
			ID:              "x-app",
			Provider:        " X ",
			ClientID:        " x-client ",
			ClientSecretEnc: xSecret,
			RedirectURI:     " https://app.test/api/v1/accounts/x/callback ",
			IsActive:        true,
			CreatedAt:       now,
			UpdatedAt:       now,
		},
		{
			ID:              "mastodon-app",
			Provider:        "mastodon",
			Name:            " Personal ",
			ClientID:        " masto-client ",
			ClientSecretEnc: mastodonSecret,
			RedirectURI:     " urn:ietf:wg:oauth:2.0:oob ",
			InstanceURL:     "https://masto.pt/",
			IsActive:        true,
			CreatedAt:       now,
			UpdatedAt:       now,
		},
		{
			ID:              "youtube-app",
			Provider:        "youtube",
			ClientID:        "youtube-client",
			ClientSecretEnc: inactiveSecret,
			IsActive:        false,
			CreatedAt:       now,
			UpdatedAt:       now,
		},
	}
	for i := range rows {
		_, err = db.NewInsert().Model(&rows[i]).Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.NewUpdate().
		Model((*models.ProviderApp)(nil)).
		Set("is_active = ?", false).
		Where("id = ?", "youtube-app").
		Exec(ctx)
	require.NoError(t, err)

	configs, err := service.ListActiveAppConfigs(ctx)
	require.NoError(t, err)
	require.Len(t, configs, 2)

	byProvider := map[string]int{}
	for i, config := range configs {
		byProvider[config.Provider] = i
	}
	x := configs[byProvider["x"]]
	require.Equal(t, "x-client", x.ClientID)
	require.Equal(t, "x-secret", x.ClientSecret)
	require.Equal(t, "https://app.test/api/v1/accounts/x/callback", x.RedirectURI)

	mastodon := configs[byProvider["mastodon"]]
	require.Equal(t, "Personal", mastodon.Name)
	require.Equal(t, "masto-client", mastodon.ClientID)
	require.Equal(t, "masto-secret", mastodon.ClientSecret)
	require.Equal(t, "urn:ietf:wg:oauth:2.0:oob", mastodon.RedirectURI)
	require.Equal(t, "https://masto.pt", mastodon.InstanceURL)
}

func TestListActiveAppConfigsFailsWhenSecretCannotDecrypt(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := createProviderAppsTestDB(t)
	encryptor := crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef")
	service := NewService(db, encryptor)

	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.ProviderApp{
		ID:              "bad-app",
		Provider:        "x",
		ClientID:        "x-client",
		ClientSecretEnc: []byte("not-gcm-ciphertext"),
		IsActive:        true,
		CreatedAt:       now,
		UpdatedAt:       now,
	}).Exec(ctx)
	require.NoError(t, err)

	_, err = service.ListActiveAppConfigs(ctx)
	require.ErrorContains(t, err, "failed to decrypt provider app bad-app (x)")
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

func TestUpsertProviderAppValidatesProviderInput(t *testing.T) {
	t.Parallel()

	service := NewService(createProviderAppsTestDB(t), crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"))

	_, _, err := service.UpsertProviderApp(context.Background(), UpsertInput{Provider: "reddit", ClientID: "client", IsActive: true})
	var validationErr ValidationError
	require.ErrorAs(t, err, &validationErr)
	require.ErrorContains(t, err, "unsupported provider app")

	_, _, err = service.UpsertProviderApp(context.Background(), UpsertInput{Provider: "mastodon", ClientID: "client", IsActive: true})
	require.ErrorAs(t, err, &validationErr)
	require.ErrorContains(t, err, "instance_url is required")
}

func TestDeleteProviderAppRemovesRow(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := createProviderAppsTestDB(t)
	service := NewService(db, crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"))
	secret := "x-secret"
	created, _, err := service.UpsertProviderApp(ctx, UpsertInput{
		Provider:     "x",
		ClientID:     "x-client",
		ClientSecret: &secret,
		IsActive:     true,
	})
	require.NoError(t, err)

	require.NoError(t, service.DeleteProviderApp(ctx, created.ID))
	var count int
	require.NoError(t, db.NewSelect().Model((*models.ProviderApp)(nil)).ColumnExpr("COUNT(*)").Scan(ctx, &count))
	require.Equal(t, 0, count)

	err = service.DeleteProviderApp(ctx, created.ID)
	require.True(t, errors.Is(err, ErrNotFound))
}
