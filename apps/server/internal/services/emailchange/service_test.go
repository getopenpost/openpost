package emailchange

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

func TestVerifiedEmailChangeKeepsOldAddressUntilCompletionAndRevokesOtherSessions(t *testing.T) {
	t.Parallel()

	db, service, now := newTestService(t)
	ctx := context.Background()
	seedUser(t, db, "user-1", "old@example.test")
	seedUser(t, db, "user-2", "taken@example.test")

	_, err := service.Begin(ctx, "user-1", "taken@example.test")
	require.ErrorIs(t, err, ErrEmailUnavailable)

	pending, err := service.Begin(ctx, "user-1", "New@Example.test")
	require.NoError(t, err)
	require.Equal(t, "new@example.test", pending.Challenge.NewEmail)
	require.Equal(t, "old@example.test", userEmail(t, db))

	for _, session := range []models.UserSession{
		{ID: "session-current", UserID: "user-1", ExpiresAt: now.Add(time.Hour), CreatedAt: now},
		{ID: "session-other", UserID: "user-1", ExpiresAt: now.Add(time.Hour), CreatedAt: now},
	} {
		_, err = db.NewInsert().Model(&session).Exec(ctx)
		require.NoError(t, err)
	}
	reset := &models.PasswordResetToken{
		ID: "reset-1", UserID: "user-1", TokenHash: "reset-hash", ExpiresAt: now.Add(time.Hour), CreatedAt: now,
	}
	_, err = db.NewInsert().Model(reset).Exec(ctx)
	require.NoError(t, err)

	wrongCode := "000000"
	if pending.Code == wrongCode {
		wrongCode = "999999"
	}
	_, err = service.Verify(ctx, "user-1", "session-current", pending.Challenge.ID, wrongCode)
	require.ErrorIs(t, err, ErrInvalidCode)
	require.Equal(t, "old@example.test", userEmail(t, db))

	completed, err := service.Verify(ctx, "user-1", "session-current", pending.Challenge.ID, pending.Code)
	require.NoError(t, err)
	require.Equal(t, int64(1), completed.RevokedSessions)
	require.Equal(t, "new@example.test", completed.User.Email)
	require.Equal(t, "new@example.test", userEmail(t, db))

	var sessions []models.UserSession
	require.NoError(t, db.NewSelect().Model(&sessions).Order("id ASC").Scan(ctx))
	require.True(t, sessions[0].RevokedAt.IsZero())
	require.False(t, sessions[1].RevokedAt.IsZero())
	var storedReset models.PasswordResetToken
	require.NoError(t, db.NewSelect().Model(&storedReset).Where("id = ?", reset.ID).Scan(ctx))
	require.False(t, storedReset.UsedAt.IsZero())

	_, err = service.Verify(ctx, "user-1", "session-current", pending.Challenge.ID, pending.Code)
	require.ErrorIs(t, err, ErrChallengeNotFound)
}

func TestConcurrentResendsRotateTheCodeOnlyOnce(t *testing.T) {
	t.Parallel()

	db, service, now := newTestService(t)
	ctx := context.Background()
	seedUser(t, db, "user-1", "old@example.test")

	pending, err := service.Begin(ctx, "user-1", "new@example.test")
	require.NoError(t, err)
	require.NoError(t, service.MarkSent(ctx, "user-1", pending.Challenge.ID))
	service.now = func() time.Time { return now.Add(ResendDelay + time.Second) }

	results := make(chan error, 2)
	var start sync.WaitGroup
	start.Add(1)
	for range 2 {
		go func() {
			start.Wait()
			_, resendErr := service.Resend(ctx, "user-1", pending.Challenge.ID)
			results <- resendErr
		}()
	}
	start.Done()

	var successes, fenced int
	for range 2 {
		resendErr := <-results
		switch {
		case resendErr == nil:
			successes++
		case errors.Is(resendErr, ErrResendTooSoon):
			fenced++
		default:
			require.NoError(t, resendErr)
		}
	}
	require.Equal(t, 1, successes)
	require.Equal(t, 1, fenced)
}

func newTestService(t *testing.T) (*bun.DB, *Service, time.Time) {
	t.Helper()
	sqldb, err := sql.Open(sqliteshim.ShimName, fmt.Sprintf("file:%s?mode=memory&cache=private", strings.ReplaceAll(t.Name(), "/", "_")))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.Exec("PRAGMA foreign_keys=ON")
	require.NoError(t, err)
	for _, model := range []any{
		(*models.User)(nil),
		(*models.EmailChangeChallenge)(nil),
		(*models.UserSession)(nil),
		(*models.PasswordResetToken)(nil),
	} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	now := time.Date(2026, time.August, 9, 12, 0, 0, 0, time.UTC)
	return db, NewService(db, Config{
		Secret: strings.Repeat("s", 32),
		Now:    func() time.Time { return now },
	}), now
}

func seedUser(t *testing.T, db *bun.DB, id, email string) {
	t.Helper()
	_, err := db.NewInsert().Model(&models.User{ID: id, Email: email, CreatedAt: time.Now().UTC()}).Exec(context.Background())
	require.NoError(t, err)
}

func userEmail(t *testing.T, db *bun.DB) string {
	t.Helper()
	var email string
	require.NoError(t, db.NewSelect().Model((*models.User)(nil)).Column("email").Where("id = ?", "user-1").Scan(context.Background(), &email))
	return email
}
