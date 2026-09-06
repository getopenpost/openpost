package mfarecovery

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const (
	CodeCount    = 10
	codeLength   = 16
	codeGroup    = 4
	codeDomain   = "openpost:mfa-recovery:v1:"
	codeAlphabet = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
)

// GeneratedSet contains the only plaintext copy of a recovery-code batch.
// Callers must return Codes once and persist only Hashes.
type GeneratedSet struct {
	BatchID string
	Codes   []string
	Hashes  []string
}

type Service struct {
	db *bun.DB
}

func NewService(db *bun.DB) *Service {
	return &Service{db: db}
}

func (s *Service) Generate() (GeneratedSet, error) {
	set := GeneratedSet{
		BatchID: uuid.NewString(),
		Codes:   make([]string, 0, CodeCount),
		Hashes:  make([]string, 0, CodeCount),
	}
	seen := make(map[string]struct{}, CodeCount)
	for len(set.Codes) < CodeCount {
		code, err := generateCode()
		if err != nil {
			return GeneratedSet{}, err
		}
		hash, err := Hash(code)
		if err != nil {
			return GeneratedSet{}, err
		}
		if _, duplicate := seen[hash]; duplicate {
			continue
		}
		seen[hash] = struct{}{}
		set.Codes = append(set.Codes, code)
		set.Hashes = append(set.Hashes, hash)
	}
	return set, nil
}

// ReplaceWithDB is code-set replacement inside an existing caller transaction.
// Removing the old batch both revokes every old code and bounds storage to one
// current batch per user.
func (s *Service) ReplaceWithDB(
	ctx context.Context,
	db bun.IDB,
	userID string,
	set GeneratedSet,
	now time.Time,
) error {
	if err := validateSet(set); err != nil {
		return err
	}
	if err := s.RevokeAllWithDB(ctx, db, userID); err != nil {
		return err
	}
	rows := make([]models.UserMFARecoveryCode, 0, len(set.Hashes))
	for _, hash := range set.Hashes {
		rows = append(rows, models.UserMFARecoveryCode{
			ID:        uuid.NewString(),
			UserID:    userID,
			BatchID:   set.BatchID,
			CodeHash:  hash,
			CreatedAt: now,
		})
	}
	_, err := db.NewInsert().Model(&rows).Exec(ctx)
	return err
}

// RevokeAllWithDB removes the only material needed to validate the active
// batch. Deletion is deliberate: it revokes immediately and avoids retaining
// recovery-code metadata after TOTP is disabled or a batch is replaced.
func (s *Service) RevokeAllWithDB(ctx context.Context, db bun.IDB, userID string) error {
	_, err := db.NewDelete().Model((*models.UserMFARecoveryCode)(nil)).
		Where("user_id = ?", userID).
		Exec(ctx)
	return err
}

func (s *Service) CountRemaining(ctx context.Context, userID string) (int, error) {
	return s.db.NewSelect().Model((*models.UserMFARecoveryCode)(nil)).
		Where("user_id = ? AND used_at IS NULL", userID).
		Count(ctx)
}

// ConsumeWithDB marks one matching active code used. The partial unique index
// guarantees a valid digest can update at most one row, while the conditional
// update makes concurrent attempts exactly single-use.
func (s *Service) ConsumeWithDB(
	ctx context.Context,
	db bun.IDB,
	userID string,
	rawCode string,
	now time.Time,
) (bool, error) {
	hash, err := Hash(rawCode)
	if err != nil {
		return false, nil
	}
	result, err := db.NewUpdate().Model((*models.UserMFARecoveryCode)(nil)).
		Set("used_at = ?", now).
		Where("user_id = ? AND code_hash = ? AND used_at IS NULL", userID, hash).
		Exec(ctx)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	return affected == 1, err
}

func (s *Service) Consume(ctx context.Context, userID, rawCode string, now time.Time) (bool, error) {
	var consumed bool
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var err error
		consumed, err = s.ConsumeWithDB(txCtx, tx, userID, rawCode, now)
		return err
	})
	return consumed, err
}

func Hash(rawCode string) (string, error) {
	normalized, err := Normalize(rawCode)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256([]byte(codeDomain + normalized))
	return hex.EncodeToString(digest[:]), nil
}

func Normalize(rawCode string) (string, error) {
	normalized := strings.Map(func(r rune) rune {
		if r == '-' || unicode.IsSpace(r) {
			return -1
		}
		return unicode.ToUpper(r)
	}, strings.TrimSpace(rawCode))
	if len(normalized) != codeLength {
		return "", fmt.Errorf("recovery code must contain %d characters", codeLength)
	}
	for _, r := range normalized {
		if !strings.ContainsRune(codeAlphabet, r) {
			return "", fmt.Errorf("recovery code contains an invalid character")
		}
	}
	return normalized, nil
}

func generateCode() (string, error) {
	var normalized strings.Builder
	normalized.Grow(codeLength)
	// Rejection sampling avoids the modulo bias caused by 256 not being a
	// multiple of the 30-character transcription-safe alphabet.
	limit := 256 - (256 % len(codeAlphabet))
	buffer := make([]byte, codeLength*2)
	for normalized.Len() < codeLength {
		if _, err := rand.Read(buffer); err != nil {
			return "", err
		}
		for _, value := range buffer {
			if int(value) >= limit {
				continue
			}
			normalized.WriteByte(codeAlphabet[int(value)%len(codeAlphabet)])
			if normalized.Len() == codeLength {
				break
			}
		}
	}
	plain := normalized.String()
	groups := make([]string, 0, codeLength/codeGroup)
	for start := 0; start < len(plain); start += codeGroup {
		groups = append(groups, plain[start:start+codeGroup])
	}
	return strings.Join(groups, "-"), nil
}

func validateSet(set GeneratedSet) error {
	if strings.TrimSpace(set.BatchID) == "" {
		return fmt.Errorf("recovery-code batch id is required")
	}
	if len(set.Hashes) != CodeCount {
		return fmt.Errorf("recovery-code batch must contain %d hashes", CodeCount)
	}
	seen := make(map[string]struct{}, len(set.Hashes))
	for _, hash := range set.Hashes {
		if len(hash) != sha256.Size*2 {
			return fmt.Errorf("recovery-code hash is invalid")
		}
		if _, err := hex.DecodeString(hash); err != nil {
			return fmt.Errorf("recovery-code hash is invalid: %w", err)
		}
		if _, duplicate := seen[hash]; duplicate {
			return fmt.Errorf("recovery-code hashes must be unique")
		}
		seen[hash] = struct{}{}
	}
	return nil
}
