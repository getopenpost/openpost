package emailverification

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestVerificationCodesAreHashedAttemptLimitedAndSingleUse(t *testing.T) {
	t.Parallel()

	service, db := newTestService(t, false)
	pending, err := service.Create(context.Background(), "user-1")
	require.NoError(t, err)
	require.Regexp(t, `^[0-9]{6}$`, pending.Code)
	require.NotEqual(t, pending.Code, pending.Challenge.CodeHash)

	for attempt := 1; attempt <= MaxAttempts; attempt++ {
		_, err = service.Verify(context.Background(), pending.Challenge.ID, "999999")
		if pending.Code == "999999" {
			t.Skip("generated code matched the intentionally wrong test code")
		}
		if attempt == MaxAttempts {
			require.ErrorIs(t, err, ErrTooManyAttempts)
		} else {
			require.ErrorIs(t, err, ErrInvalidCode)
		}
	}
	_, err = service.Verify(context.Background(), pending.Challenge.ID, pending.Code)
	require.ErrorIs(t, err, ErrTooManyAttempts)

	replacement, err := service.Resend(context.Background(), pending.Challenge.ID)
	require.NoError(t, err)
	user, err := service.Verify(context.Background(), replacement.Challenge.ID, replacement.Code)
	require.NoError(t, err)
	require.False(t, user.EmailVerifiedAt.IsZero())
	_, err = service.Verify(context.Background(), replacement.Challenge.ID, replacement.Code)
	require.ErrorIs(t, err, ErrChallengeNotFound)

	var stored models.EmailVerificationChallenge
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", replacement.Challenge.ID).Scan(context.Background()))
	require.False(t, stored.ConsumedAt.IsZero())
}

func TestResendIsThrottledAfterSuccessfulDelivery(t *testing.T) {
	t.Parallel()

	service, _ := newTestService(t, false)
	pending, err := service.Create(context.Background(), "user-1")
	require.NoError(t, err)
	require.NoError(t, service.MarkSent(context.Background(), pending.Challenge.ID))

	_, err = service.Resend(context.Background(), pending.Challenge.ID)
	require.ErrorIs(t, err, ErrResendTooSoon)
}

func TestCurrentOrCreateInvalidatesAnExpiredCode(t *testing.T) {
	t.Parallel()

	service, _ := newTestService(t, false)
	pending, err := service.Create(context.Background(), "user-1")
	require.NoError(t, err)
	service.now = func() time.Time { return pending.Challenge.ExpiresAt.Add(time.Second) }

	replacement, err := service.CurrentOrCreate(context.Background(), "user-1")
	require.NoError(t, err)
	require.True(t, replacement.Created)
	require.NotEqual(t, pending.Challenge.ID, replacement.Challenge.ID)

	_, err = service.Verify(context.Background(), pending.Challenge.ID, pending.Code)
	require.ErrorIs(t, err, ErrChallengeNotFound)
}

func TestFirstVerifiedUserIsPromotedAndClosedRegistrationRejectsTheNext(t *testing.T) {
	t.Parallel()

	service, db := newTestService(t, true)
	second := &models.User{ID: "user-2", Email: "second@example.com", PasswordHash: "hash", CreatedAt: time.Now().UTC()}
	_, err := db.NewInsert().Model(second).Exec(context.Background())
	require.NoError(t, err)

	firstPending, err := service.Create(context.Background(), "user-1")
	require.NoError(t, err)
	first, err := service.Verify(context.Background(), firstPending.Challenge.ID, firstPending.Code)
	require.NoError(t, err)
	require.True(t, first.IsAdmin)

	secondPending, err := service.Create(context.Background(), "user-2")
	require.NoError(t, err)
	_, err = service.Verify(context.Background(), secondPending.Challenge.ID, secondPending.Code)
	require.ErrorIs(t, err, ErrRegistrationsClosed)
}

func newTestService(t *testing.T, registrationsDisabled bool) (*Service, *bun.DB) {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name()))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqldb.Close()) })
	db := bun.NewDB(sqldb, sqlitedialect.New())
	ctx := context.Background()
	for _, model := range []interface{}{(*models.User)(nil), (*models.EmailVerificationChallenge)(nil)} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	user := &models.User{ID: "user-1", Email: "person@example.com", PasswordHash: "hash", CreatedAt: time.Now().UTC()}
	_, err = db.NewInsert().Model(user).Exec(ctx)
	require.NoError(t, err)
	return NewService(db, Config{
		Secret:                "verification-secret-with-at-least-32-characters",
		PromoteFirstVerified:  true,
		RegistrationsDisabled: registrationsDisabled,
	}), db
}
