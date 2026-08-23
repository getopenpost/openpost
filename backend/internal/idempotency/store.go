// Package idempotency commits an HTTP mutation and its replay record in one
// database transaction. Callers supply the mutation so this package never owns
// domain authorization, validation, or resource state.
package idempotency

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

const (
	stateProcessing = "processing"
	stateCompleted  = "completed"
	defaultTTL      = 24 * time.Hour
	maxKeyLength    = 200
)

var (
	ErrConflict   = errors.New("idempotency key was already used with a different request")
	ErrInProgress = errors.New("idempotent request is still in progress")
	ErrInvalid    = errors.New("invalid idempotency request")
)

type Request struct {
	PrincipalID string
	WorkspaceID string
	OperationID string
	Key         string
	RequestHash string
	HTTPStatus  int
	ResourceID  string
	JobID       string
	ExpiresAt   time.Time
}

type Result[T any] struct {
	Value      T
	HTTPStatus int
	Replayed   bool
}

type record struct {
	bun.BaseModel `bun:"table:idempotency_records"`

	ID             string    `bun:",pk"`
	PrincipalID    string    `bun:"principal_id,notnull"`
	WorkspaceID    string    `bun:"workspace_id,notnull"`
	OperationID    string    `bun:"operation_id,notnull"`
	IdempotencyKey string    `bun:"idempotency_key,notnull"`
	RequestHash    string    `bun:"request_hash,notnull"`
	State          string    `bun:",notnull"`
	HTTPStatus     int       `bun:"http_status,notnull"`
	ResponseJSON   string    `bun:"response_json,notnull"`
	ResourceID     string    `bun:"resource_id,notnull"`
	JobID          string    `bun:"job_id,notnull"`
	ExpiresAt      time.Time `bun:"expires_at,notnull"`
	CreatedAt      time.Time `bun:"created_at,notnull"`
	CompletedAt    time.Time `bun:"completed_at,nullzero"`
}

func Hash(value any) (string, error) {
	normalized, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("normalize idempotent request: %w", err)
	}
	digest := sha256.Sum256(normalized)
	return fmt.Sprintf("%x", digest[:]), nil
}

func Replay[T any](ctx context.Context, db *bun.DB, request Request) (Result[T], bool, error) {
	var zero Result[T]
	request = normalize(request)
	if err := validateRequest(request, db); err != nil {
		return zero, false, err
	}
	var existing record
	err := db.NewSelect().Model(&existing).
		Where("principal_id = ?", request.PrincipalID).
		Where("workspace_id = ?", request.WorkspaceID).
		Where("operation_id = ?", request.OperationID).
		Where("idempotency_key = ?", request.Key).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return zero, false, nil
	}
	if err != nil {
		return zero, false, fmt.Errorf("load idempotency replay: %w", err)
	}
	if !existing.ExpiresAt.After(time.Now().UTC()) {
		return zero, false, nil
	}
	if existing.RequestHash != request.RequestHash {
		return zero, true, ErrConflict
	}
	if existing.State != stateCompleted {
		return zero, true, ErrInProgress
	}
	var value T
	if err := json.Unmarshal([]byte(existing.ResponseJSON), &value); err != nil {
		return zero, true, fmt.Errorf("decode stored idempotent response: %w", err)
	}
	return Result[T]{Value: value, HTTPStatus: existing.HTTPStatus, Replayed: true}, true, nil
}

func Execute[T any](
	ctx context.Context,
	db *bun.DB,
	request Request,
	mutation func(context.Context, bun.Tx) (T, error),
) (Result[T], error) {
	return ExecuteWithIdentity(ctx, db, request, mutation, nil)
}

