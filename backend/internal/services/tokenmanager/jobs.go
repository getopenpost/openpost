package tokenmanager

import (
	"context"
	"encoding/json"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const refreshLeadTime = 5 * time.Minute

type refreshJobPayload struct {
	GrantID   string `json:"grant_id,omitempty"`
	AccountID string `json:"account_id"`
}

type RefreshJobTarget struct {
	GrantID   string
	AccountID string
}

func ScheduleGrantRefreshJob(ctx context.Context, db *bun.DB, grantID string, expiresAt time.Time) error {
	return scheduleRefreshJob(ctx, db, refreshJobPayload{GrantID: grantID}, expiresAt)
}

// ScheduleRefreshJob retains compatibility with pre-073 jobs and test
// fixtures. New runtime scheduling is grant-scoped.
func ScheduleRefreshJob(ctx context.Context, db *bun.DB, accountID string, expiresAt time.Time) error {
	return scheduleRefreshJob(ctx, db, refreshJobPayload{AccountID: accountID}, expiresAt)
}

func scheduleRefreshJob(ctx context.Context, db *bun.DB, target refreshJobPayload, expiresAt time.Time) error {
	if db == nil || (target.GrantID == "" && target.AccountID == "") || expiresAt.IsZero() {
		return nil
	}

	payloadBytes, err := json.Marshal(target)
	if err != nil {
		return err
	}
	payload := string(payloadBytes)

	if _, err := db.NewDelete().
		Model((*models.Job)(nil)).
		Where("type = ?", jobregistry.TypeRefreshToken).
		Where("status = ?", "pending").
		Where("payload = ?", payload).
		Exec(ctx); err != nil {
		return err
	}

	runAt := expiresAt.Add(-refreshLeadTime)
	now := time.Now().UTC()
	if runAt.Before(now) {
		runAt = now
	}

	job, err := jobregistry.NewJob(jobregistry.TypeRefreshToken, payload, runAt)
	if err != nil {
		return err
	}

	_, err = db.NewInsert().Model(job).Exec(ctx)
	return err
}

func CancelGrantRefreshJobs(ctx context.Context, db bun.IDB, grantID string) error {
	if db == nil || grantID == "" {
		return nil
	}
	payloadBytes, err := json.Marshal(refreshJobPayload{GrantID: grantID})
	if err != nil {
		return err
	}
	_, err = db.NewDelete().Model((*models.Job)(nil)).
		Where("type = ? AND status = ? AND payload = ?", jobregistry.TypeRefreshToken, jobregistry.StatusPending, string(payloadBytes)).
		Exec(ctx)
	return err
}

func ParseRefreshJobPayload(payload string) (RefreshJobTarget, error) {
	var jobPayload refreshJobPayload
	if err := json.Unmarshal([]byte(payload), &jobPayload); err != nil {
		return RefreshJobTarget{}, err
	}
	return RefreshJobTarget(jobPayload), nil
}
