package emailverification

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
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

const (
	CodeTTL        = 10 * time.Minute
	ResendInterval = time.Minute
	MaxAttempts    = 5
)

var (
	ErrChallengeNotFound    = errors.New("email verification challenge not found")
	ErrChallengeExpired     = errors.New("email verification challenge expired")
	ErrInvalidCode          = errors.New("email verification code is invalid")
	ErrTooManyAttempts      = errors.New("too many email verification attempts")
	ErrResendTooSoon        = errors.New("email verification resend requested too soon")
	ErrAlreadyVerified      = errors.New("email is already verified")
	ErrRegistrationsClosed  = errors.New("registrations are disabled")
	verificationCodePattern = regexp.MustCompile(`^[0-9]{6}$`)
)

type Config struct {
	Secret                string
	PromoteFirstVerified  bool
	RegistrationsDisabled bool
}

type Pending struct {
	Challenge *models.EmailVerificationChallenge
	Email     string
	Code      string
	Created   bool
}

type Service struct {
	db     *bun.DB
	secret []byte
	config Config
	now    func() time.Time
}

func NewService(db *bun.DB, config Config) *Service {
	return &Service{
		db:     db,
		secret: []byte(config.Secret),
		config: config,
		now:    func() time.Time { return time.Now().UTC() },
	}
}

func (s *Service) CurrentOrCreate(ctx context.Context, userID string) (*Pending, error) {
	now := s.now()
	var row models.EmailVerificationChallenge
	err := s.db.NewSelect().
		Model(&row).
		Where("user_id = ?", strings.TrimSpace(userID)).
		Where("consumed_at IS NULL AND expires_at > ? AND attempts < ?", now, MaxAttempts).
		Order("created_at DESC").
		Limit(1).
		Scan(ctx)
	if err == nil {
		email, emailErr := s.userEmail(ctx, row.UserID)
		if emailErr != nil {
			return nil, emailErr
		}
		return &Pending{Challenge: &row, Email: email}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	// Invalidate expired or attempt-exhausted challenges before inserting the
	// replacement. This keeps only the newest code usable when sign-in requests
	// race or a user returns after a code expires.
	return s.create(ctx, userID, true)
}

func (s *Service) Create(ctx context.Context, userID string) (*Pending, error) {
	return s.create(ctx, userID, false)
}

func (s *Service) Resend(ctx context.Context, challengeID string) (*Pending, error) {
	var current models.EmailVerificationChallenge
	if err := s.db.NewSelect().Model(&current).
		Where("id = ?", strings.TrimSpace(challengeID)).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrChallengeNotFound
		}
		return nil, err
	}
	var user models.User
	if err := s.db.NewSelect().Model(&user).Where("id = ?", current.UserID).Scan(ctx); err != nil {
		return nil, ErrChallengeNotFound
	}
	if !user.EmailVerifiedAt.IsZero() {
		return nil, ErrAlreadyVerified
	}
	if !current.SentAt.IsZero() && current.SentAt.Add(ResendInterval).After(s.now()) {
		return nil, ErrResendTooSoon
	}
	return s.create(ctx, current.UserID, true)
}

