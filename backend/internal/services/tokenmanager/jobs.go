package tokenmanager

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const refreshLeadTime = 5 * time.Minute

type refreshJobPayload struct {
	AccountID string `json:"account_id"`
}

func ScheduleRefreshJob(ctx context.Context, db *bun.DB, accountID string, expiresAt time.Time) error {
	if db == nil || accountID == "" || expiresAt.IsZero() {
		return nil
	}

	payloadBytes, err := json.Marshal(refreshJobPayload{AccountID: accountID})
	if err != nil {
		return err
	}
	payload := string(payloadBytes)

	if _, err := db.NewDelete().
		Model((*models.Job)(nil)).
		Where("type = ?", "refresh_token").
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

	job := &models.Job{
		ID:          uuid.New().String(),
		Type:        "refresh_token",
		Payload:     payload,
		Status:      "pending",
		RunAt:       runAt,
		Attempts:    0,
		MaxAttempts: 5,
	}

	_, err = db.NewInsert().Model(job).Exec(ctx)
	return err
}

func ParseRefreshJobPayload(payload string) (string, error) {
	var jobPayload refreshJobPayload
	if err := json.Unmarshal([]byte(payload), &jobPayload); err != nil {
		return "", err
	}
	return jobPayload.AccountID, nil
}
