package instancesettings

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/config"
	"github.com/openpost/backend/internal/models"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func createTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []any{(*models.User)(nil), (*models.InstanceSetting)(nil)} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.User{ID: "user-1", Email: "admin@example.com", IsAdmin: true}).Exec(context.Background())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func strptr(value string) *string {
	return &value
}

func TestSaveEncryptsValuesRedactsSecretsAndTracksRestart(t *testing.T) {
	db := createTestDB(t)
	encryptor := servicecrypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef")
	fallback := config.Load()
	service := NewService(db, encryptor, fallback)

	restart, err := service.Save(t.Context(), "user-1", []Update{
		{Key: "OPENPOST_EMAIL_PROVIDER", Value: strptr("resend")},
		{Key: "OPENPOST_EMAIL_FROM", Value: strptr("OpenPost <hello@example.com>")},
		{Key: "OPENPOST_RESEND_API_KEY", Value: strptr("re_secret")},
	})
	require.NoError(t, err)
	require.True(t, restart)

	var rows []models.InstanceSetting
	require.NoError(t, db.NewSelect().Model(&rows).Order("key ASC").Scan(t.Context()))
	require.Len(t, rows, 3)
	for _, row := range rows {
		require.NotContains(t, string(row.ValueEncrypted), "re_secret")
	}

	states, err := service.List(t.Context())
	require.NoError(t, err)
	byKey := make(map[string]State, len(states))
	for _, state := range states {
		byKey[state.Definition.Key] = state
	}
	require.Equal(t, "database", byKey["OPENPOST_EMAIL_PROVIDER"].Source)
	require.Equal(t, "resend", byKey["OPENPOST_EMAIL_PROVIDER"].Value)
	require.Empty(t, byKey["OPENPOST_RESEND_API_KEY"].Value)
	require.True(t, byKey["OPENPOST_RESEND_API_KEY"].SecretConfigured)
	require.True(t, byKey["OPENPOST_RESEND_API_KEY"].RestartPending)

	applied := config.Load()
	require.NoError(t, service.ApplyStored(t.Context(), applied))
	require.Equal(t, "resend", applied.EmailProvider)
	require.Equal(t, "re_secret", applied.ResendAPIKey)
	service.CaptureRuntime(applied)
	states, err = service.List(t.Context())
	require.NoError(t, err)
	for _, state := range states {
		require.False(t, state.RestartPending)
	}
}

func TestPaddleBillingCredentialsCanBeStoredWithoutBeingReturned(t *testing.T) {
	db := createTestDB(t)
	encryptor := servicecrypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef")
	service := NewService(db, encryptor, config.Load())

	_, err := service.Save(t.Context(), "user-1", []Update{
		{Key: "OPENPOST_PADDLE_API_KEY", Value: strptr("pdl_sdbx_runtime_secret")},
		{Key: "OPENPOST_PADDLE_ENVIRONMENT", Value: strptr("sandbox")},
		{Key: "OPENPOST_PADDLE_CLIENT_TOKEN", Value: strptr("test_client_token")},
		{Key: "OPENPOST_PADDLE_FOUNDER_MONTHLY_PRICE_ID", Value: strptr("pri_founder_monthly")},
	})
	require.NoError(t, err)

	states, err := service.List(t.Context())
	require.NoError(t, err)
	byKey := make(map[string]State, len(states))
	for _, state := range states {
		byKey[state.Definition.Key] = state
	}
	require.Empty(t, byKey["OPENPOST_PADDLE_API_KEY"].Value)
	require.True(t, byKey["OPENPOST_PADDLE_API_KEY"].SecretConfigured)
	require.Equal(t, "sandbox", byKey["OPENPOST_PADDLE_ENVIRONMENT"].Value)
	require.Equal(t, "test_client_token", byKey["OPENPOST_PADDLE_CLIENT_TOKEN"].Value)

	applied := config.Load()
	require.NoError(t, service.ApplyStored(t.Context(), applied))
	require.Equal(t, "pdl_sdbx_runtime_secret", applied.PaddleAPIKey)
	require.Equal(t, "sandbox", applied.PaddleEnvironment)
	require.Equal(t, "test_client_token", applied.PaddleClientToken)
	require.Equal(t, "pri_founder_monthly", applied.PaddleFounderMonthlyPriceID)
}

