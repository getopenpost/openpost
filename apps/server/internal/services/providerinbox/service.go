// Package providerinbox owns authenticated durable provider intake and leased
// live transports. The messaging service owns canonical application of events.
package providerinbox

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/uptrace/bun"
)

const MaxBodyBytes = 1 << 20

type Service struct {
	db               *bun.DB
	encryptor        *servicecrypto.TokenEncryptor
	now              func() time.Time
	scheduleReceipts func(context.Context) error
}

func NewService(db *bun.DB, encryptor *servicecrypto.TokenEncryptor) *Service {
	return &Service{db: db, encryptor: encryptor, now: func() time.Time { return time.Now().UTC() }}
}

// SetReceiptScheduler installs the durable drain-job producer before serving
// callbacks. It runs after every committed receipt batch, including replays.
func (s *Service) SetReceiptScheduler(schedule func(context.Context) error) {
	s.scheduleReceipts = schedule
}

type receipt struct {
	bun.BaseModel    `bun:"table:provider_inbox_receipts"`
	ID               string `bun:",pk"`
	ProviderAppID    string
	AccountID        string
	OAuthGrantID     string `bun:"oauth_grant_id"`
	EventKey         string
	Kind             string
	PayloadEncrypted []byte
	CreatedAt        time.Time
	ProcessedAt      time.Time `bun:",nullzero"`
	Attempts         int
	NextAttemptAt    int64
	LeaseOwner       string
	LeaseUntil       int64
}

// Event is decrypted only for the processing callback. Never log Payload.
// A callback must be idempotent: a process can stop after apply and before ack.
type Event struct {
	AccountID, OAuthGrantID, ProviderAppID, Kind string
	Payload                                      []byte
}
type Processor func(context.Context, Event) error

func eventKey(body []byte) string { hash := sha256.Sum256(body); return hex.EncodeToString(hash[:]) }

// ProcessPending claims at most limit receipts and retains failures for retry.
// Run from the existing durable scheduler, in worker/all roles. No local queue
// is required for correctness and a web process never processes before ack.
func (s *Service) ProcessPending(ctx context.Context, limit int, process Processor) (int, error) {
	if process == nil || s.encryptor == nil {
		return 0, errors.New("provider inbox processor unavailable")
	}
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	now := s.now()
	var candidates []receipt
	if err := s.db.NewSelect().Model(&candidates).Where("processed_at IS NULL AND next_attempt_at <= ? AND lease_until <= ?", now.UnixMilli(), now.UnixMilli()).Order("created_at ASC").Limit(int64(limit)).Scan(ctx); err != nil {
		return 0, err
	}
	count := 0
	for _, candidate := range candidates {
		now = s.now()
		owner := uuid.NewString()
		claimed, err := s.db.NewUpdate().Model((*receipt)(nil)).Set("lease_owner = ?", owner).Set("lease_until = ?", now.Add(time.Minute).UnixMilli()).Where("id = ? AND processed_at IS NULL AND lease_until <= ?", candidate.ID, now.UnixMilli()).Exec(ctx)
		if err != nil {
			return count, err
		}
		rows, err := claimed.RowsAffected()
		if err != nil {
			return count, err
		}
		if rows == 0 {
			continue
		}
		applyErr := s.processReceipt(ctx, candidate, process)
		update := s.db.NewUpdate().Model((*receipt)(nil)).Set("lease_owner = ''").Set("lease_until = 0").Where("id = ? AND lease_owner = ?", candidate.ID, owner)
		if applyErr == nil {
			update = update.Set("processed_at = ?", s.now()).Set("payload_encrypted = ?", []byte{})
		} else {
			attempt := candidate.Attempts + 1
			delay := time.Second * time.Duration(1<<min(attempt, 10))
			update = update.Set("attempts = ?", attempt).Set("next_attempt_at = ?", s.now().Add(delay).UnixMilli())
		}
		if _, err = update.Exec(ctx); err != nil {
			return count, err
		}
		if applyErr == nil {
			count++
		}
	}
	return count, nil
}

// Recheck authorization before decrypting a receipt from a prior process.
func (s *Service) processReceipt(ctx context.Context, candidate receipt, process Processor) error {
	valid, err := s.bindingStillValid(ctx, candidate)
	if err != nil {
		return err
	}
	if !valid {
		return nil
	}
	payload, err := s.encryptor.Decrypt(candidate.PayloadEncrypted)
	if err != nil {
		return errors.New("provider receipt decryption failed")
	}
	applyCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	return process(applyCtx, Event{AccountID: candidate.AccountID, OAuthGrantID: candidate.OAuthGrantID, ProviderAppID: candidate.ProviderAppID, Kind: candidate.Kind, Payload: []byte(payload)})
}

func (s *Service) bindingStillValid(ctx context.Context, row receipt) (bool, error) {
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id = ? AND oauth_grant_id = ? AND is_active = ?", row.AccountID, row.OAuthGrantID, true).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	var grant models.OAuthGrant
	if err := s.db.NewSelect().Model(&grant).Where("id = ? AND workspace_id = ? AND revoked_at IS NULL", row.OAuthGrantID, account.WorkspaceID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return grant.ValidationStatus == "valid", nil
}

// Prune removes only acknowledged receipts after the provider retry window.
// Failed receipts remain inspectable and retryable. Completed payloads are
// erased immediately; the small deduplication key is retained for seven days.
func (s *Service) Prune(ctx context.Context) error {
	_, err := s.db.NewDelete().Model((*receipt)(nil)).Where("processed_at < ?", s.now().Add(-7*24*time.Hour)).Exec(ctx)
	return err
}
