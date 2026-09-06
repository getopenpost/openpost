package main

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestGrantInstanceAdminPromotesExistingAccount(t *testing.T) {
	ctx := context.Background()
	db, err := database.InitDBWithDriver("sqlite", "file:"+t.Name()+"?mode=memory&cache=private")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))

	insertUser := func(t *testing.T, email string, isAdmin bool) {
		t.Helper()
		user := models.User{
			ID:       "user-" + email,
			Email:    email,
			Username: email,
			IsAdmin:  isAdmin,
		}
		_, err := db.NewInsert().Model(&user).Exec(ctx)
		require.NoError(t, err)
	}
	insertUser(t, "founder@example.test", false)
	insertUser(t, "teammate@example.test", false)

	result, err := grantInstanceAdmin(ctx, db, " Founder@example.test ")
	require.NoError(t, err)
	require.False(t, result.AlreadyAdmin)
	require.Equal(t, 1, result.AdminCount)

	var promoted models.User
	require.NoError(t, db.NewSelect().Model(&promoted).Where("email = ?", "founder@example.test").Scan(ctx))
	require.True(t, promoted.IsAdmin)

	repeat, err := grantInstanceAdmin(ctx, db, "founder@example.test")
	require.NoError(t, err)
	require.True(t, repeat.AlreadyAdmin)
	require.Equal(t, 1, repeat.AdminCount)

	_, err = grantInstanceAdmin(ctx, db, "missing@example.test")
	require.ErrorContains(t, err, "no account found")
}

func TestGrantInstanceAdminRequiresAnEmail(t *testing.T) {
	db, err := database.InitDBWithDriver("sqlite", "file:"+t.Name()+"?mode=memory&cache=private")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))

	_, err = grantInstanceAdmin(context.Background(), db, "   ")
	require.ErrorContains(t, err, "requires --email")
}