func TestSaveAllowsEnvironmentOverrideAndRejectsInvalidCombinedConfiguration(t *testing.T) {
	t.Setenv("OPENPOST_FEEDBACK_ENABLED", "true")
	db := createTestDB(t)
	service := NewService(db, servicecrypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"), config.Load())

	restart, err := service.Save(t.Context(), "user-1", []Update{{Key: "OPENPOST_FEEDBACK_ENABLED", Value: strptr("false")}})
	require.NoError(t, err)
	require.True(t, restart)

	applied := config.Load()
	require.True(t, applied.FeedbackEnabled)
	require.NoError(t, service.ApplyStored(t.Context(), applied))
	require.False(t, applied.FeedbackEnabled)

	_, err = service.Save(t.Context(), "user-1", []Update{{Key: "OPENPOST_AUTH_GOOGLE_CLIENT_ID", Value: strptr("google-client")}})
	var validationErr ValidationError
	require.ErrorAs(t, err, &validationErr)
	require.ErrorContains(t, err, "GOOGLE_CLIENT_SECRET")

	var count int
	require.NoError(t, db.NewSelect().Model((*models.InstanceSetting)(nil)).ColumnExpr("COUNT(*)").Scan(t.Context(), &count))
	require.Equal(t, 1, count)
}

func TestSaveCanClearDefaultWithEncryptedEmptyOverrideAndThenUnsetIt(t *testing.T) {
	db := createTestDB(t)
	fallback := config.Load()
	require.NotEmpty(t, fallback.FeedbackSupportURL)
	service := NewService(db, servicecrypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"), fallback)

	_, err := service.Save(t.Context(), "user-1", []Update{{Key: "OPENPOST_FEEDBACK_SUPPORT_URL", Value: strptr("")}})
	require.NoError(t, err)
	var row models.InstanceSetting
	require.NoError(t, db.NewSelect().Model(&row).Where("key = ?", "OPENPOST_FEEDBACK_SUPPORT_URL").Scan(t.Context()))
	require.NotEmpty(t, row.ValueEncrypted)

	applied := config.Load()
	require.NoError(t, service.ApplyStored(t.Context(), applied))
	require.Empty(t, applied.FeedbackSupportURL)

	_, err = service.Save(t.Context(), "user-1", []Update{{Key: "OPENPOST_FEEDBACK_SUPPORT_URL", Unset: true}})
	require.NoError(t, err)
	var count int
	require.NoError(t, db.NewSelect().Model((*models.InstanceSetting)(nil)).ColumnExpr("COUNT(*)").Scan(t.Context(), &count))
	require.Zero(t, count)
}

func TestEnvironmentOverrideIsExplicitAndCanRestoreEnvironmentValue(t *testing.T) {
	t.Setenv("OPENPOST_FEEDBACK_ENABLED", "true")
	db := createTestDB(t)
	service := NewService(db, servicecrypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"), config.Load())
	encrypted, err := service.encrypt("false")
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.InstanceSetting{
		Key: "OPENPOST_FEEDBACK_ENABLED", ValueEncrypted: encrypted, UpdatedByID: "user-1",
	}).Exec(t.Context())
	require.NoError(t, err)

	states, err := service.List(t.Context())
	require.NoError(t, err)
	for _, state := range states {
		if state.Definition.Key != "OPENPOST_FEEDBACK_ENABLED" {
			continue
		}
		require.Equal(t, "database", state.Source)
		require.Equal(t, "OPENPOST_FEEDBACK_ENABLED", state.EnvironmentSource)
		require.True(t, state.DatabaseOverride)
		require.Equal(t, "false", state.Value)
		require.True(t, state.RestartPending)
	}

	applied := config.Load()
	require.NoError(t, service.ApplyStored(t.Context(), applied))
	require.False(t, applied.FeedbackEnabled)
	service.CaptureRuntime(applied)

	_, err = service.Save(t.Context(), "user-1", []Update{{Key: "OPENPOST_FEEDBACK_ENABLED", Unset: true}})
	require.NoError(t, err)
	states, err = service.List(t.Context())
	require.NoError(t, err)
	for _, state := range states {
		if state.Definition.Key != "OPENPOST_FEEDBACK_ENABLED" {
			continue
		}
		require.Equal(t, "environment", state.Source)
		require.Equal(t, "true", state.Value)
		require.False(t, state.DatabaseOverride)
		require.True(t, state.RestartPending)
	}
	var count int
	require.NoError(t, db.NewSelect().Model((*models.InstanceSetting)(nil)).ColumnExpr("COUNT(*)").Scan(t.Context(), &count))
	require.Zero(t, count)
}
