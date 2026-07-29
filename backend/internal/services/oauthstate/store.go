package oauthstate

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const (
	challengeType = "oauth_state"
	defaultTTL    = 10 * time.Minute
)

type Store struct {
	db  *bun.DB
	ttl time.Duration
}

type Payload struct {
	UserID      string `json:"user_id"`
	WorkspaceID string `json:"workspace_id"`
	Platform    string `json:"platform"`
	ServerName  string `json:"server_name,omitempty"`
}

func NewStore(db *bun.DB) *Store {
	return &Store{db: db, ttl: defaultTTL}
}

func (s *Store) Create(ctx context.Context, payload Payload) (string, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	state := uuid.NewString()
	challenge := &models.AuthChallenge{
		ID:        state,
		UserID:    payload.UserID,
		Type:      challengeType,
		Payload:   string(raw),
		ExpiresAt: time.Now().UTC().Add(s.ttl),
		CreatedAt: time.Now().UTC(),
	}

	if _, err := s.db.NewInsert().Model(challenge).Exec(ctx); err != nil {
		return "", err
	}

	return state, nil
}

func (s *Store) Consume(ctx context.Context, state string) (*Payload, error) {
	challenge := new(models.AuthChallenge)
	if err := s.db.NewSelect().
		Model(challenge).
		Where("id = ?", state).
		Where("type = ?", challengeType).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrInvalidState
		}
		return nil, err
	}

	if _, err := s.db.NewDelete().
		Model((*models.AuthChallenge)(nil)).
		Where("id = ?", challenge.ID).
		Where("type = ?", challengeType).
		Exec(ctx); err != nil {
		return nil, err
	}

	if time.Now().UTC().After(challenge.ExpiresAt) {
		return nil, ErrExpiredState
	}

	var payload Payload
	if err := json.Unmarshal([]byte(challenge.Payload), &payload); err != nil {
		return nil, err
	}

	return &payload, nil
}

var (
	ErrInvalidState = errors.New("invalid oauth state")
	ErrExpiredState = errors.New("expired oauth state")
)
