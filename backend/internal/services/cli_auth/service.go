package cli_auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/uptrace/bun"
)

const (
	DefaultLifetime = 10 * time.Minute
	DefaultInterval = 5
	DefaultScope    = apitokens.DefaultScope

	statusPending  = "pending"
	statusApproved = "approved"
	statusDenied   = "denied"
	statusExpired  = "expired"

	userCodeAlphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
)

var (
	ErrNotFound             = errors.New("cli auth session not found")
	ErrExpired              = errors.New("cli auth session expired")
	ErrDenied               = errors.New("cli auth session denied")
	ErrAuthorizationPending = errors.New("cli auth authorization pending")
	ErrSlowDown             = errors.New("cli auth polling too quickly")
	ErrAlreadyUsed          = errors.New("cli auth session already used")
)

type Service struct {
	db     *bun.DB
	tokens *apitokens.Service
	now    func() time.Time
}

type StartInput struct {
	ClientName      string
	ClientVersion   string
	ClientOS        string
	RequestedScopes string
}

type StartedSession struct {
	Model      *models.CLIAuthSession
	DeviceCode string
	UserCode   string
	ExpiresIn  int
}

type PollResult struct {
	Status      string
	Token       string
	ExpiresIn   int
	Interval    int
	RetryAfter  int
	TokenPrefix string
}

func NewService(db *bun.DB, tokens *apitokens.Service) *Service {
	return &Service{
		db:     db,
		tokens: tokens,
		now: func() time.Time {
			return time.Now().UTC()
		},
	}
}

func (s *Service) StartSession(ctx context.Context, input StartInput) (*StartedSession, error) {
	clientName := strings.TrimSpace(input.ClientName)
	if clientName == "" {
		clientName = "OpenPost CLI"
	}
	scopes := strings.TrimSpace(input.RequestedScopes)
	if scopes == "" {
		scopes = DefaultScope
	}

	deviceCode, err := generateDeviceCode()
	if err != nil {
		return nil, err
	}

	expiresAt := s.now().Add(DefaultLifetime)
	for range 8 {
		userCode, err := generateUserCode()
		if err != nil {
			return nil, err
		}

		session := &models.CLIAuthSession{
			ID:              uuid.NewString(),
			DeviceCodeHash:  hashCode(deviceCode),
			UserCodeHash:    hashCode(userCode),
			ClientName:      clientName,
			ClientVersion:   strings.TrimSpace(input.ClientVersion),
			ClientOS:        strings.TrimSpace(input.ClientOS),
			RequestedScopes: scopes,
			Status:          statusPending,
			IntervalSeconds: DefaultInterval,
			ExpiresAt:       expiresAt,
			CreatedAt:       s.now(),
		}

		if _, err := s.db.NewInsert().Model(session).Exec(ctx); err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				continue
			}
			return nil, err
		}

		return &StartedSession{
			Model:      session,
			DeviceCode: deviceCode,
			UserCode:   userCode,
			ExpiresIn:  int(time.Until(expiresAt).Seconds()),
		}, nil
	}

	return nil, errors.New("failed to allocate cli auth user code")
}

func (s *Service) PollSession(ctx context.Context, deviceCode string) (*PollResult, error) {
	session, err := s.sessionByDeviceCode(ctx, deviceCode)
	if err != nil {
		return nil, err
	}

	now := s.now()
	if err := s.expireIfNeeded(ctx, session, now); err != nil {
		return pollResult(session, now), err
	}
	if !session.LastPolledAt.IsZero() && now.Sub(session.LastPolledAt) < time.Second {
		return pollResult(session, now), ErrSlowDown
	}

	if _, err := s.db.NewUpdate().
		Model((*models.CLIAuthSession)(nil)).
		Set("last_polled_at = ?", now).
		Where("id = ?", session.ID).
		Exec(ctx); err != nil {
		return nil, err
	}
	session.LastPolledAt = now

	switch session.Status {
	case statusPending:
		return pollResult(session, now), ErrAuthorizationPending
	case statusDenied:
		return pollResult(session, now), ErrDenied
	case statusExpired:
		return pollResult(session, now), ErrExpired
	case statusApproved:
		return s.consumeApprovedSession(ctx, session, now)
	default:
		return nil, ErrNotFound
	}
}

func (s *Service) ApproveSession(ctx context.Context, userID, code, scopes, tokenName string) error {
	session, err := s.sessionByCode(ctx, code)
	if err != nil {
		return err
	}
	now := s.now()
	if err := s.expireIfNeeded(ctx, session, now); err != nil {
		return err
	}
	if session.Status != statusPending {
		if session.Status == statusDenied {
			return ErrDenied
		}
		return ErrAlreadyUsed
	}
	if strings.TrimSpace(scopes) == "" {
		scopes = session.RequestedScopes
	}
	if strings.TrimSpace(tokenName) == "" {
		tokenName = session.ClientName
	}

	_, err = s.db.NewUpdate().
		Model((*models.CLIAuthSession)(nil)).
		Set("user_id = ?", userID).
		Set("requested_scopes = ?", scopes).
		Set("client_name = ?", tokenName).
		Set("status = ?", statusApproved).
		Set("approved_at = ?", now).
		Where("id = ? AND status = ?", session.ID, statusPending).
		Exec(ctx)
	return err
}

