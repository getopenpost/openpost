package emailchange

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/credentialguard"
	"github.com/uptrace/bun"
)

const (
	ChallengeTTL  = 15 * time.Minute
	ResendDelay   = time.Minute
	MaxAttempts   = 5
	maxEmailBytes = 320
)

var (
	ErrNotConfigured     = errors.New("email change is not configured")
	ErrInvalidEmail      = errors.New("invalid email address")
	ErrSameEmail         = errors.New("new email matches current email")
	ErrEmailUnavailable  = errors.New("email address is unavailable")
	ErrChallengeNotFound = errors.New("email change challenge not found")
	ErrChallengeExpired  = errors.New("email change challenge expired")
	ErrInvalidCode       = errors.New("email change code is invalid")
	ErrTooManyAttempts   = errors.New("too many email change attempts")
	ErrResendTooSoon     = errors.New("email change resend requested too soon")
	codePattern          = regexp.MustCompile(`^[0-9]{6}$`)
)

type Config struct {
	Secret string
	Now    func() time.Time
}

type Service struct {
	db     *bun.DB
	secret []byte
	now    func() time.Time
}

type Pending struct {
	Challenge *models.EmailChangeChallenge
	Code      string
}

type Completion struct {
	User            *models.User
	RevokedSessions int64
}

func NewService(db *bun.DB, config Config) *Service {
	now := config.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{db: db, secret: []byte(config.Secret), now: now}
}

func (s *Service) Begin(ctx context.Context, userID, requestedEmail string) (*Pending, error) {
	if !s.configured() {
		return nil, ErrNotConfigured
	}
	newEmail, err := normalizeEmail(requestedEmail)
	if err != nil {
		return nil, err
	}
	code, err := generateCode()
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	challenge := &models.EmailChangeChallenge{
		ID:        uuid.NewString(),
		UserID:    strings.TrimSpace(userID),
		NewEmail:  newEmail,
		ExpiresAt: now.Add(ChallengeTTL),
		CreatedAt: now,
	}
	challenge.CodeHash = s.codeHash(challenge.ID, code)

	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := credentialguard.LockUserMutation(txCtx, tx, challenge.UserID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrChallengeNotFound
			}
			return err
		}
		var user models.User
		if err := tx.NewSelect().Model(&user).Where("id = ?", challenge.UserID).Scan(txCtx); err != nil {
			return ErrChallengeNotFound
		}
		challenge.OldEmail = strings.ToLower(strings.TrimSpace(user.Email))
		if challenge.OldEmail == challenge.NewEmail {
			return ErrSameEmail
		}
		if err := ensureEmailAvailable(txCtx, tx, user.ID, challenge.NewEmail); err != nil {
			return err
		}
		if _, err := tx.NewUpdate().Model((*models.EmailChangeChallenge)(nil)).
			Set("canceled_at = ?", now).
			Where("user_id = ? AND consumed_at IS NULL AND canceled_at IS NULL", user.ID).
			Exec(txCtx); err != nil {
			return err
		}
		_, err := tx.NewInsert().Model(challenge).Exec(txCtx)
		return err
	})
	if err != nil {
		return nil, err
	}
	_, _ = s.db.NewDelete().Model((*models.EmailChangeChallenge)(nil)).
		Where("expires_at < ?", now.Add(-24*time.Hour)).Exec(ctx)
	return &Pending{Challenge: challenge, Code: code}, nil
}

func (s *Service) Current(ctx context.Context, userID string) (*models.EmailChangeChallenge, error) {
	now := s.now().UTC()
	var challenge models.EmailChangeChallenge
	err := s.db.NewSelect().Model(&challenge).
		Where("user_id = ?", strings.TrimSpace(userID)).
		Where("consumed_at IS NULL AND canceled_at IS NULL AND expires_at > ?", now).
		Order("created_at DESC").Limit(1).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &challenge, nil
}

