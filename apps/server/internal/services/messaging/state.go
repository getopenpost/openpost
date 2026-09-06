package messaging

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

type stateRepository interface {
	load(context.Context, string) (*models.MessagingSyncState, error)
	due(context.Context, string, time.Time) bool
	record(context.Context, syncStateUpdate) error
	list(context.Context, string) ([]models.MessagingSyncState, error)
}

type syncStateStatus string

const (
	syncStateOK                 syncStateStatus = "ok"
	syncStateFailed             syncStateStatus = "failed"
	syncStateUnsupported        syncStateStatus = "unsupported"
	syncStateDisabled           syncStateStatus = "disabled"
	syncStatePermissionRequired syncStateStatus = "permission_required"
)

type syncStateFailure struct {
	code    string
	message string
}

type syncStateUpdate struct {
	account          models.SocialAccount
	status           syncStateStatus
	failure          syncStateFailure
	cursor           string
	backfillComplete bool
	cadence          time.Duration
	emptyStreak      int
	attemptedAt      time.Time
}

type bunStateRepository struct{ db *bun.DB }

func newStateRepository(db *bun.DB) stateRepository { return bunStateRepository{db: db} }

func (r bunStateRepository) load(ctx context.Context, accountID string) (*models.MessagingSyncState, error) {
	var state models.MessagingSyncState
	err := r.db.NewSelect().Model(&state).Where("id = ?", stateID(accountID)).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &state, err
}

func (r bunStateRepository) due(ctx context.Context, accountID string, now time.Time) bool {
	state, err := r.load(ctx, accountID)
	return err == nil && (state == nil || state.NextSyncAt.IsZero() || !state.NextSyncAt.After(now))
}

func (r bunStateRepository) list(ctx context.Context, workspaceID string) ([]models.MessagingSyncState, error) {
	states := []models.MessagingSyncState{}
	err := r.db.NewSelect().Model(&states).
		Where("workspace_id = ?", workspaceID).
		Order("platform ASC", "social_account_id ASC").Scan(ctx)
	return states, err
}

func (r bunStateRepository) record(ctx context.Context, update syncStateUpdate) error {
	state := &models.MessagingSyncState{
		ID: stateID(update.account.ID), WorkspaceID: update.account.WorkspaceID,
		SocialAccountID: update.account.ID, Platform: update.account.Platform, Status: string(update.status),
		ErrorCode: update.failure.code, ErrorMessage: update.failure.message,
		Cursor: update.cursor, BackfillComplete: update.backfillComplete,
		LastAttemptedAt: update.attemptedAt, EmptyStreak: update.emptyStreak, CreatedAt: update.attemptedAt, UpdatedAt: update.attemptedAt,
	}
	if update.status == syncStateOK {
		state.LastSuccessAt = update.attemptedAt
	}
	if update.cadence > 0 {
		state.NextSyncAt = update.attemptedAt.Add(update.cadence)
	}
	_, err := r.db.NewInsert().Model(state).
		On("CONFLICT (id) DO UPDATE").
		Set("workspace_id = EXCLUDED.workspace_id").Set("social_account_id = EXCLUDED.social_account_id").
		Set("platform = EXCLUDED.platform").Set("status = EXCLUDED.status").
		Set("error_code = EXCLUDED.error_code").Set("error_message = EXCLUDED.error_message").
		Set("cursor = EXCLUDED.cursor").Set("backfill_complete = EXCLUDED.backfill_complete").
		Set("last_attempted_at = EXCLUDED.last_attempted_at").
		Set("last_success_at = CASE WHEN EXCLUDED.status = 'ok' THEN EXCLUDED.last_success_at ELSE messaging_sync_state.last_success_at END").
		Set("next_sync_at = EXCLUDED.next_sync_at").Set("empty_streak = EXCLUDED.empty_streak").
		Set("updated_at = EXCLUDED.updated_at").Exec(ctx)
	return err
}

func stateID(accountID string) string {
	return "messages:account:" + accountID
}
