package handlers

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

const accountCapabilityStateFreshness = 24 * time.Hour

func persistAccountCapabilityState(
	ctx context.Context,
	db *bun.DB,
	accountID string,
	result platform.AccountCapabilityResult,
) error {
	if db == nil || strings.TrimSpace(accountID) == "" || len(result.State) == 0 {
		return nil
	}
	encoded, err := json.Marshal(result.State)
	if err != nil {
		return err
	}
	_, err = db.NewUpdate().
		Model((*models.SocialAccount)(nil)).
		Set("capability_state_json = ?", string(encoded)).
		Set("capability_checked_at = ?", time.Now().UTC()).
		Where("id = ?", accountID).
		Exec(ctx)
	return err
}

func accountLimitProfile(account models.SocialAccount) string {
	if account.Platform != capabilities.ProviderX ||
		account.CapabilityCheckedAt.IsZero() ||
		time.Since(account.CapabilityCheckedAt) > accountCapabilityStateFreshness {
		return "standard"
	}
	state := decodeAccountCapabilityState(account.CapabilityState)
	if platform.XSubscriptionHasPremiumLimits(state[platform.XCapabilityStateSubscriptionType]) {
		return "x-premium"
	}
	return "standard"
}

func decodeAccountCapabilityState(raw string) map[string]string {
	state := map[string]string{}
	if strings.TrimSpace(raw) == "" {
		return state
	}
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return map[string]string{}
	}
	return state
}

func standardXPublishingCapabilities() platform.AccountCapabilityResult {
	return platform.XPublishingCapabilities(platform.XSubscriptionTypeUnknown)
}