func (s *Service) MarkSent(ctx context.Context, userID, challengeID string) error {
	result, err := s.db.NewUpdate().Model((*models.EmailChangeChallenge)(nil)).
		Set("sent_at = ?", s.now().UTC()).
		Where("id = ? AND user_id = ? AND consumed_at IS NULL AND canceled_at IS NULL", strings.TrimSpace(challengeID), strings.TrimSpace(userID)).
		Exec(ctx)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		return ErrChallengeNotFound
	}
	return nil
}

func (s *Service) Resend(ctx context.Context, userID, challengeID string) (*Pending, error) {
	if !s.configured() {
		return nil, ErrNotConfigured
	}
	now := s.now().UTC()
	code, err := generateCode()
	if err != nil {
		return nil, err
	}
	userID = strings.TrimSpace(userID)
	challengeID = strings.TrimSpace(challengeID)
	var challenge models.EmailChangeChallenge
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, lockErr := credentialguard.LockUserMutation(txCtx, tx, userID); lockErr != nil {
			if errors.Is(lockErr, sql.ErrNoRows) {
				return ErrChallengeNotFound
			}
			return lockErr
		}
		if selectErr := tx.NewSelect().Model(&challenge).
			Where("id = ? AND user_id = ? AND consumed_at IS NULL AND canceled_at IS NULL", challengeID, userID).
			Scan(txCtx); selectErr != nil {
			return ErrChallengeNotFound
		}
		if !challenge.ExpiresAt.After(now) {
			return ErrChallengeExpired
		}
		if !challenge.SentAt.IsZero() && challenge.SentAt.Add(ResendDelay).After(now) {
			return ErrResendTooSoon
		}
		result, updateErr := tx.NewUpdate().Model((*models.EmailChangeChallenge)(nil)).
			Set("code_hash = ?", s.codeHash(challenge.ID, code)).
			Set("attempts = 0").
			Set("expires_at = ?", now.Add(ChallengeTTL)).
			Set("sent_at = ?", now).
			Where("id = ? AND user_id = ? AND consumed_at IS NULL AND canceled_at IS NULL AND expires_at > ?", challenge.ID, challenge.UserID, now).
			Where("code_hash = ?", challenge.CodeHash).
			Where("sent_at IS NULL OR sent_at <= ?", now.Add(-ResendDelay)).
			Exec(txCtx)
		if updateErr != nil {
			return updateErr
		}
		affected, updateErr := result.RowsAffected()
		if updateErr != nil {
			return updateErr
		}
		if affected != 1 {
			// A competing resend may already have rotated the code. Treat that as
			// the same retry fence instead of revealing any newer challenge state.
			return ErrResendTooSoon
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	challenge.CodeHash = s.codeHash(challenge.ID, code)
	challenge.Attempts = 0
	challenge.ExpiresAt = now.Add(ChallengeTTL)
	challenge.SentAt = now
	return &Pending{Challenge: &challenge, Code: code}, nil
}

func (s *Service) Verify(ctx context.Context, userID, currentSessionID, challengeID, code string) (*Completion, error) {
	if !s.configured() {
		return nil, ErrNotConfigured
	}
	code = strings.TrimSpace(code)
	if !codePattern.MatchString(code) {
		return nil, ErrInvalidCode
	}
	now := s.now().UTC()
	var challenge models.EmailChangeChallenge
	if err := s.db.NewSelect().Model(&challenge).
		Where("id = ? AND user_id = ?", strings.TrimSpace(challengeID), strings.TrimSpace(userID)).
		Scan(ctx); err != nil {
		return nil, ErrChallengeNotFound
	}
	if !challenge.ConsumedAt.IsZero() || !challenge.CanceledAt.IsZero() {
		return nil, ErrChallengeNotFound
	}
	if !challenge.ExpiresAt.After(now) {
		return nil, ErrChallengeExpired
	}
	if challenge.Attempts >= MaxAttempts {
		return nil, ErrTooManyAttempts
	}
	if subtle.ConstantTimeCompare([]byte(challenge.CodeHash), []byte(s.codeHash(challenge.ID, code))) != 1 {
		return nil, s.recordFailedAttempt(ctx, challenge.ID, challenge.UserID, now)
	}
	return s.complete(ctx, challenge, strings.TrimSpace(currentSessionID), now)
}

func (s *Service) Cancel(ctx context.Context, userID, challengeID string) error {
	result, err := s.db.NewUpdate().Model((*models.EmailChangeChallenge)(nil)).
		Set("canceled_at = ?", s.now().UTC()).
		Where("id = ? AND user_id = ? AND consumed_at IS NULL AND canceled_at IS NULL", strings.TrimSpace(challengeID), strings.TrimSpace(userID)).
		Exec(ctx)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		return ErrChallengeNotFound
	}
	return nil
}