func (s *Service) MarkSent(ctx context.Context, challengeID string) error {
	result, err := s.db.NewUpdate().
		Model((*models.EmailVerificationChallenge)(nil)).
		Set("sent_at = ?", s.now()).
		Where("id = ? AND consumed_at IS NULL", strings.TrimSpace(challengeID)).
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

func (s *Service) Verify(ctx context.Context, challengeID, code string) (*models.User, error) {
	challengeID = strings.TrimSpace(challengeID)
	code = strings.TrimSpace(code)
	if !verificationCodePattern.MatchString(code) {
		return nil, ErrInvalidCode
	}
	var challenge models.EmailVerificationChallenge
	if err := s.db.NewSelect().Model(&challenge).Where("id = ?", challengeID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrChallengeNotFound
		}
		return nil, err
	}
	now := s.now()
	if !challenge.ConsumedAt.IsZero() {
		return nil, ErrChallengeNotFound
	}
	if !challenge.ExpiresAt.After(now) {
		return nil, ErrChallengeExpired
	}
	if challenge.Attempts >= MaxAttempts {
		return nil, ErrTooManyAttempts
	}
	wanted := s.codeHash(challenge.ID, code)
	if subtle.ConstantTimeCompare([]byte(wanted), []byte(challenge.CodeHash)) != 1 {
		result, err := s.db.NewUpdate().
			Model((*models.EmailVerificationChallenge)(nil)).
			Set("attempts = attempts + 1").
			Where("id = ? AND consumed_at IS NULL AND expires_at > ? AND attempts < ?", challenge.ID, now, MaxAttempts).
			Exec(ctx)
		if err != nil {
			return nil, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return nil, err
		}
		if affected != 1 {
			return nil, ErrTooManyAttempts
		}
		var attempts int
		if err := s.db.NewSelect().Model((*models.EmailVerificationChallenge)(nil)).
			Column("attempts").Where("id = ?", challenge.ID).Scan(ctx, &attempts); err != nil {
			return nil, err
		}
		if attempts >= MaxAttempts {
			return nil, ErrTooManyAttempts
		}
		return nil, ErrInvalidCode
	}

	if err := s.complete(ctx, challenge, now); err != nil {
		return nil, err
	}
	var user models.User
	if err := s.db.NewSelect().Model(&user).Where("id = ?", challenge.UserID).Scan(ctx); err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *Service) create(ctx context.Context, userID string, replace bool) (*Pending, error) {
	userID = strings.TrimSpace(userID)
	var user models.User
	if err := s.db.NewSelect().Model(&user).Where("id = ?", userID).Scan(ctx); err != nil {
		return nil, err
	}
	if !user.EmailVerifiedAt.IsZero() {
		return nil, ErrAlreadyVerified
	}
	code, err := generateCode()
	if err != nil {
		return nil, err
	}
	now := s.now()
	challenge := &models.EmailVerificationChallenge{
		ID:        uuid.NewString(),
		UserID:    user.ID,
		ExpiresAt: now.Add(CodeTTL),
		CreatedAt: now,
	}
	challenge.CodeHash = s.codeHash(challenge.ID, code)
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if replace {
			if _, err := tx.NewUpdate().Model((*models.EmailVerificationChallenge)(nil)).
				Set("consumed_at = ?", now).
				Where("user_id = ? AND consumed_at IS NULL", user.ID).
				Exec(txCtx); err != nil {
				return err
			}
		}
		_, err := tx.NewInsert().Model(challenge).Exec(txCtx)
		return err
	})
	if err != nil {
		return nil, err
	}
	_, _ = s.db.NewDelete().Model((*models.EmailVerificationChallenge)(nil)).
		Where("expires_at < ?", now.Add(-24*time.Hour)).Exec(ctx)
	return &Pending{Challenge: challenge, Email: user.Email, Code: code, Created: true}, nil
}

func (s *Service) complete(ctx context.Context, challenge models.EmailVerificationChallenge, now time.Time) error {
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if s.db.Dialect().Name() == dialect.PG {
			if _, err := tx.ExecContext(txCtx, "SELECT pg_advisory_xact_lock(?)", int64(0x4f50454e504f5354)); err != nil {
				return err
			}
		}
		var user models.User
		if err := tx.NewSelect().Model(&user).Where("id = ?", challenge.UserID).Scan(txCtx); err != nil {
			return err
		}
		if !user.EmailVerifiedAt.IsZero() {
			return ErrAlreadyVerified
		}
		verifiedCount, err := tx.NewSelect().Model((*models.User)(nil)).
			Where("email_verified_at IS NOT NULL").Count(txCtx)
		if err != nil {
			return err
		}
		if s.config.RegistrationsDisabled && verifiedCount > 0 {
			return ErrRegistrationsClosed
		}
		result, err := tx.NewUpdate().Model((*models.EmailVerificationChallenge)(nil)).
			Set("consumed_at = ?", now).
			Where("id = ? AND consumed_at IS NULL AND expires_at > ? AND attempts < ?", challenge.ID, now, MaxAttempts).
			Exec(txCtx)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil || affected != 1 {
			return ErrChallengeNotFound
		}
		update := tx.NewUpdate().Model((*models.User)(nil)).
			Set("email_verified_at = ?", now).
			Where("id = ? AND email_verified_at IS NULL", user.ID)
		if s.config.PromoteFirstVerified && verifiedCount == 0 {
			update = update.Set("is_admin = ?", true)
		}
		_, err = update.Exec(txCtx)
		return err
	})
}

func (s *Service) userEmail(ctx context.Context, userID string) (string, error) {
	var email string
	if err := s.db.NewSelect().Model((*models.User)(nil)).Column("email").Where("id = ?", userID).Scan(ctx, &email); err != nil {
		return "", err
	}
	return email, nil
}

func (s *Service) codeHash(challengeID, code string) string {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte(challengeID))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(code))
	return fmt.Sprintf("%x", mac.Sum(nil))
}

func generateCode() (string, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", value.Int64()), nil
}