func ExecuteWithIdentity[T any](
	ctx context.Context,
	db *bun.DB,
	request Request,
	mutation func(context.Context, bun.Tx) (T, error),
	identity func(T) (resourceID string, jobID string),
) (Result[T], error) {
	var zero Result[T]
	request = normalize(request)
	if err := validateRequest(request, db); err != nil || mutation == nil {
		if err != nil {
			return zero, err
		}
		return zero, ErrInvalid
	}

	var result Result[T]
	err := db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		now := time.Now().UTC()
		claimed, existing, err := claim(txCtx, tx, request, now)
		if err != nil {
			return err
		}
		if !claimed {
			if existing.RequestHash != request.RequestHash {
				return ErrConflict
			}
			if existing.State != stateCompleted {
				return ErrInProgress
			}
			var value T
			if err := json.Unmarshal([]byte(existing.ResponseJSON), &value); err != nil {
				return fmt.Errorf("decode stored idempotent response: %w", err)
			}
			result = Result[T]{Value: value, HTTPStatus: existing.HTTPStatus, Replayed: true}
			return nil
		}

		value, err := mutation(txCtx, tx)
		if err != nil {
			return err
		}
		responseJSON, err := json.Marshal(value)
		if err != nil {
			return fmt.Errorf("encode idempotent response: %w", err)
		}
		resourceID, jobID := request.ResourceID, request.JobID
		if identity != nil {
			identifiedResourceID, identifiedJobID := identity(value)
			if strings.TrimSpace(identifiedResourceID) != "" {
				resourceID = strings.TrimSpace(identifiedResourceID)
			}
			if strings.TrimSpace(identifiedJobID) != "" {
				jobID = strings.TrimSpace(identifiedJobID)
			}
		}
		completedAt := time.Now().UTC()
		update, err := tx.NewUpdate().
			Model((*record)(nil)).
			Set("state = ?", stateCompleted).
			Set("http_status = ?", request.HTTPStatus).
			Set("response_json = ?", string(responseJSON)).
			Set("resource_id = ?", resourceID).
			Set("job_id = ?", jobID).
			Set("completed_at = ?", completedAt).
			Where("principal_id = ?", request.PrincipalID).
			Where("workspace_id = ?", request.WorkspaceID).
			Where("operation_id = ?", request.OperationID).
			Where("idempotency_key = ?", request.Key).
			Where("state = ?", stateProcessing).
			Exec(txCtx)
		if err != nil {
			return fmt.Errorf("finish idempotency record: %w", err)
		}
		rows, err := update.RowsAffected()
		if err != nil {
			return fmt.Errorf("check idempotency record completion: %w", err)
		}
		if rows != 1 {
			return errors.New("idempotency record was not completed")
		}
		result = Result[T]{Value: value, HTTPStatus: request.HTTPStatus}
		return nil
	})
	if err != nil {
		return zero, err
	}
	return result, nil
}

func claim(ctx context.Context, tx bun.Tx, request Request, now time.Time) (bool, record, error) {
	for attempt := 0; attempt < 2; attempt++ {
		item := record{
			ID: uuid.NewString(), PrincipalID: request.PrincipalID, WorkspaceID: request.WorkspaceID,
			OperationID: request.OperationID, IdempotencyKey: request.Key, RequestHash: request.RequestHash,
			State: stateProcessing, ResponseJSON: "", ResourceID: "", JobID: "",
			ExpiresAt: request.ExpiresAt, CreatedAt: now,
		}
		insert, err := tx.NewInsert().Model(&item).
			On("CONFLICT (principal_id, workspace_id, operation_id, idempotency_key) DO NOTHING").
			Exec(ctx)
		if err != nil {
			return false, record{}, fmt.Errorf("claim idempotency key: %w", err)
		}
		rows, err := insert.RowsAffected()
		if err != nil {
			return false, record{}, fmt.Errorf("check idempotency claim: %w", err)
		}
		if rows == 1 {
			return true, record{}, nil
		}

		var existing record
		err = tx.NewSelect().Model(&existing).
			Where("principal_id = ?", request.PrincipalID).
			Where("workspace_id = ?", request.WorkspaceID).
			Where("operation_id = ?", request.OperationID).
			Where("idempotency_key = ?", request.Key).
			Scan(ctx)
		if err != nil {
			return false, record{}, fmt.Errorf("load idempotency record: %w", err)
		}
		if existing.ExpiresAt.After(now) {
			return false, existing, nil
		}
		deleted, err := tx.NewDelete().Model((*record)(nil)).
			Where("id = ? AND expires_at <= ?", existing.ID, now).
			Exec(ctx)
		if err != nil {
			return false, record{}, fmt.Errorf("expire idempotency record: %w", err)
		}
		rows, err = deleted.RowsAffected()
		if err != nil || rows != 1 {
			if err != nil {
				return false, record{}, fmt.Errorf("check idempotency expiry: %w", err)
			}
			return false, record{}, ErrInProgress
		}
	}
	return false, record{}, ErrInProgress
}

func normalize(request Request) Request {
	request.PrincipalID = strings.TrimSpace(request.PrincipalID)
	request.WorkspaceID = strings.TrimSpace(request.WorkspaceID)
	request.OperationID = strings.TrimSpace(request.OperationID)
	request.Key = strings.TrimSpace(request.Key)
	request.RequestHash = strings.TrimSpace(request.RequestHash)
	request.ResourceID = strings.TrimSpace(request.ResourceID)
	request.JobID = strings.TrimSpace(request.JobID)
	if request.HTTPStatus == 0 {
		request.HTTPStatus = 200
	}
	if request.ExpiresAt.IsZero() {
		request.ExpiresAt = time.Now().UTC().Add(defaultTTL)
	} else {
		request.ExpiresAt = request.ExpiresAt.UTC()
	}
	return request
}

func validateRequest(request Request, db *bun.DB) error {
	if db == nil || request.PrincipalID == "" || request.WorkspaceID == "" ||
		request.OperationID == "" || request.Key == "" || request.RequestHash == "" {
		return ErrInvalid
	}
	if len(request.Key) > maxKeyLength {
		return fmt.Errorf("%w: idempotency key exceeds %d characters", ErrInvalid, maxKeyLength)
	}
	if !request.ExpiresAt.After(time.Now().UTC()) {
		return fmt.Errorf("%w: expiry must be in the future", ErrInvalid)
	}
	return nil
}