func (s *Service) recordFailedAttempt(ctx context.Context, challengeID, userID string, now time.Time) error {
	result, err := s.db.NewUpdate().Model((*models.EmailChangeChallenge)(nil)).
		Set("attempts = attempts + 1").
		Where("id = ? AND user_id = ? AND consumed_at IS NULL AND canceled_at IS NULL AND expires_at > ? AND attempts < ?", challengeID, userID, now, MaxAttempts).
		Exec(ctx)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		return ErrTooManyAttempts
	}
	var attempts int
	if err := s.db.NewSelect().Model((*models.EmailChangeChallenge)(nil)).Column("attempts").Where("id = ?", challengeID).Scan(ctx, &attempts); err != nil {
		return err
	}
	if attempts >= MaxAttempts {
		return ErrTooManyAttempts
	}
	return ErrInvalidCode
}

func (s *Service) complete(ctx context.Context, challenge models.EmailChangeChallenge, currentSessionID string, now time.Time) (*Completion, error) {
	completion := &Completion{}
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return s.completeInTx(txCtx, tx, challenge, currentSessionID, now, completion)
	})
	if err != nil {
		return nil, err
	}
	return completion, nil
}

func (s *Service) completeInTx(
	ctx context.Context,
	tx bun.Tx,
	challenge models.EmailChangeChallenge,
	currentSessionID string,
	now time.Time,
	completion *Completion,
) error {
	current, err := loadCompletableChallenge(ctx, tx, challenge, now)
	if err != nil {
		return err
	}
	user, err := loadEmailChangeUser(ctx, tx, current)
	if err != nil {
		return err
	}
	if err := ensureEmailAvailable(ctx, tx, user.ID, current.NewEmail); err != nil {
		return err
	}
	if err := consumeEmailChangeChallenge(ctx, tx, current, now); err != nil {
		return err
	}
	if err := replaceUserEmail(ctx, tx, user.ID, current, now); err != nil {
		return err
	}
	completion.RevokedSessions, err = revokeEmailChangeSessions(ctx, tx, user.ID, currentSessionID, now)
	if err != nil {
		return err
	}
	if err := invalidatePasswordResetTokens(ctx, tx, user.ID, now); err != nil {
		return err
	}
	user.Email = current.NewEmail
	user.EmailVerifiedAt = now
	completion.User = user
	return nil
}

func loadCompletableChallenge(
	ctx context.Context,
	tx bun.Tx,
	challenge models.EmailChangeChallenge,
	now time.Time,
) (*models.EmailChangeChallenge, error) {
	if _, err := credentialguard.LockUserMutation(ctx, tx, challenge.UserID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrChallengeNotFound
		}
		return nil, err
	}
	var current models.EmailChangeChallenge
	if err := tx.NewSelect().Model(&current).
		Where("id = ? AND user_id = ?", challenge.ID, challenge.UserID).
		Scan(ctx); err != nil {
		return nil, ErrChallengeNotFound
	}
	if !current.ConsumedAt.IsZero() || !current.CanceledAt.IsZero() ||
		!current.ExpiresAt.After(now) || current.Attempts >= MaxAttempts {
		return nil, ErrChallengeExpired
	}
	if subtle.ConstantTimeCompare([]byte(current.CodeHash), []byte(challenge.CodeHash)) != 1 {
		return nil, ErrChallengeNotFound
	}
	return &current, nil
}

