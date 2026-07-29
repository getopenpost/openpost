package sessions

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestServiceCreatesListsAndRevokesSessions(t *testing.T) {
	t.Parallel()

	db := newSessionTestDB(t)
	ctx := context.Background()
	seedSessionUser(ctx, t, db)

	service := NewService(db)
	session, err := service.CreateSession(ctx, CreateInput{
		UserID:    "user-1",
		UserAgent: "Mozilla/5.0 Test",
		IPAddress: "203.0.113.9",
		ExpiresAt: time.Now().UTC().Add(time.Hour),
	})
	require.NoError(t, err)
	require.NotEmpty(t, session.ID)

	active, err := service.ListActiveSessions(ctx, "user-1")
	require.NoError(t, err)
	require.Len(t, active, 1)
	require.Equal(t, "Mozilla/5.0 Test", active[0].UserAgent)
	require.Equal(t, "203.0.113.9", active[0].IPAddress)

	validated, err := service.ValidateSession(ctx, "user-1", session.ID)
	require.NoError(t, err)
	require.Equal(t, session.ID, validated.ID)
	require.False(t, validated.LastUsedAt.IsZero())

	require.NoError(t, service.RevokeSession(ctx, "user-1", session.ID))
	_, err = service.ValidateSession(ctx, "user-1", session.ID)
	require.ErrorIs(t, err, ErrRevokedSession)

	active, err = service.ListActiveSessions(ctx, "user-1")
	require.NoError(t, err)
	require.Empty(t, active)
}

func TestServiceRejectsExpiredSessions(t *testing.T) {
	t.Parallel()

	db := newSessionTestDB(t)
	ctx := context.Background()
	seedSessionUser(ctx, t, db)

	service := NewService(db)
	session, err := service.CreateSession(ctx, CreateInput{
		UserID:    "user-1",
		ExpiresAt: time.Now().UTC().Add(-time.Minute),
	})
	require.NoError(t, err)

	_, err = service.ValidateSession(ctx, "user-1", session.ID)
	require.ErrorIs(t, err, ErrExpiredSession)
}

func newSessionTestDB(t *testing.T) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=private", strings.ReplaceAll(t.Name(), "/", "_")))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() {
		require.NoError(t, db.Close())
	})

	for _, model := range []interface{}{
		(*models.User)(nil),
		(*models.UserSession)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	return db
}

func seedSessionUser(ctx context.Context, t *testing.T, db *bun.DB) {
	t.Helper()

	_, err := db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
		CreatedAt:    time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
}
