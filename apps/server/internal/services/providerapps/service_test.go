package providerapps

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

func createProviderAppsTestDB(t *testing.T) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open(sqliteshim.ShimName, fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
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

func TestInstagramLoginAppsKeepSeparateSecrets(t *testing.T) {
	service := NewService(createProviderAppsTestDB(t), crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"))
	facebookSecret, directSecret := "facebook-secret", "instagram-secret"
	facebook, _, err := service.UpsertProviderApp(t.Context(), UpsertInput{Provider: "instagram", ClientID: "facebook-id", ClientSecret: &facebookSecret, IsActive: true})
	require.NoError(t, err)
	direct, existed, err := service.UpsertProviderApp(t.Context(), UpsertInput{
		Provider: "instagram", ConnectionMode: "instagram_login", ClientID: "instagram-id", ClientSecret: &directSecret,
		RedirectURI: "https://app.example/api/v1/accounts/instagram/callback", IsActive: true,
	})
	require.NoError(t, err)
	require.False(t, existed)
	require.NotEqual(t, facebook.ID, direct.ID)
	_, existed, err = service.UpsertProviderApp(t.Context(), UpsertInput{
		Provider: "instagram", ConnectionMode: "instagram_login", ClientID: "updated-instagram-id",
		RedirectURI: "https://app.example/api/v1/accounts/instagram/callback", IsActive: true,
	})
	require.NoError(t, err)
	require.True(t, existed)
	configs, err := service.ListActiveAppConfigs(t.Context())
	require.NoError(t, err)
	byMethod := map[string]platform.AppConfig{}
	for _, config := range configs {
		byMethod[config.ConnectionMode] = config
	}
	require.Len(t, byMethod, 2)
	require.Equal(t, facebookSecret, byMethod["oauth"].ClientSecret)
	require.Equal(t, directSecret, byMethod["instagram_login"].ClientSecret)
	require.Equal(t, "facebook-id", byMethod["oauth"].ClientID)
	require.Equal(t, "updated-instagram-id", byMethod["instagram_login"].ClientID)
}
