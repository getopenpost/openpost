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

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type verifyLockContextKey struct{}

type blockVerifyUserLockHook struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func newBlockVerifyUserLockHook() *blockVerifyUserLockHook {
	return &blockVerifyUserLockHook{started: make(chan struct{}), release: make(chan struct{})}
}

func (hook *blockVerifyUserLockHook) BeforeQuery(ctx context.Context, event *bun.QueryEvent) context.Context {
	if ctx.Value(verifyLockContextKey{}) != true || event.Operation() != "UPDATE" ||
		!strings.Contains(event.Query, "email = email") || !strings.Contains(event.Query, "users") {
		return ctx
	}
	hook.once.Do(func() { close(hook.started) })
	select {
	case <-hook.release:
	case <-ctx.Done():
	}
	return ctx
}

func (*blockVerifyUserLockHook) AfterQuery(context.Context, *bun.QueryEvent) {}

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

func TestStartingAnotherEmailChangeCancelsThePriorRequest(t *testing.T) {
	t.Parallel()

	db, service, _ := newTestService(t)
	ctx := context.Background()
	seedUser(t, db, "user-1", "old@example.test")

	first, err := service.Begin(ctx, "user-1", "first@example.test")
	require.NoError(t, err)
	second, err := service.Begin(ctx, "user-1", "second@example.test")
	require.NoError(t, err)

	var storedFirst models.EmailChangeChallenge
	require.NoError(t, db.NewSelect().Model(&storedFirst).Where("id = ?", first.Challenge.ID).Scan(ctx))
	require.False(t, storedFirst.CanceledAt.IsZero())
	current, err := service.Current(ctx, "user-1")
	require.NoError(t, err)
	require.Equal(t, second.Challenge.ID, current.ID)

	_, err = service.Verify(ctx, "user-1", "", first.Challenge.ID, first.Code)
	require.ErrorIs(t, err, ErrChallengeNotFound)
}

func TestUserCanCancelAPendingEmailChange(t *testing.T) {
	t.Parallel()

	db, service, _ := newTestService(t)
	ctx := context.Background()
	seedUser(t, db, "user-1", "old@example.test")

	pending, err := service.Begin(ctx, "user-1", "new@example.test")
	require.NoError(t, err)
	require.NoError(t, service.Cancel(ctx, "user-1", pending.Challenge.ID))

	current, err := service.Current(ctx, "user-1")
	require.NoError(t, err)
	require.Nil(t, current)
	_, err = service.Verify(ctx, "user-1", "", pending.Challenge.ID, pending.Code)
	require.ErrorIs(t, err, ErrChallengeNotFound)
	require.Equal(t, "old@example.test", userEmail(t, db))
}

