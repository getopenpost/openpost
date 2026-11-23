package emailchange

import (
	"context"
	"database/sql"

	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
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

func newConcurrentTestService(t *testing.T) (*bun.DB, *Service, time.Time) {
	t.Helper()
	testName := strings.NewReplacer("/", "_", " ", "_").Replace(t.Name())
	dsn := fmt.Sprintf(
		"file:%s_%s?mode=memory&cache=shared&_pragma=busy_timeout(5000)",
		testName,
		uuid.NewString(),
	)
	sqldb, err := sql.Open(sqliteshim.ShimName, dsn)
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
