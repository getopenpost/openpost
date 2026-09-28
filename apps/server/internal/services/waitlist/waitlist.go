// Package waitlist collects interest in Hosted without creating accounts.
package waitlist

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/uptrace/bun"
)

var ErrInvalidEmail = errors.New("enter a valid email address")

type entry struct {
	bun.BaseModel `bun:"table:hosted_waitlist_entries"`
	ID            string    `bun:"id,pk"`
	Email         string    `bun:"email,notnull,unique"`
	CreatedAt     time.Time `bun:"created_at,notnull"`
	NotifiedAt    time.Time `bun:"notified_at,nullzero"`
}

type notificationPayload struct {
	EntryID string `json:"entry_id"`
}

type Service struct {
	db         *bun.DB
	webhookURL string
}

func NewService(db *bun.DB, webhookURL string) *Service {
	return &Service{db: db, webhookURL: strings.TrimSpace(webhookURL)}
}

func (s *Service) Join(ctx context.Context, email string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email || len(email) > 254 {
		return ErrInvalidEmail
	}
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		item := &entry{ID: uuid.NewString(), Email: email, CreatedAt: time.Now().UTC()}
		result, err := tx.NewInsert().Model(item).On("CONFLICT (email) DO NOTHING").Exec(ctx)
		if err != nil {
			return err
		}
		inserted, err := result.RowsAffected()
		if err != nil || inserted == 0 {
			return err
		}
		payload, err := json.Marshal(notificationPayload{EntryID: item.ID})
		if err != nil {
			return err
		}
		job, err := jobregistry.NewJob(jobregistry.TypeWaitlistNotification, string(payload), item.CreatedAt)
		if err != nil {
			return err
		}
		_, err = tx.NewInsert().Model(job).Exec(ctx)
		return err
	})
}

func (s *Service) HandleNotification(ctx context.Context, payload string) error {
	var input notificationPayload
	if err := json.Unmarshal([]byte(payload), &input); err != nil {
		return err
	}
	var item entry
	if err := s.db.NewSelect().Model(&item).Where("id = ?", input.EntryID).Scan(ctx); err != nil {
		// An operator may remove an entry before its notification is delivered.
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	if !item.NotifiedAt.IsZero() {
		return nil
	}
	if err := s.notifyDiscord(ctx, item); err != nil {
		return err
	}
	_, err := s.db.NewUpdate().Model(&item).Set("notified_at = ?", time.Now().UTC()).WherePK().Exec(ctx)
	return err
}