func TestResendRotatesTheCodeAndEnforcesDeliveryDelay(t *testing.T) {
	t.Parallel()

	db, service, now := newTestService(t)
	ctx := context.Background()
	seedUser(t, db, "user-1", "old@example.test")

	pending, err := service.Begin(ctx, "user-1", "new@example.test")
	require.NoError(t, err)
	require.NoError(t, service.MarkSent(ctx, "user-1", pending.Challenge.ID))
	_, err = service.Resend(ctx, "user-1", pending.Challenge.ID)
	require.ErrorIs(t, err, ErrResendTooSoon)

	service.now = func() time.Time { return now.Add(ResendDelay + time.Second) }
	replacement, err := service.Resend(ctx, "user-1", pending.Challenge.ID)
	require.NoError(t, err)
	require.NotEmpty(t, replacement.Code)

	if replacement.Code != pending.Code {
		_, err = service.Verify(ctx, "user-1", "", pending.Challenge.ID, pending.Code)
		require.ErrorIs(t, err, ErrInvalidCode)
	}
	_, err = service.Verify(ctx, "user-1", "", pending.Challenge.ID, replacement.Code)
	require.NoError(t, err)
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

func TestResendCannotRotateBetweenCodeVerificationAndConsumption(t *testing.T) {
	db, service, now := newConcurrentTestService(t)
	seedUser(t, db, "user-1", "old@example.test")
	pending, err := service.Begin(t.Context(), "user-1", "new@example.test")
	require.NoError(t, err)
	require.NoError(t, service.MarkSent(t.Context(), "user-1", pending.Challenge.ID))
	service.now = func() time.Time { return now.Add(ResendDelay + time.Second) }

	hook := newBlockVerifyUserLockHook()
	db.AddQueryHook(hook)
	verifyResult := make(chan error, 1)
	verifyCtx := context.WithValue(context.Background(), verifyLockContextKey{}, true)
	go func() {
		_, verifyErr := service.Verify(
			verifyCtx,
			"user-1",
			"",
			pending.Challenge.ID,
			pending.Code,
		)
		verifyResult <- verifyErr
	}()

	select {
	case <-hook.started:
	case <-time.After(5 * time.Second):
		t.Fatal("verification did not reach the serialized user mutation fence")
	}
	replacement, err := service.Resend(t.Context(), "user-1", pending.Challenge.ID)
	require.NoError(t, err)
	close(hook.release)

	select {
	case verifyErr := <-verifyResult:
		require.ErrorIs(t, verifyErr, ErrChallengeNotFound)
	case <-time.After(5 * time.Second):
		t.Fatal("verification did not finish after the resend")
	}
	require.Equal(t, "old@example.test", userEmail(t, db))
	_, err = service.Verify(t.Context(), "user-1", "", pending.Challenge.ID, replacement.Code)
	require.NoError(t, err)
	require.Equal(t, "new@example.test", userEmail(t, db))
}

func TestExpiredAndAttemptExhaustedChallengesCannotChangeEmail(t *testing.T) {
	t.Parallel()

	t.Run("expired", func(t *testing.T) {
		db, service, now := newTestService(t)
		seedUser(t, db, "user-1", "old@example.test")
		pending, err := service.Begin(t.Context(), "user-1", "new@example.test")
		require.NoError(t, err)
		service.now = func() time.Time { return now.Add(ChallengeTTL + time.Second) }
		_, err = service.Verify(t.Context(), "user-1", "", pending.Challenge.ID, pending.Code)
		require.ErrorIs(t, err, ErrChallengeExpired)
		require.Equal(t, "old@example.test", userEmail(t, db))
	})

	t.Run("attempts exhausted", func(t *testing.T) {
		db, service, _ := newTestService(t)
		seedUser(t, db, "user-1", "old@example.test")
		pending, err := service.Begin(t.Context(), "user-1", "new@example.test")
		require.NoError(t, err)
		wrongCode := "000000"
		if wrongCode == pending.Code {
			wrongCode = "999999"
		}
		for attempt := 1; attempt <= MaxAttempts; attempt++ {
			_, err = service.Verify(t.Context(), "user-1", "", pending.Challenge.ID, wrongCode)
			if attempt == MaxAttempts {
				require.ErrorIs(t, err, ErrTooManyAttempts)
			} else {
				require.ErrorIs(t, err, ErrInvalidCode)
			}
		}
		_, err = service.Verify(t.Context(), "user-1", "", pending.Challenge.ID, pending.Code)
		require.ErrorIs(t, err, ErrTooManyAttempts)
		require.Equal(t, "old@example.test", userEmail(t, db))
	})
}

func TestEmailChangeFailsClosedWithoutASecret(t *testing.T) {
	t.Parallel()

	db, _, now := newTestService(t)
	seedUser(t, db, "user-1", "old@example.test")
	service := NewService(db, Config{Secret: "short", Now: func() time.Time { return now }})
	_, err := service.Begin(context.Background(), "user-1", "new@example.test")
	require.ErrorIs(t, err, ErrNotConfigured)
}

func newTestService(t *testing.T) (*bun.DB, *Service, time.Time) {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=private", strings.ReplaceAll(t.Name(), "/", "_")))
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

func newConcurrentTestService(t *testing.T) (*bun.DB, *Service, time.Time) {
	t.Helper()
	testName := strings.NewReplacer("/", "_", " ", "_").Replace(t.Name())
	dsn := fmt.Sprintf(
		"file:%s_%s?mode=memory&cache=shared&_busy_timeout=5000",
		testName,
		uuid.NewString(),
	)
	sqldb, err := sql.Open("sqlite3", dsn)
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(4)
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
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
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