func loadEmailChangeUser(ctx context.Context, tx bun.Tx, challenge *models.EmailChangeChallenge) (*models.User, error) {
	var user models.User
	if err := tx.NewSelect().Model(&user).Where("id = ?", challenge.UserID).Scan(ctx); err != nil {
		return nil, ErrChallengeNotFound
	}
	if strings.ToLower(strings.TrimSpace(user.Email)) != challenge.OldEmail {
		return nil, ErrChallengeNotFound
	}
	return &user, nil
}

func consumeEmailChangeChallenge(ctx context.Context, tx bun.Tx, challenge *models.EmailChangeChallenge, now time.Time) error {
	result, err := tx.NewUpdate().Model((*models.EmailChangeChallenge)(nil)).
		Set("consumed_at = ?", now).
		Where("id = ? AND code_hash = ? AND consumed_at IS NULL AND canceled_at IS NULL AND expires_at > ? AND attempts < ?", challenge.ID, challenge.CodeHash, now, MaxAttempts).
		Exec(ctx)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		return ErrChallengeNotFound
	}
	return nil
}

func replaceUserEmail(
	ctx context.Context,
	tx bun.Tx,
	userID string,
	challenge *models.EmailChangeChallenge,
	now time.Time,
) error {
	result, err := tx.NewUpdate().Model((*models.User)(nil)).
		Set("email = ?", challenge.NewEmail).
		Set("email_verified_at = ?", now).
		Where("id = ? AND LOWER(email) = ?", userID, challenge.OldEmail).
		Exec(ctx)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrEmailUnavailable
		}
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		return ErrChallengeNotFound
	}
	return nil
}

func revokeEmailChangeSessions(
	ctx context.Context,
	tx bun.Tx,
	userID,
	currentSessionID string,
	now time.Time,
) (int64, error) {
	query := tx.NewUpdate().Model((*models.UserSession)(nil)).
		Set("revoked_at = ?", now).
		Where("user_id = ? AND revoked_at IS NULL", userID)
	if currentSessionID != "" {
		query = query.Where("id <> ?", currentSessionID)
	}
	result, err := query.Exec(ctx)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func invalidatePasswordResetTokens(ctx context.Context, tx bun.Tx, userID string, now time.Time) error {
	_, err := tx.NewUpdate().Model((*models.PasswordResetToken)(nil)).
		Set("used_at = ?", now).
		Where("user_id = ? AND used_at IS NULL", userID).
		Exec(ctx)
	return err
}

func (s *Service) configured() bool {
	return s != nil && s.db != nil && len(s.secret) >= 16
}

func (s *Service) codeHash(challengeID, code string) string {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte(challengeID))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(code))
	return fmt.Sprintf("%x", mac.Sum(nil))
}

func ensureEmailAvailable(ctx context.Context, db bun.IDB, userID, email string) error {
	exists, err := db.NewSelect().Model((*models.User)(nil)).
		Where("LOWER(email) = ? AND id <> ?", email, userID).
		Exists(ctx)
	if err != nil {
		return err
	}
	if exists {
		return ErrEmailUnavailable
	}
	return nil
}

func normalizeEmail(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > maxEmailBytes || strings.ContainsAny(value, "\r\n") {
		return "", ErrInvalidEmail
	}
	parsed, err := mail.ParseAddress(value)
	if err != nil || !strings.EqualFold(parsed.Address, value) {
		return "", ErrInvalidEmail
	}
	parts := strings.Split(parsed.Address, "@")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", ErrInvalidEmail
	}
	return strings.ToLower(parsed.Address), nil
}

func generateCode() (string, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", value.Int64()), nil
}

func isUniqueViolation(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unique") || strings.Contains(message, "duplicate")
}