func (s *Service) DenySession(ctx context.Context, code string) error {
	session, err := s.sessionByCode(ctx, code)
	if err != nil {
		return err
	}
	now := s.now()
	if err := s.expireIfNeeded(ctx, session, now); err != nil {
		return err
	}
	if session.Status != statusPending {
		if session.Status == statusDenied {
			return nil
		}
		return ErrAlreadyUsed
	}

	_, err = s.db.NewUpdate().
		Model((*models.CLIAuthSession)(nil)).
		Set("status = ?", statusDenied).
		Set("denied_at = ?", now).
		Where("id = ? AND status = ?", session.ID, statusPending).
		Exec(ctx)
	return err
}

func (s *Service) CleanupExpired(ctx context.Context) error {
	_, err := s.db.NewUpdate().
		Model((*models.CLIAuthSession)(nil)).
		Set("status = ?", statusExpired).
		Where("status = ? AND expires_at <= ?", statusPending, s.now()).
		Exec(ctx)
	return err
}

func (s *Service) GetPendingByUserCode(ctx context.Context, userCode string) (*models.CLIAuthSession, error) {
	session, err := s.sessionByUserCode(ctx, userCode)
	if err != nil {
		return nil, err
	}
	if err := s.expireIfNeeded(ctx, session, s.now()); err != nil {
		return nil, err
	}
	return session, nil
}

func (s *Service) consumeApprovedSession(ctx context.Context, session *models.CLIAuthSession, now time.Time) (*PollResult, error) {
	if session.UserID == "" {
		return nil, ErrNotFound
	}
	expiresAt := now.Add(apitokens.DefaultExpiration)
	generated, err := s.tokens.GenerateToken(ctx, session.UserID, session.ClientName, session.RequestedScopes, &expiresAt)
	if err != nil {
		return nil, err
	}
	if _, err := s.db.NewUpdate().
		Model((*models.CLIAuthSession)(nil)).
		Set("status = ?", statusExpired).
		Where("id = ? AND status = ?", session.ID, statusApproved).
		Exec(ctx); err != nil {
		return nil, err
	}

	result := pollResult(session, now)
	result.Status = statusApproved
	result.Token = generated.Token
	result.TokenPrefix = generated.Model.TokenPrefix
	return result, nil
}

func (s *Service) expireIfNeeded(ctx context.Context, session *models.CLIAuthSession, now time.Time) error {
	if session.Status == statusPending && !session.ExpiresAt.After(now) {
		_, err := s.db.NewUpdate().
			Model((*models.CLIAuthSession)(nil)).
			Set("status = ?", statusExpired).
			Where("id = ? AND status = ?", session.ID, statusPending).
			Exec(ctx)
		if err != nil {
			return err
		}
		session.Status = statusExpired
		return ErrExpired
	}
	return nil
}

func (s *Service) sessionByDeviceCode(ctx context.Context, deviceCode string) (*models.CLIAuthSession, error) {
	var session models.CLIAuthSession
	if err := s.db.NewSelect().
		Model(&session).
		Where("device_code_hash = ?", hashCode(deviceCode)).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &session, nil
}

func (s *Service) sessionByUserCode(ctx context.Context, userCode string) (*models.CLIAuthSession, error) {
	var session models.CLIAuthSession
	if err := s.db.NewSelect().
		Model(&session).
		Where("user_code_hash = ?", hashCode(normalizeUserCode(userCode))).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &session, nil
}

func (s *Service) sessionByCode(ctx context.Context, code string) (*models.CLIAuthSession, error) {
	if strings.Contains(code, "-") {
		return s.sessionByUserCode(ctx, code)
	}
	return s.sessionByDeviceCode(ctx, code)
}

func pollResult(session *models.CLIAuthSession, now time.Time) *PollResult {
	expiresIn := int(session.ExpiresAt.Sub(now).Seconds())
	if expiresIn < 0 {
		expiresIn = 0
	}
	retryAfter := session.IntervalSeconds
	if !session.LastPolledAt.IsZero() {
		remaining := time.Second - now.Sub(session.LastPolledAt)
		if remaining > 0 {
			retryAfter = int(remaining.Round(time.Second).Seconds())
			if retryAfter < 1 {
				retryAfter = 1
			}
		}
	}
	return &PollResult{
		Status:     session.Status,
		ExpiresIn:  expiresIn,
		Interval:   session.IntervalSeconds,
		RetryAfter: retryAfter,
	}
}

func hashCode(code string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(code)))
	return hex.EncodeToString(sum[:])
}

func normalizeUserCode(code string) string {
	code = strings.ToUpper(strings.TrimSpace(code))
	if len(code) == 8 && !strings.Contains(code, "-") {
		return code[:4] + "-" + code[4:]
	}
	return code
}

func generateDeviceCode() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func generateUserCode() (string, error) {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	var b strings.Builder
	for i, raw := range buf {
		if i == 4 {
			b.WriteByte('-')
		}
		b.WriteByte(userCodeAlphabet[int(raw)%len(userCodeAlphabet)])
	}
	return b.String(), nil
}
