package aiprompts

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestAdministratorOverrideAppliesImmediatelyAndBuiltInValueResetsIt(t *testing.T) {
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	for _, model := range []any{(*models.User)(nil), (*models.AIPromptOverride)(nil)} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.User{
		ID: "admin-1", Email: "admin@example.com", DisplayName: "Instance Admin", IsAdmin: true, CreatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)

	service := NewService(db, servicecrypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"))
	customBase := "Use the instance voice guide before adapting copy for each platform."
	base, err := service.Save(t.Context(), "admin-1", BasePromptKey, customBase)
	require.NoError(t, err)
	require.True(t, base.Overridden)
	require.Equal(t, customBase, base.Value)

	custom := "Write with the blunt, technical voice used in our release notes."
	saved, err := service.Save(t.Context(), "admin-1", platformPromptKey("x"), custom)
	require.NoError(t, err)
	require.True(t, saved.Overridden)
	require.Equal(t, custom, saved.Value)
	require.Equal(t, "Instance Admin", saved.UpdatedBy)
	var stored models.AIPromptOverride
	require.NoError(t, db.NewSelect().Model(&stored).Where("key = ?", saved.Key).Scan(t.Context()))
	require.NotContains(t, string(stored.ValueEncrypted), custom)

	resolved, err := service.ResolvePostGeneration(t.Context(), []string{"x", "linkedin"})
	require.NoError(t, err)
	require.Equal(t, customBase, resolved.Base)
	require.Equal(t, custom, resolved.Platforms["x"])
	require.NotEmpty(t, resolved.Platforms["linkedin"])

	reset, err := service.Save(t.Context(), "admin-1", saved.Key, saved.Default)
	require.NoError(t, err)
	require.False(t, reset.Overridden)
	require.Equal(t, saved.Default, reset.Value)
}
