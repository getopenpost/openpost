package sessions

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

var (
	ErrInvalidSession = errors.New("invalid session")
	ErrExpiredSession = errors.New("expired session")
	ErrRevokedSession = errors.New("revoked session")
)

type Service struct {
	db *bun.DB
}

type CreateInput struct {
	UserID    string
	UserAgent string
	IPAddress string
	ExpiresAt time.Time
}

func NewService(db *bun.DB) *Service {
	return &Service{db: db}
}

func (s *Service) CreateSession(ctx context.Context, input CreateInput) (*models.UserSession, error) {
	now := time.Now().UTC()
	session := &models.UserSession{
		ID:         uuid.NewString(),
		UserID:     strings.TrimSpace(input.UserID),
		UserAgent:  strings.TrimSpace(input.UserAgent),
		IPAddress:  strings.TrimSpace(input.IPAddress),
		ExpiresAt:  input.ExpiresAt.UTC(),
		LastUsedAt: now,
		CreatedAt:  now,
	}
	if _, err := s.db.NewInsert().Model(session).Exec(ctx); err != nil {
		return nil, err
	}
	return session, nil
}

func (s *Service) ValidateSession(ctx context.Context, userID, sessionID string) (*models.UserSession, error) {
	session := new(models.UserSession)
	if err := s.db.NewSelect().
		Model(session).
		Where("id = ? AND user_id = ?", sessionID, userID).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrInvalidSession
		}
		return nil, err
	}

	now := time.Now().UTC()
	if !session.RevokedAt.IsZero() {
		return nil, ErrRevokedSession
	}
	if !session.ExpiresAt.After(now) {
		return nil, ErrExpiredSession
	}

	if err := s.TouchLastUsedAt(ctx, session.ID, now); err != nil {
		return nil, err
	}
	session.LastUsedAt = now
	return session, nil
}

func (s *Service) ListActiveSessions(ctx context.Context, userID string) ([]models.UserSession, error) {
	var sessions []models.UserSession
	err := s.db.NewSelect().
		Model(&sessions).
		Where("user_id = ?", userID).
		Where("revoked_at IS NULL").
		Where("expires_at > ?", time.Now().UTC()).
		Order("last_used_at DESC").
		Order("created_at DESC").
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return []models.UserSession{}, nil
	}
	return sessions, err
}

func (s *Service) RevokeSession(ctx context.Context, userID, sessionID string) error {
	result, err := s.db.NewUpdate().
		Model((*models.UserSession)(nil)).
		Set("revoked_at = ?", time.Now().UTC()).
		Where("id = ? AND user_id = ? AND revoked_at IS NULL", sessionID, userID).
		Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Service) TouchLastUsedAt(ctx context.Context, sessionID string, at time.Time) error {
	_, err := s.db.NewUpdate().
		Model((*models.UserSession)(nil)).
		Set("last_used_at = ?", at.UTC()).
		Where("id = ?", sessionID).
		Exec(ctx)
	return err
}
